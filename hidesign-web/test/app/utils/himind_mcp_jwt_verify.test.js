'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { signHiMindMcpJwt } = require('../../../app/utils/himind-mcp-jwt');
const { verifyHiMindMcpJwt } = require('../../../app/utils/himind-mcp-jwt-verify');

describe('test/app/utils/himind_mcp_jwt_verify.test.js', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  function token() {
    return signHiMindMcpJwt({
      privateKey: keys.privateKey,
      issuer: 'hidesign',
      audience: 'himind-mcp',
      keyId: 'hidesign-himind-01',
      username: 'alice',
      ttlSeconds: 300,
      nowSeconds: 1700000000,
      jti: 'request-1',
    });
  }

  function verifyOptions(overrides = {}) {
    return {
      publicKey: keys.publicKey,
      issuer: 'hidesign',
      audience: 'himind-mcp',
      keyId: 'hidesign-himind-01',
      nowSeconds: 1700000100,
      clockSkewSeconds: 0,
      ...overrides,
    };
  }

  it('accepts the exact HiMind JWT contract', () => {
    const payload = verifyHiMindMcpJwt(token(), verifyOptions());
    assert.strictEqual(payload.username, 'alice');
    assert.deepStrictEqual(payload.amr, [ 'oa' ]);
    assert.strictEqual(payload.nbf, payload.iat);
  });

  it('rejects an expired token and a mismatched key id', () => {
    assert.throws(
      () => verifyHiMindMcpJwt(token(), verifyOptions({ nowSeconds: 1700000301 })),
      /expired/i
    );
    assert.throws(
      () => verifyHiMindMcpJwt(token(), verifyOptions({ keyId: 'other-key' })),
      /kid/i
    );
  });
});
