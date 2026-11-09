import type {
  DesignSystemSummary,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import type { Locale } from './types';
import {
  ZH_CN_DESIGN_SYSTEM_CATEGORIES,
  ZH_CN_DESIGN_SYSTEM_SUMMARIES,
  ZH_CN_PROMPT_TEMPLATE_CATEGORIES,
  ZH_CN_PROMPT_TEMPLATE_COPY,
  ZH_CN_PROMPT_TEMPLATE_TAGS,
  ZH_CN_SKILL_COPY,
} from './content.zh-CN';

type LocalizedSkillCopy = { description?: string; examplePrompt?: string };
type LocalizedPromptTemplateCopy = Partial<Pick<PromptTemplateSummary, 'summary' | 'title'>>;
type LocalizedContentBundle = {
  skillCopy: Record<string, LocalizedSkillCopy>;
  designSystemSummaries: Record<string, string>;
  designSystemCategories: Record<string, string>;
  promptTemplateCategories: Record<string, string>;
  promptTemplateTags: Record<string, string>;
  promptTemplateCopy: Record<string, LocalizedPromptTemplateCopy>;
};

const LOCALIZED_CONTENT: Partial<Record<Locale, LocalizedContentBundle>> = {
  'zh-CN': {
    skillCopy: ZH_CN_SKILL_COPY,
    designSystemSummaries: ZH_CN_DESIGN_SYSTEM_SUMMARIES,
    designSystemCategories: ZH_CN_DESIGN_SYSTEM_CATEGORIES,
    promptTemplateCategories: ZH_CN_PROMPT_TEMPLATE_CATEGORIES,
    promptTemplateTags: ZH_CN_PROMPT_TEMPLATE_TAGS,
    promptTemplateCopy: ZH_CN_PROMPT_TEMPLATE_COPY,
  },
};

// Chinese uses the localized resource bundle; English uses source metadata.
export function hasLocalizedContent(locale: Locale): boolean {
  return getLocalizedContent(locale) !== undefined;
}

function getLocalizedContent(locale: Locale): LocalizedContentBundle | undefined {
  const direct = LOCALIZED_CONTENT[locale];
  if (direct) return direct;
  return undefined;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function localizedRecordValue(
  locale: Locale,
  values: Record<string, string> | undefined,
  options: { includeEnglishFallback?: boolean } = {},
): string | undefined {
  if (!values) return undefined;
  if (values[locale]) return values[locale];
  if (locale.startsWith('zh') && values['zh-CN']) return values['zh-CN'];
  if (options.includeEnglishFallback !== false && values.en) return values.en;
  return undefined;
}

export function localizeSkillName(locale: Locale, skill: SkillSummary): string {
  return localizedRecordValue(locale, skill.displayName) ?? skill.name;
}

export function localizeSkillPrompt(locale: Locale, skill: SkillSummary): string | undefined {
  const inline = localizedRecordValue(locale, skill.examplePromptI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return inline;
  const translated = getLocalizedContent(locale)?.skillCopy[skill.id]?.examplePrompt;
  if (translated) return translated;
  const fallback = localizedRecordValue(locale, skill.examplePromptI18n);
  if (fallback) return fallback;
  return skill.examplePrompt ? normalizeText(skill.examplePrompt) : undefined;
}

export function localizeSkillDescription(locale: Locale, skill: SkillSummary): string {
  const inline = localizedRecordValue(locale, skill.descriptionI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return inline;
  const translated = getLocalizedContent(locale)?.skillCopy[skill.id]?.description;
  if (translated) return translated;
  const fallback = localizedRecordValue(locale, skill.descriptionI18n);
  if (fallback) return fallback;
  return normalizeText(skill.description);
}

export function localizeDesignSystemSummary(
  locale: Locale,
  system: DesignSystemSummary,
): string {
  const translated = getLocalizedContent(locale)?.designSystemSummaries[system.id];
  if (translated) return translated;
  return system.summary || system.category || '';
}

export function localizeDesignSystemCategory(locale: Locale, category: string): string {
  return getLocalizedContent(locale)?.designSystemCategories[category] ?? category;
}

export function localizePromptTemplateCategory(locale: Locale, category: string): string {
  return getLocalizedContent(locale)?.promptTemplateCategories[category] ?? category;
}

export function localizePromptTemplateSummary(
  locale: Locale,
  template: PromptTemplateSummary,
): PromptTemplateSummary {
  const content = getLocalizedContent(locale);
  if (!content) return template;
  const translated = content.promptTemplateCopy[template.id];
  const tags = template.tags?.map((tag) => content.promptTemplateTags[tag] ?? tag);
  return {
    ...template,
    title: translated?.title ?? template.title,
    summary: translated?.summary ?? template.summary,
    category: localizePromptTemplateCategory(locale, template.category || 'General'),
    tags,
  };
}
