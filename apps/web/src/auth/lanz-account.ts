import { LANZ_DEFAULT_MODEL, LANZ_OPENAI_BASE_URL, type LanzAccountCredentials } from '@open-design/contracts';

/** Credentials stay out of the auth session, user-info payload and diagnostic logs. */
export async function loadLanzAccount(
  username: string,
  signal: AbortSignal,
): Promise<LanzAccountCredentials | null> {
  try {
    const response = await fetch('/api/auth/lanz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUsername: username }),
      cache: 'no-store',
      signal,
    });
    if (!response.ok || signal.aborted) return null;
    const data = await response.json();
    if (signal.aborted || data?.ok !== true
      || typeof data.username !== 'string'
      || data.username.toLowerCase() !== username.toLowerCase()
      || typeof data.apiKey !== 'string' || !data.apiKey.trim()) return null;
    return {
      ok: true,
      username: data.username,
      apiKey: data.apiKey.trim(),
      baseUrl: LANZ_OPENAI_BASE_URL,
      defaultModel: LANZ_DEFAULT_MODEL,
    };
  } catch {
    // The normal manual Key form remains usable if SSO or Lanz is unavailable.
    return null;
  }
}
