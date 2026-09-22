import { describe, expect, it } from 'vitest';

import { communitySkillMatchesQuery } from '../../src/skills/community-search.js';

describe('communitySkillMatchesQuery', () => {
  const skill = {
    title: 'maas-kb-search',
    localId: 'maas-kb-search-d4MN',
    description: 'MaaS 平台知识库语义检索工具',
    publisherName: '崔枝',
    sourceLabel: 'MAAS Skillhub',
  };

  it('matches substrings case-insensitively', () => {
    expect(communitySkillMatchesQuery(skill, 'KB')).toBe(true);
    expect(communitySkillMatchesQuery(skill, '语义')).toBe(true);
    expect(communitySkillMatchesQuery(skill, '崔枝')).toBe(true);
  });

  it('treats common separators as spaces', () => {
    expect(communitySkillMatchesQuery(skill, 'kb search')).toBe(true);
    expect(communitySkillMatchesQuery(skill, 'maas kb')).toBe(true);
  });

  it('requires every query token to be present', () => {
    expect(communitySkillMatchesQuery(skill, 'maas search')).toBe(true);
    expect(communitySkillMatchesQuery(skill, 'maas excel')).toBe(false);
  });
});
