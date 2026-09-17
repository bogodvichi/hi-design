# app.sqlite 数据库表结构分析报告

> **数据库文件**: `<RUNTIME_DATA_DIR>/app.sqlite`  
> **引擎**: SQLite (better-sqlite3), WAL 模式, 外键已启用  
> **Schema 来源**: `apps/daemon/src/db.ts` 及各模块的 `migrate*` 函数  
> **生成日期**: 2026-09-03

---

## 概述

`app.sqlite` 是 OpenDesign 守护进程 (daemon) 的本地持久化数据库，采用 SQLite + WAL 模式，通过 `better-sqlite3` 同步驱动。数据库在 `openDatabase()` 中创建，路径由 `RUNTIME_DATA_DIR`（源自 `OD_DATA_DIR`）决定。所有表通过 `CREATE TABLE IF NOT EXISTS` + 前向兼容 `ALTER TABLE ADD COLUMN` 的方式做幂等迁移，无需独立迁移版本号管理。

全库共 **40 张表**，按业务域可分为以下七大类：

| 域 | 表数量 | 核心表 |
|---|---|---|
| 项目与工作区 | 5 | `projects`, `workspace_projects`, `folders` |
| 对话与消息 | 4 | `conversations`, `messages`, `agent_sessions`, `message_event_batches` |
| 预览评论 | 1 | `preview_comments` |
| 部署与自动化 | 4 | `deployments`, `routines`, `routine_runs`, `routine_schedule_claims` |
| 协作与同步 | 4 | `comment_relay_outbox`, `public_file_publications`, `collab_sync_snapshots`, `team_project_materializations` |
| 插件与策略 | 12 | `installed_plugins`, `applied_plugin_snapshots`, `strategy_task_executions` 等 |
| 资源库与媒体 | 10 | `library_assets`, `library_embeddings`, `media_tasks`, `registry_entries` 等 |

---

## 一、项目与工作区

### 1. `projects`

项目元数据主表，是整个数据库的根实体。几乎所有业务表通过 `project_id` 外键关联到它。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 项目唯一标识 (UUID) |
| `name` | TEXT | NOT NULL | 项目显示名称 |
| `skill_id` | TEXT | | 项目绑定的技能 ID，决定 agent 运行时加载哪个 skill |
| `design_system_id` | TEXT | | 项目绑定的设计系统 ID，决定品牌色、字体等 |
| `pending_prompt` | TEXT | | 项目创建时暂存的待处理 prompt，用于延迟首次对话 |
| `metadata_json` | TEXT | | 项目元数据 JSON，存储 `scenarioBinding` 等结构化字段 |
| `custom_instructions` | TEXT | | 用户自定义指令，追加到 system prompt |
| `created_at` | INTEGER | NOT NULL | 创建时间戳 (ms) |
| `updated_at` | INTEGER | NOT NULL | 最后更新时间戳 (ms) |

> `metadata_json` 和 `custom_instructions` 通过前向兼容 `ALTER TABLE ADD COLUMN` 加入，保证旧库无缝升级。

### 2. `workspace_projects`

项目与工作区的绑定关系表。一个项目只能属于一个工作区（`project_id` 是主键），这是从早期"多工作区绑定"迁移修正后的不变量。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `project_id` | TEXT | PRIMARY KEY, FK -> projects(id) CASCADE | 项目 ID，一对一绑定 |
| `workspace_id` | TEXT | NOT NULL | 所属工作区 ID |
| `visibility` | TEXT | NOT NULL, CHECK IN ('personal','team') | 可见范围：个人 vs 团队 |
| `resource_state` | TEXT | NOT NULL, CHECK IN ('active','frozen','deleted') | 资源生命周期状态 |
| `created_by_workspace_member_id` | TEXT | | 创建者成员 ID |
| `updated_by_workspace_member_id` | TEXT | | 最后更新者成员 ID |
| `resource_hub_resource_id` | TEXT | | 上游 Resource Hub 中的资源 ID，用于云端同步 |
| `cloud_tombstoned_at` | INTEGER | | 云端墓碑时间戳，标记云端已删除但本地仍保留的记录 |
| `sync_state` | TEXT | | 同步状态机标记 |
| `metadata_refresh_pending` | INTEGER | NOT NULL DEFAULT 0 | 元数据刷新待处理标志 |
| `version` | INTEGER | NOT NULL DEFAULT 1 | 乐观锁版本号 |
| `folder_id` | TEXT | | 所属文件夹 ID (FK -> folders)，NULL 表示在工作区根目录 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_workspace_projects_workspace_visibility` on `(workspace_id, visibility, updated_at DESC)`

### 3. `team_project_materializations`

团队项目物化记录表，记录团队工作区中已授权的发布版本物化信息。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `workspace_id` | TEXT | NOT NULL, PK 组成 | 工作区 ID |
| `resource_team_id` | TEXT | NOT NULL, PK 组成 | 资源所属团队 ID |
| `viewer_member_id` | TEXT | NOT NULL | 查看者成员 ID |
| `owner_member_id` | TEXT | NOT NULL | 资源所有者成员 ID |
| `project_id` | TEXT | NOT NULL, PK 组成, FK -> projects(id) CASCADE | 项目 ID |
| `resource_id` | TEXT | NOT NULL | 上游资源 ID |
| `ref` | TEXT | NOT NULL, CHECK = 'published' | 引用类型，当前仅支持 published |
| `version` | INTEGER | NOT NULL | 物化版本号 |
| `version_id` | TEXT | NOT NULL | 版本唯一标识 |
| `manifest_digest` | TEXT | NOT NULL | 清单摘要，用于完整性校验 |
| `lifecycle_state` | TEXT | NOT NULL, CHECK = 'active' | 生命周期状态 |
| `authorized_at` | TEXT | NOT NULL | 授权时间 (ISO) |
| `expires_at` | TEXT | NOT NULL | 过期时间 (ISO) |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(workspace_id, project_id)` — 同一工作区内一个项目只有一条物化记录。

### 4. `workspace_resources`

通用工作区资源绑定表，用于 plugin（及未来的 skill / design_system）与工作区的绑定。与 `workspace_projects` 共享相同的"绑定信封"列结构，通过 `resource_type` 参数化，使一套 CRUD 层服务所有资源类型。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `resource_type` | TEXT | NOT NULL, PK 组成 | 资源类型 ('plugin' | 'skill' | 'design_system') |
| `resource_id` | TEXT | NOT NULL, PK 组成 | 资源 ID，指向对应资源表 |
| `workspace_id` | TEXT | NOT NULL | 工作区 ID |
| `visibility` | TEXT | NOT NULL, CHECK IN ('personal','team') | 可见范围 |
| `resource_state` | TEXT | | 资源生命周期状态 |
| `created_by_workspace_member_id` | TEXT | | |
| `updated_by_workspace_member_id` | TEXT | | |
| `resource_hub_resource_id` | TEXT | | |
| `cloud_tombstoned_at` | INTEGER | | |
| `sync_state` | TEXT | | |
| `version` | INTEGER | | |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> **注意**: `resource_id` 无外键约束 — SQLite 不支持多态外键。删除资源底层记录时必须同时删除此表的绑定行，否则产生孤儿绑定。

### 5. `folders`

工作区文件夹层级表，镜像上游 PostgreSQL 的 folders 表结构，保持字段兼容。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `folder_id` | TEXT | PRIMARY KEY, DEFAULT (UUID) | 文件夹 UUID，由 SQLite randomblob 自动生成 |
| `folder_pid` | TEXT | FK -> folders(folder_id) CASCADE | 父文件夹 ID，NULL 表示根级 |
| `workspace_id` | TEXT | NOT NULL | 所属工作区 ID |
| `folder_name` | TEXT | NOT NULL | 文件夹名称 |
| `created_at` | TEXT | NOT NULL DEFAULT (ISO) | 创建时间 (ISO 字符串) |

> 索引: `idx_folders_workspace` on `(workspace_id, folder_id)`

---

## 二、对话与消息

### 6. `conversations`

对话会话表，每个项目下可以有多个对话。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 对话唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `title` | TEXT | | 对话标题 |
| `session_mode` | TEXT | NOT NULL DEFAULT 'design' | 会话模式: 'design' | 'chat' | 'plan' |
| `intent_signals_json` | TEXT | | 意图信号 JSON，记录从用户首条消息中提取的结构化意图 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_conv_project` on `(project_id, updated_at DESC)`

### 7. `agent_sessions`

Agent 会话恢复表，记录每个对话中每个 agent 的上游会话身份，用于安全恢复 agent 会话。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `conversation_id` | TEXT | NOT NULL, PK 组成, FK -> conversations(id) CASCADE | 对话 ID |
| `agent_id` | TEXT | NOT NULL, PK 组成 | Agent 标识 |
| `session_id` | TEXT | NOT NULL | 上游 agent 提供商的会话 ID |
| `stable_prompt_hash` | TEXT | | 稳定前缀 prompt 的哈希，变化时需重新发送 |
| `stable_prompt_sections` | TEXT | | 稳定前缀各段摘要 JSON，纯诊断用：hash 变化时定位哪段漂移 |
| `model` | TEXT | | 创建会话时使用的模型，变化则不安全恢复 |
| `cwd` | TEXT | | 创建会话时的工作目录，变化则不安全恢复 |
| `last_message_id` | TEXT | | 该会话最后产出的 assistant 消息 ID，不再是最新则需重播全量 |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(conversation_id, agent_id)` — 每个对话中每个 agent 最多一条会话记录。

### 8. `messages`

消息表，存储对话中所有用户和 assistant 消息，是数据量最大的表。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 消息唯一标识 |
| `conversation_id` | TEXT | NOT NULL, FK -> conversations(id) CASCADE | 所属对话 |
| `role` | TEXT | NOT NULL | 角色: 'user' | 'assistant' |
| `content` | TEXT | NOT NULL | 消息文本内容 |
| `agent_id` | TEXT | | 产出此消息的 agent ID |
| `agent_name` | TEXT | | Agent 显示名称 |
| `run_id` | TEXT | | 关联的运行 ID |
| `run_status` | TEXT | | 运行状态: 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' |
| `result_delivery_state` | TEXT | | 结果投递状态 |
| `last_run_event_id` | TEXT | | 最后处理的运行事件 ID |
| `events_json` | TEXT | | 事件流 JSON (折叠后的最终版本) |
| `attachments_json` | TEXT | | 附件 JSON |
| `comment_attachments_json` | TEXT | | 评论附件 JSON |
| `produced_files_json` | TEXT | | 产出文件列表 JSON |
| `trace_object_files_json` | TEXT | | trace 对象文件 JSON |
| `feedback_json` | TEXT | | 反馈 JSON |
| `pre_turn_file_names_json` | TEXT | | 回合开始前文件名快照，用于 diff |
| `session_mode` | TEXT | | 消息时的会话模式 |
| `run_context_json` | TEXT | | 运行上下文 JSON |
| `task_analytics_json` | TEXT | | 任务分析数据 JSON |
| `applied_plugin_snapshot_json` | TEXT | | 应用的插件快照 JSON |
| `telemetry_finalized_at` | INTEGER | | 遥测数据最终化时间戳 |
| `started_at` | INTEGER | | 运行开始时间 |
| `ended_at` | INTEGER | | 运行结束时间 |
| `position` | INTEGER | NOT NULL | 消息在对话中的序号 |
| `created_at` | INTEGER | NOT NULL | |

> 索引: `idx_messages_conv` on `(conversation_id, position)`

### 9. `message_event_batches`

消息事件批次表，agent 运行时流式写入的小型不可变批次。在运行终止时折叠进 `messages.events_json`，避免长思考流在每个 flush 窗口重写全量历史。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | 自增 ID |
| `message_id` | TEXT | NOT NULL, FK -> messages(id) CASCADE | 关联消息 |
| `events_json` | TEXT | NOT NULL | 本批次事件 JSON |
| `created_at` | INTEGER | NOT NULL | |

> 索引: `idx_message_event_batches_message` on `(message_id, id)`

---

## 三、预览评论

### 10. `preview_comments`

画布预览评论表，存储用户在 HTML 预览中标注的评论。经过多次迁移：先加 `slide_key`，再去掉自然唯一约束以允许同一元素多条评论，最后加锚定相关列。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 评论唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `conversation_id` | TEXT | NOT NULL, FK -> conversations(id) CASCADE | 所属对话 |
| `file_path` | TEXT | NOT NULL | 评论所在的文件路径 |
| `element_id` | TEXT | NOT NULL | 被评论的元素 ID |
| `selector` | TEXT | NOT NULL | CSS 选择器 |
| `label` | TEXT | NOT NULL | 评论标签 |
| `text` | TEXT | NOT NULL | 评论内容 |
| `position_json` | TEXT | NOT NULL | 评论位置坐标 JSON |
| `html_hint` | TEXT | NOT NULL | HTML 提示片段 |
| `selection_kind` | TEXT | | 选择类型 |
| `member_count` | INTEGER | | 参与成员数 |
| `pod_members_json` | TEXT | | 参与成员列表 JSON |
| `style_json` | TEXT | | 样式 JSON |
| `attachments_json` | TEXT | | 附件 JSON |
| `slide_index` | INTEGER | | 幻灯片索引 |
| `slide_key` | INTEGER | NOT NULL DEFAULT -1 | 幻灯片键，-1 表示非幻灯片 |
| `note` | TEXT | NOT NULL | 备注 |
| `status` | TEXT | NOT NULL | 评论状态 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |
| `anchor_state` | TEXT | | 锚定状态 JSON |
| `anchored_version` | INTEGER | | 锚定版本号 |
| `author_member_id` | TEXT | | 作者成员 ID |
| `last_good_position_json` | TEXT | | 最后已知正确位置 JSON，用于锚定回退 |

> 索引: `idx_preview_comments_conversation` on `(project_id, conversation_id, updated_at DESC)`  
> 索引: `idx_preview_comments_conversation_created` on `(project_id, conversation_id, created_at ASC)`

---

## 四、部署与自动化

### 11. `deployments`

部署记录表，跟踪项目文件到各部署提供商的发布。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 部署唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `file_name` | TEXT | NOT NULL | 部署的文件名 |
| `provider_id` | TEXT | NOT NULL | 部署提供商 ID |
| `url` | TEXT | NOT NULL | 部署后的访问 URL |
| `deployment_id` | TEXT | | 提供商返回的部署 ID |
| `deployment_count` | INTEGER | NOT NULL DEFAULT 1 | 同文件同提供商的部署次数 |
| `target` | TEXT | NOT NULL DEFAULT 'preview' | 部署目标: 'preview' 等 |
| `status` | TEXT | NOT NULL DEFAULT 'ready' | 部署状态 |
| `status_message` | TEXT | | 状态消息 |
| `reachable_at` | INTEGER | | URL 可达时间戳 |
| `provider_metadata_json` | TEXT | | 提供商元数据 JSON |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 唯一约束: `UNIQUE(project_id, file_name, provider_id)` — 同项目同文件同提供商只有一条记录，重复部署递增 `deployment_count`。  
> 索引: `idx_deployments_project` on `(project_id, updated_at DESC)`

### 12. `routines`

自动化例程表，存储定时或手动触发的自动化任务定义。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 例程唯一标识 |
| `name` | TEXT | NOT NULL | 例程名称 |
| `prompt` | TEXT | NOT NULL | 例程执行时发送的 prompt |
| `schedule_kind` | TEXT | NOT NULL | 调度类型 |
| `schedule_value` | TEXT | NOT NULL | 调度值 |
| `schedule_json` | TEXT | | 完整调度配置 JSON |
| `project_mode` | TEXT | NOT NULL | 项目模式 |
| `project_id` | TEXT | | 关联项目 ID (可空) |
| `skill_id` | TEXT | | 关联技能 ID |
| `agent_id` | TEXT | | 执行 agent ID |
| `context_json` | TEXT | | 上下文 JSON |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | 是否启用 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

### 13. `routine_runs`

例程执行记录表，记录每次例程触发的运行结果。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 运行唯一标识 |
| `routine_id` | TEXT | NOT NULL, FK -> routines(id) CASCADE | 关联例程 |
| `trigger` | TEXT | NOT NULL | 触发方式 |
| `status` | TEXT | NOT NULL | 运行状态 |
| `project_id` | TEXT | NOT NULL | 运行的项目 ID |
| `conversation_id` | TEXT | NOT NULL | 运行产生的对话 ID |
| `agent_run_id` | TEXT | NOT NULL | Agent 运行 ID |
| `started_at` | INTEGER | NOT NULL | 开始时间 |
| `completed_at` | INTEGER | | 完成时间 |
| `summary` | TEXT | | 运行摘要 |
| `error` | TEXT | | 错误信息 |
| `error_code` | TEXT | | 错误码 |

> 索引: `idx_routine_runs_routine` on `(routine_id, started_at DESC)`

### 14. `routine_schedule_claims`

调度占位表，防止例程在分布式或重启场景下重复触发同一时间槽。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `routine_id` | TEXT | NOT NULL, PK 组成, FK -> routines(id) CASCADE | 例程 ID |
| `slot_at` | INTEGER | NOT NULL, PK 组成 | 时间槽时间戳 |
| `claimed_at` | INTEGER | NOT NULL | 占位时间 |

> PK: `(routine_id, slot_at)` — 同一例程同一时间槽只能被占一次。

---

## 五、协作与同步

### 15. `comment_relay_outbox`

评论中继发件箱表，存储待投递到团队云端的评论操作。采用重试 + 退避策略。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `workspace_id` | TEXT | NOT NULL, PK 组成 | 工作区 ID |
| `workspace_member_id` | TEXT | NOT NULL, PK 组成 | 成员 ID |
| `team_id` | TEXT | NOT NULL | 团队 ID |
| `project_id` | TEXT | NOT NULL, PK 组成 | 项目 ID |
| `comment_id` | TEXT | NOT NULL, PK 组成 | 评论 ID |
| `expected_owner_member_id` | TEXT | | 预期所有者成员 ID |
| `payload_json` | TEXT | NOT NULL | 评论完整 payload JSON |
| `revision` | INTEGER | NOT NULL DEFAULT 1 | 修订版本号 |
| `attempt_count` | INTEGER | NOT NULL DEFAULT 0 | 重试次数 |
| `next_attempt_at` | INTEGER | NOT NULL | 下次重试时间戳 |
| `last_error` | TEXT | | 最后一次错误信息 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(workspace_id, workspace_member_id, project_id, comment_id)`  
> 索引: `idx_comment_relay_outbox_due` on `(next_attempt_at, updated_at)` — 按到期时间扫描待投递记录。

### 16. `public_file_publications`

公开文件发布记录表，跟踪已发布到团队公共空间的文件。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `resource_team_id` | TEXT | NOT NULL, PK 组成 | 资源团队 ID |
| `owner_member_id` | TEXT | NOT NULL, PK 组成 | 所有者成员 ID |
| `project_id` | TEXT | NOT NULL, PK 组成 | 项目 ID |
| `file_path` | TEXT | NOT NULL, PK 组成 | 文件路径 |
| `url` | TEXT | NOT NULL | 公开访问 URL |
| `slug` | TEXT | NOT NULL | URL slug |
| `file_name` | TEXT | NOT NULL | 文件名 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(resource_team_id, owner_member_id, project_id, file_path)` — 同一团队同一所有者同一项目同一文件只有一条发布记录。

### 17. `collab_sync_snapshots`

协作同步快照缓存表，存储从云端拉取的工作区同步快照，避免重复请求。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `face` | TEXT | NOT NULL, PK 组成 | 同步面 (sync digest face) |
| `account_id` | TEXT | NOT NULL, PK 组成 | 账户 ID — 加入 PK 确保切换账户是缓存 miss 而非泄漏 |
| `workspace_id` | TEXT | NOT NULL, PK 组成 | 工作区 ID |
| `digest_token` | TEXT | NOT NULL | 快照摘要令牌 |
| `snapshot_json` | TEXT | NOT NULL | 完整快照 JSON |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(face, account_id, workspace_id)` — `account_id` 在 PK 中是安全设计：切换账户时不会读到前一个账户的快照。

---

## 六、插件与策略

### 18. `installed_plugins`

已安装插件表，记录每个插件的安装来源、信任级别和已授予的能力。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 插件唯一标识 |
| `title` | TEXT | NOT NULL | 插件标题 |
| `version` | TEXT | NOT NULL | 插件版本 |
| `source_kind` | TEXT | NOT NULL | 来源类型 (git, marketplace, local 等) |
| `source` | TEXT | NOT NULL | 来源地址 |
| `pinned_ref` | TEXT | | 固定引用 (git commit/tag) |
| `source_digest` | TEXT | | 来源摘要 |
| `source_marketplace_id` | TEXT | | 来源市场 ID |
| `source_marketplace_entry_name` | TEXT | | 来源市场条目名 |
| `source_marketplace_entry_version` | TEXT | | 来源市场条目版本 |
| `marketplace_trust` | TEXT | | 市场信任级别 |
| `resolved_source` | TEXT | | 解析后的实际来源 |
| `resolved_ref` | TEXT | | 解析后的实际引用 |
| `manifest_digest` | TEXT | | 清单摘要 |
| `archive_integrity` | TEXT | | 归档完整性校验 |
| `trust` | TEXT | NOT NULL | 信任级别 |
| `capabilities_granted` | TEXT | NOT NULL | 已授予能力 JSON |
| `manifest_json` | TEXT | NOT NULL | 完整清单 JSON |
| `fs_path` | TEXT | NOT NULL | 文件系统路径 |
| `installed_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_installed_plugins_source_kind` on `(source_kind)`

### 19. `plugin_marketplaces`

插件市场表，记录已添加的插件市场源。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 市场唯一标识 |
| `url` | TEXT | NOT NULL | 市场 URL |
| `spec_version` | TEXT | NOT NULL DEFAULT '1.0.0' | 市场规范版本 |
| `version` | TEXT | NOT NULL DEFAULT '0.0.0' | 市场清单版本 |
| `trust` | TEXT | NOT NULL | 信任级别 |
| `manifest_json` | TEXT | NOT NULL | 市场清单 JSON |
| `added_at` | INTEGER | NOT NULL | 添加时间 |
| `refreshed_at` | INTEGER | NOT NULL | 最后刷新时间 |

### 20. `applied_plugin_snapshots`

插件应用快照表，记录每次插件在特定运行上下文中被应用时的完整状态快照。是策略执行的不可变输入记录。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 快照唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `conversation_id` | TEXT | FK -> conversations(id) SET NULL | 所属对话 |
| `run_id` | TEXT | | 关联运行 ID |
| `plugin_id` | TEXT | NOT NULL | 插件 ID |
| `plugin_spec_version` | TEXT | NOT NULL DEFAULT '1.0.0' | 插件规范版本 |
| `plugin_version` | TEXT | NOT NULL | 插件版本 |
| `manifest_source_digest` | TEXT | NOT NULL | 清单来源摘要 |
| `strategy_json` | TEXT | | 策略 JSON |
| `source_marketplace_id` | TEXT | | |
| `source_marketplace_entry_name` | TEXT | | |
| `source_marketplace_entry_version` | TEXT | | |
| `marketplace_trust` | TEXT | | |
| `resolved_source` | TEXT | | |
| `resolved_ref` | TEXT | | |
| `archive_integrity` | TEXT | | |
| `pinned_ref` | TEXT | | |
| `task_kind` | TEXT | NOT NULL | 任务类型 |
| `inputs_json` | TEXT | NOT NULL | 输入参数 JSON |
| `resolved_context_json` | TEXT | NOT NULL | 解析后的上下文 JSON |
| `craft_requires_json` | TEXT | NOT NULL DEFAULT '[]' | 所需 craft 规则 JSON |
| `pipeline_json` | TEXT | | 管道 JSON |
| `genui_surfaces_json` | TEXT | NOT NULL DEFAULT '[]' | GenUI 面 JSON |
| `capabilities_granted` | TEXT | NOT NULL | 已授予能力 |
| `capabilities_required_json` | TEXT | NOT NULL DEFAULT '[]' | 所需能力 JSON |
| `assets_staged_json` | TEXT | NOT NULL | 暂存资产 JSON |
| `connectors_required_json` | TEXT | NOT NULL DEFAULT '[]' | 所需连接器 JSON |
| `connectors_resolved_json` | TEXT | NOT NULL DEFAULT '[]' | 已解析连接器 JSON |
| `mcp_servers_json` | TEXT | NOT NULL DEFAULT '[]' | MCP 服务器 JSON |
| `plugin_title` | TEXT | | 插件标题 (冗余缓存) |
| `plugin_description` | TEXT | | 插件描述 (冗余缓存) |
| `query_text` | TEXT | | 查询文本 |
| `status` | TEXT | NOT NULL DEFAULT 'fresh' | 快照状态 |
| `applied_at` | INTEGER | NOT NULL | 应用时间 |
| `expires_at` | INTEGER | | 过期时间 |

> 索引: `idx_snapshots_project` on `(project_id)`  
> 索引: `idx_snapshots_run` on `(run_id)`  
> 索引: `idx_snapshots_plugin` on `(plugin_id, plugin_version)`

### 21. `run_devloop_iterations`

开发循环迭代表，记录每次 dev loop 迭代的审计和计费信息。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 迭代唯一标识 |
| `run_id` | TEXT | NOT NULL | 关联运行 ID (无 FK，运行在内存中) |
| `stage_id` | TEXT | NOT NULL | 阶段 ID |
| `iteration` | INTEGER | NOT NULL | 迭代序号 |
| `artifact_diff_summary` | TEXT | | 产物 diff 摘要 |
| `critique_summary` | TEXT | | 评审摘要 |
| `tokens_used` | INTEGER | | token 消耗 |
| `ended_at` | INTEGER | NOT NULL | 结束时间 |

> 索引: `idx_devloop_run` on `(run_id)`  
> 索引: `idx_devloop_run_stage` on `(run_id, stage_id)`

### 22. `genui_surfaces`

GenUI 面持久化状态表，存储插件生成的 UI 面的状态，支持跨对话缓存命中。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 面 ID |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 项目 ID |
| `conversation_id` | TEXT | | 对话 ID (无 FK，兼容旧库) |
| `run_id` | TEXT | | 运行 ID (无 FK，运行在内存中) |
| `plugin_snapshot_id` | TEXT | NOT NULL, FK -> applied_plugin_snapshots(id) SET NULL | 插件快照 ID |
| `surface_id` | TEXT | NOT NULL | 面标识 |
| `kind` | TEXT | NOT NULL | 面类型 |
| `persist` | TEXT | NOT NULL | 持久化策略 |
| `schema_digest` | TEXT | | schema 摘要 |
| `value_json` | TEXT | | 面值 JSON |
| `status` | TEXT | NOT NULL | 面状态 |
| `responded_by` | TEXT | | 响应者 |
| `requested_at` | INTEGER | NOT NULL | 请求时间 |
| `responded_at` | INTEGER | | 响应时间 |
| `expires_at` | INTEGER | | 过期时间 |

> 索引: `idx_genui_proj_surface` on `(project_id, surface_id)`  
> 索引: `idx_genui_conv_surface` on `(conversation_id, surface_id)`  
> 索引: `idx_genui_run` on `(run_id)`

### 23. `skill_plugin_candidates`

技能转插件候选表，记录 agent 在运行中识别出的可封装为插件的技能候选。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 候选唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `run_id` | TEXT | | 关联运行 ID |
| `conversation_id` | TEXT | | 关联对话 |
| `assistant_message_id` | TEXT | | 关联 assistant 消息 |
| `fingerprint` | TEXT | NOT NULL | 候选指纹 (去重用) |
| `status` | TEXT | NOT NULL DEFAULT 'active' | 候选状态 |
| `title` | TEXT | NOT NULL | 候选标题 |
| `description` | TEXT | NOT NULL | 候选描述 |
| `confidence` | REAL | NOT NULL | 置信度 |
| `source_refs_json` | TEXT | NOT NULL | 来源引用 JSON |
| `provenance_json` | TEXT | NOT NULL | 来源溯源 JSON |
| `draft_path` | TEXT | | 草稿路径 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |
| `dismissed_at` | INTEGER | | 驳回时间 |

> 唯一约束: `UNIQUE(project_id, fingerprint)` — 同项目同指纹只保留一条候选。  
> 索引: `idx_skill_plugin_candidates_project` on `(project_id, status, created_at DESC)`

### 24. `strategy_task_executions`

策略任务执行表，记录 od-next 策略框架下每次任务执行的完整生命周期。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `task_execution_id` | TEXT | PRIMARY KEY | 执行唯一标识 |
| `schema_version` | INTEGER | NOT NULL DEFAULT 1 | schema 版本 |
| `revision` | INTEGER | NOT NULL DEFAULT 0 | 修订号 (乐观锁) |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `conversation_id` | TEXT | NOT NULL, FK -> conversations(id) CASCADE | 所属对话 |
| `snapshot_id` | TEXT | NOT NULL, FK -> applied_plugin_snapshots(id) | 插件快照 ID |
| `strategy_id` | TEXT | NOT NULL | 策略 ID |
| `strategy_version` | TEXT | NOT NULL | 策略版本 |
| `strategy_package_hash` | TEXT | NOT NULL | 策略包哈希 |
| `selected_agent_id` | TEXT | NOT NULL | 选中的 agent ID |
| `route` | TEXT | CHECK IN ('direct_edit','full_plan') | 路由模式 |
| `input_stage` | TEXT | NOT NULL, CHECK IN ('request','clarification','contract_repair','production') | 输入阶段 |
| `outcome` | TEXT | NOT NULL, CHECK IN ('running','clarification_required','plan_ready','completed','blocked','canceled') | 执行结果 |
| `execution_mode` | TEXT | CHECK IN ('simple','complex') | 执行模式 |
| `plan_contract_json` | TEXT | | 计划契约 JSON |
| `plan_contract_hash` | TEXT | | 计划契约哈希 |
| `clarification_count` | INTEGER | NOT NULL DEFAULT 0, CHECK 0-1 | 澄清次数 (最多1次) |
| `plan_contract_repair_attempts` | INTEGER | NOT NULL DEFAULT 0, CHECK 0-1 | 契约修复次数 (最多1次) |
| `initial_run_id` | TEXT | NOT NULL | 初始运行 ID |
| `latest_run_id` | TEXT | NOT NULL | 最新运行 ID |
| `prompt_bundle_schema` | TEXT | | prompt 包 schema |
| `prompt_bundle_text` | TEXT | | prompt 包文本 |
| `prompt_bundle_utf8_bytes` | INTEGER | | prompt 包 UTF8 字节数 |
| `prompt_bundle_sha256` | TEXT | | prompt 包 SHA256 |
| `frozen_input_identity_json` | TEXT | | 冻结输入身份 JSON |
| `blocked_reason_codes_json` | TEXT | | 阻塞原因码 JSON |
| `blocked_visible_text` | TEXT | | 阻塞可见文本 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_strategy_task_executions_project_conversation` on `(project_id, conversation_id, updated_at DESC)`

### 25. `strategy_task_runs`

策略任务运行表，记录每次任务执行内的具体运行（一次执行可有多次运行，如澄清后重试）。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `task_execution_id` | TEXT | NOT NULL, PK 组成, FK -> strategy_task_executions CASCADE | 所属执行 |
| `run_id` | TEXT | NOT NULL, UNIQUE | 运行 ID |
| `input_stage` | TEXT | NOT NULL, CHECK IN ('request','clarification','contract_repair','production') | 输入阶段 |
| `task_run_index` | INTEGER | NOT NULL, CHECK >= 0, PK 组成 | 运行序号 |
| `source_run_id` | TEXT | | 来源运行 ID (重试链) |
| `final_text_kind` | TEXT | | 最终文本类型 |
| `final_text_schema` | TEXT | | 最终文本 schema |
| `final_text` | TEXT | | 最终文本内容 |
| `final_text_utf8_bytes` | INTEGER | | 最终文本 UTF8 字节数 |
| `final_text_sha256` | TEXT | | 最终文本 SHA256 |
| `created_at` | INTEGER | NOT NULL | |

> PK: `(task_execution_id, task_run_index)` — 每次执行内运行序号唯一。

### 26. `strategy_task_frozen_skill_packages`

冻结技能包表，记录策略任务执行时冻结的技能包，确保执行过程中的技能定义不变。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `task_execution_id` | TEXT | PRIMARY KEY, FK -> strategy_task_executions CASCADE | 执行 ID |
| `schema` | TEXT | NOT NULL | 冻结包 schema |
| `identity` | TEXT | NOT NULL | 冻结包身份标识 |
| `payload_json` | TEXT | NOT NULL | 冻结包完整 payload JSON |

### 27. `strategy_rollout_controls`

策略发布控制表，记录每个策略的发布门控状态，当检测到质量回归时锁定策略。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `strategy_id` | TEXT | PRIMARY KEY | 策略 ID |
| `mode` | TEXT | CHECK IN ('off','observe') | 发布模式 |
| `reason_code` | TEXT | CHECK IN (7种原因码) | 锁定原因码 |
| `latched_at` | INTEGER | | 锁定时间戳 |
| `updated_at` | INTEGER | NOT NULL | |
| `revision` | INTEGER | NOT NULL | 修订号 |
| `last_event` | TEXT | NOT NULL, CHECK IN ('latched','cleared') | 最后事件 |
| `last_event_reason_code` | TEXT | NOT NULL, CHECK IN (9种原因码) | 最后事件原因码 |

> CHECK 约束确保 `mode`/`reason_code`/`latched_at` 三者要么全 NULL 要么全非 NULL。

### 28. `strategy_task_observation_delivery`

任务观察投递表 (v2)，记录策略任务执行的可观测性数据投递状态。表名通过变量参数化创建，实际为 `strategy_task_observation_delivery` 或 `strategy_task_observation_delivery_v2`。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `task_execution_id` | TEXT | PRIMARY KEY, FK -> strategy_task_executions CASCADE | 执行 ID |
| `mode` | TEXT | NOT NULL, CHECK IN ('observe','send') | 投递模式 |
| `environment` | TEXT | NOT NULL | 环境 |
| `tag` | TEXT | NOT NULL | 标签 |
| `aggregate_digest` | TEXT | | 聚合摘要 |
| `observation_count` | INTEGER | NOT NULL DEFAULT 0, CHECK >= 0 | 观察次数 |
| `coverage_json` | TEXT | | 覆盖率 JSON |
| `status` | TEXT | NOT NULL, CHECK IN (6种状态) | 投递状态 |
| `idempotency_key` | TEXT | | 幂等键 |
| `attempt_count` | INTEGER | NOT NULL DEFAULT 0, CHECK >= 0 | 尝试次数 |
| `crash_window` | INTEGER | NOT NULL DEFAULT 0, CHECK IN (0,1) | 崩溃窗口标志 |
| `started_at` | INTEGER | NOT NULL | |
| `drop_reason` | TEXT | | 丢弃原因 |
| `finalized_at` | INTEGER | | 最终化时间 |
| `updated_at` | INTEGER | NOT NULL | |

---

## 七、资源库与媒体

### 29. `library_assets`

资源库资产表，存储图片、素材等资产的元数据和内容索引。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 资产唯一标识 |
| `kind` | TEXT | NOT NULL | 资产类型 |
| `storage` | TEXT | NOT NULL DEFAULT 'owned' | 存储方式: 'owned' (本地) 等 |
| `source_url` | TEXT | | 来源 URL |
| `source_title` | TEXT | | 来源标题 |
| `source_domain` | TEXT | | 来源域名 |
| `captured_at` | INTEGER | NOT NULL | 抓取时间 |
| `archived_date` | TEXT | NOT NULL | 归档日期 (ISO) |
| `file_path` | TEXT | | 文件路径 |
| `origin_project_id` | TEXT | | 来源项目 ID |
| `rel_path` | TEXT | | 相对路径 |
| `mime` | TEXT | | MIME 类型 |
| `width` | INTEGER | | 图片宽度 |
| `height` | INTEGER | | 图片高度 |
| `size` | INTEGER | | 文件大小 |
| `content_hash` | TEXT | NOT NULL, UNIQUE | 内容哈希 — 去重键 |
| `caption` | TEXT | | 说明文字 |
| `ocr_text` | TEXT | | OCR 提取文本 |
| `palette_json` | TEXT | | 调色板 JSON |
| `tags_json` | TEXT | | 标签 JSON |
| `metadata_json` | TEXT | | 元数据 JSON |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 唯一约束: `UNIQUE(content_hash)` — 内容相同的资产只存一份。  
> 索引: `idx_library_assets_archived`, `idx_library_assets_kind`, `idx_library_assets_domain`, `idx_library_assets_project`

### 30. `library_asset_sources`

资产来源表，记录资产的溯源信息（可来自项目、对话、运行或设计系统）。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 来源记录唯一标识 |
| `asset_id` | TEXT | NOT NULL, FK -> library_assets(id) CASCADE | 关联资产 |
| `source_kind` | TEXT | NOT NULL | 来源类型 |
| `project_id` | TEXT | | 来源项目 |
| `conversation_id` | TEXT | | 来源对话 |
| `run_id` | TEXT | | 来源运行 |
| `design_system_id` | TEXT | | 来源设计系统 |
| `rel_path` | TEXT | | 相对路径 |
| `created_at` | INTEGER | NOT NULL | |

> 索引: `idx_library_sources_asset`, `idx_library_sources_project`, `idx_library_sources_ds`

### 31. `library_embeddings`

资产向量嵌入表，存储资产的嵌入向量用于语义搜索。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `asset_id` | TEXT | PRIMARY KEY, FK -> library_assets(id) CASCADE | 关联资产 |
| `model` | TEXT | NOT NULL | 嵌入模型名称 |
| `dim` | INTEGER | NOT NULL | 向量维度 |
| `vector` | BLOB | NOT NULL | 嵌入向量 (二进制) |
| `indexed_text` | TEXT | | 索引文本 (嵌入时的文本) |
| `created_at` | INTEGER | NOT NULL | |

### 32. `library_tasks`

资源库处理任务表，记录资产的后台处理任务（如 OCR、嵌入生成）。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 任务唯一标识 |
| `asset_id` | TEXT | NOT NULL, FK -> library_assets(id) CASCADE | 关联资产 |
| `status` | TEXT | NOT NULL DEFAULT 'queued' | 任务状态 |
| `progress_json` | TEXT | NOT NULL DEFAULT '[]' | 进度 JSON |
| `error_json` | TEXT | | 错误 JSON |
| `started_at` | INTEGER | NOT NULL | |
| `ended_at` | INTEGER | | |

> 索引: `idx_library_tasks_asset`

### 33. `library_tokens`

资源库访问令牌表，存储扩展程序使用的访问令牌。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `token_hash` | TEXT | PRIMARY KEY | 令牌哈希 (不存明文) |
| `label` | TEXT | NOT NULL | 令牌标签 |
| `extension_origin` | TEXT | NOT NULL | 扩展来源 |
| `created_at` | INTEGER | NOT NULL | |
| `last_used_at` | INTEGER | NOT NULL | 最后使用时间 |

### 34. `library_digests`

资源库每日摘要表，存储按日期生成的资源库摘要。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `date` | TEXT | PRIMARY KEY | 日期 (ISO) |
| `project_id` | TEXT | | 关联项目 |
| `artifact_path` | TEXT | | 产物路径 |
| `summary` | TEXT | | 摘要文本 |
| `created_at` | INTEGER | NOT NULL | |

### 35. `media_tasks`

媒体生成任务表，记录图片/视频/音频等媒体生成任务的状态。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 任务唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `status` | TEXT | NOT NULL, CHECK IN ('queued','running','done','failed','interrupted') | 任务状态 |
| `surface` | TEXT | | 生成面 |
| `model` | TEXT | | 生成模型 |
| `progress_json` | TEXT | NOT NULL DEFAULT '[]' | 进度 JSON |
| `file_json` | TEXT | | 产出文件 JSON |
| `error_json` | TEXT | | 错误 JSON |
| `started_at` | INTEGER | NOT NULL | |
| `ended_at` | INTEGER | | |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_media_tasks_project` on `(project_id, updated_at DESC)`  
> 索引: `idx_media_tasks_status` on `(status, updated_at DESC)`

### 36. `registry_entries`

注册表条目表，存储从各后端拉取的市场条目缓存。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `backend_id` | TEXT | NOT NULL, PK 组成 | 后端 ID |
| `name` | TEXT | NOT NULL, PK 组成 | 条目名称 |
| `version` | TEXT | NOT NULL | 条目版本 |
| `entry_json` | TEXT | NOT NULL | 完整条目 JSON |
| `updated_at` | INTEGER | NOT NULL | |

> PK: `(backend_id, name)` — 同一后端同一条目只保留最新版本。

### 37. `templates`

项目模板表，存储可复用的项目模板。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 模板唯一标识 |
| `name` | TEXT | NOT NULL | 模板名称 |
| `description` | TEXT | | 模板描述 |
| `source_project_id` | TEXT | | 来源项目 ID |
| `files_json` | TEXT | NOT NULL | 模板文件列表 JSON |
| `created_at` | INTEGER | NOT NULL | |

### 38. `tabs`

项目工作区标签页表，记录每个项目打开的文件标签页。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `project_id` | TEXT | NOT NULL, PK 组成, FK -> projects(id) CASCADE | 所属项目 |
| `name` | TEXT | NOT NULL, PK 组成 | 标签页名称 |
| `position` | INTEGER | NOT NULL | 标签页位置序号 |
| `is_active` | INTEGER | NOT NULL DEFAULT 0 | 是否激活 |

> PK: `(project_id, name)`  
> 索引: `idx_tabs_project` on `(project_id, position)`

### 39. `tabs_state`

标签页状态表，存储标签页的完整状态快照（如滚动位置、选中状态等）。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `project_id` | TEXT | PRIMARY KEY, FK -> projects(id) CASCADE | 所属项目 |
| `updated_at` | INTEGER | NOT NULL | 更新时间 |
| `state_json` | TEXT | | 状态 JSON |

### 40. `critique_runs`

评审运行表，记录每次设计评审 (critique) 的状态和结果。

| 字段 | 类型 | 约束 | 设计初衷 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 评审运行唯一标识 |
| `project_id` | TEXT | NOT NULL, FK -> projects(id) CASCADE | 所属项目 |
| `conversation_id` | TEXT | FK -> conversations(id) SET NULL | 所属对话 (可空) |
| `artifact_path` | TEXT | | 评审产物路径 |
| `status` | TEXT | NOT NULL, CHECK IN (8种状态) | 评审状态 |
| `score` | REAL | | 评审得分 |
| `rounds_json` | TEXT | NOT NULL DEFAULT '[]' | 评审轮次 JSON |
| `transcript_path` | TEXT | | 评审记录路径 |
| `protocol_version` | INTEGER | NOT NULL | 协议版本 |
| `created_at` | INTEGER | NOT NULL | |
| `updated_at` | INTEGER | NOT NULL | |

> 索引: `idx_critique_runs_project` on `(project_id, updated_at DESC)`  
> 索引: `idx_critique_runs_status` on `(status)`

---

## 设计模式总结

### 迁移策略

全库采用 **幂等迁移** 模式：所有 `CREATE TABLE` 使用 `IF NOT EXISTS`，所有列添加通过 `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`。没有独立的迁移版本号表，迁移函数在每次 `openDatabase()` 时全部执行，已存在的操作是 no-op。

### 外键与级联

- `projects(id)` 是全局根实体，大多数表通过 `ON DELETE CASCADE` 关联，删除项目时自动清理所有关联数据。
- `conversations(id)` 是第二级根实体，删除对话时级联清理消息和评论。
- `workspace_resources` 故意不设外键（多态引用），删除底层资源时需手动清理绑定行。
- `run_devloop_iterations` 和 `genui_surfaces` 中的 `run_id` 无外键，因为运行是内存对象，无持久化目标。

### JSON 列约定

大量结构化数据以 `_json` 后缀的 TEXT 列存储。这是 SQLite 无原生 JSON 类型的务实选择。关键模式包括：
- `metadata_json` — 实体扩展元数据
- `events_json` — 事件流折叠后的最终版本
- `*_json` 后缀列 — 列表/字典/嵌套结构

### 时间戳约定

- 大多数时间戳为 `INTEGER` (Unix 毫秒)，通过 `Date.now()` 生成。
- `folders` 表例外，使用 ISO 字符串时间戳，因为它镜像上游 PostgreSQL 表。
- `library_assets.archived_date` 也使用 ISO 日期字符串。

### 安全设计亮点

- `collab_sync_snapshots` 的 PK 包含 `account_id`，确保切换账户时缓存 miss 而非泄漏。
- `library_tokens` 只存哈希不存明文。
- `agent_sessions` 的恢复身份守卫（model/cwd/last_message_id 三重校验）防止在不安全的上下文中恢复会话。
- `strategy_rollout_controls` 的 CHECK 约束确保锁定状态字段的一致性。
