import { notifyToast } from './toast-context';
import { useT } from '../i18n';
import { userFacingError } from '../utils/userFacingError';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewAddModal.module.css';
import { exportProjectAsAxureZip } from '../runtime/axure-export';
import { exportProjectAsHtmlReviewZip } from '../runtime/uedro-html-review-export';
import { getProject } from '../state/projects';
import { getStoredUserInfo } from '../auth/auth';
import { openExternalUrl } from '../providers/registry';
import { HTML_REVIEW_TYPE, buildHtmlReviewUrl, buildManuscriptPreviewUrl } from './reviewMeta';
import { resolveUedroLaunchUrl } from './uedroLaunch';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { projectWorkspaceContext } from '../collab/useProjectWorkspaceScope';
import { PersonPicker, type Person } from './PersonPicker';
import { DEFAULT_HTML_REVIEW_H5_SIZE, HTML_REVIEW_H5_SIZES, appendHtmlReviewUploadFields, type HtmlReviewCarrierType } from './uedroHtmlUpload';

/**
 * 发起评审 Modal：在羽点（uedro）上发起一条真实评审。
 *
 * 对齐羽点原站"发起评审"表单，支持两种评审类型：
 *   - 项目评审（reviewModel=1）：选项目 → 选评审名称模板 → 子类型 → 人员 → 上传稿件 → 提交
 *   - 部门评审（reviewModel=2）：直接输入评审名称 → 子类型 → 人员 → 上传稿件 → 提交
 *
 * 数据流（全部走 daemon 透传路由，见 apps/daemon/src/routes/hik/_routes/uedro.ts）：
 *   - POST /api/hik/uedro/projectList   项目名称 autocomplete（项目模式）
 *   - POST /api/hik/uedro/reviewName    项目对应的评审名称模板（项目模式）
 *   - POST /api/hik/uedro/userList      人员 autocomplete（组长/作者/评委/抄送）
 *   - POST /api/hik/uedro/uploadManuscript  评审稿上传（multipart），拿 manuscriptId
 *   - POST /api/hik/uedro/reviewAddition    提交评审
 *
 * 提交体对齐原站 `review/v1/addition`：
 *   reviewName / description / reviewType / preReviewEndTime / reviewerMain[] /
 *   author[] / reviewers[] / coreReviewers[] / copyPersons[] / manuscriptId /
 *   reviewModel / projectId / projManager / projName（部门模式缺后三者）。
 *
 * 原站前置校验：核心评委不得与评审组长同名；评审稿 reviewType 必须与子类型一致。
 * 上游响应 {code:'0'} 视为成功。
 *
 * 评审模式（radio，默认"新建评审"）：
 *   - 新建评审：走 uploadManuscript → reviewAddition；成功后调项目
 *     PUT /api/projects/:id/uedro-review 保存 manuscriptId，只有 PUT 成功
 *     后才关闭 Modal、清空上传状态。
 *   - 更新评审稿：只换稿件，不动人员信息 —— reUploadManuscript（上传阶段，
 *     带当前 manuscriptId）→ reUploadConfirm。人员/抄送区域整体隐藏。
 *   - 更新评审信息：只改核心评委 / 团队评委 / 评审备注 / 抄送人员，其余字段
 *     全部禁用；提交走 POST /api/hik/uedro/reviewEdit，不碰稿件。
 *   两个更新模式都要求项目已绑定且评审单真实存在：Modal 打开且有 projectId 时
 *   探测（GET /api/projects/:id/uedro-review → GET /api/hik/uedro/reviewOne，
 *   上游 oneByReviewId），data === null / ok:false 视为不存在 → 默认新建评审并
 *   禁用两个更新模式的单选。存在时自动切"更新评审信息"并用 reviewRepeat 回填；
 *   repeat 取不到人员时只能"更新评审稿"（避免用空数组覆盖远端评委）。
 *   注意绑定值必须是**评审 id**（reviewAddition 返回的 data），不是稿件 id。
 *   注意"更新评审信息"的 reviewEdit 不要与"更新评审稿"的
 *   reUploadManuscript / reUploadConfirm 混用。
 */

/** 评审子类型选项（对齐羽点：1 交互 / 2 视觉 / 3 文稿 / 4 表格 / 11 Pixso-Handoff / 12 html）。 */
const REVIEW_SUBTYPES: { value: string; label: string }[] = [
  { value: '1', label: '交互评审' },
  { value: '2', label: '视觉评审' },
  { value: '3', label: '文稿评审' },
  { value: '4', label: '表格评审' },
  { value: '11', label: 'Pixso-Handoff' },
  { value: HTML_REVIEW_TYPE, label: 'html评审' },
];

/** 评审子类型的展示名（更新模式只读展示已有类型）。 */
function subtypeLabelOf(value: string): string {
  return REVIEW_SUBTYPES.find((s) => s.value === value)?.label ?? value;
}

/** 评审子类型对应的稿件提示（对齐原站 uploadDrag 的 drag_text）。 */
const SUBTYPE_UPLOAD_HINT: Record<string, string> = {
  '1': '请上传交互评审文件的 zip、rar 包，小于 100MB',
  '2': '请上传视觉评审文件的 zip、rar 包，小于 100MB',
  '3': '请上传 pdf、word 格式的评审文件，小于 100MB',
  '4': '请上传 .xlsx 格式文件（目前不支持对象、窗格嵌入），小于 10MB',
  '11': '请上传 Pixso 平台导出 Handoff 评审文件，小于 100MB',
  [HTML_REVIEW_TYPE]: '请上传 html 评审文件 zip 包，小于 500MB',
};

/** 项目对象（来自 /uedro/web/project/v1/projectList）：{projNum,projName,projManager,...}。 */
interface Project {
  projNum: string;
  projName: string;
  projManager?: string;
  [k: string]: any;
}

/** 评审稿上传响应 data：{manuscriptId,url,compressUrl,staticTempFileDir,menInfo,reviewType}。 */
interface UploadInfo {
  manuscriptId: string;
  url: string;
  reviewType?: string;
  fileName?: string;
  [k: string]: any;
}

/** 把原站 `YYYY/MM/DD HH:mm:ss` 转成 datetime-local 的 `YYYY-MM-DDTHH:mm`。 */
function toDatetimeLocal(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 评审模式：新建 / 更新评审稿（reUpload） / 更新评审信息（reviewEdit）。 */
type ReviewMode = 'create' | 'update-manuscript' | 'update-info';

/** reUploadManuscript 响应 data：{manuscriptId, middleManuscriptId, reviewType, ...}。 */
interface ReUploadInfo {
  manuscriptId: string;
  middleManuscriptId: string;
  reviewType?: string;
  fileName?: string;
  [k: string]: any;
}

/** 从 subProcess 的稿件列表里取版本号最大的 manuscriptId。 */
function pickLatestManuscriptId(list: any[]): string {
  let best: { id: string; version: number } | null = null;
  for (const item of list) {
    const id = typeof item?.manuscriptId === 'string' ? item.manuscriptId : '';
    if (!id) continue;
    const version = Number(item?.version);
    const v = Number.isFinite(version) ? version : 0;
    if (!best || v >= best.version) best = { id, version: v };
  }
  return best?.id ?? '';
}

export function ReviewAddModal({
  open,
  onClose,
  projectId,
  entryFile,
  workspaceContext,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  entryFile?: string | null;
  workspaceContext?: WorkspaceCollabContext | null;
}) {
  // ── 表单状态 ──
  // 评审模式：新建评审 / 更新评审稿 / 更新评审信息。
  // 只有探测到项目已绑定且存在的评审单时才能选择两个"更新"模式；
  // 否则默认新建，并禁用更新模式的单选。
  const [mode, setMode] = useState<ReviewMode>('create');
  // 是否存在可更新的评审单（oneByReviewId 的 data !== null）。
  const [hasExistingReview, setHasExistingReview] = useState(false);
  // 绑定的评审单已关闭/已完成（endStatus=3）：不能更新，只能新建。
  const [reviewClosed, setReviewClosed] = useState(false);
  // 是否取到了完整的可编辑信息（reviewRepeat 的 data）。取不到时只能"更新评审稿"，
  // 否则 reviewEdit 会用空数组覆盖远端评委。
  const [hasReviewInfo, setHasReviewInfo] = useState(false);
  // 项目当前绑定的 uedroReviewId（探测结果），更新模式提交用。
  const [boundReviewId, setBoundReviewId] = useState<string | null>(null);
  // 当前评审稿 ID（更新评审稿时 reUpload 的必填字段）。
  const [currentManuscriptId, setCurrentManuscriptId] = useState('');
  // 已有评审的评审类型（更新模式不改类型，上传提示按它选）。
  const [existingReviewType, setExistingReviewType] = useState('1');
  // 已有评审的类型归属（oneByReviewId.data.reviewModel：1 项目 / 2 部门）。
  const [existingReviewModel, setExistingReviewModel] = useState<1 | 2>(2);
  // 已有评审绑定的羽点项目号 / 项目名（仅项目评审有值）。
  const [existingProjectId, setExistingProjectId] = useState('');
  const [existingProjectName, setExistingProjectName] = useState('');
  // 更新评审稿：reUploadManuscript 的中间结果。
  const [reUploadInfo, setReUploadInfo] = useState<ReUploadInfo | null>(null);
  // 更新模式提交 reviewEdit 用的原始 preReviewEndTime（原站格式）。
  const rawEndtimeRef = useRef('');
  // 是否正在探测项目绑定的评审单（探测期间禁用模式切换）。
  const [probing, setProbing] = useState(false);
  const [reviewModel, setReviewModel] = useState<1 | 2>(2); // 1 项目 / 2 部门，默认部门评审
  // 项目模式：选中的项目 + 评审名称模板列表
  const [project, setProject] = useState<Project | null>(null);
  const [reviewTemplates, setReviewTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  // 部门模式：自由输入评审名称
  const [deptReviewName, setDeptReviewName] = useState('');
  const [subtype, setSubtype] = useState('1'); // select2，默认交互评审
  const [carrierType, setCarrierType] = useState<HtmlReviewCarrierType>('web');
  const [h5Size, setH5Size] = useState(DEFAULT_HTML_REVIEW_H5_SIZE);
  const [endtime, setEndtime] = useState(''); // datetime-local 值
  const [content, setContent] = useState(''); // 评审备注
  // 人员（对象数组，原站把整个人员对象塞进提交体）
  const [mainjudge, setMainjudge] = useState<Person[]>([]);
  const [author, setAuthor] = useState<Person[]>([]);
  const [coreReviewers, setCoreReviewers] = useState<Person[]>([]);
  const [judgelist, setJudgelist] = useState<Person[]>([]); // 团队评委（非必填）
  const [addPersonList, setAddPersonList] = useState<Person[]>([]); // 抄送（非必填）
  // 评审稿
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  // 评审稿来源：'project' 根据类型导出项目 ZIP（HTML 或 Axure） / 'upload' 手动上传
  const [manuscriptSource, setManuscriptSource] = useState<'project' | 'upload'>('project');
  // 当前 open-design 项目名称（用于"来自当前项目"时显示 zip 文件名）
  const [odProjectName, setOdProjectName] = useState('');
  // 从当前项目打包 ZIP 并上传中
  const [exporting, setExporting] = useState(false);
  // 提交
  const [submitting, setSubmitting] = useState(false);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  // 字段级错误：提交时收集，填写正确后自动清除对应 key。
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** 清除某个字段的错误（值变更后调用）。 */
  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const aliveRef = useRef(true);

  // 默认结束时间：今 + 2 天 23:59:59（对齐原站 getEndDate(2)）。
  // 用 datetime-local 的 `YYYY-MM-DDTHH:mm` 格式。
  useEffect(() => {
    if (!open) return;
    const d = new Date(Date.now() + 2 * 86400000);
    d.setHours(23, 59, 59, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEndtime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
 }, [open]);

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

  // 打开且存在 projectId 时探测项目绑定的评审单：
  //   1. GET /api/projects/:id/uedro-review 拿 uedroReviewId。
  //   2. 有 ID 则调 GET /api/hik/uedro/reviewRepeat?reviewId=...。
  // 打开且存在 projectId 时探测项目绑定的评审单：
  //   1. GET /api/projects/:id/uedro-review 拿 uedroReviewId（评审 id）。
  //   2. GET /api/hik/uedro/reviewOne?reviewId=…（上游 oneByReviewId）判断评审
  //      是否存在：data === null / ok:false 一律视为不存在。评审稿 id 在这里
  //      必然查不到，所以不能用它当评审 id。
  //   3. 存在时再取 GET /api/hik/uedro/reviewRepeat 回填可编辑字段（人员/备注）。
  //      repeat 只对带评审流程的评审单可用，失败不影响存在性判断，但此时
  //      不能"更新评审信息"（否则会用空数组覆盖远端评委）。
  //   4. 更新评审稿需要当前稿件 id：优先 repeat.manuscriptId，缺失时用
  //      POST /api/hik/uedro/subProcess 里版本号最大的稿件。
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    const alive = () => !cancelled && aliveRef.current;
    setProbing(true);
    (async () => {
      try {
        const bindingResp = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/uedro-review`,
        );
        const bindingJson = await bindingResp.json().catch(() => null);
        if (!alive()) return;
        const reviewId: string | null =
          typeof bindingJson?.uedroReviewId === 'string' && bindingJson.uedroReviewId
            ? bindingJson.uedroReviewId
            : null;
        setBoundReviewId(reviewId);
        if (!reviewId) return;

        const oneResp = await fetch(
          `/api/hik/uedro/reviewOne?reviewId=${encodeURIComponent(reviewId)}`,
        );
        const oneJson = await oneResp.json().catch(() => null);
        if (!alive()) return;
        if (!oneResp.ok || !oneJson?.ok || oneJson.data == null) {
          setHasExistingReview(false);
          setHasReviewInfo(false);
          return;
        }
        const one = oneJson.data;
        // 已关闭/已完成的评审单（上游 endStatus=3）不能再更新，等同"无评审单"。
        const endStatusNum = Number(one.endStatus);
        if (Number.isFinite(endStatusNum) && endStatusNum === 3) {
          setReviewClosed(true);
          setHasExistingReview(false);
          setHasReviewInfo(false);
          return;
        }
        setReviewClosed(false);
        setHasExistingReview(true);
        // 主数据能回填的基础字段：名称 / 类型 / 截止时间 / 备注。
        if (typeof one.reviewName === 'string') setDeptReviewName(one.reviewName);
        if (one.reviewType != null && String(one.reviewType)) {
          setExistingReviewType(String(one.reviewType));
        }
        // 评审类型归属（项目评审/部门评审）与项目名称，用于更新模式的只读展示。
        const rmNum = Number(one.reviewModel);
        const model: 1 | 2 = rmNum === 1 || rmNum === 2 ? rmNum : one.projectId ? 1 : 2;
        setExistingReviewModel(model);
        const projNum = typeof one.projectId === 'string' ? one.projectId.trim() : '';
        setExistingProjectId(projNum);
        setExistingProjectName('');
        if (model === 1 && projNum) {
          // 项目评审：用项目号反查项目名（失败不打断回填，只显示项目号）。
          fetch('/api/hik/uedro/projectList', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projNumOrName: projNum, processType: 1, pageNo: 1, pageSize: 10 }),
          })
            .then((r) => r.json().catch(() => null))
            .then((pj) => {
              if (!alive()) return;
              const list = Array.isArray(pj?.data?.list) ? pj.data.list : [];
              const hit = list.find((p: Project) => p.projNum === projNum) ?? list[0];
              if (hit?.projName) setExistingProjectName(hit.projName);
            })
            .catch(() => {});
        }
        if (typeof one.preReviewEndTime === 'string' && one.preReviewEndTime) {
          rawEndtimeRef.current = one.preReviewEndTime;
        }
        const endLocal = toDatetimeLocal(one.preReviewEndTimeDate ?? one.preReviewEndTime ?? '');
        if (endLocal) setEndtime(endLocal);
        if (typeof one.content === 'string') setContent(one.content);

        // 人员/备注/稿件 id 只有 repeat 给得全。
        let infoLoaded = false;
        let manuscriptId = '';
        try {
          const repResp = await fetch(
            `/api/hik/uedro/reviewRepeat?reviewId=${encodeURIComponent(reviewId)}`,
          );
          const repJson = await repResp.json().catch(() => null);
          if (alive() && repResp.ok && repJson?.ok && repJson.data != null) {
            const d = repJson.data;
            infoLoaded = true;
            rawEndtimeRef.current = d.preReviewEndTime ?? rawEndtimeRef.current;
            if (typeof d.reviewName === 'string' && d.reviewName) setDeptReviewName(d.reviewName);
            if (d.reviewType != null && String(d.reviewType)) {
              setExistingReviewType(String(d.reviewType));
            }
            const repEndLocal = toDatetimeLocal(d.preReviewEndTime ?? '');
            if (repEndLocal) setEndtime(repEndLocal);
            // reviewers 的第一个是组长，其余为团队评委；团队评委剔除作者。
            const reviewers = Array.isArray(d.reviewers) ? d.reviewers : [];
            const leader = reviewers[0] ?? null;
            const teamJudges = reviewers.slice(1);
            setMainjudge(leader ? [leader] : (Array.isArray(d.designers) ? d.designers : []));
            setCoreReviewers(Array.isArray(d.coreReviewers) ? d.coreReviewers : []);
            const authorList = Array.isArray(d.author) ? d.author : [];
            setAuthor(authorList);
            const authorIds = new Set(authorList.map((p: Person) => p.id).filter(Boolean));
            const authorNames = new Set(authorList.map((p: Person) => p.name).filter(Boolean));
            setJudgelist(
              teamJudges.filter(
                (p: Person) => !(authorIds.has(p.id) || authorNames.has(p.name)),
              ),
            );
            if (typeof d.content === 'string') setContent(d.content);
            setAddPersonList(Array.isArray(d.copyPersons) ? d.copyPersons : []);
            if (typeof d.manuscriptId === 'string' && d.manuscriptId) {
              manuscriptId = d.manuscriptId;
            }
          }
        } catch {
          // repeat 仅用于回填；失败时保留 oneByReviewId 给到的基础字段。
        }

        if (!manuscriptId) {
          try {
            const subResp = await fetch('/api/hik/uedro/subProcess', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reviewId, pageNo: 1, pageSize: 10000 }),
            });
            const subJson = await subResp.json().catch(() => null);
            const list = Array.isArray(subJson?.data?.list) ? subJson.data.list : [];
            manuscriptId = pickLatestManuscriptId(list);
          } catch {
            manuscriptId = '';
          }
        }
        if (!alive()) return;
        setCurrentManuscriptId(manuscriptId);
        setHasReviewInfo(infoLoaded);
        // 有完整信息 → 默认"更新评审信息"；只有稿件 id → "更新评审稿"；否则新建。
        setMode(infoLoaded ? 'update-info' : manuscriptId ? 'update-manuscript' : 'create');
      } catch {
        // 探测失败保持新建模式（两个更新模式均不可选）。
      } finally {
        if (alive()) setProbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
 }, [open, projectId]);

  // 打开时预填"作者"为当前登录用户。
  useEffect(() => {
    if (!open) return;
    // 只从 session 拿 displayName，再调 uedro userList 查完整 Person。
    const info = getStoredUserInfo();
    const displayName = info?.displayName;
    if (!displayName) return;
    let cancelled = false;
    fetch('/api/hik/uedro/userList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: displayName, pageNo: 1, pageSize: 15 }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (cancelled) return;
        const list: Person[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        const person = list[0];
        if (person) setAuthor([person]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 组件卸载 / 关闭后不再写状态。
  useEffect(() => {
    aliveRef.current = open;
    if (!open) {
      // 关闭时清空所有表单状态，下次打开是干净初始态。
      setMode('create');
      setHasExistingReview(false);
      setHasReviewInfo(false);
      setReviewClosed(false);
      setBoundReviewId(null);
      setCurrentManuscriptId('');
      setExistingReviewType('1');
      setExistingReviewModel(2);
      setExistingProjectId('');
      setExistingProjectName('');
      setReUploadInfo(null);
      rawEndtimeRef.current = '';
      setProbing(false);
      setReviewModel(2);
      setProject(null);
      setReviewTemplates([]);
      setSelectedTemplate(null);
      setDeptReviewName('');
      setSubtype('1');
      setCarrierType('web');
      setH5Size(DEFAULT_HTML_REVIEW_H5_SIZE);
      setEndtime('');
      setContent('');
      setMainjudge([]);
      setAuthor([]);
      setCoreReviewers([]);
      setJudgelist([]);
      setAddPersonList([]);
      setUploadInfo(null);
      setUploading(false);
      setManuscriptSource('project');
      setOdProjectName('');
      setExporting(false);
      setSubmitting(false);
      setError(null);

      setFieldErrors({});
    }
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  /** 评审名称：项目模式取模板的 reviewname_cn，部门模式取自由输入。 */
  const reviewNameForSubmit = useMemo(() => {
    if (reviewModel === 1) {
      // 原站提交的是 JSON.stringify(模板对象) —— 对齐原站 select3 的 value。
      return selectedTemplate ? JSON.stringify(selectedTemplate) : '';
    }
    return deptReviewName;
  }, [reviewModel, selectedTemplate, deptReviewName]);

  /** 是否处于任一"更新"模式（更新模式下基础字段全部禁用）。 */
  const isUpdate = mode !== 'create';
  const isInfoUpdate = mode === 'update-info';
  const isManuscriptUpdate = mode === 'update-manuscript';
  /** 更新模式沿用已有评审的类型；新建模式用当前选择。 */
  const effectiveSubtype = isUpdate ? existingReviewType : subtype;
  /** 更新模式沿用已有评审的类型归属；新建模式用当前选择。 */
  const effectiveReviewModel = isUpdate ? existingReviewModel : reviewModel;
  /** 更新模式下项目名称的展示串（对齐 ProjectPicker：`（projNum）projName`）。 */
  const existingProjectLabel = existingProjectId
    ? existingProjectName
      ? `（${existingProjectId}）${existingProjectName}`
      : existingProjectId
    : '';

  /** endtime 转原站格式 `YYYY/MM/DD HH:mm:ss`。 */
  const endtimeForSubmit = useMemo(() => {
    if (!endtime) return '';
    // datetime-local 是 "YYYY-MM-DDTHH:mm"，补秒并换分隔符。
    const d = new Date(endtime);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:59`;
  }, [endtime]);

  /** 拉项目对应的评审名称模板（项目模式选中项目后触发）。 */
  async function loadReviewTemplates(projNum: string) {
    if (!projNum) {
      setReviewTemplates([]);
      setSelectedTemplate(null);
      return;
    }
    try {
      const resp = await fetch('/api/hik/uedro/reviewName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projNum }),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setReviewTemplates([]);
        setSelectedTemplate(null);
        notifyToast({ message: userFacingError(j?.error, t, 'feedback.reviewInfoFailed'), tone: 'error' });
        return;
      }
      // 上游 data 是 JSON 串（"[{...}]" 或 "[null]"），解析成数组。
      const raw = typeof j.data === 'string' ? j.data : JSON.stringify(j.data ?? []);
      let arr: any[] = [];
      try {
        arr = JSON.parse(raw);
      } catch {
        arr = [];
      }
      const valid = arr.filter((x) => x && typeof x === 'object');
      setReviewTemplates(valid);
      setSelectedTemplate(valid[0] ?? null);
      if (!valid.length) setError('该项目没有可用的评审名称模板');
    } catch (err: any) {
      if (!aliveRef.current) return;
      notifyToast({ message: userFacingError(err, t, 'feedback.loadReviewFailed'), tone: 'error' });
      setReviewTemplates([]);
    }
  }

  /** 上传评审稿：multipart/form-data，字段 file + excelJson（固定空串）。 */
  /** 当前项目 ZIP 文件名：按选中类型生成 HTML 资源包或 Axure 交互稿。 */
  const projectZipName = useMemo(() => {
    const raw = odProjectName.trim() || (effectiveSubtype === HTML_REVIEW_TYPE ? 'html-review' : 'axure-prototype');
    const name = raw
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'axure-prototype';
    return `${name}.zip`;
  }, [odProjectName, effectiveSubtype]);

  async function handleUpload(file: File) {
    if (subtype === HTML_REVIEW_TYPE && (!/\.zip$/i.test(file.name) || file.size >= 500 * 1024 * 1024)) {
      setFieldErrors({ upload: 'html评审请上传小于 500MB 的 ZIP 压缩包' });
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('excelJson', '');
        appendHtmlReviewUploadFields(fd, subtype, carrierType, h5Size);
      const resp = await fetch('/api/hik/uedro/uploadManuscript', { method: 'POST', body: fd });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        notifyToast({ message: userFacingError(j?.error ?? j?.msg, t, 'feedback.uploadReviewFailed'), tone: 'error' });
        setUploadInfo(null);
        return;
      }
    setUploadInfo({ ...j.data, fileName: file.name });
      clearFieldError('upload');
   } catch (err: any) {
      if (!aliveRef.current) return;
      notifyToast({ message: userFacingError(err, t, 'feedback.uploadReviewFailed'), tone: 'error' });
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }

  /** 更新评审稿：重新上传（第一步，multipart：file + manuscriptId）。 */
  async function handleReUpload(file: File) {
    if (effectiveSubtype === HTML_REVIEW_TYPE && (!/\.zip$/i.test(file.name) || file.size >= 500 * 1024 * 1024)) {
      setFieldErrors({ upload: 'html评审请上传小于 500MB 的 ZIP 压缩包' });
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // 这里要的是**稿件 id**：绑定值是评审 id，绝不能拿来兜底。
      fd.append('manuscriptId', currentManuscriptId);
      fd.append('excelJson', '');
      appendHtmlReviewUploadFields(fd, effectiveSubtype, carrierType, h5Size);
      const resp = await fetch('/api/hik/uedro/reUploadManuscript', { method: 'POST', body: fd });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        notifyToast({ message: userFacingError(j?.error ?? j?.msg, t, 'feedback.uploadReviewFailed'), tone: 'error' });
        setReUploadInfo(null);
        return;
      }
      setReUploadInfo({ ...j.data, fileName: file.name });
      // 与新建一致：羽点识别的稿件类型必须和该评审的类型一致。
      const uploadedType = j.data?.reviewType;
      if (uploadedType && String(uploadedType) !== effectiveSubtype) {
        setReUploadInfo(null);
        setFieldErrors({ upload: '评审类型与上传评审稿格式不一致' });
        return;
      }
      clearFieldError('upload');
    } catch (err: any) {
      if (!aliveRef.current) return;
      notifyToast({ message: userFacingError(err, t, 'feedback.uploadReviewFailed'), tone: 'error' });
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }

  /**
   * 评审绑定接口的请求头。
   *
   * PUT /api/projects/:id/uedro-review 走工作区写权限校验，daemon 要求请求
   * 显式带上 `x-od-workspace-*` 身份，否则直接 400 WORKSPACE_CONTEXT_REQUIRED
   * ——评审单建好了却绑不上，就是缺这组头。
   *
   * 身份优先取项目自己的 workspace-scope：同一个用户在个人空间与团队空间的
   * member id 不同，直接套用手上的 UI 上下文可能给错 workspace 的 member id。
   */
  async function resolveReviewBindingHeaders(): Promise<Record<string, string>> {
    const fromContext = workspaceContext
      ? (workspaceProjectHeaders(workspaceContext) as Record<string, string>)
      : {};
    if (!projectId) return fromContext;
    try {
      const resp = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workspace-scope`,
        { headers: fromContext },
      );
      const json = await resp.json().catch(() => null);
      const scoped = projectWorkspaceContext(json?.scope);
      return scoped
        ? (workspaceProjectHeaders(scoped) as Record<string, string>)
        : fromContext;
    } catch {
      // scope 查不到时退回 UI 上下文；再不行就让 daemon 明确报错。
      return fromContext;
    }
  }

  /**
   * 把评审 id 写进项目的绑定（本地 SQLite + 团队空间 HDW 云端）。
   * 返回 ok 表示本地与（团队空间的）云端都写成功；个人空间 remoteSaved 为 null，不算失败。
   */
  async function saveReviewBinding(reviewId: string): Promise<{
    ok: boolean;
    localSaved: boolean;
    remoteSaved: boolean | null;
    message: string;
  }> {
    if (!projectId) {
      return { ok: true, localSaved: false, remoteSaved: null, message: '' };
    }
    try {
      const headers = await resolveReviewBindingHeaders();
      const resp = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/uedro-review`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uedroReviewId: reviewId }),
        },
      );
      const json = await resp.json().catch(() => null);
      const localSaved = json?.localSaved === true;
      const remoteSaved = typeof json?.remoteSaved === 'boolean' ? json.remoteSaved : null;
      // 本地和云端都要写上：remoteSaved === false 表示团队空间的 HDW 同步
      // 失败，同样不算成功；null 表示个人空间无远端能力，属正常。
      const ok = resp.ok && localSaved && remoteSaved !== false;
      if (ok) return { ok, localSaved, remoteSaved, message: '' };
      if (!resp.ok) {
        return {
          ok,
          localSaved,
          remoteSaved,
          message: userFacingError(json?.error ?? json?.msg, t, 'feedback.saveFailed'),
        };
      }
      return {
        ok,
        localSaved,
        remoteSaved,
        message: localSaved
          ? '评审单已绑定到本地，但云端同步失败，请重试'
          : '评审单与项目的绑定保存失败，请重试',
      };
    } catch {
      return {
        ok: false,
        localSaved: false,
        remoteSaved: null,
        message: '评审单与项目的绑定保存失败，请重试',
      };
    }
  }

  /** 创建成功后：提示、打开羽点评审页、关闭弹窗。 */
  async function finishCreatedReview(manuscriptId: string, reviewSubtype: string) {
    notifyToast({ message: t('feedback.created'), tone: 'success' });
    // 创建成功后用系统浏览器打开正式羽点评审页，随后关闭本 modal。
    const previewUrl = reviewSubtype === HTML_REVIEW_TYPE
      ? buildHtmlReviewUrl(manuscriptId)
      : buildManuscriptPreviewUrl(reviewSubtype, manuscriptId);
    if (previewUrl && aliveRef.current) {
      const launchUrl = await resolveUedroLaunchUrl(previewUrl);
      if (launchUrl) await openExternalUrl(launchUrl);
    }
    if (aliveRef.current) onClose();
  }

  /** 提交评审。 */
  async function handleSubmit() {
    setError(null);

    // ── 更新评审信息：走 reviewEdit，只改核心评委/团队评委/备注/抄送。──
    // 注意不要与"更新评审稿"的 reUploadManuscript/reUploadConfirm 混用。
    if (mode === 'update-info') {
      if (!boundReviewId) {
        setError('未找到可更新的评审单');
        return;
      }
      // 没有回填到现有评委时不能提交：reviewEdit 会按表单里的空数组覆盖远端。
      if (!hasReviewInfo) {
        setError('读取不到该评审的评委信息，请先切换"更新评审稿"或重新打开');
        return;
      }
      // reviewEdit 是整体覆盖：核心评委为空会把远端评委清空。
      if (!coreReviewers.length) {
        setFieldErrors({ coreReviewers: '请添加核心评委' });
        return;
      }
      setSubmitting(true);
      try {
        const resp = await fetch('/api/hik/uedro/reviewEdit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewId: boundReviewId,
            preReviewEndTime: rawEndtimeRef.current,
            designers: mainjudge,
            reviewers: [...mainjudge, ...judgelist],
            coreReviewers,
            copyPersons: addPersonList,
            content,
          }),
        });
        const j = await resp.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!resp.ok || !j?.ok) {
          notifyToast({ message: userFacingError(j?.error ?? j?.msg, t, 'feedback.saveFailed'), tone: 'error' });
          return;
        }
        notifyToast({ message: t('feedback.updated'), tone: 'success' });
        if (aliveRef.current) onClose();
      } catch (err: any) {
        if (!aliveRef.current) return;
        notifyToast({ message: userFacingError(err, t, 'feedback.saveFailed'), tone: 'error' });
      } finally {
        if (aliveRef.current) setSubmitting(false);
      }
      return;
    }

    // ── 更新评审稿：reUploadManuscript（上传阶段） → reUploadConfirm。──
    if (mode === 'update-manuscript') {
      if (!boundReviewId) {
        setError('未找到可更新的评审单');
        return;
      }
      if (!currentManuscriptId) {
        setFieldErrors({ upload: '缺少稿件 ID，无法更新评审稿' });
        return;
      }
      if (manuscriptSource === 'upload' && !reUploadInfo?.middleManuscriptId) {
        setFieldErrors({ upload: '请上传评审稿' });
        return;
      }
      setSubmitting(true);
      try {
        let middleManuscriptId = reUploadInfo?.middleManuscriptId ?? '';
        let finalManuscriptId = reUploadInfo?.manuscriptId || currentManuscriptId;
        if (manuscriptSource === 'project') {
          if (!projectId) {
            setFieldErrors({ upload: '无法获取当前项目' });
            return;
          }
          setExporting(true);
          const result = effectiveSubtype === HTML_REVIEW_TYPE
            ? await exportProjectAsHtmlReviewZip({ projectId, projectName: odProjectName, entryFile, workspaceContext })
            : await exportProjectAsAxureZip({ projectId, projectName: odProjectName, returnBlob: true });
          if (!result.ok) {
            const msg = userFacingError(result.error, t, 'feedback.uploadReviewFailed');
            notifyToast({ message: msg, tone: 'error' });
            setFieldErrors({ upload: msg });
            return;
          }
          if (!result.blob || !result.zipName) {
            const msg = '生成评审稿 ZIP 失败：未生成文件';
            notifyToast({ message: msg, tone: 'error' });
            setFieldErrors({ upload: msg });
            return;
          }
          const file = new File([result.blob], `${result.zipName}.zip`, { type: 'application/zip' });
          const fd = new FormData();
          fd.append('file', file);
          fd.append('manuscriptId', currentManuscriptId);
          fd.append('excelJson', '');
          appendHtmlReviewUploadFields(fd, effectiveSubtype, carrierType, h5Size);
          const upResp = await fetch('/api/hik/uedro/reUploadManuscript', { method: 'POST', body: fd });
          const upJson = await upResp.json().catch(() => null);
          if (!aliveRef.current) return;
          if (!upResp.ok || !upJson?.ok) {
            const msg = userFacingError(upJson?.error ?? upJson?.msg, t, 'feedback.uploadReviewFailed');
            notifyToast({ message: msg, tone: 'error' });
            setFieldErrors({ upload: msg });
            return;
          }
          middleManuscriptId = upJson.data?.middleManuscriptId;
          finalManuscriptId = upJson.data?.manuscriptId || currentManuscriptId;
          if (upJson.data?.reviewType && String(upJson.data.reviewType) !== effectiveSubtype) {
            setFieldErrors({ upload: '评审类型与上传评审稿格式不一致' });
            return;
          }
        }
        if (!middleManuscriptId) {
          setFieldErrors({ upload: t('feedback.reviewUploadResultFailed') });
          return;
        }
        const resp = await fetch('/api/hik/uedro/reUploadConfirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manuscriptId: finalManuscriptId,
            middleManuscriptId,
            description: content,
          }),
        });
        const j = await resp.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!resp.ok || !j?.ok) {
          notifyToast({ message: userFacingError(j?.error ?? j?.msg, t, 'feedback.saveFailed'), tone: 'error' });
          return;
        }
        notifyToast({ message: t('feedback.updated'), tone: 'success' });
        setReUploadInfo(null);
        if (aliveRef.current) onClose();
      } catch (err: any) {
        if (!aliveRef.current) return;
        notifyToast({ message: userFacingError(err, t, 'feedback.saveFailed'), tone: 'error' });
      } finally {
        if (aliveRef.current) {
          setExporting(false);
          setSubmitting(false);
        }
      }
      return;
    }

    const errs: Record<string, string> = {};
    // 必填校验（对齐原站 rules）。
    if (reviewModel === 1 && !project?.projNum) {
      errs.project = '请选择项目';
    }
    if (!reviewNameForSubmit) {
      errs.reviewName = reviewModel === 1 ? '请选择评审名称' : '请输入评审名称';
    }
    if (!endtime) {
      errs.endtime = '请选择结束时间';
    }
    if (!mainjudge.length) {
      errs.mainjudge = '请添加评审组长';
    }
    if (!author.length) {
      errs.author = '请添加作者';
    }
    if (!coreReviewers.length) {
      errs.coreReviewers = '请添加核心评委';
    }
    // "来自当前项目"时评审稿在提交时自动生成，无需校验；仅"上传"模式校验。
    if (manuscriptSource === 'upload' && !uploadInfo?.manuscriptId) {
      errs.upload = '请上传评审稿';
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
    // "上传"模式：校验已有 uploadInfo 的类型一致性。
    if (manuscriptSource === 'upload' && uploadInfo?.reviewType && String(uploadInfo.reviewType) !== subtype) {
      setFieldErrors({ upload: '评审类型与上传评审稿格式不一致' });
      return;
    }

    // 解析最终 manuscriptId：
    // - "上传"模式：直接用已有 uploadInfo。
    // - "来自当前项目"模式：HTML 评审导出 HTML 资源 ZIP，其它类型保留 Axure 导出。
    setSubmitting(true);
    let manuscriptId = uploadInfo?.manuscriptId ?? '';
    if (manuscriptSource === 'project') {
      if (!projectId) {
        setFieldErrors({ upload: '无法获取当前项目' });
        setSubmitting(false);
        return;
      }
      setExporting(true);
      try {
        const result = subtype === HTML_REVIEW_TYPE
          ? await exportProjectAsHtmlReviewZip({ projectId, projectName: odProjectName, entryFile, workspaceContext })
          : await exportProjectAsAxureZip({ projectId, projectName: odProjectName, returnBlob: true });
        if (!result.ok) {
          notifyToast({ message: userFacingError(result.error, t, 'feedback.uploadReviewFailed'), tone: 'error' });
          setFieldErrors({ upload: userFacingError(result.error, t, 'feedback.uploadReviewFailed') });
          setSubmitting(false);
          return;
        }
        if (!result.blob || !result.zipName) {
          const msg = '生成评审稿 ZIP 失败：未生成文件';
          notifyToast({ message: msg, tone: 'error' });
          setFieldErrors({ upload: msg });
          setSubmitting(false);
          return;
        }
        // blob → File → 上传拿 manuscriptId（临时文件流，浏览器自动回收）。
        const file = new File([result.blob], `${result.zipName}.zip`, { type: 'application/zip' });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('excelJson', '');
        appendHtmlReviewUploadFields(fd, subtype, carrierType, h5Size);
        const upResp = await fetch('/api/hik/uedro/uploadManuscript', { method: 'POST', body: fd });
        const upJson = await upResp.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!upResp.ok || !upJson?.ok) {
          const msg = userFacingError(upJson?.error ?? upJson?.msg, t, 'feedback.uploadReviewFailed');
          notifyToast({ message: msg, tone: 'error' });
          setFieldErrors({ upload: msg });
          setSubmitting(false);
          return;
        }
        if (upJson.data?.reviewType && String(upJson.data.reviewType) !== subtype) {
          setFieldErrors({ upload: '羽点识别的评审稿类型与当前选择不一致，请检查 ZIP 内容' });
          setSubmitting(false);
          return;
        }
        manuscriptId = upJson.data?.manuscriptId;
      } catch (err: any) {
        if (!aliveRef.current) return;
        const msg = userFacingError(err, t, 'feedback.uploadReviewFailed');
        notifyToast({ message: msg, tone: 'error' });
        setFieldErrors({ upload: msg });
        setSubmitting(false);
        return;
      } finally {
        if (aliveRef.current) setExporting(false);
      }
      if (!manuscriptId) {
        setFieldErrors({ upload: '上传后未获得评审稿 ID' });
        setSubmitting(false);
        return;
      }
    } else {
      // "上传"模式：到这里 uploadInfo 必非空。
      if (!uploadInfo?.manuscriptId) return;
      manuscriptId = uploadInfo.manuscriptId;
    }

    const body: Record<string, any> = {
      reviewName: reviewNameForSubmit,
      description: content,
      reviewType: subtype,
      preReviewEndTime: endtimeForSubmit,
      reviewerMain: mainjudge,
      author,
      reviewers: judgelist,
      coreReviewers,
      copyPersons: addPersonList,
      manuscriptId,
      reviewModel,
    };
    if (reviewModel === 1 && project) {
      body.projectId = project.projNum;
      body.projManager = project.projManager ?? '';
      body.projName = project.projName;
    }

    try {
      const resp = await fetch('/api/hik/uedro/reviewAddition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        notifyToast({ message: userFacingError(j?.error ?? j?.msg, t, 'feedback.saveFailed'), tone: 'error' });
        return;
      }
      // 绑定的是"评审 id"，不是稿件 id：reviewAddition 的 data 就是新评审 id。
      // 用稿件 id 绑定会让 oneByReviewId 查不到评审单（"未知错误"），因此拿不到
      // 评审 id 时宁可不写绑定，也不退回稿件 id。
      const createdReviewId =
        typeof j.data === 'string' && j.data
          ? j.data
          : typeof j.data?.reviewId === 'string' && j.data.reviewId
            ? j.data.reviewId
            : '';
      if (projectId && !createdReviewId) {
        notifyToast({
          message: '评审已创建，但没取到评审 id，未能与项目绑定',
          tone: 'error',
        });
      }
      // 只有本地与云端都写成功后才关闭 Modal、清空上传状态；不能提前关闭。
      if (projectId && createdReviewId) {
        const saved = await saveReviewBinding(createdReviewId);
        if (!aliveRef.current) return;
        if (!saved.ok) {
          notifyToast({ message: `评审已创建，${saved.message}`, tone: 'error' });
          return;
        }
        // 绑定成功后再清空上传状态。
        setUploadInfo(null);
      }
      await finishCreatedReview(manuscriptId, subtype);
    } catch (err: any) {
      if (!aliveRef.current) return;
      notifyToast({ message: userFacingError(err, t, 'feedback.saveFailed'), tone: 'error' });
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }

  /** 改变类型时保留稿件来源，导出阶段按选中类型生成对应的 ZIP。 */
  function switchSubtype(nextSubtype: string) {
    setSubtype(nextSubtype);
  }

  /** 切换评审类型时重置项目相关状态。 */
  function switchModel(m: 1 | 2) {
    setReviewModel(m);
    setProject(null);
    setReviewTemplates([]);
    setSelectedTemplate(null);
    setDeptReviewName('');
    setError(null);
  }

  /** 切换评审模式。不存在评审单时不允许选更新模式；
   *  更新评审信息还要求取到完整信息（否则会用空评委覆盖远端）,
   *  更新评审稿要求已知当前稿件 id。 */
  function switchMode(next: ReviewMode) {
    if (next === 'update-manuscript' && (!hasExistingReview || !currentManuscriptId)) return;
    if (next === 'update-info' && (!hasExistingReview || !hasReviewInfo)) return;
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
     <div className={styles.shell} role="dialog" aria-modal="true">
       <div className={styles.head}>
         <div className={styles.headMain}>
           <div className={styles.kicker}>REVIEW · UEDRO</div>
           <h2 className={styles.title}>发起评审</h2>
         </div>
         <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
           ✕
         </button>
       </div>

       <div className={styles.body}>
         {/* ── 第零组：新建评审 / 更新评审 ── */}
         <div className={styles.group}>
           <div className={styles.item}>
             <label className={styles.itemLabel}>
               评审模式 <span className={styles.req}>*</span>
             </label>
             <div className={styles.itemControl}>
               <div className={styles.radioRow}>
                 <label className={styles.radio}>
                   <input
                     type="radio"
                     name="review-mode"
                     checked={mode === 'create'}
                     onChange={() => switchMode('create')}
                   />
                   新建评审
                 </label>
                 <label className={styles.radio}>
                   <input
                     type="radio"
                     name="review-mode"
                     checked={mode === 'update-manuscript'}
                     onChange={() => switchMode('update-manuscript')}
                     disabled={probing || !hasExistingReview || !currentManuscriptId}
                   />
                   更新评审稿
                 </label>
                 <label className={styles.radio}>
                   <input
                     type="radio"
                     name="review-mode"
                     checked={mode === 'update-info'}
                     onChange={() => switchMode('update-info')}
                     disabled={probing || !hasExistingReview || !hasReviewInfo}
                   />
                   更新评审信息
                 </label>
               </div>
              {reviewClosed ? (
                <span className={styles.itemHint}>
                  该评审单已关闭或已完成，只能新建评审
                </span>
              ) : !hasExistingReview ? (
                <span className={styles.itemHint}>当前项目还没有评审单，只能新建评审</span>
              ) : !hasReviewInfo ? (
                 <span className={styles.itemHint}>
                   读取不到该评审的评委信息，暂时只能更新评审稿
                 </span>
               ) : isInfoUpdate ? (
                 <span className={styles.itemHint}>
                   更新评审信息仅可修改核心评委、团队评委、评审备注、抄送人员
                 </span>
               ) : isManuscriptUpdate ? (
                 <span className={styles.itemHint}>
                   更新评审稿只替换评审稿件，评审信息与人员保持不变
                 </span>
               ) : null}
             </div>
           </div>
         </div>

         {/* ── 第一组：评审类型 / 项目 / 评审名称 / 预计结束日期 / 评审备注 ── */}
          <div className={styles.group}>
            {isUpdate ? (
              <>
                {/* 更新模式：评审类型（项目/部门）与项目名称只读，提交时原样保留。 */}
                <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    评审类型 <span className={styles.req}>*</span>
                  </label>
                  <div className={styles.itemControl}>
                    <div className={styles.radioRow}>
                      <label className={styles.radio}>
                        <input
                          type="radio"
                          name="review-model-readonly"
                          checked={effectiveReviewModel === 1}
                          disabled
                          readOnly
                        />
                        项目评审
                      </label>
                      <label className={styles.radio}>
                        <input
                          type="radio"
                          name="review-model-readonly"
                          checked={effectiveReviewModel === 2}
                          disabled
                          readOnly
                        />
                        部门评审
                      </label>
                    </div>
                  </div>
                </div>
                {effectiveReviewModel === 1 ? (
                  <div className={styles.item}>
                    <label className={styles.itemLabel}>
                      项目名称 <span className={styles.req}>*</span>
                    </label>
                    <div className={styles.itemControl}>
                      <input
                        className={styles.input}
                        value={existingProjectLabel}
                        placeholder="（未获取到项目信息）"
                        disabled
                        readOnly
                      />
                    </div>
                  </div>
                ) : null}
                <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    评审名称 <span className={styles.req}>*</span>
                  </label>
                  <div className={styles.itemControl}>
                    <div className={styles.inlineRow}>
                      <input
                        className={styles.input}
                        value={deptReviewName}
                        disabled
                        readOnly
                      />
                      {/* 只读展示已有评审的子类型（交互/视觉/…），与新建布局一致。 */}
                      <select
                        className={`${styles.select} ${styles.subtypeInline}`}
                        value={effectiveSubtype}
                        disabled
                        aria-label="评审子类型"
                      >
                        <option value={effectiveSubtype}>{subtypeLabelOf(effectiveSubtype)}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            ) : (
            <>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审类型 <span className={styles.req}>*</span>
              </label>
              <div className={styles.itemControl}>
                <div className={styles.radioRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    checked={reviewModel === 1}
                    onChange={() => switchModel(1)}
                  />
                  项目评审
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    checked={reviewModel === 2}
                    onChange={() => switchModel(2)}
                  />
                  部门评审
                </label>
                </div>
              </div>
            </div>

            {reviewModel === 1 ? (
              <>
               <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    项目名称 <span className={styles.req}>*</span>
                  </label>
                  <div className={styles.itemControl}>
                    <ProjectPicker
                      value={project}
                      onChange={(p) => {
                        setProject(p);
                        clearFieldError('project');
                        setSelectedTemplate(null);
                        setReviewTemplates([]);
                        if (p?.projNum) void loadReviewTemplates(p.projNum);
                      }}
                    />
                    <span className={styles.itemError}>{fieldErrors.project || ''}</span>
                  </div>
                </div>
                <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    评审名称 <span className={styles.req}>*</span>
                  </label>
                  <div className={styles.itemControl}>
                    <div className={styles.inlineRow}>
                      <select
                        className={styles.select}
                        value={selectedTemplate ? JSON.stringify(selectedTemplate) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelectedTemplate(v ? JSON.parse(v) : null);
                          clearFieldError('reviewName');
                        }}
                        disabled={!reviewTemplates.length}
                      >
                        {!reviewTemplates.length ? (
                          <option value="">{project ? '无可用评审名称' : '请先选择项目'}</option>
                        ) : (
                          <>
                            <option value="">请选择评审名称</option>
                            {reviewTemplates.map((t, i) => (
                              <option key={i} value={JSON.stringify(t)}>
                                {t.reviewname_cn ?? t.reviewname ?? `模板 ${i + 1}`}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                      <select
                        className={`${styles.select} ${styles.subtypeInline}`}
                        value={subtype}
                        onChange={(e) => {
                          switchSubtype(e.target.value);
                          clearFieldError('upload');
                        }}
                      >
                        {REVIEW_SUBTYPES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className={styles.itemError}>{fieldErrors.reviewName || ''}</span>
                  </div>
                </div>
             </>
           ) : (
             <div className={styles.item}>
                <label className={styles.itemLabel}>
                  评审名称 <span className={styles.req}>*</span>
                </label>
                <div className={styles.itemControl}>
                  <div className={styles.inlineRow}>
                    <input
                      className={styles.input}
                      placeholder="请输入评审名称"
                      value={deptReviewName}
                      onChange={(e) => {
                        setDeptReviewName(e.target.value);
                        clearFieldError('reviewName');
                      }}
                      maxLength={32}
                    />
                    <select
                      className={`${styles.select} ${styles.subtypeInline}`}
                      value={subtype}
                      onChange={(e) => {
                        switchSubtype(e.target.value);
                        clearFieldError('upload');
                      }}
                    >
                      {REVIEW_SUBTYPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className={styles.itemError}>{fieldErrors.reviewName || ''}</span>
                </div>
              </div>
           )}
            </>
            )}

           <div className={styles.item}>
             <label className={styles.itemLabel}>
               预计结束日期 <span className={styles.req}>*</span>
             </label>
             <div className={styles.itemControl}>
                {isUpdate ? (
                  <input
                    className={styles.input}
                    value={endtime ? endtime.replace('T', ' ') : ''}
                    disabled
                    readOnly
                  />
                ) : (
                  <DateTimePicker
                    value={endtime}
                    onChange={(v) => {
                      setEndtime(v);
                      clearFieldError('endtime');
                    }}
                    placeholder="请选择预计结束时间"
                  />
                )}
                <span className={styles.itemError}>{fieldErrors.endtime || ''}</span>
              </div>
            </div>

           <div className={styles.item}>
             <label className={styles.itemLabel}>评审备注</label>
              <div className={styles.itemControl}>
                <textarea
                  className={styles.textarea}
                  placeholder="请输入备注"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
            </div>
          </div>

        {/* ── 第二组：评审子类型 / 评审稿 / 人员 ── */}
        <div className={styles.groupDivider} />
        <div className={styles.group}>
           <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审组长 <span className={styles.req}>*</span>
              </label>
              <div className={styles.itemControl}>
                {isUpdate ? (
                  <input
                    className={styles.input}
                    value={mainjudge.map((p) => p.name).join('、')}
                    disabled
                    readOnly
                  />
                ) : (
                  <PersonPicker
                    selected={mainjudge}
                    onChange={(p) => {
                      setMainjudge(p);
                      clearFieldError('mainjudge');
                    }}
                    placeholder="请输入名称（评审组长）"
                    multiple={false}
                  />
                )}
                <span className={styles.itemError}>{fieldErrors.mainjudge || ''}</span>
              </div>
            </div>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                作者 <span className={styles.req}>*</span>
              </label>
              <div className={styles.itemControl}>
                {isUpdate ? (
                  <input
                    className={styles.input}
                    value={author.map((p) => p.name).join('、')}
                    disabled
                    readOnly
                  />
                ) : (
                  <PersonPicker
                    selected={author}
                    onChange={(p) => {
                      setAuthor(p);
                      clearFieldError('author');
                    }}
                 placeholder="请输入名称（作者）"
                 multiple
               />
                )}
               <span className={styles.itemError}>{fieldErrors.author || ''}</span>
              </div>
            </div>
            {/* 更新评审稿只改稿件，人员/抄送区域整体隐藏。 */}
            {!isManuscriptUpdate ? (
              <>
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
              </>
            ) : null}
           {/* 更新评审信息提交 reviewEdit、不动稿件：隐藏整个稿件上传区域。
               更新评审稿时该区域仍显示，走 reUploadManuscript + reUploadConfirm。 */}
           {mode !== 'update-info' ? (
           <div className={styles.item}>
             <label className={styles.itemLabel}>
               评审稿 <span className={styles.req}>*</span>
             </label>
              <div className={styles.itemControl}>
                <div className={styles.uploadArea}>
                  {/* 评审稿来源切换：来自当前项目 / 上传 */}
                  <div className={styles.sourceToggle}>
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
                  </div>
                  {manuscriptSource === 'project' ? (
                    <div className={styles.uploadFileRow}>
                      <span className={styles.uploadFileName}>{projectZipName}</span>
                      {exporting ? <span className={styles.acSpinner} /> : null}
                    </div>
                    ) : (
                   <UploadArea
                     subtype={effectiveSubtype}
                     uploading={uploading}
                     uploadInfo={isManuscriptUpdate ? reUploadInfo : uploadInfo}
                     onPick={isManuscriptUpdate ? handleReUpload : handleUpload}
                     onRemove={() =>
                       isManuscriptUpdate ? setReUploadInfo(null) : setUploadInfo(null)
                     }
                   />
                  )}
                </div>
                <span className={styles.itemError}>{fieldErrors.upload || ''}</span>
              </div>
           </div>
           ) : null}
             {mode === 'create' && subtype === HTML_REVIEW_TYPE ? (
               <div className={styles.item}>
                 <label className={styles.itemLabel}>评审稿类型</label>
                 <div className={styles.itemControl}>
                   <div className={styles.radioRow}>
                     <label className={styles.radio}>
                       <input type="radio" name="html-review-carrier" checked={carrierType === 'web'}
                         onChange={() => { setCarrierType('web'); setUploadInfo(null); clearFieldError('upload'); }}
                       />
                       Web
                     </label>
                     <label className={styles.radio}>
                       <input type="radio" name="html-review-carrier" checked={carrierType === 'h5'}
                         onChange={() => { setCarrierType('h5'); setUploadInfo(null); clearFieldError('upload'); }}
                       />
                       H5
                     </label>
                   </div>
                   {carrierType === 'h5' ? (
                     <select aria-label="H5尺寸" className={styles.select} value={h5Size}
                       onChange={(e) => { setH5Size(e.target.value); setUploadInfo(null); clearFieldError('upload'); }}
                     >
                       {HTML_REVIEW_H5_SIZES.map((size) => (
                         <option key={size.value} value={size.value}>{size.label}</option>
                       ))}
                     </select>
                   ) : null}
                 </div>
               </div>
             ) : null}
            {/* 抄送人员：新建 / 更新评审信息可改；更新评审稿不动人员。 */}
            {!isManuscriptUpdate ? (
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
            ) : null}
          </div>
        </div>

        <div className={styles.foot}>
          <span className={`${styles.footMsg} ${error ? styles.footMsgErr : ''}`}>
            {error || ''}
          </span>
          <div className={styles.footActions}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void handleSubmit()}
              disabled={submitting || uploading}
            >
              {exporting ? '生成评审稿中…' : submitting ? '提交中…' : '确定'}
            </button>
         </div>
      </div>
        {(submitting || exporting || probing) && (
          <div className={styles.loadingOverlay}>
            <span className={styles.loadingSpinner} />
            <span className={styles.loadingText}>
              {exporting
                ? '生成评审稿中…'
                : submitting
                  ? '提交中…'
                  : '正在校验评审单…'}
            </span>
          </div>
        )}
      </div>
   </div>,
  document.body,
 );
}

/**
 * 项目选择器：输入框 + 防抖查 /api/hik/uedro/projectList，选中后回填项目对象。
 *
 * 对齐原站 el-autocomplete：聚焦即查（空关键字取默认列表），change 后防抖重查，
 * props.value=projShow（"（projNum）projName" 展示串），选中后取回 projNum/projName/projManager。
 */
function ProjectPicker({
  value,
  onChange,
}: {
  value: Project | null;
  onChange: (p: Project | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  // 输入框是否聚焦：聚焦后即使关键字为空也查询默认项目列表。
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    aliveRef.current = true;
    // 聚焦后（含空关键字）或有关键字时才查询；输入 change 后随 debounced 重查。
    if (!focused && !debounced) {
      setResults([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetch('/api/hik/uedro/projectList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projNumOrName: debounced, processType: 1, pageNo: 1, pageSize: 10 }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        const list: Project[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        setResults(list);
        setActiveIdx(0);
        setOpen(true);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setResults([]);
      })
      .finally(() => {
        if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [debounced, focused]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function projShow(p: Project): string {
    return `（${p.projNum}）${p.projName}`;
  }

  function pick(p: Project) {
    onChange(p);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const display = value ? projShow(value) : query;

  return (
    <div className={styles.acWrap} ref={wrapRef}>
      <input
        className={styles.acInput}
        placeholder="请输入项目名称"
        value={display}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => {
          setFocused(true);
          if (results.length) setOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const p = results[activeIdx];
            if (p) pick(p);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {loading ? <span className={styles.acSpinner} /> : null}
      {open && (debounced || focused) ? (
        <div className={styles.acDropdown}>
          {!results.length ? (
            <div className={styles.acEmpty}>无匹配项目</div>
          ) : (
            results.map((p, i) => (
              <button
                key={p.projNum ?? i}
                type="button"
                className={`${styles.acItem} ${i === activeIdx ? styles.acItemActive : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                // mousedown 触发早于 input 的 blur（preventDefault 阻止失焦），
                // 避免 blur 清空 results 后 click 选不中。
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <span className={styles.acItemName}>{projShow(p)}</span>
                {p.projManager ? (
                  <span className={styles.acItemSub}>项目经理：{p.projManager}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 评审稿上传区：拖拽 / 点击选文件，上传中显 spinner，成功后显文件名 + 替换。 */
function UploadArea({
  subtype,
  uploading,
 uploadInfo,
 onPick,
 onRemove,
}: {
  subtype: string;
  uploading: boolean;
  /** 新建走 uploadInfo，更新评审稿走 reUploadInfo，两者只需 manuscriptId / fileName。 */
  uploadInfo: { manuscriptId?: string; fileName?: string } | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hint = SUBTYPE_UPLOAD_HINT[subtype] ?? '请上传评审稿';

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    onPick(f);
  }

 if (uploadInfo?.manuscriptId && !uploading) {
   const name = uploadInfo.fileName || uploadInfo.manuscriptId;
   return (
      <div className={styles.uploadFileRow}>
        <span className={styles.uploadFileName}>{name}</span>
        <button
          type="button"
          className={styles.uploadReplace}
          onClick={() => inputRef.current?.click()}
        >
         替换
       </button>
       <button
         type="button"
         className={styles.uploadReplace}
         onClick={onRemove}
       >
         删除
       </button>
       <input
          ref={inputRef}
          type="file"
           accept={subtype === HTML_REVIEW_TYPE ? '.zip' : undefined}
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
           accept={subtype === HTML_REVIEW_TYPE ? '.zip' : undefined}
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}

/**
 * 自定义日期时间选择器：日历面板 + 时分下拉，替代原生 datetime-local。
 *
 * 值格式与原生 datetime-local 一致（`YYYY-MM-DDTHH:mm`），所以 endtime
 * 状态、endtimeForSubmit 转换、提交体都不用改。
 *
 * 约束：只能选今天及以后的日期。今天之前的日期在面板里置灰禁用；
 * 月份导航在"上个月会早于本月"时禁用上翻按钮。
 */
function DateTimePicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 面板展示的年月（默认从当前 value 或今天开始）。
  const initial = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth()); // 0-11
  // 临时选中的日期 + 时分，确定后才回写。
  const [pickDate, setPickDate] = useState<Date | null>(value ? new Date(value) : null);
  const [pickHour, setPickHour] = useState(value ? new Date(value).getHours() : 23);
  const [pickMin, setPickMin] = useState(value ? new Date(value).getMinutes() : 59);

  // 打开时同步临时状态到当前 value。
  useEffect(() => {
    if (!open) return;
    const d = value ? new Date(value) : null;
    if (d) {
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setPickDate(d);
      setPickHour(d.getHours());
      setPickMin(d.getMinutes());
    } else {
      const now = new Date();
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
      setPickDate(null);
      setPickHour(23);
      setPickMin(59);
    }
  }, [open, value]);

  // 点外部收起。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // 今天 00:00 作为"最早可选"基准。
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pad = (n: number) => String(n).padStart(2, '0');
  function fmt(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 月份网格：返回 42 格（6 行 × 7 列），含上月末几天 + 本月 + 下月初几天。
  function buildDays(): Date[] {
    const first = new Date(viewYear, viewMonth, 1);
    const startDay = first.getDay(); // 0=周日
    const gridStart = new Date(viewYear, viewMonth, 1 - startDay);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    return days;
  }

  const days = buildDays();
  const monthLabel = `${viewYear} 年 ${viewMonth + 1} 月`;

  // 上翻是否禁用：若上个月的最后一天 < 今天，则不允许翻到上个月。
  const prevDisabled = new Date(viewYear, viewMonth, 0) < todayStart;

  function prevMonth() {
    if (prevDisabled) return;
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }
  function nextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function isSameDay(a: Date | null, b: Date) {
    if (!a) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function selectDay(d: Date) {
    // 保留已选时分；若未选过分则用 23:59。
    const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), pickHour, pickMin);
    setPickDate(nd);
  }

  function confirm() {
    if (!pickDate) return;
    const d = new Date(pickDate.getFullYear(), pickDate.getMonth(), pickDate.getDate(), pickHour, pickMin);
    onChange(fmt(d));
    setOpen(false);
  }

  // 触发器展示文本。
  const displayText = value ? (() => {
    const d = new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })() : '';

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className={styles.dtpWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.dtpTrigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.dtpTriggerIcon}>
          {/* 日历图标 */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6h12M5 1.5v3M11 1.5v3" />
          </svg>
        </span>
        <span className={`${styles.dtpTriggerText} ${!displayText ? styles.dtpTriggerPlaceholder : ''}`}>
          {displayText || placeholder || '请选择日期时间'}
        </span>
        {value ? (
          <span
            className={styles.dtpTriggerClear}
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setPickDate(null);
            }}
          >
            ✕
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.dtpPanel}>
          <div className={styles.dtpHead}>
            <button
              type="button"
              className={styles.dtpNavBtn}
              onClick={prevMonth}
              disabled={prevDisabled}
              aria-label="上个月"
            >
              ‹
            </button>
            <span className={styles.dtpHeadLabel}>{monthLabel}</span>
            <button
              type="button"
              className={styles.dtpNavBtn}
              onClick={nextMonth}
              aria-label="下个月"
            >
              ›
            </button>
          </div>
          <div className={styles.dtpWeekdays}>
          {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
            <span key={w} className={styles.dtpWeekday}>{w}</span>
          ))}
          </div>
          <div className={styles.dtpDays}>
          {days.map((d, i) => {
            const isOther = d.getMonth() !== viewMonth;
            const before = d < todayStart;
            const isToday = isSameDay(todayStart, d);
            const selected = isSameDay(pickDate, d);
            const cls = [
              styles.dtpDay,
              isOther ? styles.dtpDayOther : '',
              isToday ? styles.dtpToday : '',
              selected ? styles.dtpSelected : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={i}
                type="button"
                className={cls}
                disabled={before}
                onClick={() => selectDay(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
          </div>
          <div className={styles.dtpTime}>
            <span className={styles.dtpTimeLabel}>时间</span>
            <select
              className={styles.dtpTimeSelect}
              value={pickHour}
              onChange={(e) => setPickHour(Number(e.target.value))}
            >
              {hours.map((h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className={styles.dtpColon}>:</span>
            <select
              className={styles.dtpTimeSelect}
              value={pickMin}
              onChange={(e) => setPickMin(Number(e.target.value))}
            >
              {mins.map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
          </div>
          <div className={styles.dtpFoot}>
            <button
              type="button"
              className={styles.dtpFootBtn}
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={`${styles.dtpFootBtn} ${styles.dtpFootBtnPrimary}`}
              onClick={confirm}
              disabled={!pickDate}
            >
              确定
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
