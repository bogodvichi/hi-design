import express from 'express';
import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { closeDatabase, getProject, listWorkspaceProjects, openDatabase } from '../src/db.js';
import { getSharedSpaceTeamId } from '../src/ids.js';
import { ensureMarketplaceManifest } from '../src/plugins/marketplaces.js';
import { upsertInstalledPlugin } from '../src/plugins/registry.js';
import { registerPluginMarketplaceRoutes } from '../src/routes/plugins/marketplaces.js';

const tempRoots: string[] = [];

afterEach(async () => {
  closeDatabase();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function makeInstalledPlugin(root: string): Promise<InstalledPluginRecord> {
  const pluginRoot = path.join(root, 'square-deck');
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, 'index.html'),
    '<!doctype html><html><body><h1>Remixable</h1></body></html>',
    'utf8',
  );
  return {
    id: 'square-deck',
    title: 'Square deck',
    version: '1.0.0',
    sourceKind: 'local',
    source: 'test:local',
    trust: 'trusted',
    capabilitiesGranted: [],
    manifest: {
      name: 'square-deck',
      title: 'Square deck',
      version: '1.0.0',
      od: { preview: { entry: 'index.html' } },
    },
    fsPath: pluginRoot,
    installedAt: 1,
    updatedAt: 1,
  };
}

describe('HDW marketplace project remix', () => {
  it('creates a bound personal project and asks the project cover pipeline to run', async () => {
    const root = await makeTempRoot('od-marketplace-remix-');
    const dataDir = path.join(root, 'data');
    const db = openDatabase(root, { dataDir });
    const plugin = await makeInstalledPlugin(root);
    upsertInstalledPlugin(db, plugin);
    const seeded = ensureMarketplaceManifest(db, {
      id: 'hdw-community',
      url: 'https://hdw.example/community.json',
      trust: 'trusted',
      manifestText: JSON.stringify({
        specVersion: '1.0.0',
        name: 'hdw-community',
        version: '1.0.0',
        plugins: [
          {
            name: plugin.id,
            title: plugin.title,
            version: plugin.version,
            source: 'github:test/square-deck',
          },
        ],
      }),
    });
    if (!seeded.ok) throw new Error('marketplace fixture failed to seed');

    const triggerCoverForProjectEntry = vi.fn();
    const app = express();
    app.use(express.json());
    registerPluginMarketplaceRoutes(app, {
      db,
      bundledMarketplaceEntries: [],
      createMarketplaceFetcher: () => async () => ({
        ok: false,
        status: 500,
        text: async () => '',
      }),
      marketplaceRegistryIdFromUrl: () => null,
      dataDir,
      triggerCoverForProjectEntry,
    });
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/api/marketplaces/hdw-community/plugins/square-deck/remix`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok?: boolean;
        project?: { id?: string; name?: string; metadata?: { entryFile?: string } };
      };
      const projectId = body.project?.id;
      expect(body.ok).toBe(true);
      expect(projectId).toBeTruthy();
      expect(body.project?.name).toBe('Square deck');
      expect(body.project?.metadata?.entryFile).toBe('index.html');

      expect(triggerCoverForProjectEntry).toHaveBeenCalledTimes(1);
      expect(triggerCoverForProjectEntry).toHaveBeenCalledWith(
        projectId,
        {
          name: 'Square deck',
          metadata: expect.objectContaining({ entryFile: 'index.html' }),
        },
      );

      const project = getProject(db, projectId!);
      expect(project).toMatchObject({
        id: projectId,
        name: 'Square deck',
        metadata: { kind: 'prototype', entryFile: 'index.html' },
      });
      const workspaceProjects = listWorkspaceProjects(db, getSharedSpaceTeamId());
      expect(workspaceProjects).toHaveLength(1);
      expect(workspaceProjects[0]).toMatchObject({
        id: projectId,
        workspaceVisibility: 'personal',
        syncState: 'local_only',
      });
      expect(workspaceProjects[0]?.createdByWorkspaceMemberId).toBeTruthy();
    } finally {
      await close(server.server);
    }
  });
});


describe('HDW marketplace project preview', () => {
  async function createPreviewHarness(
    root: string,
    plugin: { name: string; title: string; version: string },
  ) {
    const dataDir = path.join(root, 'data');
    const db = openDatabase(root, { dataDir });
    const seeded = ensureMarketplaceManifest(db, {
      id: 'hdw-community',
      url: 'https://hdw.example/community.json',
      trust: 'trusted',
      manifestText: JSON.stringify({
        specVersion: '1.0.0',
        name: 'hdw-community',
        version: '1.0.0',
        plugins: [{
          name: plugin.name,
          title: plugin.title,
          version: plugin.version,
          source: 'github:test/community-preview',
        }],
      }),
    });
    if (!seeded.ok) throw new Error('marketplace preview fixture failed to seed');

    const cacheDir = path.join(dataDir, 'hdw-preview', plugin.name, plugin.version);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, '.extracted'), '1');

    const app = express();
    app.use(express.json());
    registerPluginMarketplaceRoutes(app, {
      db,
      bundledMarketplaceEntries: [],
      createMarketplaceFetcher: () => async () => ({
        ok: false,
        status: 500,
        text: async () => '',
      }),
      marketplaceRegistryIdFromUrl: () => null,
      dataDir,
    });

    return { cacheDir, server: await listen(app) };
  }

  it('serves project Markdown when the archive has no HTML entry', async () => {
    const root = await makeTempRoot('od-marketplace-preview-md-');
    const plugin = { name: 'trip-project', title: '霞浦国庆行程', version: '1.0.0' };
    const { cacheDir, server } = await createPreviewHarness(root, plugin);
    await writeFile(path.join(cacheDir, '霞浦国庆行程.md'), '# 霞浦国庆行程\n\n第一天：到达霞浦。', 'utf8');
    await writeFile(path.join(cacheDir, 'SKILL.md'), '# injected metadata', 'utf8');
    await writeFile(path.join(cacheDir, 'trip.pdf'), Buffer.from('%PDF-1.4 fake'));

    try {
      const response = await fetch(
        `${server.url}/api/marketplaces/hdw-community/plugins/${plugin.name}/preview`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      expect(decodeURIComponent(response.headers.get('x-open-design-preview-file') ?? ''))
        .toBe('霞浦国庆行程.md');
      expect(await response.text()).toContain('第一天：到达霞浦');
    } finally {
      await close(server.server);
    }
  });

  it('serves the PDF document preview when no HTML or Markdown exists', async () => {
    const root = await makeTempRoot('od-marketplace-preview-pdf-');
    const plugin = { name: 'pdf-project', title: 'PDF project', version: '1.0.0' };
    const { cacheDir, server } = await createPreviewHarness(root, plugin);
    await writeFile(path.join(cacheDir, 'report.pdf'), Buffer.from('%PDF-1.4 fake'));

    try {
      const response = await fetch(
        `${server.url}/api/marketplaces/hdw-community/plugins/${plugin.name}/preview`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(decodeURIComponent(response.headers.get('x-open-design-preview-file') ?? ''))
        .toBe('report.pdf');
      const body = await response.json() as {
        kind?: string;
        title?: string;
        sections?: Array<{ title?: string; lines?: string[] }>;
      };
      expect(body.kind).toBe('pdf');
      expect(body.title).toBe('report.pdf');
      expect(body.sections?.length).toBeGreaterThan(0);
    } finally {
      await close(server.server);
    }
  });
});

async function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
