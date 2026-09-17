import * as crypto from 'crypto';
import { rawRequest, type Cookie } from '../http.js';

// ── 常量 ──────────────────────────────────────────────────────────

/** 羽点（uedro）门户基础地址。 */
export const UEDRO_BASE = 'https://uedro.hikvision.com.cn';

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
