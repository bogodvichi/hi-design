import type { Route } from '../router';
import { FederatedWorkspaceFrame } from './FederatedWorkspaceFrame';

export function HiMindWorkspaceFrame({ route }: { route: Route }) {
  return (
    <FederatedWorkspaceFrame
      route={route}
      resourceKey="himind"
      testIdPrefix="himind-workspace"
      launchEndpoint="/api/auth/himind/launch"
      readyMessageType="himind:sso-ready"
      authRequiredMessageType="himind:auth-required"
    />
  );
}
