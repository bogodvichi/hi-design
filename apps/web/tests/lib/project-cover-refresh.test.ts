// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  localProjectCoverUrl,
  projectCardCoverUrl,
  projectCoverDigestFor,
  resetProjectCoverOverrides,
  sharedProjectCoverUrl,
} from '../../src/lib/project-cover-refresh';
import {
  republishRecentlyOpenedProjectCover,
  updateRecentlyOpenedProjectCover,
} from '../../src/lib/recently-opened-projects';

const STORAGE_KEY = 'od:recently-opened-projects';
const LIST_REFRESH_CHANNELS = [
  'od:project-list-surface-refresh',
  'personal:folders-updated',
  'personal:projects-refresh',
  'shared:projects-refresh',
  'hdw:folders-updated',
  'hdw:subfolders-updated',
  'od:recently-opened-projects-changed',
];

function seedRecent(projectId: string, coverDigest: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([{
    id: projectId,
    name: 'Edited project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 1,
    openedAt: Date.now(),
    coverDigest,
    workspaceVisibility: 'personal',
  }]));
}

// Regression: after editing HTML the new cover digest is already produced on
// the client by the upload. Updating the card must therefore be a pure local
// push: no list re-fetch, no folder reload, no cover-digest round-trip.
describe('targeted project cover refresh', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    resetProjectCoverOverrides();
    fetchMock = vi.fn(() => {
      throw new Error('cover refresh must not issue a request');
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetProjectCoverOverrides();
  });

  it('publishes the saved digest without any network or list-refresh event', () => {
    seedRecent('project-1', 'digest-old');
    const seen: string[] = [];
    const listener = (event: Event) => { seen.push(event.type); };
    for (const name of LIST_REFRESH_CHANNELS) window.addEventListener(name, listener);
    try {
      updateRecentlyOpenedProjectCover('project-1', 'digest-new');
    } finally {
      for (const name of LIST_REFRESH_CHANNELS) window.removeEventListener(name, listener);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(projectCoverDigestFor('project-1', 'digest-old')).toBe('digest-new');
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')[0].coverDigest,
    ).toBe('digest-new');
  });

  it('changes only the edited project cover URL', () => {
    seedRecent('project-1', 'digest-old');
    updateRecentlyOpenedProjectCover('project-1', 'digest-new');

    expect(localProjectCoverUrl('project-1', 'digest-old')).toContain('digest=digest-new');
    expect(sharedProjectCoverUrl('project-1', 'digest-old'))
      .toBe('/api/hdw/api/community/cover/digest-new');
    // Untouched cards keep their original URL, so the browser reuses the cache.
    expect(localProjectCoverUrl('project-2', 'digest-old'))
      .toBe('/api/projects/project-2/cover?digest=digest-old');
    expect(sharedProjectCoverUrl('project-2', 'digest-old'))
      .toBe('/api/hdw/api/community/cover/digest-old');
    expect(projectCoverDigestFor('project-2', 'digest-old')).toBe('digest-old');
  });

  it('keeps the glyph/iframe fallback when no digest is available', () => {
    expect(projectCardCoverUrl('project-2', null, true)).toBeNull();
    expect(projectCardCoverUrl('project-2', null, false)).toBeNull();
  });

  it('reads an edited team card from the local PNG, not the stale HDW blob', () => {
    seedRecent('project-1', 'digest-old');
    updateRecentlyOpenedProjectCover('project-1', 'digest-new');

    // HDW assigns its own blob digest when the async sync lands; a local
    // SHA-256 digest in that path would 404.
    expect(projectCardCoverUrl('project-1', 'hdw-old', false))
      .toContain('/api/projects/project-1/cover?');
    expect(projectCardCoverUrl('project-1', 'hdw-old', false))
      .toContain('digest=digest-new');
    // Untouched team cards stay on their original catalog URL.
    expect(projectCardCoverUrl('project-2', 'hdw-old', false))
      .toBe('/api/hdw/api/community/cover/hdw-old');
  });

  it('re-announces a persisted digest on return without a request', () => {
    seedRecent('project-1', 'digest-new');
    resetProjectCoverOverrides();
    expect(projectCoverDigestFor('project-1', 'digest-old')).toBe('digest-old');

    republishRecentlyOpenedProjectCover('project-1');
    expect(projectCoverDigestFor('project-1', 'digest-old')).toBe('digest-new');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never lets a stale localStorage replay downgrade a saved cover', () => {
    seedRecent('project-1', 'digest-old');
    updateRecentlyOpenedProjectCover('project-1', 'digest-new');
    // Home's digest sync can transiently write the pre-upload value back.
    seedRecent('project-1', 'digest-old');

    republishRecentlyOpenedProjectCover('project-1');
    expect(projectCoverDigestFor('project-1', 'digest-old')).toBe('digest-new');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent a digest when none was saved', () => {
    republishRecentlyOpenedProjectCover('missing-project');
    expect(projectCoverDigestFor('missing-project', 'digest-old')).toBe('digest-old');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
