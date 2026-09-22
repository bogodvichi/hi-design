// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  enrichRecentlyOpenedProjectCovers,
  recordRecentlyOpenedProject,
  readRecentlyOpenedProjects,
  removeRecentlyOpenedProject,
  readRecentlyOpenedProjectEntries,
  touchRecentlyOpenedProject,
  updateRecentlyOpenedProjectOwner,
} from '../../src/lib/recently-opened-projects';
import type { Project } from '../../src/types';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'My Project',
    skillId: null,
    designSystemId: null,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('recordRecentlyOpenedProject', () => {
  it('stores a project so it appears in readRecentlyOpenedProjects', () => {
    const project = makeProject();
    recordRecentlyOpenedProject(project);
    const recents = readRecentlyOpenedProjects();
    expect(recents).toHaveLength(1);
    expect(recents[0]?.id).toBe('p1');
    expect(recents[0]?.name).toBe('My Project');
  });

  it('moves a re-opened project to the front and deduplicates by id', () => {
    recordRecentlyOpenedProject(makeProject({ id: 'a', name: 'A' }));
    recordRecentlyOpenedProject(makeProject({ id: 'b', name: 'B' }));
    recordRecentlyOpenedProject(makeProject({ id: 'a', name: 'A-updated' }));
    const recents = readRecentlyOpenedProjects();
    expect(recents).toHaveLength(2);
    expect(recents[0]?.id).toBe('a');
    expect(recents[0]?.name).toBe('A-updated');
    expect(recents[1]?.id).toBe('b');
  });

  it('preserves optional workspace and metadata fields', () => {
    recordRecentlyOpenedProject(
      makeProject({
        id: 'shared',
        workspaceId: 'ws-1',
        createdByWorkspaceMemberId: 'mem-1',
        ownerDisplayName: 'Alice',
        metadata: { kind: 'deck' } as Project['metadata'],
      }),
    );
    const recents = readRecentlyOpenedProjects();
    expect(recents[0]?.workspaceId).toBe('ws-1');
    expect(recents[0]?.createdByWorkspaceMemberId).toBe('mem-1');
    expect(recents[0]?.ownerDisplayName).toBe('Alice');
    expect(recents[0]?.metadata).toEqual({ kind: 'deck' });
  });

  it('limits the store to 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      recordRecentlyOpenedProject(makeProject({ id: `p${i}`, name: `P${i}` }));
    }
    const recents = readRecentlyOpenedProjects();
    expect(recents).toHaveLength(10);
    expect(recents[0]?.id).toBe('p14');
  });
});

describe('removeRecentlyOpenedProject', () => {
  it('removes a project by id', () => {
    recordRecentlyOpenedProject(makeProject({ id: 'a' }));
    recordRecentlyOpenedProject(makeProject({ id: 'b' }));
    removeRecentlyOpenedProject('a');
    const recents = readRecentlyOpenedProjects();
    expect(recents).toHaveLength(1);
    expect(recents[0]?.id).toBe('b');
  });

  it('is a no-op when the id is not present', () => {
    recordRecentlyOpenedProject(makeProject({ id: 'a' }));
    removeRecentlyOpenedProject('nonexistent');
    expect(readRecentlyOpenedProjects()).toHaveLength(1);
  });
});

describe('touchRecentlyOpenedProject', () => {
  it('backfills missing owner metadata without changing the recent order', () => {
    recordRecentlyOpenedProject(makeProject({ id: 'a', workspaceId: 'ws-team' }));
    recordRecentlyOpenedProject(makeProject({ id: 'b', workspaceId: 'ws-team' }));

    expect(updateRecentlyOpenedProjectOwner('a', {
      ownerDisplayName: 'Team Owner',
      createdByWorkspaceMemberId: 'member-owner',
    })).toBe(true);

    const recents = readRecentlyOpenedProjects();
    expect(recents.map((project) => project.id)).toEqual(['b', 'a']);
    expect(recents[1]?.ownerDisplayName).toBe('Team Owner');
    expect(recents[1]?.createdByWorkspaceMemberId).toBe('member-owner');
  });

  it('refreshes openedAt while preserving stored card metadata', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1000);
    recordRecentlyOpenedProject(
      makeProject({
        id: 'a',
        coverDigest: 'cover-a',
        ownerDisplayName: 'Alice',
      }),
    );
    now.mockReturnValueOnce(2000);
    touchRecentlyOpenedProject('a');

    const entries = readRecentlyOpenedProjectEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.openedAt).toBe(2000);
    expect(entries[0]?.coverDigest).toBe('cover-a');
    expect(entries[0]?.ownerDisplayName).toBe('Alice');
    now.mockRestore();
  });

  it('does not create an entry for an unknown project', () => {
    touchRecentlyOpenedProject('missing');
    expect(readRecentlyOpenedProjects()).toHaveLength(0);
  });
});

describe('readRecentlyOpenedProjects', () => {
  it('returns an empty array when localStorage is empty', () => {
    expect(readRecentlyOpenedProjects()).toEqual([]);
  });

  it('filters out corrupted entries', () => {
    localStorage.setItem(
      'od:recently-opened-projects',
      JSON.stringify([
        { id: 'valid', name: 'Valid', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 2, openedAt: 3 },
        { id: 123, name: 'Bad' },
        'not-an-object',
      ]),
    );
    const recents = readRecentlyOpenedProjects();
    expect(recents).toHaveLength(1);
    expect(recents[0]?.id).toBe('valid');
  });
});

describe('enrichRecentlyOpenedProjectCovers', () => {
  it('removes personal recent entries the daemon says are missing locally', async () => {
    recordRecentlyOpenedProject(
      makeProject({
        id: 'gone',
        workspaceId: 'ws-1',
        workspaceVisibility: 'personal',
      }),
    );
    recordRecentlyOpenedProject(
      makeProject({
        id: 'kept',
        workspaceId: 'ws-2',
        workspaceVisibility: 'team',
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ digests: {}, missingPersonalProjectIds: ['gone'] }),
      }) as Response),
    );

    const changed = await enrichRecentlyOpenedProjectCovers();
    expect(changed).toContain('gone');
    const remaining = readRecentlyOpenedProjects();
    expect(remaining.map((p) => p.id)).toEqual(['kept']);
  });
});
