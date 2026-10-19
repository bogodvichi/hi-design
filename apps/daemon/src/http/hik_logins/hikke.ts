import * as crypto from 'node:crypto';
import { rawRequest, type Cookie } from '../http.js';

/** 海客 Hikke API origin. Can be overridden for controlled test environments. */
export const HIKKE_ORIGIN = (process.env.HIKKE_ORIGIN || 'https://hikke.hikvision.com.cn').replace(/\/$/, '');
const HIKKE_API = `${HIKKE_ORIGIN}/hikkeapi`;
const HIKKE_LOGIN_URL = `${HIKKE_API}/hikkeToken/login`;
const HIKKE_TEST_TOKEN_URL = `${HIKKE_API}/hikkeToken/generateTestToken`;
const HIKKE_CHECK_TOKEN_URL = `${HIKKE_API}/checkToken`;
const HIKKE_USER_INFO_URL = `${HIKKE_ORIGIN}/hikke-minder/minder-user/v1/user-info`;

// Public key published by the Hikke login page's JSEncrypt client.
const HIKKE_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwIxSPJ1umAW8Rx4d30QPOOtC6FlKLFMqCRndQDDI2p73qeAh0tPTR+6Zo2synM8JrLmwzxRFsgOgqzNH5MKcqXw+7bRchXT+WU1Fh1c7tIx7fDpJn2AyCHh4LdbSS/iiY5KKDn7LnvU4yV1OSLvFxY3eJs9Hsvw+SPmWChtIfrhn/8rExcPfVDyaPr0f42YSiHzSo/gCrltJj/Jv6wXPBlWKFHs+e++5GU9/WTv0Oe+hHJfXWf7b0Q/sNUsB2nSYgdVfFDcE8aUDQ8/ACsjIUQ5ND2N0SMJT2xo+rJrFiG4DUUrolKQqOLvFHOq9IwwejFVoNiCpyFIxBkIoLC6JqwIDAQAB\n-----END PUBLIC KEY-----`;

export interface HikkeSession {
  hikkeToken: string;
  testToken: string;
  userInfo: Record<string, unknown>;
  loginAt: number;
}

export interface HikkeLoginResult extends HikkeSession {
  ok: true;
  username: string;
  cookies: Cookie[];
}

export interface HikkeValidateResult {
  ok: boolean;
  username?: string;
}

function parseEnvelope(body: string, status: number, operation: string): any {
  if (status < 200 || status >= 300) throw new Error(`Hikke ${operation} failed (HTTP ${status})`);
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Hikke ${operation} returned invalid JSON`);
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.success === false || parsed.ok === false) {
      throw new Error(typeof parsed.message === 'string' ? parsed.message : `Hikke ${operation} rejected`);
    }
    if (parsed.code !== undefined && ![0, '0', 200, '200'].includes(parsed.code)) {
      throw new Error(typeof parsed.msg === 'string' ? parsed.msg : `Hikke ${operation} rejected`);
    }
    if (parsed.success === true && Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed.result;
    if (Object.prototype.hasOwnProperty.call(parsed, 'data')) return parsed.data;
    if (Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed.result;
  }
  return parsed;
}

function rsaEncrypt(value: string): string {
  return crypto.publicEncrypt(
    { key: HIKKE_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(value, 'utf8'),
  ).toString('base64');
}

function buildMultipart(fields: Record<string, string>): { body: Buffer; contentType: string } {
  const boundary = `----HikkeLogin${crypto.randomBytes(12).toString('hex')}`;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return { body: Buffer.from(chunks.join(''), 'utf8'), contentType: `multipart/form-data; boundary=${boundary}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Log into Hikke using the same account, then resolve both Hikke tokens and user profile. */
export async function hikkeLogin(username: string, password: string): Promise<HikkeLoginResult> {
  const multipart = buildMultipart({ uid: username, password: rsaEncrypt(password) });
  const loginResponse = await rawRequest('POST', HIKKE_LOGIN_URL, [], {
    body: multipart.body,
    extraHeaders: {
      'Content-Type': multipart.contentType,
      Accept: 'application/json, text/plain, */*',
      Origin: HIKKE_ORIGIN,
      Referer: `${HIKKE_ORIGIN}/#/login`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  const loginData = parseEnvelope(loginResponse.body, loginResponse.status, 'login');
  const hikkeToken = isRecord(loginData) && typeof loginData.hikkeToken === 'string' ? loginData.hikkeToken : '';
  if (!hikkeToken) throw new Error('Hikke login response did not include hikkeToken');

  // The login response may already include testToken; only generate it when absent, matching the browser flow.
  let testToken = isRecord(loginData) && typeof loginData.testToken === 'string' ? loginData.testToken : '';
  let userInfoCookies = loginResponse.cookies;
  if (!testToken) {
    const testTokenResponse = await rawRequest('POST', HIKKE_TEST_TOKEN_URL, loginResponse.cookies, {
      extraHeaders: {
        Authorization: hikkeToken,
        Accept: 'application/json, text/plain, */*',
        Origin: HIKKE_ORIGIN,
        Referer: `${HIKKE_ORIGIN}/#/login`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const testTokenData = parseEnvelope(testTokenResponse.body, testTokenResponse.status, 'test-token generation');
    testToken = isRecord(testTokenData) && typeof testTokenData.testToken === 'string' ? testTokenData.testToken : '';
    userInfoCookies = testTokenResponse.cookies;
  }
  if (!testToken) throw new Error('Hikke test-token generation did not return testToken');

  // The frontend routes /minder-user APIs through testToken, not hikkeToken.
  const userResponse = await rawRequest('GET', HIKKE_USER_INFO_URL, userInfoCookies, {
    extraHeaders: {
      Authorization: hikkeToken,
      Accept: 'application/json, text/plain, */*',
      Origin: HIKKE_ORIGIN,
      Referer: `${HIKKE_ORIGIN}/#/login`,
      'X-Requested-With': 'XMLHttpRequest',
      lang: 'zh-CN',
    },
  });
  const userInfo = parseEnvelope(userResponse.body, userResponse.status, 'user-info');
  if (!isRecord(userInfo) || !Object.keys(userInfo).length) {
    throw new Error('Hikke user-info response was empty');
  }
  if(userInfo&&!userInfo.displayName){
     userInfo.displayName = userInfo.name;
  }

  return {
    ok: true,
    username: typeof userInfo.loginName === 'string' && userInfo.loginName ? userInfo.loginName : username,
    hikkeToken,
    testToken,
    userInfo,
    cookies: userResponse.cookies,
    loginAt: Date.now(),
  };
}

/** Validate the saved Hikke token without exposing credentials to callers. */
export async function hikkeValidate(session?: Partial<HikkeSession>): Promise<HikkeValidateResult> {
  if (!session?.hikkeToken) return { ok: false };
  try {
    const response = await rawRequest('GET', HIKKE_CHECK_TOKEN_URL, [], {
      extraHeaders: {
        Authorization: session.hikkeToken,
        Accept: 'application/json, text/plain, */*',
        Origin: HIKKE_ORIGIN,
        Referer: `${HIKKE_ORIGIN}/#/login`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const validation = parseEnvelope(response.body, response.status, 'token validation');
    if (validation === false || (isRecord(validation) && (validation.valid === false || validation.isValid === false))) {
      return { ok: false };
    }
    const username = typeof session.userInfo?.loginName === 'string' ? session.userInfo.loginName : undefined;
    return { ok: true, ...(username ? { username } : {}) };
  } catch {
    return { ok: false };
  }
}
