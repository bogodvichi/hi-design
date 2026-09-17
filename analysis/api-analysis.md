 # OpenDesign API 接口调用分析报告
 
 > 服务地址: http://127.0.0.1:56515/ (Web) / http://127.0.0.1:56514/ (Daemon)
 > 生成时间: 2026-08-27 (已登录状态重新抓取)
 > 版本: 0.20.3 (development channel, win32/x64)
 > 已登录用户: ybvichi (3858516840@qq.com)
 
 ## 概述
 
 本文档记录了 OpenDesign Web 应用在 `http://127.0.0.1:56515/` 上运行时的所有 API 接口调用情况，包括接口名、HTTP 方法、请求参数、实际返回值等信息。
 
 接口数据来源：
 1. 通过 Node HTTP 直接调用所有 GET 接口获取的真实返回值（已登录状态）
 2. 通过源码分析（`apps/daemon/src/routes/`、`apps/daemon/src/brand-routes.ts`、`apps/daemon/src/mcp-routes.ts`、`apps/daemon/src/connectors/routes.ts`、`apps/daemon/src/import-export-routes.ts`）获取的完整路由定义
 3. 通过前端代码（`apps/web/src/`）获取的 POST/PUT/DELETE 请求参数
 
 **路由统计**: 共 236+ 个路由（GET 103+, POST 102+, PUT 11+, DELETE 14+, PATCH 6+）
 
 **工作区上下文**: 需要工作区上下文的接口通过 HTTP 头 `x-od-workspace-id`、`x-od-workspace-member-id`、`x-od-workspace-type` 传递。
 
 ---
 
 ## 一、系统与配置类接口
 
 ### 1. GET /api/health
 
 健康检查接口。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"ok":true,"version":"0.20.3"}
 ```
 
 ### 2. GET /api/ready
 
 就绪检查接口，比 health 多了 ready 字段。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"ok":true,"ready":true,"version":"0.20.3"}
 ```
 
 ### 3. GET /api/version
 
 版本信息接口。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "version": {
     "version": "0.20.3",
     "channel": "development",
     "packaged": false,
     "platform": "win32",
     "arch": "x64",
     "capabilities": {"slideRenderer": true}
   }
 }
 ```
 
 ### 4. GET /api/app-config
 
 应用配置接口，返回遥测、代理、设计系统、安装 ID 等全局配置。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "config": {
     "telemetry": {"metrics": true, "content": true, "artifactManifest": false},
     "agentId": "codex",
     "skillId": null,
     "designSystemId": "default",
     "orbit": {"enabled": false, "time": "08:00", "templateSkillId": "orbit-general"},
     "installationId": "bf0c370f-7a7d-4a2d-bae9-c1a5878ab432",
     "privacyDecisionAt": 1787827623371,
     "customInstructions": null,
     "projectLocations": [],
     "defaultProjectLocationId": "default",
     "agentModels": {"codex": {"model": "EB-GLM-5.2"}},
     "onboardingCompleted": true
   }
 }
 ```
 
 - **PUT /api/app-config**: 更新应用配置，body 为完整 config 对象。
 
 ### 5. GET /api/daemon/status
 
 守护进程状态接口。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "ok": true,
   "version": "0.20.3",
   "bindHost": "127.0.0.1",
   "port": 56514,
   "dataDir": "E:\\workspace\\proj\\github\\ybvichi\\open-design-dev\\.od",
   "mediaConfigDir": null,
   "sandboxMode": false,
   "sandbox": {"enabled": false},
   "pid": 30700,
   "shuttingDown": false,
   "installedPlugins": 460
 }
 ```
 
 ### 6. GET /api/daemon/db
 
 数据库状态接口，返回 SQLite 表结构和行数。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "kind": "sqlite",
   "location": "E:\\workspace\\proj\\github\\ybvichi\\open-design-dev\\.od\\app.sqlite",
   "sizeBytes": 8433216,
   "schemaVersion": 0,
   "tables": [
     {"name": "agent_sessions", "rowCount": 0},
     {"name": "applied_plugin_snapshots", "rowCount": 0},
     {"name": "collab_sync_snapshots", "rowCount": 0},
     {"name": "conversations", "rowCount": 1},
     {"name": "installed_plugins", "rowCount": 460},
     {"name": "library_asset_sources", "rowCount": 18},
     {"name": "library_assets", "rowCount": 17},
     {"name": "library_tasks", "rowCount": 17},
     {"name": "plugin_marketplaces", "rowCount": 2},
     {"name": "projects", "rowCount": 1},
     {"name": "tabs", "rowCount": 1},
     {"name": "workspace_projects", "rowCount": 1}
   ]
 }
 ```
 
 - **POST /api/daemon/db/vacuum**: 清理数据库（需要本地 Daemon）
 - **POST /api/daemon/db/verify**: 验证数据库（需要本地 Daemon）
 - **POST /api/daemon/shutdown**: 关闭守护进程（需要本地 Daemon）
 
 ### 7. GET /api/metrics
 
 Prometheus 格式的指标接口。
 
 - **参数**: 无
 - **返回值**: Prometheus 文本格式，包含 `open_design_workspace_authority_decisions_total` 等计数器。
 
 ### 8. GET /api/critique/conformance
 
 评估合规性窗口。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "window": {"days": 14, "history": []},
   "decision": {
     "kind": "hold",
     "current": "M0",
     "reason": "insufficient data: 0 / 14 days observed",
     "passingDays": 0,
     "observedDays": 0
   }
 }
 ```
 
 ### 9. GET /api/preview/isolation
 
 预览隔离配置。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"supported": true, "baseOrigin": "http://127.0.0.1:56514", "pathPrefix": "powered"}
 ```
 
 ### 10. GET /api/active
 
 当前活跃上下文（用户正在查看的项目/文件）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"active": false}
 ```
 
 - **POST /api/active**: 更新活跃上下文，body: `{projectId, fileName}` 或 `{active: false}` 清除。
 
 ### 11. GET /api/recent-dirs
 
 最近访问的目录列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"dirs": []}
 ```
 
 ### 12. POST /api/dialog/open-folder
 
 打开系统文件夹选择对话框。
 
 - **参数**: 无
 - **返回值**: `{path: string}` 或取消
 
 ### 13. POST /api/dir-exists
 
 检查目录是否存在。
 
 - **参数**: body `{dir: string}`
 - **返回值**: `{exists: boolean}`
 
 ### 14. POST /api/system/open-external
 
 用系统默认程序打开外部 URL 或文件。
 
 - **参数**: body `{url: string}`
 - **返回值**: `{ok: true}` 或错误
 
 ---
 
 ## 二、项目管理类接口
 
 ### 1. GET /api/project-locations
 
 项目存储位置列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "locations": [{
     "id": "default",
     "name": "OpenDesign projects",
     "path": "E:\\workspace\\proj\\github\\ybvichi\\open-design-dev\\.od\\projects",
     "builtIn": true
   }]
 }
 ```
 
 - **PUT /api/project-locations**: 更新项目位置
 - **POST /api/project-locations/scan**: 扫描项目位置
 
 ### 2. GET /api/projects
 
 项目列表（需要工作区上下文）。
 
 - **参数**: Header `x-od-workspace-id`, `x-od-workspace-member-id`, `x-od-workspace-type`
 - **返回值**:
 ```json
 {"projects": []}
 ```
 
 - **POST /api/projects**: 创建项目，body: `{name, scenario, designSystemId, ...}`
 - **GET /api/projects/:id**: 获取单个项目详情
 - **PATCH /api/projects/:id**: 更新项目
 - **DELETE /api/projects/:id**: 删除项目
 - **GET /api/projects/:id/workspace-scope**: 获取项目工作区范围
 - **POST /api/projects/:id/duplicate**: 复制项目
 - **POST /api/projects/:id/design-system-copy**: 复制设计系统
 - **POST /api/projects/:id/scenario/restore-automatic**: 恢复自动场景
 
 ### 3. GET /api/projects/:id/events (SSE)
 
 项目事件 Server-Sent Events 流。
 
 - **参数**: path `:id` (项目 ID)
 - **返回值**: SSE 流，事件类型包括 `file-changed`, `tab-updated`, `presence` 等
 
 ### 4. GET /api/projects/:id/tabs
 
 项目标签页列表。
 
 - **参数**: path `:id`
 - **返回值**: `{tabs: [{id, name, type, ...}]}`
 
 - **PUT /api/projects/:id/tabs**: 更新标签页
 
 ### 5. GET /api/projects/:id/files
 
 项目文件列表。
 
 - **参数**: path `:id`
 - **返回值**: `{files: [{name, type, size, ...}]}`
 
 - **GET /api/projects/:id/files/:name/preview**: 文件预览
 - **POST /api/projects/:id/files/rename**: 重命名文件
 - **DELETE /api/projects/:id/files/:name**: 删除文件
 
 ### 6. GET /api/projects/:id/search
 
 项目内文件搜索。
 
 - **参数**: path `:id`, query `q` (搜索词)
 - **返回值**: `{results: [{file, line, text, ...}]}`
 
 ### 7. GET /api/projects/:id/design-token-suggestions
 
 设计令牌建议。
 
 - **参数**: path `:id`
 - **返回值**: `{suggestions: [...]}`
 
 ### 8. GET /api/projects/:id/folders
 
 项目文件夹列表。
 
 - **参数**: path `:id`
 - **返回值**: `{folders: [...]}`
 
 - **POST /api/projects/:id/folders**: 创建文件夹
 - **DELETE /api/projects/:id/folders**: 删除文件夹
 
 ### 9. GET /api/projects/:id/design-system-package-audit
 
 设计系统包审计。
 
 - **参数**: path `:id`
 - **返回值**: `{audit: {...}}`
 
 ### 10. GET /api/projects/:id/preview-url
 
 项目预览 URL。
 
 - **参数**: path `:id`
 - **返回值**: `{url: string, ...}`
 
 - **POST /api/projects/:id/preview/:scope/renew**: 更新预览 URL
 
 ### 11. GET /api/templates
 
 项目模板列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"templates": []}
 ```
 
 - **POST /api/templates**: 创建模板
 - **GET /api/templates/:id**: 获取单个模板
 - **DELETE /api/templates/:id**: 删除模板
 
 ### 12. POST /api/upload
 
 上传文件到项目。
 
 - **参数**: multipart form data, `projectId`, `file`
 - **返回值**: `{ok: true, path: string}`
 
 ### 13. POST /api/artifacts/save
 
 保存设计产物。
 
 - **参数**: body `{projectId, fileName, content, ...}`
 - **返回值**: `{ok: true}`
 
 ### 14. POST /api/artifacts/lint
 
 检查设计产物。
 
 - **参数**: body `{projectId, fileName, content, ...}`
 - **返回值**: `{issues: [...]}`
 
 ### 15. 工作区项目操作
 
 - **GET /api/workspaces/:workspaceId/projects**: 获取工作区项目列表
 - **POST /api/workspaces/:workspaceId/projects/:projectId/move**: 移动项目到工作区
 - **POST /api/workspaces/:workspaceId/projects/batch-move**: 批量移动项目
 - **POST /api/workspaces/:workspaceId/projects/batch-delete**: 批量删除项目
 
 ### 16. 导入导出接口
 
 - **POST /api/projects/:id/working-dir**: 设置工作目录
 - **POST /api/import/folder**: 导入文件夹为项目
 - **GET /api/projects/:id/archive**: 获取项目归档
 - **POST /api/projects/:id/archive/batch**: 批量归档
 - **GET /api/projects/:id/export/manifest**: 导出清单
 - **POST /api/projects/:id/export/pdf**: 导出 PDF
 - **POST /api/projects/:id/export/pptx**: 导出 PPTX
 - **POST /api/projects/:id/export/pdf-image**: 导出 PDF 图片
 - **POST /api/projects/:id/export/image**: 导出图片
 - **POST /api/projects/:id/export/html**: 导出 HTML
 - **POST /api/projects/:id/export**: 通用导出
 - **GET /api/projects/:id/export/*splat**: 下载导出文件
 - **POST /api/projects/:id/finalize/:provider**: 完成导出
 - **POST /api/projects/:id/figma/import**: 导入 Figma 设计
 
 ---
 
 ## 三、运行与对话类接口
 
 ### 1. GET /api/runs
 
 运行列表。
 
 - **参数**: 无（可选 query `projectId`, `limit`, `cursor`）
 - **返回值**:
 ```json
 {"runs": []}
 ```
 
 - **POST /api/runs**: 创建运行，body: `{projectId, prompt, agentId, model, ...}`
 - **GET /api/runs/:id**: 获取运行详情
 - **POST /api/runs/:id/cancel**: 取消运行
 - **GET /api/runs/:id/events (SSE)**: 运行事件流
 - **GET /api/runs/:id/result-package**: 获取运行结果包
 - **GET /api/runs/:id/agui**: 获取 AGUI 状态
 - **GET /api/runs/by-plugin-workflow/:workflowId**: 按工作流 ID 查找运行
 
 ### 2. POST /api/chat
 
 聊天接口（SSE 流式响应）。这是核心 AI 对话接口。
 
 - **参数**: body `{projectId, prompt, agentId, model, designSystemId, skillId, ...}`
 - **返回值**: SSE 流，事件类型包括:
   - `text_delta`: 文本增量
   - `tool_use`: 工具调用
   - `tool_result`: 工具结果
   - `turn_end`: 回合结束
   - `usage`: token 使用量
   - `error`: 错误
 
 ### 3. POST /api/runs/:id/feedback
 
 提交运行反馈。
 
 - **参数**: body `{rating, comment, ...}`
 - **返回值**: `{ok: true}`
 
 ### 4. AI 代理流接口
 
 - **POST /api/proxy/openai/stream**: OpenAI 代理流
 - **POST /api/proxy/anthropic/stream**: Anthropic 代理流
 - **POST /api/proxy/azure/stream**: Azure 代理流
 - **POST /api/proxy/google/stream**: Google 代理流
 - **POST /api/proxy/ollama/stream**: Ollama 代理流
 - **POST /api/proxy/:provider/stream**: 通用代理流
 
 所有代理流接口参数: body `{model, messages, ...}`, 返回 SSE 流。
 
 ### 5. POST /api/provider/models
 
 获取 AI 提供商可用模型列表。
 
 - **参数**: body `{provider, apiKey, baseUrl, ...}`
 - **返回值**: `{models: [{id, name, ...}]}`
 
 ### 6. POST /api/test/connection
 
 测试 AI 提供商连接。
 
 - **参数**: body `{provider, apiKey, baseUrl, ...}`
 - **返回值**: `{ok: true}` 或 `{ok: false, error: ...}`
 
 ---
 
 ## 四、设计体系类接口
 
 ### 1. GET /api/design-systems
 
 设计体系列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "designSystems": [
     {
       "id": "agentic",
       "title": "Agentic",
       "category": "Themed & Unique",
       "summary": "Bundled OpenDesign package for Agentic...",
       "swatches": ["#ffffff", "#f6f6f1", "#111827", "#ff5701"],
       "surface": "web",
       "source": "built-in",
       "status": "published",
       "isEditable": false
     },
     {
       "id": "default",
       "title": "Neutral Modern",
       "category": "Starter",
       "summary": "Bundled OpenDesign package for Neutral Modern...",
       "swatches": ["#fafafa", "#e5e5e5", "#111111", "#2f6feb"],
       "surface": "web",
       "source": "built-in",
       "status": "published",
       "isEditable": false
     }
   ]
 }
 ```
 
 - **POST /api/design-systems**: 创建设计体系
 - **GET /api/design-systems/:id**: 获取单个设计体系详情
 - **DELETE /api/design-systems/:id**: 删除设计体系
 - **PATCH /api/design-systems/:id**: 更新设计体系
 
 ### 2. GET /api/design-systems/:id (示例: default)
 
 - **参数**: path `:id` = `default`
 - **返回值**:
 ```json
 {
   "id": "default",
   "title": "Neutral Modern",
   "category": "Starter",
   "summary": "Bundled OpenDesign package for Neutral Modern...",
   "swatches": ["#fafafa", "#e5e5e5", "#111111", "#2f6feb"],
   "surface": "web",
   "body": "# Neutral Modern\n\n> Category: Starter\n> A clean, product-oriented default..."
 }
 ```
 
 ### 3. GET /api/design-systems/:id/preview
 
 设计体系 HTML 预览页面。
 
 - **参数**: path `:id`
 - **返回值**: HTML 页面（`<!doctype html>...`），包含 CSS 变量和组件预览
 
 ### 4. GET /api/design-systems/:id/showcase
 
 设计体系组件展示页面。
 
 - **参数**: path `:id`
 - **返回值**: HTML 页面，包含完整组件库展示
 
 ### 5. 其他设计体系接口
 
 - **GET /api/design-systems/:id/archive**: 下载设计体系归档包
 - **GET /api/design-systems/:id/static**: 静态资源
 - **GET /api/design-systems/:id/file**: 单个文件
 - **GET /api/design-systems/:id/files**: 文件列表（仅可编辑设计体系）
 - **GET /api/design-systems/:id/revisions**: 修订版本列表
 - **PATCH /api/design-systems/:id/revisions/:revisionId**: 更新修订
 - **POST /api/design-systems/:id/revision-jobs**: 创建修订任务
 - **POST /api/design-systems/:id/sync-assets**: 同步资源
 - **POST /api/design-systems/:id/token-contract/rebuild-jobs**: 重建令牌契约
 - **POST /api/design-systems/:id/workspace**: 工作区操作
 - **POST /api/design-systems/generation-jobs**: 生成任务
 - **GET /api/design-systems/generation-jobs/:jobId**: 获取生成任务状态
 - **POST /api/design-systems/import/github**: 从 GitHub 导入
 - **POST /api/design-systems/import/local**: 从本地导入
 - **POST /api/design-systems/import/shadcn**: 从 shadcn 导入
 - **POST /api/design-systems/install**: 安装设计体系
 
 ### 6. GET /api/craft
 
 Craft 规则列表（通用设计工艺规则）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "craft": [
     {"id": "accessibility-baseline", "label": "Accessibility baseline craft rules", "bytes": 13095},
     {"id": "animation-discipline", "label": "Animation discipline craft rules", "bytes": 9268},
     {"id": "anti-ai-slop", "label": "Anti-AI-slop rules", "bytes": 4002},
     {"id": "color", "label": "Color craft rules", "bytes": 3205},
     {"id": "form-validation", "label": "Form validation craft rules", "bytes": 17407},
     {"id": "laws-of-ux", "label": "Laws of UX craft rules", "bytes": ...}
   ]
 }
 ```
 
 - **GET /api/craft/:id**: 获取单个 craft 规则内容，返回 `{id, body}` (Markdown 正文)
 
 ### 7. POST /api/tools/design-systems/read
 
 工具接口：读取设计体系（需要 tool token）。
 
 - **参数**: body `{designSystemId, ...}`, Header `x-od-tool-token`
 - **返回值**: 设计体系数据
 
 ---
 
 ## 五、技能与模板类接口
 
 ### 1. GET /api/skills
 
 技能列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "skills": [{
     "id": "8-bit-orbit-video-template",
     "name": "8-bit-orbit-video-template",
     "description": "Hyperframes-based video template for retro pixel deck motion design...",
     "triggers": ["hyperframes video template", "video template", "pixel motion deck", "retro presentation video", "Hyperframes 模板", "视频模板", "像素风动效"],
     "mode": "template",
     "surface": "video",
     "source": "built-in",
     "craftRequires": [],
     "platform": "desktop"
   }]
 }
 ```
 
 - **GET /api/skills/:id**: 获取单个技能详情
 - **GET /api/skills/:id/files**: 技能文件列表
 - **GET /api/skills/:id/assets/*splat**: 技能资源文件
 - **GET /api/skills/:id/example**: 技能示例
 - **PUT /api/skills/:id**: 更新技能
 - **DELETE /api/skills/:id**: 删除技能
 - **POST /api/skills/import**: 导入技能
 - **POST /api/skills/install**: 安装技能
 
 ### 2. GET /api/skills/:id/files (示例)
 
 - **参数**: path `:id` = `8-bit-orbit-video-template`
 - **返回值**:
 ```json
 {
   "files": [
     {"path": "assets", "kind": "directory", "size": null},
     {"path": "assets/template.html", "kind": "file", "size": 16529},
     {"path": "example.html", "kind": "file", "size": 1651},
     {"path": "references", "kind": "directory", "size": null},
     {"path": "references/checklist.md", "kind": "file", "size": 962},
     {"path": "SKILL.md", "kind": "file", "size": 2418}
   ]
 }
 ```
 
 ### 3. GET /api/design-templates
 
 设计模板列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "designTemplates": [{
     "id": "audio-jingle",
     "name": "audio-jingle",
     "description": "Audio generation skill — jingles, beds, voiceover, and sound effects...",
     "triggers": ["music", "jingle", "bed", "voiceover", "tts", "sound effect", "音乐", "配音", "音效"],
     "mode": "audio",
     "surface": "audio",
     "source": "built-in"
   }]
 }
 ```
 
 - **GET /api/design-templates/:id**: 获取单个设计模板详情
 
 ### 4. GET /api/prompt-templates
 
 提示词模板列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "promptTemplates": [{
     "id": "3d-stone-staircase-evolution-infographic",
     "surface": "image",
     "title": "3D Stone Staircase Evolution Infographic",
     "summary": "Transforms a flat evolutionary timeline into a realistic 3D stone staircase infographic...",
     "category": "Infographic",
     "tags": ["3d-render"]
   }]
 }
 ```
 
 - **GET /api/prompt-templates/:surface/:id**: 获取单个提示词模板
 
 ### 5. GET /api/atoms
 
 原子组件列表（UI 构建块）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "atoms": [
     {"id": "discovery-question-form", "label": "Discovery question form", "description": "Structured clarification for unresolved material requirements.", "status": "implemented", "taskKinds": ["new-generation", "tune-collab"]},
     {"id": "direction-picker", "label": "Direction picker", "description": "Optional 3-5 directions when explicitly requested.", "status": "implemented", "taskKinds": ["new-generation", "tune-collab"]},
     {"id": "todo-write", "label": "Todo write", "description": "TodoWrite-driven plan.", "status": "implemented"}
   ]
 }
 ```
 
 - **GET /api/atoms/:id**: 获取单个原子组件详情，包含 `skillBody` (Markdown 正文)
 
 ### 6. GET /api/agents
 
 AI 代理运行时列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "agents": [
     {
       "id": "amr",
       "name": "AMR",
       "bin": "vela",
       "streamFormat": "acp-json-rpc",
       "resumesSessionViaAcpLoad": true,
       "supportsCustomModel": false,
       "supportsImagePaths": true,
       "available": true,
       "path": "node_modules\\.bin\\vela.CMD"
     },
     {
       "id": "claude",
       "name": "Claude",
       "streamFormat": "stream-json",
       "available": true
     },
     {
       "id": "codex",
       "name": "Codex",
       "streamFormat": "text",
       "available": true
     }
   ]
 }
 ```
 
 - **POST /api/agents/:agentId/oauth-launch**: 启动 OAuth 登录（需要本地 Daemon）
 - **POST /api/agents/:agentId/companion/install**: 安装伴侣工具（需要本地 Daemon）
 
 ---
 
 ## 六、插件类接口
 
 ### 1. GET /api/plugins
 
 插件列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "plugins": [{
     "id": "video-template-3d-animated-boy-building-lego",
     "title": "3D Animated Boy Building Lego",
     "version": "0.1.0",
     "sourceKind": "bundled",
     "source": "E:\\workspace\\...\\plugins\\_official\\video-templates\\3d-animated-boy-building-lego",
     "sourceMarketplaceId": "official",
     "marketplaceTrust": "official"
   }]
 }
 ```
 
 - **GET /api/plugins/:id**: 获取单个插件详情
 - **GET /api/plugins/:id/preview**: 插件预览
 - **GET /api/plugins/:id/example/:name**: 插件示例
 - **GET /api/plugins/:id/asset/*splat**: 插件资源文件
 - **POST /api/plugins/upload-zip**: 上传 ZIP 插件
 - **POST /api/plugins/upload-folder**: 上传文件夹插件
 - **POST /api/plugins/install**: 安装插件
 - **POST /api/plugins/:id/uninstall**: 卸载插件
 - **POST /api/plugins/:id/upgrade**: 升级插件
 - **POST /api/plugins/:id/apply-local**: 本地应用插件
 - **POST /api/plugins/:id/apply**: 应用插件
 - **POST /api/plugins/:id/duplicate-project**: 复制项目（需要本地 Daemon）
 - **POST /api/plugins/:id/share-project**: 分享项目
 - **POST /api/plugins/:id/doctor**: 诊断插件
 - **POST /api/plugins/:id/trust**: 信任插件
 
 ### 2. GET /api/plugins/stats
 
 插件统计。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "plugins": {
     "total": 460,
     "bySourceKind": {"bundled": 460},
     "byTrust": {"bundled": 460},
     "byTaskKind": {"new-generation": 452, "code-migration": 1, "tune-collab": 5, "figma-migration": 2},
     "withElevatedCapabilities": 363,
     "bundled": 460,
     "thirdParty": 0,
     "lastInstalledAt": 1787827451697
   },
   "snapshots": {"total": 0, "byStatus": {}, "withProject": 0, "withRun": 0}
 }
 ```
 
 ### 3. GET /api/plugins/events/snapshot
 
 插件事件快照。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"events": [], "count": 0, "generatedAt": 1787830742147}
 ```
 
 - **GET /api/plugins/events/stats**: 插件事件统计
 - **GET /api/plugins/events (SSE)**: 插件事件流
 - **POST /api/plugins/events/purge**: 清除插件事件（需要本地 Daemon）
 
 ### 4. GET /api/marketplaces
 
 插件市场列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "marketplaces": [{
     "id": "community",
     "url": "https://raw.githubusercontent.com/nexu-io/open-design/main/plugins/registry/community/open-design-marketplace.json",
     "specVersion": "1.0.0",
     "version": "0.2.10",
     "trust": "restricted"
   }]
 }
 ```
 
 - **POST /api/marketplaces**: 添加市场
 - **GET /api/marketplaces/:id**: 获取单个市场
 - **DELETE /api/marketplaces/:id**: 删除市场
 - **POST /api/marketplaces/:id/refresh**: 刷新市场
 - **POST /api/marketplaces/:id/trust**: 信任市场
 - **GET /api/marketplaces/:id/plugins**: 获取市场插件列表
 
 ### 5. 应用快照接口
 
 - **GET /api/applied-plugins**: 已应用插件快照列表
 - **GET /api/applied-plugins/:snapshotId**: 获取单个快照
 - **GET /api/applied-plugins/:snapshotId/canon**: 获取规范快照
 - **GET /api/projects/:projectId/applied-plugins**: 项目级已应用插件
 - **POST /api/applied-plugins/prune**: 清理快照（需要本地 Daemon）
 
 ### 6. 插件候选接口
 
 - **GET /api/projects/:id/plugin-candidates**: 项目插件候选列表
 - **POST /api/projects/:id/plugin-candidates/:candidateId/dismiss**: 忽略候选
 - **POST /api/projects/:id/plugin-candidates/:candidateId/draft**: 草拟候选
 - **POST /api/projects/:id/plugin-candidates/:candidateId/share-tasks**: 分享任务
 - **POST /api/projects/:id/plugins/contribute-open-design**: 贡献到 OpenDesign
 - **POST /api/projects/:id/plugins/share-tasks**: 分享任务
 - **POST /api/projects/:id/plugins/install-folder**: 安装文件夹插件
 - **POST /api/projects/:id/plugins/publish-github**: 发布到 GitHub
 - **POST /api/plugins/share-tasks/:id/wait**: 等待分享任务完成
 
 ### 7. GET /api/asset-cache
 
 资源缓存代理。
 
 - **参数**: query `url` (必需)
 - **返回值**: 代理请求的 URL 内容
 
 ---
 
 ## 七、品牌类接口
 
 ### 1. GET /api/brands
 
 品牌列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"brands": []}
 ```
 
 - **POST /api/brands**: 创建品牌
 - **GET /api/brands/:id**: 获取单个品牌
 - **DELETE /api/brands/:id**: 删除品牌
 - **GET /api/brands/:id/logo**: 获取品牌 Logo
 - **POST /api/brands/:id/preview**: 品牌预览
 - **POST /api/brands/:id/finalize**: 完成品牌提取
 - **POST /api/brands/:id/continue-extraction**: 继续品牌提取
 - **POST /api/brands/:id/cancel-extraction**: 取消品牌提取
 - **POST /api/brands/:id/extract-from-html**: 从 HTML 提取品牌
 
 ---
 
 ## 八、媒体与生成类接口
 
 ### 1. GET /api/media/config
 
 媒体提供商配置。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "providers": {
     "openai": {"configured": true, "source": "codex-auth", "apiKeyTail": "", "baseUrl": ""},
     "vela": {"configured": false, "source": "unset"},
     "volcengine": {"configured": false, "source": "unset"},
     "grok": {"configured": false, "source": "unset"},
     "hyperframes": {"configured": false, "source": "unset"},
     "nanobanana": {"configured": false, "source": "unset"},
     "imagerouter": {"configured": false, "source": "unset"}
   }
 }
 ```
 
 - **PUT /api/media/config**: 更新媒体配置
 
 ### 2. GET /api/media/models
 
 媒体生成模型列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "providers": [
     {"id": "openai", "label": "OpenAI", "hint": "gpt-image-2 / dall-e-3", "integrated": true, "defaultBaseUrl": "https://api.openai.com/v1"},
     {"id": "vela", "label": "OpenDesign Cloud", "hint": "Managed image and video generation through Vela", "integrated": true, "credentialsRequired": false},
     {"id": "volcengine", "label": "Volcengine Ark (Doubao)", "hint": "Seedance 2.0 / Seedream", "integrated": true},
     {"id": "grok", "label": "xAI", "hint": "Grok image generation", "integrated": true}
   ]
 }
 ```
 
 ### 3. GET /api/media/providers/aihubmix/models
 
 AIHubMix 模型列表。
 
 - **参数**: 无（需要配置 API key）
 - **返回值**: 错误（未配置 key）
 
 ### 4. GET /api/media/providers/elevenlabs/voices
 
 ElevenLabs 语音列表。
 
 - **参数**: 无（需要配置 API key）
 - **返回值**:
 ```json
 {"error": "no ElevenLabs API key - configure it in Settings or set OD_ELEVENLABS_API_KEY"}
 ```
 
 ### 5. POST /api/projects/:id/media/generate
 
 生成媒体（图片/视频/音频）。
 
 - **参数**: body `{provider, model, prompt, ...}`, path `:id` (项目 ID)
 - **返回值**: `{taskId, status, ...}`
 
 - **GET /api/projects/:id/media/tasks**: 获取媒体任务列表
 - **POST /api/projects/:id/media/hyperframes/scaffold**: 创建 Hyperframes 骨架
 - **POST /api/media/tasks/:id/wait**: 等待媒体任务完成
 
 ### 6. POST /api/tools/media/generate
 
 工具接口：生成媒体（需要 tool token）。
 
 - **参数**: body `{provider, model, prompt, ...}`, Header `x-od-tool-token`
 - **返回值**: 生成结果
 
 ### 7. POST /api/research/search
 
 研究搜索接口。
 
 - **参数**: body `{query, ...}`
 - **返回值**: `{results: [...]}`
 
 ### 8. POST /api/orbit/run
 
 手动运行 Orbit。
 
 - **参数**: body `{...}`
 - **返回值**: `{ok: true, ...}`
 
 ### 9. GET /api/orbit/status
 
 Orbit 状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "config": {"enabled": false, "time": "08:00", "templateSkillId": "orbit-general", "workspaceScope": null},
   "running": false,
   "nextRunAt": null,
   "lastRun": null,
   "lastRunsByTemplate": {}
 }
 ```
 
 ---
 
 ## 九、AI 代理流接口
 
 ### 1. POST /api/chat
 
 核心聊天接口（SSE 流式响应）。
 
 - **参数**: body `{projectId, prompt, agentId, model, designSystemId, skillId, ...}`
 - **返回值**: SSE 流，事件类型:
   - `text_delta`: `{text: "..."}`
   - `tool_use`: `{tool: "...", input: {...}}`
   - `tool_result`: `{tool: "...", output: "..."}`
   - `turn_end`: `{stop_reason: "..."}`
   - `usage`: `{input_tokens, output_tokens, ...}`
   - `error`: `{message: "..."}`
 
 ### 2. POST /api/proxy/:provider/stream
 
 AI 代理流接口（直连模式）。
 
 - **参数**: body `{model, messages, ...}`, path `:provider` = `openai|anthropic|azure|google|ollama`
 - **返回值**: SSE 流
 
 ### 3. POST /api/provider/models
 
 获取提供商模型列表。
 
 - **参数**: body `{provider, apiKey, baseUrl}`
 - **返回值**: `{models: [{id, name, ...}]}`
 
 ### 4. POST /api/test/connection
 
 测试提供商连接。
 
 - **参数**: body `{provider, apiKey, baseUrl}`
 - **返回值**: `{ok: true}` 或 `{ok: false, error: "..."}`
 
 ---
 
 ## 十、记忆类接口
 
 ### 1. GET /api/memory
 
 记忆系统状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "enabled": true,
   "chatExtractionEnabled": false,
   "profileEnabled": true,
   "rewriteEnabled": true,
   "verifyEnabled": true,
   "rootDir": "E:\\workspace\\...\\.od\\memory",
   "index": "# Memory\n\nThis is your auto-memory index...",
   "entries": [],
   "extraction": null
 }
 ```
 
 - **POST /api/memory**: 创建记忆条目
 
 ### 2. GET /api/memory/tree
 
 记忆树结构。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "enabled": true,
   "rootDir": "E:\\workspace\\...\\.od\\memory",
   "tree": [
     {"id": "folder:profile", "parentId": null, "path": "/profile", "name": "Profile", "kind": "folder", "type": "profile", "scope": "global", "childrenCount": 0},
     {"id": "folder:user", "parentId": null, "path": "/user", "name": "User", "kind": "folder", "type": "user", "scope": "global", "childrenCount": 0}
   ]
 }
 ```
 
 - **PATCH /api/memory/tree/:id**: 更新记忆树节点
 
 ### 3. GET /api/memory/:id
 
 获取单个记忆条目。
 
 - **参数**: path `:id`
 - **返回值**: 记忆条目详情
 
 - **PUT /api/memory/:id**: 更新记忆条目
 - **DELETE /api/memory/:id**: 删除记忆条目
 
 ### 4. GET /api/memory/extractions
 
 记忆提取列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"extractions": []}
 ```
 
 - **DELETE /api/memory/extractions**: 清除所有提取
 - **DELETE /api/memory/extractions/:id**: 删除单个提取
 
 ### 5. GET /api/memory/verifications
 
 记忆验证列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"verifications": []}
 ```
 
 - **DELETE /api/memory/verifications**: 清除所有验证
 - **DELETE /api/memory/verifications/:id**: 删除单个验证
 
 ### 6. GET /api/memory/system-prompt
 
 记忆系统提示词。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"body": ""}
 ```
 
 ### 7. GET /api/memory/events (SSE)
 
 记忆事件流。
 
 - **参数**: 无
 - **返回值**: SSE 流
 
 ### 8. 其他记忆接口
 
 - **PATCH /api/memory/config**: 更新记忆配置
 - **PUT /api/memory/index**: 更新记忆索引
 - **POST /api/memory/extract**: 手动提取记忆
 - **POST /api/memory/rules/suggest**: 建议记忆规则
 - **POST /api/memory/connectors/extract**: 从连接器提取（需要本地 Daemon）
 - **POST /api/memory/connectors/suggest**: 建议连接器（需要本地 Daemon）
 
 ---
 
 ## 十一、MCP 接口
 
 ### 1. GET /api/mcp/install-info
 
 MCP 安装信息。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "command": "d:\\nvm\\nodejs\\node.exe",
   "args": ["E:\\workspace\\...\\apps\\daemon\\dist\\cli.js", "mcp"],
   "env": {
     "OD_DATA_DIR": "E:\\workspace\\...\\.od",
     "OD_SIDECAR_IPC_PATH": "\\\\.\\pipe\\hi-design-default-daemon"
   },
   "daemonUrl": "http://127.0.0.1:56514",
   "webBaseUrl": "http://127.0.0.1:60202",
   "platform": "win32",
   "cliExists": true,
   "nodeExists": true,
   "buildHint": null
 }
 ```
 
 ### 2. GET /api/mcp/servers
 
 MCP 服务器列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "servers": [],
   "templates": [{
     "id": "higgsfield-openclaw",
     "label": "Higgsfield (OpenClaw)",
     "description": "Image and video generation MCP from higgsfield.ai...",
     "transport": "http",
     "authMode": "oauth",
     "category": "image-generation"
   }]
 }
 ```
 
 - **PUT /api/mcp/servers**: 更新 MCP 服务器配置
 
 ### 3. GET /api/mcp/oauth/status
 
 MCP OAuth 状态。
 
 - **参数**: query `serverId` (必需)
 - **返回值**: `{connected: boolean, ...}` 或 `{error: "serverId is required"}`
 
 - **POST /api/mcp/oauth/start**: 启动 MCP OAuth
 - **GET /api/mcp/oauth/callback**: OAuth 回调
 - **POST /api/mcp/oauth/disconnect**: 断开 MCP OAuth
 
 ### 4. MCP Codex 安装
 
 - **GET /api/mcp/install/codex/status**: Codex MCP 安装状态
 - **POST /api/mcp/install/codex**: 安装到 Codex
 - **DELETE /api/mcp/install/codex**: 从 Codex 卸载
 
 ---
 
 ## 十二、连接器类接口
 
 ### 1. GET /api/connectors
 
 连接器列表（Composio 集成）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "connectors": [{
     "id": "github",
     "name": "GitHub",
     "provider": "composio",
     "category": "Developer",
     "description": "Search and inspect GitHub repositories, issues, and pull requests.",
     "status": "available",
     "tools": [{
       "name": "github.github_search_repositories",
       "title": "Search repositories",
       "description": "Search public and private repositories.",
       "inputSchemaJson": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
       "safety": {"sideEffect": "read", "approval": "auto"}
     }],
     "toolCount": 2,
     "auth": {"provider": "composio", "configured": false}
   }]
 }
 ```
 
 ### 2. GET /api/connectors/status
 
 所有连接器状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "statuses": {
     "github": {"status": "available"},
     "notion": {"status": "available"},
     "google_drive": {"status": "available"},
     "airtable": {"status": "available"},
     "asana": {"status": "available"},
     "clickup": {"status": "available"},
     "confluence": {"status": "available"},
     "slack": {"status": "available"}
   }
 }
 ```
 
 ### 3. GET /api/connectors/discovery
 
 连接器发现（同 connectors 列表）。
 
 - **参数**: 无
 - **返回值**: 同 GET /api/connectors
 
 ### 4. GET /api/connectors/:connectorId
 
 获取单个连接器详情。
 
 - **参数**: path `:connectorId` = `github`
 - **返回值**: 连接器完整信息（含工具列表）
 
 ### 5. GET /api/connectors/logos/:slug
 
 获取连接器 Logo（SVG 格式）。
 
 - **参数**: path `:slug` = `github`
 - **返回值**: SVG 图片 (`<svg width="128" height="128"...>`)
 
 ### 6. GET /api/connectors/composio/config
 
 Composio 配置状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"configured": false, "apiKeyTail": ""}
 ```
 
 - **PUT /api/connectors/composio/config**: 更新 Composio 配置（需要本地 Daemon）
 
 ### 7. 连接器认证接口
 
 - **POST /api/connectors/auth-configs/prepare**: 准备认证配置（需要本地 Daemon）
 - **POST /api/connectors/:connectorId/connect**: 连接连接器（需要本地 Daemon）
 - **GET /api/connectors/oauth/callback/:connectorId**: OAuth 回调
 - **POST /api/connectors/:connectorId/authorization/cancel**: 取消授权
 - **DELETE /api/connectors/:connectorId/connection**: 断开连接（需要本地 Daemon）
 
 ### 8. 工具连接器接口
 
 - **GET /api/tools/connectors/list**: 工具连接器列表（需要 tool token）
 - **POST /api/tools/connectors/execute**: 执行连接器工具（需要 tool token）
 
 ---
 
 ## 十三、工作区与协作类接口
 
 ### 1. GET /api/workspace/directory
 
 工作区目录（已登录用户的工作区列表）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "items": [
     {
       "workspaceId": "ww9pzftmmqux8grn4im25v94",
       "workspaceName": "测试团队",
       "workspaceType": "team",
       "workspaceMemberId": "su4iqloxqpvz32izn8ibnnlq",
       "role": "owner",
       "memberStatus": "active",
       "lifecycleState": "active",
       "workspaceIconKey": "spark"
     },
     {
       "workspaceId": "tljbioajfmjv52wm1h86ybow",
       "workspaceName": "ybvichi's workspace",
       "workspaceType": "personal",
       "workspaceMemberId": "vdh1gofde9m0i7ngpnb9b6rk",
       "role": "owner",
       "memberStatus": "active",
       "lifecycleState": "active",
       "workspaceIconKey": "person"
     }
   ],
   "activeWorkspaceId": null
 }
 ```
 
 ### 2. GET /api/workspace/context
 
 工作区上下文（需要工作区头）。
 
 - **参数**: Header `x-od-workspace-id`, `x-od-workspace-member-id`, `x-od-workspace-type`
 - **返回值**:
 ```json
 {
   "context": {
     "workspaceId": "ww9pzftmmqux8grn4im25v94",
     "workspaceType": "team",
     "workspaceMemberId": "su4iqloxqpvz32izn8ibnnlq",
     "role": "member",
     "memberStatus": "active",
     "lifecycleState": "active",
     "billingState": "active",
     "planId": null,
     "providerMode": "platform_credits",
     "seatSummary": {"seatLimit": 0, "usedSeats": 0, "availableSeats": 0, "isSeatFull": true},
     "permissions": {
       "canManageMembers": false,
       "canManageBilling": false,
       "canInviteMembers": false,
       "canShareProjects": true,
       "canWriteSyncedFiles": true,
       "canViewWorkspaceSettings": true
     }
   }
 }
 ```
 
 - **PUT /api/workspace/context**: 更新工作区上下文
 - **PUT /api/workspace/active**: 设置活跃工作区
 
 ### 3. GET /api/workspace/members
 
 工作区成员列表（需要工作区头）。
 
 - **参数**: Header `x-od-workspace-id`, `x-od-workspace-member-id`
 - **返回值**:
 ```json
 {"members": []}
 ```
 
 ### 4. GET /api/workspace/projects/team
 
 团队项目列表（需要工作区头）。
 
 - **参数**: Header `x-od-workspace-id`, `x-od-workspace-member-id`
 - **返回值**:
 ```json
 {"projects": []}
 ```
 
 ### 5. GET /api/workspace/events (SSE)
 
 工作区事件流（需要工作区头）。
 
 - **参数**: Header `x-od-workspace-id`, `x-od-workspace-member-id`
 - **返回值**: SSE 流
 
 ### 6. GET /api/workspace/billing
 
 工作区计费信息（需要工作区头）。
 
 - **参数**: Header `x-od-workspace-id`, query `scope`
 - **返回值**: `{error: "invalid_billing_scope"}` (需要正确的 scope 参数)
 
 - **GET /api/workspace/billing/catalog**: 计费目录
 - **POST /api/workspace/billing/checkout**: 结账
 - **PUT /api/workspace/billing/interests/:clientId**: 设置计费意向
 - **DELETE /api/workspace/billing/interests/:clientId**: 删除计费意向
 
 ### 7. 工作区邀请
 
 - **POST /api/workspace/invite**: 邀请成员
 - **POST /api/workspace/invite/continue**: 继续邀请流程
 
 ### 8. 工作区资源
 
 - **GET /api/workspace/resources/:kind/:id/state**: 获取资源状态
 - **PUT /api/workspace/resources/:kind/:id/state**: 更新资源状态
 - **POST /api/workspace/resources/:kind/:id/copy-check**: 复制检查
 
 ### 9. 协作同步接口
 
 - **GET /api/projects/:id/collab/status**: 协作同步状态
 - **PUT /api/projects/:id/collab/bootstrap**: 初始化协作
 - **POST /api/projects/:id/collab/publish**: 发布变更
 - **POST /api/projects/:id/collab/pull**: 拉取变更
 - **POST /api/projects/:id/collab/changed**: 检查变更
 - **POST /api/projects/:id/collab/sync-intent**: 同步意图
 
 ### 10. 协作 Presence 接口
 
 - **GET /api/projects/:id/presence**: 获取在线状态
 - **POST /api/projects/:id/presence/heartbeat**: 心跳
 - **POST /api/projects/:id/presence/leave**: 离开
 
 ---
 
 ## 十四、自动化与例程类接口
 
 ### 1. GET /api/routines
 
 例程列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"routines": []}
 ```
 
 - **POST /api/routines**: 创建例程
 - **GET /api/routines/:id**: 获取单个例程
 - **PATCH /api/routines/:id**: 更新例程
 - **DELETE /api/routines/:id**: 删除例程
 - **POST /api/routines/:id/run**: 执行例程
 - **GET /api/routines/:id/runs**: 获取例程运行列表
 - **POST /api/routines/:id/runs/:runId/crystallize**: 固化运行结果
 
 ### 2. GET /api/automation-templates
 
 自动化模板列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "templates": [{
     "id": "ingest-source-memory-tree",
     "title": "Ingest source into memory tree",
     "description": "Turn uploaded, URL, repo, connector, artifact, or chat content into reviewable memory nodes.",
     "purpose": "Keep durable project and user knowledge available to future agent runs.",
     "triggerKinds": ["manual", "schedule", "connector"],
     "sourceKinds": ["upload", "url", "repo", "connector", "artifact", "chat"]
   }]
 }
 ```
 
 - **GET /api/automation-templates/:id**: 获取单个模板详情
 
 ### 3. GET /api/automation-proposals
 
 自动化提案列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"proposals": []}
 ```
 
 - **POST /api/automation-proposals**: 创建提案
 - **GET /api/automation-proposals/:id**: 获取单个提案
 - **POST /api/automation-proposals/:id/apply**: 应用提案
 - **POST /api/automation-proposals/:id/reject**: 拒绝提案
 
 ### 4. GET /api/automation-source-packets
 
 自动化源数据包列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"packets": []}
 ```
 
 - **GET /api/automation-source-packets/:id**: 获取单个数据包
 - **POST /api/automation-ingestions**: 创建摄取任务
 
 ---
 
 ## 十五、资源库类接口
 
 ### 1. GET /api/library/connection
 
 资源库连接状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"paired": false, "tokens": []}
 ```
 
 ### 2. GET /api/library/clipper-probe
 
 资源库剪藏探针。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"ok": true}
 ```
 
 ### 3. GET /api/library/assets
 
 资源库资产列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "assets": [{
     "id": "8da4d1e2-8b27-45e3-8764-763ac5e0d4d1",
     "kind": "image",
     "storage": "referenced",
     "capturedAt": 1787820862098,
     "archivedDate": "2026-08-27",
     "contentHash": "8b6cd7e3776adfb2313b44cd4a14723a9fe8bd00978917044158665f042aa9c7",
     "tags": [],
     "sources": [{
       "id": "e164dd30-fe57-4606-aead-49a773e17622",
       "assetId": "8da4d1e2-8b27-45e3-8764-763ac5e0d4d1",
       "sourceKind": "manual-upload",
       "createdAt": 1787829856580,
       "projectId": "e2c72464-dea5-4b11-872a-51d3418ead44",
       "relPath": "assets/about.png"
     }],
     "sourceTitle": "assets/about.png",
     "mime": "image/png",
     "width": 1024,
     "height": 1024
   }]
 }
 ```
 
 - **GET /api/library/assets/:id**: 获取单个资产
 - **GET /api/library/assets/:id/raw**: 获取资产原始文件
 - **GET /api/library/assets/:id/element**: 获取资产元素
 - **GET /api/library/assets/:id/figma**: 获取 Figma 资产
 - **DELETE /api/library/assets/:id**: 删除资产（需要本地 Daemon）
 - **POST /api/library/assets/:id/apply**: 应用资产（需要本地 Daemon）
 - **POST /api/library/assets/:id/edit-as-page**: 编辑为页面（需要本地 Daemon）
 
 ### 4. GET /api/library/events (SSE)
 
 资源库事件流。
 
 - **参数**: 无
 - **返回值**: SSE 流
 
 ### 5. 其他资源库接口
 
 - **POST /api/library/ingest**: 摄取资源
 - **POST /api/library/pair**: 配对（需要本地 Daemon）
 - **POST /api/library/pair/confirm**: 确认配对
 - **POST /api/library/sync**: 同步（需要本地 Daemon）
 
 ### 6. 工具资源库接口
 
 - **POST /api/tools/library/search**: 搜索资源（需要 tool token）
 - **POST /api/tools/library/apply**: 应用资源（需要 tool token）
 
 ---
 
 ## 十六、Live Artifact 类接口
 
 ### 1. GET /api/live-artifacts
 
 Live Artifact 列表。
 
 - **参数**: query `projectId` (必需)
 - **返回值**:
 ```json
 {"error": {"code": "BAD_REQUEST", "message": "projectId query parameter is required"}}
 ```
 
 - **GET /api/live-artifacts/:artifactId**: 获取单个 Artifact
 - **PATCH /api/live-artifacts/:artifactId**: 更新 Artifact
 - **DELETE /api/live-artifacts/:artifactId**: 删除 Artifact
 - **GET /api/live-artifacts/:artifactId/preview**: 预览 Artifact（需要本地 Daemon）
 - **POST /api/live-artifacts/:artifactId/refresh**: 刷新 Artifact（需要本地 Daemon）
 - **GET /api/live-artifacts/:artifactId/refreshes**: 获取刷新列表
 
 ### 2. 工具 Live Artifact 接口
 
 - **GET /api/tools/live-artifacts/list**: 列表（需要 tool token）
 - **POST /api/tools/live-artifacts/create**: 创建（需要 tool token）
 - **POST /api/tools/live-artifacts/update**: 更新（需要 tool token）
 - **POST /api/tools/live-artifacts/refresh**: 刷新（需要 tool token）
 
 ---
 
 ## 十七、部署类接口
 
 ### 1. GET /api/deploy/config
 
 部署配置。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "providerId": "vercel-self",
   "configured": true,
   "tokenMask": "saved-vercel-token",
   "teamId": "",
   "teamSlug": "",
   "target": "preview"
 }
 ```
 
 - **PUT /api/deploy/config**: 更新部署配置
 
 ### 2. GET /api/deploy/cloudflare-pages/zones
 
 Cloudflare Pages 区域列表。
 
 - **参数**: 无（需要 CF API token）
 - **返回值**:
 ```json
 {"error": {"code": "CF_TOKEN_REQUIRED", "message": "Cloudflare API token is required."}}
 ```
 
 ### 3. POST /api/projects/:id/deploy
 
 部署项目。
 
 - **参数**: body `{provider, ...}`, path `:id`
 - **返回值**: `{url, deploymentId, ...}`
 
 - **POST /api/projects/:id/deploy/preflight**: 部署预检
 - **GET /api/projects/:id/deployments**: 获取部署列表
 
 ---
 
 ## 十八、终端类接口
 
 ### 1. POST /api/projects/:id/terminals
 
 创建终端会话。
 
 - **参数**: body `{cwd, ...}`, path `:id`
 - **返回值**: `{sessionId, ...}`
 
 ### 2. GET /api/projects/:id/terminals
 
 终端会话列表。
 
 - **参数**: path `:id`
 - **返回值**: `{terminals: [{sessionId, ...}]}`
 
 ### 3. GET /api/projects/:id/terminals/:tid/stream (SSE)
 
 终端输出流。
 
 - **参数**: path `:id`, `:tid` (终端 ID)
 - **返回值**: SSE 流，输出终端数据
 
 ### 4. 其他终端接口
 
 - **DELETE /api/projects/:id/terminals/:tid**: 删除终端
 - **POST /api/projects/:id/terminals/:tid/kill**: 终止终端
 - **POST /api/projects/:id/terminals/:tid/resize**: 调整终端大小
 - **POST /api/projects/:id/terminals/:tid/stdin**: 发送输入
 
 ---
 
 ## 十九、其他接口
 
 ### 1. GET /api/codex-pets
 
 Codex 宠物列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "pets": [{
     "id": "yorha-sit-2b",
     "displayName": "YoRHa Sit-2B",
     "description": "A calm seated chibi YoRHa-style coding companion with a tiny Emil head perched on her shoulder.",
     "spritesheetUrl": "/api/codex-pets/yorha-sit-2b/spritesheet",
     "spritesheetExt": "webp",
     "hatchedAt": 1787820857215,
     "bundled": true
   }]
 }
 ```
 
 - **GET /api/codex-pets/:id/spritesheet**: 获取宠物精灵表（WebP 图片）
 - **POST /api/codex-pets/sync**: 同步宠物
 
 ### 2. GET /api/editors
 
 编辑器列表。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "editors": [
     {"id": "cursor", "label": "Cursor", "icon": "sparkles", "available": false},
     {"id": "vscode", "label": "VS Code", "icon": "file-code", "available": true, "resolvedPath": "D:\\Microsoft VS Code\\bin/code.cmd"},
     {"id": "windsurf", "label": "Windsurf", "icon": "sparkles", "available": false},
     {"id": "zed", "label": "Zed", "icon": "edit", "available": false},
     {"id": "webstorm", "label": "WebStorm", "icon": "edit", "available": false},
     {"id": "idea", "label": "IntelliJ IDEA", "icon": "edit", "available": false}
   ]
 }
 ```
 
 - **POST /api/projects/:id/open-in**: 在编辑器中打开项目
 
 ### 3. GET /api/whats-new
 
 更新日志。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"version": "0.20.3", "id": null, "content": null}
 ```
 
 ### 4. GET /api/community/discord
 
 Discord 社区信息。
 
 - **参数**: 无
 - **返回值**: 502 Bad Gateway（外部服务不可用）
 
 ### 5. GET /api/github/open-design
 
 OpenDesign GitHub 仓库信息。
 
 - **参数**: 无
 - **返回值**: 502 Bad Gateway（外部服务不可用）
 
 - **GET /api/github/open-design/releases/latest**: 最新发布版本
 
 ### 6. POST /api/social-share
 
 社交分享。
 
 - **参数**: body `{platform, url, ...}`
 - **返回值**: `{ok: true}`
 
 ### 7. GET /api/analytics/config
 
 分析配置。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"enabled": false, "env": "development", "key": null, "host": null}
 ```
 
 - **POST /api/observability/event**: 发送可观测性事件
 - **POST /api/analytics/mcp/context**: 发送 MCP 上下文分析
 - **POST /api/analytics/mcp/event**: 发送 MCP 事件分析
 
 ### 8. Vela (AMR) 集成接口
 
 #### GET /api/integrations/vela/status
 
 Vela 登录状态（已登录）。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "loggedIn": true,
   "loginInFlight": false,
   "profile": "prod",
   "user": {
     "id": "ahcneo83tesu0t0ntulp2n4f",
     "email": "3858516840@qq.com",
     "name": "ybvichi",
     "image": "https://avatars.githubusercontent.com/u/317187511?v=4"
   },
   "configPath": "C:\\Users\\yebo\\.amr\\config.json"
 }
 ```
 
 #### GET /api/integrations/vela/wallet
 
 Vela 钱包余额。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {
   "status": "available",
   "profile": "prod",
   "user": {"id": "ahcneo83tesu0t0ntulp2n4f", "email": "3858516840@qq.com", "name": "ybvichi"},
   "balanceUsd": "0.0000",
   "codingPlanModels": [],
   "updatedAt": null,
   "fetchedAt": "2026-08-27T11:39:02.938Z",
   "stale": false,
   "source": "vela_api"
 }
 ```
 
 #### GET /api/integrations/vela/message-center-public/messages
 
 Vela 消息中心。
 
 - **参数**: 无
 - **返回值**: 500 Internal Server Error
 
 #### GET /api/amr/models
 
 AMR 模型列表。
 
 - **参数**: 无
 - **返回值**: 500 Internal Server Error（vela CLI 路径未找到）
 
 #### 其他 Vela 接口
 
 - **POST /api/integrations/vela/login**: Vela 登录
 - **POST /api/integrations/vela/login/cancel**: 取消登录
 - **POST /api/integrations/vela/logout**: Vela 登出
 - **POST /api/integrations/vela/analytics-entry**: 分析条目
 - **POST /api/integrations/vela/analytics-profile**: 分析配置
 
 ### 9. xAI 集成接口
 
 #### GET /api/xai/auth/status
 
 xAI 认证状态。
 
 - **参数**: 无
 - **返回值**:
 ```json
 {"connected": false, "listening": false}
 ```
 
 - **POST /api/xai/oauth/start**: 启动 xAI OAuth
 - **POST /api/xai/oauth/complete**: 完成 xAI OAuth
 - **POST /api/xai/oauth/cancel**: 取消 xAI OAuth
 - **POST /api/xai/oauth/disconnect**: 断开 xAI OAuth
 - **POST /api/xai/search**: xAI 搜索
 
 ### 10. GenUI 接口
 
 - **GET /api/projects/:projectId/genui**: 获取 GenUI 状态
 - **GET /api/runs/:runId/genui**: 获取运行 GenUI
 - **GET /api/runs/:runId/genui/:surfaceId**: 获取特定界面 GenUI
 - **POST /api/runs/:runId/genui/:surfaceId/respond**: 响应 GenUI
 - **POST /api/projects/:projectId/genui/prefill**: 预填充 GenUI
 - **POST /api/projects/:projectId/genui/:surfaceId/revoke**: 撤销 GenUI
 - **GET /api/runs/:runId/devloop-iterations**: 获取 DevLoop 迭代
 - **POST /api/runs/:runId/replay**: 重放运行
 
 ### 11. 浏览器会话接口
 
 - **POST /api/projects/:id/browser-sessions**: 创建浏览器会话
 - **DELETE /api/projects/:id/browser-sessions/:sessionId**: 删除浏览器会话
 
 ### 12. Handoff 接口
 
 - **POST /api/projects/:id/handoff**: 项目交接
 
 ---
 
 ## 附录 A：页面加载时的主要接口调用顺序
 
 当用户访问 `http://127.0.0.1:56515/` 时，前端 Next.js 应用在客户端渲染后依次调用以下接口：
 
 1. `GET /api/health` - 健康检查
 2. `GET /api/version` - 版本信息
 3. `GET /api/app-config` - 应用配置
 4. `GET /api/workspace/directory` - 工作区目录
 5. `GET /api/project-locations` - 项目位置
 6. `GET /api/projects` - 项目列表
 7. `GET /api/design-systems` - 设计体系
 8. `GET /api/design-templates` - 设计模板
 9. `GET /api/skills` - 技能列表
 10. `GET /api/plugins` - 插件列表
 11. `GET /api/connectors` - 连接器
 12. `GET /api/connectors/status` - 连接器状态
 13. `GET /api/media/config` - 媒体配置
 14. `GET /api/memory` - 记忆状态
 15. `GET /api/memory/tree` - 记忆树
 16. `GET /api/mcp/servers` - MCP 服务器
 17. `GET /api/mcp/install-info` - MCP 安装信息
 18. `GET /api/marketplaces` - 插件市场
 19. `GET /api/library/connection` - 资源库连接
 20. `GET /api/library/assets` - 资源库资产
 21. `GET /api/codex-pets` - 宠物
 22. `GET /api/editors` - 编辑器
 23. `GET /api/prompt-templates` - 提示词模板
 24. `GET /api/automation-templates` - 自动化模板
 25. `GET /api/routines` - 例程
 26. `GET /api/orbit/status` - Orbit 状态
 27. `GET /api/integrations/vela/status` - Vela 状态
 28. `GET /api/xai/auth/status` - xAI 认证状态
 29. `GET /api/deploy/config` - 部署配置
 30. `GET /api/analytics/config` - 分析配置
 31. `GET /api/whats-new` - 更新日志
 32. `GET /api/recent-dirs` - 最近目录
 33. `GET /api/brands` - 品牌列表
 34. `GET /api/templates` - 项目模板
 35. `GET /api/active` - 活跃状态
 36. `GET /api/preview/isolation` - 预览隔离
 37. `GET /api/plugins/events/snapshot` - 插件事件快照
 38. `GET /api/plugins/stats` - 插件统计
 
 ## 附录 B：SSE 流式接口
 
 以下接口返回 Server-Sent Events 流：
 
 - `GET /api/projects/:id/events` - 项目事件流
 - `GET /api/runs/:id/events` - Run 事件流
 - `GET /api/workspace/events` - 工作区事件流
 - `GET /api/memory/events` - 记忆事件流
 - `GET /api/library/events` - 资源库事件流
 - `GET /api/plugins/events` - 插件事件流
 - `GET /api/projects/:id/terminals/:tid/stream` - 终端输出流
 - `POST /api/chat` - 聊天 SSE 流
 - `POST /api/proxy/*/stream` - AI 代理 SSE 流
 
 ## 附录 C：需要本地 Daemon 的接口
 
 以下接口标记了 `requireLocalDaemonRequest`，仅允许来自本地环境的请求：
 
 - `POST /api/agents/:agentId/oauth-launch`
 - `POST /api/agents/:agentId/companion/install`
 - `POST /api/daemon/db/verify`
 - `POST /api/daemon/db/vacuum`
 - `POST /api/daemon/shutdown`
 - `POST /api/library/pair`
 - `POST /api/library/sync`
 - `DELETE /api/library/assets/:id`
 - `POST /api/library/assets/:id/apply`
 - `POST /api/library/assets/:id/edit-as-page`
 - `PUT /api/connectors/composio/config`
 - `POST /api/connectors/auth-configs/prepare`
 - `POST /api/connectors/:connectorId/connect`
 - `DELETE /api/connectors/:connectorId/connection`
 - `POST /api/memory/connectors/suggest`
 - `POST /api/memory/connectors/extract`
 - `POST /api/live-artifacts/:artifactId/refresh`
 - `GET /api/live-artifacts/:artifactId/preview`
 - `POST /api/plugins/events/purge`
 - `POST /api/applied-plugins/prune`
 - `POST /api/plugins/:id/duplicate-project`
 
 ## 附录 D：需要 Tool Token 的接口
 
 以下接口需要 `tool token` 认证（用于 agent 工具调用），通过 Header `x-od-tool-token` 传递：
 
 - `GET /api/tools/connectors/list`
 - `POST /api/tools/connectors/execute`
 - `GET /api/tools/live-artifacts/list`
 - `POST /api/tools/live-artifacts/create`
 - `POST /api/tools/live-artifacts/update`
 - `POST /api/tools/live-artifacts/refresh`
 - `POST /api/tools/library/search`
 - `POST /api/tools/library/apply`
 - `POST /api/tools/media/generate`
 - `POST /api/tools/design-systems/read`
 
 ## 附录 E：工作区上下文头
 
 需要工作区上下文的接口通过以下 HTTP 头传递身份：
 
 | 头名称 | 说明 |
 |--------|------|
 | `x-od-workspace-id` | 工作区 ID |
 | `x-od-workspace-member-id` | 工作区成员 ID |
 | `x-od-workspace-type` | 工作区类型 (`personal` / `team`) |
 | `x-od-workspace-lifecycle-state` | 生命周期状态 |
 | `x-od-workspace-role` | 角色 (`owner` / `admin` / `member`) |
 | `x-od-workspace-member-status` | 成员状态 |
 | `x-od-workspace-write-enabled` | 写入权限 |
 | `x-od-workspace-can-write-synced-files` | 同步文件写入权限 |
 | `x-od-workspace-can-share-projects` | 项目分享权限 |
 
 ## 附录 F：路由源文件索引
 
 | 路由文件 | 接口数量 |
 |----------|----------|
 | `apps/daemon/src/server.ts` | 5 (health, ready, version, preview/isolation, figma/import) |
 | `apps/daemon/src/routes/daemon.ts` | 8 |
 | `apps/daemon/src/routes/project/index.ts` | 35+ |
 | `apps/daemon/src/routes/runs.ts` | 10+ |
 | `apps/daemon/src/routes/chat.ts` | 10+ |
 | `apps/daemon/src/routes/media.ts` | 15+ |
 | `apps/daemon/src/routes/memory.ts` | 20+ |
 | `apps/daemon/src/routes/design-systems.ts` | 20+ |
 | `apps/daemon/src/routes/static-resource.ts` | 20+ |
 | `apps/daemon/src/routes/library.ts` | 15+ |
 | `apps/daemon/src/routes/routine.ts` | 10+ |
 | `apps/daemon/src/routes/automation.ts` | 8 |
 | `apps/daemon/src/routes/live-artifact.ts` | 8 |
 | `apps/daemon/src/routes/collab-context.ts` | 15+ |
 | `apps/daemon/src/routes/collab-sync.ts` | 6 |
 | `apps/daemon/src/routes/collab-presence.ts` | 3 |
 | `apps/daemon/src/routes/terminal.ts` | 7 |
 | `apps/daemon/src/routes/deploy.ts` | 5 |
 | `apps/daemon/src/routes/telemetry.ts` | 5 |
 | `apps/daemon/src/routes/vela.ts` | 8 |
 | `apps/daemon/src/routes/xai.ts` | 6 |
 | `apps/daemon/src/routes/genui.ts` | 8 |
 | `apps/daemon/src/routes/host-tools.ts` | 2 |
 | `apps/daemon/src/routes/handoff.ts` | 1 |
 | `apps/daemon/src/routes/browser-sessions.ts` | 2 |
 | `apps/daemon/src/routes/plugins/index.ts` | 25+ |
 | `apps/daemon/src/routes/plugins/assets.ts` | 4 |
 | `apps/daemon/src/routes/plugins/marketplaces.ts` | 7 |
 | `apps/daemon/src/routes/active-context.ts` | 2 (GET/POST /api/active) |
 | `apps/daemon/src/brand-routes.ts` | 10 |
 | `apps/daemon/src/mcp-routes.ts` | 10 |
 | `apps/daemon/src/connectors/routes.ts` | 14 |
 | `apps/daemon/src/import-export-routes.ts` | 13 |
 | `apps/daemon/src/static-spa.ts` | 1 (catch-all) |
