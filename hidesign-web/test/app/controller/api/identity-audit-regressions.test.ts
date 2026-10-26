// Run with Node 24: node --test <this file>. Red audit specs load the real
// controller methods with isolated database/blob/notification dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../../../../', import.meta.url);
function loadController(name: string) {
  const filename = fileURLToPath(new URL(`app/controller/api/${name}.js`, root));
  const module = { exports: {} as any };
  const isolatedRequire = (id: string) => {
    if (id === 'egg') return { Controller: class {} };
    if (id.endsWith('/knex.js')) return { createKnex: () => { throw new Error('Real database access forbidden'); } };
    if (id.endsWith('/blob-store.js')) return {};
    if (id.endsWith('/hiklink.js')) return { sendHiklinkMessage: async () => {} };
    if (id.endsWith('/ids.js')) return require(fileURLToPath(new URL('app/utils/ids.js', root)));
    if (id.startsWith('node:')) return require(id);
    throw new Error(`Unexpected dependency ${id}`);
  };
  runInNewContext(readFileSync(filename, 'utf8'), { require: isolatedRequire, module, Buffer }, { filename });
  const instance = new module.exports();
  instance.ctx = { params: {}, query: {}, request: { body: {} }, state: { user: { username: 'alice' } }, logger: { error() {} } };
  return instance;
}

test('resource deletion refuses a resource belonging to another workspace', async () => {
  const controller = loadController('resource');
  let row: any = { id: 'private-b', workspace_id: 'workspace-b', owner_member_id: 'bob' };
  const k: any = () => {
    let filters: Record<string, unknown> = {};
    return {
      where(value: Record<string, unknown>) { filters = { ...filters, ...value }; return this; },
      async del() {
        if (row && Object.entries(filters).every(([key, value]) => row[key] === value)) { row = null; return 1; }
        return 0;
      },
    };
  };
  k.transaction = async (fn: (trx: any) => unknown) => fn(k);
  controller.getKnex = () => k;
  controller.ctx.params = { workspaceId: 'workspace-a', resourceId: 'private-b' };
  await controller.remove();
  assert.ok(row, 'foreign resource was deleted with only its ID, without matching workspace or authenticated owner');
});

test('resource update uses the route workspace and preserves its owner', async () => {
  for (const workspaceId of ['workspace-a', 'workspace-b', undefined]) {
    const controller = loadController('resource');
    const row = { id: 'skill-a', workspace_id: 'workspace-a', owner_member_id: 'alice',
      kind: 'skill', metadata: JSON.stringify({ label: 'Before' }), deleted_at: null };
    controller.getKnex = () => () => {
      const filters: Record<string, unknown> = {};
      const matches = () => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value);
      return {
        where(values: Record<string, unknown>) { Object.assign(filters, values); return this; },
        whereNull(key: string) { filters[key] = null; return this; },
        async update(values: object) { if (!matches()) return 0; Object.assign(row, values); return 1; },
        async first() { return matches() ? row : undefined; },
      };
    };
    controller.ctx.params = { resourceId: row.id, ...(workspaceId ? { workspaceId } : {}) };
    controller.ctx.request.body = { metadata: { label: 'After' } };
    await controller.update();
    assert.equal(row.owner_member_id, 'alice');
    assert.equal(row.workspace_id, 'workspace-a');
    if (workspaceId === 'workspace-a') {
      assert.equal(controller.ctx.body.code, 0, controller.ctx.body.msg);
      assert.equal(controller.ctx.body.data.resource.metadata.label, 'After');
    } else {
      assert.equal(JSON.parse(row.metadata).label, 'Before');
      if (!workspaceId) assert.equal(controller.ctx.status, 400);
      else assert.equal(controller.ctx.body.msg, 'resource not found');
    }
  }
});

test('failed publication cannot overwrite an existing resource owner', async () => {
  const controller = loadController('resource');
  const row: any = { id: 'skill-shared-common', workspace_id: 'shared', owner_member_id: 'bob' };
  const k = (table: string) => {
    if (table !== 'resources') throw new Error('Simulated failure after resource upsert');
    return {
      where() { return this; }, async first() { return row; }, insert() { return this; },
      onConflict() { return this; }, async merge(values: object) { Object.assign(row, values); },
    };
  };
  controller.getKnex = () => k;
  controller.ctx.params = { workspaceId: 'shared', resourceId: row.id };
  controller.ctx.request.body = { kind: 'skill', ownerMemberId: 'alice', manifest: { entries: [] } };
  await controller.publish();
  assert.equal(controller.ctx.status, 409);
  assert.equal(row.owner_member_id, 'bob');
});

test('team operator must be the authenticated caller, not merely an existing owner ID', async () => {
  const controller = loadController('team');
  controller.getKnex = () => () => ({
    where() { return this; },
    async first() { return { username: 'bob', workspace_member_id: 'bob-owner', workspace_id: 'team', role: 'owner' }; },
  });
  const result = await controller._checkOperator('bob-owner', 'team', ['owner']);
  assert.ok(result.error, 'Alice was accepted as Bob solely because she supplied Bob member ID');
});

test('MCP creation must not reuse a global resource primary key for equal slugs in different workspaces', async () => {
  const controller = loadController('resource');
  const writes: any[] = [];
  controller.getKnex = () => () => ({
    async insert(row: any) { writes.push(row); }, where() { return this; }, async first() { return writes.at(-1); },
  });
  for (const workspaceId of ['team-a', 'team-b']) {
    controller.ctx.params = { workspaceId };
    controller.ctx.request.body = { kind: 'mcp', ownerMemberId: `${workspaceId}-alice`, metadata: { id: 'same-name', label: 'Same Name' } };
    await controller.create();
  }
  assert.notEqual(writes[0].id, writes[1].id);
});

test('project re-sharing after a move updates the grant home workspace', async () => {
  const controller = loadController('shared_space');
  const stored: any = { home_workspace_id: 'old-team', project_id: 'p' };
  controller.getKnex = () => () => ({
    insert() { return this; }, onConflict() { return this; }, async merge(fields: object) { Object.assign(stored, fields); },
  });
  controller.ctx.request.body = { project_id: 'p', home_workspace_id: 'new-team', created_by_username: 'alice', recipients: [{ username: 'bob' }] };
  await controller.share();
  assert.equal(controller.ctx.body.code, 0);
  assert.equal(stored.home_workspace_id, 'new-team');
});
test('personal identity bootstrap rejects a canonical member ID bound to another username', async () => {
  const controller = loadController('shared_space');
  controller.ctx.query = { username: 'alice' };
  controller.getKnex = () => () => ({ where() { return this; }, async first() { return { username: 'system' }; } });
  await controller.info();
  assert.equal(controller.ctx.status, 409);
  assert.equal(controller.ctx.body.error, 'MEMBER_IDENTITY_CONFLICT');
});

test('batch member removal checks every target workspace', async () => {
  const controller = loadController('team');
  const removed: string[] = [];
  const members = [
    { workspace_member_id: 'a-member', workspace_id: 'team-a', username: 'a', role: 'member' },
    { workspace_member_id: 'b-member', workspace_id: 'team-b', username: 'b', role: 'member' },
  ];
  controller.getKnex = () => (table: string) => ({
    whereIn() { return this; }, where() { return this; },
    async select() { return members; },
    async del() { removed.push(...members.map((member) => member.workspace_member_id)); return members.length; },
    async first() { return table === 'workspaces' ? { workspace_name: 'Team A' } : null; },
  });
  controller._checkOperator = async (_id: string, workspaceId: string) => workspaceId === 'team-a'
    ? { member: { username: 'alice', role: 'owner' } } : { error: 'not a member' };
  controller.ctx.request.body = { operator_member_id: 'alice-a', workspace_member_id: ['a-member', 'b-member'] };
  await controller.removeMember();
  assert.ok(!removed.includes('b-member'), 'authority in team-a removed a member from team-b');
});
