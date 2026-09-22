'use strict';

const { createKnex } = require('../../utils/knex.js');
const blobStore = require('../../utils/blob-store.js');
const { generateShortId } = require('../../utils/ids.js');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const Controller = require('egg').Controller;

// Share link endpoints: generate, view, get, revoke.
//
// A share link is a public-facing preview page that embeds a project's
// HTML files in the preview_template.html shell. The generated HTML is
// stored as a blob (content-addressed) so it deduplicates naturally.
//
// Flow:
//   1. Look up team_projects row for projectId+workspaceId.
//   2. Resolve the published version (last_synced_version_id or
//      resource_refs published ref).
//   3. Read the manifest blob -> get entries [{path, digest, size}].
//   4. For each HTML entry: read blob content, rewrite relative asset
//      refs to blob download URLs.
//   5. Inject the rewritten HTML files into preview_template.html.
//   6. Store the generated HTML as a blob, upsert share_links row.
//   7. Return the share URL.

function ok(data) { return { code: 0, msg: 'ok', data }; }
function fail(error) { return { code: -1, msg: 'FAIL', error }; }

class ShareLinkController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  _publicBase() {
    return (this.app.config.community && this.app.config.community.publicApiBase) || this.ctx.origin;
  }

_blobUrl(workspaceId, digest) {
  // Use a relative path so blob URLs resolve against whichever origin
  // serves the share page, rather than being pinned to publicApiBase.
   // The share page is always at {base}/hdw/share/{token}, so
   // ../api/workspaces/... resolves to {base}/hdw/api/workspaces/...
   // which works under any reverse-proxy prefix (e.g. /hik-plugin/hidesign-web).
   return '../api/workspaces/' + encodeURIComponent(workspaceId) + '/blobs/' + digest;
}

  _shareBaseUrl() {
    return this._publicBase() + '/hdw/share';
  }

  // ---- Generate: POST /hdw/api/share-link/generate ----
  async generate() {
    const { ctx } = this;
    const body = ctx.request.body || {};
    const projectId = body.project_id;
    const workspaceId = body.workspace_id;
    const displayName = body.display_name || null;

    if (!projectId || !workspaceId) {
      ctx.body = fail('project_id and workspace_id are required');
      return;
    }

    try {
      const k = this.getKnex();

      // Check for an existing share_links row first.
      const existing = await k('share_links')
        .where({ project_id: projectId, workspace_id: workspaceId })
        .first();

      // 1. Look up the team project row (optional).
      const tp = await k('team_projects as tp')
        .join('resources as r', 'r.id', 'tp.resource_id')
        .where({ 'tp.workspace_id': workspaceId, 'tp.project_id': projectId })
        .select(
          'tp.id', 'tp.resource_id', 'tp.display_name',
          'tp.last_synced_version_id', 'tp.workspace_id',
          'r.metadata as resource_metadata',
        )
        .first();

      // If no team project record, create or return a placeholder link.
      // Content will be filled when the project is synced and generate is called again.
      if (!tp) {
        if (existing) {
          const url = this._shareBaseUrl() + '/' + existing.token;
          ctx.body = ok({ token: existing.token, url });
          return;
        }
        const token = generateShortId(20);
        const shareId = crypto.randomUUID();
        await k('share_links').insert({
          id: shareId,
          token,
          project_id: projectId,
          workspace_id: workspaceId,
          resource_id: null,
          version_id: null,
          html_digest: null,
          display_name: displayName || null,
        });
        const url = this._shareBaseUrl() + '/' + token;
        ctx.body = ok({ token, url });
        return;
      }

      // 2. Resolve the published version.
      let versionRow = null;
      if (tp.last_synced_version_id) {
        versionRow = await k('resource_versions')
          .where({ id: tp.last_synced_version_id })
          .select('id', 'version', 'manifest_digest')
          .first();
      }
      if (!versionRow) {
        versionRow = await k('resource_refs as rr')
          .join('resource_versions as rv', 'rv.id', 'rr.version_id')
          .where({ 'rr.resource_id': tp.resource_id, 'rr.ref': 'published' })
          .select('rv.id', 'rv.version', 'rv.manifest_digest')
          .first();
      }
      if (!versionRow) {
        // Project exists in team_projects but has no published version yet.
        if (existing) {
          const url = this._shareBaseUrl() + '/' + existing.token;
          ctx.body = ok({ token: existing.token, url });
          return;
        }
        const token = generateShortId(20);
        const shareId = crypto.randomUUID();
        await k('share_links').insert({
          id: shareId,
          token,
          project_id: projectId,
          workspace_id: workspaceId,
          resource_id: tp.resource_id,
          version_id: null,
          html_digest: null,
          display_name: displayName || tp.display_name || null,
        });
        const url = this._shareBaseUrl() + '/' + token;
        ctx.body = ok({ token, url });
        return;
      }

      // 3. Read the manifest blob.
      const manifestBuffer = await blobStore.readBlob(versionRow.manifest_digest);
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));
      const entries = manifest.entries || [];

      const entryMap = new Map();
      for (const entry of entries) {
        entryMap.set(entry.path, entry);
      }

      // 4. Process HTML entries.
      const htmlEntries = entries.filter(e => /\.html?$/i.test(e.path));
      if (htmlEntries.length === 0) {
        ctx.body = fail('No HTML files found in the project manifest');
        return;
      }

      const htmlFiles = [];
      for (const entry of htmlEntries) {
        const htmlBuffer = await blobStore.readBlob(entry.digest);
        let html = htmlBuffer.toString('utf-8');
        html = this._rewriteAssetRefs(html, entry.path, entryMap, workspaceId);
        const name = path.basename(entry.path);
        const home = /^(index|home|main|default)\.html?$/i.test(name);
        htmlFiles.push({ name, path: html, home });
      }

      // 5. Load preview_template.html and inject HTML_FILES data.
      const templatePath = path.join(this.app.baseDir, 'app', 'data', 'preview_template.html');
      let template = (await fs.readFile(templatePath, 'utf-8')).toString();
      // Escape all < and > in the JSON as \u003c / \u003e so that HTML
      // tags inside the embedded content (opening <script>, closing
      // </script>, <!-- comments, etc.) cannot break out of the
      // template's <script> block. The browser's JS engine decodes
      // \u003c back to < at parse time, so the data is preserved.
      const replacement = JSON.stringify(htmlFiles)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
      template = template.replace(
        /\/\*HTML_FILES_DATA\*\/\[\]/,
        '/*HTML_FILES_DATA*/' + replacement
      );

      // 6. Store the generated HTML as a blob.
      const htmlBuffer = Buffer.from(template, 'utf-8');
      const htmlDigest = crypto.createHash('sha256').update(htmlBuffer).digest('hex');
      await blobStore.writeBlob(htmlDigest, htmlBuffer);
      await k('blobs')
        .insert({ digest: htmlDigest, size: htmlBuffer.length, storage_path: 'blob/' + htmlDigest })
        .onConflict('digest')
        .ignore();
      await k('workspace_blob_refs')
        .insert({ workspace_id: workspaceId, digest: htmlDigest })
        .onConflict()
        .ignore();

      // 7. Upsert share_links row.
      const effectiveDisplayName = displayName || tp.display_name || null;

      if (existing) {
        await k('share_links')
          .where({ id: existing.id })
          .update({
            resource_id: tp.resource_id,
            version_id: versionRow.id,
            html_digest: htmlDigest,
            display_name: effectiveDisplayName,
            updated_at: new Date(),
          });
        const updated = await k('share_links').where({ id: existing.id }).first();
        const url = this._shareBaseUrl() + '/' + updated.token;
        ctx.body = ok({ token: updated.token, url });
      } else {
        const token = generateShortId(20);
        const shareId = crypto.randomUUID();
        await k('share_links').insert({
          id: shareId,
          token,
          project_id: projectId,
          workspace_id: workspaceId,
          resource_id: tp.resource_id,
          version_id: versionRow.id,
          html_digest: htmlDigest,
          display_name: effectiveDisplayName,
        });
        const url = this._shareBaseUrl() + '/' + token;
        ctx.body = ok({ token, url });
      }
    } catch (err) {
      ctx.logger.error('[hdw] share-link generate error:', err);
      ctx.body = fail(err.message);
    }
  }

  // ---- View: GET /hdw/share/:token ----
  async view() {
    const { ctx } = this;
    const token = ctx.params.token;

    try {
      const k = this.getKnex();
      const row = await k('share_links').where({ token }).first();
      if (!row) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Share link not found' };
        return;
      }

      if (!(await blobStore.exists(row.html_digest))) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Share content not found on disk' };
        return;
      }

      const data = await blobStore.readBlob(row.html_digest);
      ctx.set('content-type', 'text/html; charset=utf-8');
      ctx.set('content-length', String(data.length));
      ctx.set('cache-control', 'public, max-age=300');
      ctx.body = data;
    } catch (err) {
      ctx.logger.error('[hdw] share-link view error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Get existing link: GET /hdw/api/share-link ----
  async get() {
    const { ctx } = this;
    const projectId = ctx.query.project_id;

    if (!projectId) {
      ctx.body = fail('project_id is required');
      return;
    }

    try {
      const k = this.getKnex();
      const row = await k('share_links')
        .where({ project_id: projectId })
        .first();

      if (!row) {
        ctx.body = ok(null);
        return;
      }

      const url = this._shareBaseUrl() + '/' + row.token;
      ctx.body = ok({
        token: row.token,
        url,
        display_name: row.display_name,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      });
    } catch (err) {
      ctx.logger.error('[hdw] share-link get error:', err);
      ctx.body = fail(err.message);
    }
  }

  // ---- Revoke: DELETE /hdw/api/share-link ----
  async revoke() {
    const { ctx } = this;
    const projectId = ctx.query.project_id;

    if (!projectId) {
      ctx.body = fail('project_id is required');
      return;
    }

    try {
      const k = this.getKnex();
      const deleted = await k('share_links')
        .where({ project_id: projectId })
        .del();

      if (deleted === 0) {
        ctx.body = fail('Share link not found');
        return;
      }

      ctx.body = ok({ deleted: true });
    } catch (err) {
      ctx.logger.error('[hdw] share-link revoke error:', err);
      ctx.body = fail(err.message);
    }
  }

  // ---- Helper: rewrite relative asset refs to blob URLs ----
  _rewriteAssetRefs(html, htmlPath, entryMap, workspaceId) {
    const dir = path.posix.dirname(htmlPath);

    // Resolve a relative or root-relative path to a manifest entry path.
    const resolveEntryPath = (ref) => {
      if (ref.startsWith('/')) {
        return ref.slice(1);
      }
      return path.posix.join(dir, ref);
    };

   // Build a blob URL for an entry path.
   const blobUrlForPath = (ref) => {
     const entryPath = resolveEntryPath(ref);
     const entry = entryMap.get(entryPath);
     if (entry) {
       return this._blobUrl(workspaceId, entry.digest);
     }
     return null;
   };

    // Rewrite absolute blob URLs (e.g. from the editing environment) to
    // relative paths so they resolve against the share page's origin.
    const absoluteBlobPattern = /\/hdw\/api\/workspaces\/[^/]+\/blobs\/([0-9a-f]{64})/i;
    const rewriteAbsoluteBlobUrl = (val) => {
      const m = absoluteBlobPattern.exec(val);
      if (m) {
        return this._blobUrl(workspaceId, m[1]);
      }
      return null;
    };

   // Rewrite src="..." and href="..." attributes.
   // Skip absolute URLs, data URIs, protocol-relative URLs, and hash-only refs.
   const attrPattern = /\b(src|href)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>]+)/gi;

   html = html.replace(attrPattern, (match, attr, value) => {
     let val = value;
     let quote = '';
     if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
       quote = val.charAt(0);
       val = val.slice(1, -1);
     }
     // Try rewriting absolute blob URLs first.
     const absBlobUrl = rewriteAbsoluteBlobUrl(val);
     if (absBlobUrl) {
       return attr + '=' + quote + absBlobUrl + quote;
     }
     // Skip other absolute URLs, data URIs, protocol-relative, and hash-only.
     if (/^(?:https?:)?\/\//i.test(val) || /^data:/i.test(val) || /^#/.test(val) || val === '') {
       return match;
     }
     const newUrl = blobUrlForPath(val);
     if (newUrl) {
       return attr + '=' + quote + newUrl + quote;
     }
     return match;
   });

   // Rewrite url(...) in CSS (inline style blocks and style attributes).
   const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)/gi;
   html = html.replace(urlPattern, (match, dq, sq, bare) => {
     let val = dq || sq || bare || '';
     val = val.trim();
     const absBlobUrl = rewriteAbsoluteBlobUrl(val);
     if (absBlobUrl) {
       if (dq !== undefined) return 'url("' + absBlobUrl + '")';
       if (sq !== undefined) return "url('" + absBlobUrl + "')";
       return 'url(' + absBlobUrl + ')';
     }
     if (/^(?:https?:)?\/\//i.test(val) || /^data:/i.test(val) || /^#/.test(val) || val === '') {
       return match;
     }
     const newUrl = blobUrlForPath(val);
     if (newUrl) {
       if (dq !== undefined) return 'url("' + newUrl + '")';
       if (sq !== undefined) return "url('" + newUrl + "')";
       return 'url(' + newUrl + ')';
     }
     return match;
   });

   // Rewrite @import "..." or @import url(...) in CSS.
   const importPattern = /@import\s+(?:"([^"]*)"|'([^']*)')\s*;/gi;
   html = html.replace(importPattern, (match, dq, sq) => {
     let val = dq || sq || '';
     const absBlobUrl = rewriteAbsoluteBlobUrl(val);
     if (absBlobUrl) {
       const quote = dq !== undefined ? '"' : "'";
       return '@import ' + quote + absBlobUrl + quote + ';';
     }
     if (/^(?:https?:)?\/\//i.test(val) || /^data:/i.test(val) || val === '') {
       return match;
     }
     const newUrl = blobUrlForPath(val);
     if (newUrl) {
       const quote = dq !== undefined ? '"' : "'";
       return '@import ' + quote + newUrl + quote + ';';
     }
     return match;
   });

    return html;
  }
}

module.exports = ShareLinkController;
