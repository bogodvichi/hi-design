import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '@open-design/contracts';

import { skillMatchesQuery } from '../../src/runtime/design-toolbox';

describe('skillMatchesQuery', () => {
  it('matches an author-facing slug when the canonical skill name uses spaces', () => {
    const skill = {
      id: 'Data Analysis',
      name: 'Data Analysis',
      slug: 'data-analysis',
      description: 'Analyze data and create reports.',
      triggers: [],
      mode: 'prototype',
      previewType: 'markdown',
      designSystemRequired: false,
      defaultFor: [],
      upstream: null,
      hasBody: true,
      examplePrompt: '',
      aggregatesExamples: false,
    } satisfies SkillSummary;

    expect(skillMatchesQuery(skill, 'data-analysis')).toBe(true);
  });
});
