import type { Express, Request } from 'express';
import { pipeline } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as BetterSqlite3 from 'better-sqlite3';

type MarketplaceTrust = 'trusted' | 'restricted' | 'official';

type SqliteDbLike = BetterSqlite3.Database;

interface MarketplaceManifest {
  plugins?: unknown[];
  [key: string]: unknown;
}

interface MarketplaceRow {
  id: string;
  url: string;
  version?: string;
  specVersion?: string;
  trust?: MarketplaceTrust;
  manifest: MarketplaceManifest;
  [key: string]: unknown;
}

interface MarketplaceMutationResult {
  ok: boolean;
  status: number;
  message: string;
  errors?: unknown[];
  row: MarketplaceRow;
}

type MarketplaceFetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface RegisterPluginMarketplaceRoutesDeps {
  db: SqliteDbLike;
  bundledMarketplaceEntries: unknown;
  createMarketplaceFetcher: (seedId: string | null, bundled: unknown) => MarketplaceFetcher;
  marketplaceRegistryIdFromUrl: (url: string) => string | null;
  dataDir: string;
}

export function registerPluginMarketplaceRoutes(app: Express, deps: RegisterPluginMarketplaceRoutesDeps): void {
 const { db, bundledMarketplaceEntries, createMarketplaceFetcher, marketplaceRegistryIdFromUrl } = deps;
 const dataDir = deps.dataDir;
 const projectsDir = path.join(dataDir, 'projects');

  const readBody = (req: Request): Record<string, unknown> =>
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  app.get('/api/marketplaces', async (_req, res) => {
    try {
      const { listMarketplaces } = await import('../../plugins/marketplaces.js');
      res.json({ marketplaces: listMarketplaces(db) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.post('/api/marketplaces', async (req, res) => {
    try {
      const body = readBody(req);
      const url = typeof body.url === 'string' ? body.url : '';
      if (!url) return res.status(400).json({ error: 'url is required' });
      const trust = body.trust === 'trusted' || body.trust === 'official' ? body.trust : 'restricted';
      const { addMarketplace } = await import('../../plugins/marketplaces.js');
      const result = await addMarketplace(db, {
        url,
        trust,
        fetcher: createMarketplaceFetcher(marketplaceRegistryIdFromUrl(url), bundledMarketplaceEntries),
      }) as MarketplaceMutationResult;
      if (!result.ok) return res.status(result.status).json({ error: { code: 'marketplace-add-failed', message: result.message, data: { errors: result.errors ?? [] } } });
      res.status(201).json(result.row);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.get('/api/marketplaces/:id', async (req, res) => {
    try {
      const { getMarketplace } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      if (!row) return res.status(404).json({ error: 'marketplace not found' });
      res.json(row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.delete('/api/marketplaces/:id', async (req, res) => {
    try {
      const { removeMarketplace } = await import('../../plugins/marketplaces.js');
      const ok = removeMarketplace(db, req.params.id);
      if (!ok) return res.status(404).json({ error: 'marketplace not found' });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.post('/api/marketplaces/:id/refresh', async (req, res) => {
    try {
      const { getMarketplace, refreshMarketplace } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      const seedId = row ? marketplaceRegistryIdFromUrl(row.url) ?? req.params.id : req.params.id;
      const result = await refreshMarketplace(db, req.params.id, createMarketplaceFetcher(seedId, bundledMarketplaceEntries)) as MarketplaceMutationResult;
      if (!result.ok) return res.status(result.status).json({ error: { code: 'marketplace-refresh-failed', message: result.message, data: { errors: result.errors ?? [] } } });
      try {
        const { recordPluginEvent } = await import('../../plugins/events.js');
        recordPluginEvent({ kind: 'plugin.marketplace-refreshed', pluginId: '', details: { marketplaceId: req.params.id, marketplaceVersion: result.row.version, specVersion: result.row.specVersion } });
      } catch {}
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
  app.post('/api/marketplaces/:id/trust', async (req, res) => {
    try {
      const body = readBody(req);
      const trust = body.trust === 'trusted' || body.trust === 'restricted' || body.trust === 'official' ? body.trust : null;
      if (!trust) return res.status(400).json({ error: 'trust must be one of: trusted, restricted, official' });
      const { setMarketplaceTrust } = await import('../../plugins/marketplaces.js');
      const row = setMarketplaceTrust(db, req.params.id, trust) as MarketplaceRow | null;
      if (!row) return res.status(404).json({ error: 'marketplace not found' });
      res.json(row);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
 app.get('/api/marketplaces/:id/plugins', async (req, res) => {
    try {
      const { getMarketplace } = await import('../../plugins/marketplaces.js');
      const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
      if (!row) return res.status(404).json({ error: 'marketplace not found' });
      const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
      if (username) {
        // Pass publisher_username to HDW so the backend filters at the DB
        // query level — no need to return the full marketplace.
        try {
          const { HDW_MARKETPLACE_ID, HDW_MARKETPLACE_URL, fetchHdwMarketplaceManifestText } =
            await import('../../http/hdw.js');
          if (req.params.id === HDW_MARKETPLACE_ID) {
            const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir, { publisher_username: username });
            if (manifestText) {
              const manifest = JSON.parse(manifestText) as { plugins?: unknown[] };
              res.json({ plugins: manifest.plugins ?? [] });
              return;
            }
          }
        } catch { /* fall back to cached data below */ }
        // HDW fetch failed — fall back to cached data filtered by publisher.id.
        const fallback = (row.manifest.plugins ?? []).filter((p) => {
          const pub = (p as Record<string, unknown>).publisher as Record<string, unknown> | undefined;
          return pub?.id === username;
        });
        res.json({ plugins: fallback });
        return;
      }
      res.json({ plugins: row.manifest.plugins ?? [] });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
 app.get('/api/marketplaces/:id/plugins/:name/preview', async (req, res) => {
   try {
     const { HDW_MARKETPLACE_ID } = await import('../../http/hdw.js');
     if (req.params.id !== HDW_MARKETPLACE_ID) {
       return res.status(400).json({ error: 'preview is only supported for the HDW community marketplace' });
     }
     const { getMarketplace } = await import('../../plugins/marketplaces.js');
     const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
     if (!row) return res.status(404).json({ error: 'marketplace not found' });
     const plugins = (row.manifest.plugins ?? []) as Array<Record<string, unknown>>;
     const entry = plugins.find((p) => p.name === req.params.name);
     if (!entry) return res.status(404).json({ error: 'plugin not found in marketplace' });

     const pluginName = String(entry.name ?? '');
     const pluginVersion = String(entry.version ?? '');
    const pluginTitle = String(entry.title ?? pluginName);
    const cacheDir = path.join(dataDir, 'hdw-preview', pluginName, pluginVersion);
     const markerPath = path.join(cacheDir, '.extracted');

     let extracted = false;
     try {
       await fs.promises.access(markerPath);
       extracted = true;
     } catch {}

     if (!extracted) {
       const { downloadHdwCommunityArchive } = await import('../../http/hdw.js');
       const archiveBuffer = await downloadHdwCommunityArchive(pluginName, pluginVersion, dataDir);
       if (!archiveBuffer) {
         return res.status(502).json({ error: 'Failed to download archive from HDW' });
       }
       const { x: tarExtract } = await import('tar');
       await fs.promises.mkdir(cacheDir, { recursive: true });
       const archivePath = path.join(cacheDir, 'archive.tgz');
       await fs.promises.writeFile(archivePath, archiveBuffer);
       await new Promise<void>((resolve, reject) => {
         pipeline(
           fs.createReadStream(archivePath),
           tarExtract({ cwd: cacheDir }) as NodeJS.WritableStream,
           (err: NodeJS.ErrnoException | null) => (err ? reject(err) : resolve()),
         );
       });
       await fs.promises.unlink(archivePath).catch(() => {});
       await fs.promises.writeFile(markerPath, String(Date.now()));
     }

     const candidateRels = ['preview/index.html', 'index.html', 'examples/index.html', 'assets/index.html', 'assets/preview.html', 'assets/example.html', 'public/index.html', 'dist/index.html'];
     const searchDirs = ['', 'assets', 'public', 'dist', 'examples', 'preview'];
     let htmlPath = null;
     for (const rel of candidateRels) {
       const full = path.join(cacheDir, rel);
       try {
         const st = await fs.promises.stat(full);
         if (st.isFile()) { htmlPath = full; break; }
       } catch {}
     }
     if (!htmlPath) {
       for (const dir of searchDirs) {
         const abs = path.join(cacheDir, dir);
         try {
           const entries = await fs.promises.readdir(abs, { withFileTypes: true });
           for (const ent of entries) {
             if (ent.isFile() && /\\.html?$/i.test(ent.name)) {
               htmlPath = path.join(abs, ent.name);
               break;
             }
           }
         } catch {}
         if (htmlPath) break;
       }
     }

     if (!htmlPath) {
       const desc = String(entry.description ?? '');
       const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
       const fallbackHtml = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100%;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#64748b}h1{font-size:20px;font-weight:700;color:#1e293b}</style></head><body><div><h1>' + esc(pluginTitle) + '</h1>' + (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div></body></html>';
       res.setHeader('Content-Type', 'text/html; charset=utf-8');
       res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
       return res.send(fallbackHtml);
     }

     const buf = await fs.promises.readFile(htmlPath);
     res.setHeader('Content-Type', 'text/html; charset=utf-8');
     res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'");
     res.setHeader('X-Content-Type-Options', 'nosniff');
     res.send(buf);
   } catch (err) { res.status(500).json({ error: String(err) }); }
 });
app.post('/api/marketplaces/:id/plugins/:name/remix', async (req, res) => {
  try {
    const { getMarketplace } = await import('../../plugins/marketplaces.js');
    const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
    if (!row) return res.status(404).json({ error: 'marketplace not found' });
    const plugins = (row.manifest.plugins ?? []) as Array<Record<string, unknown>>;
    const entry = plugins.find((p) => p.name === req.params.name);
    if (!entry) return res.status(404).json({ error: 'plugin not found in marketplace' });

    // Only the HDW community marketplace supports remix (archive download).
    const { HDW_MARKETPLACE_ID, downloadHdwCommunityArchive } = await import('../../http/hdw.js');
    if (req.params.id !== HDW_MARKETPLACE_ID) {
      return res.status(400).json({ error: 'remix is only supported for the HDW community marketplace' });
    }

    const { getInstalledPlugin } = await import('../../plugins/registry.js');
    const { installFromLocalFolder } = await import('../../plugins/installer.js');
    const { randomUUID } = await import('node:crypto');
    const nodePath = await import('node:path');

    const pluginName = String(entry.name ?? '');
    const pluginVersion = String(entry.version ?? '');
    const pluginTitle = String(entry.title ?? pluginName);

    // Check if the plugin is already installed locally.
    const existing = getInstalledPlugin(db, pluginName);
    let installedPlugin = existing;

   if (!installedPlugin) {
     // Download the archive from HDW.
     const archiveBuffer = await downloadHdwCommunityArchive(pluginName, pluginVersion, dataDir);
      if (!archiveBuffer) {
        return res.status(502).json({ error: 'Failed to download archive from HDW' });
      }

      // Extract to a temp directory.
      const { x: tarExtract } = await import('tar');
      const { promises: fsp } = await import('node:fs');
      const os = await import('node:os');
      const tmpRoot = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'od-remix-'));
      const archivePath = nodePath.join(tmpRoot, 'archive.tgz');
      await fsp.writeFile(archivePath, archiveBuffer);
      try {
        await new Promise<void>((resolve, reject) => {
          pipeline(
            fs.createReadStream(archivePath),
             tarExtract({ cwd: tmpRoot }) as NodeJS.WritableStream,
            (err: NodeJS.ErrnoException | null) => err ? reject(err) : resolve(),
          );
        });
      } catch (err) {
        return res.status(500).json({ error: `Archive extraction failed: ${(err as Error).message}` });
      }
      // Clean up the archive after extraction so it does not leak into the installed plugin folder or the remix project.
      await fsp.unlink(archivePath).catch(() => {});

      // Archives often contain a top-level subdirectory (e.g. `tar czf
      // archive.tgz my-plugin/`). If the manifest is not at the extraction
      // root, search one level deep for a folder containing open-design.json
      // or SKILL.md and install from there instead.
      const manifestFound = await fsp.stat(nodePath.join(tmpRoot, 'open-design.json'))
        .then(() => true).catch(() => false)
        || await fsp.stat(nodePath.join(tmpRoot, 'SKILL.md'))
          .then(() => true).catch(() => false);
     let installSource = tmpRoot;
     if (!manifestFound) {
       const entries = await fsp.readdir(tmpRoot, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          const hasManifest = await fsp.stat(nodePath.join(tmpRoot, e.name, 'open-design.json'))
            .then(() => true).catch(() => false)
            || await fsp.stat(nodePath.join(tmpRoot, e.name, 'SKILL.md'))
              .then(() => true).catch(() => false);
          if (hasManifest) {
            installSource = nodePath.join(tmpRoot, e.name);
            break;
          }
        }
      }

      // Install from the resolved plugin folder.
      const events: unknown[] = [];
      let installError: string | null = null;
      for await (const ev of installFromLocalFolder(db, {
        source: installSource,
        _stagedFolder: installSource,
        _stagedSourceKind: 'local',
      } as any)) {
        const event = ev as { kind: string; message?: string };
        if (event.kind === 'error') {
          installError = event.message ?? 'install failed';
        }
        events.push(ev);
      }
      if (installError) {
        return res.status(500).json({ error: installError });
      }
      installedPlugin = getInstalledPlugin(db, pluginName);
      if (!installedPlugin) {
        return res.status(500).json({ error: 'Plugin installed but not found in registry' });
      }
    }

    // Create a project from the installed plugin (duplicate-project flow).
    const { ensureProject } = await import('../../projects.js');
    const { insertProject, insertConversation, getProject } = await import('../../db.js');
   const PROJECTS_DIR = projectsDir;

    const now = Date.now();
    const projectId = randomUUID();
    const conversationId = randomUUID();
   const metadata: { kind: 'prototype'; entryFile?: string } = { kind: 'prototype' };
   const projectRoot = await ensureProject(PROJECTS_DIR, projectId, metadata);
   // Copy project content files (HTML, assets, etc.) to the project
   // root so they are immediately visible in the file viewer.
   const pluginFsPath = (installedPlugin as { fsPath: string }).fsPath;
  const pluginEntries = await fs.promises.readdir(pluginFsPath, { withFileTypes: true });
  // Skip plugin metadata and non-content build artifacts.
  // NOTE: `dist` is NOT skipped — for design projects it contains the
  // actual user-facing HTML/CSS/JS that the file viewer needs to show.
  const REMIX_SKIP_NAMES = new Set([
    'open-design.json', 'SKILL.md', '.claude-plugin',
    'node_modules', 'build', '.git', 'archive.tgz',
  ]);
  for (const ent of pluginEntries) {
    if (REMIX_SKIP_NAMES.has(ent.name)) continue;
    const src = nodePath.join(pluginFsPath, ent.name);
     const dst = nodePath.join(projectRoot, ent.name);
     try {
       if (ent.isDirectory()) {
         await fs.promises.cp(src, dst, { recursive: true, force: true });
       } else if (ent.isFile()) {
         await fs.promises.copyFile(src, dst);
       }
     } catch {
     // Non-fatal: a missing content file should not block project creation.
   }
 }
 // Derive the project entryFile so the file viewer knows which HTML
 // to show on first open. Prefer the plugin manifest's od.preview.entry;
 // fall back to auto-detecting the first HTML file in the project root
 // or dist/ subdirectory.
 {
   let entryFile: string | undefined;
   try {
     const manifestPath = nodePath.join(pluginFsPath, 'open-design.json');
     const manifestRaw = await fs.promises.readFile(manifestPath, 'utf8');
     const manifest = JSON.parse(manifestRaw) as { od?: { preview?: { entry?: string } } };
     const manifestEntry = manifest?.od?.preview?.entry;
     if (typeof manifestEntry === 'string' && manifestEntry.trim()) {
       entryFile = manifestEntry.trim().replace(/^\.\//, '');
     }
   } catch { /* best-effort: manifest may be absent */ }
   if (!entryFile) {
     const candidates = ['index.html', 'dist/index.html'];
     for (const c of candidates) {
       try {
         const st = await fs.promises.stat(nodePath.join(projectRoot, c));
         if (st.isFile()) { entryFile = c; break; }
       } catch {}
     }
   }
   if (!entryFile) {
     // Scan top-level and dist/ for any .html file.
     for (const dir of ['', 'dist']) {
       try {
         const entries = await fs.promises.readdir(dir ? nodePath.join(projectRoot, dir) : projectRoot, { withFileTypes: true });
         for (const e of entries) {
           if (e.isFile() && /\.html?$/i.test(e.name)) {
             entryFile = dir ? `${dir}/${e.name}` : e.name;
             break;
           }
         }
       } catch {}
       if (entryFile) break;
     }
   }
   if (entryFile) metadata.entryFile = entryFile;
 }
   const prompt = entry.prompt
     ? `Reference project from community: ${pluginTitle}\n\n${String(entry.prompt)}`
     : `Remix of community project: ${pluginTitle}`;
    insertProject(db, {
      id: projectId,
      name: `${pluginTitle}`,
      skillId: null,
      designSystemId: null,
      pendingPrompt: prompt,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
   // Bind the project to the user's personal (default-team) workspace so
   // it appears in the "个人所有" project list. Without this row, the
   // project exists in the `projects` table but is invisible to every
   // workspace-scoped query (PersonalAllView, TeamSpaceView, etc.).
   const { ensureWorkspaceProject } = await import('../../db.js');
   const { getSharedSpaceTeamId, getSharedSpaceMemberId } = await import('../../ids.js');
   const sharedSpaceId = getSharedSpaceTeamId();
   const sharedSpaceMemberId = getSharedSpaceMemberId();
   ensureWorkspaceProject(db, {
     projectId,
     workspaceId: sharedSpaceId,
     visibility: 'personal',
     resourceState: 'active',
     createdByWorkspaceMemberId: sharedSpaceMemberId,
     updatedByWorkspaceMemberId: sharedSpaceMemberId,
     syncState: 'local_only',
     resourceHubResourceId: null,
     cloudTombstonedAt: null,
     createdAt: now,
     updatedAt: now,
   });
    insertConversation(db, {
      id: conversationId,
      projectId,
      title: null,
      createdAt: now,
      updatedAt: now,
    });
    const project = getProject(db, projectId);
    res.json({
      ok: true,
      project,
      conversationId,
      pluginId: installedPlugin.id,
      message: `Created a project from ${pluginTitle}.`,
    });
   } catch (err) { res.status(500).json({ error: String(err) }); }
 });
}
