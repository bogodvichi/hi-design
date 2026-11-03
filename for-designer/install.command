#!/usr/bin/env bash
# install.command — 一键安装（Mac / Linux）
# 双击运行：录入姓名/小组，注册定时采集（每小时扫描 Claude Code + Codex 会话并上报）。
# 采集使用定时脚本 collect_cowork.py。
# 用 python3 处理 JSON（Mac 自带，无需 jq），幂等、不破坏已有配置。

# 确保用 bash 运行（光标菜单依赖 bash 特性）
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -uo pipefail
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

# 检测是否为交互式运行（后台静默运行时 stdin 不是 tty）
INTERACTIVE=1
if [ ! -t 0 ]; then
  INTERACTIVE=0
fi

# ---- 0. 自愈：清隔离属性 + 补可执行权限 ----
command -v xattr >/dev/null 2>&1 && xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true
chmod +x "$ROOT"/*.command 2>/dev/null || true

PARSE="$ROOT/scripts/parse.py"
MACHINE=$(hostname 2>/dev/null || echo unknown)

echo "=================================================="
echo "  AI 使用采集 · 一键安装"
echo "=================================================="
echo "安装目录：$ROOT"
echo ""

# ---- 1. 找 python ----
PY=""
command -v python3 >/dev/null 2>&1 && PY=python3
[ -z "$PY" ] && command -v python >/dev/null 2>&1 && PY=python
if [ -z "$PY" ]; then
  echo "❌ 未找到 Python 3。Mac 通常自带；若没有，请到 https://www.python.org/downloads/ 安装后重试。"
  exit 1
fi

# ---- 2. 路径迁移：若项目在 TCC 保护目录(Desktop/Documents/Downloads),复制到 ~/ai-usage-tracker ----
# macOS TCC 保护这三个目录,launchd 进程无权访问 → 定时任务报 Operation not permitted。
# 迁到 ~/ 下普通目录即解除限制。已部署机器重跑安装会自动迁移。
HOME_ROOT="$HOME"
TCC_BASES=("$HOME/Desktop" "$HOME/Documents" "$HOME/Downloads" "$HOME/Desktop " )
NEED_MIGRATE=0
for base in "${TCC_BASES[@]}"; do
  case "$ROOT/" in
    "$base"/*) NEED_MIGRATE=1; break;;
  esac
done
TARGET_ROOT="$HOME_ROOT/ai-usage-tracker"
if [ "$NEED_MIGRATE" = "1" ]; then
  TARGET_NEW=0
  if [ -d "$TARGET_ROOT" ]; then
    echo "⚠️  目标目录已存在：$TARGET_ROOT"
    echo "    只填充缺失文件，不覆盖旧身份、状态数据和已升级脚本。"
  else
    echo "📦 检测到项目位于 TCC 保护目录($ROOT)，迁移至 $TARGET_ROOT ..."
    TARGET_NEW=1
    mkdir -p "$TARGET_ROOT"
  fi
  # rsync --ignore-existing 防止从旧下载包覆盖目标中更高版本的脚本。
  # identity.json 和 version.json 永不从旧目录覆盖；新的版本由正式升级器维护。
  rsync -a --ignore-existing --exclude "data/" --exclude ".git/" \
    --exclude "config/identity.json" --exclude "version.json" \
    "$ROOT/" "$TARGET_ROOT/" 2>/dev/null || \
    cp -Rn "$ROOT/scripts" "$ROOT/config" "$ROOT/"*.command "$TARGET_ROOT/" 2>/dev/null || true
  # 仅首次迁移时转移源目录历史数据与身份；以后不覆盖使用者的资料。
  if [ "$TARGET_NEW" = "1" ]; then
    [ -d "$ROOT/data" ] && cp -Rn "$ROOT/data" "$TARGET_ROOT/" 2>/dev/null || true
    [ -f "$ROOT/config/identity.json" ] && mkdir -p "$TARGET_ROOT/config" && \
      cp -n "$ROOT/config/identity.json" "$TARGET_ROOT/config/identity.json" 2>/dev/null || true
    [ -f "$ROOT/version.json" ] && cp -n "$ROOT/version.json" "$TARGET_ROOT/version.json" 2>/dev/null || true
  fi
  ROOT="$TARGET_ROOT"
  PARSE="$ROOT/scripts/parse.py"
  echo "✅ 已切换到新安装目录：$ROOT"
  echo ""
fi
IDENTITY="$ROOT/config/identity.json"
GROUPS_JSON="$ROOT/config/groups.json"

# ---- 3. 身份录入（姓名 + 小组）—— 仅交互式运行时执行 ----
if [ "$INTERACTIVE" = "1" ]; then
  echo ""
  n=$("$PY" "$PARSE" glen "$GROUPS_JSON" 2>/dev/null || echo 0)
  gname() { "$PY" "$PARSE" gitem "$GROUPS_JSON" "$1" 2>/dev/null; }

  # 已登记？
  ALREADY_U=$("$PY" "$PARSE" getkey "$IDENTITY" user 2>/dev/null)
  ALREADY_G=$("$PY" "$PARSE" getkey "$IDENTITY" group 2>/dev/null)

  if [ -n "$ALREADY_U" ] && [ -n "$ALREADY_G" ]; then
    echo "已登记身份：$ALREADY_U · $ALREADY_G"
    echo "如需修改，删除 config/identity.json 后重新运行本安装。"
  elif [ "${n:-0}" -lt 1 ]; then
    echo "⚠️  未找到小组名单 config/groups.json，跳过身份录入。"
  else
    echo "首次使用，请登记身份（用于区分数据归属）："
    NAME=""
    while [ -z "$NAME" ]; do
      printf "  你的姓名（示例：张三5）："; read -r NAME
      NAME=$(printf '%s' "$NAME" | tr -d '\t\n\r')
      [ -z "$NAME" ] && echo "  姓名不能为空，请重输。"
    done

    echo "  选择小组（输入编号）："
    for i in $(seq 0 $((n-1))); do
      printf "    %d) %s\n" "$((i+1))" "$(gname "$i")"
    done
    GROUP_SEL=""
    while [ -z "$GROUP_SEL" ]; do
      printf "  小组编号："; read -r SEL
      case "$SEL" in
        *[!0-9]*|"") echo "  请输入数字编号。"; continue;;
      esac
      if [ "$SEL" -ge 1 ] && [ "$SEL" -le "$n" ]; then
        GROUP_SEL="$(gname "$((SEL-1))")"
      else
        echo "  编码超出范围（1~$n），请重输。"
      fi
    done

    # 写 identity.json（parse.py，避免 heredoc 抢 stdin）
    W=$("$PY" "$PARSE" writeid "$IDENTITY" "$NAME" "$GROUP_SEL" "$MACHINE" 2>/dev/null)
    if [ "$W" = "OK" ]; then echo "  ✅ 已登记：$NAME · $GROUP_SEL"
    else echo "  ⚠️  身份写入失败，采集会回退为机器名+未分组。"; fi
  fi
else
  # 后台静默运行：identity.json 必须已存在
  if [ ! -f "$IDENTITY" ]; then
    echo "ERROR: 后台模式运行，但 config/identity.json 不存在。请先交互式运行一次完成身份登记。" >&2
    exit 1
  fi
  echo "后台模式运行，已确认身份文件存在。"
fi

# ---- 4. 注册 Cowork 定时采集（每小时整点自动扫描 Claude Code + Codex 会话并上报）----
COWORK_COLLECT="$ROOT/scripts/collect_cowork.py"
PLIST_LABEL="com.hik.ai-usage.cowork-collect"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_FILE="$ROOT/data/cowork-collect.log"

if [ -f "$COWORK_COLLECT" ]; then
  # 定时任务不在用户 shell 环境里,需要绝对路径。
  # 优先 /usr/bin/python3(系统自带,不依赖 brew/nvm,launchd 能稳定跑)。
  # 若用户只有 brew python(command -v 取到 /opt/homebrew/bin/python3),也能用——collect_cowork.py 仅依赖标准库。
  PY_ABS=""
  [ -x /usr/bin/python3 ] && PY_ABS=/usr/bin/python3
  [ -z "$PY_ABS" ] && PY_ABS=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo "")
  if [ -n "$PY_ABS" ]; then
    mkdir -p "$(dirname "$PLIST_FILE")" "$(dirname "$LOG_FILE")"
    PLIST_TMP="${PLIST_FILE}.$$"
    cat > "$PLIST_TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PY_ABS}</string>
    <string>${COWORK_COLLECT}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST
    # 配置完全一致且 launchd 已加载时，不卸载、不重建任务。
    if [ -f "$PLIST_FILE" ] && cmp -s "$PLIST_TMP" "$PLIST_FILE" && \
       launchctl list "$PLIST_LABEL" >/dev/null 2>&1; then
      rm -f "$PLIST_TMP"
      echo "✅ Cowork 定时采集已存在，继续沿用原计划任务"
    else
      if ! [ -f "$PLIST_FILE" ] || ! cmp -s "$PLIST_TMP" "$PLIST_FILE"; then
        mv "$PLIST_TMP" "$PLIST_FILE"
      else
        rm -f "$PLIST_TMP"
      fi
      launchctl unload "$PLIST_FILE" 2>/dev/null || true
      if launchctl load "$PLIST_FILE" 2>/dev/null; then
        echo "✅ 已注册 Cowork 定时采集（每小时整点执行）"
        echo "   日志：$LOG_FILE"
      else
        echo "⚠️  launchd 注册失败。请检查权限后重试,或手动跑：$PY_ABS \"$COWORK_COLLECT\""
      fi
    fi
  else
    echo "⚠️  未找到 python3,跳过定时采集注册。"
  fi
fi

echo ""
echo "=================================================="
echo "  ✅ 安装完成！"
echo "  之后正常使用 Claude Code / Codex,会话数据"
echo "  会由定时任务每小时自动采集上报。"
echo "  安装目录：$ROOT"
echo "=================================================="
