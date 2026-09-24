import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteWorkspaceFolderPreservingContents,
  repairOrphanedWorkspaceProjectFolders,
} from '../src/db.js';

let db: Database.Database | null = null;

function createDb() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE folders (
      folder_id TEXT PRIMARY KEY,
      folder_pid TEXT,
      workspace_id TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      owner_member_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(folder_pid) REFERENCES folders(folder_id) ON DELETE CASCADE
    );
    CREATE TABLE workspace_projects (
      project_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_by_workspace_member_id TEXT,
      folder_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function folder(
  database: Database.Database,
  id: string,
  parentId: string | null,
  name = id,
) {
  database.prepare(
    `INSERT INTO folders
      (folder_id, folder_pid, workspace_id, folder_name, owner_member_id, created_at)
     VALUES (?, ?, 'personal', ?, 'me', '2026-01-01T00:00:00.000Z')`,
  ).run(id, parentId, name);
}

function project(database: Database.Database, id: string, folderId: string | null) {
  database.prepare(
    `INSERT INTO workspace_projects
      (project_id, workspace_id, created_by_workspace_member_id, folder_id, updated_at)
     VALUES (?, 'personal', 'me', ?, 1)`,
  ).run(id, folderId);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('personal folder delete preserving contents', () => {
  it('promotes direct projects and direct subfolders to the deleted folder parent', () => {
    const database = createDb();
    folder(database, 'parent', null);
    folder(database, 'target', 'parent');
    folder(database, 'child', 'target');
    folder(database, 'grandchild', 'child');
    project(database, 'direct-project', 'target');
    project(database, 'nested-project', 'child');

    const result = deleteWorkspaceFolderPreservingContents(database, 'personal', 'target');

    expect(result).toMatchObject({
      parentFolderId: 'parent',
      movedProjectCount: 1,
      movedSubfolderCount: 1,
    });
    expect(database.prepare(`SELECT 1 FROM folders WHERE folder_id = 'target'`).get()).toBeUndefined();
    expect(database.prepare(`SELECT folder_pid AS folderPid FROM folders WHERE folder_id = 'child'`).get())
      .toEqual({ folderPid: 'parent' });
    expect(database.prepare(`SELECT folder_pid AS folderPid FROM folders WHERE folder_id = 'grandchild'`).get())
      .toEqual({ folderPid: 'child' });
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'direct-project'`).get())
      .toEqual({ folderId: 'parent' });
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'nested-project'`).get())
      .toEqual({ folderId: 'child' });
  });

  it('promotes top-level folder contents to the personal root', () => {
    const database = createDb();
    folder(database, 'target', null);
    folder(database, 'child', 'target');
    project(database, 'direct-project', 'target');

    const result = deleteWorkspaceFolderPreservingContents(database, 'personal', 'target');

    expect(result).toMatchObject({
      parentFolderId: null,
      movedProjectCount: 1,
      movedSubfolderCount: 1,
    });
    expect(database.prepare(`SELECT folder_pid AS folderPid FROM folders WHERE folder_id = 'child'`).get())
      .toEqual({ folderPid: null });
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'direct-project'`).get())
      .toEqual({ folderId: null });
  });

  it('repairs projects that point at deleted or missing folders back to root', () => {
    const database = createDb();
    folder(database, 'valid', null);
    project(database, 'valid-project', 'valid');
    project(database, 'orphan-project', 'missing-folder');
    database.prepare(
      `INSERT INTO workspace_projects
        (project_id, workspace_id, created_by_workspace_member_id, folder_id, updated_at)
       VALUES ('other-member-project', 'personal', 'someone-else', 'missing-folder', 1)`,
    ).run();

    expect(repairOrphanedWorkspaceProjectFolders(database, 'personal', 'me')).toBe(1);
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'valid-project'`).get())
      .toEqual({ folderId: 'valid' });
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'orphan-project'`).get())
      .toEqual({ folderId: null });
    expect(database.prepare(`SELECT folder_id AS folderId FROM workspace_projects WHERE project_id = 'other-member-project'`).get())
      .toEqual({ folderId: 'missing-folder' });
  });
});
