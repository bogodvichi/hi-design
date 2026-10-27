// @ts-nocheck
// HDW folder tree is used to preview destructive recursive deletion.
// It must not enumerate descendants/projects from another team.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL('../../../../app/controller/api/folder.js', import.meta.url), 'utf8');
const module = { exports: {} };
runInNewContext(source, {
  module,
  require(id) {
    if (id === 'egg') return { Controller: class {} };
    if (id === '../../utils/knex.js') return { createKnex() { throw new Error('Live database forbidden'); } };
    if (id === '../../utils/ids.js') return {
      getSharedSpaceTeamId: () => 'personal',
      getSharedSpaceMemberId: (username) => username,
    };
    throw new Error('Unexpected dependency: ' + id);
  },
}, { filename: 'app/controller/api/folder.js' });

const FolderController = module.exports;

test('recursive folder tree reads only descendants and projects in the requested workspace', async () => {
  const operations = [];
  const k = (table) => {
    assert.equal(table, 'team_projects');
    return {
      where(fields) {
        assert.equal(fields.workspace_id, 'team-a');
        operations.push('team-scoped-projects');
        return this;
      },
      whereIn(field, ids) {
        assert.equal(field, 'folder_id');
        assert.deepEqual(Array.from(ids), ['root', 'child']);
        return this;
      },
      async select(...columns) {
        assert.deepEqual(columns, ['folder_id', 'project_id']);
        return [{ folder_id: 'child', project_id: 'project-a' }];
      },
    };
  };
  k.raw = async (sql, bindings) => {
    assert.match(sql, /WHERE folder_id = \? AND workspace_id = \?/);
    assert.match(sql, /f\.workspace_id = d\.workspace_id/);
    assert.match(sql, /WHERE f\.workspace_id = \?/);
    assert.deepEqual(Array.from(bindings), ['root', 'team-a', 'team-a']);
    operations.push('scoped-recursion');
    return { rows: [
      { folder_id: 'root', folder_pid: null, folder_name: 'Root' },
      { folder_id: 'child', folder_pid: 'root', folder_name: 'Child' },
    ] };
  };
  const controller = new FolderController();
  controller.ctx = {
    query: { folder_id: 'root', workspace_id: 'team-a' },
    logger: { error(_message, error) { throw error; } },
  };
  controller.getKnex = () => k;

  await controller.tree();

  assert.equal(controller.ctx.body.code, 0);
  assert.deepEqual(operations, ['scoped-recursion', 'team-scoped-projects']);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.ctx.body.data.folders)), [
    { folderId: 'root', folderPid: null, folderName: 'Root', projectIds: [] },
    { folderId: 'child', folderPid: 'root', folderName: 'Child', projectIds: ['project-a'] },
  ]);
});

test('folder tree refuses an unscoped workspace request before querying data', async () => {
  const controller = new FolderController();
  controller.ctx = { query: { folder_id: 'root' } };
  controller.getKnex = () => { throw new Error('query must not be executed'); };

  await controller.tree();

  assert.equal(controller.ctx.body.code, -1);
  assert.match(controller.ctx.body.error, /workspace_id/);
});

function deletionFixture(role, { childCount = 0, projectCount = 0, folderOwner = 'alice' } = {}) {
  const writes = [];
  const actor = { workspace_id: 'team-a', workspace_member_id: 'alice', username: 'alice', role };
  const folder = { folder_id: 'root', workspace_id: 'team-a', owner_member_id: folderOwner };
  const projectRows = Array.from({ length: projectCount }, (_, i) => ({
    project_id: 'project-' + i, resource_id: 'resource-' + i,
  }));
  const k = (table) => ({
    where(_filters) { return this; },
    whereIn(_field, _values) { return this; },
    async first() {
      if (table === 'folders') return folder;
      if (table === 'workspace_members') return actor;
      throw new Error('Unexpected lookup ' + table);
    },
    async select(...names) {
      assert.equal(table, 'team_projects');
      assert.deepEqual(names, ['project_id', 'resource_id']);
      return projectRows;
    },
    async update(fields) {
      writes.push(table + ':update');
      // The controller executes in a separate VM realm, so instanceof Date
      // would incorrectly reject its valid Date instance.
      assert.equal(Object.prototype.toString.call(fields.deleted_at), '[object Date]');
      return projectCount;
    },
    async del() {
      writes.push(table + ':del');
      return 1;
    },
  });
  k.raw = async (_sql, bindings) => {
    assert.deepEqual(Array.from(bindings), ['root', 'team-a', 'team-a']);
    return { rows: [
      { folder_id: 'root' },
      ...Array.from({ length: childCount }, (_, i) => ({ folder_id: 'child-' + i })),
    ] };
  };
  k.transaction = async (fn) => {
    writes.push('transaction');
    return fn(k);
  };
  const controller = new FolderController();
  controller.ctx = {
    params: { folder_id: 'root' },
    query: { operator_member_id: 'alice' },
    state: { user: { username: 'alice' } },
    logger: { error(_message, error) { throw error; } },
  };
  controller.getKnex = () => k;
  return { controller, writes };
}

test('folder creator can delete an empty folder, but not a nonempty one', async () => {
  const empty = deletionFixture('member');
  await empty.controller.del();
  assert.equal(empty.controller.ctx.body.code, 0);
  assert.deepEqual(empty.writes, ['transaction', 'folder_shares:del', 'folders:del']);

  const nonempty = deletionFixture('member', { childCount: 1, projectCount: 1 });
  nonempty.controller.ctx.query.recursive = '1';
  nonempty.controller.ctx.query.expected_folders = '1';
  nonempty.controller.ctx.query.expected_projects = '1';
  await nonempty.controller.del();
  assert.equal(nonempty.controller.ctx.body.code, -1);
  assert.match(nonempty.controller.ctx.body.error, /非空文件夹仅团队管理者/);
  assert.deepEqual(nonempty.writes, []);
});

test('team administrator requires explicit recursive count confirmation before destructive deletion', async () => {
  const missingConfirmation = deletionFixture('admin', { childCount: 1, projectCount: 2, folderOwner: 'bob' });
  await missingConfirmation.controller.del();
  assert.equal(missingConfirmation.controller.ctx.body.error, 'NONEMPTY_FOLDER_REQUIRES_CONFIRMATION');
  assert.deepEqual(missingConfirmation.writes, []);

  const staleConfirmation = deletionFixture('admin', { childCount: 1, projectCount: 2, folderOwner: 'bob' });
  Object.assign(staleConfirmation.controller.ctx.query, {
    recursive: '1', expected_folders: '1', expected_projects: '1',
  });
  await staleConfirmation.controller.del();
  assert.equal(staleConfirmation.controller.ctx.body.error, 'FOLDER_CONTENT_CHANGED');
  assert.deepEqual(staleConfirmation.writes, []);

  const accepted = deletionFixture('admin', { childCount: 1, projectCount: 2, folderOwner: 'bob' });
  Object.assign(accepted.controller.ctx.query, {
    recursive: '1', expected_folders: '1', expected_projects: '2',
  });
  await accepted.controller.del();
  assert.equal(accepted.controller.ctx.body.code, 0);
  assert.equal(accepted.controller.ctx.body.data.deleted_folders, 2);
  assert.equal(accepted.controller.ctx.body.data.deleted_projects, 2);
  assert.deepEqual(accepted.writes, [
    'transaction', 'resources:update', 'share_links:del', 'workspace_project_shares:del',
    'workspace_resource_shares:del', 'team_projects:del', 'folder_shares:del', 'folders:del',
  ]);
});
