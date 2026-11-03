import { resolveHdwAddress } from './hdw-constants.js';

/** Route HDW-owned covers through the active gateway, including cached URLs
 * that predate the server's public mount-prefix configuration. */
export function normalizeHdwCommunityCoverUrls(plugins: unknown[]): void {
  const baseUrl = resolveHdwAddress().baseUrl;
  const hostname = new URL(baseUrl).hostname;
  for (const value of plugins) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.coverUrl !== 'string') continue;
    try {
      const url = new URL(entry.coverUrl, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.hostname !== hostname && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) continue;
      const match = url.pathname.match(/\/hdw\/api\/community\/(?:cover|blobs)\/([a-f0-9]{64})$/i);
      if (match) entry.coverUrl = `/api/hdw/api/community/cover/${match[1]!.toLowerCase()}`;
    } catch { /* Preserve unrelated or malformed image URLs. */ }
  }
}
