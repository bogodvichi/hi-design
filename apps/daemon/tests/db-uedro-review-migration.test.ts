import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';

let tempRoot: string | null = null;

afterEach(() => {
  closeDatabase();
  if (tempRoot) {
    // Windows can hold the WAL handle for a moment; a locked temp dir must
    // never fail an otherwise-correct assertion.
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* leave the temp dir for the OS to reap */
    }
    tempRoot = null;
  }
});

/**
 * Seed an older data directory whose `workspace_projects` still used the
 * composite `(workspace_id, project_id)` key but already carried the columns
 * added later by ALTER TABLE. This is exactly the shape the single-home
 * migration has to rebuild without losing data.
 */
function seedLegacyDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const legacy = new Database(path.join(dataDir, 'app.sqlite'));
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      skill_id TEXT,
      design_system_id TEXT,
      pending_prompt TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE workspace_projects (
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      resource_state TEXT NOT NULL,
      created_by_workspace_member_id TEXT,
      updated_by_workspace_member_id TEXT,
      resource_hub_resource_id TEXT,
      cloud_tombstoned_at INTEGER,
      sync_state TEXT,
      folder_id TEXT,
      metadata_refresh_pending INTEGER,
      uedro_review_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, project_id)
    );
  `);
  legacy.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run('p1', 'legacy project', 1000, 1000);
  legacy.prepare(
    `INSERT INTO workspace_projects
       (workspace_id, project_id, visibility, resource_state, sync_state,
        folder_id, metadata_refresh_pending, uedro_review_id, version,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('personal', 'p1', 'personal', 'active', 'local_only', 'folder-1', 1, 'review-legacy', 3, 1000, 2000);
  legacy.close();
}

describe('workspace_projects single-home migration · uedro_review_id', () => {
  it('keeps folder_id, metadata_refresh_pending, and uedro_review_id', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-db-uedro-'));
    const dataDir = path.join(tempRoot, 'data');
    seedLegacyDataDir(dataDir);

    const db = openDatabase(tempRoot, { dataDir });

    const columns = db.prepare(`PRAGMA table_info(workspace_projects)`).all() as Array<{
      name: string;
      pk: number;
    }>;
    // Rebuilt to the single-home key: project_id is the primary key.
    expect(columns.find((c) => c.name === 'project_id')?.pk).toBe(1);
    expect(columns.find((c) => c.name === 'workspace_id')?.pk).toBe(0);
    expect(columns.some((c) => c.name === 'uedro_review_id')).toBe(true);

    const row = db
      .prepare(`SELECT * FROM workspace_projects WHERE project_id = ?`)
      .get('p1') as Record<string, unknown>;
    expect(row.workspace_id).toBe('personal');
    expect(row.folder_id).toBe('folder-1');
    expect(row.metadata_refresh_pending).toBe(1);
    expect(row.uedro_review_id).toBe('review-legacy');
    expect(row.version).toBe(3);
  });

  it('adds uedro_review_id to a legacy table that predates the column', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-db-uedro-'));
    const dataDir = path.join(tempRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const legacy = new Database(path.join(dataDir, 'app.sqlite'));
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        skill_id TEXT,
        design_system_id TEXT,
        pending_prompt TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_projects (
        project_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        resource_state TEXT NOT NULL,
        created_by_workspace_member_id TEXT,
        updated_by_workspace_member_id TEXT,
        resource_hub_resource_id TEXT,
        cloud_tombstoned_at INTEGER,
        sync_state TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run('p2', 'older project', 1000, 1000);
    legacy.prepare(
      `INSERT INTO workspace_projects
         (project_id, workspace_id, visibility, resource_state, sync_state, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('p2', 'personal', 'personal', 'active', 'local_only', 1, 1000, 2000);
    legacy.close();

    const db = openDatabase(tempRoot, { dataDir });
    const row = db
      .prepare(`SELECT uedro_review_id FROM workspace_projects WHERE project_id = ?`)
      .get('p2') as { uedro_review_id: string | null };
    expect(row.uedro_review_id).toBeNull();
  });
});
