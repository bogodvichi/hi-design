export interface CommunitySkillSearchDocument {
  title?: string | null;
  localId?: string | null;
  description?: string | null;
  publisherName?: string | null;
  sourceLabel?: string | null;
}

function normalizeCommunitySkillSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[._/\\-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function communitySkillMatchesQuery(
  skill: CommunitySkillSearchDocument,
  query: string,
): boolean {
  const terms = normalizeCommunitySkillSearchText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalizeCommunitySkillSearchText([
    skill.title,
    skill.localId,
    skill.description,
    skill.publisherName,
    skill.sourceLabel,
  ].filter(Boolean).join(' '));

  return terms.every((term) => haystack.includes(term));
}
