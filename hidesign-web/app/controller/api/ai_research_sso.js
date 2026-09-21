'use strict';

const crypto = require('crypto');
const Controller = require('egg').Controller;
const { signHiMindMcpJwt } = require('../../utils/himind-mcp-jwt');
const {
  firstString,
  normalizeUsername,
  oaSessionCookieFromRequest,
  validateOASession,
} = require('./himind_sso');

function aiResearchConfig(app) {
  return app.config.aiResearch || {
    baseUrl: process.env.AI_RESEARCH_BASE_URL || 'https://drw.hikvision.com/',
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

  async mcpToken() {
    const { ctx, app } = this;
    const body = ctx.request.body || {};
    const username = normalizeUsername(body.username);
    if (!username || !/^[a-z0-9._-]{2,100}$/.test(username)) {
      ctx.status = 400;
      ctx.body = { code: -1, msg: 'FAIL', error: 'username is invalid' };
      return;
    }

    const cfg = app.config.aiResearch || {};
    if (typeof cfg.mcpJwtPrivateKey !== 'string' || !cfg.mcpJwtPrivateKey.trim()) {
      ctx.status = 503;
      ctx.body = { code: -1, msg: 'FAIL', error: 'AI research MCP JWT is not configured' };
      return;
    }

    try {
      await validateOASession(oaSessionCookieFromRequest(ctx), username);
    } catch (err) {
      ctx.logger.warn('[ai-research-mcp] OA session validation failed: %s', err.message);
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
        type: cfg.mcpJwtType,
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
      ctx.logger.error('[ai-research-mcp] JWT signing failed: %s', err.message);
      ctx.status = 503;
      ctx.body = { code: -1, msg: 'FAIL', error: 'AI research MCP JWT could not be issued' };
    }
  }
}

module.exports = AiResearchSsoController;
module.exports.issueTicket = issueTicket;
