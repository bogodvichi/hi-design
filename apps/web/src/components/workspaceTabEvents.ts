import type { Route } from '../router';

export const OPEN_WORKSPACE_TAB_EVENT = 'open-design:workspace-tabs:open';
export const CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT = 'open-design:workspace-tabs:close-external';
export const WORKSPACE_PROJECT_COMPLETED_EVENT = 'open-design:workspace-tabs:project-completed';

export interface WorkspaceProjectCompletionDetail {
  projectId: string;
  status: 'succeeded' | 'failed';
}

export function dispatchWorkspaceProjectCompleted(detail: WorkspaceProjectCompletionDetail): void {
  window.dispatchEvent(new CustomEvent<WorkspaceProjectCompletionDetail>(
    WORKSPACE_PROJECT_COMPLETED_EVENT,
    { detail },
  ));
}

export function dispatchOpenWorkspaceTab(route: Route): void {
  window.dispatchEvent(
    new CustomEvent<{ route: Route }>(OPEN_WORKSPACE_TAB_EVENT, {
      detail: { route },
    }),
  );
}

export function dispatchCloseWorkspaceExternalTab(route: Route): void {
  window.dispatchEvent(
    new CustomEvent<{ route: Route }>(CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT, {
      detail: { route },
    }),
  );
}
