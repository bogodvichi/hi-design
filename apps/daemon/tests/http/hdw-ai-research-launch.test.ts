import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAiResearchLaunch } from '../../src/http/hdw.js';
import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { ensureUedroSession } from '../../src/http/hik_logins/session-guard.js';

vi.mock('../../src/http/hik_logins/session-guard.js', () => ({
  ensureUedroSession: vi.fn(),
}));

describe('fetchAiResearchLaunch', () => {
  let dataDir = '';

  beforeEach(() => {
    vi.mocked(ensureUedroSession).mockReset().mockResolvedValue(null);
  });

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('forwards the device-bound OA session to the AI research launch service', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [
        { name: 'JwtToken', value: 'opaque-token', domain: 'oa.hikvision.com.cn' },
        { name: 'SESSION', value: 'opaque-session', domain: 'hicoo.hikvision.com.cn' },
      ],
      uedro: { cookies: [{ name: 'directory', value: 'opaque-directory', domain: 'uedro.hikvision.com.cn' }] },
    });
    const post = vi.fn().mockResolvedValue({
      launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F',
      expires_in: 60,
    });
    const handoff = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ensureUedroSession).mockResolvedValue([
      { name: 'directory', value: 'opaque-directory', domain: 'uedro.hikvision.com.cn' },
    ]);

    await expect(fetchAiResearchLaunch(dataDir, post, handoff)).resolves.toEqual({
      launchUrl: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F',
      expiresIn: 60,
    });
    expect(post).toHaveBeenCalledWith('/auth/ai-research/launch', {
      username: 'alice',
      oa_cookies: [
        { name: 'JwtToken', value: 'opaque-token' },
        { name: 'SESSION', value: 'opaque-session' },
      ],
    });
    expect(handoff).toHaveBeenCalledWith(
      'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F',
      [{ name: 'directory', value: 'opaque-directory', domain: 'uedro.hikvision.com.cn' }],
    );
  });

  it('obtains deferred directory cookies before requesting the short-lived launch ticket', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      uedro: { password: 'encrypted-deferred-credential' },
    });
    const cookies = [{ name: 'directory', value: 'fresh-directory', domain: 'uedro.hikvision.com.cn' }];
    let finishLogin!: (value: typeof cookies) => void;
    const pendingLogin = new Promise<typeof cookies>((resolve) => { finishLogin = resolve; });
    vi.mocked(ensureUedroSession).mockReturnValue(pendingLogin);
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque' });
    const handoff = vi.fn().mockResolvedValue(undefined);

    const launch = fetchAiResearchLaunch(dataDir, post, handoff);
    await vi.dynamicImportSettled();
    expect(ensureUedroSession).toHaveBeenCalledWith(dataDir);
    expect(post).not.toHaveBeenCalled();
    finishLogin(cookies);
    await expect(launch).resolves.toMatchObject({ expiresIn: 60 });
    expect(handoff).toHaveBeenCalledWith('https://drw.hikvision.com/api/auth/platform?ticket=opaque', cookies);
  });

  it('hands off refreshed cookies instead of the stale stored directory session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      uedro: { cookies: [{ name: 'directory', value: 'stale-directory' }] },
    });
    const freshCookies = [{ name: 'directory', value: 'fresh-directory', domain: 'uedro.hikvision.com.cn' }];
    vi.mocked(ensureUedroSession).mockResolvedValue(freshCookies);
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque' });
    const handoff = vi.fn().mockResolvedValue(undefined);

    await fetchAiResearchLaunch(dataDir, post, handoff);
    expect(handoff).toHaveBeenCalledWith('https://drw.hikvision.com/api/auth/platform?ticket=opaque', freshCookies);
  });

  it('preserves login when deferred directory login is unavailable', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, { username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }] });
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque' });
    const handoff = vi.fn();

    await expect(fetchAiResearchLaunch(dataDir, post, handoff)).resolves.toMatchObject({ expiresIn: 60 });
    expect(ensureUedroSession).toHaveBeenCalledWith(dataDir);
    expect(handoff).not.toHaveBeenCalled();
  });

  it('keeps login compatible when the device has no directory session', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, { username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }] });
    const post = vi.fn().mockResolvedValue(null);
    await fetchAiResearchLaunch(dataDir, post);
    expect(post).toHaveBeenCalledWith('/auth/ai-research/launch', {
      username: 'alice', oa_cookies: [{ name: 'oa', value: 'opaque' }],
    });
  });

  it('preserves login when the directory handoff fails without logging credentials', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }],
      uedro: { cookies: [{ name: 'directory', value: 'private-cookie' }] },
    });
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque' });
    const handoff = vi.fn().mockRejectedValue(new Error('private-cookie'));
    vi.mocked(ensureUedroSession).mockResolvedValue([{ name: 'directory', value: 'private-cookie', domain: 'uedro.hikvision.com.cn' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await fetchAiResearchLaunch(dataDir, post, handoff))?.launchUrl).toContain('/api/auth/platform');
      expect(warn).toHaveBeenCalledWith('[ai-research-directory] handoff unavailable');
    } finally { warn.mockRestore(); }
  });

  it('preserves login without logging credentials when deferred directory login throws', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-ai-research-launch-'));
    writeSsoConfigFile(dataDir, { username: 'Alice', cookies: [{ name: 'oa', value: 'opaque', domain: 'oa.hikvision.com.cn' }] });
    vi.mocked(ensureUedroSession).mockRejectedValue(new Error('private-credential'));
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque' });
    const handoff = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(fetchAiResearchLaunch(dataDir, post, handoff)).resolves.toMatchObject({ expiresIn: 60 });
      expect(handoff).not.toHaveBeenCalled();
      expect(warn.mock.calls).toEqual([['[ai-research-directory] handoff unavailable']]);
    } finally { warn.mockRestore(); }
  });
});
