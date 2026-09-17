'use strict';

const crypto = require('crypto');
const Controller = require('egg').Controller;
const {
  firstString,
  normalizeUsername,
  oaSessionCookieFromRequest,
  validateOASession,
} = require('./himind_sso');

function aiResearchConfig(app) {
  return app.config.aiResearch || {
    baseUrl: process.env.AI_RESEARCH_BASE_URL || 'http://drw.hikvision.com/',
    ssoSecret: process.env.AI_RESEARCH_SSO_SECRET || '',
    ssoIssuer: process.env.AI_RESEARCH_SSO_ISSUER || 'hidesign-web',
    ssoAudience: process.env.AI_RESEARCH_SSO_AUDIENCE || 'design-research-workbench',
    ticketTtlSeconds: 60,
  };
}

async function issueTicket(controller, validateSession = validateOASession) {
  const { ctx, app } = controller;
  const username = normalizeUsername(ctx.request.body && ctx.request.body.username);
  if (!username || !/^[a-z0-9._-]{2,100}$/.test(username)) {
    ctx.status = 400;
    ctx.body = { code: -1, msg: 'FAIL', error: 'username is invalid' };
    return;
  }

  const cfg = aiResearchConfig(app);
  if (typeof cfg.ssoSecret !== 'string' || cfg.ssoSecret.length < 32) {
    ctx.status = 503;
    ctx.body = { code: -1, msg: 'FAIL', error: 'AI research workbench SSO is not configured' };
    return;
  }

  let info;
  try {
    info = await validateSession(oaSessionCookieFromRequest(ctx), username);
  } catch (err) {
    ctx.logger.warn('[ai-research-sso] OA session validation failed: %s', err.message);
    ctx.status = 401;
    ctx.body = { code: -1, msg: 'FAIL', error: 'OA session is invalid' };
    return;
  }

  const email = firstString(info, [ 'email', 'mail' ]);
  const displayName = firstString(info, [ 'displayName', 'display_name', 'name', 'realName' ]);
  const ttl = Number(cfg.ticketTtlSeconds) || 60;
  const ticket = app.jwt.sign({
    iss: cfg.ssoIssuer,
    aud: cfg.ssoAudience,
    sub: username,
    username,
    email,
    display_name: displayName,
    jti: crypto.randomBytes(16).toString('hex'),
  }, cfg.ssoSecret, { algorithm: 'HS256', expiresIn: ttl });
  const callback = new URL('/api/auth/platform', cfg.baseUrl);
  callback.searchParams.set('ticket', ticket);
  callback.searchParams.set('next', '/');
  ctx.body = {
    code: 0,
    msg: 'SUCCESS',
    data: { launch_url: callback.toString(), expires_in: ttl },
  };
}

class AiResearchSsoController extends Controller {
  async launch() {
    return issueTicket(this);
  }
}

module.exports = AiResearchSsoController;
module.exports.issueTicket = issueTicket;
