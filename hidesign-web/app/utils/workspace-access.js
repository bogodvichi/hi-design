'use strict';

// CommonJS compatibility module: Egg 2 loads the existing JavaScript server
// without a TypeScript loader. Keep authorization at its HTTP boundary.
const crypto = require('node:crypto');
const { createKnex } = require('./knex.js');
const { getSharedSpaceTeamId, getSharedSpaceMemberId, getCollaboratorMemberId } = require('./ids.js');
const { serializeOASessionCookies } = require('./oa-session-cookies');
const { validateOASession } = require('../controller/api/himind_sso');

function denied(status, code) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function createWorkspaceAccess(app, dependencies = {}) {
  let database;
  const db = () => dependencies.knex || (database ||= createKnex(app.config.db));
  const validate = dependencies.validateSession || validateOASession;
  const sessions = new Map();
  const personalWorkspace = getSharedSpaceTeamId();

  async function authenticate(ctx) {
    const bearer = /^Bearer (.+)$/.exec(ctx.headers.authorization || '');
    if (bearer) {
      try {
        const claims = app.jwt.verify(bearer[1], app.config.jwt.secret, { algorithms: ['HS256'] });
        if (typeof claims.username !== 'string' || !claims.username.trim()) throw new Error('missing identity');
        ctx.state.user = { username: claims.username.trim().toLowerCase() };
        return ctx.state.user.username;
      } catch { throw denied(401, 'INVALID_SESSION'); }
    }
    const body = ctx.request.body || {};
    let username = ctx.headers['x-hdw-username'] || body.username || body.created_by_username || body.owner_username || ctx.query.username;
    // Old clients may only supply a member ID. It is a lookup hint, never
    // authorization: the OA session still has to verify the same username.
    if (!username) {
      const id = body.operator_member_id || body.ownerMemberId || ctx.query.operator_member_id;
      if (typeof id === 'string') username = (await db()('workspace_members').where({ workspace_member_id: id }).first())?.username;
    }
    username = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!username) throw denied(401, 'AUTHENTICATION_REQUIRED');
    let cookie = ctx.headers.cookie || serializeOASessionCookies(body.oa_cookies);
    if (ctx.headers['x-hdw-oa-session']) {
      try {
        const encoded = ctx.headers['x-hdw-oa-session'];
        if (encoded.length > 45000) throw new Error('oversized session');
        cookie = serializeOASessionCookies(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
      } catch { throw denied(401, 'INVALID_SESSION'); }
    }
    if (!cookie) throw denied(401, 'AUTHENTICATION_REQUIRED');
    const key = crypto.createHash('sha256').update(username + '\0' + cookie).digest('hex');
    if ((sessions.get(key) || 0) <= Date.now()) {
      try { await validate(cookie, username); } catch { throw denied(401, 'INVALID_SESSION'); }
      if (sessions.size >= 1000) sessions.clear();
      sessions.set(key, Date.now() + 30000);
    }
    ctx.state.user = { username };
    return username;
  }

  async function member(username, workspaceId, write = false) {
    if (!workspaceId) throw denied(400, 'WORKSPACE_REQUIRED');
    const row = await db()('workspace_members').where({ workspace_id: workspaceId, username }).first();
    if (!row || (write && !['owner', 'admin', 'member'].includes(row.role))) throw denied(403, 'WORKSPACE_ACCESS_DENIED');
    return row;
  }

  async function resource(username, workspaceId, resourceId, write) {
    const row = await db()('resources').where({ id: resourceId, workspace_id: workspaceId }).first();
    if (!row) throw denied(404, 'RESOURCE_NOT_FOUND');
    if (write && row.deleted_at) throw denied(410, 'RESOURCE_TRANSFERRED');
    const actor = await db()('workspace_members').where({ workspace_id: workspaceId, username }).first();
    if (write) {
      if (!actor || actor.role === 'guest' || row.owner_member_id !== actor.workspace_member_id) throw denied(403, 'NOT_RESOURCE_OWNER');
    } else if (row.scope !== 'public' && !(actor && (workspaceId !== personalWorkspace || row.owner_member_id === actor.workspace_member_id))) {
      const grant = await db()('workspace_resource_shares').where({ resource_id: resourceId, home_workspace_id: workspaceId, recipient_member_id: getSharedSpaceMemberId(username) }).first();
      const project = row.kind === 'project' && await db()('team_projects').where({ resource_id: resourceId, workspace_id: workspaceId }).first();
      const projectGrant = project && await db()('workspace_project_shares').where({ project_id: project.project_id, home_workspace_id: workspaceId, recipient_member_id: getSharedSpaceMemberId(username) }).first();
      if (!grant && !projectGrant) throw denied(403, 'RESOURCE_ACCESS_DENIED');
    }
    return row;
  }

  async function project(username, workspaceId, projectId, write) {
    const row = await db()('team_projects').where({ workspace_id: workspaceId, project_id: projectId }).first();
    if (!row) throw denied(404, 'PROJECT_NOT_FOUND');
    await resource(username, workspaceId, row.resource_id, write);
    return row;
  }

  async function folder(username, folderId, write) {
    const row = await db()('folders').where({ folder_id: folderId }).first();
    if (!row) throw denied(404, 'FOLDER_NOT_FOUND');
    const actor = await db()('workspace_members').where({ workspace_id: row.workspace_id, username }).first();
    if (actor && row.workspace_id !== personalWorkspace && (!write || actor.role !== 'guest')) return row;
    if (actor && row.owner_member_id === actor.workspace_member_id && (!write || actor.role !== 'guest')) return row;
    if (!write) {
      let ancestor = row;
      const seen = new Set();
      while (ancestor && !seen.has(ancestor.folder_id)) {
        seen.add(ancestor.folder_id);
        if (await db()('folder_shares').where({ folder_id: ancestor.folder_id, recipient_member_id: getSharedSpaceMemberId(username) }).first()) return row;
        ancestor = ancestor.folder_pid && await db()('folders').where({ folder_id: ancestor.folder_pid, workspace_id: row.workspace_id }).first();
      }
    }
    // Historical folders without an owner require evidence-based recovery.
    throw denied(403, 'FOLDER_OWNER_UNRESOLVED');
  }

  async function publicResourceRead(ctx, domain, action) {
    const kinds = ['skill', 'mcp'];
    if (domain === 'resource') {
      // Public catalogs are intentionally readable by installed legacy clients
      // that do not forward OA credentials. Scope comes from the persisted
      // resource for every exact read, never from a caller's visibility hint.
      if (action === 'list') return ctx.method === 'GET'
        && ctx.query.scope === 'public' && kinds.includes(ctx.query.kind);
      const readable = (ctx.method === 'GET' && action === 'show')
        || (ctx.method === 'GET' && action === 'head' && ctx.params.ref === 'published')
        || (ctx.method === 'POST' && action === 'materialize'
          && (!ctx.request.body?.ref || ctx.request.body.ref === 'published'));
      if (!readable) return false;
      const row = await db()('resources').where({ id: ctx.params.resourceId, workspace_id: ctx.params.workspaceId }).first();
      return Boolean(row && row.scope === 'public' && !row.deleted_at && kinds.includes(row.kind));
    }
    if (domain === 'blob' && action === 'download' && ctx.method === 'GET') {
      const row = await db()('resource_version_blobs as vb')
        .join('resource_refs as rr', 'rr.version_id', 'vb.version_id')
        .join('resources as r', 'r.id', 'rr.resource_id')
        .where({ 'vb.digest': ctx.params.digest, 'rr.ref': 'published',
          'r.workspace_id': ctx.params.workspaceId, 'r.scope': 'public' })
        .whereIn('r.kind', kinds)
        .whereNull('r.deleted_at')
        .first('r.id');
      return Boolean(row);
    }
    return false;
  }

  async function authorize(ctx, domain, action, username) {
    const k = db();
    const body = ctx.request.body || {};
    const query = ctx.query;
    const p = ctx.params;
    const write = !['GET', 'HEAD'].includes(ctx.method);
    let ws = p.workspaceId || p.workspace_id || body.workspace_id || body.home_workspace_id || query.workspace_id;
    if (domain === 'comment') {
      ws = p.teamId;
      const actor = await k('workspace_members').where({ workspace_id: ws, username }).first();
      if (action === 'registerMember') {
        if (!actor || p.memberId !== actor.workspace_member_id) throw denied(403, 'MEMBER_ACCESS_DENIED');
        body.role = actor.role;
        return;
      }
      if (action === 'listMembers') {
        if (!actor && !(await k('workspace_project_shares').where({ home_workspace_id: ws, recipient_member_id: getSharedSpaceMemberId(username) }).first())) throw denied(403, 'WORKSPACE_ACCESS_DENIED');
        return;
      }
      const sharedProject = await project(username, ws, p.projectId, false);
      if (action === 'pushComment' && body.comment) {
        if (typeof body.comment.id !== 'string' || !body.comment.id) throw denied(400, 'COMMENT_ID_REQUIRED');
        const memberId = actor?.workspace_member_id || getCollaboratorMemberId(username);
        const existing = await k('project_comments').where({ team_id: ws, project_id: p.projectId, id: body.comment.id }).first();
        if (existing && ![memberId, getCollaboratorMemberId(username)].includes(existing.member_id)) {
          const statusChanged = ['open', 'resolved', 'archived'].includes(body.comment.status)
            && body.comment.status !== existing.status;
          if (!statusChanged && body.comment.deleted !== true) throw denied(403, 'NOT_COMMENT_AUTHOR');
          await resource(username, ws, sharedProject.resource_id, true);
          // Owners may moderate comments, but must never replace the author's
          // identity, text or anchor through the relay's full-record upsert.
          ctx.state.commentModeration = {
            id: existing.id,
            status: statusChanged ? body.comment.status : existing.status,
            deleted: Boolean(existing.deleted || body.comment.deleted === true),
          };
          return;
        }
        body.comment.memberId = memberId;
        body.comment.displayName = actor?.displayname || username;
      }
      return;
    }
    if (domain === 'resource') {
      if (p.resourceId) {
        const existing = await k('resources').where({ id: p.resourceId }).first();
        if (existing || action !== 'publish') await resource(username, p.workspaceId, p.resourceId, action === 'materialize' ? false : write);
        else await member(username, p.workspaceId, true);
      } else if (!(action === 'list' && query.scope === 'public')) await member(username, ws, write);
      if (['publish', 'create'].includes(action)) body.ownerMemberId = (await member(username, ws, true)).workspace_member_id;
      if (write && body.metadata) {
        const kind = body.kind || (p.resourceId && (await k('resources').where({ id: p.resourceId, workspace_id: ws }).first())?.kind);
        if (kind === 'mcp') {
          const clean = {};
          for (const key of ['id', 'templateId', 'label', 'description', 'transport', 'category', 'authMode', 'homepage', 'example', 'command', 'args', 'url', 'logoKey', 'publisherName']) {
            if (body.metadata[key] !== undefined) clean[key] = body.metadata[key];
          }
          for (const key of ['envFields', 'headerFields']) {
            if (Array.isArray(body.metadata[key])) clean[key] = body.metadata[key].map(field => ({ key: field.key, label: field.label, required: field.required, secret: field.secret }));
          }
          body.metadata = clean;
        }
      }
      if (action === 'list' && ws === personalWorkspace && query.scope !== 'public') query.owner_member_id = (await member(username, ws)).workspace_member_id;
      return;
    }
    if (domain === 'teamProject') {
      if (action === 'list') {
        const actor = await k('workspace_members').where({ workspace_id: ws, username }).first();
        if (actor) {
          if (ws === personalWorkspace) ctx.state.personalOwnerMemberId = actor.workspace_member_id;
        } else {
          const grants = await k('workspace_project_shares').where({ home_workspace_id: ws, recipient_member_id: getSharedSpaceMemberId(username) });
          if (!grants.length) throw denied(403, 'WORKSPACE_ACCESS_DENIED');
          ctx.state.allowedProjectIds = grants.map(grant => grant.project_id);
        }
      } else if (action === 'upsert') {
        const actor = await member(username, ws, true);
        const row = await k('team_projects').where({ workspace_id: ws, project_id: p.projectId }).first();
        if (row) await project(username, ws, p.projectId, true);
        body.ownerMemberId = actor.workspace_member_id;
      } else if (action === 'transfer') {
        await member(username, ws, true);
        const target = await member(username, body.targetWorkspaceId, true);
        const source = await k('team_projects').where({ workspace_id: ws, project_id: p.projectId }).first();
        if (source) await project(username, ws, p.projectId, true);
        else {
          const targetProject = await k('team_projects').where({ workspace_id: body.targetWorkspaceId, project_id: p.projectId }).first();
          if (targetProject) await project(username, body.targetWorkspaceId, p.projectId, true);
        }
        body.targetOwnerMemberId = target.workspace_member_id;
      } else await project(username, ws, p.projectId, write);
      return;
    }
    if (domain === 'sharedSpace' || domain === 'resourceShare') {
      if (['info', 'sharedWithMe', 'sharedByMe'].includes(action)) { query.username = username; return; }
      if (action === 'share' || action === 'shareBatch') {
        body.created_by_username = username;
        body.created_by_member_id = getSharedSpaceMemberId(username);
        if (domain === 'resourceShare') await resource(username, ws, body.resource_id, true);
        else for (const id of body.project_id ? [body.project_id] : (body.items || []).map(item => item.project_id)) await project(username, ws, id, true);
        return;
      }
      const table = domain === 'sharedSpace' ? 'workspace_project_shares' : 'workspace_resource_shares';
      const filter = p.share_id ? { id: p.share_id } : domain === 'sharedSpace' ? { project_id: p.project_id } : { resource_id: p.resource_id };
      const grants = await k(table).where(filter);
      if (grants.some(grant => grant.created_by_username !== username && !(p.share_id && grant.recipient_member_id === getSharedSpaceMemberId(username)))) throw denied(403, 'SHARE_ACCESS_DENIED');
      return;
    }
    if (domain === 'team') {
      if (action === 'add') { body.owner_username = username; return; }
      if (action === 'myTeams') { query.username = username; return; }
      if (ws) await member(username, ws, write);
      if (action === 'quit') {
        const row = await k('workspace_members').where({ workspace_member_id: body.workspace_member_id }).first();
        if (!row || row.username !== username) throw denied(403, 'WORKSPACE_ACCESS_DENIED');
      }
      return; // role-changing controllers also bind _checkOperator to ctx.state.user
    }
    if (domain === 'folder') {
      const scopedFolder = async (folderId, mutate) => {
        const row = await folder(username, folderId, mutate);
        if (ws && row.workspace_id !== ws) throw denied(409, 'FOLDER_WORKSPACE_MISMATCH');
        ws = row.workspace_id;
        return row;
      };
      if (query.recipient_member_id) query.recipient_member_id = getSharedSpaceMemberId(username);
      const id = p.folder_id || body.folder_id || query.folder_id;
      if (query.folder_pid) await scopedFolder(query.folder_pid, false);
      if (id && id !== 'root') {
        await scopedFolder(id, write);
      }
      if (body.folder_pid) await scopedFolder(body.folder_pid, write);
      if (body.target_folder_id) await scopedFolder(body.target_folder_id, true);
      for (const folderId of body.folder_ids || []) await scopedFolder(folderId, true);
      if (body.project_id) await project(username, ws, body.project_id, true);
      for (const id of body.project_ids || []) await project(username, ws, id, true);
      for (const item of body.shares || []) {
        await scopedFolder(item.folder_id, true);
        item.shared_by_username = username;
        item.shared_by_member_id = getSharedSpaceMemberId(username);
      }
      if (action === 'shareProjects') {
        body.created_by_username = username;
        body.created_by_member_id = getSharedSpaceMemberId(username);
      }
      const incoming = new Map((body.folders || []).map(item => [item.folder_id, item]));
      for (const item of body.folders || []) {
        const existing = await k('folders').where({ folder_id: item.folder_id }).first();
        if (existing) {
          if (existing.workspace_id !== ws) throw denied(409, 'FOLDER_WORKSPACE_MISMATCH');
          await folder(username, item.folder_id, true);
        }
        // A whole folder tree is created in one insert. Its new parents need
        // not already exist, but every external parent must be authorized.
        const seen = new Set([item.folder_id]);
        let parent = item.folder_pid;
        while (parent && incoming.has(parent)) {
          if (seen.has(parent)) throw denied(400, 'FOLDER_CYCLE');
          seen.add(parent);
          parent = incoming.get(parent).folder_pid;
        }
        if (parent) await scopedFolder(parent, true);
      }
      if (ws && (write || (!id && !query.recipient_member_id))) {
        const actor = await member(username, ws, write);
        if (write) {
          body.operator_member_id = actor.workspace_member_id;
          if (ctx.method === 'DELETE') query.operator_member_id = actor.workspace_member_id;
        }
        ctx.state.folderOwnerMemberId = actor.workspace_member_id;
        if (ws === personalWorkspace && !query.recipient_member_id) ctx.state.personalOwnerMemberId = actor.workspace_member_id;
      }
      return;
    }
    if (domain === 'shareLink') {
      const id = body.project_id || query.project_id;
      let home = ws;
      if (!home) home = (await k('share_links').where({ project_id: id }).first())?.workspace_id;
      await project(username, home, id, true);
      return;
    }
    if (domain === 'blob') {
      if (write) { await member(username, ws, true); return; }
      const versions = await k('resource_version_blobs as vb')
        .join('resource_versions as rv', 'rv.id', 'vb.version_id')
        .join('resources as r', 'r.id', 'rv.resource_id')
        .where({ 'vb.digest': p.digest, 'r.workspace_id': ws }).select('r.id');
      for (const row of versions) {
        try { await resource(username, ws, row.id, false); return; } catch (error) { if (error.status !== 403) throw error; }
      }
      throw denied(403, 'BLOB_ACCESS_DENIED');
    }
  }

  return (domain, action) => async (ctx, next) => {
    try {
      if (domain === 'blob' && action === 'download' && ctx.query.share_token) {
        const link = await db()('share_links').where({ token: ctx.query.share_token, workspace_id: ctx.params.workspaceId }).first();
        if (!link || !await db()('resource_version_blobs').where({ version_id: link.version_id, digest: ctx.params.digest }).first()) throw denied(403, 'SHARE_ACCESS_DENIED');
        return next();
      }
      if (await publicResourceRead(ctx, domain, action)) return next();
      const username = await authenticate(ctx);
      await authorize(ctx, domain, action, username);
    } catch (error) {
      ctx.status = error.status || 503;
      ctx.body = { code: -1, error: error.status ? error.message : 'AUTHORITY_UNAVAILABLE' };
      return;
    }
    await next();
  };
}

module.exports = { createWorkspaceAccess };
