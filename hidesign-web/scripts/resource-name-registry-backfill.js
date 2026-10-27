'use strict';

// Offline-safe planner and explicit production migration runner.
// Usage:
//  HDW_NAME_REGISTRY_DATABASE_URL=... node scripts/resource-name-registry-backfill.js --plan
//  [after DB backup, applying 020 SQL and confirming plan]
//  HDW_NAME_REGISTRY_DATABASE_URL=... node scripts/resource-name-registry-backfill.js --apply --backup-confirmed
// No automatic connection or write on import, startup, or tests.

function metadataOf(row) {
  try { return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); }
  catch { return {}; }
}
function normalizedName(kind, meta) {
  const raw = kind === 'skill'
    ? (meta.title || meta.name || meta.localId || meta.label)
    : (meta.label || meta.title);
  return typeof raw === 'string' ? raw.normalize('NFKC').trim().toLocaleLowerCase('en') : '';
}
function planResourceNames(rows) {
  const claims = [];
  const typeCounts = { skill: 0, mcp: 0 };
  let missingName = 0;
  let referencePublications = 0;
  let legacyPublic = 0;
  const multiplicity = new Map();
  for (const row of rows) {
    if (row.deleted_at || !['skill', 'mcp'].includes(row.kind)) continue;
    const meta = metadataOf(row);
    if (typeof meta.communitySourceResourceId === 'string' && meta.communitySourceResourceId.trim()) {
      referencePublications++;
      continue;
    }
    const name = normalizedName(row.kind, meta);
    if (!name) { missingName++; continue; }
    if (row.scope === 'public' && meta.publicationSourceType !== 'local_import') legacyPublic++;
    typeCounts[row.kind]++;
    claims.push({ resourceId: row.id, kind: row.kind, normalizedName: name });
    const key = row.kind + '\0' + name;
    multiplicity.set(key, (multiplicity.get(key) || 0) + 1);
  }
  return {
    claims,
    summary: {
      totalClaims: claims.length,
      typeCounts,
      missingName,
      referencePublications,
      legacyPublic,
      duplicateGroups: [...multiplicity.values()].filter(x => x > 1).length,
      duplicateRecords: [...multiplicity.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0),
    },
  };
}

async function run(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  if (apply && !argv.includes('--backup-confirmed')) {
    throw new Error('Apply requires --backup-confirmed after a verified database backup and SQL schema upgrade');
  }
  if (!apply && (argv.length !== 1 || argv[0] !== '--plan')) {
    throw new Error('Specify --plan (read-only) or --apply --backup-confirmed');
  }
  const url = process.env.HDW_NAME_REGISTRY_DATABASE_URL;
  if (!url) throw new Error('Explicit HDW_NAME_REGISTRY_DATABASE_URL is required');
  const { Client } = require('pg');
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    if (apply) {
      await db.query('BEGIN');
      // Exclusively hold resource writes while calculating names and seeding claims.
      await db.query('LOCK TABLE resources IN SHARE ROW EXCLUSIVE MODE');
      const table = await db.query("SELECT to_regclass('public.resource_name_registry') AS claims, to_regclass('public.resource_name_registry_state') AS state");
      if (!table.rows[0]?.claims || !table.rows[0]?.state) {
        throw new Error('Migration 020 schema missing; refusing to write');
      }
    }
    const { rows } = await db.query("SELECT id, kind, metadata, scope, deleted_at FROM resources WHERE kind IN ('skill', 'mcp') AND deleted_at IS NULL");
    const plan = planResourceNames(rows);
    // Log aggregate counts, never names, metadata, credentials, or addresses.
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', ...plan.summary }, null, 2));
    if (apply) {
      if (plan.summary.missingName > 0) throw new Error('Active resources without names require review before enabling registry');
      for (let index = 0; index < plan.claims.length; index += 350) {
        const batch = plan.claims.slice(index, index + 350);
        await db.query(`
          INSERT INTO resource_name_registry (resource_id, kind, normalized_name)
          SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
          ON CONFLICT (resource_id) DO UPDATE
            SET kind = EXCLUDED.kind, normalized_name = EXCLUDED.normalized_name
        `, [batch.map(x => x.resourceId), batch.map(x => x.kind), batch.map(x => x.normalizedName)]);
      }
      const { rows: [check] } = await db.query("SELECT COUNT(*)::integer AS total FROM resource_name_registry");
      if (check.total !== plan.claims.length) throw new Error('Registry claim count mismatch; rolling back');
      await db.query("UPDATE resource_name_registry_state SET ready = TRUE, updated_at = NOW() WHERE id = 'global'");
      await db.query('COMMIT');
      console.log(JSON.stringify({ success: true, seededClaims: plan.claims.length }));
    }
  } catch (err) {
    if (apply) await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}
if (require.main === module) {
  run().catch(error => { console.error('Registry backfill failed:', error.message); process.exitCode = 1; });
}
module.exports = { metadataOf, normalizedName, planResourceNames, run };
