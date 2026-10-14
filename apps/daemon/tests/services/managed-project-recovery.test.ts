import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDatabase, getProject, getWorkspaceProjectByProjectId, insertProject, openDatabase,
  type SqliteDb,
} from '../../src/db.js';
import { recoverManagedProjects } from '../../src/services/managed-project-recovery.js';

const owner = { workspaceId: 'personal-workspace', workspaceMemberId: 'member-owner' };

describe('copied managed project recovery', () => {
  let root: string;
  let projectsDir: string;
  let db: SqliteDb;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-copied-projects-'));
    projectsDir = path.join(root, 'projects');
    await mkdir(projectsDir);
    db = openDatabase(root, { dataDir: root });
  });

  afterEach(async () => {
    closeDatabase();
    await rm(root, { recursive: true, force: true });
  });

  async function copiedFolder(id = randomUUID(), name = 'index.html', body = '<title>Copied design</title>') {
    const dir = path.join(projectsDir, id);
    await mkdir(dir);
    await writeFile(path.join(dir, name), body);
    return id;
  }

  it('registers copied files with a personal owner and new conversation without changing content', async () => {
    const id = await copiedFolder();
    const body = await readFile(path.join(projectsDir, id, 'index.html'), 'utf8');
    expect(await recoverManagedProjects(db, projectsDir, owner)).toEqual([id]);
    expect(getProject(db, id)).toMatchObject({
      id, name: 'Copied design', skillId: null, designSystemId: null,
      metadata: { kind: 'prototype', entryFile: 'index.html' },
    });
    expect(getWorkspaceProjectByProjectId(db, id)).toMatchObject({
      workspaceId: owner.workspaceId, createdByWorkspaceMemberId: owner.workspaceMemberId,
      visibility: 'personal', syncState: 'local_only',
    });
    expect(db.prepare('SELECT count(*) AS n FROM conversations WHERE project_id = ?').get(id)).toEqual({ n: 1 });
    expect(await readFile(path.join(projectsDir, id, 'index.html'), 'utf8')).toBe(body);
  });

  it('uses the artifact filename when there is no title and discovers later copies', async () => {
    const id = await copiedFolder(randomUUID(), '多维度分析.html', '<main>design</main>');
    expect(await recoverManagedProjects(db, projectsDir, owner)).toEqual([id]);
    expect(getProject(db, id)?.name).toBe('多维度分析');
    const later = await copiedFolder();
    expect(await recoverManagedProjects(db, projectsDir, owner)).toEqual([later]);
  });

  it('is idempotent across simultaneous reads and never changes an existing project or owner', async () => {
    const id = await copiedFolder();
    await Promise.all([recoverManagedProjects(db, projectsDir, owner), recoverManagedProjects(db, projectsDir, owner)]);
    expect(await recoverManagedProjects(db, projectsDir, { workspaceId: 'other', workspaceMemberId: 'other' })).toEqual([]);
    expect(getWorkspaceProjectByProjectId(db, id)?.workspaceId).toBe(owner.workspaceId);
    expect(db.prepare('SELECT count(*) AS n FROM conversations WHERE project_id = ?').get(id)).toEqual({ n: 1 });
    const existingId = await copiedFolder();
    insertProject(db, { id: existingId, name: 'Existing project', metadata: { kind: 'image' }, createdAt: 1, updatedAt: 2 });
    expect(await recoverManagedProjects(db, projectsDir, owner)).toEqual([]);
    expect(getProject(db, existingId)).toMatchObject({ name: 'Existing project', metadata: { kind: 'image' }, updatedAt: 2 });
    expect(getWorkspaceProjectByProjectId(db, existingId)).toBeFalsy();
  });

  it('skips empty directories, internal-only content, and symlinks', async () => {
    const empty = randomUUID();
    await mkdir(path.join(projectsDir, empty));
    const hidden = randomUUID();
    await mkdir(path.join(projectsDir, hidden));
    await writeFile(path.join(projectsDir, hidden, '.cover.png'), 'cover');
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'index.html'), '<title>Outside</title>');
    await symlink(outside, path.join(projectsDir, randomUUID()), 'dir');
    expect(await recoverManagedProjects(db, projectsDir, owner)).toEqual([]);
    expect(getProject(db, empty)).toBeNull();
    expect(getProject(db, hidden)).toBeNull();
  });

  it('tolerates an absent projects root', async () => {
    expect(await recoverManagedProjects(db, path.join(root, 'missing'), owner)).toEqual([]);
  });

  it('rolls back project and conversation rows if ownership registration fails', async () => {
    const id = await copiedFolder();
    db.exec(`CREATE TRIGGER reject_recovery BEFORE INSERT ON workspace_projects
      BEGIN SELECT RAISE(ABORT, 'ownership rejected'); END`);
    await expect(recoverManagedProjects(db, projectsDir, owner)).rejects.toThrow('ownership rejected');
    expect(getProject(db, id)).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM conversations WHERE project_id = ?').get(id)).toEqual({ n: 0 });
  });
});
