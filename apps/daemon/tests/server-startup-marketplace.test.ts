import type { StartServerResult } from '../src/server.js';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_ID } from '../src/http/hdw.js';
import { startServer } from '../src/server.js';

vi.mock('../src/http/hdw.js', async (original) => ({
  ...await original<typeof import('../src/http/hdw.js')>(),
  fetchHdwMarketplaceManifestText: vi.fn(),
}));

let started: StartServerResult | undefined;
let startup: Promise<StartServerResult> | undefined;
let finishManifest: ((manifest: string | null) => void) | undefined;

afterEach(async () => {
  finishManifest?.(null);
  await startup;
  if (!started) return;
  await started.shutdown();
  started.server.closeAllConnections();
  await new Promise<void>(resolve => started!.server.close(() => resolve()));
});

it('serves login APIs while the optional community catalog is still downloading', async () => {
  let fetching!: () => void;
  const fetchStarted = new Promise<void>(resolve => { fetching = resolve; });
  vi.mocked(fetchHdwMarketplaceManifestText).mockImplementationOnce(() => {
    fetching();
    return new Promise(resolve => { finishManifest = resolve; });
  });
  startup = startServer({ port: 0, returnServer: true }).then(result => {
    started = result as StartServerResult;
    return started;
  });
  await fetchStarted;
  await Promise.resolve();
  expect(started, 'community download must not gate daemon readiness').toBeDefined();
  const health = await fetch(`${started!.url}/api/health`);
  expect(health.status).toBe(200);
  const auth = await fetch(`${started!.url}/api/auth/valid`);
  expect(await auth.json()).toMatchObject({ ok: false });

  const manifest = JSON.stringify({
    specVersion: '1.0.0',
    name: 'startup-community-fixture',
    version: '1.0.0',
    plugins: [{ name: 'startup-sample', source: 'github:open-design/sample', version: '0.1.0' }],
  });
  // Opening Community during bootstrap must wait for its data, not return 404.
  const communityRequested = new Promise<void>(resolve => {
    started!.server.once('request', () => resolve());
  });
  const communityResponse = fetch(`${started!.url}/api/marketplaces/${HDW_MARKETPLACE_ID}/plugins`);
  await communityRequested;
  vi.mocked(fetchHdwMarketplaceManifestText).mockResolvedValueOnce(manifest);
  finishManifest!(manifest);
  const community = await communityResponse;
  expect(community.status).toBe(200);
  expect(await community.json()).toMatchObject({ plugins: [{ name: 'startup-sample' }] });
  const response = await fetch(`${started!.url}/api/marketplaces`);
  const body = await response.json() as { marketplaces: Array<{ id: string; manifest: { name: string } }> };
  expect(body.marketplaces).toContainEqual(expect.objectContaining({
    id: HDW_MARKETPLACE_ID,
    manifest: expect.objectContaining({ name: 'startup-community-fixture' }),
  }));
});
