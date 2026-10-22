import type { UedroLaunchResponse } from '@open-design/contracts';
import { parseAllowedUedroPageUrl } from './reviewMeta';

/** Validate the daemon-issued URL before handing it to the operating system. */
export function isUedroLaunchTicketUrl(value: unknown, targetUrl: string): value is string {
  if (typeof value !== 'string') return false;
  const target = parseAllowedUedroPageUrl(targetUrl);
  if (!target) return false;
  try {
    const actual = new URL(value);
    if (
      actual.protocol !== 'https:'
      || actual.origin !== target.origin
      || actual.pathname !== target.pathname
      || actual.username
      || actual.password
      || actual.hash
    ) {
      return false;
    }
    const ticket = actual.searchParams.getAll('ticket');
    if (
      ticket.length !== 1
      || !ticket[0]?.startsWith('ST-')
      || ticket[0].length <= 3
      || actual.searchParams.size !== target.searchParams.size + 1
    ) {
      return false;
    }
    for (const [key] of target.searchParams) {
      const expectedValues = target.searchParams.getAll(key);
      const actualValues = actual.searchParams.getAll(key);
      if (
        actualValues.length !== expectedValues.length
        || actualValues.some((value, index) => value !== expectedValues[index])
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a one-time browser launch URL. If the daemon cannot mint a ticket,
 * open the requested official UEDRO page directly so the user can sign in.
 */
export async function resolveUedroLaunchUrl(targetUrl: string): Promise<string | null> {
  const target = parseAllowedUedroPageUrl(targetUrl);
  if (!target) return null;
  const fallbackUrl = target.toString();
  try {
    const response = await fetch('/api/auth/uedro/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: fallbackUrl }),
      cache: 'no-store',
    });
    if (!response.ok) return fallbackUrl;
    const body = (await response.json().catch(() => null)) as Partial<UedroLaunchResponse> | null;
    return body?.ok === true && isUedroLaunchTicketUrl(body.launchUrl, fallbackUrl)
      ? body.launchUrl
      : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}
