import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { LanzAccountCredentials } from '@open-design/contracts';
import { loadLanzAccount } from './lanz-account';

import { motion, useReducedMotion } from 'motion/react';
import type { Variants } from 'motion/react';
import { Icon } from '../components/Icon';
import { UpdaterPopup } from '../components/UpdaterPopup';
import { useAppVersion } from '../analytics/provider';
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  AUTH_STATUS_REFRESH_EVENT,
  checkAuthStatus,
  login,
} from './auth';
import styles from './LoginGate.module.css';

interface LoginGateProps {
  children: ReactNode;
}

/** Landscape background images for the login split panel. One is picked at
    random per mount so each page load/refresh shows a different backdrop. */
const LANDSCAPE_IMAGES = [
  '/upgrade/landscape-1.jpg',
  '/upgrade/landscape-2.jpg',
  '/upgrade/landscape-3.jpg',
  '/upgrade/landscape-4.jpg',
  '/upgrade/landscape-5.jpg',
];

/** 认证上下文数据 */
export interface AuthContextValue {
  /** 当前登录用户名 */
  username: string | null;
  /** 服务端返回的用户信息 */
  userInfo: any | null;
  lanzAccount?: LanzAccountCredentials | null;
}

const AuthContext = createContext<AuthContextValue>({
  username: null,
  userInfo: null,
});

/** 在组件树中获取当前认证信息 */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/* Staggered entrance variants for the login screen. Each child fades in
   and slides up with a spring easing. Respects prefers-reduced-motion. */
function useLoginVariants() {
  const reduced = useReducedMotion();
  return {
    container: {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: reduced ? { duration: 0 } : { staggerChildren: 0.06, delayChildren: 0.1 },
      },
    } as Variants,
    item: {
      hidden: { opacity: 0, y: reduced ? 0 : 12 },
      visible: {
        opacity: 1,
        y: 0,
        transition: reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 400, damping: 28, mass: 0.8 },
      },
    } as Variants,
    card: {
      hidden: { opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.97 },
      visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 300, damping: 26, mass: 0.9 },
      },
    } as Variants,
  };
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
  const [lanzAccount, setLanzAccount] = useState<LanzAccountCredentials | null>(null);

  useEffect(() => {
    setLanzAccount(null);
    if (authed !== true || !username) return;
    const controller = new AbortController();
    void loadLanzAccount(username, controller.signal).then((account) => {
      if (!controller.signal.aborted) setLanzAccount(account);
    });
    return () => controller.abort();
  }, [authed, username]);

 useLayoutEffect(() => {
   let cancelled = false;
   let epoch = 0;
   let retry: ReturnType<typeof setTimeout> | undefined;
   const refresh = () => {
     const requestEpoch = ++epoch;
     clearTimeout(retry);
     void checkAuthStatus().then((result) => {
       if (cancelled || requestEpoch !== epoch) return;
       if (!result.ok && result.error === 'unavailable') {
         // An outage is not a sign-out. Keep the current surface and retry,
         // including during startup when no authenticated answer exists yet.
         retry = setTimeout(refresh, 5000);
         return;
       }
       setAuthed(result.ok);
       setUsername(result.ok ? result.username : null);
       setUserInfo(result.ok ? result.userInfo ?? null : null);
     });
   };
   window.addEventListener(AUTH_STATUS_REFRESH_EVENT, refresh);
   // OA heartbeat only; Hikke and UEDRO remain demand-driven.
   const heartbeat = setInterval(refresh, 5 * 60 * 1000);
   refresh();
   return () => {
     cancelled = true;
     clearTimeout(retry);
     clearInterval(heartbeat);
     window.removeEventListener(AUTH_STATUS_REFRESH_EVENT, refresh);
   };
 }, []);

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
    // Session state not confirmed yet: show a neutral surface so neither
    // the app nor the login screen flashes before the check completes.
    // Children are NOT mounted yet so the app's boot logic (which may
    // redirect to /onboarding) does not fire before authentication is
    // confirmed.
   return (
     <div className={styles.appLocked} inert aria-hidden>
       <div className={styles.bootSurface} aria-hidden />
     </div>
   );
 }
 return (
   <AuthContext.Provider value={{ username, userInfo, lanzAccount: lanzAccount?.username.toLowerCase() === username?.toLowerCase() ? lanzAccount : null }}>
     <div
       className={authed ? undefined : styles.appLocked}
       inert={!authed}
       aria-hidden={!authed}
     >
        {authed ? children : null}
     </div>
      {!authed ? <LoginScreen onAuthed={(cb:any) => {
        cb();
        window.dispatchEvent(new Event(AUTH_STATUS_REFRESH_EVENT));
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
 const { container: containerVariants, item: itemVariants, card: cardVariants } = useLoginVariants();
 const [bgIndex, setBgIndex] = useState(() => Math.floor(Math.random() * LANDSCAPE_IMAGES.length));

 useEffect(() => {
   const CAROUSEL_INTERVAL = 6000;
   const id = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % LANDSCAPE_IMAGES.length);
   }, CAROUSEL_INTERVAL);
    return () => clearInterval(id);
  }, []);

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
    <div className={styles.splitImage} aria-hidden>
        {LANDSCAPE_IMAGES.map((src, i) => (
          <div
            key={src}
            className={styles.splitImageLayer}
            style={{ backgroundImage: `url('${src}')`, opacity: i === bgIndex ? 1 : 0 }}
          />
        ))}
      </div>
    <div className={styles.splitContent}>
     <div className={styles.topRightUpdater}>
        <UpdaterPopup />
      </div>
      {/* {appVersion && appVersion !== '0.0.0' ? (
        <div className={styles.bottomLeftVersion}>
          <span className={styles.versionBadge}>
            <span className={styles.versionDot} />
            v{appVersion}
          </span>
        </div>
      ) : null} */}
      {/* Animated aurora background layers */}
      <div className={styles.aurora} aria-hidden>
        <div className={`${styles.auroraBlob} ${styles.auroraBlob1}`} />
        <div className={`${styles.auroraBlob} ${styles.auroraBlob2}`} />
        <div className={`${styles.auroraBlob} ${styles.auroraBlob3}`} />
      </div>
      <div className={styles.gridOverlay} aria-hidden />
      <div className={styles.vignette} aria-hidden />
      <motion.div
        className={styles.card}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          className={styles.brand}
          variants={containerVariants}
        >
          <motion.span className={styles.brandMark} variants={itemVariants} aria-hidden>
            <span className={styles.brandRing} aria-hidden />
            <Icon name="lock" size={20} />
          </motion.span>
          <motion.h1 className={styles.title} variants={itemVariants}>Hi Design</motion.h1>
          <motion.p className={styles.subtitle} variants={itemVariants}>请用OA账号登录</motion.p>
          {/* {fingerprint ? <p className={styles.fingerprint}>{fingerprint}</p> : null} */}
        </motion.div>

        <motion.form
          className={styles.form}
          onSubmit={handleSubmit}
          noValidate
          variants={containerVariants}
        >
          <motion.label className={styles.field} variants={itemVariants}>
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
          </motion.label>

          <motion.label className={styles.field} variants={itemVariants}>
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
          </motion.label>

          <motion.label className={styles.remember} variants={itemVariants}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>记住登录状态</span>
          </motion.label>

          {error ? <motion.p className={styles.error} variants={itemVariants} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{error}</motion.p> : null}

          <motion.button type="submit" className={styles.submit} disabled={pending} variants={itemVariants} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
            {pending ? '登录中…' : '登录'}
          </motion.button>
        </motion.form>
     </motion.div>
     </div>
   </div>
 );
}
