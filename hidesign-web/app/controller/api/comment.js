'use strict';

const { createKnex } = require('../../utils/knex.js');
const Controller = require('egg').Controller;

const VALID_ROLES = new Set(['owner', 'admin', 'member', 'guest']);
const VALID_STATUSES = new Set(['open', 'resolved', 'archived']);

function parseJsonb(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return undefined; }
  }
  return undefined;
}

class CommentController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // PUT /teams/:teamId/members/:memberId
  // Idempotently updates the member's display name and role. A non-empty
  // displayName from the daemon only repairs rows whose value is empty/null
  // or still equals the memberId fallback from an older build; it never
  // overwrites a real name set during team invite.
  // The member must already exist in workspace_members (created via team
  // invite flow) because username and workspace_name are NOT NULL columns
  // we don't have values for from the daemon's request body.
  // Only updates displayname when the existing value is empty/null or still
  // holds a member-id fallback, so a later request with the real SSO name can
  // repair the row without letting an id overwrite a real name from the team
  // invite flow.
  async registerMember() {
    const { ctx } = this;
    const { teamId, memberId } = ctx.params;
    const { displayName, role } = ctx.request.body || {};

    if (!VALID_ROLES.has(role)) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'a valid role is required' };
      return;
    }

    try {
      const k = this.getKnex();
      // Allow repair when the existing value is empty/null or still holds a
      // member-id fallback from an older daemon build. A real name from the
      // team invite flow is never overwritten.
      if (displayName && displayName.trim()) {
        const updated = await k('workspace_members')
          .where({ workspace_id: teamId, workspace_member_id: memberId })
          .where(function () {
            this.whereNull('displayname')
              .orWhere('displayname', '')
              .orWhere('displayname', memberId);
          })
          .update({ displayname: displayName.trim(), role, updated_at: new Date() });

        if (updated === 0) {
          // displayname was already set — do a role-only update so the
          // member still exists and the role stays in sync.
          const roleUpdated = await k('workspace_members')
            .where({ workspace_id: teamId, workspace_member_id: memberId })
            .update({ role, updated_at: new Date() });
          if (roleUpdated === 0) {
            ctx.status = 404;
            ctx.body = { error: 'member_not_found', message: 'Member not found in this team. Use team invite first.' };
            return;
          }
        }
      } else {
        const roleUpdated = await k('workspace_members')
          .where({ workspace_id: teamId, workspace_member_id: memberId })
          .update({ role, updated_at: new Date() });
        if (roleUpdated === 0) {
          ctx.status = 404;
          ctx.body = { error: 'member_not_found', message: 'Member not found in this team. Use team invite first.' };
          return;
        }
      }

      ctx.body = { member: { memberId, displayName: displayName ? displayName.trim() : null, role } };
    } catch (err) {
      ctx.logger.error('Comment registerMember error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // GET /teams/:teamId/members
  async listMembers() {
    const { ctx } = this;
    const { teamId } = ctx.params;

    try {
      const k = this.getKnex();
      const members = await k('workspace_members')
        .where({ workspace_id: teamId })
        .select('workspace_member_id', 'displayname', 'role')
        .orderBy('created_at', 'asc');

      ctx.body = {
        members: members.map(m => ({
          memberId: m.workspace_member_id,
          displayName: m.displayname || null,
          role: m.role,
        })),
      };
    } catch (err) {
      ctx.logger.error('Comment listMembers error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // POST /teams/:teamId/projects/:projectId/comments
  // Body: { comment: CollabCloudComment }
  // Returns: { seq: number }
  async pushComment() {
    const { ctx } = this;
    const { teamId, projectId } = ctx.params;
    const comment = ctx.request.body && ctx.request.body.comment;

    if (!comment || !comment.id) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'comment.id is required' };
      return;
    }

    // Validate/coerce field values (mirrors mergeSyncedPreviewComment in db.ts)
    const status = VALID_STATUSES.has(comment.status) ? comment.status : 'open';
    const selectionKind = comment.selectionKind === 'pod' ? 'pod'
      : comment.selectionKind === 'element' ? 'element' : null;
    const memberCount = Number.isFinite(comment.memberCount) ? Math.round(comment.memberCount) : null;
    const slideIndex = Number.isFinite(comment.slideIndex) ? Math.max(0, Math.round(comment.slideIndex)) : null;
    const anchoredVersion = Number.isFinite(comment.anchoredVersion) ? Math.max(0, Math.round(comment.anchoredVersion)) : null;
    const createdAt = Number.isFinite(comment.createdAt) ? comment.createdAt : Date.now();
    const updatedAt = Number.isFinite(comment.updatedAt) ? comment.updatedAt : Date.now();
    const deleted = Boolean(comment.deleted);
    const anchorState = typeof comment.anchorState === 'string' ? comment.anchorState : null;
    const position = JSON.stringify(comment.position || { x: 0, y: 0, width: 0, height: 0 });
    const style = comment.style ? JSON.stringify(comment.style) : null;
    const podMembers = comment.podMembers ? JSON.stringify(comment.podMembers) : null;
    const attachments = comment.attachments ? JSON.stringify(comment.attachments) : null;
    const lastGoodPosition = comment.lastGoodPosition ? JSON.stringify(comment.lastGoodPosition) : null;
    const parentId = typeof comment.parentId === 'string' && comment.parentId.trim()
      ? comment.parentId.trim()
      : null;
    const rootCommentId = typeof comment.rootCommentId === 'string' && comment.rootCommentId.trim()
      ? comment.rootCommentId.trim()
      : null;
    const displayName = typeof comment.displayName === 'string' && comment.displayName.trim()
      ? comment.displayName.trim()
      : null;

    try {
      const k = this.getKnex();
      // Prefer the pushed display name, but fall back to the member directory
      // when older daemon builds still omit it.
      let resolvedDisplayName = displayName;
      if (!resolvedDisplayName && typeof comment.memberId === 'string' && comment.memberId) {
        const member = await k('workspace_members')
          .where({ workspace_id: teamId, workspace_member_id: comment.memberId })
          .first('displayname');
        if (member && member.displayname) {
          resolvedDisplayName = member.displayname;
        }
      }
      const authorDisplayName = resolvedDisplayName || '';
      let resolvedRootCommentId = rootCommentId;
      if (parentId && !resolvedRootCommentId) {
        // Older daemon builds may send parentId without rootCommentId. Look up
        // the parent so the relay always stores a reusable thread root.
        const parent = await k('project_comments')
          .where({ team_id: teamId, project_id: projectId, id: parentId })
          .first('root_comment_id', 'parent_id', 'id');
        resolvedRootCommentId = parent
          ? (parent.root_comment_id || parent.parent_id || parent.id)
          : parentId;
      }
      // Use DEFAULT for seq so the column's BIGSERIAL default (nextval) runs
      // with the table owner's privileges, not the connecting user's. This
      // avoids needing USAGE on the sequence. ON CONFLICT DO UPDATE SET
      // seq = DEFAULT so edits also get a fresh seq for pull cursors.
      const result = await k.raw(
        `INSERT INTO project_comments (
          id, team_id, project_id, conversation_id, member_id,
            displayname,
            parent_id, root_comment_id,
            note, file_path, element_id, selector, label, text, html_hint,
            position, style, selection_kind, member_count, pod_members,
            slide_index, attachments, status, anchor_state, anchored_version,
            last_good_position, created_at, updated_at, deleted, seq
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?,
            ?::jsonb,
            ?::jsonb,
            ?,
            ?,
            ?::jsonb,
            ?,
            ?::jsonb,
            ?,
            ?,
            ?,
            ?::jsonb,
            ?,
            ?,
            ?,
            DEFAULT
          )
          ON CONFLICT (team_id, project_id, id) DO UPDATE SET
            conversation_id = EXCLUDED.conversation_id,
            member_id = EXCLUDED.member_id,
            displayname = EXCLUDED.displayname,
            note = EXCLUDED.note,
            file_path = EXCLUDED.file_path,
            element_id = EXCLUDED.element_id,
            selector = EXCLUDED.selector,
            label = EXCLUDED.label,
            text = EXCLUDED.text,
            html_hint = EXCLUDED.html_hint,
            position = EXCLUDED.position,
            style = EXCLUDED.style,
            selection_kind = EXCLUDED.selection_kind,
            member_count = EXCLUDED.member_count,
            pod_members = EXCLUDED.pod_members,
            slide_index = EXCLUDED.slide_index,
            attachments = EXCLUDED.attachments,
            status = EXCLUDED.status,
            anchor_state = EXCLUDED.anchor_state,
            anchored_version = EXCLUDED.anchored_version,
            last_good_position = EXCLUDED.last_good_position,
            updated_at = EXCLUDED.updated_at,
            deleted = EXCLUDED.deleted,
            parent_id = COALESCE(EXCLUDED.parent_id, project_comments.parent_id),
            root_comment_id = COALESCE(EXCLUDED.root_comment_id, project_comments.root_comment_id),
            seq = DEFAULT
          RETURNING seq`,
        [
          comment.id, teamId, projectId,
          typeof comment.conversationId === 'string' ? comment.conversationId : '',
          typeof comment.memberId === 'string' ? comment.memberId : '',
          authorDisplayName,
          parentId, resolvedRootCommentId,
          typeof comment.note === 'string' ? comment.note : '',
          typeof comment.filePath === 'string' ? comment.filePath : '',
          typeof comment.elementId === 'string' ? comment.elementId : '',
          typeof comment.selector === 'string' ? comment.selector : '',
          typeof comment.label === 'string' ? comment.label : '',
          typeof comment.text === 'string' ? comment.text : '',
          typeof comment.htmlHint === 'string' ? comment.htmlHint : '',
          position, style, selectionKind, memberCount, podMembers,
          slideIndex, attachments, status, anchorState, anchoredVersion,
          lastGoodPosition, createdAt, updatedAt, deleted,
        ],
      );

      const seq = Number(result.rows && result.rows[0] ? result.rows[0].seq : 0);
      ctx.body = { seq };
    } catch (err) {
      ctx.logger.error('Comment push error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // GET /teams/:teamId/projects/:projectId/comments?sinceSeq=N
  // Returns: { comments: CollabCloudComment[], latestSeq: number }
  // Supports ETag/304 short-circuit.
  async pullComments() {
    const { ctx } = this;
    const { teamId, projectId } = ctx.params;
    const sinceSeq = parseInt(ctx.query.sinceSeq || '0', 10) || 0;

    try {
      const k = this.getKnex();

      // Compute max seq for ETag
      const maxRow = await k('project_comments')
        .where({ team_id: teamId, project_id: projectId })
        .max('seq as max_seq')
        .first();
      const maxSeq = Number((maxRow && maxRow.max_seq) || 0);
      const etag = `"seq-${maxSeq}"`;

      // 304 short-circuit
      const ifNoneMatch = ctx.get('if-none-match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        ctx.status = 304;
        ctx.set('etag', etag);
        return;
      }

      const rows = await k('project_comments')
        .where({ team_id: teamId, project_id: projectId })
        .where('seq', '>', sinceSeq)
        .orderBy('seq', 'asc')
        .select('*');

      const comments = rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        conversationId: r.conversation_id,
        memberId: r.member_id,
        displayName: r.displayname || null,
        seq: Number(r.seq),
        note: r.note,
        filePath: r.file_path,
        elementId: r.element_id,
        selector: r.selector,
        label: r.label,
        text: r.text,
        htmlHint: r.html_hint,
        position: parseJsonb(r.position) || { x: 0, y: 0, width: 0, height: 0 },
        style: parseJsonb(r.style),
        selectionKind: r.selection_kind || undefined,
        memberCount: r.member_count != null ? r.member_count : undefined,
        podMembers: parseJsonb(r.pod_members),
        slideIndex: r.slide_index != null ? r.slide_index : undefined,
        attachments: parseJsonb(r.attachments),
        status: r.status,
        anchorState: r.anchor_state || undefined,
        anchoredVersion: r.anchored_version != null ? r.anchored_version : undefined,
        lastGoodPosition: parseJsonb(r.last_good_position),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        parentId: r.parent_id || undefined,
        rootCommentId: r.root_comment_id || undefined,
        deleted: r.deleted || undefined,
      }));

      ctx.set('etag', etag);
      ctx.body = { comments, latestSeq: maxSeq };
    } catch (err) {
      ctx.logger.error('Comment pull error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }
}

module.exports = CommentController;
