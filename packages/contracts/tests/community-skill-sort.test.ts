import { describe, expect, it } from 'vitest';
import { isCommunitySkillSort, sortCommunitySkills } from '../src/api/community';

describe('community Skill ordering', () => {
  it('ranks users before actions, keeps tied resources stable and leaves the source untouched', () => {
    const skills = [
      { id: 'missing' },
      { id: 'many-actions', peopleCount: 1, actionCount: 100 },
      { id: 'more-users', peopleCount: 2, actionCount: 1 },
      { id: 'tie', peopleCount: 2, actionCount: 1 },
      { id: 'most-popular', peopleCount: 2, actionCount: 3 },
    ];
    expect(sortCommunitySkills(skills, 'popular').map((skill) => skill.id))
      .toEqual(['most-popular', 'more-users', 'tie', 'many-actions', 'missing']);
    expect(skills[0]?.id).toBe('missing');
  });

  it('compares timestamps across timezones and puts missing or invalid dates last', () => {
    const skills = [
      { id: 'invalid', updatedAt: 'invalid' },
      { id: 'older', updatedAt: '2026-10-29T10:00:00+08:00' },
      { id: 'newer', updatedAt: '2026-10-29T03:00:00Z' },
      { id: 'missing', updatedAt: null },
    ];
    expect(sortCommunitySkills(skills, 'updated').map((skill) => skill.id))
      .toEqual(['newer', 'older', 'invalid', 'missing']);
  });

  it('accepts only the two supported sort query values', () => {
    expect(['popular', 'updated', '', 'newest', undefined, ['updated']].map(isCommunitySkillSort))
      .toEqual([true, true, false, false, false, false]);
  });
});
