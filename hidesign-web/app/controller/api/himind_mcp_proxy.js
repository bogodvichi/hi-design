'use strict';

const https = require('https');
const Controller = require('egg').Controller;
const { verifyHiMindMcpJwt } = require('../../utils/himind-mcp-jwt-verify');
const MCP_AGENT = Symbol('himindMcpAgent');

const REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
];
const RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
  'retry-after',
];

function bearerToken(value) {
  const match = typeof value === 'string' ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  return match ? match[1] : '';
}

function selectedHeaders(source, names) {
  const headers = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string' && value) headers[name] = value;
  }
  return headers;
}

function requestBody(ctx) {
  if (ctx.method === 'GET' || ctx.method === 'DELETE') return null;
  if (Buffer.isBuffer(ctx.request.body)) return ctx.request.body;
  if (typeof ctx.request.body === 'string') return Buffer.from(ctx.request.body);
  return Buffer.from(JSON.stringify(ctx.request.body == null ? {} : ctx.request.body));
}

function mcpAgent(app, ca) {
  if (!app[MCP_AGENT]) {
    app[MCP_AGENT] = new https.Agent({
      keepAlive: true,
      ca,
      rejectUnauthorized: true,
    });
  }
  return app[MCP_AGENT];
}

class HiMindMcpProxyController extends Controller {
  async forward() {
    const { ctx, app } = this;
    const cfg = app.config.himind || {};
    const method = String(ctx.method || '').toUpperCase();
    if (![ 'GET', 'POST', 'DELETE' ].includes(method)) {
      ctx.status = 405;
      ctx.body = { error: 'method not allowed' };
      return;
    }
    if (!cfg.mcpCaCertificate) {
      ctx.status = 503;
      ctx.body = { error: 'HiMind MCP internal CA is not configured' };
      return;
    }
    const token = bearerToken(ctx.headers.authorization);
    try {
      verifyHiMindMcpJwt(token, {
        publicKey: cfg.mcpJwtPublicKey,
        issuer: cfg.mcpJwtIssuer,
        audience: cfg.mcpJwtAudience,
        keyId: cfg.mcpJwtKeyId,
      });
    } catch (err) {
      ctx.logger.warn('[himind-mcp-proxy] rejected JWT: %s', err.message);
      ctx.status = 401;
      ctx.body = { error: 'HiMind MCP authorization is invalid' };
      return;
    }

    const target = new URL(cfg.mcpUpstreamUrl);
    const body = requestBody(ctx);
    const headers = selectedHeaders(ctx.headers, REQUEST_HEADERS);
    if (body) headers['content-length'] = String(body.length);
    const agent = mcpAgent(app, cfg.mcpCaCertificate);

    await new Promise(resolve => {
      let responseStarted = false;
      const upstream = https.request(target, {
        method,
        agent,
        headers,
        servername: target.hostname,
      }, upstreamResponse => {
        responseStarted = true;
        ctx.respond = false;
        ctx.res.statusCode = upstreamResponse.statusCode || 502;
        ctx.res.setHeader('x-accel-buffering', 'no');
        for (const [ name, value ] of Object.entries(selectedHeaders(
          upstreamResponse.headers,
          RESPONSE_HEADERS
        ))) {
          ctx.res.setHeader(name, value);
        }
        upstreamResponse.on('error', err => {
          ctx.logger.warn('[himind-mcp-proxy] response stream failed: %s', err.message);
          ctx.res.destroy(err);
          resolve();
        });
        upstreamResponse.on('end', resolve);
        upstreamResponse.pipe(ctx.res);
      });
      upstream.on('error', err => {
        ctx.logger.warn('[himind-mcp-proxy] upstream failed: %s', err.message);
        if (!responseStarted) {
          ctx.status = 502;
          ctx.body = { error: 'HiMind MCP upstream is unavailable' };
        }
        resolve();
      });
      ctx.req.once('aborted', () => upstream.destroy());
      if (body) upstream.write(body);
      upstream.end();
    });
  }
}

module.exports = HiMindMcpProxyController;
