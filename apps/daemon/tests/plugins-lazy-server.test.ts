import { afterAll, beforeAll, expect, it } from 'vitest';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startServer, type StartServerResult } from '../src/server.js';

let started: StartServerResult;
let db: Database.Database;
const registered = () => db.prepare("SELECT id FROM installed_plugins WHERE source_kind = 'bundled' ORDER BY id").all();

beforeAll(async () => {
  started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
  db = new Database(path.join(process.env.OD_DATA_DIR!, 'app.sqlite'), { readonly: true });
});

afterAll(async () => {
  db?.close();
  await started?.shutdown?.();
  if (started) await new Promise<void>((resolve) => started.server.close(() => resolve()));
});

it('serves health and the full catalog without registration, then activates only the referenced template', async () => {
  expect(registered()).toEqual([]);
  expect((await fetch(`${started.url}/api/health`)).ok).toBe(true);
  expect(registered()).toEqual([]);
  const catalog = await fetch(`${started.url}/api/plugins`);
  expect(catalog.ok).toBe(true);
  const { plugins } = await catalog.json() as { plugins: Array<{ id: string; sourceKind: string }> };
  expect(plugins).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'example-dashboard', sourceKind: 'bundled' }),
    expect.objectContaining({ id: 'example-simple-deck', sourceKind: 'bundled' }),
  ]));
  expect(registered()).toEqual([]);
  const preview = await fetch(`${started.url}/api/plugins/example-dashboard/example/example`);
  expect(preview.ok).toBe(true);
  expect(await preview.text()).toContain('<html');
  expect(registered()).toEqual([{ id: 'example-dashboard' }]);
  const created = await fetch(`${started.url}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'lazy-template', name: 'Lazy template', pluginId: 'example-dashboard' }),
  });
  expect(created.ok, await created.text()).toBe(true);
  expect(registered()).toEqual([{ id: 'example-dashboard' }]);
  const marketplaces = await fetch(`${started.url}/api/marketplaces`);
  expect(marketplaces.ok).toBe(true);
  await marketplaces.arrayBuffer();
  expect(registered()).toEqual([{ id: 'example-dashboard' }]);
}, 30_000);
