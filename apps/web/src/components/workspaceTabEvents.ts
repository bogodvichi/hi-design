import type { Route } from '../router';

export const OPEN_WORKSPACE_TAB_EVENT = 'open-design:workspace-tabs:open';
export const CLOSE_WORKSPACE_EXTERNAL_TAB_EVENT = 'open-design:workspace-tabs:close-external';

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
