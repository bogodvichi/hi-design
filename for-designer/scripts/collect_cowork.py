#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect_cowork.py — Cowork agent 会话采集器
扫描 Cowork 的 transcript 目录，对每个已结束的会话解析 token/prompt/产出，
组装对齐 usage_raw 的 payload，POST 到 report 接口。
用 session_id 去重（已上报的跳过）。

用法：
  python3 collect_cowork.py            # 扫描+上报
  python3 collect_cowork.py --dry      # 只扫描不上报（调试用）

设计原则：绝不报错退出，任何异常吞掉，最多少记一条。
"""
import json, os, sys, re, urllib.request, urllib.error
from datetime import datetime, timedelta

# ---- 配置 ----
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR) if os.path.basename(SCRIPT_DIR) == "scripts" else SCRIPT_DIR
# transcript 目录:Claude Code(~/.claude/projects/<proj>/*.jsonl 两层)
# + Codex(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 三层 + archived_sessions/)
HOME = os.path.expanduser("~")
TRANSCRIPT_DIRS = [
    os.path.join(HOME, ".claude", "projects"),
    os.path.join(HOME, "mnt", ".claude", "projects"),  # VM 里的路径
    os.path.join(HOME, ".codex", "sessions"),          # Codex 活跃会话(YYYY/MM/DD/嵌套)
    os.path.join(HOME, ".codex", "archived_sessions"), # Codex 归档会话(扁平)
    # WorkBuddy:Mac ~/.workbuddy 与 Windows C:\Users\<u>\.workbuddy 同为家目录下
    # 的 .workbuddy 隐藏目录,expanduser("~") 两端都正确解析(分隔符由 os.path 处理)。
    # transcript 布局:<proj>/<uuid>.jsonl,os.walk 递归可达。
    os.path.join(HOME, ".workbuddy", "projects"),
]
SERVER_CONF = os.path.join(ROOT_DIR, "config", "server.json")
IDENTITY = os.path.join(ROOT_DIR, "config", "identity.json")
GROUP_MAP = os.path.join(ROOT_DIR, "config", "group-map.json")
PRICING = os.path.join(ROOT_DIR, "config", "pricing.json")
LOCAL_LOG = os.path.join(ROOT_DIR, "data", "usage.jsonl")
STATE_FILE = os.path.join(ROOT_DIR, "data", "collector_state.json")
RETRY_FILE = os.path.join(ROOT_DIR, "data", "report_retry_queue.json")

DRY = "--dry" in sys.argv

# Windows 兼容:stdout 被重定向(任务计划/管道)时默认用 GBK/cp1252,emoji 打印
# 会抛 UnicodeEncodeError 中断整个脚本。统一重配置为 UTF-8(3.7+ 才支持 reconfigure)。
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def safe_load_json(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {}

def get_config():
    """读 server.json 取 url；读 identity.json 取 user/group。"""
    srv = safe_load_json(SERVER_CONF)
    url = srv.get("url", "")
    ident = safe_load_json(IDENTITY)
    user = ident.get("user", "") or os.environ.get("USER", "") or "unknown"
    group = ident.get("group", "未分组")
    machine = ident.get("machine", "") or os.uname().nodename if hasattr(os, 'uname') else "unknown"
    if not ident.get("user"):
        # 兜底：group-map 查 machine
        gm = safe_load_json(GROUP_MAP)
        m = machine
        if m in gm and gm[m]:
            group = gm[m]
    return url, user, group, machine

def load_baselines():
    """加载每会话基线状态。key=session_id,value={last_total,last_components,
    last_cost,last_line_count}。用于增量上报:本次累计值 − 基线 = 增量。"""
    state = safe_load_json(STATE_FILE)
    baselines = state.get("baselines") if isinstance(state, dict) else None
    if not isinstance(baselines, dict):
        return {}
    out = {}
    for sid, b in baselines.items():
        if isinstance(b, dict) and str(sid):
            out[str(sid)] = b
    return out

def save_baselines(baselines):
    """落盘基线状态,保留 collect_start_date。"""
    state = safe_load_json(STATE_FILE)
    if not isinstance(state, dict):
        state = {}
    state["baselines"] = baselines
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def get_collect_start_date():
    """首次运行时锁定本地日期，只采集该日期及之后的会话，避免补扫历史。"""
    state = safe_load_json(STATE_FILE)
    start = state.get("collect_start_date", "")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(start)):
        start = datetime.now().strftime("%Y-%m-%d")
        if not DRY:
            try:
                os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
                with open(STATE_FILE, "w", encoding="utf-8") as f:
                    json.dump({"collect_start_date": start}, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
    return start

def append_local_payload(payload):
    """追加一条本地记录。增量上报模式下,同一 session_id 会有多行,
    本地 usage.jsonl 和服务端一一对应,便于核对。"""
    try:
        os.makedirs(os.path.dirname(LOCAL_LOG), exist_ok=True)
        with open(LOCAL_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        return True
    except Exception:
        return False

def load_retry_queue():
    """读取远端上报失败队列。key={session_id}#{ts},每次上报独立 key,
    避免同一会话多次增量上报失败时互相覆盖。"""
    data = safe_load_json(RETRY_FILE)
    if not isinstance(data, dict):
        return {}
    queue = {}
    for k, payload in data.items():
        if isinstance(payload, dict) and payload.get("session_id"):
            queue[str(k)] = payload
    return queue

def save_retry_queue(queue):
    try:
        os.makedirs(os.path.dirname(RETRY_FILE), exist_ok=True)
        with open(RETRY_FILE, "w", encoding="utf-8") as f:
            json.dump(queue, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def find_transcripts():
    """扫描所有 transcript 目录，返回 [(path, session_id), ...]。
    兼容两种结构:Claude Code 的 <proj>/*.jsonl 两层、Codex 的 YYYY/MM/DD/*.jsonl 三层。
    session_id 先用文件名兜底(Codex 在 parse 阶段从 session_meta 覆盖真值)。"""
    results = []
    for base in TRANSCRIPT_DIRS:
        if not os.path.isdir(base):
            continue
        # os.walk 统一处理任意嵌套深度,对两种目录结构都兼容
        for dirpath, _dirs, files in os.walk(base):
            for fn in files:
                if not fn.endswith(".jsonl"):
                    continue
                f = os.path.join(dirpath, fn)
                sid = fn.replace(".jsonl", "")
                results.append((f, sid))
    return results

def _is_codex_transcript(path, lines):
    """判断是否 Codex 格式:文件名 rollout- 前缀,或首行 type==session_meta。"""
    if os.path.basename(path).startswith("rollout-"):
        return True
    for l in lines[:1]:
        try:
            r = json.loads(l)
            if r.get("type") == "session_meta":
                return True
        except Exception:
            pass
    return False

def _is_workbuddy_transcript(path, lines):
    """判断是否 WorkBuddy 格式(第三种格式,区别于 Claude Code / Codex)。
    特征:JSONL 每行是 {type:message|function_call|reasoning|...},首条实体行
    type==message 且带 providerData;既无 Codex 的 session_meta,文件名也非 rollout-。
    只看前若干行,命中即判定。"""
    for l in lines[:8]:
        try:
            r = json.loads(l)
        except Exception:
            continue
        t = r.get("type")
        if t == "session_meta":
            return False  # Codex,交给 codex 解析器
        if t == "message" and "providerData" in r and "role" in r:
            return True
    return False

def _extract_workbuddy_prompt(txt):
    """从 WorkBuddy user 文本里剥离系统注入,提取真实意图。
    WorkBuddy 首条 user 被 <system-reminder>…</system-reminder> 包裹,真实需求在末尾
    <user_query>…</user_query> 里。取其内容;无该标签则回退到原文(已去注入前缀)。"""
    if not txt:
        return ""
    m = re.search(r"<user_query>(.*?)</user_query>", txt, re.DOTALL)
    if m:
        seg = m.group(1).strip()
        if seg:
            return re.sub(r"[\r\n\t\x1f]+", " ", seg)[:500]
    # 无 user_query 标签:若整体是 system-reminder 注入则视为无真实 prompt
    if txt.startswith("<system-reminder"):
        return ""
    return re.sub(r"[\r\n\t\x1f]+", " ", txt.strip())[:500]

def parse_workbuddy_transcript(path, lines):
    """解析 WorkBuddy 格式 transcript。
    token:遍历 assistant message 的 providerData.usage,取【最后一条非空累计值】
    (WorkBuddy 每个 turn 末尾的 assistant 消息带累计 usage,中间 tool-call 轮为空)。
    inputTokens 已含 cached_tokens;outputTokens 已含 reasoning_tokens;
    total_tokens 只计 input+output(缓存不额外计,与 parse.py/Codex 口径一致)。
    产出:顶层 function_call(name 为 Claude 风格 Write/Edit/NotebookEdit),取 file_path。
    prompt:首条 role==user 的 content[].text,剥离 <system-reminder> 包裹取 <user_query>。"""
    prompt = ""
    in_tok = out_tok = cr_tok = 0
    cw_tok = 0  # WorkBuddy 无 cache_creation 概念
    timestamps = []
    outputs = []
    session_id = None
    last_usage = None  # 最后一条非空 usage(累计值,不累加)

    for l in lines:
        try:
            r = json.loads(l)
        except Exception:
            continue
        t = r.get("type")
        tsv = r.get("timestamp")
        if tsv:
            timestamps.append(tsv)
        if not session_id:
            session_id = r.get("sessionId")

        if t == "message":
            role = r.get("role")
            if role == "user" and not prompt:
                content = r.get("content", [])
                if isinstance(content, list):
                    txt = " ".join(c.get("text", "") for c in content
                                   if isinstance(c, dict) and c.get("type") in ("input_text", "text"))
                    txt = txt.strip()
                    real = _extract_workbuddy_prompt(txt)
                    if real:
                        prompt = real
            elif role == "assistant":
                u = (r.get("providerData") or {}).get("usage")
                if isinstance(u, dict) and u.get("inputTokens") is not None:
                    last_usage = u  # 保留最后一条,不累加(累计值)
        elif t == "function_call":
            name = str(r.get("name", ""))
            if re.match(r"^(Write|Edit|NotebookEdit)$", name):
                args = r.get("arguments")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                if isinstance(args, dict):
                    fp = args.get("file_path") or args.get("notebook_path")
                    if fp:
                        outputs.append(fp)

    # 从最后一条累计 usage 取 token
    if isinstance(last_usage, dict):
        in_tok = int(last_usage.get("inputTokens", 0) or 0)
        out_tok = int(last_usage.get("outputTokens", 0) or 0)  # 已含 reasoning
        itd = last_usage.get("inputTokensDetails")
        if isinstance(itd, list) and itd and isinstance(itd[0], dict):
            cr_tok = int(itd[0].get("cached_tokens", 0) or 0)  # cached 已含在 input 内

    # 空会话过滤:无 token 且无产出
    activity_tok = in_tok + out_tok
    if activity_tok == 0 and not outputs:
        return None

    output_types = sorted(set(
        m.group(1).lower() for o in outputs
        for m in [re.search(r"\.([a-zA-Z0-9]+)$", o)] if m
    ))

    ts = _format_ts(timestamps)
    is_effective = bool(outputs)
    sid = session_id or os.path.basename(path).replace(".jsonl", "")

    return {
        "prompt": prompt,
        "output_types": output_types,
        "is_effective": is_effective,
        "total_tokens": in_tok + out_tok,  # 只计真实吞吐;缓存不额外计
        "in_tok": in_tok, "out_tok": out_tok, "cr_tok": cr_tok, "cw_tok": cw_tok,
        "ts": ts,
        "quota_hit": 0,  # WorkBuddy 无周额度触限信号
        "tool": "workbuddy",
        "session_id": sid,
    }

def parse_transcript(path, baseline=None):
    """解析 transcript JSONL，提取采集字段。返回 dict 或 None(空会话/解析失败)。
    自动分发:Codex(rollout-/session_meta)走 parse_codex_transcript,
    否则走 parse_claude_transcript(Claude Code)。baseline 透传给 codex 解析。"""
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            lines = [l for l in f if l.strip()]
    except Exception:
        return None
    if is_collector_generated_transcript(lines):
        return None
    if _is_codex_transcript(path, lines):
        return parse_codex_transcript(path, lines, baseline)
    if _is_workbuddy_transcript(path, lines):
        return parse_workbuddy_transcript(path, lines)
    return parse_claude_transcript(path, lines)

def is_collector_generated_transcript(lines):
    """跳过采集器历史上为分类而生成的会话，避免递归污染统计。"""
    marker = "请输出最贴切的：<工作性质>|<细分>"
    for l in lines[:20]:
        if marker in l:
            return True
    return False

# 通用/操作类 skill:被会话调用时不代表"业务工具",不覆盖 tool 字段。
# 命中这些 skill 时,tool 回落到该会话的底层工具(claude-code/workbuddy/…),
# 而不是把 skill 名当成 tool。业务类 skill(d2c-hui、init 等)不在此列,照常记录。
_GENERIC_SKILLS = {
    "run", "read", "init", "loop", "simplify", "review", "code-review",
    "security-review", "update-config", "keybindings-help",
    "fewer-permission-prompts", "claude-api", "claude-code-guide",
}

def _first_business_skill(skill_names):
    """从会话调过的 skill 列表里取第一个【业务类】skill 名(跳过通用/操作类)。
    没有业务类 skill 则返回 None(调用方回落到底层工具名)。"""
    for sk in skill_names:
        if sk and sk not in _GENERIC_SKILLS:
            return sk
    return None

def parse_claude_transcript(path, lines):
    """解析 Claude Code 格式 transcript(type:user/assistant)。"""
    prompt = ""
    turns = 0
    outputs = []
    in_tok = out_tok = cr_tok = cw_tok = 0
    timestamps = []
    quota_hit = 0
    tool_names = set()
    skill_names = []  # 会话调过的 skill 名(取第一个作 tool 字段)

    for l in lines:
        try:
            r = json.loads(l)
        except Exception:
            continue
        t = r.get("type")
        tsv = r.get("timestamp")
        if tsv:
            timestamps.append(tsv)
        # Codex 周额度触限检测(Claude Code 不命中,留作兼容)
        if not quota_hit:
            payload = r.get("payload") or {}
            if isinstance(payload, dict) and payload.get("type") == "token_count":
                rl = payload.get("rate_limits") or {}
                if isinstance(rl, dict) and rl.get("limit_id") == "codex":
                    # 看 primary(周额度 window_minutes==10080)
                    pri = rl.get("primary") or {}
                    if isinstance(pri, dict) and pri.get("window_minutes") == 10080:
                        pct = pri.get("used_percent")
                        if isinstance(pct, (int, float)) and pct >= 95:
                            quota_hit = 1
        if t == "user":
            turns += 1
            if not prompt:
                msg = r.get("message", {})
                content = msg.get("content", msg) if isinstance(msg, dict) else msg
                if isinstance(content, list):
                    txt = " ".join(c.get("text", "") for c in content
                                   if isinstance(c, dict) and c.get("type") == "text")
                else:
                    txt = content if isinstance(content, str) else ""
                txt = txt.strip()
                if not txt:
                    continue
                # 跳过命令类消息（/model、local-command-stdout 等，非真实需求）
                if txt.startswith("<command-name") or txt.startswith("<local-command"):
                    continue
                # Open Design od-projects 会话：第一条 user 是系统注入的 charter
                # （# Instructions / # Open Design charter，几万字），真实需求藏在
                # 末尾的 # User request 段。charter 正文里会先引用 "the # User request
                # below."，真正的段标题是最后一次出现的 # User request。取其之后到
                # 消息结尾的全部内容（含 ## user 自然需求 或 ## Latest user turn 填表答案）。
                if txt.startswith("# Instructions") or txt.startswith("# Open Design charter"):
                    idx = txt.rfind("# User request")
                    if idx >= 0:
                        seg = txt[idx + len("# User request"):]
                        seg = seg.lstrip()
                        seg = re.sub(r"^below\.\)\s*", "", seg)
                        seg = seg.strip()
                        if seg:
                            prompt = re.sub(r"[\r\n\t\x1f]+", " ", seg)[:500]
                    continue
                # 普通会话：第一条真实 user 文本即为需求
                # 压单行:防 \n 截断(与 parse.py 口径一致)
                prompt = re.sub(r"[\r\n\t\x1f]+", " ", txt)[:500]
        elif t == "assistant":
            msg = r.get("message", {})
            if isinstance(msg, dict):
                u = msg.get("usage") or {}
                if isinstance(u, dict):
                    in_tok += int(u.get("input_tokens", 0) or 0)
                    out_tok += int(u.get("output_tokens", 0) or 0)
                    cr_tok += int(u.get("cache_read_input_tokens", 0) or 0)
                    cw_tok += int(u.get("cache_creation_input_tokens", 0) or 0)
            content = msg.get("content", []) if isinstance(msg, dict) else []
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        name = str(c.get("name", ""))
                        tool_names.add(name)
                        # Skill 调用:记下具体 skill 名(input.skill),tool 字段用它
                        if name == "Skill":
                            sk = (c.get("input") or {}).get("skill", "")
                            if sk and sk not in skill_names:
                                skill_names.append(sk)
                        if re.match(r"^(Write|Edit|NotebookEdit)$", name):
                            fp = c.get("input", {}).get("file_path") or c.get("input", {}).get("notebook_path")
                            if fp:
                                outputs.append(fp)

    # 跳过空会话（没有 assistant 消息或 token 全为 0）
    # 注意:这里用【四项合计】判断会话是否真实发生过(有 cache_read 也算发生过),
    # 仅用于过滤空会话,不是消耗统计。真正上报的 total_tokens 见下方(只 in+out)。
    activity_tok = in_tok + out_tok + cr_tok + cw_tok
    if activity_tok == 0 and not outputs:
        return None

    # 产出类型
    output_types = sorted(set(
        m.group(1).lower() for o in outputs
        for m in [re.search(r"\.([a-zA-Z0-9]+)$", o)] if m
    ))

    ts = _format_ts(timestamps)
    is_effective = bool(outputs)

    # 工具名:调过【业务类】skill 用第一个 skill 名(如 d2c-hui);
    # 通用/操作类 skill(run/read/init 等)不算工具,回落到底层工具 claude-code。
    tool = _first_business_skill(skill_names) or "claude-code"

    return {
        "prompt": prompt,
        "output_types": output_types,
        "is_effective": is_effective,
        "total_tokens": in_tok + out_tok,   # 只计真实吞吐;缓存token不计入(与 parse.py 口径一致)
        "in_tok": in_tok, "out_tok": out_tok, "cr_tok": cr_tok, "cw_tok": cw_tok,
        "ts": ts,
        "quota_hit": quota_hit,
        "tool": tool,
    }

def parse_codex_transcript(path, lines, baseline=None):
    """解析 Codex 格式 transcript(type:session_meta/event_msg/response_item)。
    token 取 total_token_usage 的【最后一条累计值】(不累加,否则重复计算)。
    reasoning_output_tokens 并入 output(用户确认)。有写文件才算产出(与 Claude Code 口径一致)。

    baseline:该会话的上次基线 {last_total,last_components,last_cost,last_line_count}。
    传入则同时返回新增区段(delta_prompt/delta_outputs)与当前累计分量(current_components),
    供增量上报使用;不传则 delta_* 为空,current_components 仍返回。"""
    prompt = ""
    delta_prompt = ""          # 新增区段首条真实用户 prompt(跳过系统注入)
    in_tok = out_tok = cr_tok = 0  # Codex 无 cache_creation 概念,cw_tok 恒 0
    cw_tok = 0
    timestamps = []
    quota_hit = 0
    has_exec = False  # 是否有命令/工具执行(仅用于空会话过滤)
    outputs = []     # 全量写文件路径(判 is_effective,与 Claude Code 对齐)
    delta_outputs = []  # 新增区段内的写文件路径
    session_id = None
    tool = "codex"  # 默认;session_meta 命中 open-design 仓库时覆盖为 opendesign

    last_line_count = 0
    if isinstance(baseline, dict):
        last_line_count = int(baseline.get("last_line_count", 0) or 0)

    # 遍历,token 取最后一条 total_token_usage(累计值)
    last_usage = None
    for idx, l in enumerate(lines):
        try:
            r = json.loads(l)
        except Exception:
            continue
        t = r.get("type")
        tsv = r.get("timestamp")
        if tsv:
            timestamps.append(tsv)
        payload = r.get("payload") or {}
        if not isinstance(payload, dict):
            continue

        # session_id:从 session_meta.payload.session_id 取(比文件名稳定)
        if t == "session_meta" and not session_id:
            session_id = payload.get("session_id") or payload.get("id")
            # tool 识别:git.repository_url 含 open-design → 记 opendesign(仓库维度,最精准)
            # 覆盖默认的 "codex"。其他仓库(含 hik-design-cowork)保持 codex。
            git = payload.get("git") or {}
            repo_url = str(git.get("repository_url", "") or "")
            if "open-design" in repo_url.lower():
                tool = "opendesign"

        # token:event_msg 且 payload.type==token_count,total_token_usage 是累计值
        if t == "event_msg" and payload.get("type") == "token_count":
            info = payload.get("info") or {}
            usage = info.get("total_token_usage")
            if isinstance(usage, dict):
                last_usage = usage  # 保留最后一条,不累加
            # quota_hit:看 primary(周额度 window_minutes==10080)
            if not quota_hit:
                rl = payload.get("rate_limits") or {}
                if isinstance(rl, dict) and rl.get("limit_id") == "codex":
                    pri = rl.get("primary") or {}
                    if isinstance(pri, dict) and pri.get("window_minutes") == 10080:
                        pct = pri.get("used_percent")
                        if isinstance(pct, (int, float)) and pct >= 95:
                            quota_hit = 1

        in_delta = idx >= last_line_count

        # prompt:首条 response_item 且 role==user 的【真实】意图(跳过 CLI 注入)
        if t == "response_item" and not prompt:
            if payload.get("role") == "user":
                content = payload.get("content", [])
                if isinstance(content, list):
                    txt = " ".join(c.get("text", "") for c in content
                                   if isinstance(c, dict) and c.get("type") == "input_text")
                    txt = txt.strip()
                    if txt and not _is_system_injection(txt):
                        prompt = _extract_real_prompt(txt)
        # 增量区段的首条真实用户 prompt(供增量分类用,与整段 prompt 同口径)
        if in_delta and t == "response_item" and not delta_prompt:
            if payload.get("role") == "user":
                content = payload.get("content", [])
                if isinstance(content, list):
                    txt = " ".join(c.get("text", "") for c in content
                                   if isinstance(c, dict) and c.get("type") == "input_text")
                    txt = txt.strip()
                    if txt and not _is_system_injection(txt):
                        delta_prompt = _extract_real_prompt(txt)

        # 产出判据:优先用 patch_apply_end.changes(覆盖 Add/Update/Delete 全部,
        # 比 patch 文本解析可靠,补回 Update File 这类改文件主力产出)。
        # function_call/local_shell_call 的 shell 写动作作为兜底补充。
        ptype = payload.get("type")
        if ptype == "patch_apply_end":
            changes = payload.get("changes")
            if isinstance(changes, dict):
                for fp in changes.keys():
                    if isinstance(fp, str):
                        outputs.append(fp)
                        if in_delta:
                            delta_outputs.append(fp)
        elif ptype in ("function_call", "local_shell_call", "custom_tool_call"):
            has_exec = True
            before = len(outputs)
            _collect_codex_write_outputs(payload, outputs)
            if in_delta:
                delta_outputs.extend(outputs[before:])

    # 从最后一条累计 usage 取 token
    cur_components = {"input": 0, "cached": 0, "output": 0, "reasoning": 0}
    if isinstance(last_usage, dict):
        in_tok = int(last_usage.get("input_tokens", 0) or 0)
        cr_tok = int(last_usage.get("cached_input_tokens", 0) or 0)  # Codex 的 cached = cache_read
        out_tok = int(last_usage.get("output_tokens", 0) or 0)
        reasoning = int(last_usage.get("reasoning_output_tokens", 0) or 0)
        out_tok += reasoning  # reasoning 并入 output(用户确认)
        cur_components = {"input": in_tok, "cached": cr_tok, "output": out_tok, "reasoning": reasoning}

    # 空会话过滤:无 token 且无执行
    activity_tok = in_tok + out_tok + cr_tok + cw_tok
    if activity_tok == 0 and not has_exec:
        return None

    # 产出类型(取扩展名,与 Claude Code 口径一致)
    output_types = sorted(set(
        m.group(1).lower() for o in outputs
        for m in [re.search(r"\.([a-zA-Z0-9]+)$", o)] if m
    ))
    delta_output_types = sorted(set(
        m.group(1).lower() for o in delta_outputs
        for m in [re.search(r"\.([a-zA-Z0-9]+)$", o)] if m
    ))

    ts = _format_ts(timestamps)
    is_effective = bool(outputs)

    # session_id 覆盖:从 session_meta 取真值,文件名兜底
    sid = session_id or os.path.basename(path).replace(".jsonl", "")

    return {
        "prompt": prompt,
        "delta_prompt": delta_prompt,
        "output_types": output_types,
        "delta_output_types": delta_output_types,
        "is_effective": is_effective,
        "total_tokens": in_tok + out_tok,  # 只计真实吞吐(含 reasoning),缓存不计入
        "in_tok": in_tok, "out_tok": out_tok, "cr_tok": cr_tok, "cw_tok": cw_tok,
        "current_components": cur_components,
        "ts": ts,
        "quota_hit": quota_hit,
        "tool": tool,
        "session_id": sid,  # 覆盖 find_transcripts 的文件名兜底
        "line_count": len(lines),  # 供下次基线切分用
    }

def _collect_codex_write_outputs(payload, outputs):
    """从 Codex 执行类 payload 提取写文件路径,追加到 outputs。
    兜底路径:patch_apply_end.changes 已在 parse 阶段优先收集,
    这里只处理 apply_patch(patch 文本)与 exec_command(shell 命令)两种
    patch_apply_end 未覆盖的形态。"""
    ptype = payload.get("type")
    name = payload.get("name", "")

    # 1) apply_patch:patch 文本里 *** Add File / *** Delete File 后跟绝对路径
    if ptype == "custom_tool_call" and name == "apply_patch":
        patch = payload.get("input") or ""
        if isinstance(patch, str):
            for m in re.finditer(r"^\*\*\*\s+(?:Add|Delete)\s+File:\s*(.+?)\s*$",
                                 patch, re.MULTILINE):
                fp = m.group(1).strip()
                if fp:
                    outputs.append(fp)
        return

    # 2) function_call / local_shell_call 的 exec_command:从 cmd 文本识别写文件动作
    if ptype in ("function_call", "local_shell_call"):
        cmd = ""
        if name == "exec_command":
            args = payload.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            if isinstance(args, dict):
                cmd = args.get("cmd") or ""
        else:
            cmd = payload.get("command") or payload.get("cmd") or ""
        if not isinstance(cmd, str) or not cmd.strip():
            return
        _extract_write_paths_from_shell(cmd, outputs)

def _extract_write_paths_from_shell(cmd, outputs):
    """从 shell 命令文本识别写文件动作,提取目标路径。
    覆盖重定向(> >>)、tee、sed -i、cp/mv、apply_patch、cat> 等。
    保守提取:只认明确带路径的写动作,避免误判只读命令。"""
    # apply_patch(命令形式):patch 文本里 *** Add/Delete File
    for m in re.finditer(r"^\*\*\*\s+(?:Add|Delete)\s+File:\s*(.+?)\s*$",
                         cmd, re.MULTILINE):
        fp = m.group(1).strip()
        if fp:
            outputs.append(fp)

    # 重定向 > / >> :取重定向符号后的路径(跳过 &、fd、/dev/null 等)
    for m in re.finditer(r">>?\s*(?!&)\s*([^\s;|&<>]+)", cmd):
        fp = m.group(1).strip().strip('"').strip("'")
        if fp and "/" in fp and not fp.startswith("/dev/"):
            outputs.append(fp)

    # tee / tee -a <file>
    for m in re.finditer(r"\btee\s+(?:-[a-z]+\s+)*([^\s;|&<>]+)", cmd):
        fp = m.group(1).strip().strip('"').strip("'")
        if fp and "/" in fp:
            outputs.append(fp)

    # 注:sed -i 就地改文件理论上算产出,但 -i 后跟脚本表达式(含/分隔符),
    # 正则难以可靠区分脚本与文件路径,易误判。真实 Codex 工作流改文件全走
    # apply_patch,sed 仅用于只读打印(sed -n),故不识别 sed -i,避免误判。
    # cp / mv :目标路径为最后一个参数(保守:要求含 / 视为文件路径)
    for m in re.finditer(r"\b(?:cp|mv)\s+(?:-[a-zA-Z]+\s+)*(\S+)\s+(\S+)", cmd):
        dst = m.group(2).strip().strip('"').strip("'")
        if dst and "/" in dst and not dst.startswith("/dev/"):
            outputs.append(dst)

    # cat > <file> / cat >> <file>
    for m in re.finditer(r"\bcat\s+>>?\s*([^\s;|&<>]+)", cmd):
        fp = m.group(1).strip().strip('"').strip("'")
        if fp and "/" in fp and not fp.startswith("/dev/"):
            outputs.append(fp)

def _format_ts(timestamps):
    """从时间戳列表取最后一条,格式化成 'YYYY-MM-DD HH:MM:SS'(北京时间)。

    Codex/Claude transcript 的 timestamp 是 UTC(带 Z 或 +00:00),直接取会差 8 小时
    (如 UTC 03:03 会显示成凌晨 3 点,实际是北京 11:03)。这里统一转成东八区,
    与系统本地时间口径一致。

    已带 +08:00 偏移的(少数 Claude 会话)直接用原值;无时区标记的按 UTC 处理。
    """
    if not timestamps:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    last = timestamps[-1]
    # WorkBuddy:timestamp 是 epoch 数值(毫秒或秒),非 ISO 字符串。
    # 直接按 UTC 转东八区(utcfromtimestamp + 8h),避免落到 now() 兜底把历史会话误标成今天。
    if isinstance(last, (int, float)) or (isinstance(last, str) and last.isdigit()):
        try:
            v = float(last)
            if v > 1e12:  # 毫秒
                v /= 1000.0
            dt = datetime.utcfromtimestamp(v) + timedelta(hours=8)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    raw = str(last).strip()
    # 已带东八区偏移:直接取日期时间部分
    if raw.endswith("+08:00"):
        m = re.match(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})", raw)
        if m:
            return f"{m.group(1)} {m.group(2)}"
    # UTC(Z 或 +00:00)或无时区标记:按 UTC 解析后 +8 小时
    s = re.sub(r"(Z|\+00:00)$", "", raw)
    dt = None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s[:26] if "." in s else s[:19], fmt)
            break
        except Exception:
            continue
    if dt is None:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dt = dt + timedelta(hours=8)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

# ---- 工作性质分类(纯 Python,跨平台,不依赖 bash) ----
# 与 classify.sh 的 rule_classify 等价:意图词为主,产物族为辅。
# 工作分类只用本地规则，避免采集过程额外调用 AI 造成额度消耗。
_STRAT_KW = re.compile(r"方案|探索|新的|全新|怎么做|为什么|定义|拆解|竞品|调研|用研|对比|需求|信息架构|流程|改造|架构|另起炉灶|重新设计|重构")
_WEB_EXT = {"html", "css", "tsx", "jsx", "vue", "js"}
_IMG_EXT = {"png", "jpg", "jpeg", "svg", "webp"}
_DOC_EXT = {"md", "docx", "doc", "txt"}
_CODE_EXT = {"json", "py", "yaml", "yml", "ts", "sh"}

# Codex CLI 注入的系统/环境上下文,不是用户真实意图,提取 prompt 时跳过。
# 已验证:这些 user 消息的 payload keys 与真实 prompt 一致,只能靠文本特征区分。
_SYS_INJECTION_PREFIXES = ("<environment_context", "<recommended_plugins")
# Open Design charter 注入(codex 格式里以 # Instructions 开头的系统 charter,几万字)。
# 真实需求藏在末尾的 # User request 段,与 Claude Code 格式同口径。
_CHARTER_PREFIXES = ("# Instructions", "# Open Design charter")
# CLI 启动占位(无显式 prompt 时 codex 自动填的"你好")。
_WEAK_PROMPT_KW = re.compile(r"^(继续|修复|ok|好的|好|嗯|对|是的|可以|继续修改|继续执行)\s*[，。!!.?\s]*$")

def _is_system_injection(text):
    """判断是否 Codex CLI 注入的系统上下文(非用户真实意图)。
    覆盖:environment_context、recommended_plugins、Open Design charter。"""
    if not text or not text.strip():
        return True
    t = text.strip()
    if t == "你好":
        return True
    if any(t.startswith(p) for p in _SYS_INJECTION_PREFIXES):
        return True
    # Open Design charter:取末尾 # User request 段为真实意图
    return False

def _extract_real_prompt(text):
    """从可能含 Open Design charter 的 user 文本里提取真实需求。
    charter 以 # Instructions 开头,真实需求藏在末尾 # User request 段。
    非 charter 文本原样返回(已截断到 500 字)。"""
    if not text:
        return ""
    t = text.strip()
    if not any(t.startswith(p) for p in _CHARTER_PREFIXES):
        return re.sub(r"[\r\n\t\x1f]+", " ", t)[:500]
    # charter:取最后一次 # User request 之后的内容
    idx = t.rfind("# User request")
    if idx >= 0:
        seg = t[idx + len("# User request"):].lstrip()
        seg = re.sub(r"^below\.\)\s*", "", seg).strip()
        if seg:
            return re.sub(r"[\r\n\t\x1f]+", " ", seg)[:500]
    return ""  # charter 无 # User request 段,视为系统注入

def _is_weak_prompt(text):
    """判断是否弱 prompt:太短/无明确意图(如"继续""修复""ok")。
    弱 prompt 时沿用上一段有明确意图的分类(方案 B),纯代码不调 AI。"""
    if not text or not text.strip():
        return True
    return bool(_WEAK_PROMPT_KW.match(text.strip()))

def _family_of(output_types_csv):
    """产物族:web/img/doc/code/none。取首个命中族(与 classify.sh case 顺序一致)。"""
    if not output_types_csv:
        return "none"
    exts = {e.strip().lower() for e in output_types_csv.split(",") if e.strip()}
    if exts & _WEB_EXT: return "web"
    if exts & _IMG_EXT: return "img"
    if exts & _DOC_EXT: return "doc"
    if exts & _CODE_EXT: return "code"
    return "none"

def rule_classify(prompt_text, output_types_csv):
    """纯 Python 规则分类。产物族为强信号,转型意图词辅助判 nature。
    D2C 属转型能力(strategic),不新增任何 subtype。"""
    p = prompt_text or ""
    is_strat = bool(_STRAT_KW.search(p) or "d2c" in p.lower())
    fam = _family_of(output_types_csv)
    if fam == "web":
        return ("strategic", "D2C") if is_strat else ("execution", "页面还原")
    if fam == "code":
        return ("strategic", "D2C") if is_strat else ("execution", "检索问答")
    if fam == "img":
        return ("execution", "图片处理")
    if fam == "doc":
        return ("strategic", "需求分析") if is_strat else ("execution", "文档处理")
    # none:无产物,看意图
    return ("strategic", "交互设计") if is_strat else ("execution", "检索问答")

def classify_work(prompt_text, output_types_csv, fallback=None):
    """work_nature + work_subtype 分类。纯 Python,跨平台,不调用 AI。
    弱 prompt(继续/修复/ok 等)且无产物时,沿用 fallback(上一段有明确意图的分类)。"""
    has_prompt = bool(prompt_text and prompt_text.strip())
    has_output = bool(output_types_csv and output_types_csv.strip())
    if not has_prompt and not has_output:
        return "unknown", "unknown"
    # 弱 prompt 且无产物族 → 沿用上文(方案 B)
    if has_prompt and _is_weak_prompt(prompt_text) and _family_of(output_types_csv) == "none":
        if fallback and fallback != ("unknown", "unknown"):
            return fallback
    return rule_classify(prompt_text, output_types_csv)

def calc_cost(in_tok, out_tok, cr_tok, cw_tok):
    """按 pricing.json 折算费用（人民币）。

    口径(2026-08-04 变更):费用只计 input+output 真实吞吐,
    cache_read/cache_write 缓存 token 不计入费用(cache 单价低但量大,
    计入会虚高费用;且看板 cost_cny 与 total_tokens 同口径)。
    参数 cr_tok/cw_tok 保留仅为兼容调用方,不再参与计价。
    """
    try:
        pr = safe_load_json(PRICING)
        p = pr.get("prices_usd_per_1m", {})
        rate = float(pr.get("usd_to_cny", 7.2))
        usd = (in_tok*p.get("input",0) + out_tok*p.get("output",0)) / 1_000_000.0
        return round(usd * rate, 4)
    except Exception:
        return 0.0

def build_payload(session_id, ts, user, group, tool, work_nature, work_subtype,
                  is_effective, total_tokens, cost_cny, quota_hit):
    """组装对齐 usage_raw 的 11 列 payload。total_tokens/cost_cny 为【增量】值。
    ts 用本次上报时刻(区分同一 session_id 的多行增量)。"""
    return {
        "session_id": session_id,
        "ts": ts,
        "user_name": user,
        "group_name": group,
        "tool": tool,
        "work_nature": work_nature,
        "work_subtype": work_subtype,
        "is_effective": is_effective,
        "total_tokens": total_tokens,
        "cost_cny": cost_cny,
        "quota_week_hit": quota_hit,
    }

def report(url, payload):
    """POST payload 到 report 接口。返回 True/False。失败时打印原因,便于排查。"""
    if not url:
        return False
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            r = json.loads(body)
            if r.get("code") == 0:
                return True
            # 业务失败(如重复键):打印 msg/error,不静默吞
            print(f"  ⚠️ 服务端拒绝: {str(r.get('msg',''))[:80]} {str(r.get('error',''))[:120]}")
            return False
    except Exception as e:
        print(f"  ⚠️ 上报异常: {type(e).__name__}: {str(e)[:120]}")
        return False

def main():
    if not DRY:
        try:
            from update_collector import check_for_updates
            update_result = check_for_updates()
            if update_result.get("status") == "updated":
                print(
                    "  ✅ 采集脚本已更新: {} -> {}（下次定时采集生效）".format(
                        update_result.get("previous_version") or "unknown",
                        update_result.get("version"),
                    )
                )
        except Exception as update_error:
            print(
                "  ⚠️ 采集脚本更新跳过: {}: {}".format(
                    type(update_error).__name__, str(update_error)[:160]
                )
            )
    url, user, group, machine = get_config()
    baselines = load_baselines()
    retry_queue = load_retry_queue()
    collect_start_date = get_collect_start_date()
    transcripts = find_transcripts()

    if not transcripts:
        print("未找到任何 transcript 文件。")
        return

    new_count = 0
    skip_count = 0
    fail_count = 0
    old_count = 0
    duplicate_count = 0
    retry_ok_count = 0
    retry_fail_count = 0
    latest_by_sid = {}

    if retry_queue and not DRY:
        for k, payload in list(retry_queue.items()):
            if report(url, payload):
                retry_queue.pop(k, None)
                retry_ok_count += 1
                print(f"  ✅ 重试成功 {k}: tok={payload.get('total_tokens', 0)} cost={payload.get('cost_cny', 0)}")
            else:
                retry_fail_count += 1
                print(f"  ❌ 重试失败 {k}")

    for path, raw_sid in transcripts:
        # baseline 用文件路径做 key(parse 前就知道,且同一会话文件路径固定)
        baseline = baselines.get(str(path))
        parsed = parse_transcript(path, baseline=baseline)
        if not parsed:
            skip_count += 1
            continue

        # Codex 的 session_id 从 session_meta 取真值覆盖文件名兜底
        sid = parsed.get("session_id") or raw_sid
        if str(parsed.get("ts", ""))[:10] < collect_start_date:
            old_count += 1
            skip_count += 1
            continue

        item = latest_by_sid.get(sid)
        if not item:
            latest_by_sid[sid] = {"path": path, "parsed": parsed, "baseline": baseline}
            continue

        prev = item["parsed"]
        prev_key = (str(prev.get("ts", "")), int(prev.get("total_tokens", 0) or 0))
        next_key = (str(parsed.get("ts", "")), int(parsed.get("total_tokens", 0) or 0))
        if next_key > prev_key:
            item["parsed"] = parsed
            item["path"] = path
            item["baseline"] = baseline
        duplicate_count += 1

    for sid, item in sorted(latest_by_sid.items(), key=lambda kv: str(kv[1]["parsed"].get("ts", ""))):
        parsed = item["parsed"]
        path = item["path"]
        baseline = item["baseline"] or {}

        # ---- 算增量 ----
        last_total = int(baseline.get("last_total", 0) or 0)
        last_cost = float(baseline.get("last_cost", 0.0) or 0.0)
        cur_total = int(parsed.get("total_tokens", 0) or 0)
        delta_tok = cur_total - last_total

        # 当前累计费用(按当前分量算)
        cur_cost = calc_cost(parsed["in_tok"], parsed["out_tok"], parsed["cr_tok"], parsed["cw_tok"])
        delta_cost = round(cur_cost - last_cost, 4)

        # 增量为 0:无新对话数据,跳过
        if delta_tok <= 0 and delta_cost <= 0:
            skip_count += 1
            continue

        # ---- 分类:按新增区段 prompt + 产物族,弱 prompt 沿用上文 ----
        delta_prompt = parsed.get("delta_prompt") or parsed.get("prompt") or ""
        delta_types_csv = ",".join(parsed.get("delta_output_types") or parsed.get("output_types") or [])
        # fallback:整段 prompt 的分类(作为弱 prompt 沿用的上文)
        full_types_csv = ",".join(parsed.get("output_types") or [])
        fallback = classify_work(parsed.get("prompt") or "", full_types_csv)
        wn, wst = classify_work(delta_prompt, delta_types_csv, fallback=fallback)

        # ---- payload:发增量,ts 用本次上报时刻 ----
        report_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        payload = build_payload(sid, report_ts, user, group, parsed["tool"], wn, wst,
                                parsed["is_effective"], delta_tok, delta_cost, parsed["quota_hit"])

        if DRY:
            print(f"[DRY] {sid}: ts={parsed['ts']} Δtok={delta_tok} Δcost={delta_cost} cur={cur_total} eff={parsed['is_effective']} {wn}|{wst} | {delta_prompt[:40]}")
            new_count += 1
            continue

        # 本地留档(追加,与服务端一一对应)
        append_local_payload(payload)
        new_count += 1

        # 上报
        ok = report(url, payload)
        report_key = f"{sid}#{report_ts}"
        if ok:
            retry_queue.pop(report_key, None)
            # 成功:更新基线为当前累计值(key 用文件路径)
            baselines[str(path)] = {
                "last_total": cur_total,
                "last_components": parsed.get("current_components") or {},
                "last_cost": cur_cost,
                "last_line_count": parsed.get("line_count", 0),
            }
            print(f"  ✅ {sid}: Δtok={delta_tok} Δcost={delta_cost} {wn}|{wst}")
        else:
            retry_queue[report_key] = payload
            fail_count += 1
            print(f"  ❌ {sid}: 上报失败(Δtok={delta_tok})")

    if not DRY:
        save_retry_queue(retry_queue)
        save_baselines(baselines)
    print(f"\n扫描完成: {len(transcripts)} 个 transcript, 上报 {new_count}, 跳过 {skip_count}, 历史 {old_count}, 重复 {duplicate_count}, 失败 {fail_count}, 重试成功 {retry_ok_count}, 重试失败 {retry_fail_count}, 待重试 {len(retry_queue)}")

if __name__ == "__main__":
    main()
