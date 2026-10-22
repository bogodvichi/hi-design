import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUedroLaunchTicketUrl,
  resolveUedroLaunchUrl,
} from '../../src/components/uedroLaunch';

const TARGET = 'https://uedro.hikvision.com.cn/uedro/ux?id=manuscript-1';
const TICKET_URL = `${TARGET}&ticket=ST-123456`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveUedroLaunchUrl', () => {
  it('returns a validated daemon-issued ticket URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, launchUrl: TICKET_URL, expiresIn: 60 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveUedroLaunchUrl(TARGET)).resolves.toBe(TICKET_URL);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/uedro/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: TARGET }),
      cache: 'no-store',
    });
  });

  it.each([
    ['wrong origin', 'https://uedro.example/uedro/ux?id=manuscript-1&ticket=ST-123456'],
    ['missing ticket', TARGET],
    ['wrong manuscript', 'https://uedro.hikvision.com.cn/uedro/ux?id=other&ticket=ST-123456'],
    ['wrong page', 'https://uedro.hikvision.com.cn/uedro/home?ticket=ST-123456'],
  ])('falls back to the official page for a %s', async (_label, launchUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, launchUrl, expiresIn: 60 }),
    }));

    await expect(resolveUedroLaunchUrl(TARGET)).resolves.toBe(TARGET);
  });

  it('falls back to the official page when the daemon cannot issue a ticket', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: { message: 'failed' } }),
    }));

    await expect(resolveUedroLaunchUrl(TARGET)).resolves.toBe(TARGET);
  });

  it('rejects non-UEDRO targets', async () => {
    await expect(resolveUedroLaunchUrl('https://example.com/uedro/home')).resolves.toBeNull();
  });
});

describe('isUedroLaunchTicketUrl', () => {
  it('requires the requested page parameters to survive the CAS redirect', () => {
    expect(isUedroLaunchTicketUrl(TICKET_URL, TARGET)).toBe(true);
    expect(isUedroLaunchTicketUrl(
      'https://uedro.hikvision.com.cn/uedro/ux?ticket=ST-123456',
      TARGET,
    )).toBe(false);
  });
});
