# Vela 接口分析

项目中 Vela 是一个外部 CLI 工具(`vela` 二进制),作为 OpenDesign 与 AMR(一个云端 AI 模型运行时平台)之间的统一身份与控制面桥梁。整个项目围绕 vela 构建了六大功能域,下面逐一分析。

## 一、身份认证与登录

**核心文件:** `apps/daemon/src/integrations/vela.ts`、`apps/daemon/src/integrations/vela-profile.ts`、`apps/daemon/src/integrations/vela-console-origin.ts`

Vela 登录采用设备授权(device-authorization)流程。daemon 通过 `spawnVelaLogin` / `spawnVelaLoginWithFallback` 启动 `vela login` 子进程,从 stdout 解析激活 URL 和用户码(`parseVelaLoginActivation`),并支持直连失败后自动回退到 daemon 本地 IPv4 代理。

关键接口:
- `readVelaLoginStatus` — 同步读取登录状态(是否登录、用户信息、profile、sessionState)
- `readVelaCredentialRevision` — 计算凭据指纹,用于检测账号切换/过期
- `resolveAmrProfile` — 解析当前 AMR profile(prod/test/feature-test/local)
- `resolveVelaConsoleOrigin` — 解析 vela web 控制台地址,供 UI 构建钱包/升级链接
- `markVelaAuthorizationExpired` / `clearVelaAuthorizationState` — 标记/清除授权状态

**HTTP 路由** (`apps/daemon/src/routes/vela.ts`):
- `POST /api/integrations/vela/login` — 启动设备授权登录
- `POST /api/integrations/vela/login/cancel` — 取消进行中的登录
- `POST /api/integrations/vela/logout` — 注销并清除缓存
- `GET /api/integrations/vela/status` — 读取登录状态 + 实时账户信息(plan/balance)

## 二、钱包与计费

**核心文件:** `apps/daemon/src/integrations/vela-wallet.ts`、`apps/daemon/src/integrations/vela-billing.ts`、`apps/daemon/src/runtimes/defs/amr.ts`

两条计费读取路径:

1. **HTTP 直连**(`vela-wallet.ts`):通过 `readVelaControlApiContext` 获取 control key,直接调用 vela API `/api/v1/wallet/balance` 和 `/api/v1/billing/coding-plan-models`,带 TTL 缓存和单飞(single-flight)去重。契约类型 `AmrWalletSnapshot` 定义在 `packages/contracts/src/api/amrWallet.ts`。

2. **CLI 收口**(`vela-billing.ts` / `amr.ts`):通过 `vela billing summary --format json` 读取账户级计费摘要;通过 `vela billing workspace-snapshot` / `workspace-balance` 读取工作区级钱包;通过 `vela billing checkout` 发起 Stripe 订阅结账。

关键接口:
- `fetchVelaBillingSummary` — 账户级 plan + balance(路由层 `/status` 和 `/wallet` 使用)
- `fetchVelaWorkspaceBillingProjection` — 工作区级原子 plan+wallet 快照
- `fetchBillingCheckoutUrl` — 团队订阅 Stripe 结账 URL
- `fetchVelaBillingCatalog` — 团队套餐目录(team_plus / team_pro / team_max)
- `velaWalletSnapshotReader.read` — 带缓存的 wallet 快照读取

**HTTP 路由:**
- `GET /api/integrations/vela/wallet` — 读取钱包余额 + coding plan 模型列表

## 三、模型列表

**核心文件:** `apps/daemon/src/runtimes/defs/amr.ts`

通过 `vela models --json` 读取可用模型列表。`amrAgentDef` 定义了 AMR 运行时:`bin: 'vela'`、`buildArgs: () => ['agent', 'run', '--runtime', 'opencode']`、`streamFormat: 'acp-json-rpc'`。Vela 本质上是 OpenCode 的 ACP stdio 包装器。

关键接口:
- `fetchVelaRemoteModelsWithRetry` — 带重试的远程模型列表获取
- `fetchVelaPresetModels` — 预设模型列表
- `fetchVelaBillingSummary`(amr.ts 版)— 通过 CLI 读取 plan/balance,供模型缓存失效逻辑使用

**HTTP 路由:**
- `GET /api/amr/models` — 返回可用 AMR 模型列表(带缓存)

## 四、媒体生成(图片/视频)

**核心文件:** `apps/daemon/src/media/vela.ts`

通过 `vela image gen` / `vela image edit` / `vela video gen` 子命令调用 vela 的媒体生成能力。

关键接口:
- `renderVelaImage` — 图片生成/编辑,支持 aspect ratio、resolution、quality tier 的目录校验(先调 `vela media models --json` 读取能力目录),最多 5 张输入图
- `renderVelaVideo` — 视频生成,提交后轮询 `vela video get <taskId>` 直到 succeeded/failed,支持 16:9/9:16/1:1、5s/10s
- `VelaMediaError` — 结构化媒体错误,含 `safety_rejection` 等机器可读错误码

## 五、协作与团队资源

这组接口通过 `vela resource`、`vela team-projects`、`vela collab` 等 CLI 子命令实现多人协作。

### 资源发布/拉取

**核心文件:** `apps/daemon/src/collab/vela-cli-resource-adapter.ts`、`apps/daemon/src/collab/vela-cli-resource-pull-batcher.ts`

通过 `vela resource push/head/pull/remove/pull-batch` 实现项目内容的发布与同步。这是 `ResourcePublishAdapter` 的 CLI 传输层实现,与 AMR 使用同一个 vela 登录会话。

关键接口:
- `createVelaCliResourceAdapter` — 实现 `publish/syncLatest/pull/unpublish` 四个操作,带 team identity 门控
- `runVelaResourceBatchCommand` — 批量拉取(通过 stdin 传请求避免 argv 长度限制)
- `createVelaResourcePullBatcher` — 将同一事件循环内的多个 pull 合并为一个 vela 进程

### 团队项目目录

**核心文件:** `apps/daemon/src/collab/vela-cli-team-projects.ts`、`apps/daemon/src/integrations/vela-team-projects.ts`

通过 `vela team-projects list/get/upsert/remove` 管理团队项目目录,旧版 CLI 回退到 `vela resource shared` 读取资源索引。

关键接口:
- `createVelaCliTeamProjectCatalog` — 团队项目目录(list/get/upsert/remove)
- `createVelaCliTeamProjectCatalogClient` — 底层客户端,带 SWR 缓存
- `createScopedVelaTeamProjectCatalogClientCache` — 按 principal 隔离的请求级缓存

### 协作在线状态与评论

**核心文件:** `apps/daemon/src/collab/vela-cli-collab-client.ts`

通过 `vela collab member/presence/comment` 子命令管理成员注册、在线状态心跳和评论同步。

关键接口:
- `registerMember` / `listMembers` — 成员注册与列表
- `heartbeatPresence` / `listPresence` / `leavePresence` — 在线状态(10s 超时,高频流量)
- `pushComment` / `pullComments` — 评论推送与拉取(增量 seq)

### 工作区上下文

**核心文件:** `apps/daemon/src/collab/vela-workspace-context.ts`

通过 vela API `/api/v1/workspaces` 读取用户的工作区成员目录,合成 `WorkspaceCollabContext`。这是协作系统的身份基础——决定当前用户属于哪个团队、什么角色、什么权限。

关键接口:
- `createVelaWorkspaceContextProvider` — 工作区上下文 provider,从 vela 会话读取目录
- `mapVelaWorkspaceContext` — 将 vela 响应映射为 `WorkspaceCollabContext`
- `createWorkspaceDirectoryAuthorityBroker` — 目录读取的权威 broker,带 TTL 缓存、失败退避、mutation 后刷新
- `resolveVelaWorkspaceHubEventsEndpoint` — 构建 SSE hub 事件端点

## 六、API 代理与消息中心

**核心文件:** `apps/daemon/src/routes/vela.ts`

daemon 作为反向代理,将前端请求转发到 vela 后端。

- `AMR API 代理` — `ALL /api/integrations/vela/api-proxy/*splat` -> `https://amr-api.open-design.ai/api/v1/*`,带 hop-by-hop header 过滤、DNS IPv4 强制、30s 超时、流式管道
- `消息中心(认证)` — `ALL /api/integrations/vela/message-center/*splat` -> vela API `/api/v1/message-center/*`,带 control key 认证,仅允许 GET /messages、POST /read-all、POST /messages/:id/read
- `消息中心(公开)` — `GET /api/integrations/vela/message-center-public/messages`,使用 api context 而非 control key

## 七、错误分类与分析镜像

**核心文件:** `apps/daemon/src/integrations/vela-errors.ts`、`apps/daemon/src/integrations/vela.ts` 中的分析函数

`classifyAmrAccountFailure` 将 vela 的中英文错误文本分类为三种结构化错误:`AMR_AUTH_REQUIRED`(需重新登录)、`AMR_INSUFFICIENT_BALANCE`(余额不足)、`AMR_TIER_UPGRADE_REQUIRED`(需升级套餐),每种带对应的 action 和 actionUrl。

分析镜像通过 `mirrorAmrEntryAnalytics` / `mirrorAmrOnboardingProfileAnalytics` 将登录入口归因事件转发到 vela 后端 `https://amr-api.open-design.ai/api/v1/analytics/events`。

**HTTP 路由:**
- `POST /api/integrations/vela/analytics-entry` — 镜像 AMR 入口点击事件
- `POST /api/integrations/vela/analytics-profile` — 镜像 onboarding profile 提交事件

## 八、子代理证据观测

**核心文件:** `apps/daemon/src/runtimes/vela-child-evidence.ts`

这是一个 ACP 扩展消费者,用于观测 vela(作为 OpenCode ACP 运行时)在运行过程中产生的子代理(child agent)生命周期证据。通过 `vela.opencode.child_agent_lifecycle` 扩展协商,消费 `child_agent_lifecycle` 事件,生成标准化的 `NormalizedAgentObservationV1` 观测数据。

关键接口:
- `negotiateVelaChildEvidence` — 从 ACP initialize 结果中协商扩展能力
- `createVelaChildEvidenceConsumer` — 有状态的 per-run 消费者,跟踪 root/child session 绑定
- `adaptVelaChildRuntimeFactV1` — 将 wire fact 适配为标准化观测格式
- `childEvidenceCoverage` — 生成覆盖度报告(complete/partial/unavailable)

## 九、CLI 命令层

**核心文件:** `apps/daemon/src/integrations/vela-command.ts`、`apps/daemon/src/cli.ts`

`runVelaCommand` 是所有 vela CLI 调用的统一入口,解析与 AMR 登录相同的 vela 二进制路径和环境,支持超时终止(确认 kill 整个进程树)、abort 取消、stderr 观测。

CLI 侧 `od` 命令通过 HTTP 调用 daemon 路由,提供 `od amr login`、`od amr logout`、`od amr status`、`od amr wallet`、`od amr messages` 等子命令,遵循 UI/CLI 双轨契约。

---

**总结:** Vela 在这个项目中扮演三重角色——(1) AMR 云端 AI 运行时的统一身份认证层(一个 vela 会话驱动 AMR 模型调用、资源分享、工作区上下文);(2) CLI 命令收口层(所有计费、协作、媒体操作都通过 `vela <domain> <subcommand>` shell out,而非 daemon 自持 token 直连 HTTP);(3) ACP 运行时本体(`vela agent run --runtime opencode` 即 AMR 代理进程)。这种设计确保了"一个身份"原则:打包登录能成功的同时,协作命令绝不会使用不同的 CLI 或缺失的会话。
