import { describe, expect, it, vi } from 'vitest';

import {
  encryptUplusPassword,
  fetchUplusAvatarOnLogin,
} from '../../src/integrations/uplus-profile.js';

describe('UPlus avatar enrichment during OA login', () => {
  it('matches the UPlus PBKDF2 and AES password protocol', () => {
    expect(encryptUplusPassword('example-password')).toBe(
      'r+ZmB1C/UdBbFSzOOoVETSl+/uac22IjTLq+jV4LBIo=',
    );
  });

  it('returns only the matching user avatar without exposing the UPlus token', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 1,
      data: {
        token: 'must-not-leave-this-response',
        list: [{
          user_name: 'Alice',
          avatar_url: '/uploads/avatar/alice.png',
        }],
      },
    }), { status: 200 }));

    await expect(fetchUplusAvatarOnLogin('alice', 'example-password', { request })).resolves.toEqual({
      ok: true,
      avatarUrl: 'http://uplus.hikvision.com.cn/uploads/avatar/alice.png',
    });

    expect(request).toHaveBeenCalledTimes(1);
    const init = request.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { username?: string; password?: string };
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(body.username).toBe('alice');
    expect(body.password).toBe(encryptUplusPassword('example-password'));
    expect(String(init?.body)).not.toContain('example-password');
  });

  it('fails closed when UPlus returns another user', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 1,
      data: {
        list: [{
          user_name: 'bob',
          avatar_url: 'https://assets.example/bob.jpg',
        }],
      },
    }), { status: 200 }));

    await expect(fetchUplusAvatarOnLogin('alice', 'example-password', { request }))
      .resolves.toEqual({ ok: false, reason: 'username_mismatch' });
  });

  it('keeps the UPlus business code for credential diagnostics', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: -1,
      data: null,
    }), { status: 200 }));

    await expect(fetchUplusAvatarOnLogin('alice', 'example-password', { request }))
      .resolves.toEqual({ ok: false, reason: 'business_error', businessCode: -1 });
  });

  it('uses the in-memory login token to fetch the complete profile when needed', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 1,
        data: {
          token: 'short-lived-uplus-token',
          list: [{ user_name: 'alice', avatar_url: null }],
        },
      }), {
        status: 200,
        headers: {
          'Set-Cookie': 'uplus_session=session-value; Path=/; HttpOnly',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 1,
        data: {
          list: [{
            user_name: 'alice',
            avatar_url: 'https://assets.example/alice-full.jpg',
          }],
        },
      }), { status: 200 }));

    await expect(fetchUplusAvatarOnLogin('alice', 'example-password', { request })).resolves.toEqual({
      ok: true,
      avatarUrl: 'https://assets.example/alice-full.jpg',
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe('http://uplus.hikvision.com.cn/api/v2/a/auth/userInfo');
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      auth: 'short-lived-uplus-token',
      Cookie: 'uplus_session=session-value',
      Referer: 'http://uplus.hikvision.com.cn/',
    });
  });

  it('rejects non-http avatar schemes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 1,
      data: {
        list: [{
          user_name: 'alice',
          avatar_url: 'javascript:alert(1)',
        }],
      },
    }), { status: 200 }));

    await expect(fetchUplusAvatarOnLogin('alice', 'example-password', { request })).resolves.toEqual({
      ok: true,
      avatarUrl: null,
    });
  });
});
