import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const digest = 'a'.repeat(64);
const proxyUrl = `/api/hdw/api/community/cover/${digest}`;
const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('HDW community cover routing', () => {
  it.each([
    ['development', '/hik-plugin/hidesign-web/hdw'],
    ['production', '/hik-plugin/hidesign-web-offical/hdw'],
    ['production', '/another-gateway/hdw'],
  ])('uses the active %s gateway %s when the server omits the prefix', async (mode, prefix) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('OD_HDW_PATH_PREFIX', prefix);
    const fetcher = vi.fn(async (_input: unknown) => Response.json({
      code: 0,
      data: { plugins: [{ name: 'project', coverUrl: `http://pixso.hikvision.com.cn/hdw/api/community/cover/${digest}` }] },
    }));
    vi.stubGlobal('fetch', fetcher);
    const { fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_URL } = await import('../../src/http/hdw.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'od-community-cover-'));
    tempDirs.push(dir);

    const text = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dir);

    expect(JSON.parse(text!).plugins[0].coverUrl).toBe(proxyUrl);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`https://pixso.hikvision.com.cn${prefix}/api/community/marketplace`);
  });

  it('normalizes returned covers, cloud digests, and local legacy digests together', async () => {
    const { fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_URL, writeCoverDigest } = await import('../../src/http/hdw.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'od-community-cover-'));
    tempDirs.push(dir);
    writeCoverDigest(dir, 'local', digest);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 0,
      data: { plugins: [
        { name: 'configured', coverUrl: `https://pixso.hikvision.com.cn/hik-plugin/hidesign-web-offical/hdw/api/community/cover/${digest}` },
        { name: 'loopback', coverUrl: `http://127.0.0.1:7002/hdw/api/community/cover/${digest}` },
        { name: 'relative', coverUrl: `/hdw/api/community/cover/${digest}` },
        { name: 'cloud', cover_digest: digest },
        { name: 'local' },
        { name: 'missing' },
        { name: 'external', coverUrl: 'https://images.example/cover.png' },
        { name: 'foreign', coverUrl: `https://images.example/hdw/api/community/cover/${digest}` },
      ] },
    })));

    const text = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dir);
    const plugins = JSON.parse(text!).plugins;

    expect(plugins.slice(0, 5).map((entry: { coverUrl: string }) => entry.coverUrl)).toEqual(Array(5).fill(proxyUrl));
    expect(plugins[5].coverUrl).toBeUndefined();
    expect(plugins[6].coverUrl).toBe('https://images.example/cover.png');
    expect(plugins[7].coverUrl).toBe(`https://images.example/hdw/api/community/cover/${digest}`);
  });
});
