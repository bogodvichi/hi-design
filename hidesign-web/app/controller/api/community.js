'use strict';

const { createKnex } = require('../../utils/knex.js');
const blobStore = require('../../utils/blob-store.js');
const { generateShortId } = require('../../utils/ids.js');
const crypto = require('node:crypto');

const Controller = require('egg').Controller;

function ok(data) { return { code: 0, msg: 'ok', data }; }
function fail(error) { return { code: -1, msg: 'FAIL', error }; }

class CommunityController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  _archiveUrl(name, version) {
    const base = (this.app.config.community && this.app.config.community.publicApiBase) || this.ctx.origin;
    return base + '/hdw/api/community/plugins/' + encodeURIComponent(name) + '/versions/' + encodeURIComponent(version) + '/archive';
  }

  _coverUrl(digest) {
    const base = (this.app.config.community && this.app.config.community.publicApiBase) || this.ctx.origin;
    return base + '/hdw/api/community/cover/' + digest;
  }

  _parseJsonb(val) {
    if (!val) return undefined;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return undefined; }
    }
    return val;
  }

  async marketplace() {
    const { ctx } = this;
    const tag = ctx.query.tag;
    const publisherUsername = ctx.query.publisher_username || ctx.query.username || '';
    try {
      const k = this.getKnex();
      let query = k('community_plugins as cp')
        .leftJoin('community_plugin_versions as cpv', 'cpv.id', 'cp.current_version_id')
        .whereNull('cp.deleted_at')
        .where('cp.status', 'published')
        .select(
          'cp.id', 'cp.name', 'cp.source',
          'cp.publisher_username', 'cp.publisher_displayname', 'cp.publisher_github', 'cp.publisher_url',
          'cp.homepage', 'cp.license',
          'cp.title', 'cp.title_i18n', 'cp.description', 'cp.description_i18n',
          'cp.icon', 'cp.tags', 'cp.capabilities_summary', 'cp.prompt', 'cp.cover_digest',
          'cp.current_version_id',
          'cpv.version as cv_version', 'cpv.archive_digest as cv_archive_digest',
          'cpv.archive_size as cv_archive_size', 'cpv.archive_integrity as cv_archive_integrity',
          'cpv.manifest_digest as cv_manifest_digest',
        )
        .orderBy('cp.updated_at', 'desc');
      if (tag) {
        query = query.whereRaw('cp.tags @> ARRAY[?]', [tag]);
      }
      if (publisherUsername) {
        query = query.where('cp.publisher_username', publisherUsername);
      }
      const rows = await query;
      const plugins = rows.map(row => this._toMarketplaceEntry(row));
      const manifest = {
        $schema: 'https://open-design.dev/schemas/open-design.marketplace.v1.json',
        specVersion: '1.0.0',
        name: 'hdw-community',
        version: '1.0.0',
        owner: { name: 'HDW Community' },
        metadata: { description: 'Community plugins from HDW' },
        plugins,
      };
      ctx.body = ok(manifest);
    } catch (err) {
      ctx.logger.error('[hdw] community marketplace error:', err);
      ctx.body = fail(err.message);
    }
  }

  async detail() {
    const { ctx } = this;
    const name = ctx.params.name;
    try {
      const k = this.getKnex();
      const row = await k('community_plugins as cp')
        .leftJoin('community_plugin_versions as cpv', 'cpv.id', 'cp.current_version_id')
        .whereNull('cp.deleted_at')
        .where('cp.name', name)
        .select(
          'cp.id', 'cp.name', 'cp.source',
          'cp.publisher_username', 'cp.publisher_displayname', 'cp.publisher_github', 'cp.publisher_url',
          'cp.homepage', 'cp.license',
          'cp.title', 'cp.title_i18n', 'cp.description', 'cp.description_i18n',
          'cp.icon', 'cp.tags', 'cp.capabilities_summary', 'cp.prompt', 'cp.cover_digest',
          'cp.status', 'cp.current_version_id',
          'cpv.version as cv_version', 'cpv.archive_digest as cv_archive_digest',
          'cpv.archive_size as cv_archive_size', 'cpv.archive_integrity as cv_archive_integrity',
          'cpv.manifest_digest as cv_manifest_digest',
        )
        .first();
      if (!row) {
        ctx.body = fail('Plugin not found');
        return;
      }
      ctx.body = ok(this._toMarketplaceEntry(row));
    } catch (err) {
      ctx.logger.error('[hdw] community plugin detail error:', err);
      ctx.body = fail(err.message);
    }
  }

  async publish() {
    const { ctx } = this;
    const body = ctx.request.body || {};
    if (!body.name || !body.version || !body.archiveDigest) {
      ctx.body = fail('Missing required fields: name, version, archiveDigest');
      return;
    }
    const publisherUsername = body.publisherUsername || body.username;
    if (!publisherUsername) {
      ctx.body = fail('Missing required field: publisherUsername');
      return;
    }
    try {
      const k = this.getKnex();
      // Resolve the publisher username from workspace_members when the
      // caller provides a workspace member ID. The member ID is the
      // reliable publisher identity (from x-od-workspace-member-id);
      // the SSO username may be absent or differ from the original.
      let effectivePublisherUsername = publisherUsername;
      if (body.publisherMemberId && body.publisherWorkspaceId) {
        const member = await k('workspace_members')
          .where({
            workspace_id: body.publisherWorkspaceId,
            workspace_member_id: body.publisherMemberId,
          })
          .select('username')
          .first();
        if (member?.username) {
          effectivePublisherUsername = member.username;
        }
      }
      const blob = await k('blobs').where({ digest: body.archiveDigest }).first();
      if (!blob) {
        ctx.body = fail('Archive blob not found. Upload the blob first via PUT /community/blobs/:digest');
        return;
      }
      const existing = await k('community_plugins')
        .whereRaw('name = ? AND deleted_at IS NULL', [body.name])
        .first();
      if (existing) {
        // Allow a real publisher to claim a plugin whose original publisher
        // was 'unknown' (from a task-based publish that didn't pass publisher
        // params). Once claimed, the normal ownership check applies.
        if (existing.publisher_username !== effectivePublisherUsername && existing.publisher_username !== 'unknown') {
          ctx.body = fail('Only the original publisher can publish new versions');
          return;
        }
        const dupVersion = await k('community_plugin_versions')
          .where({ plugin_id: existing.id, version: body.version })
          .first();
        if (dupVersion) {
          ctx.body = fail('Version ' + body.version + ' already exists');
          return;
        }
      }
      const pluginId = existing ? existing.id : generateShortId();
      const versionId = crypto.randomUUID();
      await k.transaction(async trx => {
        if (existing) {
          const update = { updated_at: new Date() };
          if (existing.publisher_username === 'unknown' && effectivePublisherUsername !== 'unknown') {
            update.publisher_username = effectivePublisherUsername;
          }
          if (body.title !== undefined) update.title = body.title;
          if (body.titleI18n !== undefined) update.title_i18n = JSON.stringify(body.titleI18n);
          if (body.description !== undefined) update.description = body.description;
          if (body.descriptionI18n !== undefined) update.description_i18n = JSON.stringify(body.descriptionI18n);
          if (body.icon !== undefined) update.icon = body.icon;
          if (body.tags !== undefined) update.tags = body.tags;
          const caps = body.capabilitiesSummary; if (caps !== undefined) update.capabilities_summary = caps;
          if (body.prompt !== undefined) update.prompt = body.prompt;
          if (body.homepage !== undefined) update.homepage = body.homepage;
          if (body.license !== undefined) update.license = body.license;
          if (body.publisherDisplayname !== undefined) update.publisher_displayname = body.publisherDisplayname;
          if (body.publisherGithub !== undefined) update.publisher_github = body.publisherGithub;
          if (body.publisherUrl !== undefined) update.publisher_url = body.publisherUrl;
          if (body.coverDigest !== undefined) update.cover_digest = body.coverDigest;
          await trx('community_plugins').where({ id: pluginId }).update(update);
        } else {
          await trx('community_plugins').insert({
            id: pluginId,
            name: body.name,
            source: 'hdw-community',
            publisher_username: effectivePublisherUsername,
            publisher_displayname: body.publisherDisplayname || null,
            publisher_github: body.publisherGithub || null,
            publisher_url: body.publisherUrl || null,
            homepage: body.homepage || null,
            license: body.license || null,
            title: body.title || null,
            title_i18n: body.titleI18n ? JSON.stringify(body.titleI18n) : null,
            description: body.description || null,
            description_i18n: body.descriptionI18n ? JSON.stringify(body.descriptionI18n) : null,
            icon: body.icon || null,
            tags: body.tags || ['project'],
            capabilities_summary: body.capabilitiesSummary || [],
            prompt: body.prompt || null,
            cover_digest: body.coverDigest || null,
          });
        }
        await trx('community_plugin_versions').insert({
          id: versionId,
          plugin_id: pluginId,
          version: body.version,
          archive_digest: body.archiveDigest,
          archive_size: body.archiveSize || blob.size,
          archive_integrity: body.archiveIntegrity || ('sha256-' + body.archiveDigest),
          manifest_digest: body.manifestDigest || null,
          changelog: body.changelog || null,
        });
        await trx('community_plugins')
          .where({ id: pluginId })
          .update({ current_version_id: versionId, updated_at: new Date() });
      });
      ctx.body = ok({ pluginId, versionId, name: body.name, version: body.version });
    } catch (err) {
      ctx.logger.error('[hdw] community publish error:', err);
      ctx.body = fail(err.message);
    }
  }

  async uploadBlob() {
    const { ctx } = this;
    const digest = (ctx.params.digest || '').toLowerCase();
    if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
      ctx.body = fail('digest must be a 64-char hex sha256');
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of ctx.req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);
      const actual = crypto.createHash('sha256').update(data).digest('hex');
      if (actual !== digest) {
        ctx.body = fail('digest mismatch: declared ' + digest + ', actual ' + actual);
        return;
      }
      await blobStore.writeBlob(digest, data);
      const k = this.getKnex();
      await k('blobs')
        .insert({ digest, size: data.length, storage_path: 'blob/' + digest })
        .onConflict('digest')
        .ignore();
      ctx.body = ok({ ok: true, digest, size: data.length });
    } catch (err) {
      ctx.logger.error('[hdw] community blob upload error:', err);
      ctx.body = fail(err.message);
    }
  }

  async downloadArchive() {
    const { ctx } = this;
    const name = ctx.params.name;
    const version = ctx.params.version;
    try {
      const k = this.getKnex();
      const row = await k('community_plugin_versions as cpv')
        .join('community_plugins as cp', 'cp.id', 'cpv.plugin_id')
        .whereNull('cp.deleted_at')
        .where('cp.name', name)
        .where('cpv.version', version)
        .where('cpv.yanked', false)
        .select('cpv.archive_digest')
        .first();
      if (!row) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Plugin version not found' };
        return;
      }
      if (!(await blobStore.exists(row.archive_digest))) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Archive blob not found on disk' };
        return;
      }
      const data = await blobStore.readBlob(row.archive_digest);
      ctx.set('content-type', 'application/octet-stream');
      ctx.set('content-length', String(data.length));
      ctx.body = data;
    } catch (err) {
      ctx.logger.error('[hdw] community archive download error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  async downloadCover() {
    const { ctx } = this;
    const digest = (ctx.params.digest || '').toLowerCase();
    if (!digest || !/^[0-9a-f]{64}$/.test(digest)) {
      ctx.status = 400;
      ctx.body = { error: 'bad_request', message: 'digest must be a 64-char hex sha256' };
      return;
    }
    try {
      if (!(await blobStore.exists(digest))) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Cover blob not found on disk' };
        return;
      }
      const data = await blobStore.readBlob(digest);
      ctx.set('content-type', 'image/png');
      ctx.set('content-length', String(data.length));
      ctx.set('cache-control', 'public, max-age=86400');
      ctx.body = data;
    } catch (err) {
      ctx.logger.error('[hdw] community cover download error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  async remove() {
    const { ctx } = this;
    const name = ctx.params.name;
    const publisherUsername = ctx.query.publisherUsername || ctx.query.username;
    if (!publisherUsername) {
      ctx.body = fail('Missing required query: publisherUsername');
      return;
    }
    try {
      const k = this.getKnex();
      const plugin = await k('community_plugins')
        .whereRaw('name = ? AND deleted_at IS NULL', [name])
        .first();
      if (!plugin) {
        ctx.body = fail('Plugin not found');
        return;
      }
      if (plugin.publisher_username !== publisherUsername) {
        ctx.body = fail('Only the original publisher can delete');
        return;
      }
      await k('community_plugins')
        .where({ id: plugin.id })
        .update({ deleted_at: new Date(), updated_at: new Date() });
      ctx.body = ok({ deleted: true });
    } catch (err) {
      ctx.logger.error('[hdw] community plugin delete error:', err);
      ctx.body = fail(err.message);
    }
  }

  _toMarketplaceEntry(row) {
    const name = row.name;
    const version = row.cv_version;
    return {
      name: name,
      source: row.source || 'hdw-community',
      version: version || '',
      dist: {
        archive: version ? this._archiveUrl(name, version) : undefined,
        integrity: row.cv_archive_integrity || undefined,
        manifestDigest: row.cv_manifest_digest || undefined,
      },
      publisher: {
        id: row.publisher_username,
        displayName: row.publisher_displayname || undefined,
        github: row.publisher_github || undefined,
        url: row.publisher_url || undefined,
      },
      homepage: row.homepage || undefined,
      license: row.license || undefined,
      tags: row.tags || [],
      title: row.title || undefined,
      title_i18n: this._parseJsonb(row.title_i18n),
      description: row.description || undefined,
      description_i18n: this._parseJsonb(row.description_i18n),
      icon: row.icon || undefined,
      capabilitiesSummary: row.capabilities_summary || [],
      prompt: row.prompt || undefined,
      coverUrl: row.cover_digest ? this._coverUrl(row.cover_digest) : undefined,
    };
  }
}

module.exports = CommunityController;
