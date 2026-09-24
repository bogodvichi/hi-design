import { describe, expect, it } from 'vitest';
import { avatarColorForDisplayName } from '../../src/utils/avatarColor';

describe('avatarColorForDisplayName', () => {
  it('returns one color for equivalent display-name formatting', () => {
    const expected = avatarColorForDisplayName('张佳雯5');

    expect(expected).toBe('hsl(313, 88%, 46%)');
    expect(avatarColorForDisplayName('  张佳雯5  ')).toBe(expected);
    expect(avatarColorForDisplayName('ＡＬＩＣＥ')).toBe(
      avatarColorForDisplayName('alice'),
    );
    expect(avatarColorForDisplayName('Alice   Zhang')).toBe(
      avatarColorForDisplayName('alice zhang'),
    );
  });

  it('uses the fallback only when the normalized display name is empty', () => {
    expect(avatarColorForDisplayName('')).toBe('hsl(210, 65%, 65%)');
    expect(avatarColorForDisplayName('  ')).toBe('hsl(210, 65%, 65%)');
  });
});
