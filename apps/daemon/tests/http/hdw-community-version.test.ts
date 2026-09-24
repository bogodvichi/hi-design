import { describe, expect, it } from 'vitest';

import {
  createHdwCommunityPublicationName,
  HDW_COMMUNITY_PUBLICATION_VERSION,
  resolveHdwCommunityPublishVersion,
} from '../../src/http/hdw.js';

describe('project community publication identity', () => {
  it('creates a new community name for each publish attempt', () => {
    const first = createHdwCommunityPublicationName('project-1', 'attempt-0001');
    const second = createHdwCommunityPublicationName('project-1', 'attempt-0002');

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
    expect(HDW_COMMUNITY_PUBLICATION_VERSION).toBe('0.0.0');
  });

  it('reuses the same name when one publish attempt is retried', () => {
    expect(createHdwCommunityPublicationName('project-1', 'attempt-retry'))
      .toBe(createHdwCommunityPublicationName('project-1', 'attempt-retry'));
  });

  it('does not merge different source projects that share a title', () => {
    expect(createHdwCommunityPublicationName('project-1', 'attempt-shared'))
      .not.toBe(createHdwCommunityPublicationName('project-2', 'attempt-shared'));
  });
});

describe('resolveHdwCommunityPublishVersion', () => {
  it('returns the fallback version when nothing exists upstream yet', () => {
    expect(resolveHdwCommunityPublishVersion(undefined, '0.0.0')).toBe('0.0.0');
  });

  it('bumps the next patch when the same or higher version already exists', () => {
    expect(resolveHdwCommunityPublishVersion('0.0.0', '0.0.0')).toBe('0.0.1');
    expect(resolveHdwCommunityPublishVersion('0.0.1', '0.0.0')).toBe('0.0.2');
    expect(resolveHdwCommunityPublishVersion('1.4.2', '0.0.0')).toBe('1.4.3');
  });

  it('keeps the fallback when the upstream version is lower', () => {
    expect(resolveHdwCommunityPublishVersion('0.1.0', '1.0.0')).toBe('1.0.0');
  });

  it('suffixes non-numeric versions instead of producing an invalid patch bump', () => {
    expect(resolveHdwCommunityPublishVersion('0.0.0-beta.1', '0.0.0')).toBe(
      '0.0.0-beta.1-1',
    );
  });
});
