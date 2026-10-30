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
