import { resolveHdwAddress } from './hdw-constants.js';

/** Route HDW-owned covers and avatars through the active gateway, including cached URLs
 * that predate the server's public mount-prefix configuration. */
export function normalizeHdwCommunityImageUrl(value: string, kind: 'cover' | 'avatar'): string {
  const baseUrl = resolveHdwAddress().baseUrl;
  const hostname = new URL(baseUrl).hostname;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    if (url.hostname !== hostname && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return value;
    const match = url.pathname.match(/\/hdw\/api\/community\/(cover|blobs|avatar)\/([a-f0-9]{64})$/i);
    if (match && (kind === 'avatar' ? match[1]!.toLowerCase() === 'avatar' : match[1]!.toLowerCase() !== 'avatar')) {
      return `/api/hdw/api/community/${kind}/${match[2]!.toLowerCase()}`;
    }
  } catch { /* Preserve unrelated or malformed image URLs. */ }
  return value;
}

export function normalizeHdwCommunityCoverUrls(plugins: unknown[]): void {
  for (const value of plugins) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.coverUrl === 'string') entry.coverUrl = normalizeHdwCommunityImageUrl(entry.coverUrl, 'cover');
    const publisher = entry.publisher;
    if (publisher && typeof publisher === 'object') {
      const profile = publisher as Record<string, unknown>;
      if (typeof profile.avatarUrl === 'string') profile.avatarUrl = normalizeHdwCommunityImageUrl(profile.avatarUrl, 'avatar');
    }
  }
}
