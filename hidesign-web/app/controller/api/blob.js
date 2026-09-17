'use strict';

const { createKnex } = require('../../utils/knex.js');
const blobStore = require('../../utils/blob-store.js');
const crypto = require('node:crypto');

const Controller = require('egg').Controller;

// Blob endpoints: upload (PUT) and download (GET).
//
// Blobs are content-addressed: the digest in the URL path is the sha256 of
// the blob content. The server verifies this on upload and rejects mismatches.
//
// The upload route receives raw binary (application/octet-stream), not JSON.
// We read the raw body from ctx.req since Egg's body parser skips non-JSON
// content types.

class BlobController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- Upload: PUT /api/workspaces/:ws/blobs/:digest ----
  async upload() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const digest = (ctx.params.digest || '').toLowerCase();

    if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_digest', message: 'digest must be a 64-char hex sha256' };
      return;
    }

    try {
      // Collect raw body from the stream.
      const chunks = [];
      for await (const chunk of ctx.req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);

      // Verify digest.
      const actual = crypto.createHash('sha256').update(data).digest('hex');
      if (actual !== digest) {
        ctx.status = 400;
        ctx.body = { error: 'digest_mismatch', message: `declared ${digest}, actual ${actual}` };
        return;
      }

      // Write to disk.
      await blobStore.writeBlob(digest, data);

      // Record in blobs table and workspace_blob_refs.
      const k = this.getKnex();
      await k('blobs')
        .insert({ digest, size: data.length, storage_path: `blob/${digest}` })
        .onConflict('digest')
        .ignore();
      await k('workspace_blob_refs')
        .insert({ workspace_id: workspaceId, digest })
        .onConflict()
        .ignore();

      ctx.status = 201;
      ctx.body = { ok: true, digest, size: data.length };
    } catch (err) {
      ctx.logger.error('[hdw] blob upload error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Download: GET /api/workspaces/:ws/blobs/:digest ----
  async download() {
    const { ctx } = this;
    const digest = (ctx.params.digest || '').toLowerCase();

    if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_digest', message: 'digest must be a 64-char hex sha256' };
      return;
    }

    try {
      if (!(await blobStore.exists(digest))) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'blob not found' };
        return;
      }

      const data = await blobStore.readBlob(digest);
      ctx.set('content-type', 'application/octet-stream');
      ctx.set('content-length', String(data.length));
      ctx.body = data;
    } catch (err) {
      ctx.logger.error('[hdw] blob download error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }
}

module.exports = BlobController;
