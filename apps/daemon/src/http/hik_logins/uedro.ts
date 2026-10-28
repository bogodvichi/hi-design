import * as crypto from 'crypto';
import {
  rawRequest,
  type Cookie,
  type RawRequestOptions,
  type RawResult,
} from '../http.js';

// ── 常量 ──────────────────────────────────────────────────────────

/** 羽点（uedro）门户基础地址。 */
export const UEDRO_BASE = 'https://uedro.hikvision.com.cn';

/** Browser pages that may be opened through the UEDRO CAS launch flow. */
const UEDRO_PAGE_QUERY_POLICY = {
  '/uedro/home': { required: [], optional: [] },
  '/uedro/html': {
    required: ['id'],
    optional: ['projectid', 'projName', 'projManager'],
  },
  '/uedro/ux': { required: ['id'], optional: [] },
  '/uedro/ua': { required: ['id'], optional: [] },
  '/uedro/pdf-js': {
    required: ['id'],
    optional: ['projectid', 'projName', 'projManager'],
  },
  '/uedro/xlsx': {
    required: ['id'],
    optional: ['projectid', 'projName', 'projManager'],
  },
} as const satisfies Record<string, { required: readonly string[]; optional: readonly string[] }>;

export const UEDRO_ALLOWED_PAGE_PATHS = new Set(Object.keys(UEDRO_PAGE_QUERY_POLICY));

export const UEDRO_HOME_URL = UEDRO_BASE + '/uedro/home';

/**
 * 登录入口页。`service` 参数即登录成功后要跳转回的目标地址，
 * 与浏览器访问 `/portal/ui/login?service=...` 时一致。
 */
export const UEDRO_LOGIN_URL =
  'https://uedro.hikvision.com.cn/portal/ui/login?service=https%3A%2F%2Fuedro.hikvision.com.cn%3A443%2Fportal%2F';

/** 羽点门户 API 前缀（前端 axios baseURL = `/portal`）。 */
const UEDRO_API_BASE = UEDRO_BASE + '/portal';

/** 取公钥：GET /portal/front/public/key */
const UEDRO_PUBLIC_KEY_URL = UEDRO_API_BASE + '/front/public/key';

/** 提交登录：POST /portal/cas/login/submit */
const UEDRO_LOGIN_SUBMIT_URL = UEDRO_API_BASE + '/cas/login/submit';

/** 取 JWT：POST /portal/front/user/getJwtToken */
const UEDRO_JWT_URL = UEDRO_API_BASE + '/front/user/getJwtToken';

/** 校验登录态：GET /uedro/web/login/v1/userInfo */
const UEDRO_IS_LOGIN_URL = UEDRO_BASE + '/uedro/web/login/v1/userInfo';

/** 基础信息：GET /portal/front/common/basicInfo */
const UEDRO_BASIC_INFO_URL = UEDRO_API_BASE + '/front/common/basicInfo';

/** 取用户信息：GET '/uedro/web/user/v1/list（uedro 应用侧，非 /portal 前缀） */
const UEDRO_USER_INFO_URL = UEDRO_BASE + '/uedro/web/user/v1/list';

/** 登出：POST /portal/cas/logout */
const UEDRO_LOGOUT_URL = UEDRO_API_BASE + '/cas/logout';

// ── 类型 ──────────────────────────────────────────────────────────

/** 羽点登录后写入 session 的信息。 */
export interface UedroInfo {
  /** 羽点门户下发的会话 cookie（EPORTAL_JSESSIONID 等）。 */
  cookies?: Cookie[] | undefined;
  /** 登录成功后跳转的目标地址（service）。 */
  serviceUrl?: string | undefined;
  /** 羽点门户下发的 cas-jwt（前端原存于 localStorage["cas-jwt"]）。 */
  casJwt?: string | undefined;
  /** 羽点门户基础信息（用户名、皮肤等）。 */
  basicInfo?: any;
  /** 登录时刻。 */
  loginAt?: number | undefined;
}

export interface UedroLoginResult {
  ok: boolean;
  cookies?: Cookie[];
  username?:string;
  userInfo?:any;
}

export interface UedroValidResult {
  ok: boolean;
  casJwt?: string;
  basicInfo?: any;
}

export interface UedroLogoutResult {
  ok: boolean;
}

type UedroRequest = (
  method: string,
  urlStr: string,
  cookies: Cookie[],
  opts?: RawRequestOptions,
) => Promise<RawResult>;

// ── 内部工具 ──────────────────────────────────────────────────────

/**
 * 用羽点公钥以 RSA/PKCS1 v1.5 加密明文，再 base64 编码。
 *
 * 前端使用 JSEncrypt（`new JSEncrypt(); setPublicKey(pk); encrypt(text)`），
 * 其默认填充即为 PKCS#1 v1.5，与 Node `crypto.publicEncrypt` 配合
 * `RSA_PKCS1_PADDING` 等价。
 */
function rsaEncrypt(publicKeyPem: string, plaintext: string): string {
  const pem = normalizePublicKeyPem(publicKeyPem);
  return crypto
    .publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(plaintext, 'utf8'),
    )
    .toString('base64');
}

/** 服务端返回的公钥是裸 base64 串，补成 PEM 再交给 crypto。 */
function normalizePublicKeyPem(raw: string): string {
  const body = raw.replace(/\s+/g, '');
  if (body.includes('-----BEGIN')) return body;
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
}

/** 解析羽点统一响应体 `{ code, msg, data }`，code !== '0' 视为失败。 */
function parseUedroResponse(body: string): { code: string; msg?: string; data: any } {
  const parsed = JSON.parse(body) as { code: string; msg?: string; data: any };
  return parsed;
}

function buildCookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function hasAllowedUedroPageQuery(url: URL): boolean {
  const policy = UEDRO_PAGE_QUERY_POLICY[
    url.pathname as keyof typeof UEDRO_PAGE_QUERY_POLICY
  ];
  if (!policy) return false;
  const allowed = new Set<string>([...policy.required, ...policy.optional]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return false;
  }
  for (const key of allowed) {
    if (url.searchParams.getAll(key).length > 1) return false;
  }
  for (const key of policy.required) {
    const value = url.searchParams.get(key);
    if (value === null || !value.trim()) return false;
  }
  return true;
}

/**
 * Validate an official UEDRO browser target and strip nothing implicitly.
 * Missing input resolves to the historical-review home page.
 */
export function normalizeUedroLaunchTarget(value: unknown = undefined): string | null {
  if (value === undefined || value === null) return UEDRO_HOME_URL;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:'
      || url.origin !== UEDRO_BASE
      || url.username
      || url.password
      || url.hash
      || !UEDRO_ALLOWED_PAGE_PATHS.has(url.pathname)
      || !hasAllowedUedroPageQuery(url)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** True only for the requested UEDRO page carrying a CAS service ticket. */
export function isUedroTicketUrl(value: string, targetUrl: string): boolean {
  const target = normalizeUedroLaunchTarget(targetUrl);
  if (!target) return false;
  try {
    const expected = new URL(target);
    const actual = new URL(value);
    return actual.protocol === 'https:'
      && actual.origin === UEDRO_BASE
      && actual.pathname === expected.pathname
      && !actual.username
      && !actual.password
      && !actual.hash
      && hasMatchingUedroSearchParams(actual, expected);
  } catch {
    return false;
  }
}

function hasMatchingUedroSearchParams(actual: URL, expected: URL): boolean {
  const tickets = actual.searchParams.getAll('ticket');
  if (
    tickets.length !== 1
    || !tickets[0]?.startsWith('ST-')
    || tickets[0].length <= 3
    || actual.searchParams.size !== expected.searchParams.size + 1
  ) {
    return false;
  }
  for (const [key] of expected.searchParams) {
    const expectedValues = expected.searchParams.getAll(key);
    const actualValues = actual.searchParams.getAll(key);
    if (
      actualValues.length !== expectedValues.length
      || actualValues.some((value, index) => value !== expectedValues[index])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Ask UEDRO's CAS endpoint for a fresh service ticket without following the
 * final redirect. The returned URL must be consumed exactly once by the
 * browser, otherwise its ticket may already be invalid.
 */
export async function createUedroLaunchUrl(
  cookies: Cookie[],
  targetUrl: string = UEDRO_HOME_URL,
  request: UedroRequest = rawRequest,
): Promise<string> {
  const target = normalizeUedroLaunchTarget(targetUrl);
  if (!target) throw new Error('invalid uedro launch target');
  if (!cookies?.length) throw new Error('uedro login is required');

  const casUrl = `${UEDRO_BASE}/portal/cas/login?service=${encodeURIComponent(target)}`;
  const result = await request('GET', casUrl, cookies, {
    stopRedirect: (nextUrl) => isUedroTicketUrl(nextUrl, target),
  });
  if (!isUedroTicketUrl(result.finalUrl, target)) {
    throw new Error('uedro login ticket could not be issued');
  }
  return result.finalUrl;
}

export function uedroHeaders(cookies: Cookie[], extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json;charset=UTF-8',
    Referer: UEDRO_LOGIN_URL,
  };
  const cookieStr = buildCookieHeader(cookies);
  if (cookieStr) headers['Cookie'] = cookieStr;
  return { ...headers, ...extra };
}

// ── 业务逻辑 ──────────────────────────────────────────────────────

/**
 * 羽点（uedro）门户登录。
 *
 * 流程对齐前端 `login.js`：
 *   1. GET /portal/front/public/key  取 RSA 公钥（同时下发 EPORTAL_JSESSIONID）
 *   2. 用公钥 RSA 加密 userName / password
 *   3. POST /portal/cas/login/submit  提交 { serviceUrl, language, publicKey, userName, password, verifyCode, verifyCodeId }
 *   4. POST /portal/front/user/getJwtToken  取 cas-jwt
 *   5. GET /uedro/web/login/v1/userInfo  取用户信息
 *
 * @param username 用户名（与海康 SSO 同账号）
 * @param password 明文密码（与海康 SSO 同密码）
 * @param serviceUrl 登录成功后跳转的目标地址，默认为门户首页
 */
export async function uedroLogin(
  username: string,
  password: string,
  serviceUrl: string = 'https://uedro.hikvision.com.cn/portal/',
): Promise<UedroLoginResult> {
  // Step 1: 取 RSA 公钥（同时下发 EPORTAL_JSESSIONID）,并加密用户名，密码
  const step1 = await rawRequest('GET', UEDRO_PUBLIC_KEY_URL, [], {
    extraHeaders: uedroHeaders([]),
  });
  let publicKey: string;
  try {
    const parsed = parseUedroResponse(step1.body);
    if (parsed.code !== '0' || !parsed.data?.publicKey) {
      throw new Error('uedro public key missing');
    }
    publicKey = parsed.data.publicKey as string;
  } catch {
    throw new Error('uedro public key missing');
  }

  const encUser = rsaEncrypt(publicKey, username);
  const encPwd = rsaEncrypt(publicKey, password);
  // return {
  //   ok:false,
  //   other:{
  //     publicKey,
  //     encUser,
  //     encPwd
  //   }
  // }

  // Step 2: 提交登录
  const submitBody = JSON.stringify({
    serviceUrl,
    language: 'zh_CN',
    publicKey,
    userName: encUser,
    password: encPwd,
    verifyCode: '',
    verifyCodeId: '',
  });

  const step2 = await rawRequest('POST', UEDRO_LOGIN_SUBMIT_URL, step1.cookies, {
    body: submitBody,
    extraHeaders: uedroHeaders(step1.cookies),
  });

  // 登录失败：响应体 code !== '0'，msg 提示原因
  let redirectUrl: string | undefined;
  try {
    const parsed = parseUedroResponse(step2.body);
    if (parsed.code !== '0') {
      throw new Error(parsed.msg || 'uedro login failed');
    }
    redirectUrl = typeof parsed.data === 'string' ? parsed.data : undefined;
  } catch (err: any) {
    // 网关层错误（非 JSON / 5xx）也归一到登录失败
    throw new Error(err.message || 'uedro login failed');
  }

  let mergedCookies = step2.cookies;

  // Step 3: 用 CAS 票据换取 uedro 应用会话。
  // redirectUrl 是 /bic/ssoService/v1/tokenLogin?token=ST-...&service=.../uedro/home,
  // 服务端校验 ST 后下发 uedro 应用侧会话 cookie 并 302 到 /uedro/home。
  // rawRequest 内置 3xx 自动跟随 + cookie 合并,一次 GET 即走完整条链。
  // 不走这一步则 mergedCookies 仅含 /portal 门户会话,鉴权不了 /uedro/* 应用接口。
  if (redirectUrl) {
    const step3 = await rawRequest('GET', redirectUrl, mergedCookies, {
      extraHeaders: uedroHeaders(mergedCookies),
    });
    mergedCookies = step3.cookies;
  }

  // Step 4: 取用户信息（uedro 应用侧 /uedro/web/login/v1/userInfo）
  // 仅凭门户会话 cookie 鉴权，不带 token 头。
  let userInfo: any;
  try {
    const step4 = await rawRequest('GET', UEDRO_IS_LOGIN_URL, mergedCookies, {
      // body:JSON.stringify({
      //   pageNo: 1,
      //   pageSize: 15,
      //   userName: username
      // }),
      extraHeaders: uedroHeaders(mergedCookies),
    });
    if (step4) {
      mergedCookies = step4.cookies;
    }
    userInfo = JSON.parse(step4.body)?.data//?.list?.find((n:any)=>n.email===`${username}@hikvision.com.cn`)
  } catch(err) {
    // 取用户信息失败不阻断主流程
    userInfo = {
      err
    };
  }
  if(userInfo&&!userInfo.displayName){
     userInfo.displayName = userInfo.name;
  }
  // if(!userInfo.departmentDetail){
  //   userInfo.departmentDetail = userInfo.userDeptPath.replace(/(\\)/g,'/');
  // }
  return {
    ok: true,
    username,
    userInfo,
    cookies: mergedCookies
  };
}

/**
 * 羽点登出。通知服务端销毁会话；本地 session 清理由调用方负责。
 */
export async function uedroLogout(cookies: Cookie[]): Promise<UedroLogoutResult> {
  if (cookies?.length) {
    try {
      await rawRequest('POST', UEDRO_LOGOUT_URL, cookies, {
        body: '{}',
        extraHeaders: uedroHeaders(cookies),
      });
    } catch {
      // 登出失败不影响本地清退
    }
  }
  return { ok: true };
}

/**
 * 校验羽点会话是否仍有效。
 *
 * 通过 GET /uedro/web/login/v1/userInfo 判断：响应 code === '0' 即有效。
 */
export async function uedroValidate(cookies: Cookie[]): Promise<UedroValidResult> {
  if (!cookies?.length) {
    return { ok: false };
  }
  try {
    const result = await rawRequest('GET', UEDRO_IS_LOGIN_URL, cookies, {
      extraHeaders: uedroHeaders(cookies),
    });
    const parsed = parseUedroResponse(result.body);
    if (parsed.code !== '0') {
      return { ok: false };
    }
    return { ok: true,basicInfo:parsed };
  } catch {
    return { ok: false };
  }
}
