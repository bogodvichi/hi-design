'use strict';

const { createKnex } = require('../../utils/knex.js');

const Controller = require('egg').Controller;

const RESOURCE_TYPES = new Set([ 'project', 'skill', 'mcp', 'tool' ]);
const METRICS = new Set([ 'preview', 'action' ]);
const DEDUP_WINDOW_MS = 5000;

function zeroStats(resourceType, resourceId) {
  return {
    resourceType,
    resourceId,
    previewCount: 0,
    previewUserCount: 0,
    actionCount: 0,
    actionUserCount: 0,
  };
}

function normalizeStats(row, resourceType, resourceId) {
  if (!row) return zeroStats(resourceType, resourceId);
  return {
    resourceType,
    resourceId,
    previewCount: Number(row.preview_count || 0),
    previewUserCount: Number(row.preview_user_count || 0),
    actionCount: Number(row.action_count || 0),
    actionUserCount: Number(row.action_user_count || 0),
  };
}

class CommunityStatsController extends Controller {
  getKnex() {
    if (!this._knex) this._knex = createKnex(this.app.config.db);
    return this._knex;
  }

  async record() {
    const { ctx } = this;
    const body = ctx.request.body || {};
    const resourceType = typeof body.resourceType === 'string' ? body.resourceType.trim() : '';
    const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : '';
    const metric = typeof body.metric === 'string' ? body.metric.trim() : '';
    const actorKey = typeof body.actorKey === 'string' ? body.actorKey.trim() : '';

    if (!RESOURCE_TYPES.has(resourceType) || !resourceId || !METRICS.has(metric) || !actorKey) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request' };
      return;
    }
    if (resourceId.length > 512 || actorKey.length > 256) {
      ctx.status = 400;
      ctx.body = { error: 'value_too_long' };
      return;
    }

    try {
      const k = this.getKnex();
      const now = new Date();
      let counted = false;

      await k.transaction(async trx => {
        await trx('community_resource_stats')
          .insert({ resource_type: resourceType, resource_id: resourceId })
          .onConflict([ 'resource_type', 'resource_id' ])
          .ignore();
        await trx('community_resource_actor_stats')
          .insert({ resource_type: resourceType, resource_id: resourceId, actor_key: actorKey })
          .onConflict([ 'resource_type', 'resource_id', 'actor_key' ])
          .ignore();

        const actor = await trx('community_resource_actor_stats')
          .where({ resource_type: resourceType, resource_id: resourceId, actor_key: actorKey })
          .forUpdate()
          .first();

        const isPreview = metric === 'preview';
        const countColumn = isPreview ? 'preview_count' : 'action_count';
        const firstColumn = isPreview ? 'first_preview_at' : 'first_action_at';
        const lastColumn = isPreview ? 'last_preview_at' : 'last_action_at';
        const aggregateUserColumn = isPreview ? 'preview_user_count' : 'action_user_count';
        const aggregateCountColumn = isPreview ? 'preview_count' : 'action_count';
        const previousCount = Number(actor?.[countColumn] || 0);
        const lastAt = actor?.[lastColumn] ? new Date(actor[lastColumn]).getTime() : 0;

        if (previousCount > 0 && lastAt > 0 && now.getTime() - lastAt < DEDUP_WINDOW_MS) return;

        const actorUpdate = {
          [countColumn]: trx.raw('?? + 1', [ countColumn ]),
          [lastColumn]: now,
          updated_at: now,
        };
        if (previousCount === 0) actorUpdate[firstColumn] = now;
        await trx('community_resource_actor_stats')
          .where({ resource_type: resourceType, resource_id: resourceId, actor_key: actorKey })
          .update(actorUpdate);

        const aggregateUpdate = {
          [aggregateCountColumn]: trx.raw('?? + 1', [ aggregateCountColumn ]),
          updated_at: now,
        };
        if (previousCount === 0) {
          aggregateUpdate[aggregateUserColumn] = trx.raw('?? + 1', [ aggregateUserColumn ]);
        }
        await trx('community_resource_stats')
          .where({ resource_type: resourceType, resource_id: resourceId })
          .update(aggregateUpdate);
        counted = true;
      });

      const row = await this.getKnex()('community_resource_stats')
        .where({ resource_type: resourceType, resource_id: resourceId })
        .first();
      ctx.body = { counted, stats: normalizeStats(row, resourceType, resourceId) };
    } catch (err) {
      ctx.logger.error('[hdw] community stats record error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  async query() {
    const { ctx } = this;
    const body = ctx.request.body || {};
    const requested = Array.isArray(body.resources) ? body.resources.slice(0, 500) : [];
    const resources = requested
      .map(item => ({
        resourceType: typeof item?.resourceType === 'string' ? item.resourceType.trim() : '',
        resourceId: typeof item?.resourceId === 'string' ? item.resourceId.trim() : '',
      }))
      .filter(item => RESOURCE_TYPES.has(item.resourceType) && item.resourceId && item.resourceId.length <= 512);

    if (resources.length === 0) {
      ctx.body = { stats: [] };
      return;
    }

    try {
      const k = this.getKnex();
      const rows = await k('community_resource_stats')
        .whereIn([ 'resource_type', 'resource_id' ], resources.map(item => [ item.resourceType, item.resourceId ]));
      const byKey = new Map(rows.map(row => [ `${row.resource_type}\u0000${row.resource_id}`, row ]));
      ctx.body = {
        stats: resources.map(item => normalizeStats(
          byKey.get(`${item.resourceType}\u0000${item.resourceId}`),
          item.resourceType,
          item.resourceId,
        )),
      };
    } catch (err) {
      ctx.logger.error('[hdw] community stats query error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }
}

module.exports = CommunityStatsController;

