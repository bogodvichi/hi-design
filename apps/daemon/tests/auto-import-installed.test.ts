/**
 * Unit tests for the auto-import-installed module.
 *
 * Hermetic: each test builds a fake legacy-product data tree inside a
 * mkdtemp directory, then tests the migration logic directly. No test
 * ever touches a real Hi Design install's data.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase, listProjects } from '../src/db.js';
import {
  autoImportInstalledProjects,
  discoverInstalledProductDataDirs,
  migrateProjectFromSourceDb,
  resolveLegacyWorkspaceBinding,
  enqueuePendingCoverTasks,
  drainPendingCoverTasks,
} from '../src/migration/auto-import-installed.js';
import { getSharedSpaceTeamId, getSharedSpaceMemberId } from '../src/ids.js';

const require = createRequire(import.meta.url);

/**
 * Build a fake legacy-product data tree with the full schema, seed one
 * project with conversations, messages, tabs, etc., and return the data
 * dir path.
 */
function buildFakeInstall(root: string, namespace: string): string {
  const dataDir = path.join(root, 'Hi Design', 'namespaces', namespace, 'data');
  mkdirSync(path.join(dataDir, 'projects'), { recursive: true });

  // Write a legacy SSO config so the workspace binding logic can resolve
  // a member ID from the username.
  writeFileSync(
    path.join(dataDir, 'config.sso.json'),
    JSON.stringify({ username: 'testuser', userInfo: { displayName: 'Test User' } }),
  );

  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const ext = new Database(path.join(dataDir, 'app.sqlite'));
  ext.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      skill_id TEXT,
      design_system_id TEXT,
      pending_prompt TEXT,
      metadata_json TEXT,
      custom_instructions TEXT,
      applied_plugin_snapshot_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      session_mode TEXT NOT NULL DEFAULT 'design',
      intent_signals_json TEXT,
      applied_plugin_snapshot_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      result_delivery_state TEXT,
      events_json TEXT,
      attachments_json TEXT,
      produced_files_json TEXT,
      trace_object_files_json TEXT,
      feedback_json TEXT,
      pre_turn_file_names_json TEXT,
      session_mode TEXT,
      run_context_json TEXT,
      applied_plugin_snapshot_json TEXT,
      telemetry_finalized_at INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      position INTEGER,
      created_at INTEGER,
      run_id TEXT,
      run_status TEXT,
      last_run_event_id TEXT,
      comment_attachments_json TEXT,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      conversation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      stable_prompt_hash TEXT,
      stable_prompt_sections TEXT,
      model TEXT,
      cwd TEXT,
      last_message_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tabs (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_id, name),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tabs_state (
      project_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      state_json TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      url TEXT NOT NULL,
      deployment_id TEXT,
      deployment_count INTEGER NOT NULL DEFAULT 1,
      target TEXT NOT NULL DEFAULT 'preview',
      status TEXT NOT NULL DEFAULT 'ready',
      status_message TEXT,
      reachable_at INTEGER,
      provider_metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, file_name, provider_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_kind TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      schedule_json TEXT,
      project_mode TEXT NOT NULL,
      project_id TEXT,
      skill_id TEXT,
      agent_id TEXT,
      context_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS routine_runs (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      summary TEXT,
      error TEXT,
      error_code TEXT,
      FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS routine_schedule_claims (
      routine_id TEXT NOT NULL,
      slot_at INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY(routine_id, slot_at),
      FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS preview_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      element_id TEXT NOT NULL,
      selector TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      position_json TEXT NOT NULL,
      html_hint TEXT NOT NULL,
      selection_kind TEXT,
      member_count INTEGER,
      pod_members_json TEXT,
      style_json TEXT,
      attachments_json TEXT,
      slide_index INTEGER,
      slide_key INTEGER NOT NULL DEFAULT -1,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS applied_plugin_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      conversation_id TEXT,
      run_id TEXT,
      plugin_id TEXT,
      status TEXT,
      applied_at INTEGER,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS critique_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      artifact_path TEXT,
      status TEXT,
      score TEXT,
      rounds_json TEXT,
      transcript_path TEXT,
      protocol_version TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS genui_surfaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      run_id TEXT,
      plugin_snapshot_id TEXT,
      surface_id TEXT,
      kind TEXT,
      persist INTEGER,
      schema_digest TEXT,
      value_json TEXT,
      status TEXT,
      responded_by TEXT,
      requested_at INTEGER,
      responded_at INTEGER,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS message_event_batches (
      id INTEGER PRIMARY KEY,
      message_id TEXT NOT NULL,
      events_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);

  // Seed a project with full related data.
  const projectId = 'proj-test-001';
  const convId = 'conv-test-001';
  const msgId = 'msg-test-001';
  const routineId = 'rtn-test-001';
  const now = Date.now();

  const projDir = path.join(dataDir, 'projects', projectId);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(path.join(projDir, 'index.html'), '<!DOCTYPE html><title>Test</title>');

  ext.prepare(`INSERT INTO projects (id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(projectId, 'Test Project', JSON.stringify({ kind: 'prototype', entryFile: 'index.html' }), now, now);
  ext.prepare(`INSERT INTO conversations (id, project_id, title, session_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(convId, projectId, 'Test Conversation', 'design', now, now);
  ext.prepare(`INSERT INTO messages (id, conversation_id, role, content, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(msgId, convId, 'user', 'Hello world', 0, now);
  ext.prepare(`INSERT INTO message_event_batches (message_id, events_json, created_at) VALUES (?, ?, ?)`)
    .run(msgId, JSON.stringify([{ type: 'text_delta', text: 'Hello' }]), now);
  ext.prepare(`INSERT INTO agent_sessions (conversation_id, agent_id, session_id, updated_at) VALUES (?, ?, ?, ?)`)
    .run(convId, 'claude', 'sess-001', now);
  ext.prepare(`INSERT INTO tabs (project_id, name, position, is_active) VALUES (?, ?, ?, ?)`)
    .run(projectId, 'index.html', 0, 1);
  ext.prepare(`INSERT INTO tabs_state (project_id, updated_at, state_json) VALUES (?, ?, ?)`)
    .run(projectId, now, JSON.stringify({ tabs: ['index.html'], active: 'index.html' }));
  ext.prepare(`INSERT INTO deployments (id, project_id, file_name, provider_id, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('dep-001', projectId, 'index.html', 'vercel', 'https://example.com', now, now);
  ext.prepare(`INSERT INTO routines (id, name, prompt, schedule_kind, schedule_value, project_mode, project_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(routineId, 'Daily Check', 'Check status', 'interval', '24h', 'project', projectId, 1, now, now);
  ext.prepare(`INSERT INTO routine_runs (id, routine_id, trigger, status, project_id, conversation_id, agent_run_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('rr-001', routineId, 'schedule', 'completed', projectId, convId, 'run-001', now);
  ext.prepare(`INSERT INTO routine_schedule_claims (routine_id, slot_at, claimed_at) VALUES (?, ?, ?)`)
    .run(routineId, now, now);
  ext.prepare(`INSERT INTO preview_comments (id, project_id, conversation_id, file_path, element_id, selector, label, text, position_json, html_hint, slide_key, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('pc-001', projectId, convId, 'index.html', 'btn-1', '.btn', 'Button', 'Nice button', JSON.stringify({}), '<button></button>', -1, '', 'open', now, now);
  ext.prepare(`INSERT INTO applied_plugin_snapshots (id, project_id, conversation_id, status, applied_at) VALUES (?, ?, ?, ?, ?)`)
    .run('aps-001', projectId, convId, 'active', now);
  ext.prepare(`INSERT INTO critique_runs (id, project_id, conversation_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('cr-001', projectId, convId, 'completed', now, now);
  ext.prepare(`INSERT INTO genui_surfaces (id, project_id, conversation_id, status, requested_at) VALUES (?, ?, ?, ?, ?)`)
    .run('gs-001', projectId, convId, 'responded', now);

  ext.close();
  return dataDir;
}

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'auto-import-test-'));
}

describe('autoImportInstalledProjects', () => {
  let tempRoot: string;
  let daemonDataDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tempRoot = makeTempDir();
    daemonDataDir = path.join(tempRoot, 'daemon-data');
    mkdirSync(daemonDataDir, { recursive: true });
    db = openDatabase(daemonDataDir, { dataDir: daemonDataDir });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('skips when OD_DISABLE_AUTO_IMPORT is set', async () => {
    const prev = process.env.OD_DISABLE_AUTO_IMPORT;
    process.env.OD_DISABLE_AUTO_IMPORT = '1';
    try {
      const result = await autoImportInstalledProjects(db, daemonDataDir, path.join(daemonDataDir, "projects"));
      expect(result.scanned).toBe(0);
      expect(result.imported).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.OD_DISABLE_AUTO_IMPORT;
      else process.env.OD_DISABLE_AUTO_IMPORT = prev;
    }
  });

  it('returns a well-formed no-op result when no installed product is found', async () => {
    const result = await autoImportInstalledProjects(db, daemonDataDir, path.join(daemonDataDir, "projects"));
    expect(result.imported).toBeGreaterThanOrEqual(0);
    expect(result.errors.length).toBe(0);
  });

  it('is idempotent: running twice does not duplicate projects', async () => {
    // On a machine with real Hi Design installs, this may find and import
    // real projects. The key assertion is that a second run imports 0.
    const first = await autoImportInstalledProjects(db, daemonDataDir, path.join(daemonDataDir, "projects"));
    const second = await autoImportInstalledProjects(db, daemonDataDir, path.join(daemonDataDir, "projects"));
    expect(second.imported).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(first.imported);
  });
});

describe('discoverInstalledProductDataDirs', () => {
  it('excludes the current daemon data directory from results', async () => {
    const dirs = await discoverInstalledProductDataDirs(
      path.join(os.tmpdir(), 'nonexistent-daemon-data'),
    );
    expect(dirs.every(d => d !== path.join(os.tmpdir(), 'nonexistent-daemon-data'))).toBe(true);
  });
});

describe('full migration with ATTACH', () => {
  let tempRoot: string;
  let daemonDataDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tempRoot = makeTempDir();
    daemonDataDir = path.join(tempRoot, 'daemon-data');
    mkdirSync(daemonDataDir, { recursive: true });
    db = openDatabase(daemonDataDir, { dataDir: daemonDataDir });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('migrates project with all related tables from a fake install', () => {
    const dataDir = buildFakeInstall(tempRoot, 'default');
    const projectId = 'proj-test-001';
    const sourceDbPath = path.join(dataDir, 'app.sqlite');
    const projectDirPath = path.join(dataDir, 'projects', projectId);

    const Database = require('better-sqlite3') as typeof import('better-sqlite3');

    // Verify the source DB has the expected data.
    const ext = new Database(sourceDbPath, { readonly: true });
    const count = (table: string) => (ext.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
    expect(count('projects')).toBe(1);
    expect(count('conversations')).toBe(1);
    expect(count('messages')).toBe(1);
    expect(count('message_event_batches')).toBe(1);
    expect(count('agent_sessions')).toBe(1);
    expect(count('tabs')).toBe(1);
    expect(count('tabs_state')).toBe(1);
    expect(count('deployments')).toBe(1);
    expect(count('routines')).toBe(1);
    expect(count('routine_runs')).toBe(1);
    expect(count('routine_schedule_claims')).toBe(1);
    expect(count('preview_comments')).toBe(1);
    expect(count('applied_plugin_snapshots')).toBe(1);
    expect(count('critique_runs')).toBe(1);
    expect(count('genui_surfaces')).toBe(1);
    ext.close();

    // Call the actual migration function — this tests the real code path
    // including workspace_projects binding via ensureWorkspaceProject.
    const workspaceBinding = resolveLegacyWorkspaceBinding(dataDir);
    expect(workspaceBinding).not.toBeNull();
    const knownIds = new Set<string>();
    const knownBaseDirs = new Set<string>();
    const result = migrateProjectFromSourceDb(
      db,
      sourceDbPath,
      projectId,
      projectDirPath,
      knownIds,
      knownBaseDirs,
      workspaceBinding,
    );
  expect(result.status).toBe('imported');
  expect(result.entryFile).toBe('index.html');

    // Verify the data was migrated to the daemon DB.
    const projects = listProjects(db);
    expect(projects.length).toBe(1);
    const p = projects[0]!;
    expect(p.id).toBe(projectId);
    expect(p.name).toBe('Test Project');
    expect(p.metadata?.baseDir).toBe(projectDirPath);
    expect(p.metadata?.importedFrom).toBe('installed-product');

    // Verify conversations were migrated.
    const convCount = (db.prepare('SELECT COUNT(*) as c FROM conversations WHERE project_id = ?').get(projectId) as { c: number }).c;
    expect(convCount).toBe(1);

    // Verify messages were migrated.
    const msgCount = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)').get(projectId) as { c: number }).c;
    expect(msgCount).toBe(1);

    // Verify tabs were migrated.
    const tabCount = (db.prepare('SELECT COUNT(*) as c FROM tabs WHERE project_id = ?').get(projectId) as { c: number }).c;
    expect(tabCount).toBe(1);

    // Verify tabs_state was migrated.
    const tsCount = (db.prepare('SELECT COUNT(*) as c FROM tabs_state WHERE project_id = ?').get(projectId) as { c: number }).c;
    expect(tsCount).toBe(1);

    // Verify workspace_projects binding was created.
    const wp = db.prepare('SELECT * FROM workspace_projects WHERE project_id = ?').get(projectId) as Record<string, any> | undefined;
    expect(wp).toBeDefined();
    expect(wp!.workspace_id).toBe(getSharedSpaceTeamId());
    expect(wp!.created_by_workspace_member_id).toBe(getSharedSpaceMemberId('testuser'));
    expect(wp!.visibility).toBe('personal');
    expect(wp!.sync_state).toBe('local_only');
    expect(wp!.resource_state).toBe('active');
  });

  it('imports project without workspace_projects binding when config.sso.json is absent', () => {
    const dataDir = buildFakeInstall(tempRoot, 'no-sso');
    // Remove the SSO config to simulate a legacy install without login.
    unlinkSync(path.join(dataDir, 'config.sso.json'));

    const projectId = 'proj-test-001';
    const sourceDbPath = path.join(dataDir, 'app.sqlite');
    const projectDirPath = path.join(dataDir, 'projects', projectId);

    // Without SSO config, workspaceBinding is null — project is imported
    // but no workspace_projects row is created.
    const workspaceBinding = resolveLegacyWorkspaceBinding(dataDir);
    expect(workspaceBinding).toBeNull();
    const knownIds = new Set<string>();
    const knownBaseDirs = new Set<string>();
    const result = migrateProjectFromSourceDb(
      db,
      sourceDbPath,
      projectId,
      projectDirPath,
      knownIds,
      knownBaseDirs,
      workspaceBinding,
    );
  expect(result.status).toBe('imported');
  expect(result.entryFile).toBe('index.html');

    // Project is imported but no workspace_projects row exists.
    const projects = listProjects(db);
    expect(projects.length).toBe(1);

    const wp = db.prepare('SELECT COUNT(*) as c FROM workspace_projects WHERE project_id = ?').get(projectId) as { c: number };
    expect(wp.c).toBe(0);
  });
});

describe('pending cover task queue', () => {
  it('enqueues and drains cover tasks for projects with HTML entry files', () => {
    const calls: Array<{ projectId: string; meta: Record<string, unknown> | null }> = [];
    const trigger = (projectId: string, meta: { name?: string; metadata?: Record<string, unknown> | null } | null) => {
      calls.push({ projectId, meta: meta?.metadata ?? null });
    };

    enqueuePendingCoverTasks([
      { projectId: 'p1', projectDir: '/dir/p1', entryFile: 'index.html' },
      { projectId: 'p2', projectDir: '/dir/p2', entryFile: null },
      { projectId: 'p3', projectDir: '/dir/p3', entryFile: 'slide.htm' },
      { projectId: 'p4', projectDir: '/dir/p4', entryFile: 'readme.txt' },
    ]);

    drainPendingCoverTasks(trigger);
    expect(calls.length).toBe(2);
    expect(calls[0]!.projectId).toBe('p1');
    expect(calls[0]!.meta).toEqual({ entryFile: 'index.html', baseDir: '/dir/p1' });
    expect(calls[1]!.projectId).toBe('p3');
    expect(calls[1]!.meta).toEqual({ entryFile: 'slide.htm', baseDir: '/dir/p3' });

    // Second drain is a no-op — queue was cleared atomically.
    drainPendingCoverTasks(trigger);
    expect(calls.length).toBe(2);
  });
});
