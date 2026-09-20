import { describe, expect, it } from 'vitest';

import { resolveHdwCommunityPublishVersion } from '../../src/http/hdw.js';

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
