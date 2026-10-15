// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HiMindWorkspaceFrame } from '../../src/components/HiMindWorkspaceFrame';
import { AiResearchWorkspaceFrame } from '../../src/components/AiResearchWorkspaceFrame';
import { dispatchCloseWorkspaceExternalTab } from '../../src/components/workspaceTabEvents';
import type { Route } from '../../src/router';

const auth = vi.hoisted(() => ({ username: 'alice' as string | null }));
vi.mock('../../src/auth/LoginGate', () => ({ useAuth: () => auth }));
const route: Route = { kind: 'external', resourceKey: 'himind', title: 'HiMind', url: 'https://himind.example/login' };
const requestId = '12345678-1234-4321-8123-123456789abc';
const request = { type: 'himind:directory-search:v1', requestId, query: '张三' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { auth.username = 'alice'; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup() {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/himind/launch'
      ? json({ launchUrl: 'https://himind.example/api/v1/auth/hidesign/callback?ticket=test', expiresIn: 60 })
      : json({ ok: true, data: { list: [] } }),
  );
  const view = render(<HiMindWorkspaceFrame route={route} />);
  await act(async () => {});
  const frame = view.getByTestId('himind-workspace-frame') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  function send(data: unknown = request, origin = 'https://himind.example', source: MessageEventSource | null = frame.contentWindow) {
    act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin, source })); });
  }
  return { ...view, frame, post, fetch, send };
}

describe('HiMind directory bridge v1', () => {
  it('queries the existing directory and only returns allowed fields and company emails', async () => {
    const { fetch, post, send } = await setup();
    fetch.mockResolvedValue(json({ ok: true, data: { list: [
      { name: '张三', email: ' zhangsan@hikvision.com ', userDeptPath: '研发', id: 'private-id', cookies: 'private' },
      { email: 'lisi@hikvision.com.cn' }, { email: 'wrong@hikvision.com.attacker.example' },
      { name: 'missing email' }, null,
    ] }, privateToken: 'private' }));
    send();
    await waitFor(() => expect(post).toHaveBeenCalledWith({
      type: 'hidesign:directory-search-result:v1', requestId, ok: true,
      people: [{ name: '张三', email: 'zhangsan@hikvision.com', userDeptPath: '研发' }, { email: 'lisi@hikvision.com.cn' }],
    }, 'https://himind.example'));
    expect(fetch).toHaveBeenLastCalledWith('/api/hik/uedro/userList', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ userName: '张三', pageNo: 1, pageSize: 30, expectedUsername: 'alice' }),
    }));
  });

  it('returns an empty array on a successful search with no matches', async () => {
    const { send, post } = await setup();
    send();
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: true, people: [] }, 'https://himind.example'));
  });

  it('limits the response to 30 people', async () => {
    const { fetch, send, post } = await setup();
    fetch.mockResolvedValue(json({ ok: true, data: { list: Array.from({ length: 40 }, (_, i) => ({ email: `person${i}@hikvision.com` })) } }));
    send();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![0].people).toHaveLength(30);
  });

  it('ignores foreign origins, sibling windows, unknown message types and invalid request IDs', async () => {
    const { fetch, send, post } = await setup();
    send(request, 'https://attacker.example');
    send(request, 'https://himind.example', window);
    send({ ...request, type: 'other' });
    send({ ...request, requestId: 'invalid' });
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'x'.repeat(81), null])('rejects invalid query %j without querying the directory', async (query) => {
    const { fetch, send, post } = await setup();
    send({ ...request, query });
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: false }, 'https://himind.example'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, { error: { message: 'private cookie' } }],
    [200, { ok: false, data: { list: [] } }],
    [200, { ok: true, data: {} }],
    [200, { ok: true, data: { list: null } }],
  ])('returns only failure for status %s and malformed/error bodies', async (status, body) => {
    const { fetch, send, post } = await setup();
    fetch.mockResolvedValue(json(body, status));
    send();
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: false }, 'https://himind.example'));
  });

  it('returns failure for network errors', async () => {
    const { fetch, send, post } = await setup();
    fetch.mockRejectedValue(new Error('private upstream detail'));
    send();
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: false }, 'https://himind.example'));
  });

  it('replies with failure before the five-second HiMind deadline', async () => {
    const { fetch, send, post } = await setup();
    vi.useFakeTimers();
    fetch.mockImplementation((_url, init) => new Promise((_done, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    send();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: false }, 'https://himind.example');
  });

  it('keeps request IDs correlated when replies arrive out of order', async () => {
    const { fetch, send, post } = await setup();
    const resolvers: Array<(response: Response) => void> = [];
    fetch.mockImplementation(() => new Promise((done) => { resolvers.push(done); }));
    const secondId = '87654321-1234-4321-8123-123456789abc';
    send();
    send({ ...request, requestId: secondId, query: '李四' });
    await act(async () => { resolvers[1]!(json({ ok: true, data: { list: [{ email: 'lisi@hikvision.com' }] } })); });
    await act(async () => { resolvers[0]!(json({ ok: true, data: { list: [] } })); });
    expect(post.mock.calls.map(([data]) => data.requestId)).toEqual([secondId, requestId]);
  });

  it('fails closed without a known OA identity', async () => {
    auth.username = null;
    const { fetch, send, post } = await setup();
    send();
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'hidesign:directory-search-result:v1', requestId, ok: false }, 'https://himind.example'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'identity'] as const)('discards a pending result after %s', async (change) => {
    const { fetch, send, post, rerender } = await setup();
    let resolve!: (value: Response) => void;
    fetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    send();
    const signal = fetch.mock.calls.at(-1)![1]!.signal!;
    act(() => {
      if (change === 'close') dispatchCloseWorkspaceExternalTab(route);
      else { auth.username = 'bob'; rerender(<HiMindWorkspaceFrame route={route} />); }
    });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(json({ ok: true, data: { list: [{ email: 'other@hikvision.com' }] } })); });
    expect(post).not.toHaveBeenCalled();
  });

  it('does not expose directory delegation to the AI research iframe', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const view = render(<AiResearchWorkspaceFrame route={{ kind: 'external', resourceKey: 'ai-research-workbench', title: 'AI', url: 'https://drw.example/' }} />);
    await act(async () => {});
    const frame = view.getByTestId('ai-research-workspace-frame') as HTMLIFrameElement;
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: request, origin: 'https://drw.example', source: frame.contentWindow })); });
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
