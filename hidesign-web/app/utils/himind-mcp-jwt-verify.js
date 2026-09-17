'use strict';

const crypto = require('crypto');

function decodeBase64UrlJson(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('JWT segment is invalid');
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return JSON.parse(Buffer.from(
    value.replace(/-/g, '+').replace(/_/g, '/') + padding,
    'base64'
  ).toString('utf8'));
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('JWT signature is invalid');
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + padding, 'base64');
}

function verifyHiMindMcpJwt(token, options) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Error('JWT format is invalid');
  const [ encodedHeader, encodedPayload, encodedSignature ] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload);
  const nowSeconds = Number.isFinite(options.nowSeconds)
    ? Math.floor(options.nowSeconds)
    : Math.floor(Date.now() / 1000);
  const clockSkewSeconds = Number.isFinite(options.clockSkewSeconds)
    ? Math.max(0, Math.floor(options.clockSkewSeconds))
    : 30;

  if (header.alg !== 'RS256') throw new Error('JWT alg must be RS256');
  if (header.typ !== 'himind-mcp+jwt') throw new Error('JWT typ is invalid');
  if (header.kid !== options.keyId) throw new Error('JWT kid is invalid');
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    options.publicKey,
    decodeBase64Url(encodedSignature)
  );
  if (!verified) throw new Error('JWT signature is invalid');

  if (payload.iss !== options.issuer) throw new Error('JWT iss is invalid');
  if (payload.aud !== options.audience) throw new Error('JWT aud is invalid');
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.nbf) || !Number.isInteger(payload.exp)) {
    throw new Error('JWT time claims are invalid');
  }
  if (payload.nbf !== payload.iat) throw new Error('JWT nbf must equal iat');
  if (payload.iat > nowSeconds + clockSkewSeconds) throw new Error('JWT iat is in the future');
  if (payload.nbf > nowSeconds + clockSkewSeconds) throw new Error('JWT is not active');
  if (payload.exp <= nowSeconds - clockSkewSeconds) throw new Error('JWT is expired');
  if (payload.exp <= payload.iat || payload.exp - payload.iat > 300) {
    throw new Error('JWT lifetime is invalid');
  }
  if (typeof payload.username !== 'string' || !/^[a-z0-9._-]{2,100}$/.test(payload.username)) {
    throw new Error('JWT username is invalid');
  }
  if (payload.sub !== payload.username) throw new Error('JWT sub is invalid');
  if (!Array.isArray(payload.amr) || payload.amr.length !== 1 || payload.amr[0] !== 'oa') {
    throw new Error('JWT amr is invalid');
  }
  if (typeof payload.jti !== 'string' || !payload.jti) throw new Error('JWT jti is invalid');
  return payload;
}

module.exports = { verifyHiMindMcpJwt };
