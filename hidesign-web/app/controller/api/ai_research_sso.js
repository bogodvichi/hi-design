'use strict';

const Controller = require('egg').Controller;
const { signHiMindMcpJwt } = require('../../utils/himind-mcp-jwt');
const {
  issueFederatedLaunch,
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

// Both tools share OA validation, ticket signing and error semantics. Only the
// platform configuration differs; no signing keys are copied to the client.
async function issueTicket(controller, validateSession = validateOASession) {
  return issueFederatedLaunch(controller, {
    configKey: 'aiResearch',
    config: aiResearchConfig(controller.app),
    serviceName: 'AI research workbench',
    logName: 'ai-research',
    callbackPath: '/api/auth/platform',
    next: '/',
  }, validateSession);
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
