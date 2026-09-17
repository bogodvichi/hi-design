import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewListModal.module.css';
import { pick, computeRemainDays, withTotal, reviewTypeMeta, formatVersion, buildManuscriptPreviewUrl } from './reviewMeta';
import { ReviewDetailDrawer } from './ReviewDetailModal';
import { ReviewManuscriptUpdateModal } from './ReviewManuscriptUpdateModal';
import { ReviewEditModal } from './ReviewEditModal';
import { openExternalUrl } from '../providers/registry';
import { getStoredUserInfo } from '../auth/auth';

/** 卡片「更多」下拉的操作。评审详情为第一项（打开右侧抽屉，非异步操作），
 *  其余三项对齐羽点原站卡片左下角的子功能菜单。 */
type CardAction = 'detail' | 'download' | 'remind' | 'notify' | 'finish';

/** 单卡片操作状态：当前展开的下拉、各项的 pending / 结果反馈。 */
interface CardActionState {
  open: boolean;
  pending: CardAction | null;
  // 成功 / 失败提示文案，null = 无提示。展示 2.5s 后自动清除。
  toast: { text: string; tone: 'ok' | 'err' } | null;
  // 「开启通知」需要反映当前订阅态：原站按 subscriptionStatus 字段渲染开关。
  notifyOn: boolean;
}

/**
 * 历史评审 Modal：列出羽点（uedro）的评审列表。
 *
 * 数据来自后端 `POST /api/hik/uedro/reviewList`（透传羽点上游 reviewList），
 * 请求体字段与 `apps/daemon/src/routes/hik/_routes/uedro.ts` 对齐。未登录或
 * 会话失效时后端返回 401，这里展示错误。
 *
 * 列表区顶部筛选栏：
 *   左侧 processType 单选切换（评审中/我参与的/我发起的/全部）
 *   右侧 reviewType 下拉 + reviewName 搜索框（300ms 防抖）
 * 任一筛选条件变化都重置到第 1 页重新拉取。
 *
 * 「评审详情」是卡片「更多」下拉的第一项，打开右侧抽屉（ReviewDetailDrawer），
 * 抽屉叠加在列表画框之上，从右边缘滑入；关闭即回到列表。
 *
 * 宽高弹性固定为视口 80%（加载/错误/空态共用同一画框）；卡片网格布局，
 * 列表区纵向滚动到底自动加载下一页（无翻页栏），末页显示「没有更多了」。
 */
const PAGE_SIZE = 9;

/** processType 选项（对齐 uedro.ts 注释）。 */
const PROCESS_TYPES: { value: number; label: string }[] = [
  { value: 0, label: '评审中' },
  { value: 1, label: '我参与的' },
  { value: 2, label: '我发起的' },
  { value: 3, label: '全部' },
];

/** reviewType 选项（对齐 REVIEW_TYPE_META + uedro.ts 注释）。空串 = 全部。 */
const REVIEW_TYPES: { value: string; label: string }[] = [
  { value: '', label: '全部类型' },
  { value: '1', label: '交互评审' },
  { value: '2', label: '视觉评审' },
  { value: '3', label: '文稿评审' },
  { value: '5', label: '海客评审' },
  { value: '10', label: '插件评审' },
  { value: '11', label: 'Pixso-Handoff' },
];

export function ReviewListModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  /** 当前 open-design 项目 ID，供「更新评审稿」走 Axure 导出流程使用。 */
  projectId?: string;
}) {
  // loading 区分两种语义：首屏/筛选切换的整屏 loading，和滚动到底的「加载更多」loading。
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 加载更多失败：不冲掉已渲染卡片，只在列表底部显示并允许重试，故独立于 error。
  const [moreError, setMoreError] = useState<string | null>(null);
  // 累积式列表：滚动加载下一页时追加到末尾，而不是替换。
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  // 本页返回条数 < PAGE_SIZE 视为已到末页（上游未提供 total 字段）。
  const [reachedEnd, setReachedEnd] = useState(false);

  // 筛选条件：processType / reviewType / reviewName（搜索框）。
  const [processType, setProcessType] = useState(0);
  const [reviewType, setReviewType] = useState('');
  const [reviewName, setReviewName] = useState('');
  // 防抖后的搜索词——真正的请求用这个值，输入框用 reviewName 即时响应。
  const [debouncedName, setDebouncedName] = useState('');

  // 评审详情抽屉：叠加在列表画框之上，由卡片「更多」→「评审详情」触发。
  const [detailReview, setDetailReview] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // 更新评审稿小 modal：叠加在列表画框之上，由卡片右下角「更新」按钮触发。
 const [updateReview, setUpdateReview] = useState<any | null>(null);
 const [updateOpen, setUpdateOpen] = useState(false);
  // 编辑评审 modal：叠加在列表画框之上，由卡片右下角「编辑」按钮触发。
  const [editReview, setEditReview] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // 弹窗关闭 / 组件卸载后不再写状态，避免异步回填到已卸载组件。
  const aliveRef = useRef(true);
  // 最新一次请求的序号，丢弃过期响应（筛选快速切换时旧响应可能晚到）。
  const reqIdRef = useRef(0);

  // 搜索框 300ms 防抖：把 reviewName 同步到 debouncedName。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(reviewName), 300);
    return () => clearTimeout(t);
  }, [reviewName]);

  /** 拉取一页评审列表。仅做请求与解析，不写状态——状态由调用方写入，
   *  这样首屏加载、滚动加载更多、筛选切换都能在 aliveRef 失效时安全跳过回填。 */
  async function fetchPage(
    pageNo: number,
    filters: { processType: number; reviewType: string; reviewName: string },
  ): Promise<{ list: any[]; reachedEnd: boolean }> {
    const resp = await fetch('/api/hik/uedro/reviewList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewName: filters.reviewName,
        processType: filters.processType,
        reviewModel: 0,
        reviewType: filters.reviewType || null,
        pageSize: PAGE_SIZE,
        pageNo,
        total: 0,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok) throw new Error('reviewList failed');
    const list = Array.isArray(json?.data) ? json.data : [];
    return { list, reachedEnd: list.length < PAGE_SIZE };
  }

  // 首屏 / 筛选切换：重置列表，整屏 loading。
  // 滚动加载更多用单独的 loadMore，这里始终整表替换（清空上一组筛选的结果）。
  async function loadPage(
    pageNo: number,
    filters: { processType: number; reviewType: string; reviewName: string },
  ) {
    if (pageNo < 1) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    setPage(pageNo);
    try {
      const { list, reachedEnd } = await fetchPage(pageNo, filters);
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setItems(list);
      setReachedEnd(reachedEnd);
    } catch (err: any) {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('评审列表加载失败: ' + (err?.message || String(err)));
      setItems([]);
      setReachedEnd(true);
    } finally {
      if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
    }
  }

  // 滚动加载更多：把下一页追加到列表末尾，不重置已渲染内容。
  // loadingMore 独立于 loading，避免触发整屏 loading 把已加载的卡片冲掉。
  // loadingMoreRef 是同步守卫：IntersectionObserver 可能在同一 tick 内连续
  // 回调，此时 setLoadingMore 尚未刷新，闭包里的 loadingMore 仍是 false，
  // 没有 ref 守卫就会并发发两次请求。
  const loadingMoreRef = useRef(false);
  async function loadMore() {
    if (loading || loadingMoreRef.current || reachedEnd || !aliveRef.current) return;
    const next = page + 1;
    const filters = { processType, reviewType, reviewName: debouncedName };
    const reqId = ++reqIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    setPage(next);
    try {
      const { list, reachedEnd } = await fetchPage(next, filters);
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setItems((prev) => [...prev, ...list]);
      setReachedEnd(reachedEnd);
    } catch (err: any) {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      // 加载更多失败不冲掉已加载内容，仅退回页码并在列表底部提示可重试。
      setPage(page);
      setMoreError('加载更多失败: ' + (err?.message || String(err)));
    } finally {
      if (aliveRef.current && reqId === reqIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  // 打开时 / 筛选条件变化时，重置到第 1 页重新拉取（列表替换，整屏 loading）。
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    const filters = { processType, reviewType, reviewName: debouncedName };
    void loadPage(1, filters);
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processType, reviewType, debouncedName]);

  // 滚动到底自动加载下一页：body 滚动接近底部时触发 loadMore。
  // 用哨兵 div + IntersectionObserver，比监听 scroll 事件更省、更稳。
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 列表区滚动容器 ref：IntersectionObserver 的 root。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: '120px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length, reachedEnd, loadingMore, page]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.shell} role="dialog" aria-modal="true">
       <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.kicker}>REVIEW</div>
            <h2 className={styles.title}>历史评审</h2>
            <p className={styles.subtitle}>来自羽点（uedro）的评审列表</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {/* 筛选栏：左侧 processType 单选切换，右侧 reviewType 下拉 + 搜索框。 */}
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="评审范围">
            {PROCESS_TYPES.map((pt) => (
              <button
                key={pt.value}
                type="button"
                role="tab"
                aria-selected={processType === pt.value}
                className={`${styles.tab} ${processType === pt.value ? styles.tabActive : ''}`}
                onClick={() => setProcessType(pt.value)}
              >
                {pt.label}
              </button>
            ))}
          </div>
          <div className={styles.filters}>
            <select
              className={styles.select}
              value={reviewType}
              onChange={(e) => setReviewType(e.target.value)}
              aria-label="按评审类型过滤"
            >
              {REVIEW_TYPES.map((rt) => (
                <option key={rt.value || 'all'} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
            <input
             type="search"
             className={styles.search}
             placeholder="请输入评审名称/创建人/项目名称"
             value={reviewName}
              onChange={(e) => setReviewName(e.target.value)}
              aria-label="按评审名称搜索"
            />
          </div>
        </div>

        <div className={styles.body} ref={scrollRef}>
          {loading ? (
            <div className={styles.stateWrap}>
              <div className={styles.spinner} />
              <span>加载中…</span>
            </div>
          ) : error && items.length === 0 ? (
            <div className={styles.stateWrap}>
              <span className={styles.errorText}>{error}</span>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateWrap}>
              <span>暂无评审</span>
            </div>
          ) : (
            <div className={styles.grid}>
             {items.map((r: any, i: number) => (
               <ReviewCard
                 key={r?.reviewNum ?? r?.id ?? i}
                 r={r}
                 onOpenDetail={(review) => {
                   setDetailReview(review);
                   setDetailOpen(true);
                 }}
                 onOpenUpdate={(review) => {
                   setUpdateReview(review);
                   setUpdateOpen(true);
                 }}
                 onOpenEdit={(review) => {
                   setEditReview(review);
                   setEditOpen(true);
                 }}
              />
             ))}
            </div>
          )}

          {/* 哨兵：滚动进入视口即触发 loadMore；末页时改显「没有更多了」。
           * 末页或无内容时不渲染哨兵，避免重复触发；loadingMore 显「加载更多中…」。
           * 已渲染卡片但滚动条尚短不到底部时，哨兵一进入视口也会自动加载。 */}
          {!loading && items.length > 0 ? (
            <div className={styles.listFoot} ref={sentinelRef}>
              {moreError ? (
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={() => void loadMore()}
                >
                  {moreError} · 点击重试
                </button>
              ) : loadingMore ? (
                <span className={styles.listFootHint}>
                  <span className={styles.spinnerSmall} />
                  加载更多中…
                </span>
              ) : reachedEnd ? (
                <span className={styles.listFootHint}>没有更多了</span>
              ) : (
                <span className={styles.listFootHint}>向下滚动加载更多</span>
              )}
            </div>
          ) : null}
        </div>

        <div className={styles.foot}>
          <span className={styles.footHint}>
            {loading || items.length === 0
              ? ''
              : reachedEnd
                ? `共 ${items.length} 条 · 已全部加载`
                : `已加载 ${items.length} 条`}
          </span>
          <button type="button" className={styles.pagerBtn} onClick={onClose}>
            关闭
          </button>
        </div>
       <ReviewDetailDrawer
         review={detailReview}
         open={detailOpen}
         onClose={() => setDetailOpen(false)}
       />
       <ReviewManuscriptUpdateModal
         open={updateOpen}
         onClose={() => setUpdateOpen(false)}
         reviewId={pick(updateReview?.reviewId, updateReview?.id)}
         category={String(updateReview?.reviewType ?? '')}
        reviewName={pick(updateReview?.reviewName, updateReview?.name)}
        projectId={projectId}
        manuscriptId={updateReview?.manuscriptDtos?.[0]?.manuscriptId ?? ''}
      />
      <ReviewEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        reviewId={pick(editReview?.reviewId, editReview?.id)}
        reviewName={pick(editReview?.reviewName, editReview?.name)}
      />
     </div>
    </div>,
    document.body,
  );
}

/** 评审卡片：一个评审项 = 一张卡片，分层展示核心字段。
 *
 * 字段映射对齐羽点上游 reviewList 透传结构（见真实响应）：
 *   创建人        creator
 *   主标题        projectName → manuscriptDtos[0].fileName（即 xlsx/docx 文件名）
 *   评审名称      reviewName
 *   核心评委评审率 coreReviewerRatePercent（上游已是 "0%" / "100.00%" 百分比串）
 *   创建时间      createTime          "2024/12/02 10:29:55"
 *   结束时间      preReviewEndTime     "2024/12/04 23:59:59"
 *   已完成        finishReviewResNum   （分母取 repeat.reviewersNum = 评委人数）
 *   评审中        reviewingNum         （分母同上）
 *   缺陷数量      defectsNum           （缺失回退 manuscriptDtos[0].defectNums）
 *   剩余天数      由 preReviewEndTimeDate 计算，已过期 clamp 到 0（"剩余 0 天"）
 *
 * 示对照（第一条）：王欢44 · 剩余 0 天 · ...xlsx · 评审率 0% · 4/7 · 1/7 · 缺陷 0。
 * 注意：分母是 repeat.reviewersNum（7），不是 reviewAllNum（8）——示例明确为 /7。 */
function ReviewCard({
  r,
  onOpenDetail,
  onOpenUpdate,
  onOpenEdit,
}: {
  r: any;
  onOpenDetail: (review: any) => void;
  onOpenUpdate: (review: any) => void;
  onOpenEdit: (review: any) => void;
}) {
  // 主标题：优先项目名，缺失则取首个稿件文件名（即示例中的 xlsx 文件名），再退到评审名称。
  const manuscriptFile = r?.manuscriptDtos?.[0]?.fileName;
  const title = pick(r?.projectName, manuscriptFile, r?.reviewName);
 const creator = pick(r?.creator, r?.creatorName);
 const reviewName = pick(r?.reviewName, r?.name);
  // 仅当评审创建人与当前登录用户同名时，才允许「更新」「关闭」操作。
 const currentDisplayName = getStoredUserInfo()?.displayName;
 const canUpdate =
    Boolean(currentDisplayName) && Boolean(creator) && creator === currentDisplayName;

 // 评审率：上游直接给百分比字符串。
  const coreRate = pick(r?.coreReviewerRatePercent, r?.coreReviewerRate, r?.reviewRate);

  // 已完成 / 评审中 / 总数：分母取 repeat.reviewersNum（评委人数），与「4 / 7」「1 / 7」对齐。
  const total = pick(r?.repeat?.reviewersNum, r?.reviewersNum);
  const finished = pick(r?.finishReviewResNum, r?.finishedCount);
  const reviewing = pick(r?.reviewingNum, r?.reviewingCount);
  const finishedLabel = withTotal(finished, total);
  const reviewingLabel = withTotal(reviewing, total);

  // 缺陷数量：上游 defectsNum，缺失回退稿件 defectNums。
  const defects = pick(r?.defectsNum, r?.manuscriptDtos?.[0]?.defectNums, r?.defectNum, r?.defectCount);

  // 卡片右上角单状态徽标：按优先级只显示一个——
  //   待解决（有缺陷）> 待验证（无缺陷但有待验证）> 已完成（endStatus===3）> 剩余 N 天。
  // 待解决 / 待验证 用红色样式；已完成 / 剩余天数 用普通徽标（剩余 0 天时 urgent 标红）。
  // 用数值比较：0 视为「无」，缺失字段当作 0。
  const defectsCount = Number(r?.defectsNum ?? r?.manuscriptDtos?.[0]?.defectNums ?? r?.defectNum ?? r?.defectCount ?? 0);
  const verifyCount = Number(r?.verifyNum ?? r?.verifyCount ?? 0);
 const reviewEnded = Number(r?.endStatus) === 3;
  // 已完成（endStatus===3）时禁用「更新」「编辑」「关闭」。
  const canAction = canUpdate && !reviewEnded;
 const remainDays = computeRemainDays(r?.preReviewEndTimeDate, r?.preReviewEndTime);
  const urgent = remainDays === null ? false : remainDays <= 0;
  const remainLabel = remainDays === null ? '—' : `剩余 ${Math.max(0, remainDays)} 天`;

  const statusBadge = defectsCount > 0
    ? { text: '待解决', cls: styles.statusBadge }
    : verifyCount > 0
      ? { text: '待验证', cls: styles.statusBadgeOk }
      : reviewEnded
        ? { text: '已完成', cls: styles.remainBadge }
        : remainLabel !== '—'
          ? { text: remainLabel, cls: urgent ? `${styles.remainBadge} ${styles.urgent}` : styles.remainBadge }
          : null;

  // 评审类型头像：圆形首字 + 类型色，显示在创建人前。
  const typeMeta = reviewTypeMeta(r);

  // 设计稿版本：取首份稿件 version，格式化为「V1.0」显示在卡片右上角。
  const versionLabel = formatVersion(r?.manuscriptDtos?.[0]?.version);

  // 「更多」下拉菜单 + 三项操作（下载资源 / 一键提醒 / 开启通知）。
 const [menu, setMenu] = useState<CardActionState>({
   open: false,
   pending: null,
   toast: null,
   // subscriptionStatus 上游是字符串 "false"/"true"；缺失视为关。
   notifyOn: String(r?.subscriptionStatus) === 'true',
 });
  // 「关闭」评审的二次确认气泡：点「关闭」先弹出确认，再调 reviewFinish。
  const [confirmFinish, setConfirmFinish] = useState(false);
  const confirmWrapRef = useRef<HTMLDivElement | null>(null);

  // 点确认气泡外部收起。
  useEffect(() => {
    if (!confirmFinish) return;
    const onDocClick = (e: MouseEvent) => {
      if (!confirmWrapRef.current?.contains(e.target as Node)) setConfirmFinish(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [confirmFinish]);
 const menuRef = useRef<HTMLDivElement | null>(null);

  // 点卡片外部收起下拉。
  useEffect(() => {
    if (!menu.open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu((m) => ({ ...m, open: false }));
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menu.open]);

  // toast 展示 2.5s 后自动清除，避免状态残留。
  useEffect(() => {
    if (!menu.toast) return;
    const t = setTimeout(() => setMenu((m) => ({ ...m, toast: null })), 2500);
    return () => clearTimeout(t);
  }, [menu.toast]);

  const reviewId = pick(r?.reviewId, r?.id);
  const manuscriptId = r?.manuscriptDtos?.[0]?.manuscriptId;
  const hasManuscript = Boolean(manuscriptId);

  // 点击整张卡片新开羽点稿件预览页（按 reviewType 走对应前端路由）。
  // 无 manuscriptId 或无对应预览页类型时返回 null，卡片不响应点击的「打开预览」语义
  //（卡片本身仍可被「更多」菜单等内部交互正常使用，故此处不阻断事件冒泡）。
  const previewUrl = buildManuscriptPreviewUrl(r?.reviewType, manuscriptId);

  /** 统一发起一项卡片操作：置 pending、调路由、回写 toast。 */
  async function runAction(action: CardAction) {
    setMenu((m) => ({ ...m, open: false, pending: action, toast: null }));
    try {
      if (action === 'download') {
        if (!manuscriptId) throw new Error('无稿件可下载');
        // 下载是二进制流：fetch 拿 blob，从 content-disposition 或稿件文件名取下载名。
        const resp = await fetch(
          `/api/hik/uedro/downloadManuscript?manuscriptId=${encodeURIComponent(manuscriptId)}`,
        );
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}${txt ? `: ${txt}` : ''}`);
        }
        const ctype = resp.headers.get('content-type') || '';
        if (ctype.includes('application/json')) {
          // 上游 JSON 错误体（鉴权失效 / 稿件不存在）。
          const j = await resp.json().catch(() => null);
          throw new Error(j?.error?.message || '下载失败');
        }
        const blob = await resp.blob();
        // 文件名：优先 content-disposition，退到稿件 fileName，再退 reviewName。
        // daemon 已把头规整成 `filename*=UTF-8''<pct>`，优先取该段并解码；
        // 它后面没有时再退到裸 filename= 段（可能是乱码，仅作兜底）。
        const cd = resp.headers.get('content-disposition') || '';
        const cdName =
          cd.match(/filename\*\s*=\s*UTF-8''([^";]+)/i)?.[1] ??
          cd.match(/filename\s*=\s*"?([^";]+)/i)?.[1];
        let fname: string;
        try {
          fname = decodeURIComponent(cdName || manuscriptFile || `${reviewName || 'manuscript'}.bin`);
        } catch {
          fname = cdName || manuscriptFile || `${reviewName || 'manuscript'}.bin`;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMenu((m) => ({ ...m, pending: null, toast: { text: '下载已开始', tone: 'ok' } }));
        return;
      }

      if (action === 'remind') {
        if (!reviewId || reviewId === '—') throw new Error('缺少 reviewId');
        const resp = await fetch('/api/hik/uedro/urge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId }),
        });
        const j = await resp.json().catch(() => null);
        if (!resp.ok || !j?.ok) throw new Error(j?.error?.message || j?.msg || `HTTP ${resp.status}`);
       setMenu((m) => ({ ...m, pending: null, toast: { text: '已发送催办提醒', tone: 'ok' } }));
       return;
     }

      if (action === 'finish') {
        if (!reviewId || reviewId === '—') throw new Error('缺少 reviewId');
        const resp = await fetch('/api/hik/uedro/reviewFinish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId }),
        });
        const j = await resp.json().catch(() => null);
        if (!resp.ok || !j?.ok) throw new Error(j?.error?.message || j?.msg || `HTTP ${resp.status}`);
        setMenu((m) => ({ ...m, pending: null, toast: { text: '已关闭评审', tone: 'ok' } }));
        return;
      }

      // notify：切换订阅态。原站 editSubscriptionStatus 用 status=true/false。
      const nextOn = !menu.notifyOn;
      if (!reviewId || reviewId === '—') throw new Error('缺少 reviewId');
      const resp = await fetch('/api/hik/uedro/editSubscriptionStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, status: nextOn }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok || !j?.ok) throw new Error(j?.error?.message || j?.msg || `HTTP ${resp.status}`);
      setMenu((m) => ({
        ...m,
        pending: null,
        notifyOn: nextOn,
        toast: { text: nextOn ? '已开启通知' : '已关闭通知', tone: 'ok' },
      }));
    } catch (err: any) {
      setMenu((m) => ({
        ...m,
        pending: null,
        toast: { text: (err?.message || String(err)).slice(0, 80), tone: 'err' },
      }));
    }
  }

  return (
    <div
      className={styles.card}
      onClick={() => {
       // 点击整张卡片：打开对应 reviewType 的羽点稿件预览页（新标签）。
       // 卡片内交互（更多菜单 / 各操作按钮）自行 stopPropagation，避免误触发新开页。
       // 用 openExternalUrl 在系统默认浏览器打开，而非 Electron 新窗口。
       // previewUrl 是根相对路径（/uedro/ux?id=…），openExternalUrl 走
       // shell.openExternal / daemon open-external 都需要完整 http(s) URL，
       // 否则会退化为当前标签页跳转。用 window.location.origin 补全。
       if (previewUrl) {
         const absolute = new URL(previewUrl, window.location.origin).toString();
         void openExternalUrl(absolute);
       }
      }}
    >
      <div className={styles.cardHead}>
        <span className={styles.creator}>
          {typeMeta ? (
            <span className={styles.typeAvatar} style={{ background: typeMeta.color }} aria-hidden>
              {typeMeta.char}
            </span>
          ) : null}
          <span className={styles.creatorText}>{creator}</span>
        </span>
        <span style={{display:"flex",gap:"4px"}}>
        {statusBadge ? <span className={statusBadge.cls}>{statusBadge.text}</span> : null}
        {versionLabel !== '—' ? <span className={styles.versionBadge}>{versionLabel}</span> : null}
        </span>
      </div>

      <div className={styles.cardTitle}>
        <span className={styles.cardTitleText}>{title}</span>
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>评审名称：</div>
          <div className={styles.fieldValue}>{reviewName}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>核心评委评审率：</div>
          <div className={styles.fieldValue} style={{color:'red'}}>{coreRate}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>创建时间：</div>
          <div className={styles.fieldValue}>{pick(r?.createTime, r?.createdAt, r?.createDate)}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>结束时间：</div>
          <div className={styles.fieldValue}>{pick(r?.preReviewEndTime, r?.endTime, r?.deadline, r?.expireTime)}</div>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>已完成：</div>
            <div className={styles.fieldValue}>{finishedLabel}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>评审中：</div>
            <div className={styles.fieldValue}>{reviewingLabel}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>缺陷数量：</div>
            <div className={styles.fieldValue}>{defects}</div>
          </div>
        </div>
      </div>

    <div className={styles.cardFoot}>
    {/* 卡片右下角「更新」按钮：打开更新评审稿小 modal。仅创建人可用，已完成时禁用。 */}
    {canUpdate ? (
      <button
        type="button"
        className={styles.updateBtn}
        disabled={!canAction}
        onClick={(e) => {
          e.stopPropagation();
          if (canAction) onOpenUpdate(r);
        }}
        title={canAction ? '更新评审稿' : '已完成，不可更新'}
      >
        更新
      </button>
    ) : null}
    {/* 卡片右下角「编辑」按钮：打开编辑评审 modal。仅创建人可用，已完成时禁用。 */}
    {canUpdate ? (
      <button
        type="button"
        className={styles.updateBtn}
        disabled={!canAction}
        onClick={(e) => {
          e.stopPropagation();
          if (canAction) onOpenEdit(r);
        }}
        title={canAction ? '编辑评审' : '已完成，不可编辑'}
      >
        编辑
      </button>
    ) : null}
    {/* 卡片右下角「关闭」按钮：点开二次确认气泡，确认后调 reviewFinish。仅创建人可用，已完成时禁用。 */}
    {canUpdate ? (
      <div
        className={styles.closeWrap}
        ref={confirmWrapRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.updateBtn}
          disabled={!canAction || menu.pending === 'finish'}
          onClick={() => {
            if (!canAction) return;
            setMenu((m) => ({ ...m, toast: null }));
            setConfirmFinish((v) => !v);
          }}
          title={canAction ? '关闭评审' : '已完成，不可关闭'}
        >
          {menu.pending === 'finish' ? '关闭中…' : '关闭'}
        </button>
        {confirmFinish ? (
          <div className={styles.confirmPop} role="dialog" aria-label="确认关闭评审">
            <span className={styles.confirmText}>确认关闭该评审？关闭后不可恢复。</span>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setConfirmFinish(false)}
                disabled={menu.pending === 'finish'}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.confirmOk}
                onClick={() => {
                  setConfirmFinish(false);
                  void runAction('finish');
                }}
                disabled={menu.pending === 'finish'}
              >
                {menu.pending === 'finish' ? '关闭中…' : '确认关闭'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    ) : null}
        {/* 卡片左下角「更多」下拉：评审详情（首位） / 下载资源 / 一键提醒 / 开启通知。 */}
        <div
          className={styles.moreWrap}
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`${styles.moreBtn} ${menu.open ? styles.moreBtnActive : ''}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={() => setMenu((m) => ({ ...m, open: !m.open }))}
          >
            更多
            <span className={styles.moreCaret} aria-hidden>▾</span>
          </button>
          {menu.open ? (
            <div className={styles.moreMenu} role="menu">
              {/* 评审详情：打开右侧抽屉，非异步，故不走 runAction。 */}
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                onClick={() => {
                  setMenu((m) => ({ ...m, open: false }));
                  onOpenDetail(r);
                }}
                title="查看评审详情"
              >
                评审详情
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                disabled={!hasManuscript || menu.pending === 'download'}
                onClick={() => void runAction('download')}
                title={hasManuscript ? '下载稿件资源' : '该评审无稿件资源'}
              >
                {menu.pending === 'download' ? '下载中…' : '下载资源'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                disabled={menu.pending === 'remind'}
                onClick={() => void runAction('remind')}
              >
                {menu.pending === 'remind' ? '发送中…' : '一键提醒'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.moreItem} ${menu.notifyOn ? styles.moreItemOn : ''}`}
                disabled={menu.pending === 'notify'}
                onClick={() => void runAction('notify')}
              >
                {menu.pending === 'notify' ? '切换中…' : menu.notifyOn ? '关闭通知' : '开启通知'}
              </button>
            </div>
          ) : null}
          {menu.toast ? (
            <span className={`${styles.actionToast} ${menu.toast.tone === 'err' ? styles.actionToastErr : ''}`}>
              {menu.toast.text}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
