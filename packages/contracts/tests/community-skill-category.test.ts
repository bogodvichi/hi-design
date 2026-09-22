import { describe, expect, it } from 'vitest';

import {
  emptySkillCategoryCounts,
  normalizeSkillCategory,
} from '../src/api/community';

describe('community Skill category contract', () => {
  it('normalizes canonical, MaaS-style and Chinese category values', () => {
    expect(normalizeSkillCategory('development_tools')).toBe('development_tools');
    expect(normalizeSkillCategory('Developer Tools')).toBe('development_tools');
    expect(normalizeSkillCategory('开发工具')).toBe('development_tools');
    expect(normalizeSkillCategory('内容创作')).toBe('content_creation');
    expect(normalizeSkillCategory('analytics')).toBe('data_analysis');
    expect(normalizeSkillCategory('效率提升')).toBe('productivity');
    expect(normalizeSkillCategory('1')).toBe('development_tools');
    expect(normalizeSkillCategory('2')).toBe('content_creation');
    expect(normalizeSkillCategory('3')).toBe('data_analysis');
    expect(normalizeSkillCategory('4')).toBe('productivity');
    expect(normalizeSkillCategory('5')).toBe('other');
  });

  it('keeps legacy or unknown skills visible by falling back to other', () => {
    expect(normalizeSkillCategory(undefined)).toBe('other');
    expect(normalizeSkillCategory('')).toBe('other');
    expect(normalizeSkillCategory('unknown-maas-type')).toBe('other');
  });

  it('creates a complete zeroed count shape', () => {
    expect(emptySkillCategoryCounts()).toEqual({
      all: 0,
      development_tools: 0,
      content_creation: 0,
      data_analysis: 0,
      productivity: 0,
      other: 0,
    });
  });
});
