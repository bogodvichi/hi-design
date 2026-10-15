import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { issueFederatedLaunch } = require('../../../../app/controller/api/himind_sso.js');
const secret = 'test-shared-secret-longer-than-thirty-two-characters';
const options = { configKey: 'himind', serviceName: 'HiMind', logName: 'himind', callbackPath: '/api/v1/auth/hidesign/callback' };

async function issue(parentOrigin?: unknown, allowedOrigins: string[] = [], validOA = true) {
  let signed = false;
  const controller = {
    app: {
      config: { himind: { baseUrl: 'https://himind.example', ssoSecret: secret, ssoIssuer: 'hidesign-web', ssoAudience: 'himind', parentOrigins: allowedOrigins, ticketTtlSeconds: 60 } },
      jwt: { sign(payload: object, key: string, opts: object) { signed = true; return jwt.sign(payload, key, opts); } },
    },
    ctx: {
      request: { body: { username: 'Alice', oa_cookies: [{ name: 'oa', value: 'opaque' }], ...(parentOrigin !== undefined ? { parent_origin: parentOrigin } : {}) } },
      headers: {}, logger: { warn() {} }, status: 200,
      body: {} as { code?: number; error?: string; data?: { launch_url: string } },
    },
  };
  await issueFederatedLaunch(controller, options, async () => {
    if (!validOA) throw new Error('invalid OA session');
    return { email: 'alice@hikvision.com', displayName: 'Alice' };
  });
  const url = controller.ctx.body.data?.launch_url;
  const ticket = url ? new URL(url).searchParams.get('ticket') : null;
  const claims = ticket ? jwt.verify(ticket, secret, { algorithms: ['HS256'], issuer: 'hidesign-web', audience: 'himind' }) : undefined;
  return { ...controller.ctx, signed, claims, ticket, url };
}

test('signs the exact dynamic origin for each desktop launch', async () => {
  for (const origin of ['http://127.0.0.1:50023', 'http://127.0.0.1:50123', 'http://localhost:60123', 'http://[::1]:60123', 'https://127.0.0.1:60123']) {
    const result = await issue(origin);
    assert.equal(result.status, 200);
    assert.equal(result.claims.parent_origin, origin);
    assert.equal(result.claims.sub, 'alice');
    assert.equal(result.claims.aud, 'himind');
    assert.equal(result.claims.exp - result.claims.iat, 60);
    assert.equal(new URL(result.url!).searchParams.has('parent_origin'), false);
  }
});

test('supports hosted UI origins only when explicitly configured', async () => {
  assert.equal((await issue('https://design.example')).status, 403);
  const allowed = await issue('https://design.example', ['https://design.example']);
  assert.equal(allowed.claims.parent_origin, 'https://design.example');
  assert.equal((await issue('https://design.example.attacker.example', ['https://design.example'])).status, 403);
});

test('origin is integrity protected by the existing ticket signature', async () => {
  const result = await issue('http://127.0.0.1:50023');
  const parts = result.ticket!.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  payload.parent_origin = 'https://attacker.example';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.throws(() => jwt.verify(parts.join('.'), secret, { algorithms: ['HS256'] }), /invalid signature/);
});

test('preserves standalone launches without granting a directory parent origin', async () => {
  const result = await issue();
  assert.equal(result.status, 200);
  assert.equal(result.claims.parent_origin, undefined);
});

for (const origin of ['null', '*', 'file:///tmp/page', 'https://user:pass@design.example', 'http://127.0.0.1:50023/path', 'http://127.0.0.1:50023?x=1', 'http://127.0.0.1:50023#x', 123, null]) {
  test(`rejects malformed parent origin ${JSON.stringify(origin)} without signing`, async () => {
    const result = await issue(origin);
    assert.equal(result.status, 400);
    assert.equal(result.signed, false);
  });
}
for (const origin of ['http://localhost.attacker.example:50023', 'http://127.0.0.1.attacker.example:50023', 'http://0.0.0.0:50023', 'https://attacker.example']) {
  test(`rejects untrusted parent origin ${origin}`, async () => {
    const result = await issue(origin);
    assert.equal(result.status, 403);
    assert.equal(result.signed, false);
  });
}

test('does not sign an origin for an invalid OA session', async () => {
  const result = await issue('http://127.0.0.1:50023', [], false);
  assert.equal(result.status, 401);
  assert.equal(result.signed, false);
});
