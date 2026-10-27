// The backfill planner must be offline-safe. It must never connect to HDW
// while imported or touch any real user resources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planResourceNames, normalizedName, run } =
  require('../../../../scripts/resource-name-registry-backfill.js');

test('normalizes Unicode names consistently and reports legacy duplicates without renaming them', () => {
  const rows = [
    { id: 'alice-skill', kind: 'skill', scope: null, metadata: { title: ' Ｍｅｍｏｒｙ ' } },
    { id: 'bob-skill', kind: 'skill', scope: null, metadata: { title: 'memory' } },
    { id: 'mcp', kind: 'mcp', scope: null, metadata: { label: 'memory' } },
    { id: 'reference', kind: 'skill', scope: 'public', metadata: { title: 'memory', communitySourceResourceId: 'alice-skill' } },
    { id: 'import', kind: 'mcp', scope: 'public', metadata: { label: 'Standalone', publicationSourceType: 'local_import' } },
    { id: 'legacy', kind: 'skill', scope: 'public', metadata: { title: 'Unknown origin' } },
    { id: 'unknown', kind: 'skill', scope: null, metadata: {} },
    { id: 'old-deleted', kind: 'mcp', scope: null, deleted_at: '2026-01-01', metadata: { label: 'Deleted' } },
  ];
  const plan = planResourceNames(rows);
  assert.equal(normalizedName('skill', rows[0].metadata), 'memory');
  assert.equal(plan.summary.totalClaims, 5);
  assert.deepEqual(plan.summary.typeCounts, { skill: 3, mcp: 2 });
  assert.equal(plan.summary.duplicateGroups, 1);
  assert.equal(plan.summary.duplicateRecords, 1);
  assert.equal(plan.summary.missingName, 1);
  assert.equal(plan.summary.referencePublications, 1);
  assert.equal(plan.summary.legacyPublic, 1);
  assert.equal(plan.claims.filter(x => x.normalizedName === 'memory').length, 3);
  assert.equal(plan.claims.some(x => x.resourceId === 'reference'), false);
});

test('no mutation is possible without explicit apply plus backup confirmation', async () => {
  await assert.rejects(() => run(['--apply']), /--backup-confirmed/);
  await assert.rejects(() => run([]), /Specify --plan/);
});
