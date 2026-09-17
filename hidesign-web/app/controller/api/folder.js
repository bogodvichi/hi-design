'use strict';

const { createKnex } = require('../../utils/knex.js');

const Controller = require('egg').Controller;

class FolderController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // 权限校验:操作者必须在指定团队中
  async _checkOperator(memberId, workspaceId, allowedRoles) {
    if (!memberId) {
      return { error: '缺少必要参数 operator_member_id' };
    }
    const k = this.getKnex();
    const member = await k('workspace_members')
      .where({ workspace_member_id: memberId, workspace_id: workspaceId })
      .first();
    if (!member) {
      return { error: '操作者不在该团队中(无权限)' };
    }
    if (allowedRoles && !allowedRoles.includes(member.role)) {
      return { error: '权限不足' };
    }
    return { member };
  }

  // 创建文件夹
  // body: { workspace_id, folder_name, folder_pid?, operator_member_id? }
  async add() {
    const { ctx } = this;
    const {
      workspace_id: workspaceId,
      folder_name: folderName,
      folder_pid: folderPid = null,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!workspaceId || !folderName) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 folder_name' };
      return;
    }

    try {
      const k = this.getKnex();
      // 校验团队存在
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      // 权限校验(可选)
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }
      // 若指定了父文件夹,校验其存在且属于同一团队
      if (folderPid) {
        const parent = await k('folders').where({ folder_id: folderPid, workspace_id: workspaceId }).first();
        if (!parent) {
          ctx.body = { code: -1, msg: 'FAIL', error: '父文件夹不存在或不属于该团队' };
          return;
        }
      }

      const now = new Date();
      const [inserted] = await k('folders').insert({
        folder_pid: folderPid,
        workspace_id: workspaceId,
        folder_name: folderName,
        recipient_member_id: ctx.request.body.recipient_member_id || null,
        created_at: now,
      }, ['folder_id', 'folder_pid', 'workspace_id', 'folder_name']);

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: inserted,
      };
    } catch (err) {
      ctx.logger.error('Folder add error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 批量创建文件夹 (幂等 — 跳过已存在的 folder_id)
  // body: { workspace_id, folders: [{ folder_id, folder_pid?, folder_name }] }
  // folder_id 由调用方主动生成 (UUID),HDW 直接使用,不重新生成。
  async create() {
    const { ctx } = this;
    const {
      workspace_id: workspaceId,
      folders: foldersInput = [],
    } = ctx.request.body;

    if (!workspaceId || !Array.isArray(foldersInput) || foldersInput.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 folders' };
      return;
    }

    try {
      const k = this.getKnex();
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }

      const folderIds = foldersInput.map(f => f.folder_id).filter(Boolean);
      const existing = folderIds.length > 0
        ? await k('folders').whereIn('folder_id', folderIds).pluck('folder_id')
        : [];
      const existingSet = new Set(existing);

      const newFolders = foldersInput.filter(
        f => f.folder_id && f.folder_name && !existingSet.has(f.folder_id),
      );
      const skipped = foldersInput.length - newFolders.length;

      if (newFolders.length > 0) {
        const now = new Date();
        const rows = newFolders.map(f => ({
          folder_id: f.folder_id,
          folder_pid: f.folder_pid || null,
          workspace_id: workspaceId,
          folder_name: f.folder_name,
          recipient_member_id: f.recipient_member_id || null,
          created_at: now,
        }));
        await k('folders').insert(rows).onConflict('folder_id').ignore();
      }

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          created: newFolders.length,
          skipped,
        },
      };
    } catch (err) {
      ctx.logger.error('Folder create (batch) error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 删除文件夹(连同子文件夹及文件夹内项目关联一并清理,由 ON DELETE CASCADE 完成)
  // params: folder_id; query: operator_member_id?
  async del() {
    const { ctx } = this;
    const { folder_id: folderId } = ctx.params;
    const { operator_member_id: operatorId } = ctx.query;

    if (!folderId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders').where({ folder_id: folderId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }
      // 权限校验(可选)
      if (operatorId) {
        const check = await this._checkOperator(operatorId, folder.workspace_id, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      // 递归收集所有子文件夹 ID(含自身),连同关联的 team_projects 一起删除。
      const folderIds = [folderId];
      let pending = [folderId];
      while (pending.length > 0) {
        const children = await k('folders')
          .whereIn('folder_pid', pending)
          .pluck('folder_id');
        if (children.length === 0) break;
        folderIds.push(...children);
        pending = children;
      }
      await k('team_projects').whereIn('folder_id', folderIds).del();
      await k('folders').where({ folder_id: folderId }).del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('Folder delete error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 修改文件夹名称
  // body: { folder_id, folder_name, operator_member_id? }
  async rename() {
    const { ctx } = this;
    const { folder_id: folderId, folder_name: folderName, operator_member_id: operatorId } = ctx.request.body;

    if (!folderId || !folderName) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id 或 folder_name' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders').where({ folder_id: folderId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, folder.workspace_id, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      await k('folders').where({ folder_id: folderId }).update({ folder_name: folderName });
      ctx.body = { code: 0, msg: 'SUCCESS', data: { renamed: true } };
    } catch (err) {
      ctx.logger.error('Folder rename error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 批量移动文件夹到同一团队内的另一个目录（target_folder_id 为空表示团队根目录）。
  // body: { folder_ids, workspace_id, target_folder_id, operator_member_id }
  async move() {
    const { ctx } = this;
    const {
      folder_ids: rawFolderIds,
      workspace_id: workspaceId,
      target_folder_id: rawTargetFolderId,
      operator_member_id: operatorId,
    } = ctx.request.body || {};
    const folderIds = Array.isArray(rawFolderIds)
      ? [...new Set(rawFolderIds.map(id => String(id || '').trim()).filter(Boolean))]
      : [];
    const targetFolderId = rawTargetFolderId ? String(rawTargetFolderId).trim() : null;

    if (!workspaceId || !operatorId || folderIds.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id、folder_ids 或 operator_member_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }

      const folders = await k('folders').where({ workspace_id: workspaceId });
      const byId = new Map(folders.map(folder => [String(folder.folder_id), folder]));
      if (folderIds.some(folderId => !byId.has(folderId))) {
        ctx.body = { code: -1, msg: 'FAIL', error: '待移动文件夹不存在或不属于当前团队' };
        return;
      }
      if (targetFolderId && !byId.has(targetFolderId)) {
        ctx.body = { code: -1, msg: 'FAIL', error: '目标文件夹不存在或不属于当前团队' };
        return;
      }

      const childrenByParent = new Map();
      for (const folder of folders) {
        const parentId = folder.folder_pid ? String(folder.folder_pid) : null;
        if (!parentId) continue;
        const children = childrenByParent.get(parentId) || [];
        children.push(String(folder.folder_id));
        childrenByParent.set(parentId, children);
      }
      for (const folderId of folderIds) {
        if (targetFolderId === folderId) {
          ctx.body = { code: -1, msg: 'FAIL', error: '不能将文件夹移动到自身' };
          return;
        }
        const pending = [folderId];
        const descendants = new Set();
        while (pending.length > 0) {
          const current = pending.pop();
          for (const childId of childrenByParent.get(current) || []) {
            if (descendants.has(childId)) continue;
            descendants.add(childId);
            pending.push(childId);
          }
        }
        if (targetFolderId && descendants.has(targetFolderId)) {
          ctx.body = { code: -1, msg: 'FAIL', error: '不能将文件夹移动到其子文件夹中' };
          return;
        }
      }

      await k.transaction(async trx => {
        await trx('folders')
          .where({ workspace_id: workspaceId })
          .whereIn('folder_id', folderIds)
          .update({ folder_pid: targetFolderId });
      });
      ctx.body = { code: 0, msg: 'SUCCESS', data: { moved: folderIds.length } };
    } catch (err) {
      ctx.logger.error('Folder move error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询团队下的文件夹列表(树形结构)
  // query: workspace_id
  async list() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.query;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const query = k('folders')
        .where({ workspace_id: workspaceId })
        .select(
          'folder_id', 'folder_pid', 'workspace_id', 'folder_name', 'created_at', 'recipient_member_id',
          k.raw('(SELECT COUNT(*) FROM folders sub WHERE sub.folder_pid = folders.folder_id) AS subfolder_count'),
          k.raw('(SELECT COUNT(*) FROM team_projects tp WHERE tp.folder_id = folders.folder_id) AS project_count'),
          k.raw(`(
            SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
              SELECT name, kind FROM (
                SELECT COALESCE(display_name, project_id) AS name, 'project' AS kind, 0 AS sort_group, created_at
                FROM team_projects
                WHERE folder_id = folders.folder_id AND workspace_id = folders.workspace_id AND sync_state = 'synced'
                UNION ALL
                SELECT folder_name AS name, 'folder' AS kind, 1 AS sort_group, created_at
                FROM folders AS inner_f
                WHERE inner_f.folder_pid = folders.folder_id
              ) AS combined
              ORDER BY sort_group ASC, created_at ASC
              LIMIT 4
            ) AS t
          ) AS subfolder_preview`)
        )
        .orderBy('created_at', 'asc');

      // folder_pid 为空值（null/undefined/空字符串）时查根级文件夹，
      // 否则查指定父文件夹下的子文件夹
      const { folder_pid: folderPid } = ctx.query;
      if (!folderPid) {
        query.whereNull('folder_pid');
      } else {
        query.where({ folder_pid: folderPid });
      }
      // 可选:按 recipient_member_id 过滤(共享空间场景)
      const { recipient_member_id: recipientMemberId } = ctx.query;
      if (recipientMemberId) {
        query.where({ recipient_member_id: recipientMemberId });
      }

      const folders = await query;

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folders } };
    } catch (err) {
      ctx.logger.error('Folder list error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }


  // 查询单个文件夹详情(含 folder_pid, 用于面包屑路径)
  // params: folder_id
  async detail() {
    const { ctx } = this;
    const { folder_id: folderId } = ctx.query;

    if (!folderId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders')
        .where({ folder_id: folderId })
        .select('folder_id', 'folder_pid', 'workspace_id', 'folder_name', 'created_at', 'recipient_member_id')
        .first();

      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }

      ctx.body = { code: 0, msg: 'SUCCESS', data: folder };
    } catch (err) {
      ctx.logger.error('Folder detail error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 添加项目到文件夹
  // body: { folder_id, project_id, workspace_id, operator_member_id? }
  async addProject() {
    const { ctx } = this;
    const {
      folder_id: folderId,
      project_id: projectId,
      workspace_id: workspaceId,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!folderId || !projectId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id, project_id 或 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      // 校验文件夹存在且属于该团队
      const folder = await k('folders').where({ folder_id: folderId, workspace_id: workspaceId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在或不属于该团队' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      // folder_id 现在直接在 team_projects 上,不再使用 folder_projects 表
      const updated = await k('team_projects')
        .where({ project_id: projectId, workspace_id: workspaceId })
        .update({ folder_id: folderId });
      if (updated === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '该项目不存在或不在该团队中' };
        return;
      }

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folder_id: folderId, project_id: projectId } };
    } catch (err) {
      ctx.logger.error('Folder addProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 从文件夹移除项目
  // body: { folder_id, project_id, operator_member_id? }
  async removeProject() {
    const { ctx } = this;
    const { folder_id: folderId, project_id: projectId, workspace_id: workspaceId, operator_member_id: operatorId } = ctx.request.body;

    if (!folderId || !projectId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id, project_id 或 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const tp = await k('team_projects')
        .where({ project_id: projectId, folder_id: folderId, workspace_id: workspaceId })
        .first();
      if (!tp) {
        ctx.body = { code: -1, msg: 'FAIL', error: '该项目不在该文件夹中' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      await k('team_projects')
        .where({ project_id: projectId, folder_id: folderId, workspace_id: workspaceId })
        .update({ folder_id: null });
      ctx.body = { code: 0, msg: 'SUCCESS', data: { removed: true } };
    } catch (err) {
      ctx.logger.error('Folder removeProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询文件夹内的项目列表
  // query: folder_id
  async listProjects() {
    const { ctx } = this;
    const { folder_id: folderId, workspace_id: workspaceId } = ctx.query;

    if (!folderId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id 或 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const projects = await k('team_projects')
        .where({ folder_id: folderId, workspace_id: workspaceId })
        .select('project_id', 'folder_id', 'workspace_id', 'created_at', 'updated_at')
        .orderBy('created_at', 'asc');

      ctx.body = { code: 0, msg: 'SUCCESS', data: { projects } };
    } catch (err) {
      ctx.logger.error('Folder listProjects error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 移动项目到另一个文件夹
  // body: { folder_id(目标), project_id, workspace_id, from_folder_id?, operator_member_id? }
  async moveProject() {
    const { ctx } = this;
    const {
      folder_id: folderId,
      project_id: projectId,
      workspace_id: workspaceId,
      from_folder_id: fromFolderId,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!projectId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 project_id 或 workspace_id' };
      return;
    }

    // folder_id 为 null 或 'root' 表示移到根目录
    const isRoot = !folderId || folderId === 'root';
    const targetFolderId = isRoot ? null : folderId;

    try {
      const k = this.getKnex();
      // 校验目标文件夹存在且属于该团队 (根目录跳过校验)
      if (!isRoot) {
        const folder = await k('folders').where({ folder_id: folderId, workspace_id: workspaceId }).first();
        if (!folder) {
          ctx.body = { code: -1, msg: 'FAIL', error: '目标文件夹不存在或不属于该团队' };
          return;
        }
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      // folder_id 现在直接在 team_projects 上,移动 = 更新 folder_id
      await k('team_projects')
        .where({ project_id: projectId, workspace_id: workspaceId })
        .update({ folder_id: targetFolderId });

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folder_id: targetFolderId, project_id: projectId } };
    } catch (err) {
      ctx.logger.error('Folder moveProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }
}

module.exports = FolderController;
