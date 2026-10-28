import { describe, expect, it, vi } from 'vitest';

import type { RawRequestOptions, RawResult } from '../../src/http/http.js';
import {
  createUedroLaunchUrl,
  isUedroTicketUrl,
  normalizeUedroLaunchTarget,
} from '../../src/http/hik_logins/uedro.js';

const COOKIES = [
  { name: 'EPORTAL_JSESSIONID', value: 'opaque', domain: 'uedro.hikvision.com.cn' },
];
const TARGET = 'https://uedro.hikvision.com.cn/uedro/ux?id=manuscript-1';
const TICKET_URL = `${TARGET}&ticket=ST-123456`;

describe('createUedroLaunchUrl', () => {
  it('asks CAS for a ticket and stops before consuming it', async () => {
    const request = vi.fn(async (
      _method: string,
      _url: string,
      _cookies: typeof COOKIES,
      opts?: RawRequestOptions,
    ): Promise<RawResult> => {
      expect(opts?.stopRedirect?.(TICKET_URL, TARGET, 302)).toBe(true);
      return {
        finalUrl: TICKET_URL,
        body: '',
        status: 302,
        cookies: COOKIES,
      };
    });

    await expect(createUedroLaunchUrl(COOKIES, TARGET, request)).resolves.toBe(TICKET_URL);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('GET');
    expect(request.mock.calls[0]?.[1]).toBe(
      `https://uedro.hikvision.com.cn/portal/cas/login?service=${encodeURIComponent(TARGET)}`,
    );
  });

  it('rejects a response without a ticket for the requested page', async () => {
    const request = vi.fn(async (): Promise<RawResult> => ({
      finalUrl: 'https://uedro.hikvision.com.cn/uedro/ux?id=other&ticket=ST-123456',
      body: '',
      status: 302,
      cookies: COOKIES,
    }));

    await expect(createUedroLaunchUrl(COOKIES, TARGET, request)).rejects.toThrow(
      'uedro login ticket could not be issued',
    );
  });
});

describe('UEDRO launch targets', () => {
  it('defaults to the official review home without a trailing slash', () => {
    expect(normalizeUedroLaunchTarget()).toBe('https://uedro.hikvision.com.cn/uedro/home');
  });

  it('accepts allowed pages and rejects all other origins or paths', () => {
    expect(normalizeUedroLaunchTarget(TARGET)).toBe(TARGET);
    const htmlTarget = 'https://uedro.hikvision.com.cn/uedro/html?id=ac1c03d94fc14529b22f1654e338d7ff&projectid=null&projName=&projManager=null';
    expect(normalizeUedroLaunchTarget(htmlTarget)).toBe(htmlTarget);
    expect(normalizeUedroLaunchTarget('https://uedro.hikvision.com.cn/uedro/admin')).toBeNull();
    expect(normalizeUedroLaunchTarget('https://uedro.hikvision.com.cn.evil.example/uedro/home')).toBeNull();
    expect(normalizeUedroLaunchTarget('http://uedro.hikvision.com.cn/uedro/home')).toBeNull();
  });

  it('requires the service ticket to match the requested page and parameters', () => {
    expect(isUedroTicketUrl(TICKET_URL, TARGET)).toBe(true);
    expect(isUedroTicketUrl(TARGET, TARGET)).toBe(false);
    expect(isUedroTicketUrl(
      'https://uedro.hikvision.com.cn/uedro/ux?ticket=ST-123456',
      TARGET,
    )).toBe(false);
  });
});
