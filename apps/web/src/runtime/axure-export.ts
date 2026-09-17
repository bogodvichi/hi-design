// 工具脚本：把当前项目的 HTML 文件打包成标准 Axure RP HTML 交互稿压缩包。
// 1. fetchProjectFiles 拉文件列表；2. HTML 文件按目录结构生成页面树导航；
// 3. 为每个 HTML 页面生成标准 Axure 页面结构：
//    - 根目录 <pageName>.html：Axure 页面壳，加载运行时 + document.js + per-page data.js；
//    - files/<pageName>/data.js：调用 $axure.loadCurrentPage 注入页面元数据（pageName、notes 等），
//      使 Axure player 能追踪页面切换并维护 annotation 状态；
//    - files/<pageName>/styles.css：页面样式占位。
// 4. 工程非 HTML 文件按原始目录结构放入 images/<pageName>/，保证相对路径引用可解析；
// 5. fetch 拉取 /axure-prototype 骨架资源（含 Axure RP 运行时），
//    以 data/document.js 为模板注入生成的站点地图；
// 6. buildZip 生成 Blob，triggerDownload 下载。

import { buildZip, type ZipEntry } from './zip';
import { fetchProjectFiles, fetchProjectFileText, fetchProjectFileBase64 } from '../providers/registry';
import type { ProjectFile } from '../types';
import { triggerDownload } from './exports';
// 构建时生成的骨架文件清单（相对 axure-prototype/ 的路径列表）。
import skeletonManifest from '../../public/axure-prototype/skeleton-manifest.json';

interface AxurePageNode {
  id: string;
  pageName: string;
  type: string;
  url: string;
  children?: AxurePageNode[];
}

export interface AxureExportOptions {
  projectId: string;
  title?: string;
  projectName?: string;
  onProgress?: (done: number, total: number) => void;
  returnBlob?: boolean;
}

export type AxureExportResult =
  | { ok: true; pageCount: number; blob?: Blob; zipName?: string }
  | { ok: false; error: string };

const HTML_FILE_EXTS = /\.html?$/i;
const TEXT_FILE_EXTS = /\.(html?|css|js|mjs|cjs|json|md|svg|xml|txt|csv|webmanifest|map)$/i;
// 骨架中按二进制处理的扩展名（图片、字体、光标等）。
const BINARY_FILE_EXTS = /\.(png|gif|ico|woff2?|cur|jpg|jpeg|webp|mp3|mp4|ttf|otf|eot)$/i;
const SKELETON_BASE = '/axure-prototype';

// 生成 6 位随机字母数字后缀，用于页面文件名和 ID，
// 避免与骨架保留文件名（index.html、start.html 等）冲突。
function randomSuffix(len = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 生成文件系统安全的页面 URL 文件名（不含扩展名）。
// Axure 参考包使用页面名直接作为文件名（如 视频融合-设备信息.html），
// 但为了跨平台安全，这里替换文件系统非法字符为下划线。
// 末尾追加随机后缀，避免与骨架保留文件名（index、start 等）冲突。
function pageUrlSlug(rawPath: string): string {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  const name = fileName.replace(/\.html?$/i, '');
  // 替换文件系统非法字符（Windows: <>:"/\|?*）为下划线
  return `${name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'page'}_${randomSuffix()}`;
}

function pageIdFromPath(rawPath: string, used: Set<string>): string {
  const base =
    rawPath.replace(/\.html?$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
  let id = `${base}-${randomSuffix()}`;
  while (used.has(id)) id = `${base}-${randomSuffix()}`;
  used.add(id);
  return id;
}

function pageNameFromPath(rawPath: string): string {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  const name = fileName.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
  if (!name) return rawPath;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isHtmlPage(file: ProjectFile): boolean {
  if (file.type === 'dir') return false;
  return HTML_FILE_EXTS.test(file.path || file.name);
}

interface PageInfo {
  node: AxurePageNode;
  filePath: string;
  slug: string;
  pageName: string;
}

function buildPageTree(
  htmlFiles: ProjectFile[],
  usedIds: Set<string>,
): { nodes: AxurePageNode[]; pages: PageInfo[] } {
  const pages: PageInfo[] = [];
  const slugToId = new Map<string, string>();
  type DirNode = { name: string; pages: AxurePageNode[]; dirs: Map<string, DirNode> };
  const root: DirNode = { name: '', pages: [], dirs: new Map() };
  function ensureDir(segments: string[]): DirNode {
    let current = root;
    for (const seg of segments) {
      let next = current.dirs.get(seg);
      if (!next) {
        next = { name: seg, pages: [], dirs: new Map() };
        current.dirs.set(seg, next);
      }
      current = next;
    }
    return current;
  }
  const sorted = [...htmlFiles].sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name));
  for (const file of sorted) {
    const p = file.path || file.name;
    const segments = p.split('/').filter(Boolean);
    segments.pop();
    const parent = segments.length ? ensureDir(segments) : root;
    const id = pageIdFromPath(p, usedIds);
    const slug = pageUrlSlug(p);
    const pageName = pageNameFromPath(p);
    // slug 已含随机后缀，冲突概率极低；此处为安全兜底。
    let finalSlug = slug;
    while (slugToId.has(finalSlug) && slugToId.get(finalSlug) !== id) {
      finalSlug = pageUrlSlug(p);
    }
    slugToId.set(finalSlug, id);
    // Axure 参考包中 url 是根目录下的扁平文件名（如 视频融合-设备信息.html）
    const node: AxurePageNode = { id, pageName, type: 'Wireframe', url: `${finalSlug}.html` };
    parent.pages.push(node);
    pages.push({ node, filePath: p, slug: finalSlug, pageName });
  }
  function collapse(dir: DirNode): AxurePageNode[] {
    const result: AxurePageNode[] = [];
    for (const page of dir.pages) result.push(page);
    for (const sub of dir.dirs.values()) {
      const subPages = collapse(sub);
      if (subPages.length === 0) continue;
      // Folder 节点使用空 id，避免与子页面 id 冲突导致 getPageUrlsById 误匹配。
      result.push({
        id: '',
        pageName: sub.name.charAt(0).toUpperCase() + sub.name.slice(1),
        type: 'Folder',
        url: '',
        children: subPages,
      });
    }
    return result;
  }
  return { nodes: collapse(root), pages };
}

// 把页面树序列化为 Axure RP document.js 中 PAGES 数组的 JS 源码。
// 输出格式与 generate-sitemap.ps1 的 NodesToJs 一致：每项占一行，
// 缩进随深度递增，叶子节点不输出 children 字段。
function buildPagesJs(items: AxurePageNode[], indent = 2): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const node = items[i]!;
    const comma = i < items.length - 1 ? ',' : '';
    const id = escapeJsString(node.id);
    const pageName = escapeJsString(node.pageName);
    const type = escapeJsString(node.type);
    const url = escapeJsString(node.url);
    if (node.children && node.children.length > 0) {
      const childJs = buildPagesJs(node.children, indent + 8);
      lines.push(`${pad}{ id: "${id}", pageName: "${pageName}", type: "${type}", url: "${url}", children: [`);
      lines.push(childJs);
      lines.push(`${pad}] }${comma}`);
    } else {
      lines.push(`${pad}{ id: "${id}", pageName: "${pageName}", type: "${type}", url: "${url}" }${comma}`);
    }
  }
  return lines.join('\n');
}

// document.js 模板使用标记注释圈定 PAGES 区域；导出时只替换该区域，
// 其余部分（样式表、配置等）保持原样。替换逻辑与 generate-sitemap.ps1 一致：
// 从 PAGES_MARKER_START 到 PAGES_MARKER_END 后第一个换行符全部替换。
const PAGES_MARKER_START = '// ===== PAGES START';
const PAGES_MARKER_END = '// ===== PAGES END =====';

// 模板中 projectName 的占位符；导出时替换为实际项目标题。
const PROJECT_NAME_PLACEHOLDER = '__AXURE_PROJECT_NAME__';
const ROOT_FOLDER_PLACEHOLDER = '__AXURE_ROOT_FOLDER__';

function injectPagesIntoDocument(template: string, pageNodes: AxurePageNode[], projectName: string): string {
  const startIdx = template.indexOf(PAGES_MARKER_START);
  const endIdx = template.indexOf(PAGES_MARKER_END);
  const pagesJs = buildPagesJs(pageNodes);
  let result: string;
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    // 模板缺失标记时退化为把 PAGES 变量追加到末尾。
    result = `${template}\nvar PAGES = [\n${pagesJs}\n];\n`;
  } else {
    // 与 generate-sitemap.ps1 同样的策略：替换从 startIdx 到 endIdx 后第一个换行。
    const arrayEnd = template.indexOf('\n', endIdx);
    const blockEnd = arrayEnd < 0 ? template.length : arrayEnd;
    const newBlock =
      `${PAGES_MARKER_START}\n` +
      `    var PAGES = [\n${pagesJs}\n    ];\n` +
      `    ${PAGES_MARKER_END}`;
    result = template.slice(0, startIdx) + newBlock + template.slice(blockEnd);
  }
  const escapedName = escapeJsString(projectName);
  return result
    .replaceAll(PROJECT_NAME_PLACEHOLDER, escapedName)
    .replaceAll(ROOT_FOLDER_PLACEHOLDER, escapedName);
}

async function fetchTextOrNull(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function fetchBinaryOrNull(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// 骨架中不打包进 ZIP 的开发产物：清单自身、构建脚本、README、示例 files。
function isSkeletonAsset(path: string): boolean {
  if (path === 'skeleton-manifest.json') return false;
  if (path === 'generate-sitemap.ps1') return false;
  if (path === 'README.md') return false;
  if (path.startsWith('files/')) return false; // 示例页面，用工程实际文件替换
  return true;
}

// 把 FileReader 产出的 data:...;base64,<data> 形式字符串解码为 Uint8Array。
// 返回 null 表示格式无效或解码失败，调用方据此跳过该文件。
function base64DataUrlToBytes(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const payload = dataUrl.slice(comma + 1);
  try {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// 以原始 HTML 为基础，注入 Axure RP 运行时代码。
// 策略：不拆解原始 HTML，而是在 </head> 前插入 Axure 运行时脚本链
// （CSS、jQuery、axure 脚本、document.js、per-page data.js），
// 并在 <body> 内包裹 <div id="base">（Axure annotation 系统依赖此容器）。
// 原始页面的样式表、脚本、meta、结构全部保留不变。
function injectAxureRuntimeIntoHtml(originalHtml: string, pageSlug: string, pageName: string): string {
  const escapedTitle = escapeHtml(pageName);
  const axureHead = `
<!-- ===== Axure RP Runtime (injected) ===== -->
    <link href="resources/css/axure_rp_page.css" type="text/css" rel="stylesheet" />
    <link href="data/styles.css" type="text/css" rel="stylesheet" />
    <link href="files/${pageSlug}/styles.css" type="text/css" rel="stylesheet" />
    <script src="resources/scripts/jquery-3.2.1.min.js"></script>
    <script src="resources/scripts/axure/axQuery.js"></script>
    <script src="resources/scripts/axure/globals.js"></script>
    <script src="resources/scripts/axutils.js"></script>
    <script src="resources/scripts/axure/annotation.js"></script>
    <script src="resources/scripts/axure/axQuery.std.js"></script>
    <script src="resources/scripts/axure/doc.js"></script>
    <script src="resources/scripts/messagecenter.js"></script>
    <script src="resources/scripts/axure/events.js"></script>
    <script src="resources/scripts/axure/recording.js"></script>
    <script src="resources/scripts/axure/action.js"></script>
    <script src="resources/scripts/axure/expr.js"></script>
    <script src="resources/scripts/axure/geometry.js"></script>
    <script src="resources/scripts/axure/flyout.js"></script>
    <script src="resources/scripts/axure/model.js"></script>
    <script src="resources/scripts/axure/repeater.js"></script>
    <script src="resources/scripts/axure/sto.js"></script>
    <script src="resources/scripts/axure/utils.temp.js"></script>
    <script src="resources/scripts/axure/variables.js"></script>
    <script src="resources/scripts/axure/drag.js"></script>
    <script src="resources/scripts/axure/move.js"></script>
    <script src="resources/scripts/axure/visibility.js"></script>
    <script src="resources/scripts/axure/style.js"></script>
    <script src="resources/scripts/axure/adaptive.js"></script>
    <script src="resources/scripts/axure/tree.js"></script>
    <script src="resources/scripts/axure/init.temp.js"></script>
    <script src="resources/scripts/axure/legacy.js"></script>
    <script src="resources/scripts/axure/viewer.js"></script>
    <script src="resources/scripts/axure/math.js"></script>
    <script src="resources/scripts/axure/jquery.nicescroll.min.js"></script>
    <script src="data/document.js"></script>
    <script src="files/${pageSlug}/data.js"></script>
    <script type="text/javascript">
      $axure.utils.getTransparentGifPath = function() { return 'resources/images/transparent.gif'; };
      $axure.utils.getOtherPath = function() { return 'resources/Other.html'; };
      $axure.utils.getReloadPath = function() { return 'resources/reload.html'; };
    </script>
<!-- ===== /Axure RP Runtime ===== -->`;

  let result = originalHtml;

  // 在 </head> 前注入 Axure 运行时代码
  if (/<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${axureHead}\n</head>`);
  } else {
    // 没有 </head>：如果也没有 <head>，在 <html> 后插入一个 <head>
    if (/<html[^>]*>/i.test(result)) {
      result = result.replace(/(<html[^>]*>)/i, `$1\n<head>${axureHead}\n</head>`);
    } else {
      result = `${axureHead}\n${result}`;
    }
  }

  // 在 <body> 标签后插入 <div id="base">，在 </body> 前闭合 </div>
  // Axure annotation 系统依赖 #base 容器来定位页面内容
  if (/<body[^>]*>/i.test(result) && /<\/body>/i.test(result)) {
    result = result.replace(/(<body[^>]*>)/i, `$1\n    <div id="base" class="">`);
    result = result.replace(/<\/body>/i, `    </div>\n</body>`);
  } else {
    // 没有 <body> 标签：在整个内容外包裹一层
    result = `<body>\n    <div id="base" class="">\n${result}\n    </div>\n</body>`;
  }

  // 确保 <title> 存在（Axure player 依赖 title 显示页面名）
  if (!/<title>/i.test(result)) {
    const titleTag = `<title>${escapedTitle}</title>`;
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/(<head[^>]*>)/i, `$1\n    ${titleTag}`);
    } else {
      result = `<head>\n    ${titleTag}\n</head>\n${result}`;
    }
  }

  return result;
}

// 生成 per-page data.js 存根。Axure 参考包中每个 files/<pageName>/data.js
// 调用 $axure.loadCurrentPage 注入页面元数据，player 依赖此调用初始化页面状态。
// 包含 pageName 和空的 notes/annotations，使 annotation.js 能正常初始化页面切换。
function buildPageDataJs(pageName: string, pageSlug: string): string {
  const escapedPageName = escapeJsString(pageName);
  const escapedUrl = escapeJsString(`${pageSlug}.html`);
  return `$axure.loadCurrentPage(
(function() {
    var _ = function() { var r={},a=arguments; for(var i=0; i<a.length; i+=2) r[a[i]]=a[i+1]; return r; }
    var _creator = function() { return _("url","${escapedUrl}","pageName","${escapedPageName}","defaultAdaptiveView","","size",_("width",0,"height",0),"adaptiveViews",[],"sketchKeys",["s0"],"variables",["OnLoadVariable"],"page",_("packageId","${pageSlug}","type","Axure:Page","name","","pageName","${escapedPageName}","notes",_("widgetNotes",[],"ownerToFns",{}),"style",_("baseStyle","627587b6038d43cca051c114ac41ad32","pageAlignment","center","fill",_("fillType","solid","color",0xFFFFFFFF),"image",null,"favicon",null,"sketchFactor","0","colorStyle","appliedFont","fontName","'ArialMT', 'Arial', sans-serif","borderWidth","1","borderVisibility","all","borderFill",0xFF797979,"cornerRadius","0","cornerVisibility","all","outerShadow",_("on",false,"offsetX",5,"offsetY",5,"blurRadius",5,"spread",5,"color",_("r",0,"g",0,"b",0,"a",0.349019607843137))),"annotations",[],"diagram",_("objects",[])),"masters",_(),"objectPaths",_()); };
   return _creator();
})());
`;
}

// 将单个引用路径解析为 webresources/<project-root-relative-path> 形式。
// filePath 是该 HTML 文件在工程中的原始路径（如 dashboard/sub/page.html）。
// ref 是 HTML 中出现的相对/绝对引用（如 ../../assets/logo.png 或 /css/style.css）。
// 不处理的引用：data:、http(s):、协议相对 //、# 锚点、mailto/tel/javascript: 等。
function resolveWebResourcePath(ref: string, filePath: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return ref;
  // 跳过 data URI、绝对 URL、协议相对 URL、纯锚点、特殊协议
  if (/^(data:|https?:|\/\/|#|mailto:|tel:|javascript:|blob:|file:)/i.test(trimmed)) return ref;
  // 跳过 Axure 框架自身路径（resources/、data/、files/、plugins/）
  if (/^(resources\/|data\/|files\/|plugins\/)/i.test(trimmed)) return ref;

  let projectRelative: string;
  if (trimmed.startsWith('/')) {
    // 绝对路径：去掉开头的 / 即为工程根相对路径
    projectRelative = trimmed.slice(1);
  } else {
    // 相对路径：从文件所在目录向上解析
    // 空字符串 split('/') 会产生 ['']，过滤掉空段以避免 webresources//path 双斜杠
    const fileDir = filePath.split('/').slice(0, -1).filter((seg) => seg.length > 0);
    const refParts = trimmed.split('/');
    const stack = [...fileDir];
    for (const part of refParts) {
      if (part === '..') {
        if (stack.length > 0) stack.pop();
      } else if (part === '.' || part === '') {
        continue;
      } else {
        stack.push(part);
      }
    }
    projectRelative = stack.join('/');
  }
  return `webresources/${projectRelative}`;
}

// 重写 HTML body 内容中的所有资源引用路径，使其指向 webresources/ 目录。
// 处理：src="..."、href="..."、srcset="..."、CSS url(...)、poster="..."。
function rewriteResourcePaths(html: string, filePath: string): string {
  let result = html;

  // src="..." 和 href="..." 和 poster="..." 属性（单引号或双引号）
  result = result.replace(/(\b(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi, (_m, prefix: string, _q: string, val: string) => {
    return `${prefix}"${resolveWebResourcePath(val, filePath)}"`;
  });

  // srcset="url1 1x, url2 2x" — 逐个 URL 重写
  result = result.replace(/(\bsrcset\s*=\s*)(["'])([^"']*)\2/gi, (_m, prefix: string, _q: string, val: string) => {
    const rewritten = val.split(',').map((pair: string) => {
      const parts = pair.trim().split(/\s+/);
      if (parts.length === 0) return pair;
      const first = parts[0];
      if (first === undefined) return pair;
      parts[0] = resolveWebResourcePath(first, filePath);
      return parts.join(' ');
    }).join(', ');
    return `${prefix}"${rewritten}"`;
  });

  // CSS url(...) — 包括内联 style 属性和 <style> 标签内容
  // 仅处理带文件后缀的资源路径（如 url(../images/logo.png)），
  // 跳过 SVG 引用（url(#gradientId)）、CSS 变量等无后缀值。
  result = result.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m: string, _q: string, val: string) => {
    if (!/\.[a-z0-9]+$/i.test(val.trim())) return m;
    return `url(${resolveWebResourcePath(val, filePath)})`;
  });

  return result;
}

export async function exportProjectAsAxureZip(opts: AxureExportOptions): Promise<AxureExportResult> {
  const { projectId, title } = opts;
  let files: ProjectFile[];
  try {
    files = await fetchProjectFiles(projectId);
  } catch (err) {
    return { ok: false, error: `拉取项目文件失败：${String(err)}` };
  }

  const htmlFiles = files.filter(isHtmlPage);
  if (htmlFiles.length === 0) {
    return { ok: false, error: '当前项目没有 HTML 文件，无法生成 Axure 交互稿。' };
  }

  const usedIds = new Set<string>();
  const { nodes: pageNodes, pages } = buildPageTree(htmlFiles, usedIds);
  const docName = title?.trim() || 'Axure RP HTML 交互稿';

  const entries: ZipEntry[] = [];

  // 拉取骨架全部资源（Axure RP 运行时 + CSS + 图片等）。
  const skeletonFiles = (skeletonManifest as string[]).filter(isSkeletonAsset);
  for (const rel of skeletonFiles) {
    const url = `${SKELETON_BASE}/${rel}`;
    if (BINARY_FILE_EXTS.test(rel)) {
      const bytes = await fetchBinaryOrNull(url);
      if (bytes) entries.push({ path: rel, content: bytes });
    } else {
      const content = await fetchTextOrNull(url);
      if (content != null) entries.push({ path: rel, content });
    }
  }

  // document.js 作为模板拉取后，用标记替换法注入生成的 PAGES 数组。
  const documentTemplate = await fetchTextOrNull(`${SKELETON_BASE}/data/document.js`);
  if (documentTemplate != null) {
    entries.push({ path: 'data/document.js', content: injectPagesIntoDocument(documentTemplate, pageNodes, docName) });
  }

  // 为每个 HTML 页面生成标准 Axure 页面结构：
  // 根目录 <pageName>.html（Axure 页面壳）、files/<pageName>/data.js（页面元数据）、
  // files/<pageName>/styles.css（样式占位）。
  // body 中的相对路径（../../assets 等）重写为 webresources/<project-path>。
  // 非页面文件按原始路径放入 webresources/<path>，使重写后的引用可解析。
  const pageFileSet = new Set(pages.map((pg) => pg.filePath));
  const nonHtmlFiles = files.filter((f) => f.type !== 'dir' && !pageFileSet.has(f.path || f.name));
  const total = pages.length + nonHtmlFiles.length;
  let done = 0;
  for (const pg of pages) {
    // 拉取 HTML 文件原始内容，保留原始 HTML 不变，
    // 只注入 Axure 运行时代码，原始样式和脚本全部保留。
    const rawHtml = await fetchProjectFileText(projectId, pg.filePath);
    // 重写原始 HTML 中所有资源引用路径为 webresources/
    const rewrittenHtml = rewriteResourcePaths(rawHtml ?? '', pg.filePath);
    // 在原始 HTML 基础上注入 Axure 运行时（不拆解原始结构）
    entries.push({ path: `${pg.slug}.html`, content: injectAxureRuntimeIntoHtml(rewrittenHtml, pg.slug, pg.pageName) });
    // per-page data.js 存根（$axure.loadCurrentPage 调用，使 player 追踪页面切换）
    entries.push({ path: `files/${pg.slug}/data.js`, content: buildPageDataJs(pg.pageName, pg.slug) });
    // per-page styles.css 占位（Axure 页面壳引用此文件）
    entries.push({ path: `files/${pg.slug}/styles.css`, content: '' });
    done += 1;
    opts.onProgress?.(done, total);
  }
  for (const file of nonHtmlFiles) {
    const p = file.path || file.name;
    if (TEXT_FILE_EXTS.test(p) || file.mime.startsWith('text/')) {
      const content = await fetchProjectFileText(projectId, p);
      if (content != null) entries.push({ path: `webresources/${p}`, content });
    } else {
      const dataUrl = await fetchProjectFileBase64(projectId, p);
      const binary = base64DataUrlToBytes(dataUrl);
      if (binary) entries.push({ path: `webresources/${p}`, content: binary });
    }
    done += 1;
    opts.onProgress?.(done, total);
  }

  const blob = buildZip(entries);
  // 压缩包名优先用项目名称，其次用文档标题，兜底默认名。
  // 保留中文等 Unicode 字符，只去掉首尾空格、合并连续空格、
  // 清除文件系统非法字符（/ \ : * ? " < > |）。
  const rawName = opts.projectName?.trim() || docName;
  const zipName =
    rawName
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'axure-prototype';
  if (opts.returnBlob) {
    return { ok: true, pageCount: pages.length, blob, zipName };
  }
  triggerDownload(blob, `${zipName}.zip`);
  return { ok: true, pageCount: pages.length };
}
