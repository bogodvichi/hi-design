// @ts-nocheck
// The HDW controller's actual policy exercised against isolated in-memory tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const nodeRequire = createRequire(import.meta.url);
const controllerSource = readFileSync(new URL('../../../../app/controller/api/resource.js', import.meta.url), 'utf8');
const module = { exports: {} };
runInNewContext(controllerSource, {
  module, Buffer,
  require(name) {
    if (name === 'egg') return { Controller: class {} };
    if (name === '../../utils/knex.js') return { createKnex() { throw new Error('Live database forbidden'); } };
    if (name === '../../utils/blob-store.js') return { exists: async () => true, writeBlob: async () => {} };
    if (name === 'node:crypto' || name === 'node:path') return nodeRequire(name);
    throw Error('Unexpected module: ' + name);
  },
});
const ResourceController = module.exports;

function fixture(seed = [], { ready = true } = {}) {
  const resources = [...seed];
  const claims = seed.filter(row => !row.deleted_at && ['skill', 'mcp'].includes(row.kind)
    && !metaOf(row).communitySourceResourceId).map(row => ({
      resource_id: row.id, kind: row.kind,
      normalized_name: nameOf(row.kind, metaOf(row)),
    }));
  const registryState = [{ id: 'global', ready }];
  const locks = [];
  const db = (table) => {
    // Manifest-entry blobs use a separate immutable content-addressed table.
    // This no-op store lets us exercise old-client version updates with no I/O.
    if (table === 'blobs' || table === 'workspace_blob_refs') return {
      insert() { return { onConflict() { return { ignore: async () => {} }; } }; },
    };
    const rows = table === 'resources' ? resources
      : table === 'resource_name_registry' ? claims
        : table === 'resource_name_registry_state' ? registryState : null;
    assert.ok(rows, 'unexpected table: ' + table);
    const filters = {};
    const notFilters = {};
    let active = false;
    let refSource = null;
    const matching = () => rows.filter(row =>
      Object.entries(filters).every(([key, value]) => row[key] === value)
      && Object.entries(notFilters).every(([key, value]) => row[key] !== value)
      && (!active || row.deleted_at == null)
      && (refSource === null || metaOf(row).communitySourceResourceId === refSource));
    return {
      where(fields) { Object.assign(filters, fields); return this; },
      whereNot(key, value) { notFilters[key] = value; return this; },
      whereRaw(sql, values) {
        assert.match(sql, /communitySourceResourceId/);
        refSource = values[0];
        return this;
      },
      whereNull(field) { if (field === 'deleted_at') active = true; return this; },
      forUpdate() { return this; },
      async first() { return matching()[0] ? { ...matching()[0] } : undefined; },
      async select() { throw new Error('Full table scan forbidden in name validation'); },
      insert(fields) {
        const prior = table === 'resources' ? rows.find(row => row.id === fields.id) : null;
        if (!prior) rows.push({ ...fields, ...(table === 'resources' ? { deleted_at: null } : {}) });
        return {
          onConflict() {
            return { async merge(changes) { if (prior) Object.assign(prior, changes); } };
          },
        };
      },
      async update(fields) {
        const list = matching();
        for (const row of list) Object.assign(row, fields);
        return list.length;
      },
      async del() {
        const targets = new Set(matching());
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (targets.has(rows[i])) {
            if (table === 'resources') {
              for (let j = claims.length - 1; j >= 0; j--) {
                if (claims[j].resource_id === rows[i].id) claims.splice(j, 1);
              }
            }
            rows.splice(i, 1);
          }
        }
        return before - rows.length;
      },
    };
  };
  db.raw = async (sql, params) => { locks.push([sql, params]); return { rows: [] }; };
  db.transaction = async fn => fn(db);
  async function call(operation, workspaceId, resourceId, body = {}, query = {}) {
    const ctrl = new ResourceController();
    ctrl.ctx = {
      params: { workspaceId, resourceId }, request: { body }, query,
      logger: { error(_label, e) { throw e; } },
    };
    ctrl.getKnex = () => db;
    if (operation === 'publish') {
      ctrl._nextVersionNumber = async () => 1;
      ctrl._commitVersion = async () => 'offline-test-version';
    }
    await ctrl[operation]();
    return ctrl.ctx;
  }
  return { resources, claims, call, locks };
}
const metaOf = row => typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
const nameOf = (kind, meta) => {
  const raw = kind === 'skill' ? (meta.title || meta.name || meta.localId || meta.label) : (meta.label || meta.title);
  return typeof raw === 'string' ? raw.normalize('NFKC').trim().toLocaleLowerCase('en') : '';
};


test('globally unique logical Skill/MCP names across owners and workspaces', async () => {
  const f = fixture();
  const first = await f.call('create', 'personal', '', {
    kind: 'skill', ownerMemberId: 'alice', metadata: { title: ' Ｍｅｍｏｒｙ ' },
  });
  assert.equal(first.body.code, 0);
  const second = await f.call('create', 'team', '', {
    kind: 'skill', ownerMemberId: 'bob', metadata: { title: 'memory' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'RESOURCE_NAME_CONFLICT');
  const otherKind = await f.call('create', 'team', '', {
    kind: 'mcp', ownerMemberId: 'bob', metadata: { label: 'memory' },
  });
  assert.equal(otherKind.body.code, 0);
  assert.equal(f.resources.length, 2);
  assert.ok(f.locks.every(([sql]) => sql.includes('pg_advisory_xact_lock')));
});

test('reference snapshots do not occupy source names; duplicate active publications are blocked', async () => {
  const f = fixture();
  const source = await f.call('create', 'personal', '', {
    kind: 'skill', ownerMemberId: 'alice', metadata: { title: 'Workflow' },
  });
  const sourceId = source.body.data.resource.id;
  const publication = await f.call('create', 'personal', '', {
    kind: 'skill', ownerMemberId: 'alice', scope: 'public',
    metadata: { title: 'Workflow', communitySourceResourceId: sourceId, publicationSourceType: 'reference' },
  });
  assert.equal(publication.body.code, 0);
  assert.notEqual(publication.body.data.resource.id, sourceId);
  const duplicate = await f.call('create', 'personal', '', {
    kind: 'skill', ownerMemberId: 'alice', scope: 'public',
    metadata: { title: 'Workflow', communitySourceResourceId: sourceId, publicationSourceType: 'reference' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'RESOURCE_ALREADY_PUBLISHED');

  const deny = await f.call('remove', 'personal', sourceId);
  assert.equal(deny.status, 409);
  assert.equal(deny.body.error, 'SOURCE_HAS_PUBLICATION');
  assert.equal(f.resources.length, 2);

  const publicId = publication.body.data.resource.id;
  const cancelled = await f.call('remove', 'personal', publicId);
  assert.equal(cancelled.body.code, 0);
  assert.equal(f.resources.length, 1);
  assert.equal(f.resources[0].id, sourceId);
  const removedSource = await f.call('remove', 'personal', sourceId);
  assert.equal(removedSource.body.code, 0);
  assert.equal(f.resources.length, 0);
});

test('local imported publication consumes name until cancelled then frees it', async () => {
  const f = fixture();
  const created = await f.call('create', 'personal', '', {
    kind: 'mcp', ownerMemberId: 'alice', scope: 'public',
    metadata: { label: 'Indexer', publicationSourceType: 'local_import' },
  });
  const occupied = await f.call('check', 'team', '', {}, { kind: 'mcp', name: 'indexer' });
  assert.equal(occupied.body.exists, true);
  const blocked = await f.call('create', 'team', '', {
    kind: 'mcp', ownerMemberId: 'bob', metadata: { label: ' INDEXER ' },
  });
  assert.equal(blocked.status, 409);
  const cancelled = await f.call('remove', 'personal', created.body.data.resource.id);
  assert.equal(cancelled.body.code, 0);
  const released = await f.call('check', 'team', '', {}, { kind: 'mcp', name: 'Indexer' });
  assert.equal(released.body.exists, false);
  const fresh = await f.call('create', 'team', '', {
    kind: 'mcp', ownerMemberId: 'bob', metadata: { label: 'indexer' },
  });
  assert.equal(fresh.body.code, 0);
});

test('legacy directly published source must be unpublished before deletion', async () => {
  const f = fixture([{
    id: 'legacy', kind: 'mcp', workspace_id: 'team',
    owner_member_id: 'bob', metadata: JSON.stringify({ label: 'Legacy' }),
    scope: 'public', deleted_at: null,
  }]);
  const deleteAttempt = await f.call('remove', 'team', 'legacy');
  assert.equal(deleteAttempt.status, 409);
  assert.equal(deleteAttempt.body.error, 'SOURCE_HAS_PUBLICATION');
  assert.equal(f.resources.length, 1);
});

test('old Skill clients can publish new versions without resending metadata', async () => {
  const f = fixture();
  const created = await f.call('create', 'team', '', {
    kind: 'skill', ownerMemberId: 'alice', metadata: { title: 'legacy-skill' },
  });
  assert.equal(created.body.code, 0);
  const id = created.body.data.resource.id;
  const result = await f.call('publish', 'team', id, {
    kind: 'skill', ownerMemberId: 'alice', manifest: { entries: [] }, ref: 'published',
  });
  assert.equal(result.body.version, 1);
  assert.equal(result.body.missingBlobs.length, 0);
  assert.equal(f.claims.find(row => row.resource_id === id).normalized_name, 'legacy-skill');
  assert.equal(metaOf(f.resources[0]).title, 'legacy-skill');
});

test('legacy duplicate names remain editable while new sources cannot reuse them', async () => {
  const f = fixture([
    { id: 'alice-old', kind: 'mcp', workspace_id: 'personal', owner_member_id: 'alice',
      metadata: JSON.stringify({ label: 'Repeated' }), deleted_at: null, scope: null },
    { id: 'bob-old', kind: 'mcp', workspace_id: 'team', owner_member_id: 'bob',
      metadata: JSON.stringify({ label: 'repeated' }), deleted_at: null, scope: null },
  ]);
  const updated = await f.call('update', 'personal', 'alice-old', {
    metadata: { label: 'Repeated', description: 'Safe update' },
  });
  assert.equal(updated.body.code, 0);
  const blocked = await f.call('create', 'another', '', {
    kind: 'mcp', ownerMemberId: 'new-owner', metadata: { label: 'Repeated' },
  });
  assert.equal(blocked.status, 409);
  const rename = await f.call('update', 'personal', 'alice-old', {
    metadata: { label: 'Unique now' },
  });
  assert.equal(rename.body.code, 0);
  assert.equal(f.claims.find(row => row.resource_id === 'alice-old').normalized_name, 'unique now');
  assert.equal(f.claims.find(row => row.resource_id === 'bob-old').normalized_name, 'repeated');
});

test('name registry readiness blocks new writes before safe backfill', async () => {
  const f = fixture([], { ready: false });
  const rejected = await f.call('create', 'team', '', {
    kind: 'skill', ownerMemberId: 'alice', metadata: { title: 'New source' },
  });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.error, 'RESOURCE_NAME_REGISTRY_NOT_READY');
  assert.equal(f.resources.length, 0);
  const check = await f.call('check', 'team', '', {}, { kind: 'skill', name: 'New source' });
  assert.equal(check.status, 503);
});

test('cannot repoint an existing community reference to a different source', async () => {
  const f = fixture();
  const sourceA = await f.call('create', 'team', '', { kind: 'mcp', ownerMemberId: 'alice', metadata: { label: 'One' } });
  const sourceB = await f.call('create', 'team', '', { kind: 'mcp', ownerMemberId: 'alice', metadata: { label: 'Two' } });
  const published = await f.call('create', 'team', '', {
    kind: 'mcp', ownerMemberId: 'alice', scope: 'public',
    metadata: { label: 'One', publicationSourceType: 'reference', communitySourceResourceId: sourceA.body.data.resource.id },
  });
  const changed = await f.call('update', 'team', published.body.data.resource.id, {
    metadata: { label: 'One', publicationSourceType: 'reference', communitySourceResourceId: sourceB.body.data.resource.id },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'RESOURCE_IDENTITY_CONFLICT');
});

