import { isOpenDesignHostAvailable } from '@open-design/host';
import { useEffect, useState } from 'react';
import { buildPath, navigate, type Route } from '../router';
import { FederatedBrowserSession } from './FederatedBrowserSession';
import {
  CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT,
  OPEN_WORKSPACE_TAB_EVENT,
} from './workspaceTabEvents';

interface FederatedFrameState {
  canonicalUrl: string;
  bootstrapUrl?: string;
  title: string;
}

interface FederatedWorkspaceFrameProps {
  route: Route;
  resourceKey: string;
  testIdPrefix: string;
  launchEndpoint?: string;
  callbackPath?: string;
  readyMessageType?: string;
  authRequiredMessageType?: string;
  useDesktopWebview?: boolean;
}

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
  callbackPath,
  readyMessageType,
  authRequiredMessageType,
  useDesktopWebview = false,
}: FederatedWorkspaceFrameProps) {
  const desktopWebview = useDesktopWebview && isOpenDesignHostAvailable();
  const [frame, setFrame] = useState<FederatedFrameState | null>(() =>
    isResourceRoute(route, resourceKey)
      ? {
          canonicalUrl: route.url,
          bootstrapUrl: route.bootstrapUrl,
          title: route.title,
        }
      : null,
  );

  useEffect(() => {
    if (!isResourceRoute(route, resourceKey)) return;
    if (window.location.pathname !== buildPath(route)) {
      navigate(route, { replace: true });
    }
    setFrame((current) => current ?? {
      canonicalUrl: route.url,
      bootstrapUrl: route.bootstrapUrl,
      title: route.title,
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
              ? { bootstrapUrl: nextRoute.bootstrapUrl }
              : {}),
            title: nextRoute.title,
          }
        : {
            canonicalUrl: nextRoute.url,
            bootstrapUrl: nextRoute.bootstrapUrl,
            title: nextRoute.title,
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

  if (!frame) return null;
  return (
    <FederatedBrowserSession
      key={urlOrigin(frame.canonicalUrl) ?? resourceKey}
      {...frame}
      resourceKey={resourceKey}
      testIdPrefix={testIdPrefix}
      launchEndpoint={launchEndpoint}
      callbackPath={callbackPath}
      readyMessageType={readyMessageType}
      authRequiredMessageType={authRequiredMessageType}
      desktopWebview={desktopWebview}
      active={isResourceRoute(route, resourceKey)}
    />
  );
}
