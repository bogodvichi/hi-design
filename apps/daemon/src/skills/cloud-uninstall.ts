import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import type Database from 'better-sqlite3';

import {
  deleteWorkspaceResource,
  listWorkspaceResources,
} from '../db.js';
import {
  readTeamResourceMaterialization,
  teamResourceMaterializationDir,
  teamResourceWorkspaceRoot,
} from '../collab/team-resource-materialization.js';
import {
  skillIdFromWorkspaceTeamBinding,
  workspaceTeamSkillBindingResourceId,
} from './workspace-team-binding.js';

type SqliteDb = Database.Database;

export interface CloudSkillUninstallInput {
  db: SqliteDb;
  userSkillsDir: string;
  workspaceId: string;
  resourceId: string;
  deleteVersion: (
    workspaceId: string,
    kind: 'skill',
    resourceId: string,
  ) => Promise<void>;
}

function materializationStorageName(localId: string): string | null {
  const prefix = localId.startsWith('user:') ? 'user:' : '';
  const dirId = prefix ? localId.slice(prefix.length) : localId;
  if (
    !dirId
    || dirId === '.'
    || dirId === '..'
    || !/^[a-zA-Z0-9_-]+$/.test(dirId)
  ) {
    return null;
  }
  return dirId;
}

/**
 * Remove only the current Workspace's installed copy of a cloud Skill. A
 * same-slug personal source or another Workspace's materialization is never
 * sufficient evidence for deletion.
 */
export async function uninstallCloudSkillFromWorkspace(
  input: CloudSkillUninstallInput,
): Promise<{ localId: string | null }> {
  const { db, userSkillsDir, workspaceId, resourceId } = input;
  const binding = listWorkspaceResources(db, 'skill', workspaceId).find((item) => (
    item.visibility === 'team'
    && item.resourceHubResourceId === resourceId
  ));

  const candidates = new Set<string>();
  const bindingLocalId = binding?.resourceId
    ? skillIdFromWorkspaceTeamBinding(workspaceId, binding.resourceId)
    : null;
  if (bindingLocalId) candidates.add(bindingLocalId);

  const workspaceRoot = teamResourceWorkspaceRoot(userSkillsDir, workspaceId);
  let entries: Dirent[] = [];
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const candidate of [entry.name, `user:${entry.name}`]) {
      const marker = await readTeamResourceMaterialization(
        userSkillsDir,
        workspaceId,
        candidate,
        entry.name,
      );
      if (marker?.kind === 'skill' && marker.hubResourceId === resourceId) {
        candidates.add(marker.resourceId);
      }
    }
  }

  let removedLocalId: string | null = null;
  for (const localId of candidates) {
    const dirId = materializationStorageName(localId);
    if (!dirId) throw new Error('invalid local id');
    const targetDir = teamResourceMaterializationDir(
      userSkillsDir,
      workspaceId,
      localId,
      dirId,
    );
    const marker = await readTeamResourceMaterialization(
      userSkillsDir,
      workspaceId,
      localId,
      dirId,
    );
    if (marker && marker.hubResourceId !== resourceId) {
      throw new Error('materialization identity mismatch');
    }

    await rm(targetDir, { recursive: true, force: true });
    if (bindingLocalId === localId) {
      deleteWorkspaceResource(
        db,
        'skill',
        workspaceId,
        workspaceTeamSkillBindingResourceId(workspaceId, localId),
      );
    }
    await input.deleteVersion(workspaceId, 'skill', localId);
    removedLocalId ??= localId;
  }

  return { localId: removedLocalId };
}
