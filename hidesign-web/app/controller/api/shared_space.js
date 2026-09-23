'use strict';

const { createKnex } = require('../../utils/knex.js');
const {
  createTeamId,
  getTeamMemberId,
  getSharedSpaceTeamId,
  getSharedSpaceMemberId,
  getCollaboratorMemberId,
} = require('../../utils/ids.js');

const Controller = require('egg').Controller;

// Shared Space: a special global team where every logged-in user is
// automatically a member (role: 'member'). Projects are NOT copied --
// instead, a "reference" row in workspace_project_shares projects them
// onto the shared space for specific recipients.
//
// Key rules:
//   1. Reference mode: project stays in its home workspace.
//   2. Owner exclusion: sharer cannot see their own shared projects.
//   3. Recipient-scoped: each share targets specific recipients.
//   4. Cross-team stable IDs: uses shared-space member IDs.
//   5. Comments stay on the project (keyed by project_id).

class SharedSpaceController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- Share projects to the shared space ----
 // POST /hdw/api/shared-space/share
 // body: { project_id, home_workspace_id, created_by_username, created_by_displayname?, recipients: [{username, displayname?}] }
 async share() {
   const { ctx } = this;
   const {
     project_id: projectId,
     home_workspace_id: homeWorkspaceId,
     created_by_username: createdByUsername,
     created_by_displayname: createdByDisplayname,
    recipients = [],
    metadata: projectMetadata,
    coverDigest,
  } = ctx.request.body;

    if (!projectId || !homeWorkspaceId || !createdByUsername) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 project_id, home_workspace_id 或 created_by_username' };
      return;
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 recipients (至少选择一名成员)' };
      return;
    }

    try {
      const k = this.getKnex();
      // Update the team_projects row's cover_digest in the home workspace
      // so the shared project card shows the entry screenshot.
      if (coverDigest) {
        await k('team_projects')
          .where({ workspace_id: homeWorkspaceId, project_id: projectId })
          .update({ cover_digest: coverDigest });
      }
      const sharedSpaceId = getSharedSpaceTeamId();
     const createdByMemberId = getSharedSpaceMemberId(createdByUsername);
     const now = new Date();

     // Deduplicate recipients by username and exclude the sharer themselves
     const seen = new Set();
     const rows = [];
     for (const r of recipients) {
       if (!r.username || seen.has(r.username)) continue;
       seen.add(r.username);
       // Sharer cannot share to themselves (owner exclusion rule)
       if (r.username === createdByUsername) continue;
       rows.push({
         id: `${sharedSpaceId}_${projectId}_${r.username}`,
         project_id: projectId,
         home_workspace_id: homeWorkspaceId,
         shared_space_id: sharedSpaceId,
         recipient_member_id: getSharedSpaceMemberId(r.username),
         recipient_username: r.username,
         created_by_member_id: createdByMemberId,
         created_by_username: createdByUsername,
         created_by_displayname: createdByDisplayname || null,
         created_at: now,
       });
     }

      if (rows.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '没有需要新增的分享 (接收人列表为空或全是自己)' };
        return;
      }

      // Insert with onConflict merge so re-sharing to the same person is idempotent
      await k('workspace_project_shares')
        .insert(rows)
        .onConflict('id')
       .merge({
         created_by_member_id: createdByMemberId,
         created_by_username: createdByUsername,
         created_by_displayname: createdByDisplayname || null,
         created_at: now,
       });

      ctx.body = {
         code: 0,
         msg: 'SUCCESS',
         data: {
           shared: rows.length,
          skipped: recipients.length - rows.length,
          shared_space_id: sharedSpaceId,
        },
      };
    } catch (err) {
      ctx.logger.error('SharedSpace share error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Batch-share projects to the shared space (folder sharing) ----
  // POST /hdw/api/shared-space/share-batch
  // body: { home_workspace_id, created_by_username, created_by_member_id?, created_by_displayname?,
  //         recipients: [{ username, displayname?, recipient_member_id? }],
  //         items: [{ project_id, folder_id }] }
  // Returns { shared, skipped } where shared counts inserted/merged rows
  // and skipped counts items dropped to dedup or owner self-exclusion.
  async shareBatch() {
    const { ctx } = this;
    const {
      home_workspace_id: homeWorkspaceId,
      created_by_username: createdByUsername,
      created_by_member_id: createdByMemberIdInput,
      created_by_displayname: createdByDisplayname,
      recipients = [],
      items = [],
    } = ctx.request.body;

    if (!homeWorkspaceId || !createdByUsername) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 home_workspace_id 或 created_by_username' };
      return;
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 recipients (至少选择一名成员)' };
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 items (至少一个项目)' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const createdByMemberId = createdByMemberIdInput || getSharedSpaceMemberId(createdByUsername);
      const now = new Date();

      // Deduplicate recipients by username, exclude the sharer themselves
      const seenRecipients = new Set();
      const validRecipients = [];
      for (const r of recipients) {
        if (!r.username || seenRecipients.has(r.username)) continue;
        seenRecipients.add(r.username);
        if (r.username === createdByUsername) continue;
        validRecipients.push(r);
      }

      if (validRecipients.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '没有有效的接收人 (列表为空或全是自己)' };
        return;
      }

      // Deduplicate items by project_id (a project shared once per recipient)
      const seenItems = new Set();
      const validItems = [];
      for (const item of items) {
        if (!item.project_id || seenItems.has(item.project_id)) continue;
        seenItems.add(item.project_id);
        validItems.push(item);
      }

      // Build share rows: items × recipients
      const rows = [];
      for (const item of validItems) {
        for (const r of validRecipients) {
          rows.push({
            id: `${sharedSpaceId}_${item.project_id}_${r.username}`,
            project_id: item.project_id,
            home_workspace_id: homeWorkspaceId,
            shared_space_id: sharedSpaceId,
            recipient_member_id: r.recipient_member_id || getSharedSpaceMemberId(r.username),
            recipient_username: r.username,
            created_by_member_id: createdByMemberId,
            created_by_username: createdByUsername,
            created_by_displayname: createdByDisplayname || null,
            folder_id: item.folder_id || null,
            created_at: now,
          });
        }
      }

      // Insert with onConflict merge — re-sharing is idempotent.
      // Column-list merge (not fixed-value) because folder_id varies per row.
      await k('workspace_project_shares')
        .insert(rows)
        .onConflict('id')
        .merge([
          'created_by_member_id',
          'created_by_username',
          'created_by_displayname',
          'folder_id',
          'created_at',
        
        ]);

      // Also update team_projects.folder_id so the folder list query
      // (project_count, subfolder_preview) can locate projects by folder.
      for (const item of validItems) {
        if (item.folder_id) {
          await k('team_projects')
            .where({ workspace_id: homeWorkspaceId, project_id: item.project_id })
            .update({ folder_id: item.folder_id });
        }
      }

      const totalInput = items.length * recipients.length;
      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          shared: rows.length,
          skipped: totalInput - rows.length,
          shared_space_id: sharedSpaceId,
        },
      };
    } catch (err) {
      ctx.logger.error('SharedSpace shareBatch error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- List projects shared TO me ----
  // GET /hdw/api/shared-space/shared-with-me?username=xxx
 async sharedWithMe() {
   const { ctx } = this;
  const username = ctx.query.username;

    if (!username) {
     ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
     return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const recipientMemberId = getSharedSpaceMemberId(username);

      // Query shares targeted to this user, then join team_projects + resources
      // to get the actual project metadata from the home workspace.
     const shares = await k('workspace_project_shares as s')
       .where({
         's.shared_space_id': sharedSpaceId,
         's.recipient_member_id': recipientMemberId,
       })
      .select(
        's.id as share_id',
        's.project_id',
        's.home_workspace_id',
        's.created_by_username as shared_by_username',
        's.created_by_displayname as shared_by_displayname',
        's.created_at as shared_at',
        's.folder_id as share_folder_id',
      )
       .orderBy('s.created_at', 'desc');
      const projects = [];
      for (const s of shares) {
        try {
          const tp = await k('team_projects as tp')
            .join('resources as r', 'r.id', 'tp.resource_id')
            .where({
              'tp.workspace_id': s.home_workspace_id,
              'tp.project_id': s.project_id,
            })
            .select(
              'tp.id as catalog_id',
              'tp.resource_id',
              'tp.owner_member_id',
              'tp.display_name',
              'tp.sync_state',
              'tp.folder_id',
              'tp.metadata',
              'tp.last_synced_version_id',
              'tp.cover_digest',
              'r.metadata as resource_metadata',
            )
            .first();

          let metadata = tp?.metadata;
          if (typeof metadata === 'string') {
            try { metadata = JSON.parse(metadata); } catch { /* keep string */ }
          }
          let resMeta = tp?.resource_metadata;
          if (typeof resMeta === 'string') {
            try { resMeta = JSON.parse(resMeta); } catch { /* keep */ }
          }
          if (metadata && typeof metadata === 'object' && resMeta && typeof resMeta === 'object') {
            metadata = { ...resMeta, ...metadata };
          } else if (resMeta && typeof resMeta === 'object') {
            metadata = metadata || resMeta;
          }

          projects.push({
            shareId: s.share_id,
            projectId: s.project_id,
            homeWorkspaceId: s.home_workspace_id,
           sharedByUsername: s.shared_by_username,
           sharedByDisplayname: s.shared_by_displayname || null,
           sharedAt: s.shared_at instanceof Date ? s.shared_at.toISOString() : String(s.shared_at),
            resourceId: tp?.resource_id || null,
            ownerMemberId: tp?.owner_member_id || null,
            displayName: tp?.display_name || null,
           syncState: tp?.sync_state || 'unknown',
            folderId: tp?.folder_id || s.share_folder_id || null,
           lastSyncedVersionId: tp?.last_synced_version_id || null,
            coverDigest: tp?.cover_digest || null,
            metadata: metadata || null,
            access: {
              canView: true,
              canComment: true,
              canEdit: false,
              frozen: false,
            },
          });
        } catch {
          // Skip projects whose home workspace is unreachable
        }
      }

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { projects },
      };
    } catch (err) {
      ctx.logger.error('SharedSpace sharedWithMe error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- List projects I shared TO others ----
  // GET /hdw/api/shared-space/shared-by-me?username=xxx
  async sharedByMe() {
    const { ctx } = this;
    const username = ctx.query.username;

    if (!username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const creatorMemberId = getSharedSpaceMemberId(username);

      const shares = await k('workspace_project_shares')
        .where({
          shared_space_id: sharedSpaceId,
          created_by_member_id: creatorMemberId,
        })
        .select(
          'id as share_id',
          'project_id',
          'home_workspace_id',
          'recipient_username',
          'recipient_member_id',
          'created_at as shared_at',
        )
        .orderBy('created_at', 'desc');

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { shares },
      };
    } catch (err) {
      ctx.logger.error('SharedSpace sharedByMe error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Unshare a project from a specific recipient ----
  // DELETE /hdw/api/shared-space/:share_id
  async unshare() {
    const { ctx } = this;
    const { share_id: shareId } = ctx.params;

    if (!shareId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 share_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const deleted = await k('workspace_project_shares')
        .where({ id: shareId })
        .del();

      if (deleted === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '分享记录不存在' };
        return;
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('SharedSpace unshare error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Remove all shares for a project (called when project is deleted) ----
  // DELETE /hdw/api/shared-space/project/:project_id
  async unshareProject() {
    const { ctx } = this;
    const { project_id: projectId } = ctx.params;

    if (!projectId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 project_id' };
      return;
    }

    try {
      const k = this.getKnex();
      await k('workspace_project_shares')
        .where({ project_id: projectId })
        .del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('SharedSpace unshareProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Get the shared space team info ----
  // GET /hdw/api/shared-space/info?username=xxx
 async info() {
   const { ctx } = this;
  const username = ctx.query.username;
  const displayname = ctx.query.displayname || null;
  const email = ctx.query.email || null;

    if (!username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const memberId = getSharedSpaceMemberId(username);
      const collaboratorId = getCollaboratorMemberId(username);

      // Idempotently ensure the shared space team exists.
      // Using onConflict().ignore() eliminates the check-then-insert race
      // condition where two concurrent requests both see "not exists" and
      // both try to INSERT, causing a duplicate-key or concurrent-operation
      // error from PostgreSQL.
      const now = new Date();
      await k('workspaces')
        .insert({
          workspace_id: sharedSpaceId,
          workspace_name: '共享空间',
          owner_username: 'system',
          owner_displayname: '系统大人',
          created_at: now,
          updated_at: now,
        })
        .onConflict('workspace_id')
        .ignore();

      // Idempotently ensure the system owner member exists.
      await k('workspace_members')
        .insert({
          workspace_id: sharedSpaceId,
          workspace_member_id: getSharedSpaceMemberId('system'),
          username: 'system',
          displayname: '系统大人',
          email: null,
          role: 'owner',
          created_at: now,
          updated_at: now,
        })
        .onConflict(['workspace_id', 'workspace_member_id'])
        .ignore();

      // Idempotently ensure the current user is a member of the shared space.
      // Use onConflict().merge() so subsequent calls update displayname/email
      // without clobbering existing non-null values.
      const memberMerge = {};
      if (displayname) memberMerge.displayname = displayname;
      if (email) memberMerge.email = email;
      memberMerge.updated_at = now;
      await k('workspace_members')
        .insert({
          workspace_id: sharedSpaceId,
          workspace_member_id: memberId,
          username,
          displayname,
          email,
          role: 'member',
          created_at: now,
          updated_at: now,
        })
        .onConflict(['workspace_id', 'workspace_member_id'])
        .merge(memberMerge);

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          workspace_id: sharedSpaceId,
         workspace_name: '共享空间',
         workspace_type: 'team',
         workspace_member_id: memberId,
          collaborator_member_id: collaboratorId,
          role: 'member',
        },
      };
    } catch (err) {
      ctx.logger.error('SharedSpace info error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }
}

module.exports = SharedSpaceController;
