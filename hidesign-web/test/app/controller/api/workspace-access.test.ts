import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { planIdentityRepairs, type IdentitySnapshot } from '../../../../scripts/identity-repair-plan.ts';
const require = createRequire(import.meta.url);
const root = new URL('../../../../', import.meta.url);
const ids = require(fileURLToPath(new URL('app/utils/ids.js', root)));
const module = { exports: {} as any };
runInNewContext(readFileSync(new URL('app/utils/workspace-access.js', root), 'utf8'), {
  module, Buffer, require(id: string) {
    if (id === 'node:crypto') return require(id);
    if (id === './knex.js') return { createKnex() { throw new Error('Real database forbidden'); } };
    if (id === './ids.js') return ids;
    if (id === './oa-session-cookies') return require(fileURLToPath(new URL('app/utils/oa-session-cookies.js', root)));
    if (id === '../controller/api/himind_sso') return { validateOASession() { throw new Error('Real network forbidden'); } };
    throw new Error(id);
  },
});
const personal = ids.getSharedSpaceTeamId();
function fixture(extra: Record<string, any[]> = {}, valid = true) {
  const rows: Record<string, any[]> = {
    workspace_members: [{ workspace_id: personal, username: 'alice', workspace_member_id: 'alice', role: 'member' }],
    resources: [{ id: 'bob-private', workspace_id: personal, owner_member_id: 'bob', kind: 'skill' }],
    ...extra,
  };
  const knex = (table: string) => {
    let filters: Record<string, unknown> = {};
    const matches = (row: any) => Object.entries(filters).every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
    const query = {
      where(input: object) { Object.assign(filters, input); return this; },
      whereIn(key: string, values: unknown[]) { filters[key] = values; return this; },
      whereNull(key: string) { filters[key] = null; return this; },
      join() { return this; },
      async first() { return (rows[table] || []).find(matches); },
      then(resolve: any, reject: any) { return Promise.resolve((rows[table] || []).filter(matches)).then(resolve, reject); },
    };
    return query;
  };
  let validations = 0;
  const access = module.exports.createWorkspaceAccess({ config: {} }, { knex,
    async validateSession(cookie: string, username: string) { validations++; assert.equal(cookie, 'session=fake'); assert.equal(username, 'alice'); if (!valid) throw new Error('expired'); },
  });
  async function call(domain: string, action: string, overrides: Record<string, any> = {}) {
    const ctx = { headers: { 'x-hdw-username': 'alice', cookie: 'session=fake' }, state: {}, method: 'GET',
      params: { workspaceId: personal }, query: {}, request: { body: {} }, ...overrides } as any;
    let invoked = false;
    await access(domain, action)(ctx, async () => { invoked = true; });
    return { invoked, ctx, validations };
  }
  return { call };
}

test('expired OA session never reaches a resource mutation', async () => {
  const { invoked, ctx } = await fixture({}, false).call('resource', 'create', { method: 'POST' });
  assert.equal(invoked, false); assert.equal(ctx.status, 401);
});
test('legacy clients can browse explicitly public Skill and MCP catalogs without a session', async () => {
  for (const kind of ['skill', 'mcp']) {
    const result = await fixture().call('resource', 'list', {
      headers: {}, query: { kind, scope: 'public' },
    });
    assert.equal(result.invoked, true);
    assert.equal(result.validations, 0);
  }
  for (const query of [{ kind: 'skill' }, { kind: 'skill', scope: 'private' }, { kind: 'project', scope: 'public' }]) {
    assert.equal((await fixture().call('resource', 'list', { headers: {}, query })).ctx.status, 401);
  }
});
test('legacy public resource reads authorize the persisted scope and published ref only', async () => {
  for (const kind of ['skill', 'mcp']) {
    const f = fixture({ resources: [{ id: 'public', workspace_id: personal, scope: 'public', kind }] });
    const params = { workspaceId: personal, resourceId: 'public', ref: 'published' };
    for (const action of ['show', 'head', 'materialize']) {
      assert.equal((await f.call('resource', action, { params, headers: {}, method: action === 'materialize' ? 'POST' : 'GET' })).invoked, true);
    }
    for (const [action, method] of [['update', 'PUT'], ['publish', 'PUT'], ['remove', 'DELETE']]) {
      assert.equal((await f.call('resource', action, { params, method, headers: {} })).ctx.status, 401);
    }
    assert.equal((await f.call('resource', 'head', { params: { ...params, ref: 'draft' }, headers: {} })).ctx.status, 401);
    assert.equal((await f.call('resource', 'materialize', { params, method: 'POST', headers: {}, request: { body: { ref: 'draft' } } })).ctx.status, 401);
    assert.equal((await f.call('resource', 'show', { params: { ...params, workspaceId: 'other' }, headers: {} })).ctx.status, 401);
  }
  for (const extra of [{ scope: null }, { scope: 'public', deleted_at: '2026-10-23' }, { scope: 'public', kind: 'project' }]) {
    const f = fixture({ resources: [{ id: 'public', workspace_id: personal, kind: 'skill', ...extra }] });
    assert.equal((await f.call('resource', 'show', { params: { workspaceId: personal, resourceId: 'public' }, headers: {} })).ctx.status, 401);
  }
});
test('anonymous blob reads are limited to live published public Skill or MCP bytes', async () => {
  const row = { 'vb.digest': 'allowed', 'rr.ref': 'published', 'r.workspace_id': personal, 'r.scope': 'public', 'r.kind': 'skill', 'r.deleted_at': null };
  for (const patch of [{}, { 'r.kind': 'mcp' }, { 'rr.ref': 'draft' }, { 'r.scope': null }, { 'r.deleted_at': '2026-10-23' }, { 'r.kind': 'project' }, { 'r.workspace_id': 'other' }, { 'vb.digest': 'private' }]) {
    const result = await fixture({ 'resource_version_blobs as vb': [{ ...row, ...patch }] }).call('blob', 'download', {
      headers: {}, params: { workspaceId: personal, digest: 'allowed' },
    });
    assert.equal(result.invoked, Object.keys(patch).length === 0 || patch['r.kind'] === 'mcp');
  }
});
test('legacy share-list username and recipient ID cannot replace a verified session', async () => {
  for (const domain of ['sharedSpace', 'resourceShare']) {
    const result = await fixture().call(domain, 'sharedWithMe', {
      headers: {}, query: { username: 'alice', recipient_member_id: ids.getSharedSpaceMemberId('alice') },
    });
    assert.equal(result.invoked, false);
    assert.equal(result.ctx.status, 401);
    assert.equal(result.validations, 0);
  }
});
test('forwarded session verifies the actor and overrides stale share-list usernames', async () => {
  for (const domain of ['sharedSpace', 'resourceShare']) {
    const result = await fixture().call(domain, 'sharedWithMe', {
      headers: { 'x-hdw-username': 'alice', 'x-hdw-oa-session': Buffer.from(JSON.stringify([{ name: 'session', value: 'fake' }])).toString('base64') },
      query: { username: 'bob' },
    });
    assert.equal(result.invoked, true);
    assert.equal(result.ctx.query.username, 'alice');
    assert.equal(result.validations, 1);
  }
});
test('request owner is replaced by the verified directory member', async () => {
  const { invoked, ctx } = await fixture().call('resource', 'create', { method: 'POST', request: { body: { ownerMemberId: 'bob' } } });
  assert.equal(invoked, true); assert.equal(ctx.request.body.ownerMemberId, 'alice');
});
test('private resource of another personal-space user is not readable or deletable', async () => {
  for (const method of ['GET', 'DELETE']) {
    const { invoked, ctx } = await fixture().call('resource', method === 'GET' ? 'show' : 'remove', { method, params: { workspaceId: personal, resourceId: 'bob-private' } });
    assert.equal(invoked, false); assert.equal(ctx.status, 403);
  }
});
test('recipient grants permit reads but never ownership changes', async () => {
  const f = fixture({ workspace_resource_shares: [{ resource_id: 'bob-private', home_workspace_id: personal, recipient_member_id: ids.getSharedSpaceMemberId('alice') }] });
  const params = { workspaceId: personal, resourceId: 'bob-private' };
  assert.equal((await f.call('resource', 'show', { params })).invoked, true);
  assert.equal((await f.call('resource', 'update', { params, method: 'PUT' })).ctx.status, 403);
});
test('cross-workspace resource grant permits an authenticated recipient but rejects strangers', async () => {
  const record = { id: 'private-source', workspace_id: 'owner-team', owner_member_id: 'owner-member', kind: 'mcp', scope: null };
  const recipient = ids.getSharedSpaceMemberId('alice');
  const f = fixture({ resources: [record], workspace_resource_shares: [{
    resource_id: 'private-source', home_workspace_id: 'owner-team', recipient_member_id: recipient,
  }] });
  const params = { workspaceId: 'owner-team', resourceId: 'private-source' };
  assert.equal((await f.call('resource', 'show', { params })).invoked, true);
  assert.equal((await f.call('resource', 'remove', { method: 'DELETE', params })).ctx.status, 403);
  const stranger = fixture({ resources: [record] });
  assert.equal((await stranger.call('resource', 'show', { params })).ctx.status, 403);
});

test('MCP reference publication preserves trusted provenance through the metadata filter', async () => {
  const metadata = {
    id: 'template', label: 'MCP', transport: 'http', url: 'https://example.invalid',
    publicationSourceType: 'reference', communitySourceResourceId: 'original-mcp',
    communitySourceWorkspaceId: personal, publishedAt: '2026-10-27T00:00:00.000Z',
    publicationVersion: 1, legacyCommunityUnpublishedAt: '2026-10-28T00:00:00.000Z',
    arbitraryCredential: 'must never persist',
  };
  const { invoked, ctx } = await fixture().call('resource', 'create', {
    method: 'POST', request: { body: { kind: 'mcp', metadata } },
  });
  assert.equal(invoked, true);
  for (const key of ['publicationSourceType', 'communitySourceResourceId', 'communitySourceWorkspaceId',
    'publishedAt', 'publicationVersion', 'legacyCommunityUnpublishedAt']) {
    assert.equal(ctx.request.body.metadata[key], metadata[key], key);
  }
  assert.equal(ctx.request.body.metadata.arbitraryCredential, undefined);
});

test('workspace path must match even when resource ID is known', async () => {
  const result = await fixture().call('resource', 'remove', { method: 'DELETE', params: { workspaceId: 'other', resourceId: 'bob-private' } });
  assert.equal(result.invoked, false); assert.equal(result.ctx.status, 404);
});
test('a stale publisher cannot revive a transferred source resource', async () => {
  const f = fixture({ resources: [{ id: 'old', workspace_id: personal, owner_member_id: 'alice', deleted_at: '2026-10-23' }] });
  const result = await f.call('resource', 'publish', { method: 'PUT', params: { workspaceId: personal, resourceId: 'old' } });
  assert.equal(result.invoked, false); assert.equal(result.ctx.status, 410);
});
test('share removal cannot target another issuer or recipient', async () => {
  const result = await fixture({ workspace_project_shares: [{ id: 'grant', created_by_username: 'bob', recipient_member_id: 'carol' }] })
    .call('sharedSpace', 'unshare', { method: 'DELETE', params: { share_id: 'grant' } });
  assert.equal(result.invoked, false); assert.equal(result.ctx.status, 403);
});
test('folder descendant read accepts ancestor grant and mutation still fails', async () => {
  const f = fixture({ folders: [
    { folder_id: 'child', folder_pid: 'root', workspace_id: personal, owner_member_id: 'bob' },
    { folder_id: 'root', folder_pid: null, workspace_id: personal, owner_member_id: 'bob' },
  ], folder_shares: [{ folder_id: 'root', recipient_member_id: ids.getSharedSpaceMemberId('alice') }] });
  assert.equal((await f.call('folder', 'detail', { params: {}, query: { folder_id: 'child' } })).invoked, true);
  assert.equal((await f.call('folder', 'rename', { method: 'POST', params: {}, request: { body: { folder_id: 'child' } } })).ctx.status, 403);
});
test('public share blob capability is limited to the shared immutable version', async () => {
  const f = fixture({ share_links: [{ token: 'token', workspace_id: personal, version_id: 'v1' }], resource_version_blobs: [{ version_id: 'v1', digest: 'allowed' }] });
  for (const digest of ['allowed', 'private']) {
    const result = await f.call('blob', 'download', { headers: {}, params: { workspaceId: personal, digest }, query: { share_token: 'token' } });
    assert.equal(result.invoked, digest === 'allowed');
  }
});
test('batch folder creation accepts new parents but rejects cycles and foreign parents', async () => {
  const f = fixture({ folders: [{ folder_id: 'foreign', workspace_id: 'other', owner_member_id: 'alice' }],
    workspace_members: [
      { workspace_id: personal, username: 'alice', workspace_member_id: 'alice', role: 'member' },
      { workspace_id: 'other', username: 'alice', workspace_member_id: 'alice', role: 'member' },
    ] });
  const call = (folders: object[]) => f.call('folder', 'create', { method: 'POST', request: { body: { workspace_id: personal, folders } } });
  const result = await call([{ folder_id: 'parent' }, { folder_id: 'child', folder_pid: 'parent' }]);
  assert.equal(result.invoked, true);
  assert.equal(result.ctx.state.folderOwnerMemberId, 'alice');
  assert.equal((await call([{ folder_id: 'a', folder_pid: 'b' }, { folder_id: 'b', folder_pid: 'a' }])).ctx.status, 400);
  assert.equal((await call([{ folder_id: 'a', folder_pid: 'foreign' }])).ctx.status, 409);
});
test('bulk personal folder move checks every source owner and deletion stamps the verified operator', async () => {
  const f = fixture({ folders: [
    { folder_id: 'mine', workspace_id: personal, owner_member_id: 'alice' },
    { folder_id: 'theirs', workspace_id: personal, owner_member_id: 'bob' },
  ] });
  const move = await f.call('folder', 'move', { method: 'POST', request: { body: { folder_ids: ['mine', 'theirs'] } } });
  assert.equal(move.invoked, false); assert.equal(move.ctx.status, 403);
  const del = await f.call('folder', 'del', { method: 'DELETE', params: { folder_id: 'mine' }, query: { operator_member_id: 'bob' } });
  assert.equal(del.invoked, true); assert.equal(del.ctx.query.operator_member_id, 'alice');
});
test('shared-folder project grants use the authenticated issuer', async () => {
  const f = fixture({ folders: [{ folder_id: 'mine', workspace_id: personal, owner_member_id: 'alice' }] });
  const result = await f.call('folder', 'shareProjects', { method: 'POST', request: { body: { folder_id: 'mine', created_by_username: 'bob', created_by_member_id: 'bob' } } });
  assert.equal(result.invoked, true);
  assert.equal(result.ctx.request.body.created_by_username, 'alice');
  assert.equal(result.ctx.request.body.created_by_member_id, ids.getSharedSpaceMemberId('alice'));
});
test('team managers can delete native Skill/MCP but not other resource kinds or another workspace', async () => {
  const workspaceId = 'team-delete-roles';
  for (const kind of ['skill', 'mcp', 'project'] as const) {
    for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
      const f = fixture({
        workspace_members: [{ workspace_id: workspaceId, username: 'alice', workspace_member_id: 'alice', role }],
        resources: [{ id: 'resource-1', workspace_id: workspaceId, kind, owner_member_id: 'bob' }],
      });
      const result = await f.call('resource', 'remove', {
        method: 'DELETE', params: { workspaceId, resourceId: 'resource-1' },
      });
      const allowed = kind !== 'project' && (role === 'owner' || role === 'admin');
      assert.equal(result.invoked, allowed, `${kind} / ${role}`);
      if (!allowed) assert.equal(result.ctx.status, 403);
    }
  }
});

test('team project removal accepts managers and the creator, not other members or guests', async () => {
  const workspaceId = 'team-project-delete';
  for (const [role, ownerId, allowed] of [
    ['owner', 'bob', true], ['admin', 'bob', true], ['member', 'bob', false],
    ['member', 'alice', true], ['guest', 'alice', false],
  ] as const) {
    const f = fixture({
      workspace_members: [{ workspace_id: workspaceId, username: 'alice', workspace_member_id: 'alice', role }],
      resources: [{ id: 'resource-1', workspace_id: workspaceId, kind: 'project', owner_member_id: ownerId }],
      team_projects: [{ project_id: 'project-1', workspace_id: workspaceId, resource_id: 'resource-1' }],
    });
    const result = await f.call('teamProject', 'remove', {
      method: 'DELETE', params: { workspaceId, projectId: 'project-1' },
    });
    assert.equal(result.invoked, allowed, `${role} / creator ${ownerId}`);
    if (!allowed) assert.equal(result.ctx.status, 403);
  }
});

test('team folder placement admits managers and project creators but not unrelated members or guests', async () => {
  const workspaceId = 'team-folder-roles';
  for (const [role, owner, allowed] of [
    ['owner', 'bob', true], ['admin', 'bob', true], ['member', 'bob', false],
    ['member', 'alice', true], ['guest', 'alice', false],
  ] as const) {
    const f = fixture({
      workspace_members: [{ workspace_id: workspaceId, username: 'alice', workspace_member_id: 'alice', role }],
      resources: [{ id: 'resource', workspace_id: workspaceId, kind: 'project', owner_member_id: owner }],
      team_projects: [{ project_id: 'project-1', workspace_id: workspaceId, resource_id: 'resource' }],
    });
    const result = await f.call('folder', 'moveProject', {
      method: 'POST', params: {}, request: { body: { workspace_id: workspaceId, project_id: 'project-1', folder_id: null } },
    });
    assert.equal(result.invoked, allowed, `${role} / ${owner}`);
    if (!allowed) assert.equal(result.ctx.status, 403);
  }
});

test('team folder-project sharing permits members but not guests or foreign projects', async () => {
  const workspaceId = 'team-folder-share';
  const data = {
    resources: [{ id: 'resource', workspace_id: workspaceId, kind: 'project', owner_member_id: 'bob' }],
    team_projects: [{ project_id: 'project-1', workspace_id: workspaceId, resource_id: 'resource' }],
  };
  for (const role of ['member', 'guest'] as const) {
    const f = fixture({ ...data,
      workspace_members: [{ workspace_id: workspaceId, username: 'alice', workspace_member_id: 'alice', role }],
    });
    const result = await f.call('folder', 'shareProjects', {
      method: 'POST', params: {}, request: { body: { workspace_id: workspaceId, project_ids: ['project-1'] } },
    });
    assert.equal(result.invoked, role === 'member');
    if (role === 'guest') assert.equal(result.ctx.status, 403);
  }
  const f = fixture({ ...data,
    workspace_members: [{ workspace_id: 'foreign-team', username: 'alice', workspace_member_id: 'alice', role: 'admin' }],
  });
  const rejected = await f.call('folder', 'moveProject', {
    method: 'POST', params: {}, request: { body: { workspace_id: 'foreign-team', project_id: 'project-1' } },
  });
  assert.equal(rejected.invoked, false);
  assert.equal(rejected.ctx.status, 404);
});

test('cross-team project transfers are refused for every role, including the creator', async () => {
  const sourceWorkspace = 'transfer-source';
  for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
    const f = fixture({
      workspace_members: [{ workspace_id: sourceWorkspace, username: 'alice', workspace_member_id: 'alice', role }],
      resources: [{ id: 'resource', workspace_id: sourceWorkspace, owner_member_id: 'alice', kind: 'project' }],
      team_projects: [{ project_id: 'project', workspace_id: sourceWorkspace, resource_id: 'resource' }],
    });
    const result = await f.call('teamProject', 'transfer', {
      method: 'POST',
      params: { workspaceId: sourceWorkspace, projectId: 'project' },
      request: { body: { targetWorkspaceId: 'other-team' } },
    });
    assert.equal(result.invoked, false, role);
    assert.equal(result.ctx.status, 403, role);
  }
});

test('guests may inspect existing links and add comments, but only formal members can generate links', async () => {
  const workspaceId = 'team-sharing';
  const rows = {
    resources: [{ id: 'resource', workspace_id: workspaceId, kind: 'project', owner_member_id: 'creator' }],
    team_projects: [{ project_id: 'project', workspace_id: workspaceId, resource_id: 'resource' }],
  };
  for (const role of ['guest', 'member', 'admin'] as const) {
    const f = fixture({ ...rows,
      workspace_members: [{ workspace_id: workspaceId, username: 'alice', workspace_member_id: 'alice', role }],
    });
    const view = await f.call('shareLink', 'get', {
      method: 'GET', params: {}, query: { workspace_id: workspaceId, project_id: 'project' },
    });
    assert.equal(view.invoked, true, role);
    const generate = await f.call('shareLink', 'generate', {
      method: 'POST', params: {}, request: { body: { workspace_id: workspaceId, project_id: 'project' } },
    });
    assert.equal(generate.invoked, role !== 'guest', role);
    if (role === 'guest') assert.equal(generate.ctx.status, 403);

    const comment = await f.call('comment', 'pushComment', {
      method: 'POST', params: { teamId: workspaceId, projectId: 'project' },
      request: { body: { comment: { id: 'comment-one', text: 'Feedback' } } },
    });
    assert.equal(comment.invoked, true, role);
    assert.equal(comment.ctx.request.body.comment.memberId, 'alice');
  }
});

function snapshot(): IdentitySnapshot { return { workspace_members: [], resources: [], resource_versions: [], team_projects: [], workspace_project_shares: [], folders: [], folder_shares: [] }; }
test('recovery repairs the exact legacy namespace mismatch and is idempotent', () => {
  const data = snapshot();
  data.workspace_members.push({ workspace_id: personal, username: 'alice', workspace_member_id: ids.getSharedSpaceMemberId('alice') });
  data.resources.push({ id: 'r', workspace_id: personal, owner_member_id: ids.getTeamMemberId(personal, 'alice') });
  const plan = planIdentityRepairs(data);
  assert.equal(plan.repairs.length, 1);
  Object.assign(data.resources[0], plan.repairs[0].after);
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
});
test('recovery never assigns a null owner to the current or only user', () => {
  const data = snapshot();
  data.workspace_members.push({ workspace_id: personal, username: 'alice', workspace_member_id: 'alice' });
  data.resources.push({ id: 'r', workspace_id: personal, owner_member_id: null });
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
  assert.equal(planIdentityRepairs(data).unresolved.length, 1);
});
test('recovery follows the persisted version only when workspace and owner agree', () => {
  const data = snapshot();
  data.workspace_members.push({ workspace_id: 'team', username: 'alice', workspace_member_id: 'alice' });
  data.resources.push({ id: 'transferred-resource', workspace_id: 'team', owner_member_id: 'alice' });
  data.resource_versions.push({ id: 'v', resource_id: 'transferred-resource' });
  data.team_projects.push({ id: 'tp', workspace_id: 'team', owner_member_id: 'alice', resource_id: 'recomputed-wrong-id', last_synced_version_id: 'v' });
  assert.equal(planIdentityRepairs(data).repairs[0]?.after.resource_id, 'transferred-resource');
  data.resources[0].owner_member_id = 'bob';
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
});
test('recovery does not treat a missing resource as an active sharing home', () => {
  const data = snapshot();
  data.workspace_members.push({ workspace_id: 'team', username: 'alice', workspace_member_id: 'alice' });
  data.team_projects.push({ id: 'tp', project_id: 'p', workspace_id: 'team', owner_member_id: 'alice', resource_id: 'missing' });
  data.workspace_project_shares.push({ id: 'share', project_id: 'p', home_workspace_id: 'old', created_by_username: 'alice' });
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
});
test('recovery distinguishes duplicate project IDs by the verified share issuer and resource owner', () => {
  const data = snapshot();
  for (const username of ['alice', 'bob']) {
    data.workspace_members.push({ workspace_id: username, username, workspace_member_id: username });
    data.resources.push({ id: `r-${username}`, workspace_id: username, owner_member_id: username });
    data.team_projects.push({ id: `p-${username}`, project_id: 'duplicate', workspace_id: username, owner_member_id: username, resource_id: `r-${username}` });
  }
  data.workspace_project_shares.push({ id: 'grant', project_id: 'duplicate', home_workspace_id: 'alice', created_by_username: 'alice' });
  assert.equal(planIdentityRepairs(data).unresolved.length, 0);
  data.workspace_project_shares[0].home_workspace_id = 'stale';
  assert.deepEqual(planIdentityRepairs(data).repairs.map(row => row.after), [{ home_workspace_id: 'alice' }]);
  data.resources[0].owner_member_id = 'bob';
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
  assert.ok(planIdentityRepairs(data).unresolved.some(row => row.id === 'grant'));
});
test('recovery keeps a valid recorded home but does not guess between two homes of one issuer', () => {
  const data = snapshot();
  for (const workspace of ['one', 'two']) {
    data.workspace_members.push({ workspace_id: workspace, username: 'alice', workspace_member_id: workspace });
    data.resources.push({ id: `r-${workspace}`, workspace_id: workspace, owner_member_id: workspace });
    data.team_projects.push({ id: `p-${workspace}`, project_id: 'duplicate', workspace_id: workspace, owner_member_id: workspace, resource_id: `r-${workspace}` });
  }
  data.workspace_project_shares.push({ id: 'grant', project_id: 'duplicate', home_workspace_id: 'one', created_by_username: 'alice' });
  assert.equal(planIdentityRepairs(data).unresolved.length, 0);
  data.workspace_project_shares[0].home_workspace_id = 'stale';
  assert.equal(planIdentityRepairs(data).repairs.length, 0);
  assert.ok(planIdentityRepairs(data).unresolved.some(row => row.id === 'grant'));
});

test('project owner can moderate a recipient comment without taking its authorship', async () => {
  const f = fixture({
    resources: [{ id: 'project-resource', workspace_id: personal, owner_member_id: 'alice', kind: 'project' }],
    team_projects: [{ project_id: 'project', workspace_id: personal, resource_id: 'project-resource', owner_member_id: 'alice' }],
    project_comments: [{ id: 'comment', team_id: personal, project_id: 'project', member_id: 'bob', status: 'open', deleted: false }],
  });
  const call = (comment: object) => f.call('comment', 'pushComment', { method: 'POST', params: { teamId: personal, projectId: 'project' }, request: { body: { comment: { id: 'comment', ...comment } } } });
  for (const change of [{ status: 'resolved' }, { deleted: true }]) {
    const result = await call(change);
    assert.equal(result.invoked, true);
    assert.equal(result.ctx.state.commentModeration.id, 'comment');
    assert.equal(result.ctx.request.body.comment.memberId, undefined);
  }
  assert.equal((await call({ note: 'replace recipient text' })).ctx.status, 403);
});
