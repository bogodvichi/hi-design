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
    });
    const post = vi.fn().mockResolvedValue({
      launch_url: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F',
      expires_in: 60,
    });

    await expect(fetchAiResearchLaunch(dataDir, post)).resolves.toEqual({
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
  });
});
