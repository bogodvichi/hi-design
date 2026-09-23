import type { FolderMoveCleanupRequest } from '@open-design/contracts';

export interface PersonalFolderMoveRoot {
  folderId: string;
  folderName: string;
}

export interface PersonalFolderTreeNode extends PersonalFolderMoveRoot {
  folderPid: string | null;
  projectIds: string[];
  targetId: string;
}

/** Local recovery metadata only; never project content, tokens, or authority. */
export interface FolderMoveJournal {
  version: 1;
  sourceWorkspaceId: string;
  sourceWorkspaceMemberId: string;
  rootId: string;
  targetWorkspaceId: string;
  targetWorkspaceMemberId: string;
  targetParentId: string | null;
  targetWorkspaceName: string;
  tree: PersonalFolderTreeNode[];
  completedProjectIds: string[];
  cleanupStarted: boolean;
}

export interface PersonalFolderMoveFailure extends PersonalFolderMoveRoot {
  code: 'failed' | 'interrupted' | 'destination-locked' | 'busy';
  completedProjectIds: string[];
  targetWorkspaceId?: string;
  targetWorkspaceName?: string;
  targetParentId?: string | null;
  targetRootId?: string;
}

export interface PersonalFolderMoveResult {
  succeededFolderIds: string[];
  failures: PersonalFolderMoveFailure[];
}

export function folderMoveJournalKey(workspaceId: string, memberId: string, rootId: string): string {
  return `od:personal-folder-move:v1:${JSON.stringify([workspaceId, memberId, rootId])}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate persisted metadata before using any ID as a mutation target. */
export function readFolderMoveJournal(key: string): FolderMoveJournal | null {
  const text = localStorage.getItem(key);
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1
    || !['sourceWorkspaceId', 'sourceWorkspaceMemberId', 'rootId', 'targetWorkspaceId', 'targetWorkspaceMemberId', 'targetWorkspaceName']
      .every((field) => typeof value[field] === 'string' && value[field] !== '')
    || !(value.targetParentId === null || typeof value.targetParentId === 'string')
    || typeof value.cleanupStarted !== 'boolean'
    || !Array.isArray(value.tree) || value.tree.length === 0 || value.tree.length > 10_000
    || !Array.isArray(value.completedProjectIds)
    || !value.completedProjectIds.every((id) => typeof id === 'string')) {
    throw new Error('Invalid folder migration recovery record');
  }
  const folderIds = new Set<string>();
  const targetIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const [index, node] of value.tree.entries()) {
    if (!isRecord(node) || typeof node.folderId !== 'string' || !node.folderId
      || typeof node.folderName !== 'string' || typeof node.targetId !== 'string' || !node.targetId
      || !(node.folderPid === null || typeof node.folderPid === 'string')
      || !Array.isArray(node.projectIds) || !node.projectIds.every((id) => typeof id === 'string' && id)
      || folderIds.has(node.folderId) || targetIds.has(node.targetId)
      || (index === 0 ? node.folderId !== value.rootId : !folderIds.has(node.folderPid as string))) {
      throw new Error('Invalid folder migration tree');
    }
    folderIds.add(node.folderId); targetIds.add(node.targetId);
    for (const id of node.projectIds as string[]) {
      if (projectIds.has(id)) throw new Error('Duplicate project in recovery record');
      projectIds.add(id);
    }
  }
  if (!value.completedProjectIds.every((id) => projectIds.has(id as string))) {
    throw new Error('Invalid folder migration progress');
  }
  const journal = value as unknown as FolderMoveJournal;
  if (folderMoveJournalKey(journal.sourceWorkspaceId, journal.sourceWorkspaceMemberId, journal.rootId) !== key) {
    throw new Error('Folder migration identity mismatch');
  }
  return journal;
}

export function saveFolderMoveJournal(key: string, journal: FolderMoveJournal): void {
  // Fail before the next write when storage is unavailable. A prior durable
  // snapshot is enough to reconcile an ambiguous response on the next attempt.
  localStorage.setItem(key, JSON.stringify(journal));
}

export function folderMoveCleanupRequest(journal: FolderMoveJournal): FolderMoveCleanupRequest {
  return {
    workspaceId: journal.sourceWorkspaceId,
    expectedEmptyTree: journal.tree.map(({ folderId, folderPid, folderName }) => ({ folderId, folderPid, folderName })),
  };
}
