import { describe, expect, it, vi } from 'vitest';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';
import { configureHdwSession, hdwSessionIdentity, type HdwSession } from '../../src/http/hdw-session.js';
import { fetchSharedSpaceInfo, fetchSharedWithMe, fetchResourcesSharedWithMe } from '../../src/http/hdw.js';
import { createCollabCloudClient } from '../../src/integrations/collab-cloud.js';
import { readHdwCloudConfig } from '../../src/integrations/hdw-cloud.js';

vi.mock('../../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => ({ username: 'alice', cookies: [{ name: 'session', value: 'fake' }] }),
  readSsoUsername: () => 'alice',
}));

describe('HDW authenticated transport', () => {
  it('authenticates HDW comments without sending OA sessions to custom comment services', async () => {
    configureHdwSession(() => ({ username: 'alice', cookies: [{ name: 'session', value: 'fake' }] }));
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(init!);
      return new Response(JSON.stringify({ members: [] }));
    });
    try {
      await createCollabCloudClient({ config: readHdwCloudConfig()!, fetch }).listMembers('team');
      await createCollabCloudClient({ config: { baseUrl: 'https://custom.invalid', token: null }, fetch }).listMembers('team');
      expect(new Headers(requests[0]!.headers).get('x-hdw-username')).toBe('alice');
      expect(new Headers(requests[1]!.headers).has('x-hdw-oa-session')).toBe(false);
      expect(requests.every(request => request.redirect === 'error')).toBe(true);
    } finally { configureHdwSession(() => null); }
  });
  it('authenticates project, Skill and MCP share lists even when callers supply no Cookie header', async () => {
    let session: HdwSession | null = { username: 'alice', cookies: [{ name: 'session', value: 'fake-alice' }] };
    configureHdwSession(() => session);
    const requests: RequestInit[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push(init!);
      return new Response(JSON.stringify({ code: 0, data: { projects: [], resources: [] } }));
    });
    try {
      await fetchSharedWithMe('/isolated');
      await fetchResourcesSharedWithMe('/isolated', 'skill');
      session = { username: 'bob', cookies: [{ name: 'session', value: 'fake-bob' }] };
      await fetchResourcesSharedWithMe('/isolated', 'mcp');
      const headers = requests.map(request => new Headers(request.headers));
      expect(headers.map(header => header.get('x-hdw-username'))).toEqual(['alice', 'alice', 'bob']);
      expect(headers.map(header => JSON.parse(Buffer.from(header.get('x-hdw-oa-session')!, 'base64').toString()))).toEqual([
        [{ name: 'session', value: 'fake-alice' }],
        [{ name: 'session', value: 'fake-alice' }],
        [{ name: 'session', value: 'fake-bob' }],
      ]);
      expect(headers.every(header => !header.has('cookie'))).toBe(true);
    } finally {
      configureHdwSession(() => null);
      fetch.mockRestore();
    }
  });
  it('does not manufacture an authorized personal identity when the directory is unavailable', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    try {
      await expect(fetchSharedSpaceInfo('/isolated')).rejects.toThrow();
    } finally { fetch.mockRestore(); }
  });
  it('partitions authority caches by OA account and session rotation', () => {
    const alice = { username: 'alice', cookies: [{ name: 's', value: 'one' }] };
    expect(hdwSessionIdentity(alice)).not.toBe(hdwSessionIdentity({ ...alice, username: 'bob' }));
    expect(hdwSessionIdentity(alice)).not.toBe(hdwSessionIdentity({ ...alice, cookies: [{ name: 's', value: 'two' }] }));
    expect(hdwSessionIdentity(alice)).not.toContain('alice');
    expect(hdwSessionIdentity(null)).toBe('hdw:signed-out');
  });
  it('reads current account credentials on every JSON and blob request', async () => {
    let session: HdwSession | null = { username: 'alice', cookies: [{ name: 'session', value: 'fake-alice' }] };
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(init!);
      return new Response('{}', { status: 200 });
    });
    const client = createHdwCloudClient({ config: { baseUrl: 'https://isolated.invalid', pathPrefix: '/hdw', token: null }, fetch, readSession: () => session });
    await client.request('GET', '/api/team/my');
    session = { username: 'bob', cookies: [{ name: 'session', value: 'fake-bob' }] };
    await client.uploadBlob('team', 'digest', Buffer.from('test'));
    await client.downloadBlob('team', 'digest');
    session = null;
    await client.request('GET', '/api/team/my');
    const headers = requests.map(request => new Headers(request.headers));
    expect(headers.map(h => h.get('x-hdw-username'))).toEqual(['alice', 'bob', 'bob', null]);
    expect(headers[1]!.get('content-type')).toBe('application/octet-stream');
    expect(JSON.parse(Buffer.from(headers[1]!.get('x-hdw-oa-session')!, 'base64').toString())).toEqual([{ name: 'session', value: 'fake-bob' }]);
    expect(headers[3]!.has('x-hdw-oa-session')).toBe(false);
  });
});
