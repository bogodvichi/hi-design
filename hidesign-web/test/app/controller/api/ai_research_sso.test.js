'use strict';

const assert = require('assert');
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
});
