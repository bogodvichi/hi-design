/**
 * 历史评审列表 / 详情 Modal 共享的小工具。
 *
 * 从 `ReviewListModal` 抽出，避免详情弹窗复制一份同款取值/格式化逻辑。
 * 纯函数、无 React 依赖，两端都 import。
 */

/** 取值：缺失时回退为 fallback，再不行给「—」。0 视为有效值（保留）。 */
export function pick(...vals: any[]): string {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '—';
}

/** 把「已完成 / 评审中」这类计数格式化为 `X / Y`；缺总数时只显示 X。 */
export function withTotal(count: string, total: string): string {
  if (count === '—') return '—';
  if (total === '—') return count;
  return `${count} / ${total}`;
}

/** 由截止时间算剩余整天数。优先用 ISO 串 `preReviewEndTimeDate`，
 *  缺失再回退 `preReviewEndTime`（"2024/12/04 23:59:59"）。解析失败返回 null。 */
export function computeRemainDays(iso?: unknown, fallback?: unknown): number | null {
  const s = typeof iso === 'string' && iso ? iso : typeof fallback === 'string' ? fallback : null;
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * 把时间串统一格式化为 `YYYY/MM/DD HH:mm:ss`。
 *
 * oneByReviewId 的 `createTimeDate` / `preReviewEndTimeDate` 是带 +08:00 偏移的
 * ISO 串（如 `2024-11-06T11:38:14.997+08:00`），直接展示不友好；这里按本地时区
 * 解析后格式化为 `2024/11/06 11:38:14`。已是该格式的串（如 reviewList 列表项的
 * `createTime`）会被 `Date.parse` 解析后重新格式化，结果一致。解析失败回退原串；
 * 空值回退「—」。
 */
export function formatDateTime(val: unknown): string {
  if (val === undefined || val === null || val === '') return '—';
  const s = typeof val === 'string' ? val : String(val);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 把稿件版本号格式化为 `V1.0` 样式。
 *
 * subProcess 稿件项的 `version` 上游是数字或字符串（如 `1` / `"1"` / `2`），
 * 列表卡片右上角与详情都需展示「V1.0」这种带一位小数的形式；这里统一补
 * 成 `V<major>.0`。缺省或无法解析时回退「—」。
 */
export function formatVersion(val: unknown): string {
  if (val === undefined || val === null || val === '') return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return `V${n}.0`;
}

/**
 * 从稿件列表里聚合出全部不重复版本号（数字升序）。
 *
 * 详情的版本下拉需要展示一份评审下所有稿件的版本集合（同一版本可能有多份稿件），
 * 这里从 subProcess `data.list[]` 抽取并去重排序，供下拉选择。
 */
export function collectVersions(list: any[]): number[] {
  if (!Array.isArray(list)) return [];
  const set = new Set<number>();
  for (const m of list) {
    const n = Number(m?.version);
    if (Number.isFinite(n)) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * 评审类型 → 头像首字 + 背景色，显示在创建人前。
 *
 * reviewType 取值（对齐 `apps/daemon/src/routes/hik/_routes/uedro.ts` 注释）：
 *   "1"  交互评审 → 交（橙）
 *   "2"  视觉评审 → 视（红）
 *   "3"  文稿评审 → 文（青）
 *   "4"  表格评审 → 表（绿）
 *   "5"  海客评审 → 海（随机深色）
 *   "10" 插件评审 → 插（随机深色）
 *   "11" Pixso Handoff → P（首字母大写，随机深色）
 *
 * 随机深色按 reviewNum 稳定哈希取色，避免 React 重渲染时颜色抖动。
 * 无法识别的 reviewType 返回 null（不渲染头像）。
 */
export const REVIEW_TYPE_META: Record<string, { char: string; color: string }> = {
  '1': { char: '交', color: 'rgb(237, 183, 64)' },
  '2': { char: '视', color: 'rgb(245, 107, 110)' },
  '3': { char: '文', color: 'rgb(21, 188, 216)' },
  '4': { char: '表', color: 'rgb(92, 214, 92)' },
  '5': { char: '海', color: 'rgb(120, 60, 160)' },
  '10': { char: '插', color: 'rgb(90, 110, 180)' },
  '11': { char: 'P', color: 'rgb(60, 130, 140)' },
};

export function reviewTypeMeta(r: any): { char: string; color: string } | null {
  const t = r?.reviewType;
  if (t === undefined || t === null || t === '') return null;
  const key = String(t);
  const base = REVIEW_TYPE_META[key];
  if (base) return base;
  // 未知类型：用稳定哈希取一个深色，首字取 reviewType 串首字符。
  return { char: key.charAt(0).toUpperCase() || '?', color: darkColorFrom(r) };
}

/** 由评审标识稳定派生一个深色（HSL，亮度 38%），用于海客/插件/Pixso 等随机色类型。 */
export function darkColorFrom(r: any): string {
  const seed = String(r?.reviewNum ?? r?.id ?? r?.reviewName ?? Math.random());
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}

/** 评审类型 → 中文标签（用于详情头部副标题）。未识别回退「其它」。 */
const REVIEW_TYPE_LABEL: Record<string, string> = {
  '1': '交互评审',
  '2': '视觉评审',
  '3': '文稿评审',
  '4': '表格评审',
  '5': '海客评审',
  '10': '插件评审',
  '11': 'Pixso Handoff',
};

/**
 * 按评审类型构造羽点稿件预览页 URL（点击卡片时新开页查看稿件内容）。
 *
 * 返回根相对路径（`/uedro/ux?id=…`），由 daemon 的根路径反向代理透传到羽点
 * 上游——直接访问 `https://uedro.hikvision.com.cn/…` 需要登录，浏览器跨源也
 * 带不上 uedro 会话 cookie；走本地代理则始终同源，daemon 注入本地 SSO session
 * 里的 uedro cookie。详见 `apps/daemon/src/routes/hik/_routes/uedro.ts` 的
 * `/uedro` / `/portal` 反向代理。
 *
 * manuscriptId 取自 `manuscriptDtos[0].manuscriptId`；不同 reviewType 走羽点
 * 不同的预览前端路由（对齐原站卡片点击行为）：
 *   "1" 交互评审 → /uedro/ux?id=<manuscriptId>
 *   "2" 视觉评审 → /uedro/ua?id=<manuscriptId>
 *   "3" 文稿评审 → /uedro/pdf-js?id=<manuscriptId>&projectid=null&projName=&projManager=null
 *   "4" 表格评审 → /uedro/xlsx?id=<manuscriptId>&projectid=null&projName=&projManager=null
 * 缺少 manuscriptId 或类型无对应预览页（海客/插件/Pixso 等）时返回 null，
 * 由调用方决定不响应点击。
 */
export function buildManuscriptPreviewUrl(reviewType: unknown, manuscriptId: unknown): string | null {
  if (manuscriptId === undefined || manuscriptId === null || manuscriptId === '') return null;
  const id = encodeURIComponent(String(manuscriptId));
  const t = reviewType === undefined || reviewType === null ? '' : String(reviewType);
  switch (t) {
    case '1':
      return `http://127.0.0.1:9529/uedro/ux?id=${id}`;
    case '2':
      return `http://127.0.0.1:9529/uedro/ua?id=${id}`;
    case '3':
      return `http://127.0.0.1:9529/uedro/pdf-js?id=${id}&projectid=null&projName=&projManager=null`;
    case '4':
      return `http://127.0.0.1:9529/uedro/xlsx?id=${id}&projectid=null&projName=&projManager=null`;
    default:
      return null;
  }
}

export function reviewTypeLabel(r: any): string {
  const t = r?.reviewType;
  if (t === undefined || t === null || t === '') return '—';
  return REVIEW_TYPE_LABEL[String(t)] ?? '其它';
}
