/**
 * Minimal single-account login gate for the web app.
 *
 * Scope: this is a UI-level gate that sits in front of the whole SPA. It
 * authenticates against the daemon's `POST /api/auth/login` endpoint (the
 * daemon is the single source of truth for the credential check) and keeps a
 * lightweight session marker in browser storage. It is NOT server-side
 * security — the daemon's `/api/*` endpoints remain open, so this only keeps
 * casual users out of the UI, not out of the local HTTP API.
 *
 * Session semantics:
 *  - Default (no "remember me"): the session lives in `sessionStorage`, so a
 *    new browser/app session requires logging in again — matching "opening the
 *    app must ask for login first".
 *  - "Remember me": the session also lives in `localStorage`, so it survives
 *    restarts until the user logs out.
 *
 * Reading always checks both storages so a session written under either mode
 * keeps the user signed in until they explicitly log out.
 */

export interface AuthSession {
  version: number;
  username: string;
  userInfo?: any;
  loginAt: number;
}

export const DEFAULT_USERNAME = 'admin';
export const DEFAULT_PASSWORD = 'admin123';

export type LoginResult =
  | { ok: true; username: string; userInfo?: any }
  | { ok: false; error: 'invalid-credentials' | 'unavailable' };

const AUTH_SESSION_KEY = 'open-design:auth-session';
const AUTH_SESSION_VERSION = 1;

function readSessionFrom(storage: Storage): AuthSession | null {
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      parsed &&
      parsed.version === AUTH_SESSION_VERSION &&
      typeof parsed.username === 'string' &&
      parsed.username.length > 0
    ) {
      return parsed as AuthSession;
    }
  } catch {
    // Corrupt or blocked storage — treat as logged out.
  }
  return null;
}

export function isAuthenticated(): boolean {
  return (
    (typeof sessionStorage !== 'undefined' && readSessionFrom(sessionStorage) !== null) ||
    (typeof localStorage !== 'undefined' && readSessionFrom(localStorage) !== null)
  );
}

/** 获取当前存储在浏览器中的用户名（用于服务端验证） */
export function getStoredUsername(): string | null {
  const session: any =
    (typeof sessionStorage !== 'undefined' && readSessionFrom(sessionStorage)) ||
    (typeof localStorage !== 'undefined' && readSessionFrom(localStorage));
  return session?.username ?? null;
}
/** 获取当前存储在浏览器中的用户名（用于服务端验证） */
export function getStoredUserInfo(): any {
  const session: any =
    (typeof sessionStorage !== 'undefined' && readSessionFrom(sessionStorage)) ||
    (typeof localStorage !== 'undefined' && readSessionFrom(localStorage));
  return session?.userInfo ?? {};
}

/**
 * 异步调用 /api/auth/getUserName 验证服务端登录状态。
 * 如果服务端返回了用户名，说明已登录；否则未登录。
 */
export async function checkAuthStatus(): Promise<
  { ok: true; username: string; userInfo?: any } | { ok: false }
> {
  try {
    const response = await fetch(
      `/api/auth/valid`,
    );
    if (!response.ok) {
      return { ok: false };
    }

    const data = (await response.json()) as { ok: boolean; username: string; userInfo?: any };
    if (data.ok && typeof data.username === 'string' && data.username.length > 0) {
      // 同步保存 username + userInfo 到 sessionStorage，确保 FileViewer 等组件能获取
      if (data.userInfo) {
        syncUsernameToStorage(data.username, data.userInfo);
      }
      return { ok: true, username: data.username, userInfo: data.userInfo };
    }
  } catch {
    // 网络错误，视为未登录
  }

  return { ok: false };
}

/** 将 username 同步到 sessionStorage（不覆盖已有的 localStorage 记住状态） */
function syncUsernameToStorage(username: string, userInfo: any): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const session: AuthSession = {
      version: AUTH_SESSION_VERSION,
      username,
      userInfo,
      loginAt: Date.now(),
    };
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // 存储失败时静默处理
  }
}

/**
 * Validate credentials against the daemon (`POST /api/auth/login`) and persist
 * a session on success.
 *
 * Returns `{ ok: true, username }` on success, `{ ok: false, error:
 * 'invalid-credentials' }` when the daemon rejects the credentials, and
 * `{ ok: false, error: 'unavailable' }` when the daemon cannot be reached or
 * the session could not be persisted. The caller shows the appropriate error.
 */
export async function login(username: string, password: string, remember: boolean): Promise<any> {
  let response: Response;
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  if (response.status === 401) {
    return { ok: false, error: 'invalid-credentials' };
  }
  if (!response.ok) {
    return { ok: false, error: 'unavailable' };
  }

  let payload: any;
  try {
    payload = (await response.json()) as { username?: unknown };
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  const sessionUsername =
    typeof payload.username === 'string' && payload.username.length > 0
      ? payload.username
      : username.trim();

  const session: AuthSession = {
    version: AUTH_SESSION_VERSION,
    username: sessionUsername,
    loginAt: Date.now(),
  };
  const storage = remember ? localStorage : sessionStorage;
  if (typeof storage === 'undefined') return { ok: false, error: 'unavailable' };
  try {
    storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  // 保留完整的 userInfo（含 email 等字段），供 NewTeamModal 等组件使用。
  syncUsernameToStorage(sessionUsername, payload?.userInfo ?? {});
  return { ok: true, username: sessionUsername, userInfo: payload?.userInfo };
}

/** Clear the session from every storage the gate could have written to, and notify the server. */
export async function logout(): Promise<any> {
  try {
    return await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // 服务端登出失败时仍继续清除本地状态
  }
}
