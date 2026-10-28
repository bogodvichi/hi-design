import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handoffAiResearchDirectory } from '../../src/http/ai-research-directory.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), agent: vi.fn(), destroy: vi.fn(), end: vi.fn() }));
vi.mock('node:https', () => ({
  request: mocks.request,
  Agent: class {
    constructor(options: unknown) { mocks.agent(options); }
    destroy() { mocks.destroy(); }
  },
}));
const ticket = 'signed.login.ticket';
const launch = `https://drw.hikvision.com/api/auth/platform?ticket=${ticket}`;
const cookies = [{ name: 'directory', value: 'synthetic-cookie', domain: 'uedro.hikvision.com.cn' }];
let status = 200;
beforeEach(() => {
  vi.clearAllMocks(); status = 200;
  mocks.request.mockImplementation((_url, _options, onResponse) => {
    const request = new EventEmitter();
    Object.assign(request, { end(body: string) {
      mocks.end(body);
      const response = new EventEmitter();
      Object.assign(response, { statusCode: status, resume() { queueMicrotask(() => response.emit('end')); } });
      onResponse(response);
    } });
    return request;
  });
});

describe('AI research directory handoff transport', () => {
  it('uses the signed ticket only as backend authorization and strips cookie metadata', async () => {
    await handoffAiResearchDirectory(launch, cookies);
    expect(mocks.request).toHaveBeenCalledWith('https://drw.hikvision.com/api/auth/platform/directory', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: `Bearer ${ticket}` }),
    }), expect.any(Function));
    expect(JSON.parse(mocks.end.mock.calls[0]![0])).toEqual({ cookies: [{ name: 'directory', value: 'synthetic-cookie' }] });
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ rejectUnauthorized: true }));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it.each(['http://drw.hikvision.com/api/auth/platform', 'https://evil.test/api/auth/platform', 'https://drw.hikvision.com/other'])(
    'never forwards credentials to an unexpected callback %s', async url => {
      await expect(handoffAiResearchDirectory(`${url}?ticket=${ticket}`, cookies)).rejects.toThrow();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it('rejects redirects without sending credentials to another endpoint', async () => {
    status = 302;
    await expect(handoffAiResearchDirectory(launch, cookies)).rejects.toThrow('Directory handoff rejected');
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
