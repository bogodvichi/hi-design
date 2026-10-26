// Exercise the actual operator entrypoint with a transactional in-memory
// database and private-file stand-ins. No production configuration is loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { planIdentityRepairs, type IdentitySnapshot } from '../../../../scripts/identity-repair-plan.ts';

const require = createRequire(import.meta.url);
const ids = require('../../../../app/utils/ids.js');
const source = stripTypeScriptTypes(readFileSync(new URL('../../../../scripts/identity-repair.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace("const require = createRequire(import.meta.url);", '');
function harness() {
  const ws = ids.getSharedSpaceTeamId();
  let data: IdentitySnapshot = {
    workspace_members: [{ workspace_id: ws, username: 'alice', workspace_member_id: ids.getSharedSpaceMemberId('alice') }],
    resources: [{ id: 'r', workspace_id: ws, owner_member_id: ids.getTeamMemberId(ws, 'alice') }],
    resource_versions: [], team_projects: [], workspace_project_shares: [], folder_shares: [], folders: [],
  };
  const files = new Map<string, string>();
  const statements: string[] = [];
  let failReceipt = false;
  let updates = 0;
  const db = {
    async transaction(fn: any) {
      const staged = structuredClone(data);
      const trx: any = (table: keyof IdentitySnapshot) => {
        let filters: Record<string, any> = {};
        const matching = () => staged[table].filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        return {
          where(value: object) { filters = value; return this; },
          forUpdate() { return this; },
          async first() { return matching()[0]; },
          async select() { return staged[table]; },
          async update(value: object) { updates++; matching().forEach(row => Object.assign(row, value)); },
        };
      };
      trx.raw = async (sql: string) => { statements.push(sql); return { rows: [{ name: 'isolated' }] }; };
      await fn(trx);
      data = staged;
    },
    async destroy() {},
  };
  async function run(mode: string, filename = 'plan', options: string[] = []) {
    return runInNewContext(`(async () => { ${source} })()`, {
      process: { argv: ['node', 'script', mode, filename, ...options], env: { DATABASE_URL: 'fake' } },
      require: (name: string) => { assert.equal(name, 'knex'); return () => db; },
      readFileSync: (name: string) => files.get(name),
      writeFileSync: (name: string, text: string, options: any) => {
        assert.equal(options.mode, 0o600); assert.equal(options.flag, 'wx');
        if (files.has(name) || (failReceipt && name.endsWith('.receipt.json'))) throw new Error('File write refused');
        files.set(name, text);
      },
      planIdentityRepairs, console: { log() {} },
    });
  }
  return { run, files, statements, get data() { return data; }, get updates() { return updates; }, failReceipt() { failReceipt = true; } };
}
test('preview is read-only; apply and rollback are idempotent and preserve content', async () => {
  const h = harness();
  const before = structuredClone(h.data);
  await h.run('--plan');
  assert.equal(h.updates, 0);
  assert.match(h.statements[0], /READ ONLY/);
  await h.run('--apply');
  assert.equal(h.data.resources[0].owner_member_id, h.data.workspace_members[0].workspace_member_id);
  assert.equal(h.updates, 1);
  await h.run('--apply');
  assert.equal(h.updates, 1);
  await h.run('--rollback', 'plan.receipt.json');
  assert.deepEqual(h.data, before);
  await h.run('--rollback', 'plan.receipt.json');
  assert.equal(h.updates, 2);
  assert.ok(h.statements.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'));
  assert.equal(h.statements.some(sql => sql.includes('LOCK TABLE')), false);
});
test('a changed binding invalidates the plan without writing any rows', async () => {
  const h = harness();
  await h.run('--plan');
  h.data.resources[0].owner_member_id = 'new-owner';
  await assert.rejects(h.run('--apply'), /stale or changed/);
  assert.equal(h.data.resources[0].owner_member_id, 'new-owner');
  assert.equal(h.updates, 0);
});
test('failure to persist the recovery receipt rolls back the transaction', async () => {
  const h = harness();
  await h.run('--plan');
  const before = structuredClone(h.data);
  h.failReceipt();
  await assert.rejects(h.run('--apply'), /File write refused/);
  assert.deepEqual(h.data, before);
});
test('rollback refuses to overwrite subsequent user ownership changes', async () => {
  const h = harness();
  await h.run('--plan'); await h.run('--apply');
  h.data.resources[0].owner_member_id = 'subsequent-owner';
  await assert.rejects(h.run('--rollback', 'plan.receipt.json'), /Concurrent change/);
  assert.equal(h.data.resources[0].owner_member_id, 'subsequent-owner');
});
test('explicitly confirmed system placeholder and legacy ownership repair atomically and roll back', async () => {
  const h = harness();
  const member = h.data.workspace_members[0];
  member.username = 'system'; member.role = 'member';
  h.data.team_projects.push({ id: 'p', project_id: 'p', workspace_id: member.workspace_id, owner_member_id: h.data.resources[0].owner_member_id, resource_id: 'r' });
  h.data.workspace_project_shares.push({ id: 's', project_id: 'p', home_workspace_id: member.workspace_id, created_by_username: 'alice', created_by_member_id: member.workspace_member_id });
  const original = structuredClone(h.data);
  h.files.set('confirmed', JSON.stringify(['alice']));
  await h.run('--plan', 'plan', ['--confirmed-personal-owners', 'confirmed']);
  assert.deepEqual(h.data, original);
  await h.run('--apply');
  assert.equal(h.data.workspace_members[0].username, 'alice');
  assert.equal(h.data.resources[0].owner_member_id, member.workspace_member_id);
  assert.equal(h.data.team_projects[0].owner_member_id, member.workspace_member_id);
  await h.run('--apply');
  await h.run('--rollback', 'plan.receipt.json');
  await h.run('--rollback', 'plan.receipt.json');
  assert.deepEqual(h.data, original);
  member.username = 'bob';
  assert.equal(planIdentityRepairs({ ...original, workspace_members: [member] }, ['alice']).repairs.some(r => r.table === 'workspace_members'), false);
});
test('placeholder recovery needs all historical witnesses and never claims a real account', () => {
  const h = harness();
  const member = h.data.workspace_members[0];
  member.username = 'system'; member.role = 'member';
  assert.equal(planIdentityRepairs(h.data, ['alice']).repairs.some(r => r.table === 'workspace_members'), false);
  assert.throws(() => planIdentityRepairs(h.data, ['system']), /Invalid confirmed/);
  assert.equal(planIdentityRepairs(h.data).repairs.some(r => r.table === 'workspace_members'), false);
});
