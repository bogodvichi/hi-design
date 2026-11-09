// OD Library reconcile — mirror agent-produced project
// deliverables into the Library as *referenced* assets, so the Library is the
// single place a user sees everything they've made (clips, uploads, design
// systems, agent output) and can re-consume any of it.
//
// Why referenced (not owned): the bytes already live in a project / design
// system; copying them would duplicate potentially large files and go stale.
// `registerLibraryAsset({ storage: 'referenced', absPath })` stores only a
// pointer (an absolute filePath), and `resolveAssetBytesPath` already serves it.
//
// Idempotent by design. Each pass:
//   - skips a project file already mirrored (origin_project_id + rel_path) WITHOUT
//     reading its bytes (the cheap guard that keeps auto-reconcile-on-open fast),
//   - and even if it didn't, content-hash dedup + source-row dedup collapse
//     repeats. So this is safe to run on every Library open.
//
// Best-effort: a single bad project / unreadable file must never abort the pass
// or throw into the caller (a route handler), so every unit is try-wrapped.

import type { LibraryAssetKind,LibrarySourceKind } from '@open-design/contracts';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { listConversations,listMessages,listProjects } from './db.js';
import { findReferencedAssetByOrigin } from './library-store.js';
import { registerLibraryAsset } from './library.js';
import { listFiles,resolveProjectDir } from './projects.js';

type SqliteDb = Database.Database;

export interface ReconcileLibraryPaths {
  LIBRARY_DIR: string;
  PROJECTS_DIR: string;
  USER_DESIGN_SYSTEMS_DIR: string;
}

export interface ReconcileLibraryResult {
  /** Design-system cards newly registered this pass. */
  designSystems: number;
  /** Project deliverable assets newly registered this pass. */
  projectAssets: number;
  /** Referenced rows skipped because their origin file was already indexed. */
  deduped: number;
  /** designSystems + projectAssets. */
  total: number;
}

// Only the deliverable kinds the Library can faithfully render (image / html /
// video). pdf, presentation, audio, and document/spreadsheet/code/text are not
// modeled by LibraryAssetKind, so syncing them would produce broken thumbnails;
// they're intentionally left out of this slice. `sketch` covers .svg and
// sketch-*.png (renderable as images) — the OD-internal `.sketch.json` editable
// format is skipped explicitly below.
const DELIVERABLE_KINDS = new Set(['html', 'image', 'video', 'sketch']);

// Among agent-produced deliverables, visual media reads as "Generated"; authored
// pages/decks read as "Agent". The split is a single rule, easy to retune.
const GENERATED_MEDIA_KINDS = new Set(['image', 'video', 'sketch']);

// Cap the bytes we'll hash for one referenced asset. The origin short-circuit
// means a file is read at most once (first sync), but a multi-hundred-MB video
// still shouldn't be slurped into memory. Above this it's skipped.
const MAX_SYNC_BYTES = 64 * 1024 * 1024;

interface ProjectFileLike {
  name: string;
  path?: string;
  type?: string;
  kind?: string;
  size?: number;
  mtime?: number;
  mime?: string;
}

/** The Library kind for a project file's inferred kind. */
function libraryKindFor(projectFileKind: string | undefined): LibraryAssetKind {
  if (projectFileKind === 'html') return 'html';
  if (projectFileKind === 'video') return 'video';
  return 'image'; // image + sketch (svg / sketch-*.png)
}

function isDeliverable(file: ProjectFileLike): boolean {
  if (file.type === 'dir') return false;
  if (!file.kind || !DELIVERABLE_KINDS.has(file.kind)) return false;
  // OD-internal editable sketch doc — not a flat, renderable deliverable.
  if (file.name.endsWith('.sketch.json')) return false;
  return true;
}

function classifySource(projectFileKind: string | undefined, produced: boolean): LibrarySourceKind {
  if (!produced) return 'manual-upload';
  return GENERATED_MEDIA_KINDS.has(projectFileKind ?? '') ? 'generated' : 'agent-task';
}

/** Best-effort unix-ms from an ISO timestamp, else undefined. */
function isoToMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function isWithinRoot(absPath: string, root: string): boolean {
  const rel = path.relative(root, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Map every file a project's agent runs reported producing to the conversation
 * that produced it. Presence in this map = "generated/authored by an agent";
 * absence = "the user dropped it in" (→ manual-upload).
 */
function buildProducedMap(db: SqliteDb, projectId: string): Map<string, string> {
  const produced = new Map<string, string>();
  let conversations: Array<{ id: string }>;
  try {
    conversations = listConversations(db, projectId) as Array<{ id: string }>;
  } catch {
    return produced;
  }
  for (const conv of conversations) {
    let messages: Array<{ producedFiles?: ProjectFileLike[] }>;
    try {
      messages = listMessages(db, conv.id) as Array<{ producedFiles?: ProjectFileLike[] }>;
    } catch {
      continue;
    }
    for (const msg of messages) {
      for (const pf of msg.producedFiles ?? []) {
        const rel = pf.path ?? pf.name;
        if (rel && !produced.has(rel)) produced.set(rel, conv.id);
      }
    }
  }
  return produced;
}

/** Index each project's deliverable files as referenced Library assets. */
async function reconcileProjects(
  db: SqliteDb,
  paths: ReconcileLibraryPaths,
  result: ReconcileLibraryResult,
): Promise<void> {
  let projects: Array<{ id: string; metadata?: unknown }>;
  try {
    projects = listProjects(db) as Array<{ id: string; metadata?: unknown }>;
  } catch {
    return;
  }
  for (const project of projects) {
    let projectDir: string;
    let files: ProjectFileLike[];
    try {
      // Same resolution listFiles uses; both throw for unavailable sandbox
      // imported projects, which we simply skip.
      projectDir = resolveProjectDir(paths.PROJECTS_DIR, project.id, project.metadata);
      files = (await listFiles(paths.PROJECTS_DIR, project.id, {
        metadata: project.metadata,
      })) as ProjectFileLike[];
    } catch {
      continue;
    }
    const producedMap = buildProducedMap(db, project.id);
    for (const file of files) {
      try {
        if (!isDeliverable(file)) continue;
        const rel = file.path ?? file.name;
        if (!rel) continue;
        // Cheap "already synced?" guard — no bytes read.
        if (findReferencedAssetByOrigin(db, project.id, rel)) {
          result.deduped += 1;
          continue;
        }
        if (typeof file.size === 'number' && file.size > MAX_SYNC_BYTES) continue;
        const produced = producedMap.has(rel);
        const sourceKind = classifySource(file.kind, produced);
        const conversationId = produced ? producedMap.get(rel) : undefined;
        const absPath = path.join(projectDir, rel);
        const res = await registerLibraryAsset({
          db,
          libraryDir: paths.LIBRARY_DIR,
          storage: 'referenced',
          absPath,
          kind: libraryKindFor(file.kind),
          mime: file.mime,
          filename: file.name,
          sourceTitle: file.name,
          capturedAt: file.mtime,
          originProjectId: project.id,
          relPath: rel,
          source: { sourceKind, projectId: project.id, conversationId, relPath: rel },
        });
        if (res.deduped) result.deduped += 1;
        else result.projectAssets += 1;
      } catch {
        // best-effort per file
      }
    }
  }
}

/**
 * Reconcile agent project deliverables into the Library as
 * referenced assets. Idempotent and best-effort; never throws. Returns what was
 * newly indexed this pass (counts the UI / CLI surface back to the user).
 */
export async function reconcileLibrary(
  db: SqliteDb,
  paths: ReconcileLibraryPaths,
): Promise<ReconcileLibraryResult> {
  const result: ReconcileLibraryResult = {
    designSystems: 0,
    projectAssets: 0,
    deduped: 0,
    total: 0,
  };
  try {
    await reconcileProjects(db, paths, result);
  } catch {
    // best-effort
  }
  result.total = result.designSystems + result.projectAssets;
  return result;
}
