import { createCipheriv, createHash, randomUUID } from 'node:crypto';
import { Agent, request as httpsRequest } from 'node:https';
import * as tls from 'node:tls';
import {
  LANZ_DEFAULT_MODEL,
  LANZ_OPENAI_BASE_URL,
  type LanzAccountCredentials,
  type LanzAccountFailureKind,
  type LanzAccountResponse,
} from '@open-design/contracts';
import {
  cookieHeader,
  mergeCookies,
  parseCookieHeaders,
  type Cookie,
} from '../http/http.js';
import { readSsoConfigFile, type SsoSession } from '../http/hik_logins/hicoo.js';

const LANZ_ORIGIN = 'https://lanz.hikvision.com';
const SSO_HOSTS = new Set(['lanz.hikvision.com', 'sso.hikvision.com', 'sso.hikvision.com.cn']);
const MAX_BODY_BYTES = 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;

// Public request-signing material shipped by Lanz's own web client (module 9685).
// This signs its nonce/timestamp header; it is not a user's API credential.
const SWMS_KEY = '139074101@SR&LYJ';
const SWMS_IV = 'N6s87ssQyWB9ZRFK';
// Runtime is Node 24; the workspace still uses Node 20's type declarations.
const { getCACertificates } = tls as typeof tls & {
  getCACertificates(type: 'default' | 'system'): string[];
};
const agent = new Agent({
  ca: [...getCACertificates('default'), ...getCACertificates('system')],
});

export class LanzAccountError extends Error {
  constructor(readonly kind: LanzAccountFailureKind) {
    super(kind);
  }
}

export interface LanzHttpResponse {
  status: number;
  location?: string | undefined;
  setCookies: string[];
  body: string;
}

export type LanzRequest = (
  url: string,
  cookies: Cookie[],
  signal: AbortSignal,
  signed?: boolean,
) => Promise<LanzHttpResponse>;

function assertTrustedUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' || !SSO_HOSTS.has(url.hostname)
    || (url.port && url.port !== '443') || url.username || url.password
  ) throw new LanzAccountError('unavailable');
  return url;
}

function requestToken(): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(SWMS_KEY), Buffer.from(SWMS_IV));
  return Buffer.concat([
    cipher.update('SWMS_' + randomUUID() + '_' + Date.now(), 'utf8'),
    cipher.final(),
  ]).toString('base64');
}

const requestLanz: LanzRequest = (rawUrl, cookies, signal, signed = false) =>
  new Promise((resolve, reject) => {
    const url = assertTrustedUrl(rawUrl);
    const req = httpsRequest(url, {
      agent,
      signal,
      headers: {
        // The company SSO rejects requests without a User-Agent; match Node fetch.
        'User-Agent': 'node',
        Accept: signed ? 'application/json' : 'text/html',
        Cookie: cookieHeader(cookies, url.href),
        ...(signed ? { 'Swms-Request-Token': requestToken() } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new LanzAccountError('unavailable'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        location: res.headers.location,
        setCookies: res.headers['set-cookie'] ?? [],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });

function accountStamp(session: SsoSession | null): string {
  if (!session?.username?.trim() || !session.cookies?.length) return '';
  return createHash('sha256').update(JSON.stringify([
    session.username.trim().toLowerCase(), session.loginAt, session.cookies,
  ])).digest('hex');
}

/** Reuse the device-bound OA session. Only read the current account's stable Key. */
export async function fetchLanzAccount(
  session: SsoSession,
  request: LanzRequest = requestLanz,
): Promise<LanzAccountCredentials> {
  const username = session.username?.trim().toLowerCase();
  if (!username || !session.cookies?.length) throw new LanzAccountError('not_signed_in');
  const signal = AbortSignal.timeout(20_000);
  let jar = [...session.cookies];
  let url = LANZ_ORIGIN + '/';
  let signedIn = false;
  for (let hop = 0; hop < 8; hop += 1) {
    assertTrustedUrl(url);
    const response = await request(url, jar, signal);
    const incoming = parseCookieHeaders(response.setCookies, url).filter((cookie) => {
      const host = new URL(url).hostname;
      return host === cookie.domain || host.endsWith('.' + cookie.domain);
    });
    jar = mergeCookies(jar, incoming);
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = assertTrustedUrl(new URL(response.location, url).href).href;
      continue;
    }
    signedIn = response.status === 200 && new URL(url).origin === LANZ_ORIGIN;
    break;
  }
  if (!signedIn) throw new LanzAccountError('session_expired');

  async function readApi(endpoint: string): Promise<unknown> {
    const response = await request(LANZ_ORIGIN + endpoint, jar, signal, true);
    if (response.status === 401 || response.status === 403 || response.location) {
      throw new LanzAccountError('session_expired');
    }
    if (response.status !== 200) throw new LanzAccountError('unavailable');
    let payload: { code?: unknown; data?: unknown };
    try { payload = JSON.parse(response.body); }
    catch { throw new LanzAccountError('unavailable'); }
    if (payload.code !== 2001) throw new LanzAccountError('unavailable');
    return payload.data;
  }

  const profile = await readApi('/v1/user/m') as { pinyin?: unknown } | null;
  if (typeof profile?.pinyin !== 'string' || profile.pinyin.trim().toLowerCase() !== username) {
    throw new LanzAccountError('account_mismatch');
  }
  // This is the portal's "copy API Key" endpoint. The account Key is stable
  // across models; model-specific rows are deliberately not used.
  const apiKey = await readApi('/v1/openai/token/create');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new LanzAccountError('key_unavailable');
  return {
    ok: true,
    username,
    apiKey: apiKey.trim(),
    baseUrl: LANZ_OPENAI_BASE_URL,
    defaultModel: LANZ_DEFAULT_MODEL,
  };
}

export interface LanzAccountServiceOptions {
  readSession?: () => SsoSession | null;
  fetchAccount?: typeof fetchLanzAccount;
  now?: () => number;
}

/** One in-memory cache scoped to the current session, cleared on identity change. */
export class LanzAccountService {
  private cache: { stamp: string; until: number; value: LanzAccountCredentials } | null = null;
  private pending: { stamp: string; promise: Promise<LanzAccountCredentials> } | null = null;
  private readonly readSession: () => SsoSession | null;
  private readonly fetchAccount: typeof fetchLanzAccount;
  private readonly now: () => number;

  constructor(dataDir: string, options: LanzAccountServiceOptions = {}) {
    this.readSession = options.readSession ?? (() => readSsoConfigFile(dataDir));
    this.fetchAccount = options.fetchAccount ?? fetchLanzAccount;
    this.now = options.now ?? Date.now;
  }

  async load(expectedUsername?: string): Promise<LanzAccountResponse> {
    const session = this.readSession();
    const stamp = accountStamp(session);
    if (!stamp || !session) {
      this.cache = null;
      return { ok: false, kind: 'not_signed_in' };
    }
    const username = session.username!.trim().toLowerCase();
    if (expectedUsername && expectedUsername.trim().toLowerCase() !== username) {
      return { ok: false, kind: 'account_mismatch' };
    }
    if (this.cache?.stamp !== stamp) this.cache = null;
    try {
      if (this.cache && this.cache.until > this.now()) return this.cache.value;
      let promise = this.pending?.stamp === stamp ? this.pending.promise : undefined;
      if (!promise) {
        promise = this.fetchAccount(session);
        this.pending = { stamp, promise };
      }
      try {
        const value = await promise;
        if (accountStamp(this.readSession()) !== stamp) {
          return { ok: false, kind: 'account_mismatch' };
        }
        this.cache = { stamp, until: this.now() + CACHE_MS, value };
        return value;
      } finally {
        if (this.pending?.promise === promise) this.pending = null;
      }
    } catch (error) {
      return {
        ok: false,
        kind: error instanceof LanzAccountError ? error.kind : 'unavailable',
      };
    }
  }
}
