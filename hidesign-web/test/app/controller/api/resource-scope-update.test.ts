// @ts-nocheck
// Controller-only regression for cloud Skill/MCP/Tool scope mutations.
// Runs without a database, OA cookies, or writes to the live HDW service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../../../app/controller/api/resource.js', import.meta.url), 'utf8');
const module = { exports: {} };
runInNewContext(source, {
  module,
  require(id) {
    if (id === 'egg') return { Controller: class {} };
    if (id === '../../utils/knex.js') return { createKnex() { throw new Error('Production database forbidden'); } };
    if (id === '../../utils/blob-store.js') return {};
    if (id === 'node:crypto' || id === 'node:path') return require(id);
    throw new Error('Unexpected dependency: ' + id);
  },
}, { filename: 'app/controller/api/resource.js' });

const ResourceController = module.exports;

function fixture({ kind = 'mcp', scope = 'public', workspaceId = 'ws-owner' } = {}) {
  const resource = {
    id: 'resource-1',
    kind,
    workspace_id: workspaceId,
    owner_member_id: 'owner-member',
    metadata: JSON.stringify({ label: 'Original' }),
    scope,
    deleted_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
  let mutationCount = 0;
  const claim = { resource_id: 'resource-1', kind, normalized_name: 'original' };
  const state = { id: 'global', ready: true };
  const k = (table) => {
    assert.ok(['resources', 'resource_name_registry', 'resource_name_registry_state'].includes(table));
    const target = table === 'resources' ? resource : table === 'resource_name_registry' ? claim : state;
    const filters = {};
    const notFilters = {};
    let onlyActive = false;
    const matching = () => Object.entries(filters).every(([key, value]) => target[key] === value)
      && Object.entries(notFilters).every(([key, value]) => target[key] !== value)
      && (!onlyActive || target.deleted_at === null);
    return {
      where(conditions) { Object.assign(filters, conditions); return this; },
      whereNot(key, value) { notFilters[key] = value; return this; },
      whereNull(name) { if (name === 'deleted_at') onlyActive = true; return this; },
      forUpdate() { return this; },
      async select() { return matching() ? [{ ...target }] : []; },
      async update(changes) {
        if (!matching()) return 0;
        Object.assign(target, changes);
        if (table === 'resources') mutationCount++;
        return 1;
      },
      async first() { return matching() ? { ...target } : undefined; },
    };
  };
  k.transaction = async fn => fn(k);
  k.raw = async () => ({ rows: [] });  async function call({ requestedWorkspace = workspaceId, metadata = { label: 'Updated' }, nextScope = undefined, hasScope = true } = {}) {
    const body = { metadata, ...(hasScope ? { scope: nextScope } : {}) };
    const ctx = {
      params: { workspaceId: requestedWorkspace, resourceId: resource.id },
      request: { body },
      logger: { error(errorLabel, err) { throw new Error(errorLabel + ': ' + err.message); } },
    };
    const controller = new ResourceController();
    controller.ctx = ctx;
    controller.getKnex = () => k;
    await controller.update();
    return ctx;
  }
  return { resource, call, get mutationCount() { return mutationCount; } };
}

for (const kind of ['skill', 'mcp', 'tool']) {
  test(`${kind} unpublish clears the public scope without changing ownership or metadata`, async () => {
    const f = fixture({ kind });
    const result = await f.call({ nextScope: null });
    assert.equal(result.body.code, 0);
    assert.equal(result.body.data.resource.ownerMemberId, 'owner-member');
    assert.equal(result.body.data.resource.scope, undefined);
    assert.equal(result.body.data.resource.metadata.label, 'Updated');
    assert.equal(f.resource.scope, null);
    assert.equal(f.mutationCount, 1);
  });
}

test('publishing preserves the owning workspace and returns the HDW success envelope', async () => {
  const f = fixture({ kind: 'mcp', scope: null });
  const ctx = await f.call({ nextScope: 'public' });
  assert.equal(ctx.body.code, 0);
  assert.equal(ctx.body.data.resource.scope, 'public');
  assert.equal(f.resource.workspace_id, 'ws-owner');
  assert.equal(f.resource.owner_member_id, 'owner-member');
});

test('metadata-only update does not silently unpublish the resource', async () => {
  const f = fixture({ kind: 'tool' });
  const ctx = await f.call({ hasScope: false });
  assert.equal(ctx.body.code, 0);
  assert.equal(f.resource.scope, 'public');
});

test('a resource cannot be mutated through a different workspace path', async () => {
  const f = fixture();
  const ctx = await f.call({ requestedWorkspace: 'ws-stranger', nextScope: null });
  assert.equal(ctx.body.code, -1);
  assert.equal(f.resource.scope, 'public');
  assert.equal(f.mutationCount, 0);
});

test('omitting the workspace id fails closed before any mutation', async () => {
  const f = fixture();
  const ctx = await f.call({ requestedWorkspace: '', nextScope: null });
  assert.equal(ctx.status, 400);
  assert.equal(f.mutationCount, 0);
});
