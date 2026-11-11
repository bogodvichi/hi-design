import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const controllerModule = { exports: {} as any };
runInNewContext(readFileSync(new URL('../../../../app/controller/api/team_project.js', import.meta.url), 'utf8'), {
  module: controllerModule,
  require(id: string) {
    if (id === 'egg') return { Controller: class {} };
    if (id === 'node:crypto') return require(id);
    if (id === '../../utils/knex.js') return { createKnex() { throw new Error('Real database forbidden'); } };
    throw new Error(id);
  },
});

/** Thenable helper: knex queries are awaited; builders must be thenable. */
function thenable(value: unknown): any {
  return {
    then(onFulfilled?: any, onRejected?: any) {
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
  };
}

interface Op { op: string; table: string; data?: any }

/**
 * Minimal knex fake covering the chain shapes used by the team_project
 * controller: where/join/select/first reads, insert(+onConflict merge/
 * returning), update, del. All writes are captured in `ops` so tests can
 * assert exactly what the controller persisted for uedro_review_id.
 */
function makeKnex(seed: {
  workspaceMember?: any;
  source?: any;
  existingTeamProject?: any;
  resource?: any;
  publishedVersion?: any;
}) {
  const ops: Op[] = [];
  const selects: string[] = [];
  const knex: any = (table: string) => {
    const b: any = {
      join() { return b; },
      leftJoin(joinFn?: any) {
        if (typeof joinFn === 'function') {
          joinFn({ on() { return { andOn() {} }; } });
        }
        return b;
      },
      where(_key?: any, _value?: any) { return b; },
      whereNull() { return b; },
      select(...cols: string[]) { selects.push(...cols); return b; },
      orderBy() { return b; },
      first() {
        if (table === 'workspace_members') return seed.workspaceMember ?? null;
        if (table === 'team_projects as tp') return seed.source ?? null;
        if (table === 'team_projects') return seed.existingTeamProject ?? null;
        if (table === 'resources') return seed.resource ?? null;
        if (table === 'resource_refs as rr') return seed.publishedVersion ?? null;
        throw new Error(`Unexpected table: ${table}`);
      },
      insert(data: any) {
        ops.push({ op: 'insert', table, data });
        const chain: any = {
          ...thenable([data]),
          onConflict(..._conflict: any[]) {
            return {
              merge(mergeData?: any) {
                ops.push({ op: 'merge', table, data: mergeData ?? data });
                return chain;
              },
              ignore() {
                return thenable(undefined);
              },
            };
          },
          returning(_cols?: any) {
            return thenable([data]);
          },
        };
        return chain;
      },
      update(data: any) {
        ops.push({ op: 'update', table, data });
        return thenable(1);
      },
      del() {
        ops.push({ op: 'del', table });
        return thenable(1);
      },
      // Awaited bare builders (e.g. resource_version_blobs select) yield [].
      ...thenable([]),
    };
    return b;
  };
  knex.raw = async () => {};
  knex.transaction = async (fn: (db: any) => Promise<any>) => fn(knex);
  return { knex, ops, selects };
}

function makeController(knex: any) {
  const controller = new controllerModule.exports();
  controller.getKnex = () => knex;
  controller.ctx = {
    status: 200,
    params: { workspaceId: 'personal', projectId: 'p1' },
    request: { body: {} },
    state: { user: { username: 'alice' } },
    logger: { error(error: unknown) { throw error; } },
  };
  return controller;
}

test('upsert writes uedro_review_id into both the insert row and the merge', async () => {
  const { knex, ops } = makeKnex({
    existingTeamProject: {
      workspace_id: 'personal',
      project_id: 'p1',
      owner_member_id: 'm-owner',
      resource_id: 'res-1',
    },
  });
  const controller = makeController(knex);
  controller.ctx.request.body = { resourceId: 'res-ignored', uedroReviewId: 'r-9' };
  await controller.upsert();

  const insertOp = ops.find((o) => o.op === 'insert' && o.table === 'team_projects');
  assert.ok(insertOp, 'team_projects insert recorded');
  assert.equal(insertOp!.data.uedro_review_id, 'r-9');
  const mergeOp = ops.find((o) => o.op === 'merge' && o.table === 'team_projects');
  assert.ok(mergeOp, 'team_projects merge recorded');
  assert.equal(mergeOp!.data.uedro_review_id, 'r-9');
});

test('upsert accepts snake_case uedro_review_id and never clears an undefined value', async () => {
  const { knex, ops } = makeKnex({
    existingTeamProject: {
      workspace_id: 'personal',
      project_id: 'p1',
      owner_member_id: 'm-owner',
      resource_id: 'res-1',
    },
  });
  const controller = makeController(knex);
  controller.ctx.request.body = { resourceId: 'res-ignored', uedro_review_id: 'r-snake' };
  await controller.upsert();
  const insertOp = ops.find((o) => o.op === 'insert' && o.table === 'team_projects');
  assert.equal(insertOp!.data.uedro_review_id, 'r-snake');

  // No field at all: the merge must not carry uedro_review_id so an
  // existing value is preserved, while a fresh insert row stays null.
  const { knex: knex2, ops: ops2 } = makeKnex({
    existingTeamProject: {
      workspace_id: 'personal',
      project_id: 'p1',
      owner_member_id: 'm-owner',
      resource_id: 'res-1',
    },
  });
  const controller2 = makeController(knex2);
  controller2.ctx.request.body = { resourceId: 'res-ignored' };
  await controller2.upsert();
  const mergeOp = ops2.find((o) => o.op === 'merge' && o.table === 'team_projects');
  assert.ok(mergeOp, 'merge recorded');
  assert.equal('uedro_review_id' in mergeOp!.data, false);
  const insertOp2 = ops2.find((o) => o.op === 'insert' && o.table === 'team_projects');
  assert.equal(insertOp2!.data.uedro_review_id, null);
});

test('upsert clears uedro_review_id only on an explicit null', async () => {
  const { knex, ops } = makeKnex({
    existingTeamProject: {
      workspace_id: 'personal',
      project_id: 'p1',
      owner_member_id: 'm-owner',
      resource_id: 'res-1',
    },
  });
  const controller = makeController(knex);
  controller.ctx.request.body = { resourceId: 'res-ignored', uedroReviewId: null };
  await controller.upsert();
  const mergeOp = ops.find((o) => o.op === 'merge' && o.table === 'team_projects');
  assert.ok(mergeOp, 'merge recorded');
  assert.equal(mergeOp!.data.uedro_review_id, null);
});

test('_toRecord exposes uedroReviewId from the row', () => {
  const controller = new controllerModule.exports();
  const record = controller._toRecord({
    id: 'row-1',
    workspace_id: 'ws',
    project_id: 'p1',
    resource_id: 'res-1',
    owner_member_id: 'm-owner',
    uedro_review_id: 'r-1',
    created_at: new Date(),
    updated_at: new Date(),
  });
  assert.equal(record.uedroReviewId, 'r-1');
});

test('transfer reads uedro_review_id from the source and copies it to the target row', async () => {
  const { knex, ops, selects } = makeKnex({
    workspaceMember: { role: 'member', workspace_member_id: 'target-alice' },
    source: {
      id: 'src-row',
      resource_id: 'res-1',
      owner_member_id: 'm-owner',
      display_name: 'demo',
      sync_state: 'synced',
      last_synced_version_id: 'v1',
      metadata: null,
      cover_digest: null,
      uedro_review_id: 'r-keep',
    },
    publishedVersion: { version_id: 'v1', version: 3, manifest_digest: 'md' },
  });
  const controller = makeController(knex);
  controller.ctx.params = { workspaceId: 'personal', projectId: 'p1' };
  controller.ctx.request.body = { targetWorkspaceId: 'team' };
  await controller.transfer();

  assert.equal(controller.ctx.status, 200);
  assert.equal(controller.ctx.body.workspaceId, 'team');
  // The source read explicitly selects the review binding column…
  assert.ok(
    selects.includes('tp.uedro_review_id'),
    'source query selects tp.uedro_review_id',
  );
  // …and the target team_projects insert copies it.
  const targetInsert = ops.find(
    (o) => o.op === 'insert' && o.table === 'team_projects',
  );
  assert.ok(targetInsert, 'target team_projects insert recorded');
  assert.equal(targetInsert!.data.uedro_review_id, 'r-keep');
});
