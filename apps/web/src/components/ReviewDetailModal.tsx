import { useEffect, useRef, useState } from 'react';
import styles from './ReviewDetailModal.module.css';
import {
  pick,
  computeRemainDays,
  formatDateTime,
  formatVersion,
  collectVersions,
  reviewTypeMeta,
} from './reviewMeta';

/**
 * 评审详情右侧抽屉：作为 ReviewListModal 的子元素渲染在 .shell 内部，
 * 从右边缘滑入，不再独立居中弹窗。这样列表与详情同处一个画框，关抽屉
 * 即回到列表，符合「主列表 + 详情抽屉」的常见交互。
 *
 * 渲染要求：父组件需把本组件放在 `position: relative` 的容器内（ReviewListModal
 * 的 .shell 已是相对定位），本组件用 absolute 锚定到该容器的右侧。
 *
 * 数据来自后端 4 个透传路由（apps/daemon/src/routes/hik_routes/uedro.ts），
 * 数据的唯一来源就是这四个接口，综合生成详情信息展示：
 *   - GET  /api/hik/uedro/reviewOne          评审主数据（oneByReviewId）
 *   - POST /api/hik/uedro/subProcess          稿件列表（聚合全部版本 + 喂给统计）
 *   - POST /api/hik/uedro/reviewProgress      评委评审进度
 *   - POST /api/hik/uedro/progressQuantity    评审统计（按 reviewId + version）
 *
 * open 变 true 时触发加载：
 *   1. 并行拉 reviewOne（主数据）+ subProcess（稿件列表）+ reviewProgress（评委进度）；
 *   2. subProcess 回来后聚合全部版本，默认选中第一个版本，再拉 progressQuantity。
 *
 * 抽屉常驻 DOM：open 用 CSS class 控制 translateX 与遮罩显隐，保留退出动画。
 */
export function ReviewDetailDrawer({
  review,
  open,
  onClose,
}: {
  review: any;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 评审主数据（reviewOne.data）：reviewName / reviewType / creator / 截止时间 / roles 等。
  const [detail, setDetail] = useState<any | null>(null);
  // 稿件列表（subProcess.data.list[]）：聚合出全部版本供版本下拉选择。
  const [manuscripts, setManuscripts] = useState<any[]>([]);
  // 评委评审进度（reviewProgress.data[]）。
  const [reviewers, setReviewers] = useState<any[]>([]);
  // 评审统计（progressQuantity.data = { all, toSolve, toVerify, closed, ... }）。
  const [quantity, setQuantity] = useState<any | null>(null);
  // 全部可选版本（数字升序）；默认选中第一个。
  const [versions, setVersions] = useState<number[]>([]);
  // 当前选中的版本（下拉切换）。
  const [version, setVersion] = useState<number | null>(null);

  // 弹窗关闭 / 组件卸载后不再写状态；过期请求丢弃。
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  const reviewId = pick(review?.reviewId, review?.id);

  /** 拉主数据 + 稿件列表 + 评委进度（三者并行，都不依赖 version）。 */
  async function loadCore(reqId: number, rid: string) {
    const [oneRes, subRes, progRes] = await Promise.all([
      fetch(`/api/hik/uedro/reviewOne?reviewId=${encodeURIComponent(rid)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`reviewOne HTTP ${r.status}`)),
      ),
      fetch('/api/hik/uedro/subProcess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid, pageNo: 1, pageSize: 10000 }),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`subProcess HTTP ${r.status}`)))),
      fetch('/api/hik/uedro/reviewProgress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid }),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`reviewProgress HTTP ${r.status}`)))),
    ]);
    if (!oneRes.ok) throw new Error(oneRes?.msg || 'reviewOne failed');
    if (!subRes.ok) throw new Error(subRes?.msg || 'subProcess failed');
    if (!progRes.ok) throw new Error(progRes?.msg || 'reviewProgress failed');
    if (!aliveRef.current || reqId !== reqIdRef.current) return;

    setDetail(oneRes.data ?? null);
    const list: any[] = Array.isArray(subRes.data?.list) ? subRes.data.list : [];
    setManuscripts(list);
    setReviewers(Array.isArray(progRes.data) ? progRes.data : []);

    // 聚合全部版本；默认选中第一个并拉其评审统计。
    const vs = collectVersions(list);
    setVersions(vs);
    const first = vs[0];
    if (first !== undefined) {
      setVersion(first);
      await loadQuantity(reqId, rid, first);
    } else {
      setVersion(null);
      setQuantity(null);
    }
  }

  /** 拉评审统计（按当前选中版本）。 */
  async function loadQuantity(reqId: number, rid: string, ver: number) {
    const resp = await fetch('/api/hik/uedro/progressQuantity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: rid, version: ver }),
    });
    if (!resp.ok) throw new Error(`progressQuantity HTTP ${resp.status}`);
    const json = await resp.json();
    if (!aliveRef.current || reqId !== reqIdRef.current) return;
    // progressQuantity 上游失败不阻断详情展示，仅清空统计区。
    setQuantity(json.ok ? json.data : null);
  }

  // 每次打开（或切换 reviewId）时重新拉取主数据 + 稿件列表 + 评委进度。
  useEffect(() => {
    if (!open) return;
    if (!reviewId || reviewId === '—') {
      setError('缺少 reviewId，无法加载评审详情');
      return;
    }
    aliveRef.current = true;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setDetail(null);
    setManuscripts([]);
    setReviewers([]);
    setQuantity(null);
    setVersions([]);
    setVersion(null);
    void loadCore(reqId, reviewId).catch((err: any) => {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('评审详情加载失败: ' + (err?.message || String(err)));
    }).finally(() => {
      if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
    });
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reviewId]);

  // 切换版本：只重拉 progressQuantity（按该版本）。
  function switchVersion(ver: number) {
    if (ver === version) return;
    const reqId = reqIdRef.current;
    setVersion(ver);
    setQuantity(null);
    void loadQuantity(reqId, reviewId, ver).catch((err: any) => {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('评审统计加载失败: ' + (err?.message || String(err)));
    });
  }

  // Esc 关闭：仅当抽屉打开时拦截。
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

  return (
    <>
      <div
        className={`${styles.overlay} ${open ? styles.overlayOpen : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="评审详情"
        aria-hidden={!open}
      >
        <DetailHead review={detail ?? review} onClose={onClose} />
        <div className={styles.body}>
          {loading ? (
            <div className={styles.stateWrap}>
              <div className={styles.spinner} />
              <span>加载中…</span>
            </div>
          ) : error ? (
            <div className={styles.stateWrap}>
              <span className={styles.errorText}>{error}</span>
            </div>
          ) : (
            <>
              <VersionSection
                versions={versions}
                current={version}
                onSwitch={switchVersion}
              />
              <QuantitySection quantity={quantity} />
              <ReviewerSection reviewers={reviewers} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 头部：类型头像 + 评审名称 + 副标题 + 创建人/时间/剩余天数 + 关闭。
 *
 *  优先用主数据 detail（字段更全），未加载到位时回退到列表项 review。 */
function DetailHead({ review, onClose }: { review: any; onClose: () => void }) {
  const typeMeta = reviewTypeMeta(review);
  const reviewName = pick(review?.reviewName, review?.name);
  const creator = pick(review?.creator, review?.creatorName);
  const createTime = formatDateTime(review?.createTimeDate ?? review?.createTime ?? review?.createdAt ?? review?.createDate);
  const endTime = formatDateTime(review?.preReviewEndTimeDate ?? review?.preReviewEndTime ?? review?.endTime ?? review?.deadline);
  const remainDays = computeRemainDays(review?.preReviewEndTimeDate, review?.preReviewEndTime);
  const urgent = remainDays === null ? false : remainDays <= 0;
  const remainLabel = remainDays === null ? null : `剩余 ${Math.max(0, remainDays)} 天`;

  return (
    <div className={styles.head}>
      <div className={styles.headMain}>
        <div className={styles.headTop}>
          {typeMeta ? (
            <span className={styles.typeAvatar} style={{ background: typeMeta.color }} aria-hidden>
              {typeMeta.char}
            </span>
          ) : null}
          <h2 className={styles.title}>{reviewName}</h2>
          {remainLabel ? (
            <span className={`${styles.remainBadge} ${urgent ? styles.urgent : ''}`}>{remainLabel}</span>
          ) : null}
        </div>
        <div className={styles.headMeta}>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>创建人：</span>
            <span className={styles.metaValue}>{creator}</span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>创建时间：</span>
            <span className={styles.metaValue}>{createTime}</span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>截止时间：</span>
            <span className={styles.metaValue}>{endTime}</span>
          </span>
        </div>
      </div>
      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

/** 设计稿版本切换区：独占一行，下拉切换版本，切换后重拉评审统计。 */
function VersionSection({
  versions,
  current,
  onSwitch,
}: {
  versions: number[];
  current: number | null;
  onSwitch: (ver: number) => void;
}) {
  if (versions.length === 0) return null;
  return (
    <div className={styles.versionRow}>
      <span className={styles.versionLabel}>设计稿版本：</span>
      <select
        className={styles.versionSelect}
        value={current ?? ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onSwitch(n);
        }}
        aria-label="选择设计稿版本"
      >
        {versions.map((v) => (
          <option key={v} value={v}>
            {formatVersion(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 评委评审进度区：reviewProgress.data[] → 卡片列表（抽屉宽度有限，卡片比表格更舒展）。 */
function ReviewerSection({ reviewers }: { reviewers: any[] }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>评委进度</span>
        <span className={styles.sectionCount}>{reviewers.length} 位评委</span>
      </div>
      {reviewers.length === 0 ? (
        <div className={styles.emptyHint}>暂无评委数据</div>
      ) : (
        <div className={styles.reviewerList}>
          {reviewers.map((rv: any, i: number) => (
            <ReviewerCard key={rv?.userName ?? rv?.id ?? i} rv={rv} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单个评委进度卡片。status: 1=待评审, 2=评审中, 3=已提交（按上游常见取值映射）。 */
function ReviewerCard({ rv }: { rv: any }) {
  const name = pick(rv?.userName, rv?.name);
  const status = rv?.status;
  const { label, tone } =
    status === 1
      ? { label: '未评审', tone: '' }
      : status === 2
        ? { label: '未完成验证', tone: styles.doing }
        : status === 3
          ? { label: '完成验证', tone: styles.done }
          : { label: pick(status), tone: '' };
  const committed = pick(rv?.committedTime);
  const defectNum = rv?.defectNum ?? 0;
  const adviceNum = rv?.adviceNum ?? 0;
  return (
    <div className={styles.reviewerCard}>
      <div className={styles.reviewerTop}>
        <span className={styles.reviewerName}>{name}</span>
        <span className={`${styles.statusBadge} ${tone}`}>{label}</span>
      </div>
      <div className={styles.reviewerMeta}>
        {committed !== '—' ? <span>提交：{committed}</span> : null}
        <span>
          缺陷 <b>{defectNum}</b>
        </span>
        <span>
          建议 <b>{adviceNum}</b>
        </span>
      </div>
    </div>
  );
}

/** 评审统计区：progressQuantity.data → 5 个小卡片。 */
function QuantitySection({ quantity }: { quantity: any }) {
  if (!quantity) return null;
  const cards: { label: string; value: any; muted?: boolean }[] = [
    { label: '全部', value: quantity.all },
    { label: '待解决', value: quantity.toSolve },
    { label: '待解决', value: quantity.toSolveByMySelf },
    { label: '待验证', value: quantity.toVerify },
    { label: '已关闭', value: quantity.closed },
  ];
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>评审统计</span>
      </div>
      <div className={styles.statGrid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.statCard}>
            <span className={`${styles.statValue} ${c.muted ? styles.muted : ''}`}>{c.value ?? 0}</span>
            <span className={styles.statLabel}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
