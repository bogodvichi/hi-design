import { isOpenDesignHostAvailable } from '@open-design/host';
import { useEffect, useRef, useState } from 'react';
import { buildPath, navigate, type Route } from '../router';
import { CenteredLoader } from './Loading';
import {
  CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT,
  dispatchOpenWorkspaceTab,
  OPEN_WORKSPACE_TAB_EVENT,
} from './workspaceTabEvents';

interface FederatedFrameState {
  canonicalUrl: string;
  src: string;
  title: string;
  ready: boolean;
}

interface FederatedWorkspaceFrameProps {
  route: Route;
  resourceKey: string;
  testIdPrefix: string;
  launchEndpoint?: string;
  readyMessageType?: string;
  authRequiredMessageType?: string;
  useDesktopWebview?: boolean;
}

type WebviewElement = HTMLElement & {
  getURL?(): string;
};

const FEDERATED_TOOLS_PARTITION = 'persist:hi-design-team-federated-tools';

function isResourceRoute(
  route: Route | undefined,
  resourceKey: string,
): route is Extract<Route, { kind: 'external' }> {
  return route?.kind === 'external' && route.resourceKey === resourceKey;
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Keeps one federated external tool's browsing context mounted across tab changes. */
export function FederatedWorkspaceFrame({
  route,
  resourceKey,
  testIdPrefix,
  launchEndpoint,
  readyMessageType,
  authRequiredMessageType,
  useDesktopWebview = false,
}: FederatedWorkspaceFrameProps) {
  const desktopWebview = useDesktopWebview && isOpenDesignHostAvailable();
  const [frame, setFrame] = useState<FederatedFrameState | null>(() =>
    isResourceRoute(route, resourceKey)
      ? {
          canonicalUrl: route.url,
          src: route.bootstrapUrl ?? route.url,
          title: route.title,
          ready: false,
        }
      : null,
  );
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameStateRef = useRef(frame);
  const reauthInFlightRef = useRef(false);
  const webviewRef = useRef<WebviewElement | null>(null);
  frameStateRef.current = frame;

  useEffect(() => {
    if (!isResourceRoute(route, resourceKey)) return;
    if (window.location.pathname !== buildPath(route)) {
      navigate(route, { replace: true });
    }
    setFrame((current) => current ?? {
      canonicalUrl: route.url,
      src: route.bootstrapUrl ?? route.url,
      title: route.title,
      ready: false,
    });
  }, [resourceKey, route]);

  useEffect(() => {
    function onOpen(event: Event) {
      const nextRoute = (event as CustomEvent<{ route?: Route }>).detail?.route;
      if (!isResourceRoute(nextRoute, resourceKey)) return;
      setFrame((current) => current
        ? {
            ...current,
            canonicalUrl: nextRoute.url,
            ...(nextRoute.bootstrapUrl
              ? { src: nextRoute.bootstrapUrl, ready: false }
              : {}),
            title: nextRoute.title,
          }
        : {
            canonicalUrl: nextRoute.url,
            src: nextRoute.bootstrapUrl ?? nextRoute.url,
            title: nextRoute.title,
            ready: false,
          });
    }

    function onClose(event: Event) {
      const closedRoute = (event as CustomEvent<{ route?: Route }>).detail?.route;
      if (!isResourceRoute(closedRoute, resourceKey)) return;
      setFrame(null);
    }

    window.addEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpen);
    window.addEventListener(CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT, onClose);
    return () => {
      window.removeEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpen);
      window.removeEventListener(CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT, onClose);
    };
  }, [resourceKey]);

  useEffect(() => {
    if (!readyMessageType && !authRequiredMessageType) return;

    async function onMessage(event: MessageEvent) {
      const current = frameStateRef.current;
      const contentWindow = frameRef.current?.contentWindow;
      const expectedOrigin = current ? urlOrigin(current.canonicalUrl) : null;
      if (!current || !contentWindow || event.source !== contentWindow || event.origin !== expectedOrigin) {
        return;
      }
      if (readyMessageType && event.data?.type === readyMessageType) {
        const path = typeof event.data.path === 'string' ? event.data.path : '';
        let canonicalUrl: string;
        try {
          const candidate = new URL(path || '/', expectedOrigin);
          if (candidate.origin !== expectedOrigin) return;
          canonicalUrl = candidate.href;
        } catch {
          return;
        }
        setFrame((value) => value ? { ...value, canonicalUrl, ready: true } : value);
        dispatchOpenWorkspaceTab({
          kind: 'external',
          url: canonicalUrl,
          resourceKey,
          title: current.title,
        });
        return;
      }
      if (
        !authRequiredMessageType
        || event.data?.type !== authRequiredMessageType
        || !launchEndpoint
        || reauthInFlightRef.current
      ) return;
      reauthInFlightRef.current = true;
      setFrame((value) => value ? { ...value, ready: false } : value);
      try {
        const response = await fetch(launchEndpoint, { method: 'POST' });
        const body = await response.json().catch(() => null);
        if (!response.ok || typeof body?.launchUrl !== 'string') return;
        if (urlOrigin(body.launchUrl) !== expectedOrigin) return;
        setFrame((value) => value ? { ...value, src: body.launchUrl } : value);
      } finally {
        reauthInFlightRef.current = false;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [authRequiredMessageType, launchEndpoint, readyMessageType, resourceKey]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!desktopWebview || !webview) return;
    const onReady = () => {
      setFrame((value) => value ? { ...value, ready: true } : value);
    };
    webview.addEventListener('did-finish-load', onReady);
    return () => webview.removeEventListener('did-finish-load', onReady);
  }, [desktopWebview, frame?.src]);

  if (!frame) return null;
  const active = isResourceRoute(route, resourceKey);
  return (
    <div
      data-testid={`${testIdPrefix}-frame-shell`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: active ? 'block' : 'none',
      }}
    >
      {!frame.ready ? (
        <div
          data-testid={`${testIdPrefix}-loading`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <CenteredLoader />
        </div>
      ) : null}
      {desktopWebview ? (
        <webview
          ref={(node) => { webviewRef.current = node as WebviewElement | null; }}
          src={frame.src}
          title={frame.title}
          partition={FEDERATED_TOOLS_PARTITION}
          className="external-tab-iframe"
          data-testid={`${testIdPrefix}-frame`}
          aria-hidden={active && frame.ready ? undefined : true}
          tabIndex={active && frame.ready ? undefined : -1}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: active ? 'flex' : 'none',
            visibility: frame.ready ? 'visible' : 'hidden',
            pointerEvents: frame.ready ? 'auto' : 'none',
          }}
        />
      ) : (
        <iframe
          ref={frameRef}
          src={frame.src}
          title={frame.title}
          onLoad={() => setFrame((value) => value ? { ...value, ready: true } : value)}
          className="external-tab-iframe"
          data-testid={`${testIdPrefix}-frame`}
          aria-hidden={active && frame.ready ? undefined : true}
          tabIndex={active && frame.ready ? undefined : -1}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: active ? 'block' : 'none',
            visibility: frame.ready ? 'visible' : 'hidden',
            pointerEvents: frame.ready ? 'auto' : 'none',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      )}
    </div>
  );
}
