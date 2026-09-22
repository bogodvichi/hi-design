function normalizeCommunitySearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[._/\\-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function communityTextMatchesQuery(
  fields: readonly unknown[],
  query: string,
): boolean {
  const terms = normalizeCommunitySearchText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeCommunitySearchText(fields.filter(Boolean).join(' '));
  return terms.every((term) => haystack.includes(term));
}
