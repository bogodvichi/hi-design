import { Button } from '@open-design/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { dispatchOpenWorkspaceTab } from './workspaceTabEvents';
import styles from './FederatedBrowserSession.module.css';

export type FederatedAuthState = 'idle' | 'requesting' | 'callback' | 'authenticated' | 'unconfirmed' | 'failed' | 'manual';
type WebviewElement = HTMLElement & { getURL?(): string; stop?(): void };
type NavigationEvent = Event & { url?: string; isMainFrame?: boolean; errorCode?: number };

interface Props {
  canonicalUrl: string;
  bootstrapUrl?: string;
  title: string;
  resourceKey: string;
  testIdPrefix: string;
  active: boolean;
  desktopWebview: boolean;
  launchEndpoint?: string;
  callbackPath?: string;
  readyMessageType?: string;
  authRequiredMessageType?: string;
}

const ATTEMPT_TIMEOUT_MS = 15_000;
const FEDERATED_TOOLS_PARTITION = 'persist:hi-design-team-federated-tools';

function parsedUrl(raw: string | null | undefined): URL | null {
  try { return raw ? new URL(raw) : null; } catch { return null; }
}

/** Callback tickets may only navigate to the configured service, never a supplied third-party URL. */
function trustedCallback(raw: unknown, origin: string | undefined, callbackPath?: string): string | null {
  if (typeof raw !== 'string') return null;
  const url = parsedUrl(raw);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
    || url.username || url.password || (callbackPath && url.pathname !== callbackPath)
    || !url.searchParams.get('ticket')) return null;
  return url.href;
}

/** Own requests in the persistent tool tab, not in the community card that navigates away. */
export function FederatedBrowserSession(props: Props) {
  const t = useT();
  const options = useRef(props);
  options.current = props;
  const [src, setSrc] = useState(props.canonicalUrl);
  const srcRef = useRef(src);
  srcRef.current = src;
  const [pageLoaded, setPageLoaded] = useState(false);
  const pageLoadedRef = useRef(false);
  const [auth, setAuth] = useState<FederatedAuthState>('idle');
  const authRef = useRef<FederatedAuthState>('idle');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const callbackStarted = useRef(false);
  const manualSelected = useRef(false);
  const recoveryAttempted = useRef(false);
  const initialBootstrap = useRef(props.bootstrapUrl);
  const lastBootstrap = useRef(props.bootstrapUrl);

  const changeAuth = useCallback((state: FederatedAuthState) => {
    authRef.current = state;
    if (alive.current) setAuth(state);
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const fail = useCallback(() => {
    cancel();
    if (!manualSelected.current) changeAuth('failed');
  }, [cancel, changeAuth]);

  const loadCallback = useCallback((url: string, timeoutMs = ATTEMPT_TIMEOUT_MS) => {
    callbackStarted.current = false;
    pageLoadedRef.current = false;
    setPageLoaded(false);
    srcRef.current = url;
    setSrc(url);
    changeAuth('callback');
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const current = generation.current;
    timerRef.current = setTimeout(() => {
      if (generation.current !== current || !alive.current || manualSelected.current) return;
      cancel();
      // Loading a document is not proof of a session. Never report a timeout as authenticated.
      changeAuth('unconfirmed');
    }, timeoutMs);
  }, [cancel, changeAuth]);

  const begin = useCallback(async () => {
    cancel();
    manualSelected.current = false;
    const { launchEndpoint, callbackPath, canonicalUrl } = options.current;
    if (!launchEndpoint) { changeAuth('unconfirmed'); return; }
    const id = generation.current;
    const controller = new AbortController();
    requestRef.current = controller;
    changeAuth('requesting');
    timerRef.current = setTimeout(() => {
      if (id === generation.current && alive.current) fail();
    }, ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(launchEndpoint, { method: 'POST', signal: controller.signal });
      const body = await response.json();
      if (id !== generation.current || !alive.current || manualSelected.current) return;
      const url = trustedCallback(body?.launchUrl, parsedUrl(canonicalUrl)?.origin, callbackPath);
      if (!response.ok || !url || (body?.expiresIn !== undefined
        && (typeof body.expiresIn !== 'number' || !Number.isFinite(body.expiresIn) || body.expiresIn <= 0))) {
        fail();
        return;
      }
      requestRef.current = null;
      loadCallback(url, Math.min(ATTEMPT_TIMEOUT_MS, (body.expiresIn ?? 60) * 1000));
    } catch {
      // The remote error body may contain a ticket or implementation detail. Show only local copy.
      if (id === generation.current && alive.current && !manualSelected.current) fail();
    }
  }, [cancel, changeAuth, fail, loadCallback]);

  useEffect(() => {
    alive.current = true;
    const initial = initialBootstrap.current;
    if (initial) {
      const url = trustedCallback(initial, parsedUrl(options.current.canonicalUrl)?.origin, options.current.callbackPath);
      if (url) loadCallback(url); else fail();
    } else {
      void begin();
    }
    return () => { alive.current = false; cancel(); };
  }, [begin, cancel, fail, loadCallback]);

  // Compatibility with callers carrying a one-use bootstrap event. Manual mode always wins.
  useEffect(() => {
    if (props.bootstrapUrl === lastBootstrap.current) return;
    lastBootstrap.current = props.bootstrapUrl;
    if (!props.bootstrapUrl || manualSelected.current || authRef.current === 'authenticated') return;
    const url = trustedCallback(props.bootstrapUrl, parsedUrl(props.canonicalUrl)?.origin, props.callbackPath);
    if (!url) { fail(); return; }
    cancel();
    loadCallback(url);
  }, [props.bootstrapUrl, props.canonicalUrl, props.callbackPath, cancel, fail, loadCallback]);

  const chooseManual = useCallback(() => {
    const wasNavigating = authRef.current === 'callback' && !pageLoadedRef.current;
    manualSelected.current = true;
    cancel();
    changeAuth('manual');
    if (wasNavigating) {
      let current: URL | null = null;
      try { current = parsedUrl(webviewRef.current?.getURL?.()); } catch { /* guest not attached */ }
      // Do not reload a login form that is already usable; cancel only the in-flight callback.
      if (!current || current.pathname === options.current.callbackPath) {
        try { webviewRef.current?.stop?.(); } catch { /* guest may be closing */ }
        srcRef.current = options.current.canonicalUrl;
        setSrc(options.current.canonicalUrl);
      }
    }
  }, [cancel, changeAuth]);

  const observeNavigation = useCallback((raw: string | undefined) => {
    const current = parsedUrl(raw);
    const origin = parsedUrl(options.current.canonicalUrl)?.origin;
    if (!current || current.origin !== origin || manualSelected.current) return;
    if (current.pathname === options.current.callbackPath && current.searchParams.has('ticket')) {
      callbackStarted.current = true;
      return;
    }
    if (callbackStarted.current && (current.searchParams.has('err')
      || current.pathname === '/login' || current.pathname === '/login/')) {
      fail();
    }
  }, [fail]);

  const onLoaded = useCallback(() => {
    pageLoadedRef.current = true;
    setPageLoaded(true);
    if (options.current.desktopWebview) {
      try { observeNavigation(webviewRef.current?.getURL?.()); } catch { /* guest not ready */ }
    }
    // pageLoaded intentionally does not change authentication state. Only the target's
    // trusted authentication signal can confirm a session; errors or timeout offer manual login.
  }, [observeNavigation]);

  useEffect(() => {
    const guest = webviewRef.current;
    if (!props.desktopWebview || !guest) return;
    const onNavigation = (event: Event) => {
      const details = event as NavigationEvent;
      if (details.isMainFrame === false) return;
      observeNavigation(details.url);
    };
    const onFailure = (event: Event) => {
      const details = event as NavigationEvent;
      if (details.isMainFrame === false || details.errorCode === -3 || manualSelected.current) return;
      fail();
    };
    guest.addEventListener('did-finish-load', onLoaded);
    guest.addEventListener('did-start-navigation', onNavigation);
    guest.addEventListener('did-redirect-navigation', onNavigation);
    guest.addEventListener('did-navigate', onNavigation);
    guest.addEventListener('did-fail-load', onFailure);
    return () => {
      guest.removeEventListener('did-finish-load', onLoaded);
      guest.removeEventListener('did-start-navigation', onNavigation);
      guest.removeEventListener('did-redirect-navigation', onNavigation);
      guest.removeEventListener('did-navigate', onNavigation);
      guest.removeEventListener('did-fail-load', onFailure);
    };
  }, [props.desktopWebview, onLoaded, observeNavigation, fail]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const { canonicalUrl, readyMessageType, authRequiredMessageType, title, resourceKey } = options.current;
      const origin = parsedUrl(canonicalUrl)?.origin;
      if (manualSelected.current || !origin || !frameRef.current?.contentWindow
        || event.source !== frameRef.current.contentWindow || event.origin !== origin) return;
      if (readyMessageType && event.data?.type === readyMessageType) {
        let next: URL;
        try { next = new URL(typeof event.data.path === 'string' ? event.data.path : '/', origin); } catch { return; }
        if (next.origin !== origin || next.username || next.password || next.searchParams.has('ticket')) return;
        cancel();
        recoveryAttempted.current = false;
        changeAuth('authenticated');
        pageLoadedRef.current = true;
        setPageLoaded(true);
        dispatchOpenWorkspaceTab({ kind: 'external', url: next.href, title, resourceKey });
      } else if (authRequiredMessageType && event.data?.type === authRequiredMessageType
        && !recoveryAttempted.current && authRef.current === 'authenticated') {
        recoveryAttempted.current = true;
        void begin();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [begin, cancel, changeAuth]);

  const { active, desktopWebview, title, testIdPrefix } = props;
  const statusKey = auth === 'requesting' || auth === 'callback' ? 'federated.connecting'
    : auth === 'failed' ? 'federated.unavailable'
    : auth === 'manual' ? 'federated.manual'
    : 'federated.unconfirmed';
  const pending = auth === 'requesting' || auth === 'callback';
  const frameStyle = {
    position: 'absolute' as const, inset: 0, width: '100%', height: '100%', border: 'none',
    display: active ? (desktopWebview ? 'flex' : 'block') : 'none',
    visibility: 'visible' as const, pointerEvents: active ? 'auto' as const : 'none' as const,
  };
  return (
    <div className={styles.shell} data-testid={`${testIdPrefix}-frame-shell`}
      data-auth-state={auth} data-page-loaded={pageLoaded} style={{ display: active ? 'flex' : 'none' }}>
      {auth !== 'authenticated' ? (
        <div className={styles.statusBar}>
          <span role="status" aria-live="polite" className={styles.statusText}>{t(statusKey)}</span>
          {!pageLoaded && pending ? <span data-testid={`${testIdPrefix}-loading`} className={styles.loading}>{t('common.loading')}</span> : null}
          <div className={styles.actions}>
            {auth !== 'manual' ? <Button variant="ghost" onClick={chooseManual}>{t('federated.manualAction')}</Button> : null}
            {!pending ? <Button variant="ghost" onClick={() => { void begin(); }}>{t('federated.retryAction')}</Button> : null}
          </div>
        </div>
      ) : null}
      <div className={styles.browser}>
        {desktopWebview ? (
          <webview ref={(node) => { webviewRef.current = node as WebviewElement | null; }}
            src={src} title={title} partition={FEDERATED_TOOLS_PARTITION} className="external-tab-iframe"
            data-testid={`${testIdPrefix}-frame`} aria-hidden={active ? undefined : true}
            tabIndex={active ? undefined : -1} style={frameStyle} />
        ) : (
          <iframe ref={frameRef} src={src} title={title} onLoad={onLoaded}
            className="external-tab-iframe" data-testid={`${testIdPrefix}-frame`}
            aria-hidden={active ? undefined : true} tabIndex={active ? undefined : -1} style={frameStyle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" />
        )}
      </div>
    </div>
  );
}
