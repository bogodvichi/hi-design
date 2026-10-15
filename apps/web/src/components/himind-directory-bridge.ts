import type { HiMindDirectoryPerson, HiMindDirectorySearchRequest, HiMindDirectorySearchResult, UedroUserListRequest } from '@open-design/contracts';

/** Called only after the frame owner verifies both message origin and source. */
export async function handleHiMindDirectoryMessage(event: MessageEvent, username: string | null, lifetime: AbortSignal): Promise<void> {
  const data = event.data as Partial<HiMindDirectorySearchRequest> | null;
  if (data?.type !== 'himind:directory-search:v1' || typeof data.requestId !== 'string'
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(data.requestId)) return;
  const target = event.source as Window;
  const base = { type: 'hidesign:directory-search-result:v1' as const, requestId: data.requestId };
  const reply = (result: HiMindDirectorySearchResult) => {
    if (!lifetime.aborted) target.postMessage(result, event.origin);
  };
  const query = typeof data.query === 'string' ? data.query.trim() : '';
  if (!username || !query || query.length > 80) { reply({ ...base, ok: false }); return; }

  const timeout = new AbortController();
  // Leave time for HiMind's five-second response deadline.
  const timer = setTimeout(() => timeout.abort(), 4_000);
  try {
    const body: UedroUserListRequest = { userName: query, pageNo: 1, pageSize: 30, expectedUsername: username };
    const response = await fetch('/api/hik/uedro/userList', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.any([lifetime, timeout.signal]),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.data?.list)) {
      reply({ ...base, ok: false });
      return;
    }
    const people: HiMindDirectoryPerson[] = [];
    for (const person of payload.data.list) {
      const email = typeof person?.email === 'string' ? person.email.trim() : '';
      if (!/^[^\s@]+@hikvision\.com(?:\.cn)?$/i.test(email)) continue;
      people.push({
        email,
        ...(typeof person.name === 'string' ? { name: person.name } : {}),
        ...(typeof person.userDeptPath === 'string' ? { userDeptPath: person.userDeptPath } : {}),
      });
      if (people.length === 30) break;
    }
    reply({ ...base, ok: true, people });
  } catch {
    reply({ ...base, ok: false });
  } finally {
    clearTimeout(timer);
  }
}
