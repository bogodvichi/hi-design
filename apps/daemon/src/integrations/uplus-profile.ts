import { createCipheriv, pbkdf2Sync } from 'node:crypto';

const UPLUS_ORIGIN = 'http://uplus.hikvision.com.cn';
const UPLUS_LOGIN_URL = `${UPLUS_ORIGIN}/api/v2/a/auth/login`;
const UPLUS_PROFILE_URL = `${UPLUS_ORIGIN}/api/v2/a/auth/userInfo`;
const UPLUS_LOGIN_TIMEOUT_MS = 10_000;
const UPLUS_PASSWORD_SALT_HEX = 'a33c970a7e99a981707d035bdcf6c5a4';
const UPLUS_PASSWORD_IV = 'efc7a08ddd8caeb63b0952121d7d57f7';
const UPLUS_PASSWORD_DERIVATION_INPUT = 'uplus';
const UPLUS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type UplusAvatarResult =
  | { ok: true; avatarUrl: string | null }
  | {
      ok: false;
      reason:
        | 'missing_credentials'
        | 'http_error'
        | 'business_error'
        | 'invalid_profile'
        | 'username_mismatch'
        | 'request_error';
      status?: number;
      businessCode?: string | number;
    };

export interface UplusProfileDeps {
  request?: typeof fetch;
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), UPLUS_ORIGIN);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function responseCookieHeader(headers: Headers): string {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [headers.get('set-cookie') ?? ''];
  return values
    .map((value) => value.split(';', 1)[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

export function encryptUplusPassword(password: string): string {
  const key = pbkdf2Sync(
    UPLUS_PASSWORD_DERIVATION_INPUT,
    Buffer.from(UPLUS_PASSWORD_SALT_HEX, 'hex'),
    1_000,
    16,
    'sha1',
  );
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.from(UPLUS_PASSWORD_IV, 'hex'));
  return Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('base64');
}

/**
 * Resolve the avatar while the user is already submitting their OA credentials
 * to OpenDesign. The UPlus password protocol is reproduced in-memory; neither
 * the encrypted password nor the returned UPlus token is persisted.
 */
export async function fetchUplusAvatarOnLogin(
  username: string,
  password: string,
  deps: UplusProfileDeps = {},
): Promise<UplusAvatarResult> {
  const expectedUsername = username.trim().toLowerCase();
  if (!expectedUsername || !password) return { ok: false, reason: 'missing_credentials' };

  try {
    const response = await (deps.request ?? fetch)(UPLUS_LOGIN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: UPLUS_ORIGIN,
        Referer: `${UPLUS_ORIGIN}/`,
        'User-Agent': UPLUS_USER_AGENT,
      },
      body: JSON.stringify({
        username: username.trim(),
        password: encryptUplusPassword(password),
      }),
      signal: AbortSignal.timeout(UPLUS_LOGIN_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };

    const payload = await response.json() as {
      code?: unknown;
      data?: { list?: unknown; token?: unknown };
    };
    if (payload.code !== 1) {
      const businessCode =
        typeof payload.code === 'string' || typeof payload.code === 'number'
          ? payload.code
          : undefined;
      return businessCode === undefined
        ? { ok: false, reason: 'business_error' }
        : { ok: false, reason: 'business_error', businessCode };
    }
    if (!Array.isArray(payload.data?.list) || !payload.data.list[0]) {
      return { ok: false, reason: 'invalid_profile' };
    }
    const profile = payload.data.list[0] as { user_name?: unknown; avatar_url?: unknown };
    const actualUsername = typeof profile?.user_name === 'string'
      ? profile.user_name.trim().toLowerCase()
      : '';
    if (actualUsername !== expectedUsername) return { ok: false, reason: 'username_mismatch' };

    const loginAvatarUrl = normalizeAvatarUrl(profile.avatar_url);
    if (loginAvatarUrl) return { ok: true, avatarUrl: loginAvatarUrl };

    const token = typeof payload.data?.token === 'string' ? payload.data.token : '';
    if (!token) return { ok: true, avatarUrl: null };
    const cookie = responseCookieHeader(response.headers);

    const profileResponse = await (deps.request ?? fetch)(UPLUS_PROFILE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        auth: token,
        ...(cookie ? { Cookie: cookie } : {}),
        Referer: `${UPLUS_ORIGIN}/`,
        'User-Agent': UPLUS_USER_AGENT,
      },
      signal: AbortSignal.timeout(UPLUS_LOGIN_TIMEOUT_MS),
    });
    if (!profileResponse.ok) {
      return { ok: false, reason: 'http_error', status: profileResponse.status };
    }

    const profilePayload = await profileResponse.json() as {
      code?: unknown;
      data?: { list?: unknown };
    };
    if (profilePayload.code !== 1 || !Array.isArray(profilePayload.data?.list)) {
      const businessCode =
        typeof profilePayload.code === 'string' || typeof profilePayload.code === 'number'
          ? profilePayload.code
          : undefined;
      return businessCode === undefined
        ? { ok: false, reason: 'invalid_profile' }
        : { ok: false, reason: 'business_error', businessCode };
    }
    const fullProfile = profilePayload.data.list[0] as {
      user_name?: unknown;
      avatar_url?: unknown;
    } | undefined;
    if (!fullProfile) return { ok: false, reason: 'invalid_profile' };
    const fullProfileUsername = typeof fullProfile.user_name === 'string'
      ? fullProfile.user_name.trim().toLowerCase()
      : '';
    if (fullProfileUsername !== expectedUsername) {
      return { ok: false, reason: 'username_mismatch' };
    }

    return { ok: true, avatarUrl: normalizeAvatarUrl(fullProfile.avatar_url) };
  } catch {
    // Avatar enrichment is optional; OA login remains the source of truth.
    return { ok: false, reason: 'request_error' };
  }
}
