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
  triggerCoverForProjectEntry?: (
    projectId: string,
    projectMeta: { name?: string; metadata?: Record<string, unknown> | null } | null,
  ) => void;
}

export function registerPluginMarketplaceRoutes(app: Express, deps: RegisterPluginMarketplaceRoutesDeps): void {
 const { db, bundledMarketplaceEntries, createMarketplaceFetcher, marketplaceRegistryIdFromUrl } = deps;
 const dataDir = deps.dataDir;
 const projectsDir = path.join(dataDir, 'projects');

  // Augment marketplace plugin entries with prompt from locally installed
  // plugins SKILL.md files. The HDW backend may not return prompt in the
  // marketplace manifest, so we fill it in from installed plugins that were
  // remixed/used locally, mirroring how coverUrl is augmented from local digests.
  function augmentPluginsWithLocalPrompt(plugins: unknown[]): void {
    if (!plugins.length) return;
    const rows = db.prepare(`SELECT source_marketplace_entry_name, fs_path FROM installed_plugins WHERE source_marketplace_entry_name IS NOT NULL`).all() as Array<{ source_marketplace_entry_name: string; fs_path: string }>;
    const fsPathByName = new Map<string, string>();
    for (const row of rows) {
      if (row.source_marketplace_entry_name && row.fs_path) {
        fsPathByName.set(row.source_marketplace_entry_name, row.fs_path);
      }
    }
    if (!fsPathByName.size) return;
    for (const entry of plugins as Array<Record<string, unknown>>) {
      if (typeof entry.prompt === 'string' && entry.prompt.trim()) continue;
      const name = typeof entry.name === 'string' ? entry.name : undefined;
      if (!name) continue;
      const fsPath = fsPathByName.get(name);
      if (!fsPath) continue;
      try {
        const skillMd = fs.readFileSync(path.join(fsPath, 'SKILL.md'), 'utf8');
        if (skillMd.trim()) entry.prompt = skillMd;
      } catch { /* SKILL.md missing, skip */ }
    }
  }

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
          const { HDW_MARKETPLACE_ID, HDW_MARKETPLACE_URL, fetchHdwMarketplaceManifestText, readHdwCommunityDeletions } =
            await import('../../http/hdw.js');
          if (req.params.id === HDW_MARKETPLACE_ID) {
            const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir, { publisher_username: username });
            if (manifestText) {
              const manifest = JSON.parse(manifestText) as { plugins?: unknown[] };
              const plugins = manifest.plugins ?? [];
              const deletions = readHdwCommunityDeletions(dataDir);
              const visiblePlugins = (plugins as Array<Record<string, unknown>>).filter((entry) => {
                const name = typeof entry.name === 'string' ? entry.name : undefined;
                return !(name && deletions[name]?.hardDeleted);
              });
              for (const entry of visiblePlugins) {
                const name = typeof entry.name === 'string' ? entry.name : undefined;
                if (name && deletions[name]?.deletedAt) {
                  entry.deletedAt = deletions[name]!.deletedAt;
                }
              }
              augmentPluginsWithLocalPrompt(visiblePlugins);
              res.json({ plugins: visiblePlugins });
              return;
            }
          }
        } catch { /* fall back to cached data below */ }
        // HDW fetch failed — fall back to cached data filtered by publisher.id.
        const fallback = (row.manifest.plugins ?? []).filter((p) => {
          const pub = (p as Record<string, unknown>).publisher as Record<string, unknown> | undefined;
          return pub?.id === username;
        });
        const { readHdwCommunityDeletions } = await import('../../http/hdw.js');
        const deletions = readHdwCommunityDeletions(dataDir);
        const visiblePlugins = (fallback as Array<Record<string, unknown>>).filter((entry) => {
          const name = typeof entry.name === 'string' ? entry.name : undefined;
          return !(name && deletions[name]?.hardDeleted);
        });
        for (const entry of visiblePlugins as Array<Record<string, unknown>>) {
          const name = typeof entry.name === 'string' ? entry.name : undefined;
          if (name && deletions[name]?.deletedAt) {
            entry.deletedAt = deletions[name]!.deletedAt;
          }
        }
        augmentPluginsWithLocalPrompt(visiblePlugins);
        res.json({ plugins: visiblePlugins });
        return;
      }
      try {
        const { HDW_MARKETPLACE_ID, HDW_MARKETPLACE_URL, fetchHdwMarketplaceManifestText, readHdwCommunityDeletions } =
          await import('../../http/hdw.js');
        if (req.params.id === HDW_MARKETPLACE_ID) {
          const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir);
          if (manifestText) {
            const manifest = JSON.parse(manifestText) as { plugins?: unknown[] };
            const plugins = (manifest.plugins ?? []) as Array<Record<string, unknown>>;
            const deletions = readHdwCommunityDeletions(dataDir);
            const visiblePlugins = plugins.filter((entry) => {
              const name = typeof entry.name === 'string' ? entry.name : undefined;
              if (!name) return true;
              const state = deletions[name];
              return !state?.deletedAt && !state?.hardDeleted;
            });
            augmentPluginsWithLocalPrompt(visiblePlugins);
            res.json({ plugins: visiblePlugins });
            return;
          }
        }
      } catch { /* fall back to cached marketplace below */ }
      const cachedPlugins = row.manifest.plugins ?? [];
      const { readHdwCommunityDeletions } = await import('../../http/hdw.js');
      const deletions = readHdwCommunityDeletions(dataDir);
      const visiblePlugins = (cachedPlugins as Array<Record<string, unknown>>).filter((entry) => {
        const name = typeof entry.name === 'string' ? entry.name : undefined;
        if (!name) return true;
        const state = deletions[name];
        return !state?.deletedAt && !state?.hardDeleted;
      });
      augmentPluginsWithLocalPrompt(visiblePlugins);
      res.json({ plugins: visiblePlugins });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
 app.post('/api/marketplaces/:id/plugins/:name/unpublish', async (req, res) => {
   try {
     const { HDW_MARKETPLACE_ID, writeHdwCommunityDeletion, fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_URL } =
       await import('../../http/hdw.js');
     const { readSsoUsername } = await import('../../http/hik_logins/hicoo.js');
     if (req.params.id !== HDW_MARKETPLACE_ID) {
       return res.status(400).json({ error: 'unpublish is only supported for the HDW community marketplace' });
     }
     const { getMarketplace, ensureMarketplaceManifest } = await import('../../plugins/marketplaces.js');
     const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
     if (!row) return res.status(404).json({ error: 'marketplace not found' });
     const plugins = (row.manifest.plugins ?? []) as Array<Record<string, unknown>>;
     const entry = plugins.find((p) => p.name === req.params.name);
     if (!entry) return res.status(404).json({ error: 'plugin not found in marketplace' });
     const username = readSsoUsername(dataDir);
     if (!username) return res.status(401).json({ error: 'SSO session is required to unpublish a community plugin' });
     const pub = entry.publisher as Record<string, unknown> | undefined;
     if (pub?.id !== username) return res.status(403).json({ error: 'not authorized to unpublish this plugin' });
     const now = new Date().toISOString();
     const ok = writeHdwCommunityDeletion(dataDir, String(entry.name), now);
     if (!ok) return res.status(500).json({ error: 'failed to persist unpublish state' });

     // Best-effort refresh so a later public list request uses the fresh
     // manifest while still applying the tombstone on top.
     try {
       const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir);
       if (manifestText) {
         ensureMarketplaceManifest(db, {
           id: req.params.id,
           url: row.url,
           manifestText,
           trust: row.trust ?? 'restricted',
         });
       }
     } catch { /* keep local tombstone even if refresh fails */ }
     res.json({ ok: true, deletedAt: now });
   } catch (err) { res.status(500).json({ error: String(err) }); }
 });
 app.post('/api/marketplaces/:id/plugins/:name/publish', async (req, res) => {
   try {
     const { HDW_MARKETPLACE_ID, removeHdwCommunityDeletion, readHdwCommunityDeletions, fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_URL } =
       await import('../../http/hdw.js');
     const { readSsoUsername } = await import('../../http/hik_logins/hicoo.js');
     if (req.params.id !== HDW_MARKETPLACE_ID) {
       return res.status(400).json({ error: 'publish is only supported for the HDW community marketplace' });
     }
     const { getMarketplace, ensureMarketplaceManifest } = await import('../../plugins/marketplaces.js');
     const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
     if (!row) return res.status(404).json({ error: 'marketplace not found' });
     const plugins = (row.manifest.plugins ?? []) as Array<Record<string, unknown>>;
     const entry = plugins.find((p) => p.name === req.params.name);
     if (!entry) return res.status(404).json({ error: 'plugin not found in marketplace' });
     const username = readSsoUsername(dataDir);
     if (!username) return res.status(401).json({ error: 'SSO session is required to publish a community plugin' });
     const pub = entry.publisher as Record<string, unknown> | undefined;
     if (pub?.id !== username) return res.status(403).json({ error: 'not authorized to publish this plugin' });
     if (readHdwCommunityDeletions(dataDir)[String(entry.name)]?.hardDeleted) {
       return res.status(400).json({ error: 'plugin was hard-deleted and cannot be republished' });
     }
     removeHdwCommunityDeletion(dataDir, String(entry.name));

     try {
       const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir);
       if (manifestText) {
         ensureMarketplaceManifest(db, {
           id: req.params.id,
           url: row.url,
           manifestText,
           trust: row.trust ?? 'restricted',
         });
       }
     } catch { /* keep local state clean even if refresh fails */ }
     res.json({ ok: true });
   } catch (err) { res.status(500).json({ error: String(err) }); }
 });
 app.delete('/api/marketplaces/:id/plugins/:name', async (req, res) => {
   try {
     const { HDW_MARKETPLACE_ID, removeHdwCommunityDeletion, markHdwCommunityHardDeleted, fetchHdwMarketplaceManifestText, HDW_MARKETPLACE_URL } =
       await import('../../http/hdw.js');
     const { readSsoUsername } = await import('../../http/hik_logins/hicoo.js');
     if (req.params.id !== HDW_MARKETPLACE_ID) {
       return res.status(400).json({ error: 'delete is only supported for the HDW community marketplace' });
     }
     const { getMarketplace, ensureMarketplaceManifest } = await import('../../plugins/marketplaces.js');
     const row = getMarketplace(db, req.params.id) as MarketplaceRow | null;
     if (!row) return res.status(404).json({ error: 'marketplace not found' });

     let plugins = (row.manifest.plugins ?? []) as Array<Record<string, unknown>>;
     let entry = plugins.find((p) => p.name === req.params.name);

     // A newly published project can be visible from the fresh HDW list before
     // the daemon's cached marketplace row has caught up. Refresh once before
     // treating the resource as missing so publish → delete works immediately.
     if (!entry) {
       try {
         const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir);
         if (manifestText) {
           ensureMarketplaceManifest(db, {
             id: req.params.id,
             url: row.url,
             trust: row.trust ?? 'restricted',
             manifestText,
           });
           const freshManifest = JSON.parse(manifestText) as { plugins?: Array<Record<string, unknown>> };
           plugins = freshManifest.plugins ?? [];
           entry = plugins.find((p) => p.name === req.params.name);
         }
       } catch { /* keep the original not-found result */ }
     }
     if (!entry) return res.status(404).json({ error: 'plugin not found in marketplace' });
     const username = readSsoUsername(dataDir);
     if (!username) return res.status(401).json({ error: 'SSO session is required to delete a community plugin' });
     const pub = entry.publisher as Record<string, unknown> | undefined;
     if (pub?.id !== username) return res.status(403).json({ error: 'not authorized to delete this plugin' });

     // Best-effort remote DELETE. If HDW supports it, the next refresh will
     // naturally drop the entry. We also keep a local hard-delete tombstone so
     // the entry does not reappear through cached manifests.
     const { hdwDelete } = await import('../../http/hdw.js');
     const hicoo = await import('../../http/hik_logins/hicoo.js');
     const session = hicoo.readSsoConfigFile(dataDir);
     await hdwDelete(`/community/plugins/${encodeURIComponent(String(entry.name))}`, session?.cookies).catch(() => null);
     removeHdwCommunityDeletion(dataDir, String(entry.name));
     markHdwCommunityHardDeleted(dataDir, String(entry.name));

     try {
       const manifestText = await fetchHdwMarketplaceManifestText(HDW_MARKETPLACE_URL, dataDir);
       if (manifestText) {
         ensureMarketplaceManifest(db, {
           id: req.params.id,
           url: row.url,
           manifestText,
           trust: row.trust ?? 'restricted',
         });
       }
     } catch { /* keep local tombstone even if refresh fails */ }
     res.json({ ok: true });
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
    let contentSource: string | null = null;
    if (!installedPlugin) {
      // Download the archive from HDW.
      const archiveBuffer = await downloadHdwCommunityArchive(pluginName, pluginVersion, dataDir);
      if (!archiveBuffer) {
        return res.status(502).json({ error: 'Failed to download archive from HDW' });
      }

      // Extract to a temp directory.
      const { promises: fsp } = await import('node:fs');
      const os = await import('node:os');
      const tmpRoot = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'od-remix-'));
      // Detect archive format by magic bytes. ZIP starts with PK (0x50 0x4B);
      // gzip starts with 0x1F 0x8B (tar.gz); uncompressed tar has "ustar" at
      // offset 257. The publish-community route creates ZIP archives via
      // JSZip, while the CLI publish-hdw flow creates tar.gz archives.
      const isZip = archiveBuffer.length >= 4
        && archiveBuffer[0] === 0x50 && archiveBuffer[1] === 0x4B;
      try {
        if (isZip) {
          // Extract ZIP archives (created by createProjectArchiveStream / JSZip).
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(archiveBuffer);
          const extractOps: Promise<void>[] = [];
          zip.forEach((relativePath, entry) => {
            if (entry.dir) return;
            const dest = nodePath.join(tmpRoot, relativePath);
            const destDir = nodePath.dirname(dest);
            extractOps.push(
              fsp.mkdir(destDir, { recursive: true }).then(() =>
                entry.async('nodebuffer'),
              ).then((data) => fsp.writeFile(dest, data)),
            );
          });
          await Promise.all(extractOps);
        } else {
          // Extract tar/tgz archives (created by the CLI publish-hdw flow).
          const { x: tarExtract } = await import('tar');
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
          } finally {
            await fsp.unlink(archivePath).catch(() => {});
          }
        }
      } catch (err) {
        return res.status(500).json({ error: `Archive extraction failed: ${(err as Error).message}` });
      }


      // Detect archive type: plugin archives contain open-design.json
      // or SKILL.md; project archives contain DESIGN-MANIFEST.json.
      // Since publish-community now injects open-design.json + SKILL.md
      // into project archives too, most archives will have both. But
      // handle the legacy case where only DESIGN-MANIFEST.json exists.
      const hasPluginManifest = await fsp.stat(nodePath.join(tmpRoot, 'open-design.json'))
        .then(() => true).catch(() => false)
        || await fsp.stat(nodePath.join(tmpRoot, 'SKILL.md'))
          .then(() => true).catch(() => false);
      const hasProjectManifest = await fsp.stat(nodePath.join(tmpRoot, 'DESIGN-MANIFEST.json'))
        .then(() => true).catch(() => false);

      contentSource = tmpRoot;
      let isPluginArchive = hasPluginManifest;

      // If no plugin manifest at root, search one level deep.
      if (!isPluginArchive) {
        const entries = await fsp.readdir(tmpRoot, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          const hasManifest = await fsp.stat(nodePath.join(tmpRoot, e.name, 'open-design.json'))
            .then(() => true).catch(() => false)
            || await fsp.stat(nodePath.join(tmpRoot, e.name, 'SKILL.md'))
              .then(() => true).catch(() => false);
          if (hasManifest) {
            contentSource = nodePath.join(tmpRoot, e.name);
            isPluginArchive = true;
            break;
          }
        }
      }

      // For plugin archives, install via the plugin installer so the
      // registry tracks it. For project archives (DESIGN-MANIFEST.json
      // only), skip installation and use the extracted folder directly.
      if (isPluginArchive) {
        const events: unknown[] = [];
        let installError: string | null = null;
        for await (const ev of installFromLocalFolder(db, {
          source: contentSource,
          _stagedFolder: contentSource,
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
      } else if (hasProjectManifest) {
        // Project archive: use the extracted directory directly.
        // No plugin install needed — just copy content files later.
      } else {
        return res.status(500).json({ error: 'Archive contains no plugin manifest (open-design.json/SKILL.md) or project manifest (DESIGN-MANIFEST.json)' });
      }
    }

    // Create a project from the installed plugin or extracted folder.
    const { ensureProject } = await import('../../projects.js');
    const { insertProject, insertConversation, getProject } = await import('../../db.js');
    const PROJECTS_DIR = projectsDir;

    const now = Date.now();
    const projectId = randomUUID();
    const conversationId = randomUUID();
    const metadata: { kind: 'prototype'; entryFile?: string } = { kind: 'prototype' };
    const projectRoot = await ensureProject(PROJECTS_DIR, projectId, metadata);

    // Use installed plugin folder or the extracted archive directory.
    const contentDir = installedPlugin
      ? (installedPlugin as { fsPath: string }).fsPath
      : contentSource!;
    const pluginEntries = await fs.promises.readdir(contentDir, { withFileTypes: true });
    // Skip plugin/project metadata and non-content build artifacts.
    // NOTE: dist is NOT skipped — for design projects it contains the
    // actual user-facing HTML/CSS/JS that the file viewer needs to show.
    const REMIX_SKIP_NAMES = new Set(['open-design.json', 'SKILL.md', '.claude-plugin',
      'node_modules', 'build', '.git', 'archive.tgz',
      'DESIGN-MANIFEST.json', 'DESIGN-HANDOFF.md']);
    for (const ent of pluginEntries) {
      if (REMIX_SKIP_NAMES.has(ent.name)) continue;
      const src = nodePath.join(contentDir, ent.name);
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
    // to show on first open. Prefer open-design.json od.preview.entry,
    // then DESIGN-MANIFEST.json entryFile, then auto-detect.
    {
      let entryFile: string | undefined;
      try {
        const manifestPath = nodePath.join(contentDir, 'open-design.json');
        const manifestRaw = await fs.promises.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestRaw) as { od?: { preview?: { entry?: string } } };
        const manifestEntry = manifest?.od?.preview?.entry;
        if (typeof manifestEntry === 'string' && manifestEntry.trim()) {
          entryFile = manifestEntry.trim().replace(/^\.\//, '');
        }
      } catch { /* best-effort: manifest may be absent */ }
      if (!entryFile) {
        try {
          const designManifestPath = nodePath.join(contentDir, 'DESIGN-MANIFEST.json');
          const designRaw = await fs.promises.readFile(designManifestPath, 'utf8');
          const designManifest = JSON.parse(designRaw) as { entryFile?: string };
          if (typeof designManifest.entryFile === 'string' && designManifest.entryFile.trim()) {
            entryFile = designManifest.entryFile.trim().replace(/^\.\//, '');
          }
        } catch { /* best-effort */ }
      }
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
    deps.triggerCoverForProjectEntry?.(projectId, {
      name: pluginTitle,
      metadata: metadata as unknown as Record<string, unknown>,
    });
    res.json({
      ok: true,
      project,
      conversationId,
      pluginId: installedPlugin ? installedPlugin.id : null,
      message: `Created a project from ${pluginTitle}.`,
    });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
}
