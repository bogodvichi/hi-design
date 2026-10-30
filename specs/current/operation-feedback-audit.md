# 操作结果提示核查

核查日期：2026-10-30。范围为 Web 产品现有操作入口；桌面内嵌 Web 使用同一套实现。本次没有更改 HTTP 接口、CLI 行为或打包客户端。

## 统一规则

- 复用现有 `Toast` 的外观、成功/失败图标、颜色和动画。
- 顶部居中排列，多条结果不重叠；成功、失败均显示 4 秒，支持单独关闭。
- 操作结果归全局提示层所有，关闭弹窗、切换页面不会抹掉结果。
- 提示层在弹窗之上；全屏时移动同一提示容器，不重置关闭计时。
- 按操作的实际返回结果提示。批量和部分成功保留数量，失败使用可操作的本地化文案。
- 字段校验、加载失败、连接状态和自动保存状态仍在所属位置显示；这些持续状态不应被短暂提示取代。
- 等待操作时保留现有忙碌状态和防重复提交。需要手工复制的代码/恢复说明仍保留用户主动关闭机制。

## 已核查并接入的入口

| 操作范围 | 原问题 | 处理结果与主要入口 |
| --- | --- | --- |
| 项目复制、复制并打开、复制到个人 | 普通复制成功无提示，跳转可能卸载来源列表 | 直接发送全局结果；复制到个人保留目标位置。`RecentProjectsStrip`、`ProjectView` |
| 项目重命名、删除 | 重命名缺少结果；删除只在确认框内报错 | 持久化成功后提示；失败保留删除确认供重试。`App`、`RecentProjectsStrip` |
| 批量项目/文件夹移动、删除 | 全成功静默，部分失败提示分散 | 统一显示结果及成功/失败数量，保留失败项和已有重试机制。`RecentProjectsStrip` |
| 个人、团队文件夹创建/改名/删除/移动 | 只关闭表单、静默失败或显示原始接口错误 | 根目录和子目录均补充结果，改名失败保留输入。`PersonalAllView`、`PersonalFolderView`、`TeamSpaceView` |
| Skill 添加、导入、安装、卸载、删除、更新社区版本、取消发布 | 状态按钮变化但缺少结果；新增弹窗同一批更新中关闭，提示未渲染 | 直接通知全局；保留“已保存但安装失败”等部分成功说明。`AddSkillDialog`、`CloudSkillList` |
| MCP 添加、连接、断开、删除、更新社区版本、取消发布 | 同上，部分错误只有列表内文字 | 确认结果后显示统一反馈。`AddMcpDialog`、`CloudMcpList` |
| 云端工具删除、取消发布 | 操作成功静默，失败只显示列表错误 | 补齐成功、失败提示。`CloudToolList` |
| 分享项目、文件夹、Skill、MCP | 成功文字只显示在弹窗，随后自动关闭 | 成功立即关闭弹窗，结果留在顶部；权限归属错误保留说明。`ShareToSharedSpaceDialog`、`ShareFolderDialog`、`ShareResourceDialog` |
| 统一分享、发布、生成/复制链接 | 弹窗内结果不一致，剪贴板失败静默 | 补齐顶部提示；已生成链接和发布地址仍作为可操作内容保留。`UnifiedShareDialog`、`PublishDialog` |
| 从“分享给我”移除项目/文件夹/资源 | 成功只刷新列表，失败局限在确认框 | 顶部提示“已移除”，保留访问撤销语义。`SharedWithMeView`、`RemoveSharedResourceDialog` |
| 邀请成员、移除成员、修改角色 | 邀请结果在表单内，其余成功静默 | 统一提示提交结果；重复选择等校验继续靠近人员字段。`InviteDialog`、`TeamSpaceView` |
| 创建/编辑评审、更新评审稿 | 成功在弹窗底部短暂出现 | 成功结果留在顶部，完成后关闭；提交失败也进入顶部提示。`ReviewAddModal`、`ReviewEditModal`、`ReviewManuscriptUpdateModal` |
| 评审下载、催办、关闭、通知开关 | 提示在卡片内且仅 2.5 秒 | 接入同一 Toast 层和 4 秒时长。`ReviewListModal` |
| 文件上传、删除、批量删除、改名、新建文档/页面 | 上传暴露原始错误，批量删除使用 alert，部分成功静默 | 上传/删除保留汇总数量；失败不显示诊断细节。`FileWorkspace`、`DesignFilesPanel` |
| 图片、PDF 导出 | 图片失败使用 alert；PDF 失败返回成功路径 | 统一失败提示；PDF 失败拒绝 Promise，调用方不再误报成功。`PreviewModal`、`SketchEditor`、`ExamplesTab`、`FileViewer`、`runtime/exports` |
| 设置中的更新操作、提交反馈 | 样式/结果层级不一致 | 设置结果补齐成功/失败态；反馈成功沿用全局 Toast，提交失败迁到顶部。`SettingsDialog`、`feedback/FeedbackDialog` |
| 其他现有成功/失败 Toast | 各页面自行定位、生命周期受父组件控制 | `Toast` 兼容入口统一转交全局层，避免逐个重写既有业务流程 |

后台记忆提取通知、登录表单、长期运行进度以及文件手动恢复说明属于上下文/持续状态，本次保留其订阅和业务规则。

## 验证记录

- 全局层回归覆盖：弹窗脱离、来源组件卸载、多个结果、独立关闭、4 秒边界、全屏切换不重置计时。
- 项目复制回归在原始项目列表实现上失败，在本次实现上通过；用例覆盖复制完成前列表已卸载的情况。
- 分享弹窗即时关闭后仍显示成功；权限和服务失败使用顶部提示。
- 上传测试保留成功/失败数量并验证不暴露底层错误；导出测试覆盖弹窗被阻止和原生 PDF 失败的拒绝路径。
- Node 24 环境执行仓库 guard、全仓 typecheck 和 Web 定向测试。
- 扩展定向检查：538 通过、3 跳过、8 个已有失败。8 个失败分别位于 MCP 团队连接（2）、社区 Skill 删除（1）、HTML 预览缓存回收（2）、团队资源权限/目录（3），均在未修改的 HEAD 副本复现。
- 独立命名空间、临时数据目录的真实页面检查：HTTP 200，无页面脚本错误；顶部首条 64px，多条间隔 8px，成功/失败均在 4 秒关闭。此项验证 Web 实现，不代表已安装客户端升级验收。

主要回归文件：`apps/web/tests/components/ToastProvider.test.tsx`、`RecentProjectsStrip.test.tsx`、`ShareResourceDialog.owner-error.test.tsx`、`FileWorkspace.test.tsx`、`preview-modal-image-export.test.tsx`、`apps/web/tests/runtime/exports.test.ts`。
