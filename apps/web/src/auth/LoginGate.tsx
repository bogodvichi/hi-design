import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { Icon } from '../components/Icon';
import { UpdaterPopup } from '../components/UpdaterPopup';
import { useAppVersion } from '../analytics/provider';
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  checkAuthStatus,
  login,
} from './auth';
import styles from './LoginGate.module.css';

interface LoginGateProps {
  children: ReactNode;
}

/** 认证上下文数据 */
export interface AuthContextValue {
  /** 当前登录用户名 */
  username: string | null;
  /** 服务端返回的用户信息 */
  userInfo: any | null;
}

const AuthContext = createContext<AuthContextValue>({
  username: null,
  userInfo: null,
});

/** 在组件树中获取当前认证信息 */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Login gate wrapping the whole SPA.
 *
 * Session state is tri-state so the login screen can never flash on entry:
 *  - `null` (unknown): initial server + first client render. A neutral
 *    full-screen surface is shown (no login card, no app content) until a
 *    layout effect confirms the real session state. The browser-painted
 *    pre-hydration HTML therefore never contains the login overlay.
 *  - `true`: a session exists → app unlocked.
 *  - `false`: no session → app locked behind the login screen.
 *
 * While locked or confirming, the app stays mounted underneath (wrapped in
 * `inert` + `aria-hidden`) so the desktop splash reveal
 * (`data-od-app-mounted`), the theme application and the white-screen
 * detector all keep working. The login screen is an inline fixed overlay on
 * top (kept in-tree — not a portal — so the server-rendered HTML matches
 * hydration) until the built-in account signs in.
 */
export function LoginGate({ children }: LoginGateProps) {
  // Unknown everywhere (server + first client render) so the prerendered HTML
  // never contains the login overlay; sync the real session state in a layout
  // effect before paint — a returning user never sees a login flash, and
  // SSR/prerender never touches browser storage or `document`.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<any | null>(null);

 useLayoutEffect(() => {
   checkAuthStatus().then((result: any) => {
     console.log('我拿到用户信息了吗？',result);
     setAuthed(result.ok);
     if (result.ok) {
       setUsername(result.username ?? null);
       setUserInfo(result.userInfo ?? null);
     }
   });
 }, []);

  // 心跳：登录成功后定期调用 /api/auth/valid 维持 uedro 门户会话。
  // uedro 的 EPORTAL_JSESSIONID 长时间无活动会被服务端过期，定时校验
  // 相当于一次真实访问，可续期；若返回失效则回到登录界面。
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (authed !== true) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }
    const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 分钟
    heartbeatRef.current = setInterval(() => {
      checkAuthStatus().then((result: any) => {
        if (!result.ok) {
          // 会话失效，回到登录界面
          setAuthed(false);
          setUsername(null);
          setUserInfo(null);
        }
      });
    }, HEARTBEAT_INTERVAL);
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [authed]);

  // 获取浏览器指纹
  // useEffect(() => {
  //   let _window = window as any;
  //   _window.Fingerprint2.get({}, (components:any) => {
  //     const values = components.map((component:any) => component.value);
  //     const fingerprintId = _window.Fingerprint2.x64hash128(values.join(''),31);
  //     setFingerprint(fingerprintId);
  //   });
  // }, []);

  if (authed === null) {
    // Session state not confirmed yet: keep the app mounted underneath but
    // cover it with a neutral surface so neither the app nor the login screen
    // flashes before the check completes.
    return (
      <div className={styles.appLocked} inert aria-hidden>
        {children}
        <div className={styles.bootSurface} aria-hidden />
      </div>
    );
  }
  return (
    <AuthContext.Provider value={{ username, userInfo }}>
      <div
        className={authed ? undefined : styles.appLocked}
        inert={!authed}
        aria-hidden={!authed}
      >
        {children}
      </div>
      {!authed ? <LoginScreen onAuthed={(cb:any) => {
        // 登录成功后立即调一次 valid，既刷新用户信息也充当首次心跳。
        checkAuthStatus().then((result: any) => {
          cb();
          setAuthed(result.ok);
          if (result.ok) {
            setUsername(result.username ?? null);
            setUserInfo(result.userInfo ?? null);
          }
        });
        //setAuthed(true)
      }} fingerprint={fingerprint} /> : null}
    </AuthContext.Provider>
  );
}

function LoginScreen({ onAuthed, fingerprint }: { onAuthed: (cb:any) => void; fingerprint: string | null }) {
  // Pre-fill the built-in account so the default credentials are one click
  // away; the user can clear and type their own values if changed later.
  // Version matches apps/packaged/package.json in packaged builds (the daemon
  // pins it through OD_APP_VERSION); in dev it reflects the running daemon.
  const appVersion = useAppVersion();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const name = username.trim();
    if (!name || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setPending(true);
    try {
      const result = await login(name, password, remember);
      if (result.ok) {
        // 登录成功后拉取羽点评审列表（联调验证）
        fetch('/api/hik/uedro/reviewList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewName: '',
            processType: 0,
            reviewModel: 0,
            reviewType: '',
            pageSize: 9,
            pageNo: 1,
            total: 0,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            console.log('uedro reviewList', data);
          })
          .catch((err) => {
            console.warn('uedro reviewList failed', err);
          });
        onAuthed(()=>{
          setPending(false);
        });
      } else if (result.error === 'invalid-credentials') {
        setError('用户名或密码错误');
        setPending(false);
      } else {
        setError('无法连接本地服务，请稍后重试');
        setPending(false);
      }
    } catch(e) {
       setPending(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      {/* <div className={styles.topLeftLogo}>
        <span className="od-brand-glyph" style={{ width: 80, height: 80, display: 'inline-block' }} />
      </div> */}
      <div className={styles.topRightUpdater}>
        <UpdaterPopup />
      </div>
      {appVersion && appVersion !== '0.0.0' ? (
        <div className={styles.bottomLeftVersion}>当前版本：v{appVersion}</div>
      ) : null}
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            <Icon name="lock" size={20} />
          </span>
          <h1 className={styles.title}>Hi Design</h1>
          <p className={styles.subtitle}>请用OA账号登录</p>
          {/* {fingerprint ? <p className={styles.fingerprint}>{fingerprint}</p> : null} */}
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>用户名</span>
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              spellCheck={false}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>密 码</span>
            <span className={styles.inputWrap}>
              <input
                className={styles.input}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                style={{ padding: "0" }}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
              </button>
            </span>
          </label>

          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>记住登录状态</span>
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <button type="submit" className={styles.submit} disabled={pending}>
            {pending ? '登录中…' : '登录'}
          </button>
        </form></div>
    </div>
  );
}
