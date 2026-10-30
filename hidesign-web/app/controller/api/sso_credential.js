'use strict';

const crypto = require('crypto');
const Controller = require('egg').Controller;
const {
  normalizeUsername,
  oaSessionCookieFromRequest,
  validateOASession,
} = require('./himind_sso');

const CIPHERTEXT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CIPHERTEXT_LENGTH = 1024;

// The daemon only holds the public key, so this endpoint is the sole place
// where a deferred Hikke/UEDRO password is unsealed. OA identity is checked
// before decryption and neither the ciphertext nor password is logged.
async function decryptCredential(controller, validateSession = validateOASession) {
  const { ctx, app } = controller;
  const body = ctx.request.body || {};
  const username = normalizeUsername(body.username);
  const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext.trim() : '';

  if (!username || !/^[a-z0-9._-]{2,100}$/.test(username)) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'FAIL', error: 'username is invalid' };
    return;
  }
  if (!ciphertext || ciphertext.length > MAX_CIPHERTEXT_LENGTH || !CIPHERTEXT_PATTERN.test(ciphertext)) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'FAIL', error: 'credential ciphertext is invalid' };
    return;
  }

  const cfg = app.config.ssoCredential || {};
  if (typeof cfg.privateKey !== 'string' || !cfg.privateKey.trim()) {
    ctx.status = 503;
    ctx.body = { code: -1, msg: 'FAIL', error: 'SSO credential decryption is not configured' };
    return;
  }

  try {
    await validateSession(oaSessionCookieFromRequest(ctx), username);
  } catch (err) {
    ctx.logger.warn('[sso-credential] OA session validation failed: %s', err.message);
    ctx.status = 401;
    ctx.body = { code: -1, msg: 'FAIL', error: 'OA session is invalid' };
    return;
  }

  try {
    const password = crypto.privateDecrypt(
      {
        key: cfg.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(ciphertext, 'base64url'),
    ).toString('utf8');
    if (!password) throw new Error('empty plaintext');
    ctx.body = { code: 0, msg: 'SUCCESS', data: { password } };
  } catch (err) {
    ctx.logger.warn('[sso-credential] credential decryption failed: %s', err.message);
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'FAIL', error: 'credential envelope is invalid' };
  }
}

class SsoCredentialController extends Controller {
  async decrypt() {
    return decryptCredential(this);
  }
}

module.exports = SsoCredentialController;
module.exports.decryptCredential = decryptCredential;
