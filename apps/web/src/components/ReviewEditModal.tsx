import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewAddModal.module.css';
import { PersonPicker, type Person } from './PersonPicker';

/**
 * 编辑评审 Modal：修改已有评审的人员 / 备注。
 *
 * 打开时调 `GET /api/hik/uedro/reviewRepeat?reviewId=…` 拉取回显数据，
 * 提交时调 `POST /api/hik/uedro/reviewEdit`，请求体：
 *   reviewId / preReviewEndTime / designers / coreReviewers / reviewers /
 *   copyPersons / content
 *
 * 表单项（从上到下）：
 *   - 评审名称*（禁用，仅展示）
 *   - 预审结束时间*（禁用，仅展示）
 *   - 评审组长*（禁用，仅展示当前组长名，无标签区）
 *   - 核心评委*（PersonPicker，可编辑）
 *   - 团队评委（PersonPicker，可编辑）
 *   - 评审备注（textarea，可编辑）
 *   - 抄送人员（PersonPicker，可编辑）
 *
 * 样式与控件完全复用 ReviewAddModal.module.css，保持视觉一致。
 * 点确定前弹出二次确认："有相同单号的评审信息会同时修改,是否修改?"。
 * 这是一个叠加在 ReviewListModal 之上的 modal（z-index 更高）。
 */

/** repeat 接口返回的人员对象。 */
type RepeatPerson = Person;

interface RepeatData {
  creator?: string;
  reviewName?: string;
  preReviewEndTime?: string;
  reviewType?: number;
  designers?: RepeatPerson[];
  reviewers?: RepeatPerson[];
  coreReviewers?: RepeatPerson[];
  author?: RepeatPerson[];
  copyPersons?: RepeatPerson[] | null;
  content?: string;
  [k: string]: any;
}

/** 把原站 `YYYY/MM/DD HH:mm:ss` 转成 datetime-local 的 `YYYY-MM-DDTHH:mm`。 */
function toDatetimeLocal(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  // 兜底：尝试 Date 解析。
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReviewEditModal({
  open,
  onClose,
  reviewId,
  reviewName,
}: {
  open: boolean;
  onClose: () => void;
  reviewId: string;
  reviewName?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const aliveRef = useRef(true);

  // 回显数据
  const [reviewNameVal, setReviewNameVal] = useState('');
  const [endtime, setEndtime] = useState('');
  const [mainjudge, setMainjudge] = useState<Person[]>([]);
  const [coreReviewers, setCoreReviewers] = useState<Person[]>([]);
  const [judgelist, setJudgelist] = useState<Person[]>([]);
  const [content, setContent] = useState('');
  const [addPersonList, setAddPersonList] = useState<Person[]>([]);
  // 保留原始 preReviewEndTime，提交时原样回传。
  const rawEndtimeRef = useRef('');

  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // 打开时拉取回显数据。
  useEffect(() => {
    aliveRef.current = open;
    if (!open || !reviewId) {
      if (!open) {
        setLoading(false);
        setSubmitting(false);
        setError(null);
        setOkMsg(null);
        setFieldErrors({});
        setConfirmOpen(false);
        setReviewNameVal('');
        setEndtime('');
        setMainjudge([]);
        setCoreReviewers([]);
        setJudgelist([]);
        setContent('');
        setAddPersonList([]);
        rawEndtimeRef.current = '';
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/hik/uedro/reviewRepeat?reviewId=${encodeURIComponent(reviewId)}`)
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (cancelled || !aliveRef.current) return;
        if (!j?.ok) {
          setError(j?.msg || j?.error?.message || '加载评审信息失败');
          return;
        }
        const d: RepeatData = j.data ?? {};
        setReviewNameVal(d.reviewName ?? '');
        const rawEnd = d.preReviewEndTime ?? '';
        rawEndtimeRef.current = rawEnd;
       setEndtime(toDatetimeLocal(rawEnd));
       // reviewers 的第一个是组长，从团队评委中剔除。
       const reviewers = Array.isArray(d.reviewers) ? d.reviewers : [];
       const leader = reviewers[0] ?? null;
       const teamJudges = reviewers.slice(1);
       setMainjudge(leader ? [leader] : (Array.isArray(d.designers) ? d.designers : []));
       setCoreReviewers(Array.isArray(d.coreReviewers) ? d.coreReviewers : []);
       // 团队评委中剔除作者本人（按 id 或 name 去重）。
       const authorList = Array.isArray(d.author) ? d.author : [];
       const authorIds = new Set(authorList.map((p) => p.id).filter(Boolean));
       const authorNames = new Set(authorList.map((p) => p.name).filter(Boolean));
       setJudgelist(
         teamJudges.filter(
           (p) => !(authorIds.has(p.id) || authorNames.has(p.name)),
         ),
       );
        setContent(d.content ?? '');
        setAddPersonList(Array.isArray(d.copyPersons) ? d.copyPersons : []);
      })
      .catch((err: any) => {
        if (cancelled || !aliveRef.current) return;
        setError('加载评审信息失败: ' + (err?.message || String(err)));
      })
      .finally(() => {
        if (aliveRef.current && !cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reviewId]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submitting) {
          setConfirmOpen(false);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, submitting]);

  /** 校验 + 弹出二次确认。 */
  function handleSubmitClick() {
    setError(null);
    setOkMsg(null);
    const errs: Record<string, string> = {};
    if (!coreReviewers.length) {
      errs.coreReviewers = '请添加核心评委';
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    // 核心评委不得与评审组长同名。
    const mainNames = new Set(mainjudge.map((p) => p.name));
    const dup = coreReviewers.find((p) => mainNames.has(p.name));
    if (dup) {
      setFieldErrors({ coreReviewers: '评审组长与评委重复' });
      return;
    }
    setConfirmOpen(true);
  }

  /** 确认后真正提交。 */
  async function doSubmit() {
    setConfirmOpen(false);
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch('/api/hik/uedro/reviewEdit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         reviewId,
         preReviewEndTime: rawEndtimeRef.current,
         coreReviewers,
         // 提交时组长拼回 reviewers 第一个位置（对齐原站数据结构）。
         designers: mainjudge,
         reviewers: [...mainjudge, ...judgelist],
         copyPersons: addPersonList,
         content,
       }),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setError(j?.error?.message || j?.msg || `编辑评审失败 HTTP ${resp.status}`);
        return;
      }
      setOkMsg('编辑成功');
      setTimeout(() => {
        if (aliveRef.current) onClose();
      }, 1200);
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('编辑评审失败: ' + (err?.message || String(err)));
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting && !confirmOpen) onClose();
      }}
    >
    <div className={styles.shell} role="dialog" aria-modal="true"
        style={{ height: 'auto', maxHeight: 'calc(100vh - 32px)' }}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.kicker}>REVIEW · UEDRO</div>
            <h2 className={styles.title}>编辑评审</h2>
            {reviewName ? <p className={styles.subtitle}>{reviewName}</p> : null}
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => {
              if (!submitting) {
                setConfirmOpen(false);
                onClose();
              }
            }}
            aria-label="关闭"
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              加载中…
            </div>
          ) : (
            <div className={styles.group}>
              {/* 评审名称（禁用） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>
                  评审名称 <span className={styles.req}>*</span>
                </label>
                <div className={styles.itemControl}>
                  <input
                    type="text"
                    className={styles.input}
                    value={reviewNameVal}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              {/* 预审结束时间（禁用） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>
                  预审结束时间 <span className={styles.req}>*</span>
                </label>
                <div className={styles.itemControl}>
                  <input
                    type="datetime-local"
                    className={styles.input}
                    value={endtime}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              {/* 评审组长（禁用，仅展示当前组长，无标签区） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>
                  评审组长 <span className={styles.req}>*</span>
                </label>
                <div className={styles.itemControl}>
                  <input
                    type="text"
                    className={styles.input}
                    value={mainjudge.map((p) => p.name).join('、')}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              {/* 核心评委（可编辑） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>
                  核心评委 <span className={styles.req}>*</span>
                </label>
                <div className={styles.itemControl}>
                  <PersonPicker
                    selected={coreReviewers}
                    onChange={(p) => {
                      setCoreReviewers(p);
                      clearFieldError('coreReviewers');
                    }}
                 placeholder="请输入名称（核心评委）"
                 multiple
               />
               <span className={styles.itemError}>{fieldErrors.coreReviewers || ''}</span>
                </div>
              </div>

              {/* 团队评委（可编辑） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>团队评委</label>
                <div className={styles.itemControl}>
                  <PersonPicker
                    selected={judgelist}
                    onChange={setJudgelist}
                 placeholder="请输入名称（团队评委）"
                 multiple
               />
             </div>
           </div>

           {/* 评审备注（可编辑） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>评审备注</label>
                <div className={styles.itemControl}>
                  <textarea
                    className={styles.textarea}
                    placeholder="请输入评审备注"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
              </div>

              {/* 抄送人员（可编辑） */}
              <div className={styles.item}>
                <label className={styles.itemLabel}>抄送人员</label>
                <div className={styles.itemControl}>
                  <PersonPicker
                    selected={addPersonList}
                    onChange={setAddPersonList}
                 placeholder="请输入名称（抄送人员）"
                 multiple
               />
             </div>
           </div>
            </div>
          )}
        </div>

        <div className={styles.foot}>
          <span className={`${styles.footMsg} ${error ? styles.footMsgErr : ''} ${okMsg ? styles.footMsgOk : ''}`}>
            {error || okMsg || ''}
          </span>
          <div className={styles.footActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                if (!submitting) {
                  setConfirmOpen(false);
                  onClose();
                }
              }}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleSubmitClick}
              disabled={submitting || loading}
            >
              {submitting ? '提交中…' : '确定'}
            </button>
          </div>
        </div>
      </div>

      {/* 二次确认对话框 */}
      {confirmOpen
        ? createPortal(
            <div
              className={styles.backdrop}
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setConfirmOpen(false);
              }}
            >
              <div className={styles.shell} role="alertdialog" aria-modal="true" style={{ maxWidth: '420px', height: 'auto' }}>
                <div className={styles.head}>
                  <div className={styles.headMain}>
                    <h2 className={styles.title}>确认修改</h2>
                  </div>
                </div>
                <div className={styles.body}>
                  <p style={{ fontSize: '14px', lineHeight: '1.6', margin: 0 }}>
                    有相同单号的评审信息会同时修改,是否修改?
                  </p>
                </div>
                <div className={styles.foot}>
                  <span className={styles.footMsg} />
                  <div className={styles.footActions}>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setConfirmOpen(false)}
                      disabled={submitting}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void doSubmit()}
                      disabled={submitting}
                    >
                      {submitting ? '提交中…' : '确认修改'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>,
    document.body,
  );
}
