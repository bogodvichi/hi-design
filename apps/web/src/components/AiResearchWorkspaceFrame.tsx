import type { Route } from '../router';
import { FederatedWorkspaceFrame } from './FederatedWorkspaceFrame';

export const AI_RESEARCH_RESOURCE_KEY = 'ai-research-workbench';

export function AiResearchWorkspaceFrame({ route }: { route: Route }) {
  return (
    <FederatedWorkspaceFrame
      route={route}
      resourceKey={AI_RESEARCH_RESOURCE_KEY}
      testIdPrefix="ai-research-workspace"
      launchEndpoint="/api/auth/ai-research/launch"
      callbackPath="/api/auth/platform"
      useDesktopWebview
    />
  );
}
