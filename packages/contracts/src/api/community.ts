export interface OpenDesignDiscordPresenceResponse {
  inviteCode: string;
  inviteUrl: string;
  onlineCount: number;
  memberCount: number;
  fetchedAt: number;
  stale: boolean;
}

/** Canonical Skill categories shared by publish, MAAS import and community browse. */
export const SKILL_CATEGORIES = [
  'development_tools',
  'content_creation',
  'data_analysis',
  'productivity',
  'other',
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export type SkillCategoryFilter = 'all' | SkillCategory;

export type SkillCategoryCounts = Record<SkillCategoryFilter, number>;

export function isSkillCategory(value: unknown): value is SkillCategory {
  return typeof value === 'string'
    && (SKILL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Normalize stored/external category values onto HiDesign's five-category
 * taxonomy. Unknown, missing and legacy values deliberately fall into `other`
 * so historical resources stay represented in both All and category counts.
 */
export function normalizeSkillCategory(value: unknown): SkillCategory {
  if (isSkillCategory(value)) return value;
  if (typeof value !== 'string') return 'other';

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'other';

  const aliases: Record<string, SkillCategory> = {
    // MAAS Skillhub `skillSubType` taxonomy.
    '1': 'development_tools',
    '2': 'content_creation',
    '3': 'data_analysis',
    '4': 'productivity',
    '5': 'other',
    development: 'development_tools',
    developer: 'development_tools',
    developer_tool: 'development_tools',
    developer_tools: 'development_tools',
    dev: 'development_tools',
    dev_tools: 'development_tools',
    coding: 'development_tools',
    code: 'development_tools',
    编程: 'development_tools',
    开发: 'development_tools',
    开发工具: 'development_tools',

    content: 'content_creation',
    content_creation: 'content_creation',
    creation: 'content_creation',
    writing: 'content_creation',
    media: 'content_creation',
    内容: 'content_creation',
    创作: 'content_creation',
    内容创作: 'content_creation',

    data: 'data_analysis',
    analytics: 'data_analysis',
    analysis: 'data_analysis',
    data_analysis: 'data_analysis',
    bi: 'data_analysis',
    数据: 'data_analysis',
    分析: 'data_analysis',
    数据分析: 'data_analysis',

    productivity: 'productivity',
    efficiency: 'productivity',
    workflow: 'productivity',
    automation: 'productivity',
    office: 'productivity',
    效率: 'productivity',
    效率提升: 'productivity',

    other: 'other',
    others: 'other',
    其他: 'other',
  };

  return aliases[normalized] ?? 'other';
}

export function emptySkillCategoryCounts(): SkillCategoryCounts {
  return {
    all: 0,
    development_tools: 0,
    content_creation: 0,
    data_analysis: 0,
    productivity: 0,
    other: 0,
  };
}
