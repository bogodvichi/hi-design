import type Database from 'better-sqlite3';

import {
  listConversations,
  listMessages,
} from './db.js';
import type { ProjectMetadata } from '@open-design/contracts';

type SqliteDb = Database.Database;

function stringIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

function mergeUniqueIds(...lists: Array<readonly string[]>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

function listProjectRunContextIds(
  db: SqliteDb,
  projectId: string,
  readIds: (context: Record<string, unknown>) => string[],
): string[] {
  const conversations = listConversations(db, projectId);
  const collected: string[] = [];
  for (const conversation of conversations) {
    for (const message of listMessages(db, conversation.id)) {
      const context = message.runContext
        && typeof message.runContext === 'object'
        && !Array.isArray(message.runContext)
        ? message.runContext as Record<string, unknown>
        : null;
      if (context) collected.push(...readIds(context));
    }
  }
  return mergeUniqueIds(collected);
}

function contextRefIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((ref) => ref && typeof ref === 'object' ? (ref as { id?: unknown }).id : null)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

export function listProjectUsedSkillIds(db: SqliteDb, projectId: string): string[] {
  return mergeUniqueIds(
    stringIdList(queryProjectMetadata(db, projectId)?.usedSkillIds),
    listProjectRunContextIds(
      db,
      projectId,
      (context) => stringIdList(context.skillIds),
    ),
  );
}

export function listProjectUsedMcpIds(db: SqliteDb, projectId: string): string[] {
  const metadata = queryProjectMetadata(db, projectId);
  return mergeUniqueIds(
    stringIdList(metadata?.usedMcpIds),
    contextRefIdList(metadata?.contextMcpServers),
    listProjectRunContextIds(
      db,
      projectId,
      (context) => stringIdList(context.mcpServerIds),
    ),
  );
}

function queryProjectMetadata(db: SqliteDb, projectId: string): ProjectMetadata | undefined {
  const project = db.prepare(
    'SELECT metadata_json AS metadataJson FROM projects WHERE id = ?',
  ).get(projectId) as { metadataJson?: string | null } | undefined;
  if (!project?.metadataJson) return undefined;
  try {
    return JSON.parse(project.metadataJson) as ProjectMetadata;
  } catch {
    return undefined;
  }
}

export function mergeManifestUsedIds(
  manifest: Record<string, unknown>,
  usedIds: { skillIds: readonly string[]; mcpIds: readonly string[] },
): Record<string, unknown> {
  return {
    ...manifest,
    ...(usedIds.skillIds.length > 0 ? { usedSkillIds: [...usedIds.skillIds] } : {}),
    ...(usedIds.mcpIds.length > 0 ? { usedMcpIds: [...usedIds.mcpIds] } : {}),
  };
}
