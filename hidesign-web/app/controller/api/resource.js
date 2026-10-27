'use strict';

const { createKnex } = require('../../utils/knex.js');
const blobStore = require('../../utils/blob-store.js');
const crypto = require('node:crypto');
const path = require('node:path');

const Controller = require('egg').Controller;
const RESOURCE_NAME_KINDS = new Set(['skill', 'mcp']);
const metadataOf = row => {
  try {
    return typeof row?.metadata === 'string'
      ? JSON.parse(row.metadata) : (row?.metadata || {});
  } catch {
    return {};
  }
};
const resourceName = (kind, meta) => {
  const value = kind === 'skill'
    ? (meta.title || meta.name || meta.localId || meta.label)
    : (meta.label || meta.title);
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLocaleLowerCase('en') : '';
};
const isReferencePublication = meta =>
  typeof meta.communitySourceResourceId === 'string' && Boolean(meta.communitySourceResourceId.trim());
const isPublication = meta =>
  isReferencePublication(meta) || meta.publicationSourceType === 'local_import';

/**
 * Global logical-source names are registered by resource_id and indexed by
 * (kind, normalized_name). Existing legacy duplicates may retain their names;
 * new names cannot collide. Registration and resource writes share one
 * transaction and an advisory lock on the normalized name.
 *
 * Deploy 020_resource_name_registry.sql and its backfill before this code.
 * Missing registry tables intentionally fail closed instead of allowing
 * unverified names through.
 */
async function assertRegistryReady(k) {
  const state = await k('resource_name_registry_state')
    .where({ id: 'global', ready: true }).first();
  if (!state) {
    const error = new Error('Name registry backfill is not complete');
    error.code = 'RESOURCE_NAME_REGISTRY_NOT_READY';
    throw error;
  }
}
async function validateResourceIdentity(trx, kind, id, metadata, options = {}) {
  if (!RESOURCE_NAME_KINDS.has(kind)) return;
  await assertRegistryReady(trx);
  const name = resourceName(kind, metadata);
  if (!name) {
    const error = new Error('Resource name is required');
    error.code = 'RESOURCE_NAME_REQUIRED';
    throw error;
  }
  const reference = isReferencePublication(metadata);
  const existing = await trx('resources').where({ id }).first();
  const previousMeta = existing ? metadataOf(existing) : {};
  if (existing && (existing.kind !== kind
    || isReferencePublication(previousMeta) !== reference
    || (reference && previousMeta.communitySourceResourceId !== metadata.communitySourceResourceId)
    || (previousMeta.publicationSourceType === 'local_import' && metadata.publicationSourceType !== 'local_import'))) {
    const error = new Error('Cannot change the identity or source of an existing resource');
    error.code = 'RESOURCE_IDENTITY_CONFLICT';
    throw error;
  }
  const key = reference
    ? 'community-ref:' + kind + ':' + metadata.communitySourceResourceId
    : 'source-name:' + kind + ':' + name;
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [key]);
  if (reference) {
    // Indexed on (kind, metadata ->> communitySourceResourceId) for public rows.
    const duplicate = await trx('resources')
      .where({ kind, scope: 'public' }).whereNull('deleted_at')
      .whereRaw("metadata ->> 'communitySourceResourceId' = ?", [metadata.communitySourceResourceId])
      .whereNot('id', id).first();
    if (duplicate) {
      const error = new Error('This resource is already published');
      error.code = 'RESOURCE_ALREADY_PUBLISHED';
      throw error;
    }
    // Source row locking prevents concurrent deletion and new publication.
    const source = await trx('resources').where({ id: metadata.communitySourceResourceId })
      .whereNull('deleted_at').forUpdate().first();
    if (!source || source.kind !== kind || isReferencePublication(metadataOf(source))
      || (options.workspaceId && source.workspace_id !== options.workspaceId)
      || (options.ownerMemberId && source.owner_member_id !== options.ownerMemberId)) {
      const error = new Error('Source resource unavailable or not owned by publisher');
      error.code = 'PUBLICATION_SOURCE_INVALID';
      throw error;
    }
    return;
  }
  // Keep existing historic same-name resources fully editable. New names,
  // including renames, must not conflict with ANY historic claim.
  if (existing && !isReferencePublication(previousMeta)
    && resourceName(kind, previousMeta) === name) return;
  const collision = await trx('resource_name_registry')
    .where({ kind, normalized_name: name }).whereNot('resource_id', id).first();
  if (collision) {
    const error = new Error('Platform resource with the same name already exists');
    error.code = 'RESOURCE_NAME_CONFLICT';
    throw error;
  }
}
async function syncResourceNameRegistry(trx, kind, id, metadata) {
  if (!RESOURCE_NAME_KINDS.has(kind) || isReferencePublication(metadata)) return;
  const fields = { kind, normalized_name: resourceName(kind, metadata) };
  const existing = await trx('resource_name_registry').where({ resource_id: id }).first();
  if (existing) {
    await trx('resource_name_registry').where({ resource_id: id }).update(fields);
  } else {
    await trx('resource_name_registry').insert({ resource_id: id, ...fields });
  }
}
const policyFailure = (ctx, error) => {
  if (error?.code === 'RESOURCE_NAME_REGISTRY_NOT_READY') {
    ctx.status = 503;
    ctx.body = { error: error.code, message: error.message };
    return true;
  }
  if (!['RESOURCE_NAME_CONFLICT', 'RESOURCE_ALREADY_PUBLISHED', 'PUBLICATION_SOURCE_INVALID', 'SOURCE_HAS_PUBLICATION', 'RESOURCE_NAME_REQUIRED', 'RESOURCE_OWNER_CONFLICT', 'RESOURCE_IDENTITY_CONFLICT'].includes(error?.code)) return false;
  ctx.status = error.code === 'RESOURCE_NAME_REQUIRED' ? 400 : 409;
  ctx.body = { error: error.code, message: error.message };
  return true;
};



// Resource endpoints: publish (two-phase), get published head, pull, remove.
//
// The publish protocol:
//   1. Client PUTs a manifest (list of path+digest+size entries).
//   2. Server checks which blob digests it already has.
//   3. If all present: create resource_version, advance published ref,
//      return { version, versionId, missingBlobs: [] }.
//   4. If some missing: store pending_version_uploads row, return
//      { version, versionId, missingBlobs: [...] }. Client uploads blobs,
//      then re-PUTs the same manifest. On retry, all blobs present so
//      the version commits and the ref advances.
//
// Response format: raw JSON (NOT {code,msg,data}) to match the daemon's
// HdwCloudClient parsing logic. Errors use { error, message } with HTTP
// status codes.

class ResourceController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- Publish: PUT /api/workspaces/:workspaceId/resources/:resourceId/versions ----
  async publish() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body;

    if (!body || !body.manifest || !body.manifest.entries) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'manifest.entries is required' };
      return;
    }

    const kind = body.kind || 'project';
    const ref = body.ref || 'published';
    const metadata = body.metadata || null;
    const ownerMemberId = body.ownerMemberId || 'system';
    // When no scope is provided, leave it NULL (personal scope).
    // Only set scope when the caller explicitly passes one (e.g. 'public').
    const scope = body.scope || null;

    try {
      const k = this.getKnex();

      // Atomically reserve globally unique logical-source names (or the
      // source->publication relationship) before creating a published version.
      await k.transaction(async trx => {
        const existing = await trx('resources').where({ id: resourceId }).forUpdate().first();
        if (existing && (existing.workspace_id !== workspaceId
          || (body.ownerMemberId && existing.owner_member_id !== ownerMemberId))) {
          const error = new Error('Publication cannot transfer ownership');
          error.code = 'RESOURCE_OWNER_CONFLICT';
          throw error;
        }
        // Older clients may update an existing Skill version without resending
        // its metadata. Reuse the persisted logical-source name in that case.
        const effectiveMetadata = metadata ?? (existing ? metadataOf(existing) : {});
        await validateResourceIdentity(trx, kind, resourceId, effectiveMetadata, { workspaceId, ownerMemberId });
        await trx('resources').insert({
          id: resourceId, workspace_id: workspaceId, kind,
          owner_member_id: existing?.owner_member_id || ownerMemberId,
          metadata: metadata ? JSON.stringify(metadata) : null, scope,
        }).onConflict('id').merge({
          deleted_at: null,
          ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
          ...(scope !== null ? { scope } : {}),
        });
        await syncResourceNameRegistry(trx, kind, resourceId, effectiveMetadata);
      });

      // Compute manifest digest and ensure all blobs are recorded.
      const manifestJson = JSON.stringify(body.manifest);
      const manifestDigest = crypto.createHash('sha256').update(manifestJson).digest('hex');

      // Record the manifest blob itself.
      await k('blobs')
        .insert({
          digest: manifestDigest,
          size: Buffer.byteLength(manifestJson, 'utf-8'),
          storage_path: `manifest/${manifestDigest}`,
        })
        .onConflict('digest')
        .ignore();
      await k('workspace_blob_refs')
        .insert({ workspace_id: workspaceId, digest: manifestDigest })
        .onConflict()
        .ignore();

      // Record each entry blob.
      for (const entry of body.manifest.entries) {
        await k('blobs')
          .insert({
            digest: entry.digest,
            size: entry.size,
            storage_path: `blob/${entry.digest}`,
          })
          .onConflict('digest')
          .ignore();
        await k('workspace_blob_refs')
          .insert({ workspace_id: workspaceId, digest: entry.digest })
          .onConflict()
          .ignore();
      }

      // Check which blobs are missing on disk.
      const allDigests = [manifestDigest, ...body.manifest.entries.map(e => e.digest)];
      const missing = [];
      for (const digest of allDigests) {
        if (!(await blobStore.exists(digest))) {
          missing.push(digest);
        }
      }

      if (missing.length > 0) {
        // Store a pending upload.
        const version = await this._nextVersionNumber(resourceId);
        const pendingId = crypto.randomUUID();
        await k('pending_version_uploads')
          .insert({
            id: pendingId,
            resource_id: resourceId,
            workspace_id: workspaceId,
            manifest_digest: manifestDigest,
            version,
            missing_digests: missing,
          })
          .onConflict('id')
          .merge({ missing_digests: missing });

        // Write the manifest blob to disk now (it's small and we have it).
        if (!(await blobStore.exists(manifestDigest))) {
          await blobStore.writeBlob(manifestDigest, Buffer.from(manifestJson, 'utf-8'));
        }

        ctx.body = { version, versionId: pendingId, missingBlobs: missing };
        return;
      }

      // All blobs present — commit the version.
      const version = await this._nextVersionNumber(resourceId);
      const versionId = await this._commitVersion(
        resourceId, workspaceId, version, manifestDigest, body.manifest.entries, ref,
      );

      ctx.body = { version, versionId, missingBlobs: [] };
    } catch (err) {
      if (policyFailure(ctx, err)) return;
      ctx.logger.error('[hdw] publish error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Get published head: GET /api/workspaces/:ws/resources/:id/refs/:ref ----
  async head() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;
    const ref = ctx.params.ref;

    try {
      const k = this.getKnex();
      const refRow = await k('resource_refs as rr')
        .join('resource_versions as rv', 'rv.id', 'rr.version_id')
        .where({ 'rr.resource_id': resourceId, 'rr.ref': ref })
        .select('rv.version', 'rv.id as version_id')
        .first();

      if (!refRow) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'No published version for this ref' };
        return;
      }

      ctx.body = { version: refRow.version, versionId: refRow.version_id };
    } catch (err) {
      ctx.logger.error('[hdw] get head error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Pull: POST /api/workspaces/:ws/resources/:id/materialize ----
  async materialize() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body || {};
    const ref = body.ref || 'published';

    try {
      const k = this.getKnex();
      const versionRow = await k('resource_refs as rr')
        .join('resource_versions as rv', 'rv.id', 'rr.version_id')
        .where({ 'rr.resource_id': resourceId, 'rr.ref': ref })
        .select('rv.version', 'rv.id as version_id', 'rv.manifest_digest')
        .first();

      if (!versionRow) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'No published version for this ref' };
        return;
      }

      // Read the manifest blob from disk.
      const manifestBuffer = await blobStore.readBlob(versionRow.manifest_digest);
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

      // Get the blob digests for this version.
      const blobsRows = await k('resource_version_blobs')
        .where({ version_id: versionRow.version_id })
        .select('digest');

      // Check which blobs are missing on disk.
      const missingBlobs = [];
      for (const row of blobsRows) {
        if (!(await blobStore.exists(row.digest))) {
          missingBlobs.push(row.digest);
        }
      }

      ctx.body = {
        version: versionRow.version,
        versionId: versionRow.version_id,
        manifest,
        missingBlobs,
      };
    } catch (err) {
      if (err?.code === 'ENOENT') {
        // A Dev backend can share the ResourceHub database with another
        // instance without sharing its on-disk Blob directory. Never expose
        // internal filesystem paths to the browser in this case.
        ctx.logger.warn('[hdw] requested published manifest is absent from local Blob storage');
        ctx.status = 503;
        ctx.body = {
          error: 'local_blob_unavailable',
          message: '历史资源文件尚未同步到本机 HDW，请稍后重试或联系管理员。',
        };
        return;
      }
      ctx.logger.error('[hdw] materialize error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Remove: DELETE /api/workspaces/:ws/resources/:id ----
  async remove() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;

    try {
      const k = this.getKnex();
      let deleted = 0;

      await k.transaction(async trx => {
        const original = await trx('resources')
          .where({ id: resourceId, workspace_id: ctx.params.workspaceId }).forUpdate().first();
        if (!original) return;
        if (RESOURCE_NAME_KINDS.has(original.kind) && !isPublication(metadataOf(original))) {
          // Legacy direct-publications must first be explicitly unpublished.
          if (original.scope === 'public') {
            const error = new Error('Please unpublish this resource before deleting its source');
            error.code = 'SOURCE_HAS_PUBLICATION';
            throw error;
          }
          // An active community reference must be removed before its source.
          const reference = await trx('resources').where({ kind: original.kind, scope: 'public' })
            .whereNull('deleted_at')
            .whereRaw("metadata ->> 'communitySourceResourceId' = ?", [resourceId]).first();
          if (reference) {
            const error = new Error('Please unpublish this resource before deleting its source');
            error.code = 'SOURCE_HAS_PUBLICATION';
            throw error;
          }
        }
        // Deleting a publication never cascades into its source resource.
        deleted = await trx('resources').where({ id: resourceId, workspace_id: ctx.params.workspaceId }).del();
      });

      if (deleted === 0) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Resource not found' };
        return;
      }

      ctx.body = { code: 0, msg: 'ok', data: { ok: true } };
    } catch (err) {
      if (policyFailure(ctx, err)) return;
      ctx.logger.error('[hdw] remove resource error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Create: POST /api/workspaces/:ws/resources ----
  // Direct insert for resources that are pure JSON metadata (e.g. MCP
  // templates). Skills use the two-phase publish protocol instead.
  // Returns {code, msg, data} envelope so the daemon's hdwPost helper works.
  async create() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const body = ctx.request.body || {};
    const kind = body.kind || 'resource';
    const ownerMemberId = body.ownerMemberId || body.owner_member_id || 'system';
    const metadata = body.metadata || null;
    // When no scope is provided, leave it NULL (personal scope).
    const scope = body.scope || null;

    if (!workspaceId || !ownerMemberId || !metadata) {
      ctx.body = { code: -1, msg: 'workspaceId, ownerMemberId and metadata are required' };
      return;
    }

    const id = 'res-' + crypto.randomUUID();

    try {
      const k = this.getKnex();
      await k.transaction(async trx => {
        await validateResourceIdentity(trx, kind, id, metadata, { workspaceId, ownerMemberId });
        await trx('resources').insert({
          id, workspace_id: workspaceId, kind,
          owner_member_id: ownerMemberId,
          metadata: JSON.stringify(metadata), scope,
        });
        await syncResourceNameRegistry(trx, kind, id, metadata);
      });

      const row = await k('resources').where({ id }).first();
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      ctx.body = {
        code: 0,
        msg: 'ok',
        data: {
          resource: {
            id: row.id,
            kind: row.kind,
            ownerMemberId: row.owner_member_id,
            ...(row.scope ? { scope: row.scope } : {}),
            metadata: meta,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        },
      };
    } catch (err) {
      if (policyFailure(ctx, err)) return;
      ctx.logger.error('[hdw] resource create error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Update: PUT /api/workspaces/:ws/resources/:resourceId ----
  // Direct update of metadata (and optionally scope) on an existing
  // resource. Returns {code, msg, data} envelope.
  async update() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body || {};
    const metadata = body.metadata || null;

    // Always constrain resource mutations to the workspace authorized by the
    // HTTP access guard. Never update a resource by ID alone.
    if (!workspaceId) {
      ctx.status = 400;
      ctx.body = { code: -1, msg: 'workspaceId is required' };
      return;
    }
    if (!metadata) {
      ctx.body = { code: -1, msg: 'metadata is required' };
      return;
    }

    try {
      const k = this.getKnex();
      const updated = await k.transaction(async trx => {
        const row = await trx('resources')
          .where({ id: resourceId, workspace_id: workspaceId })
          .whereNull('deleted_at').forUpdate().first();
        if (!row) return 0;
        await validateResourceIdentity(trx, row.kind, resourceId, metadata, {
          workspaceId, ownerMemberId: row.owner_member_id,
        });
        const updateFields = { metadata: JSON.stringify(metadata) };
        if (Object.prototype.hasOwnProperty.call(body, 'scope')) {
          updateFields.scope = body.scope || null;
        }
        const affected = await trx('resources')
          .where({ id: resourceId, workspace_id: workspaceId })
          .whereNull('deleted_at').update(updateFields);
        if (affected > 0) await syncResourceNameRegistry(trx, row.kind, resourceId, metadata);
        return affected;
      });

      if (updated === 0) {
        ctx.body = { code: -1, msg: 'resource not found' };
        return;
      }

      const row = await k('resources').where({ id: resourceId, workspace_id: workspaceId }).first();
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      ctx.body = {
        code: 0,
        msg: 'ok',
        data: {
          resource: {
            id: row.id,
            kind: row.kind,
            ownerMemberId: row.owner_member_id,
            ...(row.scope ? { scope: row.scope } : {}),
            metadata: meta,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        },
      };
    } catch (err) {
      if (policyFailure(ctx, err)) return;
      ctx.logger.error('[hdw] resource update error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Show: GET /api/workspaces/:ws/resources/:resourceId ----
  // Fetch a single resource by ID. Does NOT filter by owner_member_id —
  // any non-deleted resource in the workspace is returned. Used by the
  // daemon's install/uninstall flows that resolve a resourceId
  // regardless of who published it. Returns the resource object directly
  // (not wrapped in { resource }) to match HdwCloudClient parsing.
  async show() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const resourceId = ctx.params.resourceId;

    if (!resourceId) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'resourceId is required' };
      return;
    }

    try {
      const k = this.getKnex();
      const row = await k('resources as r')
        .leftJoin('resource_refs as rr', function () {
          this.on('rr.resource_id', 'r.id').andOn('rr.ref', '=', k.raw('?', ['published']));
        })
        .leftJoin('resource_versions as rv', 'rv.id', 'rr.version_id')
        .leftJoin('workspace_members as wm', function () {
          this.on('wm.workspace_member_id', 'r.owner_member_id')
            .andOn('wm.workspace_id', 'r.workspace_id');
        })
        .where('r.workspace_id', workspaceId)
        .whereNull('r.deleted_at')
        .where('r.id', resourceId)
        .select(
          'r.id',
          'r.kind',
          'r.owner_member_id as owner_member_id',
          'r.metadata',
          'r.scope',
          'r.created_at',
          'r.updated_at',
          'rv.version',
          'rv.id as version_id',
          'wm.displayname as owner_displayname',
        )
        .first();

      if (!row) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'resource not found' };
        return;
      }

      ctx.body = {
        id: row.id,
        kind: row.kind,
        ownerMemberId: row.owner_member_id,
        ownerDisplayName: row.owner_displayname || null,
        ...(row.scope ? { scope: row.scope } : {}),
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        version: row.version || null,
        versionId: row.version_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      ctx.logger.error('[hdw] show resource error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- List: GET /api/workspaces/:ws/resources?kind=skill ----
  async list() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const kind = ctx.query.kind || undefined;
    const ownerMemberId = ctx.query.owner_member_id || undefined;
    const scope = ctx.query.scope || undefined;

    try {
      const k = this.getKnex();
      let q = k('resources as r')
        .leftJoin('resource_refs as rr', function () {
          this.on('rr.resource_id', 'r.id').andOn('rr.ref', '=', k.raw('?', ['published']));
        })
        .leftJoin('resource_versions as rv', 'rv.id', 'rr.version_id')
        .leftJoin('workspace_members as wm', function () {
          this.on('wm.workspace_member_id', 'r.owner_member_id')
            .andOn('wm.workspace_id', 'r.workspace_id');
        })
        .where('r.workspace_id', workspaceId)
        .whereNull('r.deleted_at')
        .select(
          'r.id',
          'r.kind',
          'r.owner_member_id as owner_member_id',
          'r.metadata',
          'r.scope',
          'r.created_at',
          'r.updated_at',
          'rv.version',
          'rv.id as version_id',
          'wm.displayname as owner_displayname',
        )
        .orderBy('r.updated_at', 'desc');

      if (kind) {
        q = q.where('r.kind', kind);
      }
      if (ownerMemberId) {
        q = q.where('r.owner_member_id', ownerMemberId);
      }
      if (scope) {
        q = q.where('r.scope', scope);
      } else {
        q = q.whereNull('r.scope');
      }

      const rows = await q;

      const statRows = rows.length > 0
        ? await k('community_resource_stats')
          .whereIn([ 'resource_type', 'resource_id' ], rows.map(row => [ row.kind, row.id ]))
        : [];
      const statsByKey = new Map(statRows.map(row => [ `${row.resource_type}\u0000${row.resource_id}`, row ]));

      const resources = rows.map(row => ({
        id: row.id,
        kind: row.kind,
        ownerMemberId: row.owner_member_id,
        ownerDisplayName: row.owner_displayname || null,
        ...(row.scope ? { scope: row.scope } : {}),
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        version: row.version || null,
        versionId: row.version_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stats: (() => {
          const stat = statsByKey.get(`${row.kind}\u0000${row.id}`);
          return {
            previewCount: Number(stat?.preview_count || 0),
            previewUserCount: Number(stat?.preview_user_count || 0),
            actionCount: Number(stat?.action_count || 0),
            actionUserCount: Number(stat?.action_user_count || 0),
          };
        })(),
      }));

      ctx.body = { resources };
    } catch (err) {
      ctx.logger.error('[hdw] list resources error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }
  // ---- Check: GET /api/workspaces/:ws/resources/check?kind=...&name=... ----
  // Returns { exists: boolean } so the daemon can reject duplicates
  // before creating a resource. Works for both skill and mcp kinds:
  // skills store the name in metadata.title, mcp in metadata.label.
  async check() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const kind = ctx.query.kind || '';
    const name = (ctx.query.name || '').normalize('NFKC').trim().toLocaleLowerCase('en');

    if (!workspaceId || !kind || !name) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'workspaceId, kind and name are required' };
      return;
    }

    try {
      const k = this.getKnex();
      await assertRegistryReady(k);
      const exists = Boolean(await k('resource_name_registry')
        .where({ kind, normalized_name: name }).first());

      ctx.body = { exists };
    } catch (err) {
      if (policyFailure(ctx, err)) return;
      ctx.logger.error('[hdw] resource check error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Helpers ----

  async _nextVersionNumber(resourceId) {
    const k = this.getKnex();
    const row = await k('resource_versions')
      .where({ resource_id: resourceId })
      .max('version as max_version')
      .first();
    return (row.max_version || 0) + 1;
  }

  async _commitVersion(resourceId, workspaceId, version, manifestDigest, entries, ref) {
    const k = this.getKnex();
    const versionId = crypto.randomUUID();

    await k.transaction(async trx => {
      // Create the version row.
      await trx('resource_versions').insert({
        id: versionId,
        resource_id: resourceId,
        manifest_digest: manifestDigest,
        version,
      });

      // Link each blob to the version.
      const blobRows = entries.map(e => ({ version_id: versionId, digest: e.digest }));
      if (blobRows.length > 0) {
        // Insert ignore for duplicates
        for (const row of blobRows) {
          await trx('resource_version_blobs')
            .insert(row)
            .onConflict()
            .ignore();
        }
      }

      // Advance the ref (upsert).
      await trx('resource_refs')
        .insert({ resource_id: resourceId, ref, version_id: versionId })
        .onConflict(['resource_id', 'ref'])
        .merge({ version_id: versionId });

      // Clean up any pending upload for this resource.
      await trx('pending_version_uploads')
        .where({ resource_id: resourceId })
        .del();
    });

    return versionId;
  }
}

module.exports = ResourceController;
