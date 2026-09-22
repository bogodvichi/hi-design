import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  accumulateUsedMcpIds,
  accumulateUsedSkillIds,
  closeDatabase,
  insertConversation,
  insertProject,
  openDatabase,
  upsertMessage,
} from '../src/db.js';
import {
  listProjectUsedMcpIds,
  listProjectUsedSkillIds,
  mergeManifestUsedIds,
} from '../src/community-used-ids.js';

describe('community used ids', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-community-used-ids-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accumulates skill and MCP ids in project metadata without duplicates', () => {
    const metadata = accumulateUsedSkillIds(
      accumulateUsedMcpIds(
        { usedSkillIds: ['skill-a'] },
        ['mcp-a', 'mcp-b'],
      ),
      ['skill-b', 'skill-a'],
    );

    expect(metadata.usedSkillIds).toEqual(['skill-a', 'skill-b']);
    expect(metadata.usedMcpIds).toEqual(['mcp-a', 'mcp-b']);
  });

  it('collects used ids from metadata and conversation run context', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, {
      id: 'project-1',
      name: 'Project',
      createdAt: now,
      updatedAt: now,
      metadata: {
        usedSkillIds: ['skill-a', 'skill-a'],
        usedMcpIds: ['mcp-a'],
        contextMcpServers: [
          { id: 'mcp-c', label: 'MCP C' },
          { id: 'mcp-a' },
        ],
      },
    });
    insertConversation(db, {
      id: 'conversation-1',
      projectId: 'project-1',
      title: 'Conversation',
      createdAt: now,
      updatedAt: now,
    });
    upsertMessage(db, 'conversation-1', {
      id: 'message-1',
      role: 'user',
      content: 'Use context',
      runContext: {
        skillIds: ['skill-b', 'skill-a'],
        mcpServerIds: ['mcp-b', 'mcp-a'],
      },
    });

    expect(listProjectUsedSkillIds(db, 'project-1'))
      .toEqual(['skill-a', 'skill-b']);
    expect(listProjectUsedMcpIds(db, 'project-1'))
      .toEqual(['mcp-a', 'mcp-c', 'mcp-b']);
  });

  it('merges used ids into an existing manifest without overwriting other fields', () => {
    const merged = mergeManifestUsedIds(
      { title: 'Project', usedSkillIds: ['skill-old'] },
      { skillIds: ['skill-old', 'skill-new'], mcpIds: ['mcp-new'] },
    );

    expect(merged).toEqual({
      title: 'Project',
      usedSkillIds: ['skill-old', 'skill-new'],
      usedMcpIds: ['mcp-new'],
    });
  });

  it('does not add empty used id fields to a manifest', () => {
    const merged = mergeManifestUsedIds(
      { title: 'Project', usedSkillIds: ['skill-old'] },
      { skillIds: [], mcpIds: [] },
    );

    expect(merged).toEqual({
      title: 'Project',
      usedSkillIds: ['skill-old'],
    });
  });
});
