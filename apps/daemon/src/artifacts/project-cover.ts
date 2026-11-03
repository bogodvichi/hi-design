import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { DesktopExportArtifactInput, DesktopExportArtifactResult } from '@open-design/sidecar-proto';
import { buildDocumentPreview } from '../document-preview.js';
import { kindFor, mimeFor, parseByteRange } from '../projects.js';

type CoverFile = { name: string; buffer: Buffer };
type Exporter = (input: DesktopExportArtifactInput) => Promise<DesktopExportArtifactResult>;

export function selectProjectCoverEntry(files: Array<{ name: string }>, preferred?: string | null): string | null {
  if (preferred && files.some((file) => file.name === preferred)) return preferred;
  const rank = ['html', 'image', 'pdf', 'presentation', 'document', 'spreadsheet', 'video', 'text', 'sketch', 'audio', 'code', 'binary'];
  return files.filter((file) => !/(?:^|\/)(?:SKILL\.md|open-design\.json)$|\.artifact\.json$/i.test(file.name))
    .sort((a, b) => rank.indexOf(kindFor(a.name)) - rank.indexOf(kindFor(b.name)) || a.name.localeCompare(b.name))[0]?.name ?? null;
}

/** The same native renderer serves project publishing, covers, and CLI-backed publishing. */
export async function renderProjectCover(options: {
  file: CoverFile;
  title: string;
  baseHref?: string;
  exporter: Exporter;
}): Promise<Buffer> {
  const { file, title, exporter } = options;
  const kind = kindFor(file.name);
  const fallback = coverDocument(file, title, `<div class="file-icon">${escapeHtml(path.extname(file.name).slice(1).toUpperCase() || 'FILE')}</div>`);
  let html = fallback;
  let sourceUrl: string | undefined;
  let height = 800;
  let closeSource: (() => Promise<void>) | undefined;
  try {
    try {
      if (kind === 'html') {
        html = file.buffer.toString('utf8');
      } else if (['image', 'pdf', 'video', 'audio'].includes(kind) || /\.svg$/i.test(file.name)) {
        const source = await serveCoverSource(file);
        closeSource = source.close;
        const url = escapeHtml(source.url);
        if (kind === 'pdf') {
          const pdf = await PDFDocument.load(file.buffer);
          const page = pdf.getPage(0).getSize();
          height = Math.min(800, Math.ceil(1200 * page.height / page.width) + 8);
          sourceUrl = `${source.url}#page=1&toolbar=0&navpanes=0&view=FitH`;
        } else if (kind === 'video') {
          html = coverDocument(file, title, `<video src="${url}" muted preload="auto"></video>
<script>window.__odCoverReady = new Promise((resolve,reject) => {const v=document.querySelector('video'),fail=()=>reject(new Error('Video frame unavailable'));v.onloadeddata=()=>{const time=Math.min(1,Number.isFinite(v.duration)?v.duration/10:0);if(time>0)v.currentTime=time;else resolve();};v.onseeked=()=>resolve();v.onerror=fail;setTimeout(fail,6000);});</script>`, true);
        } else if (kind === 'audio') {
          html = coverDocument(file, title, `<div class="file-icon">♫</div><audio src="${url}" preload="metadata"></audio>`);
        } else {
          html = coverDocument(file, title, `<img src="${url}" alt="" />
<script>window.__odCoverReady = new Promise((resolve,reject) => {const image=document.querySelector('img'),fail=()=>reject(new Error('Image preview unavailable'));image.onload=()=>resolve();image.onerror=fail;if(image.complete&&image.naturalWidth)resolve();setTimeout(fail,6000);});</script>`, true);
        }
      } else if (['document', 'presentation', 'spreadsheet'].includes(kind)) {
        const preview = await buildDocumentPreview(file);
        const section = preview.sections[0];
        html = coverDocument(file, title, `<h2>${escapeHtml(section?.title ?? '')}</h2><pre>${escapeHtml((section?.lines ?? []).slice(0, 28).join('\n'))}</pre>`);
      } else if (['text', 'code'].includes(kind) || /\.(csv|tsv|ya?ml|xml|log)$/i.test(file.name)) {
        html = coverDocument(file, title, `<pre>${escapeHtml(file.buffer.toString('utf8').slice(0, 5000))}</pre>`);
      }
    } catch (error) {
      console.warn(`[project-cover] preview unavailable for ${file.name}: ${(error as Error).message}`);
      html = fallback;
    }

    for (const source of sourceUrl ? [html, fallback] : new Set([html, fallback])) {
      const result = await exporter({
        deck: false, viewportOnly: true, format: 'image', imageFormat: 'png', width: 1200, height,
        title, html: source, ...(kind === 'html' && options.baseHref ? { baseHref: options.baseHref } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      });
      if (!result.ok || !result.path) {
        console.warn(`[project-cover] capture failed for ${file.name}: ${result.error?.split(' loading ')[0] ?? 'no output'}`);
        sourceUrl = undefined;
        height = 800;
        continue;
      }
      try { return await readFile(result.path); }
      finally { await unlink(result.path).catch(() => {}); }
    }
    throw new Error('project cover renderer returned no image');
  } finally {
    await closeSource?.();
  }
}

function coverDocument(file: CoverFile, title: string, content: string, media = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:800px;overflow:hidden;font-family:system-ui,sans-serif;background:#f5f6fa;color:#182039}
main{height:100%;padding:64px 76px;background:linear-gradient(135deg,#fff,#edf0fa)}h1{font-size:38px;margin:0 0 24px;overflow-wrap:anywhere}h2{font-size:24px;color:#4d5b7c}
pre{font:23px/1.65 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:16px 0}.file-icon{font-size:88px;font-weight:700;color:#6076b5;margin:48px 0}
footer{position:absolute;bottom:28px;left:76px;font-size:18px;color:#65708b}img,video,iframe{width:100%;height:100%;object-fit:contain;border:0;background:#fff}.media{padding:0}
</style></head><body><main class="${media ? 'media' : ''}">${media ? '' : `<h1>${escapeHtml(title)}</h1>`}${content}</main>${media ? '' : `<footer>${escapeHtml(file.name)} · ${(file.buffer.length / 1024).toFixed(1)} KB</footer>`}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

// Expose only this buffer to the sandboxed renderer; no local-file access or
// project credentials are needed. Range support lets video seek to a frame.
async function serveCoverSource(file: CoverFile) {
  const tokenPath = `/${randomUUID()}${path.extname(file.name)}`;
  const server = createServer((req, res) => {
    if (req.url !== tokenPath) { res.writeHead(404).end(); return; }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', mimeFor(file.name));
    res.setHeader('Accept-Ranges', 'bytes');
    const range = parseByteRange(req.headers.range, file.buffer.length);
    if (range === 'unsatisfiable') { res.writeHead(416).end(); return; }
    const data = range ? file.buffer.subarray(range.start, range.end + 1) : file.buffer;
    if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.buffer.length}`);
    res.setHeader('Content-Length', data.length);
    res.writeHead(range ? 206 : 200).end(data);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('cover source did not start');
  return {
    url: `http://127.0.0.1:${address.port}${tokenPath}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
