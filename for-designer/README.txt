AI 使用采集 · 安装说明
================================

【这是什么】
一个小工具，自动记录你用 codex 的使用情况（用于部门 AI 效能统计）。
装好后无感运行，正常用 codex 即可，不影响任何操作。

【怎么装】（一次，约 30 秒）

Mac：
  1. 解压本文件夹到用户路径下（例如：～/User/zhangsan5/for-design）
  2. 双击 install.command
     （若提示"无法打开"：右键 install.command → 打开 → 再点"打开"）
  3. 按提示：输入你的oa姓名 → 输入数字选择小组 → 空格或回车确认
  4. 看到"安装完成"即可

Windows：
  1. 解压本文件夹到用户路径下（例如：C:\User\zhangsan5\for-design）
  2. 双击 install.bat
  3. 按提示：输入你的pa姓名 → 输入数字选择小组 → 空格或回车确认
  4. 看到"安装完成"即可

【装完之后】
什么都不用做。正常使用 codex，每次会话结束会自动记录并上报。
数据会自动 POST 到部门统计接口，同时本地 data/usage.jsonl 留一份备份。

【隐私说明】
仅记录以下统计字段（不记录对话内容）：
  - 会话时间、会话ID
  - 使用者姓名、小组、工具
  - 工作性质（转型/提效）、细分子类
  - 是否有文件产出、token 消耗、费用、是否触限
用于部门整体效能分析，不含敏感内容。

【改我的姓名/小组】
删除 config/identity.json，重新双击 install 即可重新登记。

【遇到问题】
把安装窗口的截图发给管理员。

【静默更新发布（维护者）】
每小时采集任务运行时，会先从以下固定清单检查脚本更新：
  https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/download/for-designer/stable/latest/metadata.json

检查和下载失败不会影响本次采集。更新成功后，本次进程继续使用已加载的
旧脚本完成采集，新脚本从下一次定时任务开始生效。Hi Design 客户端启动
不会触发采集脚本更新。

发布新版本时：
  1. 将仓库内 version.json 改为新版本，例如 1.0.2。
  2. 在仓库根目录运行：python3 for-designer/build_release.py
     脚本会自动生成 ZIP、计算 64 位 SHA-256，并生成 metadata.json。
  3. 人工上传生成的 versions/v1.0.2/for-designer-1.0.2.zip。
  4. 确认 ZIP 可匿名下载后，最后上传生成的 latest/metadata.json。

默认产物位于仓库 .tmp/for-designer-release/，metadata.json 里的 sha256
已由打包脚本按最终 ZIP 内容写好，不需要人工填写。
必须先上传 ZIP、最后更新 metadata.json，避免客户端读到尚未就绪的版本。
