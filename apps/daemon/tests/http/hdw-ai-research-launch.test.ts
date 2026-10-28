import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAiResearchLaunch } from '../../src/http/hdw.js';
import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';

describe('fetchAiResearchLaunch', () => {
  let dataDir = '';

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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await fetchAiResearchLaunch(dataDir, post, handoff))?.launchUrl).toContain('/api/auth/platform');
      expect(warn).toHaveBeenCalledWith('[ai-research-directory] handoff unavailable');
    } finally { warn.mockRestore(); }
  });
});
