'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;
  const access = require('./utils/workspace-access').createWorkspaceAccess(app);
  router.get('/', controller.home.index);
  // api:test // 测试路由
  router.get('/hdw/api/test', controller.api.test.index);
  // api:auth // 服务端验证 OA 会话后签发一次性外部平台登录票据
  router.post('/hdw/api/auth/himind/launch', controller.api.himindSso.launch);
  router.post('/hdw/api/auth/ai-research/launch', controller.api.aiResearchSso.launch);
  router.post('/hdw/api/auth/himind/mcp-token', controller.api.himindSso.mcpToken);
  router.post('/hdw/api/auth/ai-research/mcp-token', controller.api.aiResearchSso.mcpToken);
  router.all('/hdw/api/mcp/himind', controller.api.himindMcpProxy.forward);
  // api:team // 团队管理
  router.post('/hdw/api/team/add', access('team', 'add'), controller.api.team.add);
  router.del('/hdw/api/team/:workspace_id', access('team', 'del'), controller.api.team.del);
  router.post('/hdw/api/team/rename', access('team', 'rename'), controller.api.team.rename);
  router.post('/hdw/api/team/invite', access('team', 'invite'), controller.api.team.invite);
  router.get('/hdw/api/team/my', access('team', 'myTeams'), controller.api.team.myTeams);
  router.get('/hdw/api/team/:workspace_id', access('team', 'detail'), controller.api.team.detail);
  router.get('/hdw/api/team/:workspace_id/members', access('team', 'members'), controller.api.team.members);
  router.get('/hdw/api/team/:workspace_id/member/check', access('team', 'checkMember'), controller.api.team.checkMember);
  router.get('/hdw/api/team/:workspace_id/member/:workspace_member_id', access('team', 'memberDetail'), controller.api.team.memberDetail);
  // api:team/member // 成员管理
  router.post('/hdw/api/team/member/remove', access('team', 'removeMember'), controller.api.team.removeMember);
  router.post('/hdw/api/team/member/role', access('team', 'updateRole'), controller.api.team.updateRole);
  router.post('/hdw/api/team/quit', access('team', 'quit'), controller.api.team.quit);
  router.post('/hdw/api/team/transfer', access('team', 'transfer'), controller.api.team.transfer);
  // api:folder // 文件夹管理
  router.post('/hdw/api/folder/add', access('folder', 'add'), controller.api.folder.add);
  router.post('/hdw/api/folder/create', access('folder', 'create'), controller.api.folder.create);
  // api:shared_space // 共享空间
  router.get('/hdw/api/shared-space/info', access('sharedSpace', 'info'), controller.api.sharedSpace.info);
  router.post('/hdw/api/shared-space/share', access('sharedSpace', 'share'), controller.api.sharedSpace.share);
  router.post('/hdw/api/shared-space/share-batch', access('sharedSpace', 'shareBatch'), controller.api.sharedSpace.shareBatch);
  router.get('/hdw/api/shared-space/shared-with-me', access('sharedSpace', 'sharedWithMe'), controller.api.sharedSpace.sharedWithMe);
  router.get('/hdw/api/shared-space/shared-by-me', access('sharedSpace', 'sharedByMe'), controller.api.sharedSpace.sharedByMe);
  router.del('/hdw/api/shared-space/:share_id', access('sharedSpace', 'unshare'), controller.api.sharedSpace.unshare);
  router.del('/hdw/api/shared-space/project/:project_id', access('sharedSpace', 'unshareProject'), controller.api.sharedSpace.unshareProject);
  // api:resource_share // 资源分享（skill/mcp）
  router.post('/hdw/api/resource-share/share', access('resourceShare', 'share'), controller.api.resourceShare.share);
  router.get('/hdw/api/resource-share/shared-with-me', access('resourceShare', 'sharedWithMe'), controller.api.resourceShare.sharedWithMe);
  router.get('/hdw/api/resource-share/shared-by-me', access('resourceShare', 'sharedByMe'), controller.api.resourceShare.sharedByMe);
  router.del('/hdw/api/resource-share/:share_id', access('resourceShare', 'unshare'), controller.api.resourceShare.unshare);
  router.del('/hdw/api/resource-share/resource/:resource_id', access('resourceShare', 'unshareResource'), controller.api.resourceShare.unshareResource);
  // Static DELETE routes must be registered before `/folder/:folder_id`,
  // otherwise Egg/router treats "unshare" as a folder_id and calls del().
  router.del('/hdw/api/folder/unshare', access('folder', 'unshare'), controller.api.folder.unshare);
  router.del('/hdw/api/folder/:folder_id', access('folder', 'del'), controller.api.folder.del);
  router.post('/hdw/api/folder/rename', access('folder', 'rename'), controller.api.folder.rename);
  router.post('/hdw/api/folder/move', access('folder', 'move'), controller.api.folder.move);
  router.get('/hdw/api/folder/list', access('folder', 'list'), controller.api.folder.list);
  router.get('/hdw/api/folder/detail', access('folder', 'detail'), controller.api.folder.detail);
  router.get('/hdw/api/folder/tree', access('folder', 'tree'), controller.api.folder.tree);
  router.post('/hdw/api/folder/share', access('folder', 'share'), controller.api.folder.share);
  router.get('/hdw/api/folder/shares', access('folder', 'shareList'), controller.api.folder.shareList);
  router.post('/hdw/api/folder/share-projects', access('folder', 'shareProjects'), controller.api.folder.shareProjects);
  // api:folder/project // 文件夹-项目关联管理
  router.post('/hdw/api/folder/project/add', access('folder', 'addProject'), controller.api.folder.addProject);
  router.post('/hdw/api/folder/project/remove', access('folder', 'removeProject'), controller.api.folder.removeProject);
  router.get('/hdw/api/folder/project/list', access('folder', 'listProjects'), controller.api.folder.listProjects);
  router.post('/hdw/api/folder/project/move', access('folder', 'moveProject'), controller.api.folder.moveProject);
  // api:resource // ResourceHub — 内容寻址资源存储
  router.put('/hdw/api/workspaces/:workspaceId/resources/:resourceId/versions', access('resource', 'publish'), controller.api.resource.publish);
  router.get('/hdw/api/workspaces/:workspaceId/resources/:resourceId/refs/:ref', access('resource', 'head'), controller.api.resource.head);
  router.post('/hdw/api/workspaces/:workspaceId/resources/:resourceId/materialize', access('resource', 'materialize'), controller.api.resource.materialize);
  router.del('/hdw/api/workspaces/:workspaceId/resources/:resourceId', access('resource', 'remove'), controller.api.resource.remove);
  router.get('/hdw/api/workspaces/:workspaceId/resources', access('resource', 'list'), controller.api.resource.list);
  router.get('/hdw/api/workspaces/:workspaceId/resources/check', access('resource', 'check'), controller.api.resource.check);
  router.get('/hdw/api/workspaces/:workspaceId/resources/:resourceId', access('resource', 'show'), controller.api.resource.show);
  router.post('/hdw/api/workspaces/:workspaceId/resources', access('resource', 'create'), controller.api.resource.create);
  router.put('/hdw/api/workspaces/:workspaceId/resources/:resourceId', access('resource', 'update'), controller.api.resource.update);
  // api:blob // Blob 上传下载
  router.put('/hdw/api/workspaces/:workspaceId/blobs/:digest', access('blob', 'upload'), controller.api.blob.upload);
  router.get('/hdw/api/workspaces/:workspaceId/blobs/:digest', access('blob', 'download'), controller.api.blob.download);
  // api:team_project // 团队项目目录
  router.get('/hdw/api/workspaces/:workspaceId/team-projects', access('teamProject', 'list'), controller.api.teamProject.list);
  router.get('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', access('teamProject', 'get'), controller.api.teamProject.get);
  router.put('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', access('teamProject', 'upsert'), controller.api.teamProject.upsert);
  router.del('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', access('teamProject', 'remove'), controller.api.teamProject.remove);
  router.post('/hdw/api/workspaces/:workspaceId/team-projects/:projectId/transfer', access('teamProject', 'transfer'), controller.api.teamProject.transfer);
  // api:community // 社区插件市场
  router.get('/hdw/api/community/marketplace', controller.api.community.marketplace);
  router.get('/hdw/api/community/plugins/:name', controller.api.community.detail);
  router.post('/hdw/api/community/plugins', controller.api.community.publish);
  router.del('/hdw/api/community/plugins/:name', controller.api.community.remove);
  router.put('/hdw/api/community/blobs/:digest', controller.api.community.uploadBlob);
  router.post('/hdw/api/community/publishers/:username/avatar', controller.api.community.syncPublisherAvatar);
  router.get('/hdw/api/community/avatar/:digest', controller.api.community.downloadAvatar);
  router.get('/hdw/api/community/plugins/:name/versions/:version/archive', controller.api.community.downloadArchive);
  router.get('/hdw/api/community/cover/:digest', controller.api.community.downloadCover);
  router.post('/hdw/api/community/stats/record', controller.api.communityStats.record);
  router.post('/hdw/api/community/stats/query', controller.api.communityStats.query);
  // api:share_link // 分享链接
  router.post('/hdw/api/share-link/generate', access('shareLink', 'generate'), controller.api.shareLink.generate);
  router.get('/hdw/api/share-link', access('shareLink', 'get'), controller.api.shareLink.get);
  router.del('/hdw/api/share-link', access('shareLink', 'revoke'), controller.api.shareLink.revoke);
  router.get('/hdw/share/:token', controller.api.shareLink.view);

  // api:collab // 评论同步 (Collab Cloud comment relay)
  router.put('/hdw/teams/:teamId/members/:memberId', access('comment', 'registerMember'), controller.api.comment.registerMember);
  router.get('/hdw/teams/:teamId/members', access('comment', 'listMembers'), controller.api.comment.listMembers);
  router.post('/hdw/teams/:teamId/projects/:projectId/comments', access('comment', 'pushComment'), controller.api.comment.pushComment);
  router.get('/hdw/teams/:teamId/projects/:projectId/comments', access('comment', 'pullComments'), controller.api.comment.pullComments);

};
