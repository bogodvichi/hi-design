import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);

function validator(info: unknown) {
  const module = { exports: {} as any };
  runInNewContext(readFileSync(new URL('../../../../app/controller/api/himind_sso.js', import.meta.url), 'utf8'), {
    module, Buffer,
    require(id: string) {
      if (id === 'crypto') return require(id);
      if (id === 'node-fetch') return async () => ({ ok: true, json: async () => ({ data: info }) });
      if (id === 'egg') return { Controller: class {} };
      if (id === '../../utils/himind-mcp-jwt') return {};
      if (id === '../../utils/oa-session-cookies') return {};
      throw new Error(id);
    },
  });
  return module.exports.validateOASession;
}

test('Cookie-only OA verification returns the provider identity without a username hint', async () => {
  const info = { userName: 'Alice' };
  assert.equal(await validator(info)('session=fake', ''), info);
});

test('OA verification still rejects a claimed username that differs from the provider identity', async () => {
  await assert.rejects(validator({ username: 'alice' })('session=fake', 'bob'), /identity does not match/);
});

test('Cookie-only OA verification rejects a response with no account identity', async () => {
  await assert.rejects(validator({ displayName: 'Alice' })('session=fake', ''), /identity does not match/);
  await assert.rejects(validator(null)('session=fake', ''), /unavailable/);
});
