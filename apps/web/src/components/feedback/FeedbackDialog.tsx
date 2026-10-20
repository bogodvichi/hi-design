import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TinyMCEEditor } from './TinyMCEEditor';
import { Button, Dialog, DialogFooter } from '@open-design/components';
import { Icon } from '../Icon';
import { FeedbackTypeSelect } from './FeedbackTypeSelect';
import styles from './FeedbackDialog.module.css';

/**
 * 反馈类别树节点（海客 `/demand-class` 上游返回结构）。
 * 虚拟根节点 id 通常是 `-1` / `-2`，需要在前端过滤掉。
 */
interface DemandClassNode {
  id?: string | number;
  text?: string;
  name?: string;
  classCount?: number;
  children?: DemandClassNode[];
}

interface FeedbackSession {
  userInfo: Record<string, unknown>;
  feedbackProjectId: string;
  feedbackParentId: string;
}

const FEEDBACK_GUIDE_HTML = [
  '<p style="font-size: 14px;"><strong>1. 当前存在的问题</strong><span style="opacity: 0.5;">（请描述具体问题、复现步骤及影响，尽可能附上相关截图）</span></p>',
  '<p><br></p>',
  '<p style="font-size: 14px;"><strong>2. 期望的解决方案</strong><span style="opacity: 0.5;">（请描述期望效果，如有参考案例，也可以一并提供）</span></p>',
  '<p><br></p>',
].join('');

const DEFAULT_DEMAND_CLASS_NAME = '平台体验';
const OTHER_DEMAND_CLASS_VALUE = '__other__';

/** 从海客分类树里挑一个可读名称（上游字段名不稳定，text / name 都见过）。 */
function pickDisplayName(node: DemandClassNode | undefined): string {
  if (!node) return '';
  return node.text || node.name || String(node.id ?? '');
}

/** 从 session.userInfo 里挑出当前用户显示名。 */
function pickUserDisplayName(userInfo: Record<string, unknown>): string {
  const candidates = ['displayName', 'name', 'userName', 'loginName', 'account'];
  for (const key of candidates) {
    const value = userInfo[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * 从上游返回的 data 里提取分类树数组。
 * 上游结构不稳定——data 可能是数组、带 children 的根节点、
 * 带 list/nodes/demandClassList 的包装对象、或单个根节点。
 * 这里把所有常见形状都归一成一个节点数组。
 */
function extractClassTree(data: unknown): DemandClassNode[] {
  if (Array.isArray(data)) return data as DemandClassNode[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.children)) return obj.children as DemandClassNode[];
    if (Array.isArray(obj.list)) return obj.list as DemandClassNode[];
    if (Array.isArray(obj.nodes)) return obj.nodes as DemandClassNode[];
    if (Array.isArray(obj.demandClassList)) return obj.demandClassList as DemandClassNode[];
    // 单个根节点对象
    if (obj.id !== undefined || obj.text !== undefined || obj.name !== undefined) {
      return [obj as DemandClassNode];
    }
  }
  return [];
}

/** 拍平分类树，跳过虚拟根节点（id 为 `-1` / `-2`）。 */
function flattenClassTree(nodes: DemandClassNode[] | undefined): DemandClassNode[] {
  const result: DemandClassNode[] = [];
  const walk = (list: DemandClassNode[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      const id = typeof node.id === 'number' ? String(node.id) : node.id;
      if (id && id !== '-1' && id !== '-2') {
        result.push(node);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

type SubmitState = 'idle' | 'submitting' | 'error';

/**
 * 反馈对话框。挂在 Home 视图右下角的 FAB 之后弹出。
 *
 * 通过 `createPortal` 渲染到 `document.body` 下，避免被父容器的
 * overflow / transform / z-index 裁剪。顶部 banner 大图作为标题区，
 * 下方表单包含反馈类型（来自海客 `/demand-class` 接口的分类树）
 * + 标题 + 带默认填写指引的富文本编辑器。
 *
 * 提交时调用 `/api/hik/hikke/demand` 创建一条需求，以当前 SSO 用户
 * 作为创建人（hikkeToken 鉴权在 daemon 侧解析为创建人）。
 */
export function FeedbackDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [classes, setClasses] = useState<DemandClassNode[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // TinyMCE 编辑器实例引用。`editorContentRef` 缓存当前 HTML，提交时直接取。
  const editorRef = useRef<any>(null);
  const editorContentRef = useRef('');
  const initialEditorContentRef = useRef('');
  const [editorEmpty, setEditorEmpty] = useState(true);

  // Portal 目标设为 document.body，确保对话框脱离 home-view 容器。
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // 拉取海客 session：判断是否登录 + 取反馈落点 projectId / parentId。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/hik/hikke/session', { credentials: 'same-origin' });
        if (!res.ok) {
          if (!cancelled) setSessionError('未登录海客，请先在设置中完成海客登录');
          return;
        }
        const json = await res.json();
        if (!cancelled) setSession(json?.data ?? null);
      } catch (err) {
        if (!cancelled) setSessionError('读取海客会话失败：' + (err instanceof Error ? err.message : String(err)));
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // session 就绪后拉取反馈项目下的分类树。
  useEffect(() => {
    if (!session?.feedbackProjectId) return;
    let cancelled = false;
    setClassesLoading(true);
    setClassesError(null);
    void (async () => {
      try {
        const url = `/api/hik/hikke/demand-class?projectId=${encodeURIComponent(session.feedbackProjectId)}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const json = await res.json();
        if (cancelled) return;
        if (!json?.ok) {
          setClassesLoading(false);
          setClassesError(json?.msg || '加载反馈类别失败');
          setSelectedClassId(OTHER_DEMAND_CLASS_VALUE);
          return;
        }
        const tree = extractClassTree(json?.data);
        const nextClasses = flattenClassTree(tree);
        setClasses(nextClasses);
        setSelectedClassId((current) => {
          if (current) return current;
          const defaultClass = nextClasses.find(
            (node) => pickDisplayName(node).trim() === DEFAULT_DEMAND_CLASS_NAME,
          );
          const defaultClassId = typeof defaultClass?.id === 'number'
            ? String(defaultClass.id)
            : defaultClass?.id;
          return defaultClassId || OTHER_DEMAND_CLASS_VALUE;
        });
        setClassesLoading(false);
      } catch (err) {
        if (cancelled) return;
        setClassesLoading(false);
        setClassesError('加载反馈类别失败：' + (err instanceof Error ? err.message : String(err)));
        setSelectedClassId(OTHER_DEMAND_CLASS_VALUE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.feedbackProjectId]);

  // TinyMCE 内容变化时同步缓存 + 空状态。
  const handleEditorChange = (content: string) => {
    editorContentRef.current = content;
    const empty = !editorRef.current?.getContent()?.trim();
    setEditorEmpty(empty);
    if (!empty && contentError) setContentError(null);
  };

  const handleSubmit = async () => {
    setTitleError(null);
    setContentError(null);
    if (!session) {
      setSubmitError('未登录海客，无法提交');
      setSubmitState('error');
      return;
    }
    if (!session.feedbackProjectId) {
      setSubmitError('未配置反馈项目，请联系管理员设置 HIKKE_FEEDBACK_PROJECT_ID');
      setSubmitState('error');
      return;
    }
    if (!title.trim()) {
      setTitleError('请填写反馈标题');
      setSubmitState('error');
      return;
    }
    const description = (editorContentRef.current || '').trim();
    if (!description || description === initialEditorContentRef.current) {
      setContentError('请填写反馈内容');
      setSubmitState('error');
      return;
    }
    const text = title.trim();
    setSubmitState('submitting');
    setSubmitError(null);
    try {
      const res = await fetch('/api/hik/hikke/demand', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          description,
          projectId: session.feedbackProjectId,
          parentId: session.feedbackParentId || '',
          demandClassId: selectedClassId === OTHER_DEMAND_CLASS_VALUE ? '' : selectedClassId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.msg || `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setSubmitError('提交反馈失败：' + (err instanceof Error ? err.message : String(err)));
      setSubmitState('error');
    }
  };

  const creatorName = session ? pickUserDisplayName(session.userInfo) : '';
  // 反馈类别加载中或未登录时，提交按钮不可用。
  const submitDisabled = submitState === 'submitting' || !session || classesLoading;
  const typeLoading = sessionLoading || classesLoading || Boolean(
    session?.feedbackProjectId && !classesError && !selectedClassId && classes.length === 0,
  );
  const typeOptions = [
    ...classes.flatMap((node) => {
      const id = typeof node.id === 'number' ? String(node.id) : node.id || '';
      const label = pickDisplayName(node).trim();
      return id && label ? [{ value: id, label }] : [];
    }),
    { value: OTHER_DEMAND_CLASS_VALUE, label: '其它' },
  ];

  if (!portalTarget) return null;

  return createPortal(
    <Dialog
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName={styles.backdrop}
      className={styles.dialog}
      includeChromeClassName={false}
      ariaLabel="反馈"
    >
      <div className={styles.banner}>
        <div className={styles.bannerOverlay} />
        <div className={styles.bannerContent}>
          <div className={styles.bannerTitle}>反馈意见</div>
          <div className={styles.bannerSubtitle}>告诉我们你遇到了什么问题，或希望看到什么改进</div>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="close" size={16} aria-hidden />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.formContent}>
          {sessionError ? (
            <div className={styles.fieldError}>{sessionError}</div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedback-class">反馈类型</label>
            <FeedbackTypeSelect
              id="feedback-class"
              value={selectedClassId}
              options={typeOptions}
              loading={typeLoading}
              disabled={!session}
              onChange={setSelectedClassId}
            />
            <div className={styles.fieldErrorSlot}>
              {classesError ? <span className={styles.fieldError}>{classesError}</span> : null}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedback-title">
              反馈标题<span className={styles.required} aria-hidden>*</span>
            </label>
            <input
              id="feedback-title"
              type="text"
              className={styles.input}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="请输入反馈标题"
              maxLength={120}
            />
            <div className={styles.fieldErrorSlot}>
              {titleError ? <span className={styles.fieldError}>{titleError}</span> : null}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feedback-content">
              反馈内容<span className={styles.required} aria-hidden>*</span>
            </label>
            <div className={styles.editorWrap} data-empty={editorEmpty ? 'true' : 'false'}>
              <TinyMCEEditor
                onInit={(editor) => {
                  editorRef.current = editor;
                  editor.setContent(FEEDBACK_GUIDE_HTML);
                  initialEditorContentRef.current = editor.getContent().trim();
                }}
                onEditorChange={handleEditorChange}
                init={{
                  language: 'zh_CN',
                  language_url: '/tinymce/zh_CN.js',
                  skin_url: '/tinymce/skins/ui/oxide',
                  content_css: '/tinymce/skins/content/default/content.min.css',
                  content_style: 'body { font-size: 14px; }',
                  body_id: 'tinymce_body_id',
                  min_height: 240,
                  max_height: 240,
                  resize: false,
                  menubar: false,
                  branding: false,
                  statusbar: false,
                  elementpath: false,
                  toolbar_mode: 'sliding',
                  // 不让 TinyMCE 把 images_upload_handler 返回的相对路径
                  // `/api/hik/hikke/download?…` 转成 `http://127.0.0.1:PORT/…`
                  // 绝对路径，提交时 daemon 的 rewriteImageUrls 直接匹配相对路径。
                  convert_urls: false,
                  browser_spellcheck: true,
                  paste_data_images: true,
                  // TinyMCE 5 有 textcolor 插件，forecolor/backcolor 需要它。
                  plugins: 'advlist anchor autolink charmap codesample directionality emoticons fullscreen help hr image importcss insertdatetime link lists media pagebreak paste preview quickbars searchreplace table textcolor textpattern wordcount',
                  toolbar: 'undo redo | fontselect fontsizeselect | bold italic underline strikethrough forecolor backcolor | alignleft aligncenter alignright outdent indent bullist numlist link media image table emoticons fullscreen',
                  fontsize_formats: '14px 16px 18px 20px 24px 26px 28px 30px 32px 36px',
                  font_formats: '微软雅黑=Microsoft YaHei,Helvetica Neue,PingFang SC,sans-serif;苹果苹方=PingFang SC,Microsoft YaHei,sans-serif;宋体=simsun,serif;Terminal=terminal,monaco;Times New Roman=times new roman,times',
                  default_link_target: '_blank',
                  quickbars_selection_toolbar: 'bold italic | link h2 h3 blockquote',
                  // 禁用空行插入浮层（按 Enter 时弹出的"插入图片/表格"快捷条），
                  // 只保留选中文本时的 quickbar。
                  quickbars_insert_toolbar: false,
                  file_picker_types: 'file image media',
                  pagebreak_split_block: true,
                  // 图片对话框里显示"上传"tab，让用户直接选本地文件上传。
                  image_uploadtab: true,
                  // TinyMCE 5 的 images_upload_handler 用回调风格（success/failure）
                  // 比 promise 风格更可靠——promise 风格 reject Error 对象时会静默失败。
                  images_upload_handler: (blobInfo: any, success: (url: string) => void, failure: (err: string) => void) => {
                    const formData = new FormData();
                    formData.append('file', blobInfo.blob(), blobInfo.filename() || 'image.png');
                    fetch('/api/hik/hikke/upload', {
                      method: 'POST',
                      body: formData,
                      credentials: 'same-origin',
                    })
                      .then((res) => res.json())
                      .then((json) => {
                        if (!json?.ok) {
                          failure(json?.msg || '上传失败');
                          return;
                        }
                        // daemon 上游返回的 url 是海客相对路径
                        // `/hikkeapi/download?bizNo=…&flag=…`，浏览器从 daemon 源请求不到。
                        // 改写成 daemon 下载代理 URL `/api/hik/hikke/download?…`，浏览器
                        // 通过 daemon 透传海客下载接口（带 daemon 鉴权 cookie）。提交时
                        // daemon 的 rewriteImageUrls 会把代理 URL 还原成海客原始绝对 URL。
                        const url = String(json.data.url).replace(/^\/hikkeapi\//, '/api/hik/hikke/');
                        success(url);
                      })
                      .catch((err: unknown) => {
                        failure(err instanceof Error ? err.message : String(err));
                      });
                  },
                }}
              />
            </div>
            <div className={styles.fieldErrorSlot}>
              {contentError ? <span className={styles.fieldError}>{contentError}</span> : null}
            </div>
          </div>

          {/* {creatorName ? (
            <div className={styles.creator}>创建人：{creatorName}</div>
          ) : null} */}

          {submitError ? (
            <div className={styles.fieldError}>{submitError}</div>
          ) : null}
        </div>

        <DialogFooter className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={submitState === 'submitting'}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {submitState === 'submitting' ? '提交中…' : '提交'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>,
    portalTarget,
  );
}
