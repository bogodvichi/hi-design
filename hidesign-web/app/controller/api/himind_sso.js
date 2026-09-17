'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const Controller = require('egg').Controller;
const { signHiMindMcpJwt } = require('../../utils/himind-mcp-jwt');
const { serializeOASessionCookies } = require('../../utils/oa-session-cookies');

const HICOO_USERINFO_URL =
  'http://hicoo.hikvision.com.cn/ai/gateway/user/userService/v1/user/casInfo/query';
const HICOO_AES_KEY = Buffer.from('WSs5a2hJVlVGWVpWQVBQeg==', 'base64');
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=+';

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function generateHicooToken(username) {
  const randomLength = Math.max(0, 24 - username.length - 2);
  let random = '';
  for (let i = 0; i < randomLength; i++) {
    random += TOKEN_ALPHABET.charAt(Math.floor(Math.random() * TOKEN_ALPHABET.length));
  }
  const encodedUser = Buffer.from(username, 'utf8').toString('base64');
  const plaintext = `${random.slice(0, 5)}.${encodedUser}.${random.slice(5)}&${Date.now()}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', HICOO_AES_KEY, null);
  return Buffer.concat([ cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final() ]).toString('base64');
}

function firstString(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    if (typeof source[key] === 'string' && source[key].trim()) return source[key].trim();
  }
  return '';
}

function usernameFromUserInfo(info) {
  const direct = firstString(info, [
    'username', 'userName', 'user_name', 'loginName', 'login_name',
    'accountName', 'account_name', 'account', 'userCode', 'user_code',
  ]);
  if (direct) return normalizeUsername(direct);
  const email = firstString(info, [ 'email', 'mail' ]);
  if (email.includes('@')) return normalizeUsername(email.slice(0, email.indexOf('@')));
  return '';
}

function oaSessionCookieFromRequest(ctx) {
  const body = ctx.request.body || {};
  return serializeOASessionCookies(body.oa_cookies) || ctx.headers.cookie || '';
}

async function validateOASession(cookie, requestedUsername) {
  if (!cookie) throw new Error('OA session cookie is required');
  const url = `${HICOO_USERINFO_URL}?_=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      Cookie: cookie,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      token: generateHicooToken(requestedUsername),
      username: requestedUsername,
    },
    timeout: 10000,
  });
  if (!response.ok) throw new Error(`OA user info returned HTTP ${response.status}`);
  const body = await response.json();
  const info = body && body.data;
  if (!info || typeof info !== 'object') throw new Error('OA user info is unavailable');
  const verifiedUsername = usernameFromUserInfo(info);
  if (!verifiedUsername || verifiedUsername !== requestedUsername) {
    throw new Error('OA session identity does not match requested username');
  }
  return info;
}

async function issueFederatedLaunch(controller, options, validateSession = validateOASession) {
  const { ctx, app } = controller;
  const username = normalizeUsername(ctx.request.body && ctx.request.body.username);
  if (!username || !/^[a-z0-9._-]{2,100}$/.test(username)) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'FAIL', error: 'username is invalid' };
    return;
  }

  const cfg = app.config[options.configKey] || {};
  if (typeof cfg.ssoSecret !== 'string' || cfg.ssoSecret.length < 32) {
    ctx.status = 503;
    ctx.body = { code: -1, msg: 'FAIL', error: `${options.serviceName} SSO is not configured` };
    return;
  }

  let info;
  try {
    info = await validateSession(oaSessionCookieFromRequest(ctx), username);
  } catch (err) {
    ctx.logger.warn('[%s-sso] OA session validation failed: %s', options.logName, err.message);
    ctx.status = 401;
    ctx.body = { code: -1, msg: 'FAIL', error: 'OA session is invalid' };
    return;
  }

  const email = firstString(info, [ 'email', 'mail' ]);
  const displayName = firstString(info, [ 'displayName', 'display_name', 'name', 'realName' ]);
  const jti = crypto.randomBytes(16).toString('hex');
  const ttl = Number(cfg.ticketTtlSeconds) || 60;
  const ticket = app.jwt.sign({
    iss: cfg.ssoIssuer,
    aud: cfg.ssoAudience,
    sub: username,
    username,
    email,
    display_name: displayName,
    jti,
  }, cfg.ssoSecret, { algorithm: 'HS256', expiresIn: ttl });

  const callback = new URL(options.callbackPath, cfg.baseUrl);
  callback.searchParams.set('ticket', ticket);
  if (options.next) callback.searchParams.set('next', options.next);
  ctx.body = {
    code: 0,
    msg: 'SUCCESS',
    data: { launch_url: callback.toString(), expires_in: ttl },
  };
}

class HiMindSsoController extends Controller {
  async launch() {
    return issueFederatedLaunch(this, {
      configKey: 'himind',
      serviceName: 'HiMind',
      logName: 'himind',
      callbackPath: '/api/v1/auth/hidesign/callback',
    });
  }

  async mcpToken() {
    const { ctx, app } = this;
    const body = ctx.request.body || {};
    const username = normalizeUsername(body.username);
    if (!username || !/^[a-z0-9._-]{2,100}$/.test(username)) {
      ctx.status = 400;
      ctx.body = { code: -1, msg: 'FAIL', error: 'username is invalid' };
      return;
    }

    const cfg = app.config.himind || {};
    if (typeof cfg.mcpJwtPrivateKey !== 'string' || !cfg.mcpJwtPrivateKey.trim()) {
      ctx.status = 503;
      ctx.body = { code: -1, msg: 'FAIL', error: 'HiMind MCP JWT is not configured' };
      return;
    }

    try {
      await validateOASession(oaSessionCookieFromRequest(ctx), username);
    } catch (err) {
      ctx.logger.warn('[himind-mcp] OA session validation failed: %s', err.message);
      ctx.status = 401;
      ctx.body = { code: -1, msg: 'FAIL', error: 'OA session is invalid' };
      return;
    }

    try {
      const ttl = Number(cfg.mcpJwtTtlSeconds) || 300;
      const runId = typeof body.run_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(body.run_id)
        ? body.run_id
        : undefined;
      const accessToken = signHiMindMcpJwt({
        privateKey: cfg.mcpJwtPrivateKey,
        issuer: cfg.mcpJwtIssuer,
        audience: cfg.mcpJwtAudience,
        keyId: cfg.mcpJwtKeyId,
        username,
        ttlSeconds: ttl,
        runId,
      });
      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: ttl,
          iss: cfg.mcpJwtIssuer,
          aud: cfg.mcpJwtAudience,
          kid: cfg.mcpJwtKeyId,
        },
      };
    } catch (err) {
      ctx.logger.error('[himind-mcp] JWT signing failed: %s', err.message);
      ctx.status = 503;
      ctx.body = { code: -1, msg: 'FAIL', error: 'HiMind MCP JWT could not be issued' };
    }
  }
}

module.exports = HiMindSsoController;
module.exports.normalizeUsername = normalizeUsername;
module.exports.usernameFromUserInfo = usernameFromUserInfo;
module.exports.issueFederatedLaunch = issueFederatedLaunch;
module.exports.firstString = firstString;
module.exports.validateOASession = validateOASession;
module.exports.oaSessionCookieFromRequest = oaSessionCookieFromRequest;
