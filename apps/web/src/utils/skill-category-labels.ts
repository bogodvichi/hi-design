import type { SkillCategoryFilter } from '@open-design/contracts';
import type { Locale } from '../i18n/types';

const ZH_LABELS: Record<SkillCategoryFilter, string> = {
  all: '全部',
  development_tools: '开发工具',
  content_creation: '内容创作',
  data_analysis: '数据分析',
  productivity: '效率提升',
  other: '其他',
};

const EN_LABELS: Record<SkillCategoryFilter, string> = {
  all: 'All',
  development_tools: 'Developer tools',
  content_creation: 'Content creation',
  data_analysis: 'Data analysis',
  productivity: 'Productivity',
  other: 'Other',
};

export function skillCategoryLabel(category: SkillCategoryFilter, locale: Locale): string {
  return locale.startsWith('zh') ? ZH_LABELS[category] : EN_LABELS[category];
}

export function skillCategorySelectLabel(locale: Locale): string {
  return locale.startsWith('zh') ? 'Skill 分类' : 'Skill category';
}

export function skillCategorySelectHint(locale: Locale): string {
  return locale.startsWith('zh')
    ? '选择最符合该 Skill 用途的分类。'
    : 'Choose the category that best describes this Skill.';
}
