# Skill / MCP 发布治理：HDW 名称注册上线手册

此文件只记录手动部署步骤，**不会自动执行生产变更**。本轮新增的名称注册表和回填脚本必须在 HDW 新版本上线前准备完成。

## 上线前准备

1. 在隔离测试数据库或正式脱敏恢复库执行验证，确认历史名称占用、旧客户端行为与分享权限。
2. 完整备份 PostgreSQL 数据库及 HDW Blob 文件目录，并验证恢复可用。
3. 正式窗口冻结 Skill/MCP 资源创建、修改、取消发布写入，避免回填期间遗漏记录。
4. 使用 Node 24 运行脚本。连接地址经密钥管理器注入环境变量，不要把密码、资源名称或用户数据记录到日志中。

## 数据库审计和迁移（必须先在测试库演练）

1. 使用只读数据库账号设置 HDW_NAME_REGISTRY_DATABASE_URL，并执行：

    node scripts/resource-name-registry-backfill.js --plan

   审核总逻辑源、缺失名称、已有重名、引用发布和未知来源公开发布的数量。若 missingName 大于零，必须处理后才能继续。

2. 使用经批准的数据库迁移账号执行增量结构变更：

    psql "$APPROVED_MIGRATION_DB_URL" -v ON_ERROR_STOP=1 -f scripts/020_resource_name_registry.sql

   新注册状态初始 ready 为 FALSE，新 HDW 的名称写入尚不可用。

3. 备份验收通过后，在写入冻结维护窗口运行：

    node scripts/resource-name-registry-backfill.js --apply --backup-confirmed

   该操作使用显式连接环境变量 HDW_NAME_REGISTRY_DATABASE_URL，单事务锁定 resources，回填名称索引，校验计数，成功后标记 ready 为 TRUE，失败则回滚。

4. 核查查询 SELECT ready FROM resource_name_registry_state WHERE id='global'; 为 TRUE，且名称索引数量与审计结果一致。

## 灰度发布和验收

1. 按 HDW 服务端、Daemon、Web、Electron 的顺序逐步升级；各阶段保留旧客户端兼容测试。
2. 验证个人和团队资源正常使用、跨 Workspace 私有分享接入、有效社区发布、两类取消发布、已有本地 Skill/MCP 保留、取消后本地卸载、手动更新发布及源删除保护。
3. 验证同类型新建重名被阻止，历史同名源保留原名更新；旧资源来源不明时不删除、不改名、不假定是本地导入。
4. 验证缺失源 Skill manifest/Blob 时安全失败，没有新社区记录，也没有泄露服务器文件路径。
5. 观察失败率与 409、410、500、503 的变化；发现共享接入或卸载回归时停止放量。

## 回滚和限制

- 优先回滚应用流量与对应发布版本，**不要直接删除新增数据库表或索引**。
- 若旧版 HDW 在新记录写入后继续工作，应再次审计名称注册状态，不能直接假设旧服务维护了新索引。
- 不要人为把 ready 改为 TRUE 代替回填。
- 历史未知来源资源的深度迁移须另行基于可核实的证据制定计划。
- Dev Daemon 的 HDW 上游可能是远端服务。**本机自动化测试通过不等于生产数据库已迁移，也不授权任何生产写入**。
