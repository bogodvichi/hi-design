'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { decryptCredential } = require('../../../../app/controller/api/sso_credential');
const createConfig = require('../../../../config/config.default');

function createController({ privateKey, ciphertext = 'opaque' } = {}) {
  const ctx = {
    request: {
      body: {
        username: 'alice',
        ciphertext,
        oa_cookies: [{ name: 'JwtToken', value: 'opaque' }],
      },
    },
    headers: {},
    logger: { warn() {} },
  };
  return {
    app: { config: { ssoCredential: { privateKey, keyId: 'hidesign-sso-01' } } },
    ctx,
  };
}

function seal(publicKey, password) {
  return crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(password, 'utf8'),
  ).toString('base64url');
}

describe('test/app/controller/api/sso_credential.test.js', () => {
  it('uses the built-in service private key', async () => {
    const config = createConfig({
      baseDir: path.join(__dirname, '../../../..'),
    });
    const { privateKey } = config.ssoCredential;

    assert.strictEqual(config.ssoCredential.keyId, 'hidesign-sso-01');
    assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----/);

    const controller = createController({
      privateKey,
      ciphertext: seal(crypto.createPublicKey(privateKey), 'secret-password'),
    });

    await decryptCredential(controller, async () => ({ username: 'alice' }));

    assert.deepStrictEqual(controller.ctx.body, {
      code: 0,
      msg: 'SUCCESS',
      data: { password: 'secret-password' },
    });
  });

  it('decrypts only after the OA session identity is verified', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const controller = createController({
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ciphertext: seal(publicKey, 'secret-password'),
    });
    let validated;

    await decryptCredential(controller, async (cookie, username) => {
      validated = { cookie, username };
      return { username: 'alice' };
    });

    assert.deepStrictEqual(validated, {
      cookie: 'JwtToken=opaque',
      username: 'alice',
    });
    assert.strictEqual(controller.ctx.status, undefined);
    assert.deepStrictEqual(controller.ctx.body, {
      code: 0,
      msg: 'SUCCESS',
      data: { password: 'secret-password' },
    });
  });

  it('rejects an invalid username before OA validation', async () => {
    const controller = createController({ privateKey: 'unused' });
    controller.ctx.request.body.username = '../evil';
    let validated = false;

    await decryptCredential(controller, async () => {
      validated = true;
      return { username: 'alice' };
    });

    assert.strictEqual(validated, false);
    assert.strictEqual(controller.ctx.status, 400);
    assert.strictEqual(controller.ctx.body.error, 'username is invalid');
  });

  it('fails closed when the OA session is invalid', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const controller = createController({
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });

    await decryptCredential(controller, async () => {
      throw new Error('OA session unavailable');
    });

    assert.strictEqual(controller.ctx.status, 401);
    assert.strictEqual(controller.ctx.body.error, 'OA session is invalid');
  });

  it('reports a missing private key without touching OA', async () => {
    const controller = createController();
    let validated = false;

    await decryptCredential(controller, async () => {
      validated = true;
      return { username: 'alice' };
    });

    assert.strictEqual(validated, false);
    assert.strictEqual(controller.ctx.status, 503);
    assert.strictEqual(controller.ctx.body.error, 'SSO credential decryption is not configured');
  });

  it('rejects malformed ciphertext', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const controller = createController({
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ciphertext: 'not-base64url!',
    });

    await decryptCredential(controller, async () => ({ username: 'alice' }));

    assert.strictEqual(controller.ctx.status, 400);
    assert.strictEqual(controller.ctx.body.error, 'credential ciphertext is invalid');
  });
});
