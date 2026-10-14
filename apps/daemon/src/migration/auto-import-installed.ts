/**
 * Auto-import projects from a locally installed legacy Hi Design product.
 *
 * On daemon startup, scans the platform's appData location for the legacy
 * "Hi Design" product data directories (the old desktop app writes under
 * `<appData>/Hi Design/namespaces/<namespace>/data/`). Each discovered data
 * directory may contain an `app.sqlite` and a `projects/` folder with managed
 * project subdirectories. This module migrates those projects — including all
 * related data (conversations, messages, tabs, deployments, routines, etc.)
 * — into the current daemon's database.
 *
 * Migration strategy: SQLite ATTACH DATABASE is used to access the old
 * product's `app.sqlite` from within the daemon's own connection. For each
 * project, all related tables are copied row-by-row, using column-intersection
 * to handle schema differences between the old and new versions. The
 * project's metadata is updated with `baseDir` pointing at the original
 * project directory (files are accessed in-place, not copied) and
 * `importedFrom: 'installed-product'`.
 *
 * Idempotency: before migrating, the module checks whether the project's ID
 * or its `baseDir` already exists in the current daemon's database. If either
 * match is found, the project is skipped.
 *
 * The scan is best-effort: any FS or DB error for a single project is logged
 * and skipped so the daemon always starts.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import type { SqliteDb } from '../db.js';
import { listProjects, ensureWorkspaceProject } from '../db.js';
import { getSharedSpaceTeamId, getSharedSpaceMemberId } from '../ids.js';
import { readSsoUsername } from '../http/hik_logins/hicoo.js';

/** Legacy product display name used as the appData subdirectory. */
const LEGACY_PRODUCT_NAME = 'Hi Design';

/** Marker stored in project metadata.importedFrom. */
const AUTO_IMPORT_SOURCE = 'installed-product';

/** Workspace + member IDs used to bind imported projects into workspace_projects. */
export
interface WorkspaceBinding {
  workspaceId: string;
  workspaceMemberId: string;
}

/**
 * Read the legacy product's `config.sso.json` from its data directory and
 * derive the Shared Space workspace ID and member ID. Returns null when the
 * SSO config is absent or has no username — in that case the project is
 * imported without a `workspace_projects` binding.
 */
export
function resolveLegacyWorkspaceBinding(dataDir: string): WorkspaceBinding | null {
  const username = readSsoUsername(dataDir);
  if (!username) return null;
  return {
    workspaceId: getSharedSpaceTeamId(),
    workspaceMemberId: getSharedSpaceMemberId(username),
  };
}

export interface AutoImportResult {
  scanned: number;
  imported: number;
  skipped: number;
  errors: string[];
  /** Projects that were imported in this run, with their entry file if detected. */
  importedProjects: Array<{
    projectId: string;
    projectDir: string;
    entryFile: string | null;
  }>;
}

/**
 * Resolve the platform-specific appData directory where Electron stores
 * per-user application data.
 *   win32:  %APPDATA% (C:\Users\<user>\AppData\Roaming)
 *   darwin: ~/Library/Application Support
 *   linux:  $XDG_CONFIG_HOME || ~/.config
 */
function resolveAppDataDir(): string | null {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData && appData.length > 0) return appData;
    return path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0 && path.isAbsolute(xdg)) return xdg;
  return path.join(os.homedir(), '.config');
}

/**
 * Discover legacy Hi Design product data directories on the local machine.
 *
 * Each packaged installation writes data under:
 *   `<appData>/Hi Design/namespaces/<namespace>/data/`
 *
 * Multiple namespaces (default, release-beta-win, etc.) may coexist. This
 * function returns every `data/` directory that contains an `app.sqlite`
 * file (confirming it is a real Hi Design data root, not a stray folder).
 *
 * The caller's own RUNTIME_DATA_DIR is always excluded.
 */
export async function discoverInstalledProductDataDirs(
  currentDataDir: string,
): Promise<string[]> {
  const appData = resolveAppDataDir();
  if (!appData) return [];

  const productRoot = path.join(appData, LEGACY_PRODUCT_NAME, 'namespaces');
  let namespaceEntries: string[];
  try {
    namespaceEntries = await fsp.readdir(productRoot);
  } catch {
    return [];
  }

  const results: string[] = [];
  const currentResolved = path.resolve(currentDataDir);

  for (const ns of namespaceEntries) {
    const nsDir = path.join(productRoot, ns);
    let stat;
    try {
      stat = await fsp.stat(nsDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const dataDir = path.join(nsDir, 'data');
    try {
      await fsp.access(path.join(dataDir, 'app.sqlite'));
    } catch {
      continue;
    }

    if (path.resolve(dataDir) === currentResolved) continue;
    results.push(dataDir);
  }

  return results;
}

/**
 * Build a set of project IDs and baseDir paths already tracked by the
 * current daemon. Used for fast idempotency checks during migration.
 */
function existingProjectKeys(db: SqliteDb): {
  ids: Set<string>;
  baseDirs: Set<string>;
} {
  const projects = listProjects(db);
  const ids = new Set<string>();
  const baseDirs = new Set<string>();
  for (const p of projects) {
    ids.add(p.id);
    const baseDir = p.metadata?.baseDir;
    if (typeof baseDir === 'string' && baseDir.length > 0) {
      baseDirs.add(path.resolve(baseDir));
    }
  }
  return { ids, baseDirs };
}

// ---------------------------------------------------------------------------
// ATTACH-based table migration helpers
// ---------------------------------------------------------------------------

/**
 * Get the column names for a table in the main (daemon) database.
 * Returns an empty array if the table does not exist.
 */
function getMainTableColumns(db: SqliteDb, table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Get column metadata (name, notnull, type, dflt_value) for a table in the
 * main (daemon) database. Used to provide default values for NOT NULL
 * columns that are absent from the source (legacy) database.
 */
function getMainTableColumnInfo(db: SqliteDb, table: string): Array<{
  name: string;
  notnull: number;
  type: string;
  dflt_value: string | null;
}> {
  return db.pragma(`table_info(${table})`) as Array<{
    name: string;
    notnull: number;
    type: string;
    dflt_value: string | null;
  }>;
}

/**
 * Copy all rows from `source.<table>` matching the WHERE clause into the
 * daemon's `main.<table>`. Uses column-intersection to handle schema
 * differences between the old and new database versions gracefully.
 *
 * Returns the number of rows copied. If the table does not exist in either
 * database, returns 0 without error.
 */
function copyRelatedTable(
  db: SqliteDb,
  table: string,
  whereClause: string,
  params: unknown[],
): number {
  const mainColsInfo = getMainTableColumnInfo(db, table);
  if (mainColsInfo.length === 0) return 0;

  let rows: Record<string, unknown>[];
  try {
    rows = db
      .prepare(`SELECT * FROM source.${table} WHERE ${whereClause}`)
      .all(...params) as Record<string, unknown>[];
  } catch {
    // Table does not exist in the source database.
    return 0;
  }
  if (rows.length === 0) return 0;

  const firstRow = rows[0]!;
  const sourceCols = Object.keys(firstRow);
  const sharedCols = mainColsInfo.filter((c) => sourceCols.includes(c.name));
  if (sharedCols.length === 0) return 0;

  // Build a lookup of NOT NULL columns so we can substitute defaults when
  // the source value is null/undefined (the column exists in both schemas
  // but the source row left it empty).
  const notNullColNames = new Set(
    mainColsInfo.filter((c) => c.notnull === 1).map((c) => c.name),
  );

  // Identify NOT NULL columns in the daemon schema that are absent from the
  // source data. These need default values to satisfy the constraint.
  const missingNotNullCols = mainColsInfo.filter(
    (c) => !sourceCols.includes(c.name) && c.notnull === 1,
  );
  const defaultFillCols = missingNotNullCols.map((c) => {
    if (c.dflt_value !== null) return { name: c.name, value: c.dflt_value };
    // Provide a type-appropriate default when the column has no explicit default.
    if (c.type.toUpperCase() === 'INTEGER') return { name: c.name, value: 0 };
    return { name: c.name, value: '' };
  });

  // For shared columns that are NOT NULL in the daemon schema, prepare a
  // fallback default to use when the source value is null/undefined.
  const sharedDefaults = new Map<string, unknown>();
  for (const c of sharedCols) {
    if (notNullColNames.has(c.name)) {
      if (c.dflt_value !== null) {
        sharedDefaults.set(c.name, c.dflt_value);
      } else if (c.type.toUpperCase() === 'INTEGER') {
        sharedDefaults.set(c.name, 0);
      } else {
        sharedDefaults.set(c.name, '');
      }
    }
  }

  const allCols = [...sharedCols.map((c) => c.name), ...defaultFillCols.map((c) => c.name)];
  const colList = allCols.map((c) => `"${c}"`).join(', ');
  const placeholders = allCols.map(() => '?').join(', ');
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
  );

  for (const row of rows) {
    try {
      insertStmt.run(
        ...sharedCols.map((c) => {
          const v = row[c.name];
          if (v === null || v === undefined) {
            const fallback = sharedDefaults.get(c.name);
            if (fallback !== undefined) return fallback;
          }
          return v;
        }),
        ...defaultFillCols.map((c) => c.value),
      );
    } catch {
      // Skip rows that violate CHECK constraints or other constraints in
      // the daemon schema (e.g. routine_runs.status has a CHECK that the
      // legacy product's value does not satisfy). The row is simply not
      // migrated — this is best-effort, and a single bad row should not
      // prevent the rest of the project's data from being imported.
    }
  }
  return rows.length;
}

/**
 * Detect the entry file (index.html, etc.) inside a project directory
 * synchronously. Used inside the transaction where async is not available.
 */
function detectEntryFileSync(dir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const priorities = ['index.html', 'index.htm'];
  for (const p of priorities) {
    if (entries.includes(p)) return p;
  }
  const htmlFile = entries.find(
    (e) => e.endsWith('.html') || e.endsWith('.htm'),
  );
  return htmlFile ?? null;
}

/**
 * Migrate a single project and all its related data from the source
 * (legacy) database into the daemon's database.
 *
 * Uses ATTACH DATABASE to access the legacy `app.sqlite` from within the
 * daemon's own connection. All project-related tables are copied in a single
 * transaction. The project metadata is updated with `baseDir` and
 * `importedFrom` before insertion.
 *
 * Returns 'imported' on success, 'skipped' if the project already exists,
 * or 'not_found' if the project does not exist in the source database.
 */
export function migrateProjectFromSourceDb(
  db: SqliteDb,
  sourceDbPath: string,
  projectId: string,
  projectDirPath: string,
  knownIds: Set<string>,
  knownBaseDirs: Set<string>,
  workspaceBinding: WorkspaceBinding | null,
): { status: 'imported' | 'skipped' | 'not_found'; entryFile: string | null } {
  const resolvedDir = path.resolve(projectDirPath);

  // Idempotency: skip if the project ID or baseDir already exists.
  if (knownIds.has(projectId) || knownBaseDirs.has(resolvedDir)) {
    return { status: 'skipped', entryFile: null };
  }

  // Escape single quotes for the SQLite string literal.
  const escapedPath = sourceDbPath.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${escapedPath}' AS source`);
 let entryFile: string | null = null;
  try {
    // Read the project row from the source database.
    const projectRow = db
      .prepare('SELECT * FROM source.projects WHERE id = ?')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!projectRow) return { status: 'not_found', entryFile: null };

    // Parse existing metadata and add baseDir + importedFrom.
    let metadata: Record<string, unknown> = {};
    const rawMetadata = projectRow['metadata_json'];
    if (typeof rawMetadata === 'string' && rawMetadata.length > 0) {
      try {
        metadata = JSON.parse(rawMetadata) as Record<string, unknown>;
      } catch {
        // Keep empty metadata if JSON is corrupt.
      }
    }
    metadata['baseDir'] = resolvedDir;
    metadata['importedFrom'] = AUTO_IMPORT_SOURCE;

    // Detect entry file for the metadata.
    entryFile = detectEntryFileSync(resolvedDir);
    if (entryFile) metadata['entryFile'] = entryFile;

    // Get column intersection for the projects table.
    const mainCols = getMainTableColumns(db, 'projects');
    const sourceCols = Object.keys(projectRow);
    const sharedCols = mainCols.filter((c) => sourceCols.includes(c));

    db.transaction(() => {
      // 1. Insert project row with updated metadata.
      const colList = sharedCols.map((c) => `"${c}"`).join(', ');
      const placeholders = sharedCols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO projects (${colList}) VALUES (${placeholders})`).run(
        ...sharedCols.map((c) =>
          c === 'metadata_json' ? JSON.stringify(metadata) : projectRow[c],
        ),
      );

      // Bind the imported project to the Shared Space workspace so it shows up
      // in the project list with correct ownership and sync state. Uses the
      // legacy product's SSO username to derive the member ID.
      if (workspaceBinding) {
        const createdAt = typeof projectRow['created_at'] === 'number' ? projectRow['created_at'] : Date.now();
        const updatedAt = typeof projectRow['updated_at'] === 'number' ? projectRow['updated_at'] : createdAt;
        ensureWorkspaceProject(db, {
          projectId,
          workspaceId: workspaceBinding.workspaceId,
          visibility: 'personal',
          resourceState: 'active',
          createdByWorkspaceMemberId: workspaceBinding.workspaceMemberId,
          updatedByWorkspaceMemberId: workspaceBinding.workspaceMemberId,
          syncState: 'local_only',
          resourceHubResourceId: null,
          cloudTombstonedAt: null,
          createdAt,
          updatedAt,
        });
      }

      // 2. Conversations (direct project_id).
      copyRelatedTable(db, 'conversations', 'project_id = ?', [projectId]);

      // 3. Applied plugin snapshots (direct project_id).
      copyRelatedTable(db, 'applied_plugin_snapshots', 'project_id = ?', [projectId]);

      // 4. Messages (via conversation_id -> conversations).
      copyRelatedTable(
        db,
        'messages',
        'conversation_id IN (SELECT id FROM source.conversations WHERE project_id = ?)',
        [projectId],
      );

      // 5. Message event batches (via message_id -> messages -> conversations).
      copyRelatedTable(
        db,
        'message_event_batches',
        'message_id IN (SELECT m.id FROM source.messages m JOIN source.conversations c ON m.conversation_id = c.id WHERE c.project_id = ?)',
        [projectId],
      );

      // 6. Agent sessions (via conversation_id -> conversations).
      copyRelatedTable(
        db,
        'agent_sessions',
        'conversation_id IN (SELECT id FROM source.conversations WHERE project_id = ?)',
        [projectId],
      );

      // 7. Tabs (direct project_id).
      copyRelatedTable(db, 'tabs', 'project_id = ?', [projectId]);

      // 8. Tabs state (direct project_id).
      copyRelatedTable(db, 'tabs_state', 'project_id = ?', [projectId]);

      // 9. Deployments (direct project_id).
      copyRelatedTable(db, 'deployments', 'project_id = ?', [projectId]);

      // 10. Routines (direct project_id).
      copyRelatedTable(db, 'routines', 'project_id = ?', [projectId]);

      // 11. Routine runs (direct project_id).
      copyRelatedTable(db, 'routine_runs', 'project_id = ?', [projectId]);

      // 12. Routine schedule claims (via routine_id -> routines).
      copyRelatedTable(
        db,
        'routine_schedule_claims',
        'routine_id IN (SELECT id FROM source.routines WHERE project_id = ?)',
        [projectId],
      );

      // 13. Preview comments (direct project_id).
      copyRelatedTable(db, 'preview_comments', 'project_id = ?', [projectId]);

      // 14. Critique runs (direct project_id).
      copyRelatedTable(db, 'critique_runs', 'project_id = ?', [projectId]);

      // 15. GenUI surfaces (direct project_id).
      copyRelatedTable(db, 'genui_surfaces', 'project_id = ?', [projectId]);
    })();
  } finally {
    db.exec('DETACH DATABASE source');
  }

  knownIds.add(projectId);
  knownBaseDirs.add(resolvedDir);
  return { status: 'imported', entryFile };
}

/**
 * Copy a project directory from source to destination using the fastest available
 * system-level copy command. On Windows this is `robocopy`; on macOS/Linux it
 * is `cp -r`. The destination parent is created if needed.
 *
 * Robocopy exit codes 0-7 are success (0 = nothing to copy, 1 = files
 * copied, 2 = extras, 4 = mismatches). Exit code 8+ indicates a real
 * failure. See https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy
 */
const execFileAsync = promisify(execFile);

async function copyProjectDir(src: string, dst: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { windowsHide: true });
    } catch (err: unknown) {
      const code = (err as { status?: number })?.status ?? 0;
      if (code >= 8) throw err;
    }
  } else {
    await execFileAsync('cp', ['-r', src, dst]);
  }
}

/**
 * Scan a legacy product's data directory for project folders and migrate
 * any that are not already tracked by the current daemon.
 */
async function migrateFromDataDir(
  db: SqliteDb,
  dataDir: string,
  targetProjectsDir: string,
  knownIds: Set<string>,
  knownBaseDirs: Set<string>,
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  importedProjects: Array<{ projectId: string; projectDir: string; entryFile: string | null }>;
}> {
  const workspaceBinding = resolveLegacyWorkspaceBinding(dataDir);
  const projectsDir = path.join(dataDir, 'projects');
  let entries: string[];
  try {
    entries = await fsp.readdir(projectsDir);
  } catch {
    return { imported: 0, skipped: 0, errors: [], importedProjects: [] };
  }

  const sourceDbPath = path.join(dataDir, 'app.sqlite');
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const importedProjects: Array<{ projectId: string; projectDir: string; entryFile: string | null }> = [];

  for (const entry of entries) {
    const entryPath = path.join(projectsDir, entry);
    try {
      const stat = await fsp.stat(entryPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    // Copy the project directory into the daemon's managed projects
    // directory so files survive an uninstall of the legacy product.
    const targetDir = path.join(targetProjectsDir, entry);
    let projectDir = entryPath;
    try {
      await fsp.access(targetDir);
      // Target already exists (e.g. from a previous import attempt) —
      // use it as-is, no copy needed.
      projectDir = targetDir;
    } catch {
      // Target does not exist — copy from the legacy directory.
      try {
        await copyProjectDir(entryPath, targetDir);
        projectDir = targetDir;
      } catch (copyErr) {
        errors.push(
          `${entry}: directory copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`,
        );
        continue;
      }
    }

    try {
      const result = migrateProjectFromSourceDb(
        db,
        sourceDbPath,
        entry,
        projectDir,
        knownIds,
        knownBaseDirs,
        workspaceBinding,
      );
      if (result.status === 'imported') {
        imported += 1;
        importedProjects.push({ projectId: entry, projectDir, entryFile: result.entryFile });
      } else {
        skipped += 1;
      }
    } catch (err) {
      errors.push(
        `${entry}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { imported, skipped, errors, importedProjects };
}

/**
 * Entry point: discover legacy Hi Design product data directories on the
 * local machine, scan each for project folders, and migrate any that are
 * not already tracked by the current daemon's database.
 *
 * Best-effort: errors are collected and returned, never thrown, so the
 * daemon always starts. If OD_DISABLE_AUTO_IMPORT is set, the scan is
 * skipped entirely.
 */
export async function autoImportInstalledProjects(
  db: SqliteDb,
  currentDataDir: string,
  targetProjectsDir: string,
): Promise<AutoImportResult> {
  if (
    process.env.OD_DISABLE_AUTO_IMPORT === '1' ||
    process.env.OD_DISABLE_AUTO_IMPORT === 'true'
  ) {
    return { scanned: 0, imported: 0, skipped: 0, errors: [], importedProjects: [] };
  }

  const dataDirs = await discoverInstalledProductDataDirs(currentDataDir);
  if (dataDirs.length === 0) {
    return { scanned: 0, imported: 0, skipped: 0, errors: [], importedProjects: [] };
  }

  const { ids, baseDirs } = existingProjectKeys(db);

  let totalImported = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];
  const allImportedProjects: AutoImportResult['importedProjects'] = [];

  for (const dataDir of dataDirs) {
    try {
      const result = await migrateFromDataDir(db, dataDir, targetProjectsDir, ids, baseDirs);
      totalImported += result.imported;
      totalSkipped += result.skipped;
      allErrors.push(...result.errors);
      allImportedProjects.push(...result.importedProjects);
    } catch (err) {
      allErrors.push(
        `${dataDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    scanned: dataDirs.length,
    imported: totalImported,
    skipped: totalSkipped,
    errors: allErrors,
    importedProjects: allImportedProjects,
  };
}

// ---------------------------------------------------------------------------
// Suspended cover tasks — drained after the desktop renderer is ready
// ---------------------------------------------------------------------------

/**
 * A cover generation task suspended during auto-import. The task is
 * drained later, once the project routes (and their cover helpers) are
 * registered, which happens after the desktop renderer has had a chance
 * to initialise.
 */
interface PendingCoverTask {
  projectId: string;
  projectDir: string;
  entryFile: string | null;
}

/** Module-level queue of cover tasks waiting for the renderer. */
const pendingCoverTasks: PendingCoverTask[] = [];

/**
 * Enqueue imported projects that have an HTML entry file for deferred cover
 * generation. Called right after auto-import finishes — the actual cover
 * rendering is suspended until `drainPendingCoverTasks` is invoked (after
 * the desktop renderer and project routes are ready).
 *
 * Projects without an HTML entry file are not enqueued.
 */
export function enqueuePendingCoverTasks(
  importedProjects: Array<{ projectId: string; projectDir: string; entryFile: string | null }>,
): void {
  for (const p of importedProjects) {
    if (p.entryFile && /\.html?$/i.test(p.entryFile)) {
      pendingCoverTasks.push({ projectId: p.projectId, projectDir: p.projectDir, entryFile: p.entryFile });
    }
  }
}

/**
 * Signature of the trigger function provided by the project routes cover
 * helpers (`triggerCoverForProjectEntry`). It is fire-and-forget: the
 * caller does not await the cover generation.
 */
export type TriggerCoverFn = (
  projectId: string,
  projectMeta: { name?: string; metadata?: Record<string, unknown> | null } | null,
) => void;

/**
 * Drain all suspended cover tasks by invoking the trigger function for each
 * pending project. This is called after `registerProjectRoutes` has set up
 * the cover helpers, which happens once the desktop renderer is available.
 *
 * The queue is cleared atomically: if the function is called again later
 * (e.g. on a second server start in the same process) there is nothing to
 * drain. Each task is dispatched via the fire-and-forget trigger, so this
 * function returns immediately without waiting for screenshots to finish.
 */
export function drainPendingCoverTasks(triggerCover: TriggerCoverFn): void {
  if (pendingCoverTasks.length === 0) return;
  const tasks = pendingCoverTasks.splice(0);
  for (const task of tasks) {
    if (!task.entryFile) continue;
    triggerCover(task.projectId, {
      metadata: {
        entryFile: task.entryFile,
        baseDir: task.projectDir,
      },
    });
  }
}
