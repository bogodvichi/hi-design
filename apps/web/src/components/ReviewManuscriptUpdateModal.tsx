import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewManuscriptUpdateModal.module.css';
import { exportProjectAsAxureZip } from '../runtime/axure-export';
import { getProject } from '../state/projects';

/**
 * 更新评审稿 Modal：重新上传当前评审的评审稿。
 *
 * 对齐羽点原站"更新评审稿"小弹窗，表单仅两项，从上到下排列：
 *   - 评审稿（来源切换：上传 / 来自当前项目，默认"上传"）
 *   - 备注（textarea，可空）
 *
 * 两步流程：
 *   1. 上传阶段：两种来源都走 `POST /api/hik/uedro/reUploadManuscript`
 *      （multipart：file + manuscriptId + excelJson），拿回
 *      { manuscriptId, middleManuscriptId, reviewType, ... }。
 *   2. 确认阶段：点确定调 `POST /api/hik/uedro/reUploadConfirm`
 *      （JSON：manuscriptId + middleManuscriptId + description）。
 *
 * 样式与交互参考 ReviewAddModal：同样的画框结构、token、表单 item 布局、
 * 评审稿来源切换、上传区拖拽 / 点击选文件、字段级错误、底栏确定 / 取消。
 * 这是一个叠加在 ReviewListModal 之上的小 modal（z-index 更高）。
 */
const SUBTYPE_UPLOAD_HINT: Record<string, string> = {
  '1': '请上传交互评审文件的 zip、rar 包，小于 100MB',
  '2': '请上传视觉评审文件的 zip、rar 包，小于 100MB',
  '3': '请上传 pdf、word 格式的评审文件，小于 100MB',
  '4': '请上传 .xlsx 格式文件（目前不支持对象、窗格嵌入），小于 10MB',
  '11': '请上传 Pixso 平台导出 Handoff 评审文件，小于 100MB',
};
const DEFAULT_HINT = '请上传评审稿';

/** reUpload 响应 data：{manuscriptId, middleManuscriptId, url, reviewType, ...}。 */
interface ReUploadInfo {
  manuscriptId: string;
  middleManuscriptId: string;
  reviewType?: string;
  fileName?: string;
  [k: string]: any;
}

export function ReviewManuscriptUpdateModal({
  open,
  onClose,
  reviewId,
  category,
  reviewName,
  projectId,
  manuscriptId,
}: {
  open: boolean;
  onClose: () => void;
  /** 当前评审 ID（来自卡片 r.reviewId / r.id）。 */
  reviewId: string;
  /** 稿件分类 = 评审 reviewType（1/2/3/4/11…），仅用于上传提示。 */
  category: string;
  /** 评审名称，仅用于标题展示。 */
  reviewName?: string;
  /** 当前 open-design 项目 ID（"来自当前项目"时用于导出 Axure 包）。 */
  projectId?: string;
  /** 当前评审稿的已有稿件 ID（reUpload 必填字段）。 */
  manuscriptId: string;
}) {
  const [reUploadInfo, setReUploadInfo] = useState<ReUploadInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState('');
  // 评审稿来源：'upload' 手动上传 / 'project' 来自当前项目（导出 Axure 包）
  const [manuscriptSource, setManuscriptSource] = useState<'upload' | 'project'>('upload');
  // 当前 open-design 项目名称（用于"来自当前项目"时显示 zip 文件名）
  const [odProjectName, setOdProjectName] = useState('');
  // 从当前项目生成 Axure 包并上传中
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const aliveRef = useRef(true);

  const hint = SUBTYPE_UPLOAD_HINT[String(category)] ?? DEFAULT_HINT;

  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** 计算"来自当前项目"时导出 Axure 包的文件名（与 axure-export.ts 逻辑一致）。 */
  const projectZipName = useMemo(() => {
    const raw = odProjectName.trim() || 'axure-prototype';
    const name = raw
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'axure-prototype';
    return `${name}.zip`;
  }, [odProjectName]);

  // 拉取当前 open-design 项目名称（用于"来自当前项目"显示 zip 文件名）。
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    getProject(projectId)
      .then((proj) => {
        if (!cancelled && proj?.name) setOdProjectName(proj.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // 组件卸载 / 关闭后不再写状态；关闭时清空表单，下次打开是干净初始态。
  useEffect(() => {
    aliveRef.current = open;
    if (!open) {
      setReUploadInfo(null);
      setUploading(false);
      setDescription('');
      setManuscriptSource('upload');
      setOdProjectName('');
      setExporting(false);
      setSubmitting(false);
      setError(null);
      setOkMsg(null);
      setFieldErrors({});
    }
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submitting && !exporting) onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, submitting, exporting]);

  /**
   * 重新上传评审稿（第一步）：multipart/form-data。
   * 字段 file + manuscriptId（已有稿件 ID）+ excelJson（固定空串）。
   * 上游返回 {manuscriptId, middleManuscriptId, reviewType, ...}。
   */
  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('manuscriptId', manuscriptId);
      fd.append('excelJson', '');
      const resp = await fetch('/api/hik/uedro/reUploadManuscript', { method: 'POST', body: fd });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setError(j?.error?.message || j?.msg || `上传失败 HTTP ${resp.status}`);
        setReUploadInfo(null);
        return;
      }
      setReUploadInfo({ ...j.data, fileName: file.name });
      clearFieldError('upload');
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('评审稿上传失败: ' + (err?.message || String(err)));
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }

  /** 提交（第二步）：调 reUploadConfirm，传 manuscriptId + middleManuscriptId + description。 */
  async function handleSubmit() {
    setError(null);
    setOkMsg(null);
    const errs: Record<string, string> = {};
    if (!manuscriptId) {
      errs.upload = '缺少稿件 ID';
    }
    // "来自当前项目"时评审稿在提交时自动生成，无需校验；仅"上传"模式校验。
    if (manuscriptSource === 'upload' && !reUploadInfo?.middleManuscriptId) {
      errs.upload = '请上传评审稿';
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    // "上传"模式：校验已有 reUploadInfo 的类型一致性。
    if (
      manuscriptSource === 'upload' &&
      reUploadInfo?.reviewType &&
      String(reUploadInfo.reviewType) !== String(category)
    ) {
      setFieldErrors({ upload: '评审类型与上传评审稿格式不一致' });
      return;
    }

    // 第一步：拿到 middleManuscriptId。
    // - "上传"模式：直接用已有 reUploadInfo。
    // - "来自当前项目"模式：提交时生成 Axure zip → reUpload 拿 middleManuscriptId。
    setSubmitting(true);
    let middleManuscriptId = reUploadInfo?.middleManuscriptId ?? '';
    let finalManuscriptId = manuscriptId;

    if (manuscriptSource === 'project') {
      if (!projectId) {
        setFieldErrors({ upload: '无法获取当前项目' });
        setSubmitting(false);
        return;
      }
      setExporting(true);
      try {
        const result = await exportProjectAsAxureZip({
          projectId,
          projectName: odProjectName,
          returnBlob: true,
        });
        if (!result.ok) {
          setError(result.error);
          setFieldErrors({ upload: result.error });
          setSubmitting(false);
          return;
        }
        if (!result.blob || !result.zipName) {
          const msg = '导出 Axure 包失败：未生成文件';
          setError(msg);
          setFieldErrors({ upload: msg });
          setSubmitting(false);
          return;
        }
        // blob → File → reUpload 拿 middleManuscriptId。
        const file = new File([result.blob], `${result.zipName}.zip`, { type: 'application/zip' });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('manuscriptId', manuscriptId);
        fd.append('excelJson', '');
        const upResp = await fetch('/api/hik/uedro/reUploadManuscript', { method: 'POST', body: fd });
        const upJson = await upResp.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!upResp.ok || !upJson?.ok) {
          const msg = upJson?.error?.message || upJson?.msg || `上传失败 HTTP ${upResp.status}`;
          setError(msg);
          setFieldErrors({ upload: msg });
          setSubmitting(false);
          return;
        }
        middleManuscriptId = upJson.data.middleManuscriptId;
        finalManuscriptId = upJson.data.manuscriptId || manuscriptId;
      } catch (err: any) {
        if (!aliveRef.current) return;
        const msg = '导出 Axure 包失败: ' + (err?.message || String(err));
        setError(msg);
        setFieldErrors({ upload: msg });
        setSubmitting(false);
        return;
      } finally {
        if (aliveRef.current) setExporting(false);
      }
      if (!middleManuscriptId) {
        setFieldErrors({ upload: '上传后未获得中间稿件 ID' });
        setSubmitting(false);
        return;
      }
    } else {
      // "上传"模式：到这里 reUploadInfo 必非空。
      if (!reUploadInfo?.middleManuscriptId) return;
      middleManuscriptId = reUploadInfo.middleManuscriptId;
      finalManuscriptId = reUploadInfo.manuscriptId || manuscriptId;
    }

    // 第二步：reUploadConfirm。
    try {
      const resp = await fetch('/api/hik/uedro/reUploadConfirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manuscriptId: finalManuscriptId,
          middleManuscriptId,
          description,
        }),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setError(j?.error?.message || j?.msg || `更新评审稿失败 HTTP ${resp.status}`);
        return;
      }
      setOkMsg('更新成功');
      // 1.2s 后自动关闭，让调用方接力刷新列表 / toast。
      setTimeout(() => {
        if (aliveRef.current) onClose();
      }, 1200);
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('更新评审稿失败: ' + (err?.message || String(err)));
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
        if (e.target === e.currentTarget && !submitting && !exporting) onClose();
      }}
    >
      <div className={styles.shell} role="dialog" aria-modal="true">
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.kicker}>REVIEW · UEDRO</div>
            <h2 className={styles.title}>更新评审稿</h2>
            {reviewName ? <p className={styles.subtitle}>{reviewName}</p> : null}
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭"
            disabled={submitting || exporting}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* 评审稿：来源切换 + 上传区，拖拽 / 点击选文件。 */}
          <div className={styles.item}>
            <label className={styles.itemLabel}>
              评审稿 <span className={styles.req}>*</span>
            </label>
            <div className={styles.itemControl}>
              <div className={styles.uploadArea}>
                {/* 评审稿来源切换：上传 / 来自当前项目 */}
                <div className={styles.sourceToggle}>
                  <button
                    type="button"
                    className={`${styles.sourceBtn} ${manuscriptSource === 'upload' ? styles.sourceBtnActive : ''}`}
                    onClick={() => {
                      setManuscriptSource('upload');
                      clearFieldError('upload');
                    }}
                  >
                    上传
                  </button>
                  <button
                    type="button"
                    className={`${styles.sourceBtn} ${manuscriptSource === 'project' ? styles.sourceBtnActive : ''}`}
                    onClick={() => {
                      setManuscriptSource('project');
                      clearFieldError('upload');
                    }}
                  >
                    来自当前项目
                  </button>
                </div>
                {manuscriptSource === 'project' ? (
                  <div className={styles.uploadFileRow}>
                    <span className={styles.uploadFileName}>{projectZipName}</span>
                    {exporting ? <span className={styles.acSpinner} /> : null}
                  </div>
                ) : (
                  <UploadArea
                    hint={hint}
                    uploading={uploading}
                    uploadInfo={reUploadInfo}
                    onPick={handleUpload}
                    onRemove={() => {
                      setReUploadInfo(null);
                      clearFieldError('upload');
                    }}
                  />
                )}
              </div>
              <span className={styles.itemError}>{fieldErrors.upload || ''}</span>
            </div>
          </div>

          {/* 备注：多行文本，可空。 */}
          <div className={styles.item}>
            <label className={styles.itemLabel}>备注</label>
            <div className={styles.itemControl}>
              <textarea
                className={styles.textarea}
                placeholder="请输入备注"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className={styles.foot}>
          <span className={`${styles.footMsg} ${error ? styles.footMsgErr : ''} ${okMsg ? styles.footMsgOk : ''}`}>
            {error || okMsg || ''}
          </span>
          <div className={styles.footActions}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={submitting || exporting}>
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void handleSubmit()}
              disabled={submitting || uploading || exporting}
            >
              {exporting ? '生成评审稿中…' : submitting ? '提交中…' : '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 评审稿上传区：拖拽 / 点击选文件，上传中显 spinner，成功后显文件名 + 替换 / 删除。 */
function UploadArea({
  hint,
  uploading,
  uploadInfo,
  onPick,
  onRemove,
}: {
  hint: string;
  uploading: boolean;
  uploadInfo: ReUploadInfo | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    onPick(f);
  }

  if (uploadInfo?.middleManuscriptId && !uploading) {
    const name = uploadInfo.fileName || uploadInfo.manuscriptId;
    return (
      <div className={styles.uploadFileRow}>
        <span className={styles.uploadFileName}>{name}</span>
        <button type="button" className={styles.uploadReplace} onClick={() => inputRef.current?.click()}>
          替换
        </button>
        <button type="button" className={styles.uploadReplace} onClick={onRemove}>
          删除
        </button>
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.uploadDrop}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading}
      >
        {uploading ? (
          <>
            <span className={styles.acSpinner} />
            <span>上传中…</span>
          </>
        ) : (
          <>
            <span className={styles.uploadIcon}>⬆</span>
            <span>{hint}</span>
            <span>点击或拖拽文件到此处</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}
