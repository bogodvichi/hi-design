import { useEffect, useRef } from 'react';

interface TinyMCEEditorProps {
  /** TinyMCE init 配置（target / selector 由组件内部注入，不要在外部设置）。 */
  init?: Record<string, any>;
  /** 编辑器初始化完成后回调，参数为 editor 实例。 */
  onInit?: (editor: any) => void;
  /** 编辑器内容变化时回调，参数为当前 HTML。 */
  onEditorChange?: (content: string) => void;
}

/**
 * 动态加载 self-host 的 TinyMCE 脚本（/tinymce/tinymce.min.js）。
 *
 * 不用 `@tinymce/tinymce-react` wrapper——该 wrapper 6.x 内置了许可证在线验证，
 * 无论 TinyMCE 核心版本如何都会联系 Tiny Cloud 验证服务器，self-host 内网
 * 环境验证不通就把编辑器禁用。这里直接用 TinyMCE 5 原生 `tinymce.init()` API，
 * 没有中间层，不会有许可证检查。
 *
 * 脚本只加载一次，多个编辑器实例共享同一个 `window.tinymce`。
 */
let tinymcePromise: Promise<any> | null = null;
function loadTinyMCE(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('TinyMCE only runs in browser'));
  const w = window as any;
  if (w.tinymce) return Promise.resolve(w.tinymce);
  if (tinymcePromise) return tinymcePromise;
  tinymcePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/tinymce/tinymce.min.js';
    script.async = true;
    script.onload = () => {
      if (w.tinymce) resolve(w.tinymce);
      else reject(new Error('TinyMCE script loaded but window.tinymce is missing'));
    };
    script.onerror = () => reject(new Error('Failed to load /tinymce/tinymce.min.js'));
    document.head.appendChild(script);
  });
  return tinymcePromise;
}

/**
 * TinyMCE 5 的轻量 React 封装。
 *
 * - 挂载时 `tinymce.init({ target, ...init })`，编辑器替换 target 元素
 * - 卸载时 `tinymce.remove(editor)` 清理实例
 * - `onInit` / `onEditorChange` 用 ref 缓存最新值，避免 stale closure
 * - init 配置只在挂载时读一次，后续变化不会重新初始化（与 TinyMCE 生命周期一致）
 */
export function TinyMCEEditor({ init, onInit, onEditorChange }: TinyMCEEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const onInitRef = useRef(onInit);
  const onEditorChangeRef = useRef(onEditorChange);
  const initRef = useRef(init);

  onInitRef.current = onInit;
  onEditorChangeRef.current = onEditorChange;
  initRef.current = init;

  useEffect(() => {
    let destroyed = false;
    loadTinyMCE().then((tinymce) => {
      if (destroyed || !containerRef.current) return;
      tinymce.init({
        target: containerRef.current,
        ...initRef.current,
        setup: (editor: any) => {
          editorRef.current = editor;
          editor.on('init', () => {
            onInitRef.current?.(editor);
          });
          editor.on('input change keyup SetContent', () => {
            onEditorChangeRef.current?.(editor.getContent());
          });
        },
      });
    }).catch((err) => {
      console.error('[TinyMCEEditor] init failed:', err);
    });
    return () => {
      destroyed = true;
      const tinymce = (window as any).tinymce;
      if (tinymce && editorRef.current) {
        try { tinymce.remove(editorRef.current); } catch { /* ignore */ }
      }
      editorRef.current = null;
    };
  }, []);

  return <div ref={containerRef} />;
}
