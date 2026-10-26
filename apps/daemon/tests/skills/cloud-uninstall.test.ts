import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  materializeWorkspaceScopedTeamResource,
  readTeamResourceMaterialization,
} from '../../src/collab/team-resource-materialization.js';
import { createTeamResourceVersionStore } from '../../src/collab/team-resource-version-store.js';
import {
  closeDatabase,
  ensureWorkspaceResource,
  getWorkspaceResource,
  openDatabase,
} from '../../src/db.js';
import { workspaceTeamSkillBindingResourceId } from '../../src/skills/workspace-team-binding.js';
import { uninstallCloudSkillFromWorkspace } from '../../src/skills/cloud-uninstall.js';

let dir: string;
let userSkillsDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'od-cloud-skill-uninstall-'));
  userSkillsDir = path.join(dir, 'skills');
  mkdirSync(userSkillsDir, { recursive: true });
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

async function materialize(input: {
  workspaceId: string;
  localId: string;
  resourceId: string;
  content: string;
}) {
  await materializeWorkspaceScopedTeamResource({
    kindRoot: userSkillsDir,
    identity: {
      kind: 'skill',
      workspaceId: input.workspaceId,
      resourceId: input.localId,
      hubResourceId: input.resourceId,
    },
    pullInto: async (stagedDir) => {
    await import('node:fs/promises').then(({ writeFile }) => writeFile(
        path.join(stagedDir, 'SKILL.md'),
        input.content,
      ));
    },
    verifyWorkspaceScope: async () => true,
    verifyStillShared: async () => true,
    storageName: input.localId.replace(/^user:/, ''),
  });
}

describe('cloud Skill permanent-delete local cleanup', () => {
  it('removes only the exact current-workspace installation', async () => {
    const db = openDatabase(dir, { dataDir: dir });
    const versions = createTeamResourceVersionStore(dir);
    await versions.set('workspace-a', 'skill', 'shared-skill', 'version-a');
    await versions.set('workspace-b', 'skill', 'shared-skill', 'version-b');
    await materialize({
      workspaceId: 'workspace-a', localId: 'shared-skill', resourceId: 'cloud-resource', content: 'workspace-a',
    });
    await materialize({
      workspaceId: 'workspace-b', localId: 'shared-skill', resourceId: 'cloud-resource-other', content: 'workspace-b',
    });
    ensureWorkspaceResource(db, 'skill', 'workspace-a', workspaceTeamSkillBindingResourceId('workspace-a', 'shared-skill'), {
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: 'alice',
      resourceHubResourceId: 'cloud-resource',
    });
    ensureWorkspaceResource(db, 'skill', 'workspace-b', workspaceTeamSkillBindingResourceId('workspace-b', 'shared-skill'), {
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: 'alice',
      resourceHubResourceId: 'cloud-resource-other',
    });

    await expect(uninstallCloudSkillFromWorkspace({
      db,
      userSkillsDir,
      workspaceId: 'workspace-a',
      resourceId: 'cloud-resource',
      deleteVersion: versions.delete,
    })).resolves.toEqual({ localId: 'shared-skill' });

    await expect(readTeamResourceMaterialization(userSkillsDir, 'workspace-a', 'shared-skill')).resolves.toBeNull();
    await expect(readTeamResourceMaterialization(userSkillsDir, 'workspace-b', 'shared-skill')).resolves.toMatchObject({
      hubResourceId: 'cloud-resource-other',
    });
    expect(getWorkspaceResource(db, 'skill', 'workspace-a', workspaceTeamSkillBindingResourceId('workspace-a', 'shared-skill'))).toBeUndefined();
    expect(versions.get('workspace-a', 'skill', 'shared-skill')).toBeNull();
    expect(versions.get('workspace-b', 'skill', 'shared-skill')).toBe('version-b');
  });

  it('preserves the author personal source while removing the installed copy', async () => {
    const db = openDatabase(dir, { dataDir: dir });
    const versions = createTeamResourceVersionStore(dir);
    const personalDir = path.join(userSkillsDir, 'shared-skill');
    mkdirSync(personalDir, { recursive: true });
    writeFileSync(path.join(personalDir, 'SKILL.md'), 'personal source');
    ensureWorkspaceResource(db, 'skill', 'workspace-a', 'shared-skill', {
      visibility: 'personal',
      resourceState: 'active',
      createdByWorkspaceMemberId: 'alice',
      resourceHubResourceId: 'personal-resource',
    });
    await materialize({
      workspaceId: 'workspace-a', localId: 'shared-skill', resourceId: 'cloud-resource', content: 'installed copy',
    });
    ensureWorkspaceResource(db, 'skill', 'workspace-a', workspaceTeamSkillBindingResourceId('workspace-a', 'shared-skill'), {
      visibility: 'team',
      resourceState: 'active',
      createdByWorkspaceMemberId: 'alice',
      resourceHubResourceId: 'cloud-resource',
    });

    await uninstallCloudSkillFromWorkspace({
      db,
      userSkillsDir,
      workspaceId: 'workspace-a',
      resourceId: 'cloud-resource',
      deleteVersion: versions.delete,
    });

    expect(existsSync(path.join(personalDir, 'SKILL.md'))).toBe(true);
    expect(getWorkspaceResource(db, 'skill', 'workspace-a', 'shared-skill')).toMatchObject({
      visibility: 'personal',
    });
    expect(getWorkspaceResource(db, 'skill', 'workspace-a', workspaceTeamSkillBindingResourceId('workspace-a', 'shared-skill'))).toBeUndefined();
  });
});
