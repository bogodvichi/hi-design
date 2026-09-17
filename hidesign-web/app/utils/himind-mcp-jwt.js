'use strict';

const crypto = require('crypto');

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signHiMindMcpJwt(options) {
  const privateKey = options && options.privateKey;
  const issuer = typeof options.issuer === 'string' ? options.issuer.trim() : '';
  const audience = typeof options.audience === 'string' ? options.audience.trim() : '';
  const keyId = typeof options.keyId === 'string' ? options.keyId.trim() : '';
  // The JWT `typ` header distinguishes the destination MCP service so a token
  // minted for one audience cannot be replayed against another. HiMind keeps
  // the historical `himind-mcp+jwt`; the AI research workbench uses its own
  // `fde-research-mcp+jwt`. Both are signed with the same RSA key pair.
  const type = typeof options.type === 'string' && options.type.trim()
    ? options.type.trim()
    : 'himind-mcp+jwt';
  const username = typeof options.username === 'string' ? options.username.trim().toLowerCase() : '';
  const ttlSeconds = Number(options.ttlSeconds);
  if (!privateKey) throw new Error('HiMind MCP JWT private key is required');
  if (!issuer) throw new Error('HiMind MCP JWT issuer is required');
  if (!audience) throw new Error('HiMind MCP JWT audience is required');
  if (!keyId) throw new Error('HiMind MCP JWT key id is required');
  if (!/^[a-z0-9._-]{2,100}$/.test(username)) {
    throw new Error('HiMind MCP JWT username is invalid');
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
    throw new Error('HiMind MCP JWT ttlSeconds must be between 30 and 900');
  }

  const nowSeconds = Number.isFinite(options.nowSeconds)
    ? Math.floor(options.nowSeconds)
    : Math.floor(Date.now() / 1000);
  const jti = typeof options.jti === 'string' && options.jti.trim()
    ? options.jti.trim()
    : crypto.randomBytes(16).toString('hex');
  const header = { alg: 'RS256', typ: type, kid: keyId };
  const payload = {
    iss: issuer,
    aud: audience,
    sub: username,
    username,
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + Math.floor(ttlSeconds),
    jti,
    amr: [ 'oa' ],
  };
  if (typeof options.runId === 'string' && options.runId.trim()) {
    payload.run_id = options.runId.trim();
  }
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'utf8'),
    privateKey
  );
  return `${signingInput}.${base64Url(signature)}`;
}

module.exports = { signHiMindMcpJwt };
