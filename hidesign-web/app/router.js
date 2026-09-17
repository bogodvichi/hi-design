'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;
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
  router.post('/hdw/api/team/add', controller.api.team.add);
  router.del('/hdw/api/team/:workspace_id', controller.api.team.del);
  router.post('/hdw/api/team/rename', controller.api.team.rename);
  router.post('/hdw/api/team/invite', controller.api.team.invite);
  router.get('/hdw/api/team/my', controller.api.team.myTeams);
  router.get('/hdw/api/team/:workspace_id', controller.api.team.detail);
  router.get('/hdw/api/team/:workspace_id/members', controller.api.team.members);
  router.get('/hdw/api/team/:workspace_id/member/check', controller.api.team.checkMember);
  router.get('/hdw/api/team/:workspace_id/member/:workspace_member_id', controller.api.team.memberDetail);
  // api:team/member // 成员管理
  router.post('/hdw/api/team/member/remove', controller.api.team.removeMember);
  router.post('/hdw/api/team/member/role', controller.api.team.updateRole);
  router.post('/hdw/api/team/quit', controller.api.team.quit);
  router.post('/hdw/api/team/transfer', controller.api.team.transfer);
 // api:folder // 文件夹管理
 router.post('/hdw/api/folder/add', controller.api.folder.add);
  router.post('/hdw/api/folder/create', controller.api.folder.create);
  // api:shared_space // 共享空间
  router.get('/hdw/api/shared-space/info', controller.api.sharedSpace.info);
  router.post('/hdw/api/shared-space/share', controller.api.sharedSpace.share);
  router.post('/hdw/api/shared-space/share-batch', controller.api.sharedSpace.shareBatch);
  router.get('/hdw/api/shared-space/shared-with-me', controller.api.sharedSpace.sharedWithMe);
  router.get('/hdw/api/shared-space/shared-by-me', controller.api.sharedSpace.sharedByMe);
  router.del('/hdw/api/shared-space/:share_id', controller.api.sharedSpace.unshare);
  router.del('/hdw/api/shared-space/project/:project_id', controller.api.sharedSpace.unshareProject);
  // api:resource_share // 资源分享（skill/mcp）
  router.post('/hdw/api/resource-share/share', controller.api.resourceShare.share);
  router.get('/hdw/api/resource-share/shared-with-me', controller.api.resourceShare.sharedWithMe);
  router.get('/hdw/api/resource-share/shared-by-me', controller.api.resourceShare.sharedByMe);
  router.del('/hdw/api/resource-share/:share_id', controller.api.resourceShare.unshare);
  router.del('/hdw/api/resource-share/resource/:resource_id', controller.api.resourceShare.unshareResource);
  router.del('/hdw/api/folder/:folder_id', controller.api.folder.del);
  router.post('/hdw/api/folder/rename', controller.api.folder.rename);
  router.post('/hdw/api/folder/move', controller.api.folder.move);
  router.get('/hdw/api/folder/list', controller.api.folder.list);
  router.get('/hdw/api/folder/detail', controller.api.folder.detail);
  // api:folder/project // 文件夹-项目关联管理
  router.post('/hdw/api/folder/project/add', controller.api.folder.addProject);
  router.post('/hdw/api/folder/project/remove', controller.api.folder.removeProject);
  router.get('/hdw/api/folder/project/list', controller.api.folder.listProjects);
  router.post('/hdw/api/folder/project/move', controller.api.folder.moveProject);
  // api:resource // ResourceHub — 内容寻址资源存储
  router.put('/hdw/api/workspaces/:workspaceId/resources/:resourceId/versions', controller.api.resource.publish);
  router.get('/hdw/api/workspaces/:workspaceId/resources/:resourceId/refs/:ref', controller.api.resource.head);
  router.post('/hdw/api/workspaces/:workspaceId/resources/:resourceId/materialize', controller.api.resource.materialize);
  router.del('/hdw/api/workspaces/:workspaceId/resources/:resourceId', controller.api.resource.remove);
  router.get('/hdw/api/workspaces/:workspaceId/resources', controller.api.resource.list);
  router.get('/hdw/api/workspaces/:workspaceId/resources/check', controller.api.resource.check);
  router.get('/hdw/api/workspaces/:workspaceId/resources/:resourceId', controller.api.resource.show);
  router.post('/hdw/api/workspaces/:workspaceId/resources', controller.api.resource.create);
  router.put('/hdw/api/workspaces/:workspaceId/resources/:resourceId', controller.api.resource.update);
  // api:blob // Blob 上传下载
  router.put('/hdw/api/workspaces/:workspaceId/blobs/:digest', controller.api.blob.upload);
  router.get('/hdw/api/workspaces/:workspaceId/blobs/:digest', controller.api.blob.download);
  // api:team_project // 团队项目目录
  router.get('/hdw/api/workspaces/:workspaceId/team-projects', controller.api.teamProject.list);
  router.get('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', controller.api.teamProject.get);
  router.put('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', controller.api.teamProject.upsert);
  router.del('/hdw/api/workspaces/:workspaceId/team-projects/:projectId', controller.api.teamProject.remove);
  router.post('/hdw/api/workspaces/:workspaceId/team-projects/:projectId/transfer', controller.api.teamProject.transfer);
  // api:community // 社区插件市场
  router.get('/hdw/api/community/marketplace', controller.api.community.marketplace);
  router.get('/hdw/api/community/plugins/:name', controller.api.community.detail);
  router.post('/hdw/api/community/plugins', controller.api.community.publish);
  router.del('/hdw/api/community/plugins/:name', controller.api.community.remove);
  router.put('/hdw/api/community/blobs/:digest', controller.api.community.uploadBlob);
  router.get('/hdw/api/community/plugins/:name/versions/:version/archive', controller.api.community.downloadArchive);
  router.get('/hdw/api/community/cover/:digest', controller.api.community.downloadCover);
  // api:share_link // 分享链接
  router.post('/hdw/api/share-link/generate', controller.api.shareLink.generate);
  router.get('/hdw/api/share-link', controller.api.shareLink.get);
  router.del('/hdw/api/share-link', controller.api.shareLink.revoke);
  router.get('/hdw/share/:token', controller.api.shareLink.view);

};
