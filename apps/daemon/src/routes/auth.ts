import type { Express } from 'express';
import type {
  AiResearchLaunchResponse,
  GetCurrentUserAvatarResponse,
  HiMindLaunchResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
} from '@open-design/contracts';
import type { Cookie } from '../http/http.js';
import {
  readSsoConfigFile,
  writeSsoConfigFile,
  removeSsoConfigFile,
  hicooLogin,
  hicooLogout,
  hicooValidate,
  type SsoSession,
} from '../http/hik_logins/hicoo.js';
import {
  uedroLogin,
  uedroLogout,
  uedroValidate,
  type UedroInfo,
} from '../http/hik_logins/uedro.js';
import {
  fetchAiResearchLaunch,
  fetchHiMindLaunch,
  syncHdwCommunityAvatar,
} from '../http/hdw.js';
import {
  fetchUplusAvatarOnLogin,
  type UplusAvatarResult,
} from '../integrations/uplus-profile.js';

/**
 * Web login gate endpoint.
 *
 * The daemon is the single source of truth for the web login credential
 * check. Credentials are validated against one configured account:
 * `OD_WEB_USERNAME` / `OD_WEB_PASSWORD`, defaulting to `admin` / `admin123`.
 * This endpoint intentionally is NOT behind `requireLocalDaemonRequest` — the
 * web app must reach it from the browser before the gate has been passed.
 */

export const DEFAULT_WEB_USERNAME = 'admin';
export const DEFAULT_WEB_PASSWORD = 'admin123';

export interface RegisterAuthRoutesDeps {
  env: NodeJS.ProcessEnv;
  sendApiError: (...args: any[]) => any;
  dataDir: string;
  FOR_DESIGNER_DIR?: string;
  createHiMindLaunch?: () => Promise<{ launchUrl: string; expiresIn: number } | null>;
  createAiResearchLaunch?: () => Promise<{ launchUrl: string; expiresIn: number } | null>;
  fetchUplusAvatar?: (username: string, password: string) => Promise<UplusAvatarResult>;
  syncCommunityAvatar?: (dataDir: string, username: string, avatarUrl: string) => Promise<boolean>;
}

const UPLUS_AVATAR_TIMEOUT_MS = 15 * 1000;
const COMMUNITY_AVATAR_SYNC_TIMEOUT_MS = 15 * 1000;

function cachedAvatarUrl(session: SsoSession): string | null {
  const value = session.userInfo?.avatarUrl;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerAuthRoutes(app: Express, deps: RegisterAuthRoutesDeps): void {
  const { env, sendApiError, dataDir, FOR_DESIGNER_DIR } = deps;
  const expectedUsername = (env.OD_WEB_USERNAME ?? '').trim() || DEFAULT_WEB_USERNAME;
  const expectedPassword = env.OD_WEB_PASSWORD ?? DEFAULT_WEB_PASSWORD;
  const fetchUplusAvatar = deps.fetchUplusAvatar ?? fetchUplusAvatarOnLogin;
  const syncCommunityAvatar = deps.syncCommunityAvatar ?? syncHdwCommunityAvatar;
  let lastCommunityAvatarSyncKey = '';
  let pendingCommunityAvatarSync: { key: string; promise: Promise<boolean> } | null = null;
  const cachedCommunityAvatarSyncAttempts = new Set<string>();

  async function trySyncCommunityAvatar(username: string, avatarUrl: string): Promise<boolean> {
    const syncKey = `${username.trim().toLowerCase()}\0${avatarUrl.trim()}`;
    if (lastCommunityAvatarSyncKey === syncKey) return true;
    if (pendingCommunityAvatarSync?.key === syncKey) return pendingCommunityAvatarSync.promise;
    const promise = withTimeout(
      syncCommunityAvatar(dataDir, username, avatarUrl),
      COMMUNITY_AVATAR_SYNC_TIMEOUT_MS,
      false,
    );
    pendingCommunityAvatarSync = { key: syncKey, promise };
    try {
      const synced = await promise;
      if (synced) lastCommunityAvatarSyncKey = syncKey;
      return synced;
    } finally {
      if (pendingCommunityAvatarSync?.promise === promise) pendingCommunityAvatarSync = null;
    }
  }

  function getSsoCookie(): SsoSession {
    const session = readSsoConfigFile(dataDir);
    if (!session) return {};
    return session;
  }

  function setSsoSession(
    username: string,
    userInfo?: any,
    cookies?: Cookie[],
    uedro?: UedroInfo,
  ) {
    const session: SsoSession = {
      cookies: cookies || [],
      username: username,
      userInfo,
      loginAt: Date.now(),
    };
    if (uedro) {
      session.uedro = {
        cookies: uedro.cookies
      };
    }
    writeSsoConfigFile(dataDir, session, FOR_DESIGNER_DIR);
  }

  function clearSsoSession() {
    removeSsoConfigFile(dataDir);
  }

  app.post('/api/auth/login', async (req, res) => {
    const body = (req.body ?? {}) as Partial<LoginRequest>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'username and password are required');
    }
    async function done_uedproLogin() {
      // a. 接入羽点登录，https://uedro.hikvision.com.cn/portal/ui/login?service=https%3A%2F%2Fuedro.hikvision.com.cn%3A443%2Fportal%2F
      // SSO 登录成功后，用同一账号顺带登录羽点门户，写入登录后信息。
      // 羽点登录失败不阻断主登录流程，仅记录告警，保证 SSO 会话可用。
      let uedro = null;
      try {
        const uedroResult = await uedroLogin(username, password);
        if (uedroResult.ok) {
          uedro = uedroResult
        }
      } catch (uedroErr: any) {
        console.warn('uedro login failed:', uedroErr?.message || uedroErr);
      }
      return uedro;
    }
    let result: any = null;
    let error = null;
    // 2. 尝试海康 SSO 登录
    try {
      result = await hicooLogin(username, password);
    } catch (err: any) {
      error = err;

    }
    let uedro: any = await done_uedproLogin()
    if (result || uedro) {
      const uplusAvatar = await withTimeout(
        fetchUplusAvatar(username, password),
        UPLUS_AVATAR_TIMEOUT_MS,
        { ok: false, reason: 'request_error' } as UplusAvatarResult,
      );
      if (!uplusAvatar.ok) {
        console.warn('UPlus avatar sync failed during OA login', {
          reason: uplusAvatar.reason,
          status: uplusAvatar.status,
          businessCode: uplusAvatar.businessCode,
        });
      }
      const baseUserInfo = result?.userInfo || uedro?.userInfo;
      const userInfo = uplusAvatar.ok && uplusAvatar.avatarUrl
        ? { ...(baseUserInfo ?? {}), avatarUrl: uplusAvatar.avatarUrl }
        : baseUserInfo;
      // 将 SSO cookie 及羽点登录信息写入本地 session
      setSsoSession(
        result?.username || username,
        userInfo,
        result?.cookies,
        uedro
      );
      if (uplusAvatar.ok && uplusAvatar.avatarUrl) {
        const communityAvatarSynced = await trySyncCommunityAvatar(
          result?.username || username,
          uplusAvatar.avatarUrl,
        );
        if (!communityAvatarSynced) {
          console.warn('HDW community avatar sync failed during OA login');
        }
      }
      const response: LoginResponse = {
        ok: true,
        username,
        uedro,
        userInfo
      };
      res.json(response);
    } else {
      if (error) {
        if (error.message === 'SSO login page unavailable') {
          return sendApiError(res, 401, 'UNAUTHORIZED', 'SSO login page unavailable');
        }
        if (error.message === 'SSO form fields not found') {
          return sendApiError(res, 401, 'UNAUTHORIZED', 'SSO form fields not found');
        }
        if (error.message === 'invalid username or password') {
          return sendApiError(res, 401, 'UNAUTHORIZED', 'invalid username or password');
        }
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'SSO login failed,' + JSON.stringify(error));
      }
      res.json({ok:false,username});
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const session = getSsoCookie();
      // 先清除本地 session（无论 SSO 退出是否成功，本地都必须清掉）
      clearSsoSession();

      await hicooLogout(session);
      // 羽点登出：失败不影响本地清退结果
      if (session.uedro?.cookies?.length) {
        await uedroLogout(session.uedro.cookies);
      }

      const response: LogoutResponse = { ok: true };
      return res.json(response);
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'SSO logout failed');
    }
  });

  app.get('/api/auth/avatar', async (_req, res) => {
    const session = getSsoCookie();
    if (!session.username?.trim() || !session.cookies?.length) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'OA login is required');
    }

    const avatarUrl = cachedAvatarUrl(session);
    if (avatarUrl) {
      const syncKey = `${session.username.trim().toLowerCase()}\0${avatarUrl}`;
      if (!cachedCommunityAvatarSyncAttempts.has(syncKey)) {
        cachedCommunityAvatarSyncAttempts.add(syncKey);
        void trySyncCommunityAvatar(session.username, avatarUrl).then((synced) => {
          if (!synced) console.warn('HDW community avatar sync failed from cached OA session');
        });
      }
    }
    const response: GetCurrentUserAvatarResponse = {
      ok: true,
      avatarUrl,
    };
    return res.json(response);
  });

  app.post('/api/auth/himind/launch', async (_req, res) => {
    const session = getSsoCookie();
    if (!session.username?.trim() || !session.cookies?.length) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'OA login is required');
    }
    try {
      const launch = await (deps.createHiMindLaunch ?? (() => fetchHiMindLaunch(dataDir)))();
      if (!launch) {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'HiMind login ticket could not be issued');
      }
      const response: HiMindLaunchResponse = {
        ok: true,
        launchUrl: launch.launchUrl,
        expiresIn: launch.expiresIn,
      };
      return res.json(response);
    } catch (err) {
      console.warn('HiMind SSO launch failed:', err);
      return sendApiError(res, 502, 'BAD_GATEWAY', 'HiMind login ticket could not be issued');
    }
  });

  app.post('/api/auth/ai-research/launch', async (_req, res) => {
    const session = getSsoCookie();
    if (!session.username?.trim() || !session.cookies?.length) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'OA login is required');
    }
    try {
      const launch = await (
        deps.createAiResearchLaunch ?? (() => fetchAiResearchLaunch(dataDir))
      )();
      if (!launch) {
        return sendApiError(
          res,
          502,
          'BAD_GATEWAY',
          'AI research login ticket could not be issued',
        );
      }
      const response: AiResearchLaunchResponse = {
        ok: true,
        launchUrl: launch.launchUrl,
        expiresIn: launch.expiresIn,
      };
      return res.json(response);
    } catch (err) {
      console.warn('AI research SSO launch failed:', err);
      return sendApiError(
        res,
        502,
        'BAD_GATEWAY',
        'AI research login ticket could not be issued',
      );
    }
  });

  // GET /api/auth/valid — 验证海康 SSO 登录状态
  // 通过访问 https://oa.hikvision.com.cn/ 判断是否跳转到登录页来验证会话是否有效
  app.get('/api/auth/valid', async (req, res) => {
    try {
      const session = getSsoCookie();
      const result = await hicooValidate(session, dataDir, FOR_DESIGNER_DIR);
      const uedroResult = await uedroValidate(session.uedro?.cookies);
      if ((!result.ok&&!session.userInfo)//OA登录没成功并且也没有得到用户信息，说明后续没有其他的系统登录成功过
        || !uedroResult.ok // 如果羽点超时，需要重登录
      ) {
        // 会话失效，清除本地 session
        clearSsoSession();
        const response: any = { ok: false, username: result.username || '',uedroResult };
        return res.json(response);
      }
      // 会话有效
      const response: any = {
        ok: true,
        uedroResult,
        username: result.username,
        userInfo: result.userInfo
      };
      return res.json(response);
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'auth valid failed');
    }
  });
}
