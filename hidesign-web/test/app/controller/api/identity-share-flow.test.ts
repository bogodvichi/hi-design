// Opt-in integration test against a disposable PostgreSQL restore. The real
// router, authorization middleware and controllers run over loopback HTTP.
// OA verification uses explicit fixture sessions; this is not real-user SSO acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = new URL('../../../../', import.meta.url);
const connection = process.env.IDENTITY_TEST_DATABASE_URL;

test('owner and recipient complete project, Skill and MCP sharing and revocation over HTTP', { skip: !connection }, async () => {
  const target = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /_identity_test$/);
  const knex = require('knex')({ client: 'pg', connection, pool: { min: 0, max: 2 } });
  const ids = require(fileURLToPath(new URL('app/utils/ids.js', root)));
  const ws = ids.getSharedSpaceTeamId();
  const owner = 'identity_fixture_owner';
  const recipient = 'identity_fixture_recipient';
  const stranger = 'identity_fixture_stranger';
  const ownerId = ids.getSharedSpaceMemberId(owner);
  const load = (relative: string, dependencies: Record<string, any> = {}) => {
    const module = { exports: {} as any };
    runInNewContext(readFileSync(new URL(relative, root), 'utf8'), { module, Buffer, console, require(id: string) {
      if (id in dependencies) return dependencies[id];
      if (id === 'egg') return { Controller: class {} };
      if (id.endsWith('/knex.js')) return { createKnex: () => knex };
      if (id.endsWith('/ids.js')) return ids;
      if (id.endsWith('/oa-session-cookies')) return require(fileURLToPath(new URL('app/utils/oa-session-cookies.js', root)));
      if (id.endsWith('/blob-store.js')) return {};
      if (id === 'node:crypto' || id === 'node:path') return require(id);
      throw new Error(`Unexpected dependency: ${id}`);
    } }, { filename: relative });
    return module.exports;
  };
  const accessModule = load('app/utils/workspace-access.js', {
    '../controller/api/himind_sso': { validateOASession() { throw new Error('Real OA forbidden'); } },
  });
  const access = accessModule.createWorkspaceAccess({ config: {} }, { knex, async validateSession(cookie: string, username: string) {
    assert.ok([owner, recipient, stranger].includes(username));
    assert.equal(cookie, `fixture=${username}`);
  } });
  const controllers: Record<string, any> = {};
  for (const [name, file] of Object.entries({ sharedSpace: 'shared_space', resourceShare: 'resource_share', teamProject: 'team_project', resource: 'resource', comment: 'comment' })) {
    const Controller = load(`app/controller/api/${file}.js`);
    controllers[name] = new Proxy({}, { get(_target, action: string) { return async (ctx: any) => {
      const controller = new Controller();
      controller.ctx = ctx; controller.app = { config: {} }; controller.getKnex = () => knex;
      await controller[action]();
    }; } });
  }
  const routes: any[] = [];
  const router = new Proxy({}, { get(_target, method: string) { return (path: string, ...handlers: any[]) => routes.push({ method: method === 'del' ? 'DELETE' : method.toUpperCase(), path, handlers }); } });
  const api = new Proxy(controllers, { get(target, key: string) { return target[key] || new Proxy({}, { get() { return async () => { throw new Error('Unexercised controller'); }; } }); } });
  load('app/router.js', { './utils/workspace-access': { createWorkspaceAccess: () => access } })({ router, controller: { api, home: { index() {} } } });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost');
      const parts = url.pathname.split('/');
      const route = routes.find(r => r.method === req.method && r.path.split('/').length === parts.length && r.path.split('/').every((part: string, index: number) => part.startsWith(':') || part === parts[index]));
      if (!route) { res.writeHead(404).end(); return; }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const ctx: any = { headers: req.headers, method: req.method, params: {}, query: Object.fromEntries(url.searchParams), request: { body: raw ? JSON.parse(raw) : {} }, state: {}, logger: { error() {} } };
      route.path.split('/').forEach((part: string, index: number) => { if (part.startsWith(':')) ctx.params[part.slice(1)] = decodeURIComponent(parts[index]); });
      const dispatch = async (index: number): Promise<void> => { if (route.handlers[index]) await route.handlers[index](ctx, () => dispatch(index + 1)); };
      await dispatch(0);
      res.writeHead(ctx.status || 200, { 'content-type': 'application/json' }).end(JSON.stringify(ctx.body ?? null));
    } catch { res.writeHead(500).end(JSON.stringify({ error: 'TEST_HANDLER_FAILED' })); }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    async function call(username: string, method: string, path: string, body?: object) {
      const response = await fetch(`http://127.0.0.1:${address.port}/hdw${path.startsWith('/teams/') ? '' : '/api'}${path}`, { method, headers: {
        'content-type': 'application/json', 'x-hdw-username': username,
        'x-hdw-oa-session': Buffer.from(JSON.stringify([{ name: 'fixture', value: username }])).toString('base64'),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as any };
    }
    for (const username of [owner, recipient, stranger]) {
      const result = await call(username, 'GET', '/shared-space/info');
      assert.equal(result.body.code, 0, JSON.stringify(result.body));
      assert.equal(result.body.data.workspace_member_id, ids.getSharedSpaceMemberId(username));
    }
    for (const kind of ['project', 'skill', 'mcp']) {
      const resourceId = `identity-fixture-${kind}`;
      const projectId = 'identity-fixture-project-id';
      await knex('resources').insert({ id: resourceId, workspace_id: ws, owner_member_id: ownerId, kind, metadata: { label: kind } });
      if (kind === 'project') await knex('team_projects').insert({ id: 'identity-fixture-catalog', project_id: projectId, resource_id: resourceId, workspace_id: ws, owner_member_id: ownerId, display_name: 'Identity fixture', sync_state: 'synced' });
      const domain = kind === 'project' ? 'shared-space' : 'resource-share';
      const item = kind === 'project' ? { project_id: projectId } : { resource_id: resourceId, kind };
      const share = await call(owner, 'POST', `/${domain}/share`, { ...item, home_workspace_id: ws, created_by_username: recipient, recipients: [{ username: recipient }] });
      assert.equal(share.body.code, 0, JSON.stringify(share.body));
      const list = await call(recipient, 'GET', `/${domain}/shared-with-me?username=${owner}&kind=${kind}`);
      const rows = list.body.data[kind === 'project' ? 'projects' : 'resources'];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ownerMemberId, ownerId);
      assert.equal(rows[0].sharedByUsername, owner);
      if (kind === 'project') assert.equal(rows[0].access.canEdit, false);
      const readPath = kind === 'project' ? `/workspaces/${ws}/team-projects/${projectId}` : `/workspaces/${ws}/resources/${resourceId}`;
      assert.equal((await call(recipient, 'GET', readPath)).status, 200);
      if (kind === 'project') {
        const personalList = await call(recipient, 'GET', `/workspaces/${ws}/team-projects`);
        assert.equal(personalList.body.projects.some((p: any) => p.projectId === projectId), false);
      }
      assert.equal((await call(stranger, 'GET', readPath)).status, 403);
      for (const method of ['PUT', 'DELETE']) assert.equal((await call(recipient, method, readPath, { resourceId, ownerMemberId: ids.getSharedSpaceMemberId(recipient) })).status, 403);
      assert.equal((await call(recipient, 'POST', `/${domain}/share`, { ...item, home_workspace_id: ws, recipients: [{ username: stranger }] })).status, 403);
      assert.equal((await call(owner, 'PUT', readPath, { resourceId, metadata: { label: 'Owner still edits' } })).status, 200);
      assert.equal((await knex('resources').where({ id: resourceId }).first()).owner_member_id, ownerId);
      if (kind === 'project') {
        const commentPath = `/teams/${ws}/projects/${projectId}/comments`;
        const comment = { id: 'identity-fixture-comment', memberId: ownerId, note: 'Recipient comment' };
        assert.equal((await call(recipient, 'POST', commentPath, { comment })).status, 200);
        const saved = await knex('project_comments').where({ id: comment.id, team_id: ws, project_id: projectId }).first();
        assert.equal(saved.member_id, ids.getSharedSpaceMemberId(recipient));
        assert.equal((await call(owner, 'POST', commentPath, { comment: { ...comment, note: 'Forged overwrite' } })).status, 403);
        for (const change of [{ status: 'resolved' }, { deleted: true }]) {
          assert.equal((await call(owner, 'POST', commentPath, { comment: { ...comment, ...change, note: 'Must not overwrite' } })).status, 200);
          const moderated = await knex('project_comments').where({ id: comment.id, team_id: ws, project_id: projectId }).first();
          assert.equal(moderated.member_id, saved.member_id);
          assert.equal(moderated.note, saved.note);
          assert.equal(moderated.status, 'resolved');
          assert.ok(Number(moderated.seq) > Number(saved.seq));
          if ('deleted' in change) assert.equal(moderated.deleted, true);
        }
        assert.equal((await call(stranger, 'GET', commentPath)).status, 403);
        assert.equal((await call(recipient, 'PUT', `/teams/${ws}/members/${ids.getSharedSpaceMemberId(recipient)}`, { role: 'owner' })).status, 200);
        assert.equal((await knex('workspace_members').where({ workspace_id: ws, username: recipient }).first()).role, 'member');
      }
      const grant = rows[0].shareId;
      assert.equal((await call(stranger, 'DELETE', `/${domain}/${encodeURIComponent(grant)}`)).status, 403);
      assert.equal((await call(owner, 'DELETE', `/${domain}/${encodeURIComponent(grant)}`)).body.code, 0);
      assert.equal((await call(recipient, 'GET', readPath)).status, 403);
      if (kind === 'project') assert.equal((await call(recipient, 'GET', `/teams/${ws}/projects/${projectId}/comments`)).status, 403);
      const revoked = await call(recipient, 'GET', `/${domain}/shared-with-me?kind=${kind}`);
      assert.equal(revoked.body.data[kind === 'project' ? 'projects' : 'resources'].length, 0);
      assert.equal((await call(owner, 'GET', readPath)).status, 200);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await knex.destroy();
  }
});
