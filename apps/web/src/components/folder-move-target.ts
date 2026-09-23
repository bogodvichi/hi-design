export interface FolderMovePath {
  id: string;
  /** Actual ancestors, from the workspace root to the immediate parent. */
  ancestorIds: readonly string[];
}

/**
 * A folder cannot move into itself or any descendant in its source workspace.
 * Ordinary disabled locations (such as the current parent) do not exclude their
 * children. Tree rows, search hits and confirmation all use this predicate.
 */
export function isFolderMoveTargetDisabled(
  workspaceId: string,
  folder: FolderMovePath | null,
  disabledKeys?: ReadonlySet<string>,
  disabledSubtreeKeys?: ReadonlySet<string>,
): boolean {
  if (disabledKeys?.has(`${workspaceId}:${folder?.id ?? 'root'}`)) return true;
  if (!folder || !disabledSubtreeKeys?.size) return false;
  return [folder.id, ...folder.ancestorIds].some((id) => (
    disabledSubtreeKeys.has(`${workspaceId}:${id}`)
  ));
}
