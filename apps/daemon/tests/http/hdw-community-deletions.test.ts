import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  markHdwCommunityHardDeleted,
  readHdwCommunityDeletions,
  removeHdwCommunityDeletion,
  writeHdwCommunityDeletion,
} from '../../src/http/hdw.js';

describe('HDW community deletion local state', () => {
  let dataDir = '';

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('starts empty when the file is missing', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-empty-'));
    await expect(readHdwCommunityDeletions(dataDir)).toEqual({});
  });

  it('persists soft-unpublish tombstones that are visible to the owner list logic', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-soft-'));
    expect(writeHdwCommunityDeletion(dataDir, 'alpha', '2026-09-19T00:00:00.000Z')).toBe(true);

    const state = readHdwCommunityDeletions(dataDir);
    expect(state.alpha?.deletedAt).toBe('2026-09-19T00:00:00.000Z');
    expect(state.alpha?.hardDeleted).toBeUndefined();
  });

  it('removes the soft marker when a plugin is hard-deleted', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-hard-'));
    writeHdwCommunityDeletion(dataDir, 'alpha', '2026-09-19T00:00:00.000Z');
    markHdwCommunityHardDeleted(dataDir, 'alpha');

    expect(readHdwCommunityDeletions(dataDir).alpha).toMatchObject({ hardDeleted: true });
    expect(readHdwCommunityDeletions(dataDir).alpha?.deletedAt).toBeUndefined();
  });

  it('can remove a plugin entirely from the local tombstone file', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-remove-'));
    writeHdwCommunityDeletion(dataDir, 'alpha', '2026-09-19T00:00:00.000Z');
    expect(removeHdwCommunityDeletion(dataDir, 'alpha')).toBe(true);
    expect(readHdwCommunityDeletions(dataDir)).toEqual({});
  });

  it('revives a hard-deleted plugin when a later publish succeeds', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-republish-'));
    markHdwCommunityHardDeleted(dataDir, 'alpha');

    expect(removeHdwCommunityDeletion(dataDir, 'alpha')).toBe(true);
    expect(readHdwCommunityDeletions(dataDir)).toEqual({});
  });

  it('removing the soft tombstone leaves a later hard deletion in place', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-publish-'));
    writeHdwCommunityDeletion(dataDir, 'alpha', '2026-09-19T00:00:00.000Z');
    expect(removeHdwCommunityDeletion(dataDir, 'alpha')).toBe(true);
    markHdwCommunityHardDeleted(dataDir, 'alpha');
    expect(readHdwCommunityDeletions(dataDir).alpha).toMatchObject({ hardDeleted: true });
  });

  it('still writes a valid JSON file when the temp dir exists', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-hdw-deletions-file-'));
    writeHdwCommunityDeletion(dataDir, 'beta', '2026-09-19T00:00:00.000Z');
    const raw = JSON.parse(await readFile(path.join(dataDir, 'hdw-community-deletions.json'), 'utf8')) as Record<string, unknown>;
    expect(raw).toMatchObject({ beta: { deletedAt: '2026-09-19T00:00:00.000Z' } });
  });
});
