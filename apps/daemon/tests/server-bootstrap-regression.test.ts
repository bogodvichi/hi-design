import type http from 'node:http';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isStaticSpaFallbackRequest,
  resolveDataDir,
  startServer,
  type StartServerResult,
} from '../src/server.js';

let server: http.Server;
let baseUrl: string;
let shutdown: (() => Promise<void> | void) | undefined;
let routeInventory: StartServerResult['routeInventory'];

beforeAll(async () => {
  const started = (await startServer({ port: 0, returnServer: true })) as StartServerResult;
  baseUrl = started.url;
  server = started.server;
  shutdown = started.shutdown;
  routeInventory = started.routeInventory;
});

afterAll(async () => {
  await Promise.resolve(shutdown?.());
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('project file request limits', () => {
  it('applies a small patch to a seven MiB file and rejects stale concurrent edits', async () => {
    const id = 'incremental-manual-edit';
    const json = { 'Content-Type': 'application/json' };
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: json,
      body: JSON.stringify({ id, name: 'Incremental edit', metadata: { kind: 'prototype' } }),
    });
    expect(created.ok).toBe(true);
    const original = `<html><body><p style="color:red">标题🙂</p><!--${'x'.repeat(7 * 1024 * 1024)}--></body></html>`;
    const url = `${baseUrl}/api/projects/${id}/files`;
    const seeded = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ name: 'large.html', content: original }) });
    expect(seeded.ok).toBe(true);
    await seeded.arrayBuffer();
    const body = JSON.stringify({
      name: 'large.html', versionSource: 'manual', versionLabel: 'Change text color',
      patch: { baseDigest: createHash('sha256').update(original).digest('hex'), edits: [{ start: original.indexOf('red'), deleteCount: 3, insert: 'blue' }] },
    });
    expect(Buffer.byteLength(body)).toBeLessThan(1024);
    const responses = await Promise.all([
      fetch(url, { method: 'POST', headers: json, body }),
      fetch(url, { method: 'POST', headers: json, body }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    for (const response of responses) await response.arrayBuffer();
    const reloaded = await fetch(`${url}/large.html`);
    expect(await reloaded.text()).toBe(original.replace('color:red', 'color:blue'));
    const currentEtag = `W/"od-text-${createHash('sha256').update(original.replace('color:red', 'color:blue')).digest('hex')}"`;
    const unchanged = await fetch(`${url}/large.html`, { headers: { 'If-None-Match': currentEtag } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    const changed = await fetch(`${url}/large.html`, { headers: { 'If-None-Match': `W/"od-text-${createHash('sha256').update(original).digest('hex')}"` } });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe(original.replace('color:red', 'color:blue'));
    const invalid = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({
      name: 'large.html', patch: {
        baseDigest: createHash('sha256').update(original.replace('color:red', 'color:blue')).digest('hex'),
        edits: [{ start: 0, deleteCount: original.length + 10, insert: '' }],
      },
    }) });
    expect(invalid.status).toBe(400);
    await invalid.arrayBuffer();
    expect(await (await fetch(`${url}/large.html`)).text()).toBe(original.replace('color:red', 'color:blue'));
    const versions = await fetch(`${url}/large.html/versions`);
    expect(((await versions.json()) as { versions: unknown[] }).versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'manual', label: 'Change text color', current: true }),
    ]));
  });

  it('saves and reloads a seven MiB HTML edit through the production file endpoint', async () => {
    const id = 'large-manual-edit-body';
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: 'Large manual edit', metadata: { kind: 'prototype' } }),
    });
    expect(created.ok).toBe(true);
    const content = `<!doctype html><html><body><p>Edited line</p><!--${'x'.repeat(7 * 1024 * 1024)}--></body></html>`;
    const saved = await fetch(`${baseUrl}/api/projects/${id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'large.html', content, versionSource: 'manual' }),
    });
    expect(saved.status).toBe(200);
    await saved.arrayBuffer();
    const reloaded = await fetch(`${baseUrl}/api/projects/${id}/files/large.html`);
    expect(reloaded.ok).toBe(true);
    expect(await reloaded.text()).toBe(content);
  });

  it('keeps the four MiB JSON limit on adjacent non-upload routes', async () => {
    const response = await fetch(`${baseUrl}/api/projects/large-manual-edit-body/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(4 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
    await response.arrayBuffer();
  });
});

describe('server route inventory', () => {
  it('does not register retired pet endpoints', () => {
    expect(routeInventory.some((route) => route.path.includes('/codex-pets'))).toBe(false);
  });

  it.each([
    ['GET', '/api/codex-pets'],
    ['POST', '/api/codex-pets/sync'],
    ['GET', '/api/codex-pets/example/spritesheet'],
  ])('returns 404 for retired %s %s', async (method, route) => {
    const response = await fetch(`${baseUrl}${route}`, { method });
    expect(response.status).toBe(404);
    await response.arrayBuffer();
  });

  it('records bootstrap and migrated domain routes in registration order', () => {
    const routeKeys = routeInventory.map((route) => `${route.method} ${route.path}`);
    const fallbackIndex = routeKeys.indexOf('GET /*splat');

    const automationRouteKeys = [
      'GET /api/automation-source-packets',
      'POST /api/automation-ingestions',
      'GET /api/automation-source-packets/:id',
      'GET /api/automation-proposals',
      'POST /api/automation-proposals',
      'GET /api/automation-proposals/:id',
      'POST /api/automation-proposals/:id/apply',
      'POST /api/automation-proposals/:id/reject',
    ];
    const velaRouteKeys = [
      'GET /api/amr/models',
      'GET /api/integrations/vela/status',
      'ALL /api/integrations/vela/api-proxy/*splat',
      'POST /api/integrations/vela/login',
      'POST /api/integrations/vela/login/cancel',
      'POST /api/integrations/vela/analytics-entry',
      'POST /api/integrations/vela/logout',
    ];
    const genuiRouteKeys = [
      'GET /api/runs/:runId/genui',
      'GET /api/projects/:projectId/genui',
      'POST /api/runs/:runId/genui/:surfaceId/respond',
      'POST /api/projects/:projectId/genui/:surfaceId/revoke',
      'POST /api/projects/:projectId/genui/prefill',
      'GET /api/runs/:runId/genui/:surfaceId',
      'GET /api/runs/:runId/devloop-iterations',
      'POST /api/runs/:runId/replay',
    ];
    const runRouteKeys = [
      'POST /api/runs',
      'GET /api/runs',
      'GET /api/runs/:id/result-package',
      'GET /api/runs/:id',
      'GET /api/runs/:id/events',
      'GET /api/runs/:id/agui',
      'POST /api/runs/:id/cancel',
      'POST /api/chat',
    ];
    const pluginEventRouteKeys = [
      'GET /api/plugins/events/snapshot',
      'GET /api/plugins/events/stats',
      'POST /api/plugins/events/purge',
      'GET /api/plugins/events',
    ];
  const pluginLifecycleRouteKeys = [
    'GET /api/plugins',
    'GET /api/plugins/stats',
    'GET /api/plugins/:id',
      'POST /api/plugins/upload-zip',
      'POST /api/plugins/upload-folder',
      'POST /api/plugins/install',
      'POST /api/plugins/:id/uninstall',
      'POST /api/plugins/:id/upgrade',
      'POST /api/plugins/:id/apply',
      'POST /api/plugins/:id/duplicate-project',
      'POST /api/plugins/:id/share-project',
      'POST /api/plugins/:id/doctor',
      'POST /api/plugins/:id/trust',
      'GET /api/applied-plugins/:snapshotId',
      'GET /api/applied-plugins/:snapshotId/canon',
      'GET /api/applied-plugins',
      'GET /api/projects/:projectId/applied-plugins',
      'POST /api/applied-plugins/export',
      'POST /api/applied-plugins/prune',
    ];
    const pluginAssetRouteKeys = [
      'GET /api/plugins/:id/preview',
      'GET /api/plugins/:id/example/:name',
      'GET /api/plugins/:id/asset/*splat',
      'GET /api/asset-cache',
    ];
    const marketplaceRouteKeys = [
      'GET /api/marketplaces',
      'POST /api/marketplaces',
      'GET /api/marketplaces/:id',
      'DELETE /api/marketplaces/:id',
      'POST /api/marketplaces/:id/refresh',
      'POST /api/marketplaces/:id/trust',
      'GET /api/marketplaces/:id/plugins',
    ];
    const projectPluginRouteKeys = [
      'POST /api/projects/:id/plugins/install-folder',
      'POST /api/projects/:id/plugins/publish-github',
      'GET /api/projects/:id/plugin-candidates',
      'POST /api/projects/:id/plugin-candidates/:candidateId/dismiss',
      'POST /api/projects/:id/plugin-candidates/:candidateId/draft',
      'POST /api/projects/:id/plugin-candidates/:candidateId/share-tasks',
      'POST /api/projects/:id/plugins/contribute-open-design',
      'POST /api/projects/:id/plugins/share-tasks',
      'POST /api/plugins/share-tasks/:id/wait',
    ];
    const liveArtifactRouteKeys = [
      'GET /api/live-artifacts',
      'OPTIONS /api/live-artifacts/:artifactId/preview',
      'GET /api/live-artifacts/:artifactId/preview',
      'GET /api/live-artifacts/:artifactId',
      'GET /api/live-artifacts/:artifactId/refreshes',
      'POST /api/tools/live-artifacts/create',
      'GET /api/tools/live-artifacts/list',
      'POST /api/tools/live-artifacts/update',
      'POST /api/tools/live-artifacts/refresh',
      'PATCH /api/live-artifacts/:artifactId',
      'DELETE /api/live-artifacts/:artifactId',
      'OPTIONS /api/live-artifacts/:artifactId/refresh',
      'POST /api/live-artifacts/:artifactId/refresh',
    ];
    const deployRouteKeys = [
      'GET /api/deploy/config',
      'PUT /api/deploy/config',
      'GET /api/deploy/cloudflare-pages/zones',
      'GET /api/projects/:id/deployments',
      'POST /api/projects/:id/deploy',
      'POST /api/projects/:id/deploy/preflight',
    ];
    const deploymentCheckRouteKeys = [
      'POST /api/projects/:id/deployments/:deploymentId/check-link',
    ];
    const projectFileStringRouteKeys = [
      'GET /api/projects/:id/files',
      'GET /api/projects/:id/search',
      'GET /api/projects/:id/files/:name/preview',
      'POST /api/projects/:id/files',
      'DELETE /api/projects/:id/files/:name',
    ];
    const projectArchiveRouteKeys = [
      'GET /api/projects/:id/archive',
      'POST /api/projects/:id/archive/batch',
    ];
    const projectTemplateAndArtifactRouteKeys = [
      'GET /api/projects/:id/tabs',
      'PUT /api/projects/:id/tabs',
      'GET /api/templates',
      'GET /api/templates/:id',
      'POST /api/templates',
      'DELETE /api/templates/:id',
      'POST /api/upload',
      'POST /api/artifacts/save',
      'POST /api/artifacts/lint',
      'POST /api/projects/:id/finalize/:provider',
      'POST /api/projects/:id/upload',
    ];
    const staticCatalogRouteKeys = [
      'GET /api/skills/:id/example',
      'GET /api/skills/:id/assets/*splat',
      'GET /api/atoms',
      'GET /api/atoms/:id',
    ];
    const mediaConfigRouteKeys = [
      'GET /api/media/models',
      'GET /api/media/providers/aihubmix/models',
      'GET /api/media/config',
      'PUT /api/media/config',
      'GET /api/media/providers/elevenlabs/voices',
      'GET /api/app-config',
      'PUT /api/app-config',
      'POST /api/dir-exists',
      'GET /api/recent-dirs',
      'GET /api/orbit/status',
      'POST /api/orbit/run',
      'POST /api/system/open-external',
      'POST /api/dialog/open-folder',
      'POST /api/projects/:id/media/hyperframes/scaffold',
      'POST /api/tools/media/hyperframes/scaffold',
      'POST /api/projects/:id/media/generate',
      'POST /api/tools/media/generate',
      'POST /api/research/search',
      'POST /api/media/tasks/:id/wait',
      'GET /api/projects/:id/media/tasks',
    ];
    // Website Clone agents use these project-scoped routes to ask the daemon
    // to launch system Chrome outside their process sandbox. This is also the
    // headless `od` CLI path, so it must remain registered without Electron.
    const browserSessionRouteKeys = [
      'POST /api/projects/:id/browser-sessions',
      'DELETE /api/projects/:id/browser-sessions/:sessionId',
    ];

    expect(routeKeys).toEqual(expect.arrayContaining([
      'GET /api/health',
      'GET /api/ready',
      'GET /api/version',
      'GET /api/daemon/status',
      'GET /api/skills',
      'GET /api/prompt-templates',
      'GET /*splat',
    ]));

    expect(routeKeys.filter((key) => automationRouteKeys.includes(key))).toEqual(automationRouteKeys);
    expect(routeKeys.filter((key) => velaRouteKeys.includes(key))).toEqual(velaRouteKeys);
    expect(routeKeys.filter((key) => genuiRouteKeys.includes(key))).toEqual(genuiRouteKeys);
    expect(routeKeys.filter((key) => runRouteKeys.includes(key))).toEqual(runRouteKeys);
    expect(routeKeys.filter((key) => pluginEventRouteKeys.includes(key))).toEqual(pluginEventRouteKeys);
    expect(routeKeys.filter((key) => pluginLifecycleRouteKeys.includes(key))).toEqual(pluginLifecycleRouteKeys);
    expect(routeKeys.filter((key) => pluginAssetRouteKeys.includes(key))).toEqual(pluginAssetRouteKeys);
    expect(routeKeys.filter((key) => marketplaceRouteKeys.includes(key))).toEqual(marketplaceRouteKeys);
    expect(routeKeys.filter((key) => projectPluginRouteKeys.includes(key))).toEqual(projectPluginRouteKeys);
    expect(routeKeys.filter((key) => liveArtifactRouteKeys.includes(key))).toEqual(liveArtifactRouteKeys);
    expect(routeKeys.filter((key) => deployRouteKeys.includes(key))).toEqual(deployRouteKeys);
    expect(routeKeys.filter((key) => deploymentCheckRouteKeys.includes(key))).toEqual(deploymentCheckRouteKeys);
    expect(routeKeys.filter((key) => projectFileStringRouteKeys.includes(key))).toEqual(projectFileStringRouteKeys);
    expect(routeKeys.filter((key) => projectArchiveRouteKeys.includes(key))).toEqual(projectArchiveRouteKeys);
    expect(routeKeys.filter((key) => projectTemplateAndArtifactRouteKeys.includes(key))).toEqual(projectTemplateAndArtifactRouteKeys);
    expect(routeKeys.filter((key) => /\/api\/(?:design-systems|brands)(?:\/|$)/.test(key))).toEqual([]);
    expect(routeKeys.filter((key) => staticCatalogRouteKeys.includes(key))).toEqual(staticCatalogRouteKeys);
    expect(routeKeys.filter((key) => mediaConfigRouteKeys.includes(key))).toEqual(mediaConfigRouteKeys);
    expect(routeKeys.filter((key) => browserSessionRouteKeys.includes(key))).toEqual(browserSessionRouteKeys);

    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(routeKeys.indexOf('GET /api/health')).toBeLessThan(fallbackIndex);
    expect(routeKeys.indexOf('POST /api/daemon/db/verify')).toBeLessThan(routeKeys.indexOf('GET /api/plugins/events/snapshot'));
    expect(routeKeys.indexOf('GET /api/plugins')).toBeLessThan(routeKeys.indexOf('GET /api/atoms'));
    expect(routeKeys.indexOf('GET /api/plugins/:id/preview')).toBeLessThan(fallbackIndex);
    expect(routeKeys.indexOf('GET /api/automation-source-packets')).toBeLessThan(
      routeKeys.indexOf('GET /api/skills'),
    );
    expect(routeKeys.indexOf('USE /artifacts')).toBeLessThan(routeKeys.indexOf('USE /frames'));
    expect(routeKeys.filter((key) => key === 'USE /artifacts')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'USE /frames')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'GET /api/plugins')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'GET /api/atoms')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'GET /api/design-systems/:id')).toHaveLength(0);
    expect(routeKeys.filter((key) => key === 'GET /api/design-systems/:id/preview')).toHaveLength(0);
    expect(routeKeys.filter((key) => key === 'POST /api/projects/:id/upload')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'POST /api/runs')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'POST /api/chat')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'POST /api/media/tasks/:id/wait')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'GET /api/marketplaces')).toHaveLength(1);
    expect(routeKeys.filter((key) => key === 'POST /api/projects/:id/plugins/share-tasks')).toHaveLength(1);
    for (const [index, key] of routeKeys.entries()) {
      if (key.includes(' /api/')) {
        expect(index, `${key} should register before SPA fallback`).toBeLessThan(fallbackIndex);
      }
    }
    expect(routeKeys.filter((key) => key === 'GET /api/skills')).toHaveLength(1);
  });
});

describe('bootstrap route regressions', () => {
  it('keeps health, ready, version, and daemon status available', async () => {
    const [health, ready, version, status] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/ready`),
      fetch(`${baseUrl}/api/version`),
      fetch(`${baseUrl}/api/daemon/status`),
    ]);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(version.status).toBe(200);
    expect(status.status).toBe(200);
  });

  it('keeps lightweight extracted-route responses stable without fixtures', async () => {
    const [
      automationList,
      automationMissing,
      velaProxyUnknownPath,
      genuiRunList,
      genuiRunSurfaceMissing,
      devloopIterations,
      replayMissingSnapshot,
    ] = await Promise.all([
      fetch(`${baseUrl}/api/automation-source-packets`),
      fetch(`${baseUrl}/api/automation-source-packets/missing-packet`),
      fetch(`${baseUrl}/api/integrations/vela/api-proxy/not-api-v1`),
      fetch(`${baseUrl}/api/runs/missing-run/genui`),
      fetch(`${baseUrl}/api/runs/missing-run/genui/missing-surface`),
      fetch(`${baseUrl}/api/runs/missing-run/devloop-iterations`),
      fetch(`${baseUrl}/api/runs/missing-run/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ]);

    expect(automationList.status).toBe(200);
    expect(await automationList.json()).toEqual({ packets: [] });

    expect(automationMissing.status).toBe(404);
    expect(await automationMissing.json()).toEqual({ error: 'automation source packet not found' });

    expect(velaProxyUnknownPath.status).toBe(404);
    expect(await velaProxyUnknownPath.json()).toEqual({ error: 'unknown_amr_api_proxy_path' });

    expect(genuiRunList.status).toBe(404);
    expect(await genuiRunList.json()).toEqual({ error: 'run not found' });

    expect(genuiRunSurfaceMissing.status).toBe(404);
    expect(await genuiRunSurfaceMissing.json()).toEqual({ error: 'run not found' });

    expect(devloopIterations.status).toBe(404);
    expect(await devloopIterations.json()).toEqual({ error: 'run not found' });

    expect(replayMissingSnapshot.status).toBe(404);
    expect(await replayMissingSnapshot.json()).toEqual({ error: 'run not found' });
  });

});

describe('static SPA fallback classification', () => {
  const makeReq = (path: string, method = 'GET', accept = 'text/html') => ({
    method,
    path,
    get: (name: string) => (name.toLowerCase() === 'accept' ? accept : ''),
  });

  it('does not classify API, artifacts, frames, or _next requests as SPA fallbacks', () => {
    expect(isStaticSpaFallbackRequest(makeReq('/api/projects') as never)).toBe(false);
    expect(isStaticSpaFallbackRequest(makeReq('/artifacts/x') as never)).toBe(false);
    expect(isStaticSpaFallbackRequest(makeReq('/frames/x') as never)).toBe(false);
    expect(isStaticSpaFallbackRequest(makeReq('/_next/static/app.js') as never)).toBe(false);
  });

  it('requires a GET or HEAD request with an HTML-compatible Accept header', () => {
    expect(isStaticSpaFallbackRequest(makeReq('/workspace') as never)).toBe(true);
    expect(isStaticSpaFallbackRequest(makeReq('/workspace', 'HEAD') as never)).toBe(true);
    expect(isStaticSpaFallbackRequest(makeReq('/workspace', 'POST') as never)).toBe(false);
    expect(isStaticSpaFallbackRequest(makeReq('/workspace', 'GET', 'application/json') as never)).toBe(false);
  });
});

describe('daemon data dir resolver', () => {
  it('requires explicit OD_DATA_DIR in sandbox mode and resolves project-relative dirs', () => {
    expect(() => resolveDataDir('', '/tmp/open-design-test', { requireExplicit: true })).toThrow(
      /OD_DATA_DIR is required/,
    );
    expect(resolveDataDir('relative-data', '/tmp/open-design-test')).toBe('/tmp/open-design-test/relative-data');
  });
});

it('does not register retired design-system or brand endpoints', () => {
  expect(routeInventory.filter(({ path }) =>
    path.includes('design-system') || /\/api\/brands(?:\/|$)/.test(path),
  )).toEqual([]);
});
