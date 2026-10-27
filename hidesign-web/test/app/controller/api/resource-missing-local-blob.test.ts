// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL('../../../../app/controller/api/resource.js', import.meta.url), 'utf8');
const module = { exports: {} };
const missingFile = new Error("ENOENT: no such file or directory, open '/Users/developer/project/data/blobs/ab/private'");
missingFile.code = 'ENOENT';
runInNewContext(source, {
  module,
  require(id) {
    if (id === 'egg') return { Controller: class {} };
    if (id === '../../utils/knex.js') return { createKnex() { throw new Error('Real database forbidden'); } };
    if (id === '../../utils/blob-store.js') return { async readBlob() { throw missingFile; } };
    if (id === 'node:crypto' || id === 'node:path') return nodeRequire(id);
    throw Error('Unexpected module: ' + id);
  },
}, { filename: 'resource.js' });

test('missing local historical manifest returns safe recoverable status without leaking the filesystem path', async () => {
  const ctrl = new module.exports();
  ctrl.ctx = {
    params: { resourceId: 'existing-skill', workspaceId: 'test-team' },
    request: { body: { ref: 'published' } },
    logger: { error() { throw Error('Unexpected unsafe internal_error'); }, warn() {} },
  };
  ctrl.getKnex = () => (name) => {
    assert.equal(name, 'resource_refs as rr');
    return {
      join() { return this; },
      where() { return this; },
      select() { return this; },
      async first() { return { version: 1, version_id: 'v1', manifest_digest: 'a'.repeat(64) }; },
    };
  };
  await ctrl.materialize();
  assert.equal(ctrl.ctx.status, 503);
  assert.equal(ctrl.ctx.body.error, 'local_blob_unavailable');
  assert.doesNotMatch(JSON.stringify(ctrl.ctx.body), /ENOENT|\/Users\/|blobs\/ab/);
});
