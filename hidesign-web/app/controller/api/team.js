'use strict';

const { createKnex } = require('../../utils/knex.js');
const { createTeamId, getTeamMemberId, getSharedSpaceTeamId } = require('../../utils/ids.js');
const { sendHiklinkMessage } = require('../../utils/hiklink.js');

const Controller = require('egg').Controller;

// 允许的角色取值,owner 保留给创建者
const ALLOWED_ROLES = ['admin', 'member', 'guest'];
const DEFAULT_ROLE = 'member';

class TeamController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // 权限校验:操作者必须在指定团队中且角色符合要求
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
    if (!allowedRoles.includes(member.role)) {
      return { error: '权限不足' };
    }
    return { member };
  }

  // 创建团队(支持创建的同时邀请成员)
  async add() {
    const { ctx } = this;
    const {
      workspace_name: workspaceName,
      owner_username: ownerUsername,
      owner_displayname: ownerDisplayname,
      owner_email: ownerEmail,
      members = [],
    } = ctx.request.body;

    if (!workspaceName || !ownerUsername) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_name 或 owner_username' };
      return;
    }

    const workspaceId = createTeamId();
    const now = new Date();

    try {
      const result = await this.getKnex().transaction(async trx => {
        // 1. 写入团队主表
        await trx('workspaces').insert({
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          owner_username: ownerUsername,
          owner_displayname: ownerDisplayname || null,
          created_at: now,
          updated_at: now,
        });

        // 2. 创建者作为 owner 成员写入成员表(member_id 由 team+username 确定性生成)
        const memberRows = [{
          workspace_id: workspaceId,
          workspace_member_id: getTeamMemberId(workspaceId, ownerUsername),
          username: ownerUsername,
          displayname: ownerDisplayname || null,
          email: ownerEmail || null,
          role: 'owner',
          created_at: now,
          updated_at: now,
        }];

        // 3. 顺带邀请的成员(按 username 去重,避免确定性 member_id 主键冲突)
        const seen = new Set([ownerUsername]);
        for (const m of members) {
          if (!m.username || seen.has(m.username)) continue;
          seen.add(m.username);
          const role = ALLOWED_ROLES.includes(m.role) ? m.role : DEFAULT_ROLE;
          memberRows.push({
            workspace_id: workspaceId,
            workspace_member_id: getTeamMemberId(workspaceId, m.username),
            username: m.username,
            displayname: m.displayname || null,
            email: m.email || null,
            role,
            created_at: now,
            updated_at: now,
          });
        }

        await trx('workspace_members').insert(memberRows);
        return memberRows.length;
      });

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          workspace_member_id: getTeamMemberId(workspaceId, ownerUsername),
          member_count: result,
        },
      };
    } catch (err) {
      ctx.logger.error('Team add error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 删除团队(连同成员一并清理)
  async del() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.params;
    const { operator_member_id: operatorId } = ctx.query;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }

    try {
      // 仅 owner 可删除团队
      const check = await this._checkOperator(operatorId, workspaceId, ['owner']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }
      const deleted = await this.getKnex().transaction(async trx => {
        const ws = await trx('workspaces').where({ workspace_id: workspaceId }).del('*');
        await trx('workspace_members').where({ workspace_id: workspaceId }).del();
        return ws.length;
      });

      if (deleted === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('Team delete error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 修改团队名称
  async rename() {
    const { ctx } = this;
    const { workspace_id: workspaceId, workspace_name: workspaceName, operator_member_id: operatorId } = ctx.request.body;

    if (!workspaceId || !workspaceName) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 workspace_name' };
      return;
    }

    try {
      // owner 或 admin 可改名
      const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }
      const now = new Date();
      const updated = await this.getKnex()('workspaces')
        .where({ workspace_id: workspaceId })
        .update({ workspace_name: workspaceName, updated_at: now }, ['workspace_id']);

      if (updated.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { renamed: true } };
    } catch (err) {
      ctx.logger.error('Team rename error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 邀请团队成员(批量)
  async invite() {
    const { ctx } = this;
    const { workspace_id: workspaceId, members = [], operator_member_id: operatorId } = ctx.request.body;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }
    if (!Array.isArray(members) || members.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 members' };
      return;
    }

    try {
      const k = this.getKnex();
      // 仅 owner 和 admin 可邀请成员。admin 可邀请 admin。
      const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }
      // 团队必须存在
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }

      // 已有成员(用于跳过重复邀请,避免确定性 member_id 主键冲突)
      const existing = await k('workspace_members')
        .where({ workspace_id: workspaceId })
        .select('username');
      const existingNames = new Set(existing.map(r => r.username));

      const now = new Date();
      const memberRows = [];
      const seen = new Set();
      for (const m of members) {
        if (!m.username || existingNames.has(m.username) || seen.has(m.username)) continue;
        seen.add(m.username);
        const role = ALLOWED_ROLES.includes(m.role) ? m.role : DEFAULT_ROLE;
        memberRows.push({
          workspace_id: workspaceId,
          workspace_member_id: getTeamMemberId(workspaceId, m.username),
          username: m.username,
          displayname: m.displayname || null,
          email: m.email || null,
          role,
          created_at: now,
          updated_at: now,
        });
      }

      if (memberRows.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '没有需要新增的成员(均已是团队成员)' };
        return;
      }

      await k('workspace_members').insert(memberRows);

      // 邀请成功后给邀请人和被邀请人都发送 Hiklink 通知
      const inviterName = check.member.displayname || check.member.username;
      const invitedNames = memberRows.map(m => m.displayname || m.username).join('、');
      const teamName = ws.workspace_name;
      const notifyTargets = [
        { user: check.member.username, msg: `【HiDesign团队消息】📢 你邀请了 ${invitedNames} 加入了团队「${teamName}」🎉` },
        ...memberRows.map(m => ({
          user: m.username,
          msg: `【HiDesign团队消息】📢 ${inviterName} 邀请你加入了团队「${teamName}」🎉`,
        })),
      ];
      const notifyResults = await Promise.allSettled(
        notifyTargets.map(t => sendHiklinkMessage(t.msg, t.user))
      );
      for (const r of notifyResults) {
        if (r.status === 'rejected') {
          ctx.logger.warn('Hiklink notify failed:', r.reason && r.reason.message);
        }
      }
      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { invited: memberRows.length, skipped: members.length - memberRows.length },
      };
    } catch (err) {
      ctx.logger.error('Team invite error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询当前用户创建或加入的团队列表
  async myTeams() {
    const { ctx } = this;
    const username = ctx.query.username;

    if (!username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const teams = await k('workspaces as w')
        .join('workspace_members as m', 'w.workspace_id', 'm.workspace_id')
        .select(
          'w.workspace_id',
          'w.workspace_name',
          'w.owner_username',
          'w.owner_displayname',
          'w.created_at',
          'm.workspace_member_id',
          'm.role',
          'm.created_at as joined_at'
        )
        .where('m.username', username)
        .whereNot('w.workspace_id', getSharedSpaceTeamId())
        .orderBy('w.created_at', 'asc');

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { teams },
      };
    } catch (err) {
      ctx.logger.error('Team myTeams error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 根据团队 ID 获取团队成员列表
  async members() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.params;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }

      const list = await k('workspace_members')
        .where({ workspace_id: workspaceId })
        .select('workspace_member_id', 'username', 'displayname', 'email', 'role', 'created_at')
        .orderBy('created_at', 'asc');

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          workspace_id: ws.workspace_id,
          workspace_name: ws.workspace_name,
          owner_username: ws.owner_username,
          members: list,
        },
      };
    } catch (err) {
      ctx.logger.error('Team members error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 检查用户是否已是团队成员
  async checkMember() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.params;
    const { username } = ctx.query;

    if (!workspaceId || !username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const member = await k('workspace_members')
        .where({ workspace_id: workspaceId, username })
        .first();
      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          is_member: Boolean(member),
          role: member ? member.role : null,
        },
      };
    } catch (err) {
      ctx.logger.error('Team checkMember error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 根据 workspace_member_id 查询单个成员信息
  async memberDetail() {
    const { ctx } = this;
    const { workspace_id: workspaceId, workspace_member_id: memberId } = ctx.params;

    if (!workspaceId || !memberId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 workspace_member_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const member = await k('workspace_members')
        .where({ workspace_member_id: memberId, workspace_id: workspaceId })
        .first();
      if (!member) {
        ctx.body = { code: -1, msg: 'FAIL', error: '成员不存在' };
        return;
      }
      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          workspace_member_id: member.workspace_member_id,
          workspace_id: member.workspace_id,
          username: member.username,
          displayname: member.displayname,
          email: member.email,
          role: member.role,
          created_at: member.created_at,
        },
      };
    } catch (err) {
      ctx.logger.error('Team memberDetail error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询单个团队详情(不含成员)
  async detail() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.params;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: ws };
    } catch (err) {
      ctx.logger.error('Team detail error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 移除团队成员(owner 不可被移除)
  async removeMember() {
    const { ctx } = this;
    const { workspace_member_id: memberIds, operator_member_id: operatorId } = ctx.request.body;

    if (!memberIds) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_member_id' };
      return;
    }

    try {
      const k = this.getKnex();
      // 支持单个 ID 或 ID 数组
      const ids = Array.isArray(memberIds) ? memberIds : [memberIds];
      if (ids.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_member_id' };
        return;
      }
      // 不能移除自己,请走 quit 接口
      if (operatorId && ids.includes(operatorId)) {
        ctx.body = { code: -1, msg: 'FAIL', error: '不能移除自己,请使用退出团队接口' };
        return;
      }

      const members = await k('workspace_members')
        .whereIn('workspace_member_id', ids)
        .select('workspace_member_id', 'username', 'displayname', 'role', 'workspace_id');
      if (members.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '成员不存在' };
        return;
      }
      const workspaceId = members[0].workspace_id;

      // owner 或 admin 可移除成员
      const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }

      const owners = members.filter(m => m.role === 'owner');
      if (owners.length > 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队所有者不可移除,请先转让团队' };
        return;
      }
      // admin 只能移除 member/guest 级别成员,不能移除其他 admin
      if (check.member.role === 'admin') {
        const admins = members.filter(m => m.role === 'admin');
        if (admins.length > 0) {
          ctx.body = { code: -1, msg: 'FAIL', error: '管理员不可移除其他管理员,仅所有者可以' };
          return;
        }
      }

      const deleted = await k('workspace_members')
        .whereIn('workspace_member_id', ids)
        .del();

      // 移除成功后给操作人和被移除人都发送 Hiklink 通知
      const wsInfo = await k('workspaces').where({ workspace_id: workspaceId }).first();
      const teamName = wsInfo ? wsInfo.workspace_name : workspaceId;
      const operatorName = check.member.displayname || check.member.username;
      const removedNames = members.map(m => m.displayname || m.username).join('、');
      const notifyTargets = [
        { user: check.member.username, msg: `【HiDesign团队消息】📢 你将 ${removedNames} 移出了团队「${teamName}」` },
        ...members.map(m => ({
          user: m.username,
          msg: `【HiDesign团队消息】📢 ${operatorName} 将你移出了团队「${teamName}」`,
        })),
      ];
      const notifyResults = await Promise.allSettled(
        notifyTargets.map(t => sendHiklinkMessage(t.msg, t.user))
      );
      for (const r of notifyResults) {
        if (r.status === 'rejected') {
          ctx.logger.warn('Hiklink notify failed:', r.reason && r.reason.message);
        }
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { removed: deleted } };
    } catch (err) {
      ctx.logger.error('Team removeMember error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 修改成员角色(owner 角色不可直接改,需走转让)
  async updateRole() {
    const { ctx } = this;
    const { workspace_member_id: memberId, role, operator_member_id: operatorId } = ctx.request.body;

    if (!memberId || !role) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_member_id 或 role' };
      return;
    }
    if (!ALLOWED_ROLES.includes(role)) {
      ctx.body = { code: -1, msg: 'FAIL', error: `role 只允许 ${ALLOWED_ROLES.join('/')} ` };
      return;
    }

    try {
      const k = this.getKnex();
      const member = await k('workspace_members')
        .where({ workspace_member_id: memberId })
        .first();
      if (!member) {
        ctx.body = { code: -1, msg: 'FAIL', error: '该成员不在团队中' };
        return;
      }
      if (member.role === 'owner') {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队所有者角色不可直接修改,请使用转让' };
        return;
      }

      // owner 或 admin 可修改角色
      const check = await this._checkOperator(operatorId, member.workspace_id, ['owner', 'admin']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }
      // admin 只能修改 member/guest 级别成员的角色,不能改其他 admin
      if (check.member.role === 'admin' && member.role === 'admin') {
        ctx.body = { code: -1, msg: 'FAIL', error: '管理员不可修改其他管理员的角色,仅所有者可以' };
        return;
      }

      await k('workspace_members')
        .where({ workspace_member_id: memberId })
        .update({ role, updated_at: new Date() });

      // 角色变更后给操作人和被操作人都发送 Hiklink 通知
      const wsInfo = await k('workspaces').where({ workspace_id: member.workspace_id }).first();
      const teamName = wsInfo ? wsInfo.workspace_name : member.workspace_id;
      const operatorName = check.member.displayname || check.member.username;
      const targetName = member.displayname || member.username;
      const roleLabel = { admin: '管理员', member: '成员', guest: '访客' }[role] || role;
      const notifyTargets = [
        { user: check.member.username, msg: `【HiDesign团队消息】📢 你将 ${targetName} 的角色修改为「${roleLabel}」` },
        { user: member.username, msg: `【HiDesign团队消息】📢 ${operatorName} 将你的角色修改为「${roleLabel}」` },
      ];
      const notifyResults = await Promise.allSettled(
        notifyTargets.map(t => sendHiklinkMessage(t.msg, t.user))
      );
      for (const r of notifyResults) {
        if (r.status === 'rejected') {
          ctx.logger.warn('Hiklink notify failed:', r.reason && r.reason.message);
        }
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { updated: true } };
    } catch (err) {
      ctx.logger.error('Team updateRole error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 退出团队(owner 不可退出,需先转让)
  async quit() {
    const { ctx } = this;
    const { workspace_member_id: memberId } = ctx.request.body;

    if (!memberId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_member_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const member = await k('workspace_members')
        .where({ workspace_member_id: memberId })
        .first();
      if (!member) {
        ctx.body = { code: -1, msg: 'FAIL', error: '该成员不在团队中' };
        return;
      }
      if (member.role === 'owner') {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队所有者不可退出,请先转让团队' };
        return;
      }

      await k('workspace_members')
        .where({ workspace_member_id: memberId })
        .del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { quited: true } };
    } catch (err) {
      ctx.logger.error('Team quit error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 转让团队所有权(原 owner 降为 admin,新 owner 升为 owner)
  async transfer() {
    const { ctx } = this;
    const { workspace_member_id: memberId, operator_member_id: operatorId } = ctx.request.body;

    if (!memberId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_member_id' };
      return;
    }

    try {
      const k = this.getKnex();
      // 新 owner 必须已是团队成员
      const newOwner = await k('workspace_members')
        .where({ workspace_member_id: memberId })
        .first();
      if (!newOwner) {
        ctx.body = { code: -1, msg: 'FAIL', error: '新所有者不在团队成员中,请先邀请加入' };
        return;
      }
      const workspaceId = newOwner.workspace_id;
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      if (newOwner.username === ws.owner_username) {
        ctx.body = { code: -1, msg: 'FAIL', error: '新所有者与当前所有者相同' };
        return;
      }

      // 仅 owner 可转让团队
      const check = await this._checkOperator(operatorId, workspaceId, ['owner']);
      if (check.error) {
        ctx.body = { code: -1, msg: 'FAIL', error: check.error };
        return;
      }

      const now = new Date();
      await k.transaction(async trx => {
        // 更新团队主表的 owner
        await trx('workspaces')
          .where({ workspace_id: workspaceId })
          .update({
            owner_username: newOwner.username,
            owner_displayname: newOwner.displayname || null,
            updated_at: now,
          });
        // 原 owner 降为 admin
        await trx('workspace_members')
          .where({ workspace_id: workspaceId, username: ws.owner_username })
          .update({ role: 'admin', updated_at: now });
        // 新 owner 升为 owner
        await trx('workspace_members')
          .where({ workspace_member_id: memberId })
          .update({ role: 'owner', updated_at: now });
      });

      ctx.body = { code: 0, msg: 'SUCCESS', data: { transfered: true } };
    } catch (err) {
      ctx.logger.error('Team transfer error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }
}

module.exports = TeamController;
