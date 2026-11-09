import express from 'express';
import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { closeDatabase, getProject, listWorkspaceProjects, openDatabase } from '../src/db.js';
import { getSharedSpaceTeamId } from '../src/ids.js';
import { ensureMarketplaceManifest } from '../src/plugins/marketplaces.js';
import { upsertInstalledPlugin } from '../src/plugins/registry.js';
import { registerPluginMarketplaceRoutes } from '../src/routes/plugins/marketplaces.js';

const tempRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
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
  it.each(['', '?username=alice'])('repairs cached cover and avatar URLs when the catalog is offline%s', async (query) => {
    const root = await makeTempRoot('od-marketplace-cached-cover-');
    const dataDir = path.join(root, 'data');
    const db = openDatabase(root, { dataDir });
    const digest = 'a'.repeat(64);
    const seeded = ensureMarketplaceManifest(db, {
      id: 'hdw-community',
      url: 'https://hdw.example/community.json',
      trust: 'trusted',
      manifestText: JSON.stringify({
        specVersion: '1.0.0', name: 'hdw-community', version: '1.0.0',
        plugins: [{
          name: 'cached-project', version: '1.0.0', source: 'github:test/project',
          publisher: { id: 'alice', avatarUrl: `http://pixso.hikvision.com.cn/hdw/api/community/avatar/${digest}` },
          coverUrl: `http://pixso.hikvision.com.cn/hdw/api/community/cover/${digest}`,
        }],
      }),
    });
    if (!seeded.ok) throw new Error('marketplace fixture failed to seed');
    const nativeFetch = globalThis.fetch;
    const fetcher: typeof fetch = (input, init) => String(input).startsWith('https://pixso.hikvision.com.cn/')
      ? Promise.resolve(Response.json({ code: -1 }, { status: 503 }))
      : nativeFetch(input, init);
    vi.stubGlobal('fetch', fetcher);
    const app = express();
    registerPluginMarketplaceRoutes(app, {
      db, dataDir, bundledMarketplaceEntries: [],
      createMarketplaceFetcher: () => async () => ({ ok: false, status: 503, text: async () => '' }),
      marketplaceRegistryIdFromUrl: () => null,
    });
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/api/marketplaces/hdw-community/plugins${query}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { plugins: Array<{ coverUrl?: string; publisher?: { avatarUrl?: string } }> };
      expect(body.plugins[0]?.coverUrl)
        .toBe(`/api/hdw/api/community/cover/${digest}`);
      expect(body.plugins[0]?.publisher?.avatarUrl)
        .toBe(`/api/hdw/api/community/avatar/${digest}`);
    } finally {
      await close(server.server);
    }
  });

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

  it.each(['', 'open-design.json', 'DESIGN-MANIFEST.json'])('serves DOCX contents using the archive entry: %s', async (manifestName) => {
    const root = await makeTempRoot('od-marketplace-preview-docx-');
    const plugin = { name: 'document-project', title: 'Document project', version: '1.0.0' };
    const { cacheDir, server } = await createPreviewHarness(root, plugin);
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>社区文档实际正文</w:t></w:r></w:p></w:document>');
    await mkdir(path.join(cacheDir, 'docs'), { recursive: true });
    await writeFile(path.join(cacheDir, 'docs', 'guide.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
    await writeFile(path.join(cacheDir, 'SKILL.md'), '# injected description');
    if (manifestName) {
      await writeFile(path.join(cacheDir, 'README.md'), '# unrelated package instructions');
      await writeFile(path.join(cacheDir, manifestName), JSON.stringify(manifestName === 'open-design.json'
        ? { od: { preview: { entry: './docs/guide.docx' } } }
        : { entryFile: 'docs/guide.docx' }));
    }
    try {
      const response = await fetch(`${server.url}/api/marketplaces/hdw-community/plugins/${plugin.name}/preview`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(decodeURIComponent(response.headers.get('x-open-design-preview-file') ?? '')).toBe('docs/guide.docx');
      expect(await response.json()).toMatchObject({ kind: 'document', sections: [{ lines: ['社区文档实际正文'] }] });
    } finally { await close(server.server); }
  });

  it.each([
    { name: 'notes.txt', mime: 'text/plain', content: '纯文本正文\n<script>literal text</script>' },
    { name: 'diagram.svg', mime: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg"><text>图片预览</text></svg>' },
    { name: 'photo.png', mime: 'image/png', content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChw9E8oU7AAAAAElFTkSuQmCC', 'base64') },
  ])('serves the actual $name content with its MIME type', async ({ name, mime, content }) => {
    const root = await makeTempRoot('od-marketplace-preview-file-');
    const plugin = { name: 'file-project', title: 'File project', version: '1.0.0' };
    const { cacheDir, server } = await createPreviewHarness(root, plugin);
    await writeFile(path.join(cacheDir, name), content);
    await writeFile(path.join(cacheDir, 'SKILL.md'), '# injected metadata');
    try {
      const response = await fetch(`${server.url}/api/marketplaces/hdw-community/plugins/${plugin.name}/preview`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(mime);
      expect(decodeURIComponent(response.headers.get('x-open-design-preview-file') ?? '')).toBe(name);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(content));
    } finally { await close(server.server); }
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
