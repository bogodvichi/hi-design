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
            baseUrl: 'http://drw.hikvision.com/',
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
        launch_url: 'http://drw.hikvision.com/api/auth/platform?ticket=opaque-ticket&next=%2F',
        expires_in: 60,
      },
    });
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
