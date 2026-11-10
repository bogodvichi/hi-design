export interface OpenDesignDiscordPresenceResponse {
  inviteCode: string;
  inviteUrl: string;
  onlineCount: number;
  memberCount: number;
  fetchedAt: number;
  stale: boolean;
}

/** Total uploaded bytes and expanded ZIP bytes allowed for one Skill. */
export const SKILL_UPLOAD_MAX_MB = 500;
export const SKILL_UPLOAD_MAX_BYTES = SKILL_UPLOAD_MAX_MB * 1024 * 1024;

/** Locate a Skill by its manifest name or Markdown frontmatter at any directory depth. */
export async function findSingleSkillEntry(
  paths: readonly string[],
  readMarkdown: (index: number) => Promise<string>,
): Promise<
  | { ok: true; index: number }
  | { ok: false; error: 'SKILL_MD_NOT_FOUND' | 'MULTIPLE_SKILLS' }
> {
  let index = -1;
  let markdownIndex = -1;
  let markdownCount = 0;
  for (let i = 0; i < paths.length; i++) {
    const name = paths[i]!.replace(/\\/g, '/');
    if (name.split('/').includes('__MACOSX') || !/\.md$/i.test(name)) continue;
    markdownIndex = i;
    markdownCount++;
    if (!/(^|\/)SKILL\.md$/i.test(name)) {
      const frontmatter = (await readMarkdown(i)).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if (!frontmatter || !/^name:[ \t]*\S/m.test(frontmatter)) continue;
    }
    if (index !== -1) return { ok: false, error: 'MULTIPLE_SKILLS' };
    index = i;
  }
  if (index === -1 && markdownCount === 1) index = markdownIndex;
  return index === -1 ? { ok: false, error: 'SKILL_MD_NOT_FOUND' } : { ok: true, index };
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

/** Publish an owned cloud Skill through POST /api/workspace/skills/:resourceId/share?scope=public. */
export interface PublishCloudSkillRequest {
  category: SkillCategory;
  logoKey?: string;
}

export interface PublishCloudSkillResponse {
  shared: boolean;
  version?: number | null;
}

/** Source identity for a public resource collected from another accessible workspace. */
export interface CloudResourceWorkspaceContext {
  homeWorkspaceId: string;
  homeWorkspaceMemberId: string;
  homeWorkspaceType: 'personal' | 'team';
  canManage: boolean;
}

export type SharedResourceKind = 'skill' | 'mcp';

/** A recipient-specific reference; shareId identifies access, resourceId identifies the original. */
export interface SharedWithMeResource {
  shareId: string;
  resourceId: string;
  kind: SharedResourceKind;
  homeWorkspaceId: string;
  sharedByUsername: string;
  sharedByDisplayname: string | null;
  sharedAt: string;
  ownerMemberId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** GET /api/resource-share/shared-with-me?kind=skill|mcp. */
export interface SharedWithMeResourcesResponse {
  resources: SharedWithMeResource[];
}

/** DELETE /api/resource-share/shared-with-me/:shareId?kind=skill|mcp. */
export interface RemoveSharedWithMeResourceResponse {
  ok: boolean;
}

export type SkillCategoryFilter = 'all' | SkillCategory;

/** Optional `sort` query on GET /api/workspace/skills/cloud; omitted preserves catalog order. */
export type CommunitySkillSort = 'popular' | 'updated';

export function isCommunitySkillSort(value: unknown): value is CommunitySkillSort {
  return value === 'popular' || value === 'updated';
}

/** Rank the complete merged catalog without changing its cached source order. Ties stay stable. */
export function sortCommunitySkills<T extends {
  peopleCount?: number | null;
  actionCount?: number | null;
  updatedAt?: string | null;
}>(skills: readonly T[], sort: CommunitySkillSort): T[] {
  return [...skills].sort((a, b) => sort === 'popular'
    ? (b.peopleCount ?? 0) - (a.peopleCount ?? 0) || (b.actionCount ?? 0) - (a.actionCount ?? 0)
    : (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0));
}

export type SkillCategoryCounts = Record<SkillCategoryFilter, number>;

/** Response from the Skill/MCP/tool cloud unpublish endpoints. */
export interface UnpublishCommunityResourceResponse {
  ok: boolean;
}

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
