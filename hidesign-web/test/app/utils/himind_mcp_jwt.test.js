'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { signHiMindMcpJwt } = require('../../../app/utils/himind-mcp-jwt');

function decodeJsonPart(part) {
  const padding = '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/') + padding, 'base64').toString('utf8'));
}

describe('test/app/utils/himind_mcp_jwt.test.js', () => {
  it('signs a short-lived RS256 user assertion with the agreed identity claims', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const token = signHiMindMcpJwt({
      privateKey,
      issuer: 'hidesign',
      audience: 'himind-mcp',
      keyId: 'hidesign-himind-01',
      username: 'alice',
      ttlSeconds: 300,
      nowSeconds: 1700000000,
      jti: 'ticket-1',
    });

    const [ encodedHeader, encodedPayload, encodedSignature ] = token.split('.');
    assert.deepStrictEqual(decodeJsonPart(encodedHeader), {
      alg: 'RS256',
      typ: 'himind-mcp+jwt',
      kid: 'hidesign-himind-01',
    });
    assert.deepStrictEqual(decodeJsonPart(encodedPayload), {
      iss: 'hidesign',
      aud: 'himind-mcp',
      sub: 'alice',
      username: 'alice',
      iat: 1700000000,
      nbf: 1700000000,
      exp: 1700000300,
      jti: 'ticket-1',
      amr: [ 'oa' ],
    });
    assert.strictEqual(crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      publicKey,
      Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    ), true);
  });

  it('rejects missing signing configuration and invalid usernames', () => {
    assert.throws(() => signHiMindMcpJwt({
      privateKey: '',
      issuer: 'hidesign',
      audience: 'himind-mcp',
      keyId: 'hidesign-himind-01',
      username: 'alice',
      ttlSeconds: 300,
    }), /private key/i);
    assert.throws(() => signHiMindMcpJwt({
      privateKey: 'not-used',
      issuer: 'hidesign',
      audience: 'himind-mcp',
      keyId: 'hidesign-himind-01',
      username: '../alice',
      ttlSeconds: 300,
    }), /username/i);
  });
});
