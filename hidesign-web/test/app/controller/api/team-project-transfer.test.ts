import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ids = require('../../../../app/utils/ids.js');
const controllerModule = { exports: {} as any };
runInNewContext(readFileSync(new URL('../../../../app/controller/api/team_project.js', import.meta.url), 'utf8'), {
  module: controllerModule,
  require(id: string) {
    if (id === 'egg') return { Controller: class {} };
    if (id === 'node:crypto') return require(id);
    if (id === '../../utils/knex.js') return { createKnex() { throw new Error('Real database forbidden'); } };
    if (id === '../../utils/ids.js') return ids;
    throw new Error(id);
  },
});

function authorTransferFixture(options: { authorInTarget?: boolean; sourceAuthorPresent?: boolean; authorRole?: string; retry?: boolean } = {}) {
  const members = [
    { workspace_id: 'source', workspace_member_id: 'source-mover', username: 'alice', displayname: 'Alice', role: 'admin' },
    { workspace_id: 'target', workspace_member_id: 'target-mover', username: 'alice', displayname: 'Alice', role: 'member' },
    ...(options.sourceAuthorPresent === false ? [] : [
      { workspace_id: 'source', workspace_member_id: 'source-author', username: 'bob', displayname: 'Bob', role: 'member' },
    ]),
    ...(options.authorInTarget === false ? [] : [
      { workspace_id: 'target', workspace_member_id: 'target-author', username: 'bob', displayname: 'Bob', role: options.authorRole ?? 'member' },
    ]),
  ];
  const author = { username: 'bob', displayName: 'Bob' };
  const source = { id: 'source-row', resource_id: 'source-resource', owner_member_id: 'source-author',
    display_name: 'Original project', kind: 'project', metadata: { name: 'Original project',
      ...(options.sourceAuthorPresent === false ? { projectAuthor: author } : {}) }, resource_metadata: {} };
  const writes: Array<{ table: string; operation: string; data: any }> = [];
  const knex: any = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query: any = {
      where(input: object) { Object.assign(filters, input); return query; },
      join() { return query; }, select() { return query; }, orderBy() { return query; },
      async first() {
        if (table === 'workspace_members') return members.find(row => Object.entries(filters).every(([key, value]) => (row as any)[key] === value));
        if (table === 'folders') return filters.workspace_id === 'target' && filters.folder_id === 'target-folder'
          ? { workspace_id: 'target', folder_id: 'target-folder', owner_member_id: 'target-mover' } : null;
        if (table === 'team_projects as tp') return options.retry ? null : source;
        if (table === 'resource_refs as rr') return { version_id: 'source-version', version: 3, manifest_digest: 'manifest' };
        if (table === 'project_transfers') return { target_resource_id: 'target-resource', transferred_by: 'source-mover' };
        if (table === 'team_projects') return { resource_id: 'target-resource', owner_member_id: 'target-author', last_synced_version_id: 'target-version' };
        if (table === 'resource_versions') return { id: 'target-version', version: 3 };
        throw new Error(`Unexpected query: ${table}`);
      },
      insert(data: any) { writes.push({ table, operation: 'insert', data }); return query; },
      update(data: any) { writes.push({ table, operation: 'update', data }); return query; },
      del() { writes.push({ table, operation: 'delete', data: null }); return query; },
      onConflict() { return query; }, ignore() { return query; },
      then(resolve: any, reject: any) { return Promise.resolve([]).then(resolve, reject); },
    };
    return query;
  };
  knex.raw = async () => {};
  knex.transaction = async (fn: (db: any) => Promise<unknown>) => fn(knex);
  const controller = new controllerModule.exports();
  controller.getKnex = () => knex;
  controller.ctx = { status: 200, params: { workspaceId: 'source', projectId: 'project' },
    request: { body: { targetWorkspaceId: 'target', targetOwnerMemberId: 'target-mover' } },
    state: { user: { username: 'alice' } }, logger: { error(...args: unknown[]) { throw args.at(-1); } },
  };
  return { controller, writes, author };
}

test('manager transfers retain the original author, without adding target membership', async () => {
  for (const authorInTarget of [true]) {
    const { controller, writes, author } = authorTransferFixture({ authorInTarget });
    await controller.transfer();
    assert.equal(controller.ctx.status, 200);
    const expectedAuthorId = 'target-author';
    assert.equal(controller.ctx.body.targetOwnerMemberId, expectedAuthorId);
    for (const table of ['resources', 'team_projects']) {
      const inserted = writes.find(write => write.table === table && write.operation === 'insert');
      assert.equal(inserted?.data.owner_member_id, expectedAuthorId);
    }
    const target = writes.find(write => write.table === 'team_projects' && write.operation === 'insert')!.data;
    assert.deepEqual({ ...target.metadata.projectAuthor }, author);
    assert.equal(controller._toRecord({ ...target, owner_displayname: null }).ownerDisplayName, 'Bob');
    assert.equal(writes.some(write => write.table === 'workspace_members'), false);
    assert.equal(writes.find(write => write.table === 'project_transfers')?.data.transferred_by, 'source-mover');
  }
});

test('transfers require the original author to have write access to the destination', async () => {
  for (const options of [{ authorInTarget: false }, { authorRole: 'guest' }]) {
    const { controller, writes } = authorTransferFixture(options);
    await controller.transfer();
    assert.equal(controller.ctx.status, 403);
    assert.equal(controller.ctx.body.error, 'project_author_target_access_denied');
    assert.equal(writes.length, 0);
  }
});

test('subsequent transfers preserve an author who is no longer a source team member', async () => {
  const { controller } = authorTransferFixture({ sourceAuthorPresent: false });
  await controller.transfer();
  assert.equal(controller.ctx.status, 200);
  assert.equal(controller.ctx.body.targetOwnerMemberId, 'target-author');
});

test('a manager can retry their committed transfer without taking authorship or transferring again', async () => {
  const { controller, writes } = authorTransferFixture({ retry: true });
  controller.ctx.request.body.targetFolderId = 'deleted-folder';
  await controller.transfer();
  assert.equal(controller.ctx.status, 200);
  assert.equal(controller.ctx.body.targetOwnerMemberId, 'target-author');
  assert.equal(controller.ctx.body.folderId, null);
  assert.equal(writes.length, 0);
});

test('a transfer places the preserved-author project in the target folder atomically', async () => {
  for (const folderId of ['target-folder', 'foreign-folder', null]) {
    const { controller, writes } = authorTransferFixture();
    controller.ctx.request.body.targetFolderId = folderId;
    await controller.transfer();
    if (folderId === 'foreign-folder') {
      assert.equal(controller.ctx.status, 404);
      assert.equal(writes.length, 0);
    } else {
      assert.equal(controller.ctx.status, 200);
      assert.equal(controller.ctx.body.folderId, folderId);
      assert.equal(writes.find(write => write.table === 'team_projects' && write.operation === 'insert')?.data.folder_id, folderId);
    }
  }
});

test('a completed transfer retry verifies target membership and exact ownership before returning its result', async () => {
  for (const [role, owner, expected] of [
    ['member', 'target-alice', 200],
    ['guest', 'target-alice', 403],
    ['member', 'another-owner', 404],
    [null, 'target-alice', 403],
  ] as const) {
    const knex: any = (table: string) => ({
      where() { return this; }, join() { return this; }, select() { return this; }, orderBy() { return this; },
      async first() {
        if (table === 'workspace_members') return role && { role, workspace_member_id: 'target-alice' };
        if (table === 'team_projects as tp') return null;
        if (table === 'project_transfers') return { target_resource_id: 'target-resource' };
        if (table === 'team_projects') return { resource_id: 'target-resource', last_synced_version_id: 'v2', owner_member_id: owner };
        if (table === 'resource_versions') return { id: 'v2', version: 2 };
        throw new Error(`Unexpected table: ${table}`);
      },
    });
    knex.raw = async () => {};
    knex.transaction = async (fn: (db: any) => Promise<void>) => fn(knex);
    const controller = new controllerModule.exports();
    controller.getKnex = () => knex;
    controller.ctx = { status: 200, params: { workspaceId: 'personal', projectId: 'project' },
      request: { body: { targetWorkspaceId: 'team' } }, state: { user: { username: 'alice' } },
      logger: { error(error: unknown) { throw error; } },
    };
    await controller.transfer();
    assert.equal(controller.ctx.status, expected);
    if (expected === 200) {
      assert.equal(controller.ctx.body.targetOwnerMemberId, 'target-alice');
      assert.equal(controller.ctx.body.resourceId, 'target-resource');
    } else assert.equal(controller.ctx.body.resourceId, undefined);
  }
});
