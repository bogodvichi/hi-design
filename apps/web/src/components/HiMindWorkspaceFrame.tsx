import { useCallback } from 'react';
import { useAuth } from '../auth/LoginGate';
import type { Route } from '../router';
import { FederatedWorkspaceFrame } from './FederatedWorkspaceFrame';
import { handleHiMindDirectoryMessage } from './himind-directory-bridge';

export function HiMindWorkspaceFrame({ route }: { route: Route }) {
  const { username } = useAuth();
  const onTrustedMessage = useCallback((event: MessageEvent, signal: AbortSignal) => {
    void handleHiMindDirectoryMessage(event, username, signal);
  }, [username]);
  return (
    <FederatedWorkspaceFrame
      key={username ?? 'signed-out'}
      route={route}
      resourceKey="himind"
      testIdPrefix="himind-workspace"
      launchEndpoint="/api/auth/himind/launch"
      bindParentOrigin
      callbackPath="/api/v1/auth/hidesign/callback"
      readyMessageType="himind:sso-ready"
      authRequiredMessageType="himind:auth-required"
      onTrustedMessage={onTrustedMessage}
    />
  );
}
