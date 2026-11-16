import { rawRequest, UA, type Cookie } from '../http.js';
import { readSsoConfigFile, writeSsoConfigFile, type SsoSession } from './hicoo.js';

/** IRDMS 上游基址，可用环境变量覆盖。 */
export const IRDMS_BASE = (process.env.IRDMS_BASE || 'https://irdmspro.hikvision.com.cn').replace(/\/$/, '');

/** CAS 建立会话用的服务地址；该接口本身也用于连通性探测。 */
export const IRDMS_CURRENT_USER_URL = `${IRDMS_BASE}/webApi/irdms-basic-web/user/getCurrentUserInfo`;

const IRDMS_HOST = 'irdmspro.hikvision.com.cn';

/**
 * CAS 建会话必须使用 HTTP service URL。用 HTTPS service 会再次被 IRDMS
 * 弹回 SSO 登录页；业务请求随后仍可继续使用 HTTPS。
 */
const IRDMS_CAS_SERVICE_URL = IRDMS_CURRENT_USER_URL.replace(/^https:/i, 'http:');

/** hicoo SSO session 存在但无法建立 IRDMS 会话时抛出。 */
export class IrdmsUnauthorizedError extends Error {
  constructor(message = 'hicoo session not found, please login first') {
    super(message);
    this.name = 'IrdmsUnauthorizedError';
  }
}

export interface IrdmsSessionCookies {
  cookies: Cookie[];
}

export interface IrdmsRawResult {
  status: number;
  body: string;
  finalUrl: string;
  contentType: string;
}

const irdmsSessionLocks = new Map<string, Promise<unknown>>();

async function withIrdmsSessionLock<T>(dataDir: string, task: () => Promise<T>): Promise<T> {
  const key = `irdms:${dataDir}`;
  const previous = irdmsSessionLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.catch(() => {}).then(() => gate);
  irdmsSessionLocks.set(key, chained);
  try {
    await previous.catch(() => {});
    return await task();
  } finally {
    release?.();
    if (irdmsSessionLocks.get(key) === chained) irdmsSessionLocks.delete(key);
  }
}

function isIrdmsCookie(cookie: Cookie): boolean {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  return domain === IRDMS_HOST || domain.endsWith(`.${IRDMS_HOST}`);
}

function hicooCookieHeader(cookies: Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/** IRDMS 上游统一请求头；cookies 已由会话守卫解析为业务域名有效 cookies。 */
function irdmsHeaders(cookies: Cookie[]): Record<string, string> {
  return {
    Cookie: hicooCookieHeader(cookies),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': UA,
    Referer: `${IRDMS_BASE}/`,
  };
}

function isIrdmsRedirect(result: { finalUrl: string; contentType?: unknown; body: string }): boolean {
  try {
    if (/^sso\.hikvision\.com(?:\.cn)?$/i.test(new URL(result.finalUrl).hostname)) return true;
  } catch {
    // A malformed final URL cannot itself prove a redirect.
  }
  const contentType = String(result.contentType ?? '');
  return contentType.toLowerCase().includes('text/html')
    && /sso\.hikvision\.com(?:\.cn)?\/login/i.test(result.body);
}

function toIrdmsResult(result: {
  status: number;
  body: string;
  finalUrl: string;
  headers?: any;
}): IrdmsRawResult {
  return {
    status: result.status,
    body: result.body,
    finalUrl: result.finalUrl,
    contentType: String(result.headers?.['content-type'] ?? ''),
  };
}

async function createIrdmsSession(dataDir: string): Promise<IrdmsSessionCookies> {
  const session = readSsoConfigFile(dataDir);
  if (!session?.cookies?.length) {
    throw new IrdmsUnauthorizedError();
  }

  const serviceUrl = `${IRDMS_CAS_SERVICE_URL}?_t=${Math.floor(Date.now() / 1000)}`;
  const casLoginUrl = `https://sso.hikvision.com/login?service=${encodeURIComponent(serviceUrl)}&anchor_32768=`;
  const cas = await rawRequest('GET', casLoginUrl, session.cookies);
  const cookies = cas.cookies.filter(isIrdmsCookie);
  if (!cookies.length) {
    throw new IrdmsUnauthorizedError('CASTGC expired, please login hicoo first');
  }

  const userInfoResult = toIrdmsResult(await rawRequest('GET', `${IRDMS_CURRENT_USER_URL}?_t=${Math.floor(Date.now() / 1000)}`, [], {
    extraHeaders: irdmsHeaders(cookies),
  }));
  if (isIrdmsRedirect(userInfoResult)) {
    throw new IrdmsUnauthorizedError('IRDMS cookies did not establish a valid session');
  }
  let useInfo: unknown;
  try {
    useInfo = JSON.parse(userInfoResult.body);
  } catch {
    // A transient non-JSON userinfo response should not invalidate usable IRDMS cookies.
  }

  writeSsoConfigFile(dataDir, {
    ...session,
    irdms: {
      cookies,
      useInfo,
      loginAt: Date.now(),
    },
  });
  return { cookies };
}

function invalidateIrdmsSession(dataDir: string): void {
  const session = readSsoConfigFile(dataDir);
  if (!session?.irdms) return;
  const { irdms: _removed, ...nextSession } = session;
  writeSsoConfigFile(dataDir, nextSession);
}

/** 读取缓存的 IRDMS cookies；没有缓存时用 hicoo SSO 的 CASTGC 建立。 */
export async function ensureIrdmsSession(dataDir: string): Promise<IrdmsSessionCookies> {
  return withIrdmsSessionLock(dataDir, async () => {
    const cached = (readSsoConfigFile(dataDir)?.irdms?.cookies ?? []).filter(isIrdmsCookie);
    if (cached.length) {
      return { cookies: cached };
    }
    return createIrdmsSession(dataDir);
  });
}

/** 清掉失效缓存后重建 IRDMS cookies；调用方负责避免普通路径频繁触发。 */
export async function refreshIrdmsSession(dataDir: string): Promise<IrdmsSessionCookies> {
  return withIrdmsSessionLock(dataDir, async () => createIrdmsSession(dataDir));
}

/** IRDMS 统一 GET：会话失效时自动重建并重试一次。 */
export async function irdmsGet(dataDir: string, url: string): Promise<IrdmsRawResult> {
  const { cookies } = await ensureIrdmsSession(dataDir);
  const result = toIrdmsResult(await rawRequest('GET', url, [], {
    extraHeaders: irdmsHeaders(cookies),
  }));
  if (!isIrdmsRedirect(result)) return result;

  invalidateIrdmsSession(dataDir);
  const refreshed = await refreshIrdmsSession(dataDir);
  return toIrdmsResult(await rawRequest('GET', url, [], {
    extraHeaders: irdmsHeaders(refreshed.cookies),
  }));
}

/** IRDMS 统一 POST（JSON body）：会话失效时自动重建并重试一次。 */
export async function irdmsPost(
  dataDir: string,
  url: string,
  payload?: unknown,
): Promise<IrdmsRawResult> {
  const { cookies } = await ensureIrdmsSession(dataDir);
  const result = toIrdmsResult(await rawRequest('POST', url, [], {
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    extraHeaders: irdmsHeaders(cookies),
  }));
  if (!isIrdmsRedirect(result)) return result;

  invalidateIrdmsSession(dataDir);
  const refreshed = await refreshIrdmsSession(dataDir);
  return toIrdmsResult(await rawRequest('POST', url, [], {
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    extraHeaders: irdmsHeaders(refreshed.cookies),
  }));
}
