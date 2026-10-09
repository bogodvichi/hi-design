'use strict';

const assert = require('assert');
const AiResearchSsoController = require('../../../../app/controller/api/ai_research_sso');
const { issueTicket } = require('../../../../app/controller/api/ai_research_sso');

describe('test/app/controller/api/ai_research_sso.test.js', () => {
  it('issues a callback only after validating the OA session', async () => {
    let signedPayload;
    let validatedCookie;
    let validatedUsername;
    const controller = {
      app: {
        config: {
          aiResearch: {
            baseUrl: 'https://drw.hikvision.com/',
            ssoSecret: 'a-secure-shared-secret-with-32-bytes',
            ssoIssuer: 'hidesign-web',
            ssoAudience: 'design-research-workbench',
            ticketTtlSeconds: 60,
          },
        },
        jwt: {
          sign(payload, secret, options) {
            signedPayload = payload;
            assert.strictEqual(secret, 'a-secure-shared-secret-with-32-bytes');
            assert.deepStrictEqual(options, { algorithm: 'HS256', expiresIn: 60 });
            return 'opaque-ticket';
          },
        },
      },
      ctx: {
        request: {
          body: {
            username: 'Alice',
            oa_cookies: [{ name: 'oa_session', value: 'opaque-cookie' }],
          },
        },
        headers: {},
        logger: { warn() {} },
      },
    };

    await issueTicket(controller, async (cookie, username) => {
      validatedCookie = cookie;
      validatedUsername = username;
      return { email: 'alice@example.com', displayName: 'Alice' };
    });

    assert.strictEqual(validatedCookie, 'oa_session=opaque-cookie');
    assert.strictEqual(validatedUsername, 'alice');
    assert.strictEqual(signedPayload.username, 'alice');
    assert.strictEqual(signedPayload.email, 'alice@example.com');
    assert.match(signedPayload.jti, /^[a-f0-9]{32}$/);
    assert.deepStrictEqual(controller.ctx.body, {
      code: 0,
      msg: 'SUCCESS',
      data: {
        launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque-ticket&next=%2F',
        expires_in: 60,
      },
    });
  });

  it('keeps the AI research key and audience separate when reusing the HiMind signer', async () => {
    let signed;
    const controller = {
      app: {
        config: {
          himind: { ssoSecret: 'himind-secret-should-not-be-used-here', ssoAudience: 'himind' },
          aiResearch: { baseUrl: 'https://research.example/', ssoSecret: 'research-key-at-least-thirty-two-chars', ssoIssuer: 'hidesign-web', ssoAudience: 'design-research-workbench', ticketTtlSeconds: 60 },
        },
        jwt: { sign(payload, key, options) { signed = { payload, key, options }; return 'opaque'; } },
      },
      ctx: { request: { body: { username: 'alice', oa_cookies: [{ name: 'JwtToken', value: 'opaque' }] } }, headers: {}, logger: { warn() {} } },
    };
    await issueTicket(controller, async () => ({ email: 'alice@example.com' }));
    assert.strictEqual(signed.key, controller.app.config.aiResearch.ssoSecret);
    assert.strictEqual(signed.payload.aud, 'design-research-workbench');
    assert.strictEqual(signed.payload.iss, 'hidesign-web');
    assert.strictEqual(new URL(controller.ctx.body.data.launch_url).pathname, '/api/auth/platform');
  });

  it('fails closed when OA validation fails without issuing a ticket', async () => {
    let signed = false;
    const controller = {
      app: { config: { aiResearch: { ssoSecret: 'research-key-at-least-thirty-two-chars' } }, jwt: { sign() { signed = true; } } },
      ctx: { request: { body: { username: 'alice' } }, headers: {}, logger: { warn() {} } },
    };
    await issueTicket(controller, async () => { throw new Error('OA session unavailable'); });
    assert.strictEqual(controller.ctx.status, 401);
    assert.strictEqual(signed, false);
    assert.strictEqual(controller.ctx.body.error, 'OA session is invalid');
  });

  it('rejects an mcpToken request with an invalid username before any network call', async () => {
    const ctx = {
      request: { body: { username: '../evil' } },
      headers: {},
      logger: { warn() {}, error() {} },
    };
    const controller = Object.create(AiResearchSsoController.prototype);
    controller.ctx = ctx;
    controller.app = { config: { aiResearch: { mcpJwtPrivateKey: 'unused' } } };

    await controller.mcpToken();

    assert.strictEqual(ctx.status, 400);
    assert.deepStrictEqual(ctx.body, { code: -1, msg: 'FAIL', error: 'username is invalid' });
  });

  it('reports 503 when the AI research MCP JWT signing key is not configured', async () => {
    const ctx = {
      request: { body: { username: 'alice' } },
      headers: {},
      logger: { warn() {}, error() {} },
    };
    const controller = Object.create(AiResearchSsoController.prototype);
    controller.ctx = ctx;
    // No mcpJwtPrivateKey — the daemon must not fall back to the launch secret
    // or the himind key. A missing research key is a config error, not a login.
    controller.app = { config: { aiResearch: {} } };

    await controller.mcpToken();

    assert.strictEqual(ctx.status, 503);
    assert.deepStrictEqual(ctx.body, {
      code: -1,
      msg: 'FAIL',
      error: 'AI research MCP JWT is not configured',
    });
  });
});
