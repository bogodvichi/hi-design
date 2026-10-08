import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexModelCatalog } from '../../src/runtimes/codex-model-catalog.js';

const catalog = { models: [{ slug: 'test-model', base_instructions: 'native instructions',
  tools: ['shell'], future_metadata: { keep: true } }] };
let root: string;
let env: NodeJS.ProcessEnv;
let now: number;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'od-codex-catalog-'));
  env = { CODEX_HOME: path.join(root, 'home') };
  await mkdir(env.CODEX_HOME!);
  await writeFile(path.join(env.CODEX_HOME!, 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt', tokens: { access_token: 'test-token', account_id: 'test-account' },
  }));
  now = Date.now();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Codex model catalog launch snapshot', () => {
  it('requests compression and preserves complete native metadata without storing credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(catalog));
    const cache = new CodexModelCatalog(root, fetcher, () => now);
    const file = await cache.prepare(env, 'codex-cli 0.161.0', 'test-model');
    expect(file).toBeTruthy();
    expect(fetcher.mock.calls[0]?.[0]).toContain('client_version=0.161.0');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Accept-Encoding': 'gzip', Authorization: 'Bearer test-token' });
    expect(init.redirect).toBe('error');
    const stored = await readFile(file!, 'utf8');
    expect(JSON.parse(stored)).toEqual(catalog);
    expect(stored).not.toContain('test-token');
    // Another Codex version can replace its own cache without affecting this snapshot.
    await writeFile(path.join(env.CODEX_HOME!, 'models_cache.json'), '{"client_version":"0.155.0"}');
    expect(await cache.prepare(env, 'codex-cli 0.161.0', 'test-model')).toBe(file);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('separates CLI versions and accounts, and shares concurrent refreshes', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(catalog));
    const cache = new CodexModelCatalog(root, fetcher, () => now);
    const [first, concurrent] = await Promise.all([
      cache.prepare(env, '0.161.0'), cache.prepare(env, '0.161.0'),
    ]);
    expect(concurrent).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await cache.prepare(env, '0.162.0')).not.toBe(first);
    await writeFile(path.join(env.CODEX_HOME!, 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt', tokens: { access_token: 'other-token', account_id: 'other-account' },
    }));
    expect(await cache.prepare(env, '0.161.0')).not.toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refreshes a stale catalog without blocking a warm launch', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(catalog))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const cache = new CodexModelCatalog(root, fetcher, () => now);
    const first = await cache.prepare(env, '0.161.0');
    now += 301_000;
    expect(await cache.prepare(env, '0.161.0')).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    release(Response.json(catalog));
    await cache.waitForRefreshes();
  });

  it('does not supply an empty or incomplete catalog, or change API-key authentication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [] }))
      .mockResolvedValueOnce(Response.json(catalog));
    const cache = new CodexModelCatalog(root, fetcher, () => now);
    expect(await cache.prepare(env, '0.161.0')).toBeNull();
    now += 31_000;
    expect(await cache.prepare(env, '0.161.0', 'missing-model')).toBeNull();
    expect(await cache.prepare({ ...env, OPENAI_API_KEY: 'api-key' }, '0.161.0')).toBeNull();
    expect(await cache.prepare(env, '0.145.0')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains a last good snapshot on refresh failure, but never uses one older than a day', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValue(new Response('', { status: 503 }));
    const cache = new CodexModelCatalog(root, fetcher, () => now);
    const first = await cache.prepare(env, '0.161.0');
    now += 301_000;
    expect(await cache.prepare(env, '0.161.0')).toBe(first);
    await cache.waitForRefreshes();
    expect(await cache.prepare(env, '0.161.0')).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 86_400_001;
    expect(await cache.prepare(env, '0.161.0')).toBeNull();
  });
});
