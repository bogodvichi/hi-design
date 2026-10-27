/**
 * UEDRO html评审 (reviewType "12") needs an executable HTML website ZIP,
 * NOT the Axure wireframe export used by interaction reviews.
 *
 * The daemon streams an asset-only project archive with a root index.html
 * and stable relative HTML/CSS/JS/image/font paths. Never silently fall
 * back to an unrelated/single-file ZIP on error.
 */
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export type HtmlReviewZipResult =
  | { ok: true; blob: Blob; zipName: string }
  | { ok: false; error: string };

const UEDRO_HTML_ZIP_LIMIT_BYTES = 500 * 1024 * 1024;

export async function exportProjectAsHtmlReviewZip(opts: {
  projectId: string;
  projectName?: string;
  entryFile?: string | null;
  workspaceContext?: WorkspaceCollabContext | null;
}): Promise<HtmlReviewZipResult> {
  const params = new URLSearchParams({ format: 'html-review' });
  if (opts.entryFile && /\.html?$/i.test(opts.entryFile)) {
    params.set('entryFile', opts.entryFile);
  }
  const url = `/api/projects/${encodeURIComponent(opts.projectId)}/archive?${params.toString()}`;
  try {
    const resp = await fetch(url, {
      ...(opts.workspaceContext
        ? { headers: workspaceProjectHeaders(opts.workspaceContext) }
        : {}),
    });
    if (!resp.ok) {
      const payload = await resp.json().catch(() => null);
      return {
        ok: false,
        error: payload?.error?.message || `生成 HTML 评审包失败（HTTP ${resp.status}）`,
      };
    }
    const blob = await resp.blob();
    if (blob.size === 0) return { ok: false, error: 'HTML 评审压缩包为空' };
    if (blob.size >= UEDRO_HTML_ZIP_LIMIT_BYTES) {
      return { ok: false, error: 'HTML 评审压缩包需小于 500MB' };
    }
    const zipName = (opts.projectName?.trim() || 'html-review')
      .replace(/[\/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'html-review';
    return { ok: true, blob, zipName };
  } catch (err) {
    return {
      ok: false,
      error: '生成 HTML 评审包失败：' + (err instanceof Error ? err.message : String(err)),
    };
  }
}
