import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

import {
  ensureWorkspaceProject, getProject, insertConversation, insertProject, type SqliteDb,
} from '../db.js';
import { builtInProjectLocation, canonicalLocationChildDir, readProjectManifest } from '../project-locations.js';
import { isIgnoredProjectDirName } from '../project-ignored-dirs.js';
import { listFiles } from '../projects.js';

export async function recoverManagedProjects(
  db: SqliteDb,
  projectsDir: string,
  owner: { workspaceId: string; workspaceMemberId: string },
): Promise<string[]> {
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const recovered: string[] = [];
  const location = builtInProjectLocation(projectsDir);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || isIgnoredProjectDirName(entry.name)) continue;
    if (getProject(db, entry.name)) continue;
    let projectDir: string;
    try {
      projectDir = await canonicalLocationChildDir(location, entry.name);
    } catch {
      continue;
    }
    const files = await listFiles(projectsDir, entry.name);
    if (files.length === 0) continue;
    const primary = files.find((file) => file.path === 'index.html')
      ?? files.find((file) => /\.html?$/i.test(file.path))
      ?? files[0]!;
    const entryFile = /\.html?$/i.test(primary.path) ? primary.path : null;
    const manifest = await readProjectManifest(projectDir);
    let name = manifest?.id === entry.name ? manifest.name : path.parse(primary.path).name;
    if (manifest?.id !== entry.name && entryFile && primary.size <= 512 * 1024) {
      const html = await readFile(path.join(projectDir, entryFile), 'utf8');
      name = load(html)('title').first().text().replace(/\s+/g, ' ').trim() || name;
    }
    const now = Date.now();
    const created = db.transaction(() => {
      // Another list read may have registered this folder while files were read.
      if (getProject(db, entry.name)) return false;
      insertProject(db, {
        id: entry.name,
        name,
        metadata: { kind: 'prototype', importedFrom: 'copied-folder', entryFile },
        createdAt: now,
        updatedAt: now,
      });
      insertConversation(db, { id: randomUUID(), projectId: entry.name, createdAt: now, updatedAt: now });
      ensureWorkspaceProject(db, {
        projectId: entry.name,
        workspaceId: owner.workspaceId,
        createdByWorkspaceMemberId: owner.workspaceMemberId,
        visibility: 'personal',
        syncState: 'local_only',
        createdAt: now,
        updatedAt: now,
      });
      return true;
    })();
    if (created) recovered.push(entry.name);
  }
  return recovered;
}
