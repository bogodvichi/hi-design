import type { WorkspaceCollabContext } from '@open-design/contracts';
import { resolveProjectWorkspaceContext } from '../collab/useProjectWorkspaceScope';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { currentWorkspaceAccountGeneration, resolveBoundProjectWorkspaceContext } from '../collab/useWorkspaceContext';
import { moveWorkspaceProject } from '../state/projects';
import { randomUUID } from '../utils/uuid';
import {
  folderMoveCleanupRequest, folderMoveJournalKey, readFolderMoveJournal, saveFolderMoveJournal,
  type FolderMoveJournal, type PersonalFolderMoveFailure, type PersonalFolderMoveResult,
  type PersonalFolderMoveRoot, type PersonalFolderTreeNode,
} from './personal-folder-move-journal';
export type { PersonalFolderMoveResult, PersonalFolderMoveRoot } from './personal-folder-move-journal';

interface MoveInput {
  sourceWorkspaceId: string;
  sourceWorkspaceMemberId: string;
  roots: PersonalFolderMoveRoot[];
  action: 'to-team' | 'to-personal';
  targetWorkspaceId?: string;
  targetFolderId?: string | null;
}

const activeRoots = new Set<string>();
const encode = encodeURIComponent;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid folder response');
  return value as Record<string, unknown>;
}
function stringId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid folder or project ID');
  return value;
}
async function acknowledged(response: Response): Promise<Record<string, unknown>> {
  const body = object(await response.json());
  if (!response.ok || body.code !== 0) throw new Error(`Folder request failed (${response.status})`);
  return body;
}
async function data(response: Response): Promise<Record<string, unknown>> {
  return object((await acknowledged(response)).data);
}
async function rows(response: Response, field: string): Promise<Record<string, unknown>[]> {
  const value = (await data(response))[field];
  if (!Array.isArray(value)) throw new Error(`Missing ${field} in folder response`);
  return value.map(object);
}
function headers(input: MoveInput): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-od-workspace-member-id': input.sourceWorkspaceMemberId };
}
function writable(context: WorkspaceCollabContext | null): context is WorkspaceCollabContext {
  return Boolean(context && context.workspaceMemberId && context.memberStatus === 'active'
    && context.lifecycleState === 'active' && context.role !== 'guest' && !context.isSharedSpace);
}

async function fetchPersonalTree(input: MoveInput, root: PersonalFolderMoveRoot): Promise<PersonalFolderTreeNode[]> {
  const detail = await data(await fetch(`/api/folders/${encode(root.folderId)}?workspace_id=${encode(input.sourceWorkspaceId)}`, { cache: 'no-store', headers: headers(input) }));
  if (detail.folder_id !== root.folderId || detail.workspace_id !== input.sourceWorkspaceId) throw new Error('Source folder mismatch');
  const result: PersonalFolderTreeNode[] = [];
  const pending = [{ folderId: root.folderId, folderName: stringId(detail.folder_name), folderPid: detail.folder_pid == null ? null : stringId(detail.folder_pid) }];
  const visited = new Set<string>();
  const projectsSeen = new Set<string>();
  while (pending.length) {
    const current = pending.shift()!;
    if (visited.has(current.folderId) || visited.size >= 10_000) throw new Error('Invalid source folder tree');
    visited.add(current.folderId);
    const [projects, children] = await Promise.all([
      fetch(`/api/folders/${encode(current.folderId)}/projects?workspace_id=${encode(input.sourceWorkspaceId)}`, { cache: 'no-store', headers: headers(input) }).then((r) => rows(r, 'projects')),
      fetch(`/api/folders?workspace_id=${encode(input.sourceWorkspaceId)}&folder_pid=${encode(current.folderId)}`, { cache: 'no-store', headers: headers(input) }).then((r) => rows(r, 'folders')),
    ]);
    const projectIds = projects.map((project) => stringId(project.projectId ?? project.id));
    for (const id of projectIds) {
      if (projectsSeen.has(id)) throw new Error('Duplicate project in source tree');
      projectsSeen.add(id);
    }
    result.push({ ...current, projectIds, targetId: randomUUID() });
    for (const child of children) pending.push({
      folderId: stringId(child.folder_id ?? child.id), folderName: stringId(child.folder_name ?? child.name), folderPid: current.folderId,
    });
  }
  return result;
}

async function targetContains(journal: FolderMoveJournal, folderId: string, projectId: string): Promise<boolean> {
  const projects = await rows(await fetch(
    `/api/hdw/api/folder/project/list?workspace_id=${encode(journal.targetWorkspaceId)}&folder_id=${encode(folderId)}`,
    { cache: 'no-store' },
  ), 'projects');
  return projects.some((project) => stringId(project.project_id ?? project.projectId ?? project.id) === projectId);
}

async function confirmTargetAssignment(
  journal: FolderMoveJournal, node: PersonalFolderTreeNode, projectId: string,
  context: WorkspaceCollabContext, beforeWrite: () => void,
): Promise<void> {
  if (await targetContains(journal, node.targetId, projectId)) return;
  // Never override a later user move after this project was confirmed complete.
  if (journal.completedProjectIds.includes(projectId)) throw new Error('Completed project changed location');
  const response = await fetch(`/api/projects/${encode(projectId)}`, {
    cache: 'no-store', headers: workspaceProjectHeaders(context),
  });
  if (!response.ok) throw new Error('Could not verify pending folder assignment');
  const detail = object(await response.json());
  const project = object(detail.project);
  if (project.id !== projectId || project.workspaceId !== journal.targetWorkspaceId || detail.folderId !== node.targetId) {
    throw new Error('Project no longer belongs to the pending destination');
  }
  // The transfer committed locally but its best-effort upstream folder sync
  // did not. Repair only that assignment, not ownership or project content.
  beforeWrite();
  await acknowledged(await fetch('/api/hdw/api/folder/project/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder_id: node.targetId, project_id: projectId,
      workspace_id: journal.targetWorkspaceId, operator_member_id: context.workspaceMemberId,
    }),
  }));
  if (!await targetContains(journal, node.targetId, projectId)) throw new Error('Folder assignment not confirmed');
}

async function ensureTargetTree(journal: FolderMoveJournal, beforeWrite: () => void): Promise<void> {
  const targets = new Map(journal.tree.map((node) => [node.folderId, node.targetId]));
  for (const node of journal.tree) {
    const parentId = node.folderId === journal.rootId ? journal.targetParentId : targets.get(node.folderPid ?? '');
    if (parentId === undefined) throw new Error('Missing target parent');
    const folders = await rows(await fetch(
      `/api/hdw/api/folder/list?workspace_id=${encode(journal.targetWorkspaceId)}${parentId ? `&folder_pid=${encode(parentId)}` : ''}`,
      { cache: 'no-store' },
    ), 'folders');
    if (folders.some((folder) => stringId(folder.folder_id ?? folder.id) === node.targetId)) continue;
    // The IDs were saved before any create. Lost responses reuse those exact
    // IDs after an authoritative read, never create another randomly named tree.
    beforeWrite();
    await acknowledged(await fetch('/api/hdw/api/folder/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: journal.targetWorkspaceId, folders: [{ folder_id: node.targetId, folder_pid: parentId, folder_name: node.folderName }] }),
    }));
  }
}

function failure(root: PersonalFolderMoveRoot, journal: FolderMoveJournal | null, code?: PersonalFolderMoveFailure['code']): PersonalFolderMoveFailure {
  return {
    ...root, code: code ?? (journal ? 'interrupted' : 'failed'),
    completedProjectIds: [...(journal?.completedProjectIds ?? [])],
    ...(journal ? {
      targetWorkspaceId: journal.targetWorkspaceId, targetWorkspaceName: journal.targetWorkspaceName,
      targetParentId: journal.targetParentId, targetRootId: journal.tree[0]?.targetId,
    } : {}),
  };
}

/** A root succeeds only after all contents and conditional source cleanup
 * succeed. Each failed root retains a durable, identity-scoped recovery plan.
 * Retrying reconciles real locations, rather than replaying acknowledged moves. */
export async function movePersonalFolderRoots(input: MoveInput): Promise<PersonalFolderMoveResult> {
  const result: PersonalFolderMoveResult = { succeededFolderIds: [], failures: [] };
  const generation = currentWorkspaceAccountGeneration();
  const assertIdentity = () => {
    if (currentWorkspaceAccountGeneration() !== generation) throw new Error('Account changed during folder move');
  };
  for (const root of input.roots) {
    const key = folderMoveJournalKey(input.sourceWorkspaceId, input.sourceWorkspaceMemberId, root.folderId);
    if (activeRoots.has(key)) { result.failures.push(failure(root, null, 'busy')); continue; }
    activeRoots.add(key);
    const execute = async () => {
      let journal: FolderMoveJournal | null = null;
      try {
        journal = readFolderMoveJournal(key);
        if (journal && (input.action !== 'to-team' || journal.targetWorkspaceId !== input.targetWorkspaceId || journal.targetParentId !== (input.targetFolderId ?? null))) {
          result.failures.push(failure(root, journal, 'destination-locked')); return;
        }
        if (!input.targetWorkspaceId || !input.sourceWorkspaceMemberId) throw new Error('Missing move identity');
        const source = await resolveBoundProjectWorkspaceContext(input.sourceWorkspaceId, { fresh: true });
        if (!writable(source) || source.workspaceId !== input.sourceWorkspaceId || source.workspaceMemberId !== input.sourceWorkspaceMemberId || !source.isDefaultTeam) throw new Error('Source membership unavailable');
        assertIdentity();
        if (input.action === 'to-personal') {
          if (input.targetWorkspaceId !== input.sourceWorkspaceId) throw new Error('Invalid personal destination');
          await data(await fetch(`/api/folders/${encode(root.folderId)}?workspace_id=${encode(input.sourceWorkspaceId)}`, {
            method: 'PATCH', headers: headers(input), body: JSON.stringify({ folder_pid: input.targetFolderId ?? null }),
          }));
          result.succeededFolderIds.push(root.folderId); return;
        }
        const target = await resolveBoundProjectWorkspaceContext(input.targetWorkspaceId, { fresh: true });
        if (!writable(target) || target.workspaceId !== input.targetWorkspaceId || target.isDefaultTeam || target.workspaceId === source.workspaceId) throw new Error('Target membership unavailable');
        if (journal && journal.targetWorkspaceMemberId !== target.workspaceMemberId) throw new Error('Target membership changed');
        if (!journal) {
          const tree = await fetchPersonalTree(input, root);
          const created: FolderMoveJournal = {
            version: 1, sourceWorkspaceId: input.sourceWorkspaceId, sourceWorkspaceMemberId: input.sourceWorkspaceMemberId,
            rootId: root.folderId, targetWorkspaceId: target.workspaceId, targetWorkspaceMemberId: target.workspaceMemberId,
            targetWorkspaceName: target.workspaceName || target.workspaceId, targetParentId: input.targetFolderId ?? null,
            tree, completedProjectIds: [], cleanupStarted: false,
          };
          assertIdentity();
          saveFolderMoveJournal(key, created);
          journal = created;
        }
        const plan = journal;
        const beforeWrite = () => { assertIdentity(); saveFolderMoveJournal(key, plan); };
        await ensureTargetTree(plan, beforeWrite);
        for (const node of plan.tree) {
          for (const projectId of node.projectIds) {
            const context = await resolveProjectWorkspaceContext(projectId);
            assertIdentity();
            if (context?.workspaceId === plan.targetWorkspaceId && context.workspaceMemberId === plan.targetWorkspaceMemberId) {
              await confirmTargetAssignment(plan, node, projectId, context, beforeWrite);
            } else {
              if (plan.completedProjectIds.includes(projectId)) throw new Error('A completed project changed location');
              if (context?.workspaceId !== source.workspaceId || context.workspaceMemberId !== source.workspaceMemberId) throw new Error('Project source authority changed');
              const remaining = await rows(await fetch(`/api/folders/${encode(node.folderId)}/projects?workspace_id=${encode(source.workspaceId)}`, { cache: 'no-store', headers: headers(input) }), 'projects');
              if (!remaining.some((project) => stringId(project.projectId ?? project.id) === projectId)) throw new Error('Project source folder changed');
              beforeWrite();
              await moveWorkspaceProject({ projectId, visibility: 'team', workspaceContext: context, targetWorkspaceId: target.workspaceId, targetFolderId: node.targetId });
              // HTTP success alone is not completion: require both the persisted
              // workspace binding and the upstream folder association to agree.
              const movedContext = await resolveProjectWorkspaceContext(projectId);
              if (movedContext?.workspaceId !== target.workspaceId || movedContext.workspaceMemberId !== target.workspaceMemberId) throw new Error('Project destination not confirmed');
              await confirmTargetAssignment(plan, node, projectId, movedContext, beforeWrite);
            }
            if (!plan.completedProjectIds.includes(projectId)) plan.completedProjectIds.push(projectId);
            beforeWrite();
          }
        }
        plan.cleanupStarted = true;
        beforeWrite();
        // Dedicated conditional endpoint: older daemons fail closed (404)
        // instead of silently ignoring an empty-tree precondition on DELETE.
        await data(await fetch(`/api/folders/${encode(root.folderId)}/move-cleanup`, {
          method: 'POST', headers: headers(input), body: JSON.stringify(folderMoveCleanupRequest(plan)),
        }));
        result.succeededFolderIds.push(root.folderId);
        // Cleanup is idempotent. A storage-remove failure must not turn a
        // successfully completed move into a false failure.
        try { localStorage.removeItem(key); } catch { /* next retry re-verifies */ }
      } catch {
        result.failures.push(failure(root, journal));
      }
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
          if (lock) await execute();
          else result.failures.push(failure(root, null, 'busy'));
        });
      } else await execute();
    } catch {
      result.failures.push(failure(root, null));
    } finally {
      activeRoots.delete(key);
    }
  }
  return result;
}
