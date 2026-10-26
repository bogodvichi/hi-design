'use strict';

const { createKnex } = require('../../utils/knex.js');
const crypto = require('node:crypto');

const Controller = require('egg').Controller;

// Team project catalog endpoints: list, get, upsert, remove, transfer.
//
// Cross-workspace transfer is a metadata operation:
//   1. Create a new resource row in the target workspace pointing at the
//      same manifest_digest (blobs never move).
//   2. Copy the resource_refs to point the new resource at the same version.
//   3. Create a new team_projects row in the target workspace.
//   4. Soft-delete the source resource and remove the source catalog entry.
//   5. Log the transfer in project_transfers.
//
// Response format: raw JSON to match the daemon's HdwCloudClient.
// The transfer resolves the TARGET workspace's member ID for the source
// owner from the authenticated account's actual target workspace_members row.
// This ensures the target resource and team_project rows bind
// to the correct member identity in the target workspace, not the source
// workspace's member ID.

class TeamProjectController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- List: GET /api/workspaces/:ws/team-projects ----
  async list() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    // 可选 folder_id 过滤:
    //   不传          → 全部项目
    //   folder_id=xxx → 该文件夹下的项目
    //   folder_id=root → 根目录项目 (folder_id IS NULL)
    const folderFilter = ctx.query.folder_id;

    try {
      const k = this.getKnex();
      const query = k('team_projects as tp')
        .join('resources as r', 'r.id', 'tp.resource_id')
        .leftJoin('workspace_members as wm', function() {
          this.on('wm.workspace_member_id', 'tp.owner_member_id')
            .andOn('wm.workspace_id', 'tp.workspace_id');
        })
        .where({ 'tp.workspace_id': workspaceId })
        .select('tp.*', 'r.metadata as resource_metadata', 'wm.displayname as owner_displayname')
        .orderBy('tp.updated_at', 'desc');
      if (ctx.state.personalOwnerMemberId) query.where('tp.owner_member_id', ctx.state.personalOwnerMemberId);
      if (ctx.state.allowedProjectIds) query.whereIn('tp.project_id', ctx.state.allowedProjectIds);
      if (folderFilter === 'root') {
        query.whereNull('tp.folder_id');
      } else if (folderFilter) {
        query.where({ 'tp.folder_id': folderFilter });
      }
      const rows = await query;

      const projects = rows.map(row => this._toRecord(row));
      ctx.body = { projects };
    } catch (err) {
      ctx.logger.error('[hdw] list team projects error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Get: GET /api/workspaces/:ws/team-projects/:projectId ----
  async get() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const projectId = ctx.params.projectId;

    try {
      const k = this.getKnex();
      const row = await k('team_projects as tp')
        .join('resources as r', 'r.id', 'tp.resource_id')
        .leftJoin('workspace_members as wm', function() {
          this.on('wm.workspace_member_id', 'tp.owner_member_id')
            .andOn('wm.workspace_id', 'tp.workspace_id');
        })
        .where({ 'tp.workspace_id': workspaceId, 'tp.project_id': projectId })
        .select('tp.*', 'r.metadata as resource_metadata', 'wm.displayname as owner_displayname')
        .first();

      if (!row) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Team project not found' };
        return;
      }

      ctx.body = this._toRecord(row);
    } catch (err) {
      ctx.logger.error('[hdw] get team project error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Upsert: PUT /api/workspaces/:ws/team-projects/:projectId ----
  async upsert() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const projectId = ctx.params.projectId;
    const body = ctx.request.body;

    if (!body || !body.resourceId) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'resourceId is required' };
      return;
    }

    try {
      const k = this.getKnex();

      const existing = await k('team_projects').where({ workspace_id: workspaceId, project_id: projectId }).first();
      if (existing) {
        if (body.ownerMemberId && body.ownerMemberId !== existing.owner_member_id) {
          ctx.status = 409;
          ctx.body = { error: 'team_project_owner_conflict' };
          return;
        }
        // Older clients recompute the ID after transfers. Keep the durable
        // resource reference and owner already stored by the transaction.
        body.resourceId = existing.resource_id;
        body.ownerMemberId = existing.owner_member_id;
      }
      const resource = await k('resources').where({ id: body.resourceId }).first();
      if (resource && (resource.deleted_at || resource.workspace_id !== workspaceId || resource.owner_member_id !== body.ownerMemberId)) {
        ctx.status = 409;
        ctx.body = { error: 'resource_owner_conflict' };
        return;
      }

      // Ensure the resource exists (upsert with 'project' kind if new).
      const ownerMemberId = body.ownerMemberId || (body.metadata && body.metadata.ownerMemberId) || 'system';
      await k('resources')
        .insert({
          id: body.resourceId,
          workspace_id: workspaceId,
          kind: 'project',
          owner_member_id: ownerMemberId,
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        })
        .onConflict('id')
        .merge({
          deleted_at: null,
          ...(body.metadata ? { metadata: JSON.stringify(body.metadata) } : {}),
        });

      const id = crypto.randomUUID();
      const mergeObj = {
        resource_id: body.resourceId,
      };
      if (body.displayName !== undefined) mergeObj.display_name = body.displayName;
      if (body.syncState) mergeObj.sync_state = body.syncState;
      if (body.lastSyncedVersionId !== undefined) mergeObj.last_synced_version_id = body.lastSyncedVersionId;
      if (body.metadata) mergeObj.metadata = JSON.stringify(body.metadata);
      if (body.folderId !== undefined) mergeObj.folder_id = body.folderId;
      if (body.coverDigest !== undefined) mergeObj.cover_digest = body.coverDigest;

      const row = await k('team_projects')
        .insert({
          id,
          workspace_id: workspaceId,
          project_id: projectId,
          resource_id: body.resourceId,
          owner_member_id: ownerMemberId,
          display_name: body.displayName || null,
          cover_digest: body.coverDigest || null,
          sync_state: body.syncState || 'pending_upload',
          last_synced_version_id: body.lastSyncedVersionId || null,
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          folder_id: body.folderId !== undefined ? body.folderId : null,
        })
        .onConflict(['workspace_id', 'project_id'])
        .merge(mergeObj)
        .returning('*');

      // Auto-populate lastSyncedVersionId from the resource's published
      // version when the caller did not provide one. Critical for the
      // share flow: the project already has a published version in HDW,
      // but the share upsert does not pass lastSyncedVersionId.
      const inserted = row[0];
      if (!inserted.last_synced_version_id) {
        const pubVersion = await k('resource_refs as rr')
          .join('resource_versions as rv', 'rv.id', 'rr.version_id')
          .where({ 'rr.resource_id': body.resourceId, 'rr.ref': 'published' })
          .select('rv.id as version_id')
          .first();
        if (pubVersion) {
          await k('team_projects')
            .where({ id: inserted.id })
            .update({ last_synced_version_id: pubVersion.version_id });
          inserted.last_synced_version_id = pubVersion.version_id;
        }
      }

      ctx.body = this._toRecord(inserted);
    } catch (err) {
      ctx.logger.error('[hdw] upsert team project error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Remove: DELETE /api/workspaces/:ws/team-projects/:projectId ----
  async remove() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const projectId = ctx.params.projectId;

    try {
      const k = this.getKnex();
      const deleted = await k('team_projects')
        .where({ workspace_id: workspaceId, project_id: projectId })
        .del();

      if (deleted === 0) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Team project not found' };
        return;
      }

      ctx.status = 204;
      ctx.body = null;
    } catch (err) {
      ctx.logger.error('[hdw] remove team project error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Transfer: POST /api/workspaces/:ws/team-projects/:projectId/transfer ----
  async transfer() {
    const { ctx } = this;
    const sourceWorkspaceId = ctx.params.workspaceId;
    const projectId = ctx.params.projectId;
    const body = ctx.request.body || {};

    if (!body.targetWorkspaceId) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'targetWorkspaceId is required' };
      return;
    }

    const targetWorkspaceId = body.targetWorkspaceId;
    if (targetWorkspaceId === sourceWorkspaceId) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'Source and target workspace must differ' };
      return;
    }

    try {
      await this.getKnex().transaction(async k => {
      await k.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [projectId]);

      // Find the source team project + its resource + current published version.
      const source = await k('team_projects as tp')
        .join('resources as r', 'r.id', 'tp.resource_id')
        .where({ 'tp.workspace_id': sourceWorkspaceId, 'tp.project_id': projectId })
        .select(
          'tp.id', 'tp.resource_id', 'tp.owner_member_id', 'tp.display_name',
          'tp.sync_state', 'tp.last_synced_version_id', 'tp.metadata', 'tp.cover_digest',
          'r.kind', 'r.metadata as resource_metadata'
        )
        .first();

      if (!source) {
        const previous = await k('project_transfers')
          .where({ project_id: projectId, source_workspace_id: sourceWorkspaceId, target_workspace_id: targetWorkspaceId })
          .orderBy('transferred_at', 'desc').first();
        if (previous) {
          const target = await k('team_projects').where({ workspace_id: targetWorkspaceId, project_id: projectId, resource_id: previous.target_resource_id }).first();
          const current = target && await k('resource_versions').where({ id: target.last_synced_version_id }).first();
          if (current) {
            ctx.body = { resourceId: target.resource_id, workspaceId: targetWorkspaceId,
              version: current.version, versionId: current.id, targetOwnerMemberId: target.owner_member_id };
            return;
          }
        }
        ctx.status = 404;
        ctx.body = { error: 'source_not_published', message: 'Source team project has not been published' };
        return;
      }

      // Get the published version + manifest digest.
      const version = await k('resource_refs as rr')
        .join('resource_versions as rv', 'rv.id', 'rr.version_id')
        .where({ 'rr.resource_id': source.resource_id, 'rr.ref': 'published' })
        .select('rv.id as version_id', 'rv.version', 'rv.manifest_digest')
        .first();

      if (!version) {
        ctx.status = 409;
        ctx.body = { error: 'no_published_version', message: 'Source resource has no published version' };
        return;
      }

      const targetResourceId = `project-transfer-${crypto.randomUUID()}`;
      const targetMember = await k('workspace_members').where({
        workspace_id: targetWorkspaceId, username: ctx.state.user.username,
      }).first();
      if (!targetMember || !['owner', 'admin', 'member'].includes(targetMember.role)
        || (body.targetOwnerMemberId && body.targetOwnerMemberId !== targetMember.workspace_member_id)) {
        ctx.status = 403;
        ctx.body = { error: 'target_workspace_access_denied' };
        return;
      }
      const targetOwnerMemberId = targetMember.workspace_member_id;

      // Run the transfer in a transaction. The transaction returns the
      // targetVersionId so we can include it in the response.
      const committedVersionId = await k.transaction(async trx => {
        // 1. Create target resource.
        await trx('resources').insert({
          id: targetResourceId,
          workspace_id: targetWorkspaceId,
          kind: source.kind,
          owner_member_id: targetOwnerMemberId,
          metadata: source.resource_metadata,
        });

        // 2. Create target version (same manifest_digest, same version number).
        const targetVersionId = crypto.randomUUID();
        await trx('resource_versions').insert({
          id: targetVersionId,
          resource_id: targetResourceId,
          manifest_digest: version.manifest_digest,
          version: version.version,
        });

        // 3. Copy version blobs.
        const versionBlobs = await trx('resource_version_blobs')
          .where({ version_id: version.version_id })
          .select('digest');
        for (const row of versionBlobs) {
          await trx('resource_version_blobs')
            .insert({ version_id: targetVersionId, digest: row.digest })
            .onConflict()
            .ignore();
        }

        // 4. Set the published ref on the target resource.
        await trx('resource_refs').insert({
          resource_id: targetResourceId,
          ref: 'published',
          version_id: targetVersionId,
        });

        // 5. Ensure blobs are referenced by the target workspace.
        await trx('workspace_blob_refs')
          .insert({ workspace_id: targetWorkspaceId, digest: version.manifest_digest })
          .onConflict()
          .ignore();
        for (const row of versionBlobs) {
          await trx('workspace_blob_refs')
            .insert({ workspace_id: targetWorkspaceId, digest: row.digest })
            .onConflict()
            .ignore();
        }

        // 6. Create target team project entry.
        await trx('team_projects').insert({
          id: crypto.randomUUID(),
          workspace_id: targetWorkspaceId,
          project_id: projectId,
          resource_id: targetResourceId,
          owner_member_id: targetOwnerMemberId,
          display_name: source.display_name,
          cover_digest: source.cover_digest,
          sync_state: 'synced',
          last_synced_version_id: targetVersionId,
          metadata: source.metadata,
        });

        // 7. Soft-delete source resource.
        await trx('resources')
          .where({ id: source.resource_id })
          .update({ deleted_at: new Date() });

        // 8. Remove source team project entry.
        await trx('team_projects')
          .where({ id: source.id })
          .del();

        // Shares follow the same project; ownership is not transferred to recipients.
        await trx('workspace_project_shares').where({ project_id: projectId, home_workspace_id: sourceWorkspaceId })
          .update({ home_workspace_id: targetWorkspaceId });

        // 9. Log the transfer.
        await trx('project_transfers').insert({
          id: crypto.randomUUID(),
          project_id: projectId,
          source_workspace_id: sourceWorkspaceId,
          target_workspace_id: targetWorkspaceId,
          source_resource_id: source.resource_id,
          target_resource_id: targetResourceId,
          version_id: targetVersionId,
          transferred_by: source.owner_member_id,
        });

        return targetVersionId;
      });

      ctx.body = {
        resourceId: targetResourceId,
        workspaceId: targetWorkspaceId,
        version: version.version,
        versionId: committedVersionId,
        targetOwnerMemberId,
      };
      });
    } catch (err) {
      ctx.logger.error('[hdw] transfer error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Helpers ----

  _toRecord(row) {
    const access = {
      canView: true,
      canComment: true,
      canEdit: false,
      frozen: false,
    };
    let metadata = row.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { /* keep string */ }
    }
    // Also merge resource_metadata if present
    if (row.resource_metadata) {
      let resMeta = row.resource_metadata;
      if (typeof resMeta === 'string') {
        try { resMeta = JSON.parse(resMeta); } catch { /* keep */ }
      }
      if (metadata && typeof metadata === 'object' && resMeta && typeof resMeta === 'object') {
        metadata = { ...resMeta, ...metadata };
      } else if (resMeta && typeof resMeta === 'object') {
        metadata = metadata || resMeta;
      }
    }
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      resourceId: row.resource_id,
      ownerMemberId: row.owner_member_id,
      displayName: row.display_name || null,
      ownerDisplayName: row.owner_displayname || null,
      coverDigest: row.cover_digest || null,
      syncState: row.sync_state,
      lastSyncedVersionId: row.last_synced_version_id || null,
      folderId: row.folder_id || null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      access,
      metadata: metadata || null,
    };
  }
}

module.exports = TeamProjectController;
