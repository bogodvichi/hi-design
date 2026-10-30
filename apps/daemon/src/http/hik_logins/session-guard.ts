import { constants, createDecipheriv, publicEncrypt, scryptSync } from 'node:crypto';
import { hdwPost } from '../hdw.js';
import type { Cookie } from '../http.js';
import {
  getDeviceFingerprint,
  readSsoConfigFile,
  writeSsoConfigFile,
  type SsoSession,
} from './hicoo.js';
import { hikkeLogin, hikkeValidate } from './hikke.js';
import { uedroLogin, uedroValidate } from './uedro.js';

const CREDENTIAL_VERSION = 'v2';
const CREDENTIAL_KEY_ID = 'hidesign-sso-01';
const LEGACY_CREDENTIAL_VERSION = 'v1';

// Hi Design's credential envelope public key. The matching private key stays
// on hidesign-web; the daemon can only seal passwords, never open them.
const HIDE_SIGN_SSO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl5YJg3UwFV2MrfTDvKye
mb+vnaKd+MND+jN/VqVZVF+4eI1fzNY3Xn6O+jAlDjNJmYbAlmq3jUVe+NNl1O4S
tozIyCYwrlDdpgk5y0A9rGMnVYZql453E3NsdJgmoU2yAUlYiHElA/3nYBk8tfoW
gba0dgqIWUNnQfIncjOGU28XSUDWLwTnd5Yo98X/vePZNrBbQ0GhU1E/bYigUmSo
NR8pTdYGx1zH4WhCueKNHEs87wlhLT7bwGImyNGrqdcUMT91NnMkP22RuKWR/XOz
f+YdJpL4+fZeuRgCZVGPoclq6Ndvw06adxOJyIeAEBQer1QRx9s8Pe6GE6TC8OOy
IQIDAQAB
-----END PUBLIC KEY-----`;

export interface HikkeRouteSession {
  hikkeToken: string;
  cookies: Cookie[];
  userInfo: Record<string, unknown>;
}

interface DeferredLogin {
  username: string;
  password: string;
}

const sessionLocks = new Map<string, Promise<unknown>>();

/** Seal a deferred platform password for the central Hi Design decryptor. */
export function encryptPassword(password: string): string {
  const ciphertext = publicEncrypt(
    {
      key: HIDE_SIGN_SSO_PUBLIC_KEY,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(password, 'utf8'),
  ).toString('base64url');
  return [
    CREDENTIAL_VERSION,
    CREDENTIAL_KEY_ID,
    ciphertext,
  ].join(':');
}

function decryptLegacyPassword(value: string): string | null {
  const [version, salt, iv, tag, ciphertext] = value.split(':');
  if (version !== LEGACY_CREDENTIAL_VERSION || !salt || !iv || !tag || !ciphertext) return null;
  try {
    const key = scryptSync(
      getDeviceFingerprint(),
      Buffer.from(salt, 'base64url'),
      32,
    );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export async function decryptPassword(
  value: string | undefined,
  username: string,
  oaCookies: Cookie[],
): Promise<string | null> {
  if (!value) return null;
  const [version, keyId, ciphertext] = value.split(':');
  if (version === LEGACY_CREDENTIAL_VERSION) return decryptLegacyPassword(value);
  if (version !== CREDENTIAL_VERSION || !ciphertext) return null;
  if (keyId !== CREDENTIAL_KEY_ID) return null;

  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !oaCookies.length) return null;
  try {
    const data = await hdwPost<{ password?: string }>(
      '/auth/sso-credential/decrypt',
      {
        username: normalizedUsername,
        ciphertext,
        oa_cookies: oaCookies.map(({ name, value }) => ({ name, value })),
      },
      undefined,
      { throwOnError: true },
    );
    return typeof data?.password === 'string' && data.password ? data.password : null;
  } catch (err) {
    console.warn('Deferred credential decryption failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function readDeferredLogin(
  session: SsoSession | null,
  platform: 'hikke' | 'uedro',
): Promise<DeferredLogin | null> {
  const username = session?.username?.trim();
  if (!username) return null;
  const password = await decryptPassword(
    session?.[platform]?.password,
    username,
    session?.cookies ?? [],
  );
  return password ? { username, password } : null;
}

async function withSessionLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.catch(() => {}).then(() => gate);
  sessionLocks.set(key, chained);
  try {
    await previous.catch(() => {});
    return await task();
  } finally {
    release?.();
    if (sessionLocks.get(key) === chained) sessionLocks.delete(key);
  }
}

function saveSession(dataDir: string, session: SsoSession): void {
  writeSsoConfigFile(dataDir, session);
}

/**
 * Validate the stored Hikke session before a business request. When it is
 * absent or expired, use the deferred encrypted password and refresh config.
 */
export async function ensureHikkeSession(dataDir: string): Promise<HikkeRouteSession | null> {
  return withSessionLock(`hikke:${dataDir}`, async () => {
    const session = readSsoConfigFile(dataDir);
    const hikke = session?.hikke;
    if (hikke?.hikkeToken && (await hikkeValidate(hikke)).ok) {
      return {
        hikkeToken: hikke.hikkeToken,
        cookies: hikke.cookies ?? [],
        userInfo: (hikke.userInfo ?? {}) as Record<string, unknown>,
      };
    }

    const login = await readDeferredLogin(session, 'hikke');
    if (!login) return null;
    try {
      const result = await hikkeLogin(login.username, login.password);
      const nextSession: SsoSession = {
        ...(session as SsoSession),
        hikke: {
          ...hikke,
          hikkeToken: result.hikkeToken,
          testToken: result.testToken,
          userInfo: result.userInfo,
          cookies: result.cookies,
          loginAt: result.loginAt,
        },
      };
      saveSession(dataDir, nextSession);
      return {
        hikkeToken: result.hikkeToken,
        cookies: result.cookies,
        userInfo: result.userInfo,
      };
    } catch (err) {
      console.warn('Hikke deferred login failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  });
}

/**
 * Validate the stored UEDRO cookies before a business request. When they are
 * absent or expired, use the deferred encrypted password and refresh config.
 */
export async function ensureUedroSession(dataDir: string): Promise<Cookie[] | null> {
  return withSessionLock(`uedro:${dataDir}`, async () => {
    const session = readSsoConfigFile(dataDir);
    const uedro = session?.uedro;
    if (uedro?.cookies?.length && (await uedroValidate(uedro.cookies)).ok) {
      return uedro.cookies;
    }

    const login = await readDeferredLogin(session, 'uedro');
    if (!login) return null;
    try {
      const result = await uedroLogin(login.username, login.password);
      if (!result.cookies?.length) return null;
      const nextSession: SsoSession = {
        ...(session as SsoSession),
        uedro: {
          ...uedro,
          cookies: result.cookies,
          userInfo: result.userInfo,
          loginAt: Date.now(),
        },
      };
      saveSession(dataDir, nextSession);
      return result.cookies;
    } catch (err) {
      console.warn('UEDRO deferred login failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  });
}
