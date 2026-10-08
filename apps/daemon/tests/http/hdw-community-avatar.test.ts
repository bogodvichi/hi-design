import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeSsoConfigFile } from '../../src/http/hik_logins/hicoo.js';
import { syncHdwCommunityAvatar } from '../../src/http/hdw.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

describe('syncHdwCommunityAvatar', () => {
  let dataDir = '';

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('uploads image bytes and records a shared publisher profile', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-community-avatar-'));
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa_session', value: 'opaque', domain: 'sso.hikvision.com' }],
      loginAt: Date.now(),
    });
    const putRaw = vi.fn(async () => true);
    const post = vi.fn(async () => ({ synced: true }));

    const synced = await syncHdwCommunityAvatar(
      dataDir,
      'Alice',
      'https://assets.example/alice.png',
      {
        fetchAvatar: vi.fn(async () => new Response(PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })),
        putRaw,
        post,
      },
    );

    expect(synced).toBe(true);
    expect(putRaw).toHaveBeenCalledWith(
      expect.stringMatching(/^\/community\/blobs\/[0-9a-f]{64}$/),
      PNG,
      expect.arrayContaining([ expect.objectContaining({ name: 'oa_session' }) ]),
    );
    expect(post).toHaveBeenCalledWith(
      '/community/publishers/alice/avatar',
      expect.objectContaining({
        avatarDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        oa_cookies: [{ name: 'oa_session', value: 'opaque' }],
      }),
      expect.arrayContaining([ expect.objectContaining({ name: 'oa_session' }) ]),
    );
  });

  it('does not persist non-image responses', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-community-avatar-'));
    writeSsoConfigFile(dataDir, {
      username: 'alice',
      cookies: [{ name: 'oa_session', value: 'opaque', domain: 'sso.hikvision.com' }],
      loginAt: Date.now(),
    });
    const putRaw = vi.fn(async () => true);
    const post = vi.fn(async () => ({ synced: true }));

    const synced = await syncHdwCommunityAvatar(
      dataDir,
      'alice',
      'https://assets.example/not-an-image',
      {
        fetchAvatar: vi.fn(async () => new Response('<html>login</html>', { status: 200 })),
        putRaw,
        post,
      },
    );

    expect(synced).toBe(false);
    expect(putRaw).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
