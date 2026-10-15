import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchHiMindLaunch } from '../../src/http/hdw.js';
import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';

describe('fetchHiMindLaunch', () => {
  let dataDir = '';

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('forwards the device-bound OA session in the request body', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-launch-'));
    writeSsoConfigFile(dataDir, {
      username: 'Alice',
      cookies: [
        { name: 'JwtToken', value: 'opaque-token', domain: 'oa.hikvision.com.cn' },
        { name: 'SESSION', value: 'opaque-session', domain: 'hicoo.hikvision.com.cn' },
      ],
    });
    const post = vi.fn().mockResolvedValue({
      launch_url: 'http://himind.example/api/v1/auth/hidesign/callback?ticket=opaque',
      expires_in: 60,
    });

    await expect(fetchHiMindLaunch(dataDir, post)).resolves.toEqual({
      launchUrl: 'http://himind.example/api/v1/auth/hidesign/callback?ticket=opaque',
      expiresIn: 60,
    });
    expect(post).toHaveBeenCalledWith('/auth/himind/launch', {
      username: 'alice',
      oa_cookies: [
        { name: 'JwtToken', value: 'opaque-token' },
        { name: 'SESSION', value: 'opaque-session' },
      ],
    });
  });

  it('forwards each launches parent origin alongside the OA identity', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-himind-origin-'));
    writeSsoConfigFile(dataDir, { username: 'Alice', cookies: [{ name: 'SESSION', value: 'opaque', domain: 'oa.example' }] });
    const post = vi.fn().mockResolvedValue({ launch_url: 'https://himind.example/callback?ticket=opaque', expires_in: 60 });
    for (const parentOrigin of ['http://127.0.0.1:50023', 'http://127.0.0.1:50123', 'https://design.example']) {
      // Added third argument preserves callers that inject the HTTP adapter.
      await fetchHiMindLaunch(dataDir, post, parentOrigin);
      expect(post).toHaveBeenLastCalledWith('/auth/himind/launch', {
        username: 'alice', oa_cookies: [{ name: 'SESSION', value: 'opaque' }], parent_origin: parentOrigin,
      });
    }
  });
});
