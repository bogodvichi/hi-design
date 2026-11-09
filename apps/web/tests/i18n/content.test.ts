import { describe, expect, it } from 'vitest';
import type { DesignSystemSummary, PromptTemplateSummary, SkillSummary } from '../../src/types';
import {
  localizeDesignSystemSummary,
  localizePromptTemplateSummary,
  localizeSkillDescription,
  localizeSkillName,
  localizeSkillPrompt,
  hasLocalizedContent,
} from '../../src/i18n/content';

const skill = {
  id: 'inline-skill',
  name: 'inline-skill',
  displayName: { en: 'Inline Skill', 'zh-CN': '内联技能' },
  description: ' English description from source. ',
  descriptionI18n: { en: 'English inline description.', 'zh-CN': '中文内联描述。' },
  examplePrompt: ' English prompt from source. ',
  examplePromptI18n: { en: 'English inline prompt.', 'zh-CN': '中文内联 prompt。' },
} as unknown as SkillSummary;

describe('Chinese and English resource content', () => {
  it('uses the selected language for inline resource metadata', () => {
    expect(localizeSkillName('zh-CN', skill)).toBe('内联技能');
    expect(localizeSkillName('en', skill)).toBe('Inline Skill');
    expect(localizeSkillDescription('zh-CN', skill)).toBe('中文内联描述。');
    expect(localizeSkillDescription('en', skill)).toBe('English inline description.');
    expect(localizeSkillPrompt('zh-CN', skill)).toBe('中文内联 prompt。');
    expect(localizeSkillPrompt('en', skill)).toBe('English inline prompt.');
  });

  it('uses Chinese built-in copy and falls back field-by-field to English source metadata', () => {
    expect(hasLocalizedContent('zh-CN')).toBe(true);
    expect(hasLocalizedContent('en')).toBe(false);
    const localized = { id: 'ad-creative', description: 'English source', examplePrompt: 'English prompt' } as SkillSummary;
    expect(localizeSkillPrompt('zh-CN', localized)).toBe('生成并迭代广告创意，包括标题、描述和主文案。');
    expect(localizeSkillDescription('en', localized)).toBe('English source');
    const missing = { ...localized, id: 'unknown-skill', description: '  English  fallback.  ' };
    expect(localizeSkillDescription('zh-CN', missing)).toBe('English fallback.');
    const system = { id: 'unknown-system', summary: 'English summary', category: 'General' } as DesignSystemSummary;
    expect(localizeDesignSystemSummary('zh-CN', system)).toBe('English summary');
  });

  it('localizes Chinese template fields while preserving English and unknown metadata', () => {
    const template = {
      id: '3d-stone-staircase-evolution-infographic', surface: 'image',
      title: 'English title', summary: 'English summary', category: 'Infographic',
      tags: ['3d', 'unknown-tag'], source: { repo: 'repo', license: 'MIT' },
    } satisfies PromptTemplateSummary;
    expect(localizePromptTemplateSummary('zh-CN', template)).toMatchObject({
      title: '3D 石阶演化信息图',
      summary: '将扁平的演化时间线转化为逼真的 3D 石阶信息图，配以精细的生物渲染和结构化的侧边面板。',
      category: '信息图', tags: ['3d', 'unknown-tag'],
    });
    expect(localizePromptTemplateSummary('en', template)).toBe(template);
    expect(localizePromptTemplateSummary('zh-CN', { ...template, id: 'unknown', category: 'Unknown' })).toMatchObject({
      title: 'English title', summary: 'English summary', category: 'Unknown',
    });
  });
});
