import type { Express } from 'express';
import fs from 'node:fs';
import { SIDECAR_ENV } from '@open-design/sidecar-proto';
import { buildMcpInstallPayload, type McpInstallPayload } from './mcp-install-info.js';
import { installCodexMcp, probeCodexInstall, uninstallCodexMcp } from './codex-cli.js';
import { MCP_TEMPLATES, buildAcpMcpServers, buildClaudeMcpJson, isManagedProjectCwd, readMcpConfig, writeMcpConfig } from './mcp-config.js';
import { sanitizeMcpServer, type McpTemplate, type McpServerConfig } from './mcp-config.js';
import { beginAuth, exchangeCodeForToken, refreshAccessToken } from './mcp-oauth.js';
import { clearToken, getToken, isTokenExpired, readAllTokens, setToken } from './mcp-tokens.js';
import { hdwPost, hdwPut, hdwDelete, hdwGetRaw } from './http/hdw.js';
import { readSsoConfigFile } from './http/hik_logins/hicoo.js';
import type { HdwCloudClient } from './integrations/hdw-cloud.js';
import type { RouteDeps } from './server-context.js';

export interface RegisterMcpRoutesDeps extends RouteDeps<'http' | 'paths' | 'mcp'> {
  hdwClient: HdwCloudClient | null;
}

export function registerMcpRoutes(app: Express, ctx: RegisterMcpRoutesDeps) {
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const { OD_BIN, RUNTIME_DATA_DIR, PROJECTS_DIR } = ctx.paths;
  const { pendingAuth, daemonUrlRef } = ctx.mcp;
  const hdwClient = ctx.hdwClient;
  const getResolvedPort = () => resolvedPortRef.current;
  const getDaemonUrl = () => daemonUrlRef.current;
  const getSsoCookies = () => readSsoConfigFile(RUNTIME_DATA_DIR)?.cookies ?? [];
  const getWorkspaceId = (req: any) =>
    (req.headers['x-od-workspace-id'] as string) || '';
  const getOwnerMemberId = (req: any) =>
    (req.headers['x-od-workspace-member-id'] as string) || '';

  // Slug rule mirroring the web-side suggestMcpServerId so install produces
  // valid, collision-free server ids from a template label.
  function suggestServerId(label: string, taken: ReadonlySet<string>): string {
    const base =
      label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'mcp-server';
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const next = `${base}-${i}`;
      if (!taken.has(next)) return next;
    }
    return `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // Convert a cloud MCP template into a McpServerConfig suitable for
  // writing into mcp-config.json. Mirrors the web-side rowFromTemplate.
  function templateToServer(tpl: McpTemplate, taken: ReadonlySet<string>): McpServerConfig | null {
   const id = suggestServerId(tpl.id || tpl.label, taken);
   const server: McpServerConfig = {
     id,
     // Force id = templateId = label for consistency.
     label: id,
     templateId: id,
     transport: tpl.transport,
     enabled: true,
   };
    if (tpl.transport === 'stdio') {
      if (!tpl.command) return null;
      server.command = tpl.command;
      if (tpl.args) server.args = [...tpl.args];
      // envFields are templates — the user fills them later in Settings.
      // For install we persist empty-string placeholders so the keys are
      // visible in the env editor.
      if (tpl.envFields && tpl.envFields.length > 0) {
        const env: Record<string, string> = {};
        for (const f of tpl.envFields) env[f.key] = '';
        if (Object.keys(env).length > 0) server.env = env;
      }
    } else {
      if (!tpl.url) return null;
      server.url = tpl.url;
      if (tpl.authMode) server.authMode = tpl.authMode;
      if (tpl.headerFields && tpl.headerFields.length > 0) {
        const headers: Record<string, string> = {};
        for (const f of tpl.headerFields) headers[f.key] = '';
        if (Object.keys(headers).length > 0) server.headers = headers;
      }
    }
    return server;
  }

  // Surfaces the absolute paths to the daemon's Node-compatible runtime and
  // CLI entry so the Settings → MCP server panel can render snippets that work
  // even when `od` isn't on the user's PATH (the common case for source clones
  // - and macOS/Linux ship a /usr/bin/od octal-dump tool that shadows ours
  // anyway). Cached for 5s because the panel pings on every open. The
  // executable paths remain stable for the daemon lifetime, while the
  // packaged web port is part of the cache key because it is registered
  // after the web sidecar binds and may change after a runtime restart.
  const INSTALL_INFO_TTL_MS = 5000;
  let installInfoCache: {
    t: number;
    payload: object;
    webPort: string | null;
  } | null = null;

  // Resolve the install snippet for the current daemon. Shared by the
  // public GET /api/mcp/install-info endpoint (renders TOML/JSON for
  // the user to copy) and POST /api/mcp/install/codex (which feeds the
  // exact same fields into `codex mcp add` so the one-click install
  // configures Codex with byte-for-byte the same command as the copy
  // snippet would). Keeping this in one place is the whole point of
  // the factoring — divergence here would mean Codex behaves
  // differently depending on which install path the user took.
  function computeInstallPayload(): McpInstallPayload {
    const cliPath = OD_BIN;
    // The daemon was bootstrapped as a sidecar (tools-dev, packaged) iff
    // bootstrapSidecarRuntime stamped OD_SIDECAR_IPC_PATH into the env.
    // In sidecar mode the snippet omits --daemon-url and the spawned
    // `od mcp` discovers the live URL via the concrete IPC endpoint on
    // every spawn, so the client config survives ephemeral-port
    // restarts. For direct `od` / `od --port X` launches there is no
    // IPC socket; the helper bakes --daemon-url so custom ports keep
    // working.
    const sidecarIpcPath = process.env[SIDECAR_ENV.IPC_PATH];
    const isSidecarMode = sidecarIpcPath != null && sidecarIpcPath.length > 0;
    const sidecarEnv: Record<string, string> = {};
    if (isSidecarMode) {
      sidecarEnv[SIDECAR_ENV.IPC_PATH] = sidecarIpcPath;
    }
    const mcpBootstrapCommand = process.env.OD_MCP_BOOTSTRAP_COMMAND;
    if (
      mcpBootstrapCommand != null
      && mcpBootstrapCommand.length > 0
    ) {
      sidecarEnv.OD_MCP_BOOTSTRAP_COMMAND = mcpBootstrapCommand;
    }
    const mcpBootstrapArgs = process.env.OD_MCP_BOOTSTRAP_ARGS;
    if (mcpBootstrapArgs != null && mcpBootstrapArgs.length > 0) {
      sidecarEnv.OD_MCP_BOOTSTRAP_ARGS = mcpBootstrapArgs;
    }
    // tools-dev / packaged launchers export OD_WEB_PORT so the daemon
    // knows where the browser-facing HiDesign studio is running.
    // CLI-only / headless launches set neither and webBaseUrl falls
    // through as null — MCP clients then just omit the studio deep
    // link from their responses.
    const webPortRaw = process.env[SIDECAR_ENV.WEB_PORT];
    const webPortNum = webPortRaw ? Number(webPortRaw) : Number.NaN;
    const webBaseUrl = Number.isFinite(webPortNum) && webPortNum > 0
      ? `http://127.0.0.1:${webPortNum}`
      : null;
    return buildMcpInstallPayload({
      cliPath,
      cliExists: fs.existsSync(cliPath),
      // process.execPath is the absolute path to the Node-compatible
      // runtime running the daemon RIGHT NOW. In packaged builds this
      // may be Electron with ELECTRON_RUN_AS_NODE=1 rather than a
      // separate bundled Node binary; the helper surfaces that env
      // requirement on the command so IDE-spawned MCP clients can
      // reproduce the same mode from a minimal OS launcher env.
      execPath: process.execPath,
      nodeExists: fs.existsSync(process.execPath),
      port: getResolvedPort(),
      platform: process.platform,
      dataDir: RUNTIME_DATA_DIR,
      electronAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
      isSidecarMode,
      sidecarEnv,
      webBaseUrl,
    });
  }

  app.get('/api/mcp/install-info', (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const now = Date.now();
    const webPort = process.env[SIDECAR_ENV.WEB_PORT] ?? null;
    if (
      installInfoCache
      && installInfoCache.webPort === webPort
      && now - installInfoCache.t < INSTALL_INFO_TTL_MS
    ) {
      return res.json(installInfoCache.payload);
    }
    const payload = computeInstallPayload();
    installInfoCache = { t: now, payload, webPort };
    res.json(payload);
  });

  // Codex one-click install. Codex CLI exposes `codex mcp add/remove/get`,
  // so we shell out to it rather than rewriting ~/.codex/config.toml
  // ourselves — that way we inherit Codex's merge / validation rules
  // and only need to track its argv. See apps/daemon/src/codex-cli.ts.
  const CODEX_MCP_NAME = 'open-design';

  app.get('/api/mcp/install/codex/status', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const status = await probeCodexInstall(CODEX_MCP_NAME);
      res.json(status);
    } catch (err) {
      sendApiError(res, 500, 'CODEX_PROBE_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  app.post('/api/mcp/install/codex', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const payload = computeInstallPayload();
    if (!payload.cliExists || !payload.nodeExists) {
      return sendApiError(res, 500, 'INSTALL_INFO_INCOMPLETE', payload.buildHint ?? 'install payload not ready');
    }
    try {
      await installCodexMcp({
        name: CODEX_MCP_NAME,
        command: payload.command,
        args: payload.args,
        env: payload.env,
      });
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, 500, 'CODEX_INSTALL_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  app.delete('/api/mcp/install/codex', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      await uninstallCodexMcp(CODEX_MCP_NAME);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, 500, 'CODEX_UNINSTALL_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // External MCP server configuration. HiDesign connects to these as a
  // CLIENT and surfaces their tools to the underlying agent at spawn time.
  // GET returns user-saved entries plus the built-in template list so the UI
  // can render the "Add MCP server" picker without a second round-trip.
  app.get('/api/mcp/servers', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
      res.json({ servers: cfg.servers, templates: MCP_TEMPLATES });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/mcp/servers', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const cfg = await writeMcpConfig(RUNTIME_DATA_DIR, req.body);
      res.json({ servers: cfg.servers, templates: MCP_TEMPLATES });
    } catch (err: any) {
      res
        .status(400)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // External MCP server OAuth — daemon-owned authorization flow.
  //
  // Replaces per-spawn `mcp-remote` subprocesses. The token is stored
  // server-side in <dataDir>/mcp-tokens.json and injected as a Bearer
  // header into the `.mcp.json` we write for Claude Code at spawn time.
  // The redirect URI points at THIS daemon's public origin so the flow
  // works the same in local dev (loopback) and in cloud deployments
  // where OD_PUBLIC_BASE_URL pins the externally-routable URL.
  // ─────────────────────────────────────────────────────────────────

  app.post('/api/mcp/oauth/start', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const serverId =
      typeof req.body?.serverId === 'string' ? req.body.serverId.trim() : '';
    if (!serverId) {
      return res.status(400).json({ error: 'serverId is required' });
    }
    try {
      const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
      const server = cfg.servers.find((s) => s.id === serverId);
      if (!server) {
        return res.status(404).json({ error: `unknown serverId ${serverId}` });
      }
      if (server.transport !== 'http' && server.transport !== 'sse') {
        return res
          .status(400)
          .json({ error: 'OAuth flow only applies to http/sse transports' });
      }
      if (!server.url) {
        return res.status(400).json({ error: 'server has no URL configured' });
      }
      if (server.authMode === 'none') {
        return res
          .status(400)
          .json({ error: 'server is configured for no managed OAuth' });
      }
      const redirectUri = mcpOAuthCallbackUrl(req);
      console.log(
        `[mcp-oauth] start serverId=${serverId} url=${server.url} redirect=${redirectUri}`,
      );
      const result = await beginAuth({
        serverId,
        serverUrl: server.url,
        redirectUri,
        dataDir: RUNTIME_DATA_DIR,
        fetchImpl: fetch,
      });
      pendingAuth.put(result.state, result.pending);
      console.log(
        `[mcp-oauth] start ok serverId=${serverId} authServer=${result.pending.authServerIssuer} clientId=${result.pending.clientId}`,
      );
      res.json({
        authorizeUrl: result.authorizeUrl,
        state: result.state,
        redirectUri,
      });
    } catch (err: any) {
      const msg = err && err.message ? err.message : String(err);
      console.error(`[mcp-oauth] start failed serverId=${serverId}:`, msg);
      res.status(502).json({ error: msg });
    }
  });

  // Public endpoint — the OAuth provider's user-agent redirect lands here
  // after the user approves. We deliberately do NOT enforce
  // isLocalSameOrigin: in cloud the daemon IS the public origin, and even
  // locally the request comes back from the OAuth provider's redirect
  // (no Origin header at all on a top-level navigation).
  app.get('/api/mcp/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    if (error) {
      return res.status(400).type('html').send(renderOAuthResultPage({
        ok: false,
        message: `Auth provider returned error: ${error}`,
      }));
    }
    if (!code || !state) {
      return res.status(400).type('html').send(renderOAuthResultPage({
        ok: false,
        message: 'Missing code or state — open Settings → External MCP servers and click Connect again.',
      }));
    }
    const pending = pendingAuth.consume(state);
    if (!pending) {
      return res.status(400).type('html').send(renderOAuthResultPage({
        ok: false,
        message: 'Auth state expired or already used. Click Connect again.',
      }));
    }
    try {
      const tokenResp = await exchangeCodeForToken({
        tokenEndpoint: pending.tokenEndpoint,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        redirectUri: pending.redirectUri,
        code,
        codeVerifier: pending.codeVerifier,
        resource: pending.resourceUrl,
      });
      const stored: any = {
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token,
        tokenType: tokenResp.token_type ?? 'Bearer',
        scope: tokenResp.scope ?? pending.scope,
        expiresAt:
          typeof tokenResp.expires_in === 'number'
            ? Date.now() + tokenResp.expires_in * 1000
            : undefined,
        savedAt: Date.now(),
        // Persist the OAuth client context so refresh-token rotation can
        // hit the same client_id / token endpoint the upstream issued the
        // refresh_token to. Refresh tokens are client-bound (RFC 6749 §6).
        tokenEndpoint: pending.tokenEndpoint,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        authServerIssuer: pending.authServerIssuer,
        redirectUri: pending.redirectUri,
        resourceUrl: pending.resourceUrl,
      };
      await setToken(RUNTIME_DATA_DIR, pending.serverId, stored);
      res.type('html').send(renderOAuthResultPage({
        ok: true,
        serverId: pending.serverId,
      }));
    } catch (err: any) {
      console.error(
        '[mcp-oauth] callback failed:',
        err && err.message ? err.message : err,
      );
      res.status(502).type('html').send(renderOAuthResultPage({
        ok: false,
        message: String(err && err.message ? err.message : err),
      }));
    }
  });

  app.get('/api/mcp/oauth/status', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const serverId =
      typeof req.query.serverId === 'string' ? req.query.serverId.trim() : '';
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    try {
      const tok = await getToken(RUNTIME_DATA_DIR, serverId);
      if (!tok) return res.json({ connected: false });
      res.json({
        connected: true,
        expiresAt: tok.expiresAt ?? null,
        scope: tok.scope ?? null,
        savedAt: tok.savedAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/mcp/oauth/disconnect', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const serverId =
      typeof req.body?.serverId === 'string' ? req.body.serverId.trim() : '';
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    try {
      await clearToken(RUNTIME_DATA_DIR, serverId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });


  // ----------------------------------------------------------------
  // Cloud MCP template catalog.
  //
  // Mirrors the skill cloud pattern: MCP templates are stored as HDW
  // resources (kind = "mcp") and surfaced through these routes.
  // ----------------------------------------------------------------

  app.get('/api/workspace/mcp/cloud/check', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const workspaceId = getWorkspaceId(req);
    const label = typeof req.query.label === 'string' ? req.query.label.trim() : '';
    if (!workspaceId || !label) {
      return res.status(400).json({ error: 'workspace_id and label are required' });
    }
    try {
      const data = await hdwGetRaw<{ exists?: boolean }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources/check`, { kind: 'mcp', name: label }, getSsoCookies());
      res.json({ exists: data?.exists ?? false });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp check failed' });
    }
  });

  app.get('/api/workspace/mcp/cloud', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.json({ templates: [] });
  try {
     const params: Record<string, string> = { kind: 'mcp' };
     // owner_member_id is optional: when provided, results are filtered
     // to that owner (my-publishes). When absent, all resources are
     // returned (community browse). Do NOT default to the caller's
     // member ID from the workspace header.
     const ownerMemberId = typeof req.query.owner_member_id === 'string' ? req.query.owner_member_id : '';
     if (ownerMemberId) params.owner_member_id = ownerMemberId;
     const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
     if (scope) params.scope = scope;
     const raw = await hdwGetRaw<{ resources: Array<Record<string, unknown>> }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources`, params, getSsoCookies());
      const templates = (raw?.resources ?? []).map((r) => {
        const meta = (r.metadata as Record<string, unknown>) ?? {};
       // Backfill id for templates published before the id-generation
       // fix so the cloud list can match installed servers correctly.
       const id = typeof meta.id === 'string' && meta.id.trim()
         ? meta.id
         : suggestServerId(String(meta.label ?? ''), new Set());
       // Force id = templateId = label for consistency.
        return {
          resourceId: r.id as string,
          ownerMemberId: r.ownerMemberId as string,
          ...(r.scope ? { scope: r.scope as string } : {}),
          ...meta,
          publisherName:
            (typeof meta.publisherName === 'string' && meta.publisherName.trim())
              ? meta.publisherName.trim()
              : (typeof r.ownerDisplayName === 'string' && r.ownerDisplayName.trim())
                ? r.ownerDisplayName.trim()
                : (r.ownerMemberId as string),
         id,
         templateId: id,
         label: id,
         createdAt: r.createdAt as string,
         updatedAt: r.updatedAt as string,
       };
      });
      res.json({ templates });
   } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp list failed' });
    }
  });

  app.post('/api/workspace/mcp/cloud', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const workspaceId = getWorkspaceId(req);
    const ownerMemberId = getOwnerMemberId(req);
    if (!workspaceId || !ownerMemberId) {
      return res.status(400).json({ error: 'workspace_id and owner_member_id are required' });
    }
  const template = req.body?.template;
  if (!template || typeof template !== 'object') {
    return res.status(400).json({ error: 'template is required' });
  }
 // Ensure the template has a stable id slug derived from its label.
 // This id becomes the templateId when the template is installed locally,
 // so the cloud list can correctly show "installed" status.
 const tplObj = template as Record<string, unknown>;
 if (typeof tplObj.id !== 'string' || !tplObj.id.trim()) {
   tplObj.id = suggestServerId(String(tplObj.label ?? ''), new Set());
 }
 // Force id = templateId = label for consistency.
 tplObj.templateId = tplObj.id;
 tplObj.label = tplObj.id;
try {
     const scope = typeof req.body?.scope === 'string' ? req.body.scope : null;
     const data = await hdwPost<{ resource: Record<string, unknown> }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources`, {
       kind: 'mcp',
       ownerMemberId,
       metadata: tplObj,
       ...(scope ? { scope } : {}),
     }, getSsoCookies());
      if (!data) {
        return res.status(502).json({ error: 'HDW cloud create failed' });
      }
      const tpl = {
        resourceId: data.resource.id as string,
        ownerMemberId: data.resource.ownerMemberId as string,
        ...(data.resource.scope ? { scope: data.resource.scope as string } : {}),
        ...((data.resource.metadata as Record<string, unknown>) ?? {}),
        createdAt: data.resource.createdAt as string,
        updatedAt: data.resource.updatedAt as string,
      };
      res.json({ template: tpl });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp create failed' });
    }
  });

  app.put('/api/workspace/mcp/cloud/:resourceId', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const resourceId = typeof req.params.resourceId === 'string' ? decodeURIComponent(req.params.resourceId) : '';
    if (!resourceId) return res.status(400).json({ error: 'invalid resource id' });
   const template = req.body?.template;
   if (!template || typeof template !== 'object') {
     return res.status(400).json({ error: 'template is required' });
   }
   try {
      const workspaceId = getWorkspaceId(req);
      if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });
      const data = await hdwPut<{ resource: Record<string, unknown> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
        { metadata: template },
        getSsoCookies(),
      );
      if (!data) {
        return res.status(502).json({ error: 'HDW cloud update failed' });
      }
      const tpl = {
        resourceId: data.resource.id as string,
        ownerMemberId: data.resource.ownerMemberId as string,
        ...((data.resource.metadata as Record<string, unknown>) ?? {}),
        createdAt: data.resource.createdAt as string,
        updatedAt: data.resource.updatedAt as string,
      };
      res.json({ template: tpl });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp update failed' });
    }
  });

 app.delete('/api/workspace/mcp/cloud/:resourceId', async (req, res) => {
   if (!isLocalSameOrigin(req, getResolvedPort())) {
     return res.status(403).json({ error: 'cross-origin request rejected' });
   }
  const resourceId = typeof req.params.resourceId === 'string' ? decodeURIComponent(req.params.resourceId) : '';
  if (!resourceId) return res.status(400).json({ error: 'invalid resource id' });
  try {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });
    // Ownership verification: fetch the resource and confirm the
    // caller's member ID matches the resource owner before deleting.
    if (!hdwClient) return res.status(503).json({ error: 'HDW_CLOUD_NOT_CONFIGURED' });
    const record = await hdwClient.getResource(workspaceId, resourceId);
    if (!record) {
      return res.status(404).json({ error: 'CLOUD_MCP_NOT_FOUND' });
    }
    if (record.ownerMemberId !== getOwnerMemberId(req)) {
      return res.status(403).json({ error: 'NOT_RESOURCE_OWNER', message: 'you can only delete resources you own' });
    }
     const data = await hdwDelete(
       `/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
       getSsoCookies(),
     );
      if (!data) {
        return res.status(502).json({ error: 'HDW cloud delete failed' });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp delete failed' });
    }
  });

app.post('/api/workspace/mcp/cloud/:resourceId/install', async (req, res) => {
  if (!isLocalSameOrigin(req, getResolvedPort())) {
    return res.status(403).json({ error: 'cross-origin request rejected' });
  }
  const resourceId = typeof req.params.resourceId === 'string' ? decodeURIComponent(req.params.resourceId) : '';
  if (!resourceId) return res.status(400).json({ error: 'invalid resource id' });
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });
  if (!hdwClient) return res.status(503).json({ error: 'HDW_CLOUD_NOT_CONFIGURED' });
  try {
     // Allow cross-workspace lookup for shared resources.
     const homeWsId = typeof req.query.home_workspace_id === 'string' ? req.query.home_workspace_id : '';
      const lookupWsId = homeWsId || workspaceId;
      const record = await hdwClient.getResource(lookupWsId, resourceId);
      if (!record) {
        return res.status(404).json({ error: 'CLOUD_MCP_NOT_FOUND' });
      }
      const cloudTpl = {
        resourceId: record.id,
        ownerMemberId: record.ownerMemberId,
        ...((record.metadata as Record<string, unknown>) ?? {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } as McpTemplate & { resourceId: string; ownerMemberId: string; createdAt: string; updatedAt: string };
     const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
     const taken = new Set(cfg.servers.map((s) => s.id));
     const existing = cfg.servers.find((s) => s.templateId === cloudTpl.id);
     if (existing) {
       return res.json({ installed: true, serverId: existing.id });
     }
    const server = templateToServer(cloudTpl, taken);
    if (!server) {
      return res.status(400).json({ error: 'template is missing required fields (command or url)' });
    }
    // Stamp workspace ownership so the composer "+" menu can filter
    // "Mine" (ownerMemberId === requesting member) and "Team"
    // (workspaceId === team workspace) locally without a cloud round-trip.
    server.ownerMemberId = cloudTpl.ownerMemberId || getOwnerMemberId(req);
    server.workspaceId = workspaceId;
    const sanitized = sanitizeMcpServer(server);
     if (!sanitized) {
       return res.status(400).json({ error: 'derived server config failed validation' });
     }
     cfg.servers.push(sanitized);
     await writeMcpConfig(RUNTIME_DATA_DIR, { servers: cfg.servers });
     res.json({ installed: true, serverId: sanitized.id });
   } catch (err) {
     res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp install failed' });
   }
 });

app.delete('/api/workspace/mcp/cloud/:resourceId/uninstall', async (req, res) => {
  if (!isLocalSameOrigin(req, getResolvedPort())) {
    return res.status(403).json({ error: 'cross-origin request rejected' });
  }
  const resourceId = typeof req.params.resourceId === 'string' ? decodeURIComponent(req.params.resourceId) : '';
  if (!resourceId) return res.status(400).json({ error: 'invalid resource id' });
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });
  if (!hdwClient) return res.status(503).json({ error: 'HDW_CLOUD_NOT_CONFIGURED' });
  try {
     const homeWsId = typeof req.query.home_workspace_id === 'string' ? req.query.home_workspace_id : '';
      const lookupWsId = homeWsId || workspaceId;
      const record = await hdwClient.getResource(lookupWsId, resourceId);
      if (!record) {
        return res.status(404).json({ error: 'CLOUD_MCP_NOT_FOUND' });
      }
      const cloudTpl = {
        resourceId: record.id,
        ownerMemberId: record.ownerMemberId,
        ...((record.metadata as Record<string, unknown>) ?? {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } as McpTemplate & { resourceId: string; ownerMemberId: string; createdAt: string; updatedAt: string };
     const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
     const match = cfg.servers.find((s) => s.templateId === cloudTpl.id);
     if (!match) {
       return res.json({ ok: true, serverId: '' });
     }
     const next = cfg.servers.filter((s) => s.id !== match.id);
     await writeMcpConfig(RUNTIME_DATA_DIR, { servers: next });
     res.json({ ok: true, serverId: match.id });
   } catch (err) {
     res.status(500).json({ error: err instanceof Error ? err.message : 'cloud mcp uninstall failed' });
   }
 });


  // ── Tool cloud routes (kind: 'tool') ──────────────────────────────────
  // Tools are lightweight URL bookmarks published to the community. They
  // share the same HDW resource system as MCP/Skill (kind: 'tool') but have
 // no install/uninstall lifecycle — only list, create, and delete.

  app.get('/api/workspace/tool/cloud/check', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const workspaceId = getWorkspaceId(req);
    const label = typeof req.query.label === 'string' ? req.query.label.trim() : '';
    if (!workspaceId || !label) {
      return res.status(400).json({ error: 'workspace_id and label are required' });
    }
    try {
      const data = await hdwGetRaw<{ exists?: boolean }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources/check`, { kind: 'tool', name: label }, getSsoCookies());
      res.json({ exists: data?.exists ?? false });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud tool check failed' });
    }
  });

  app.get('/api/workspace/tool/cloud', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.json({ tools: [] });
    try {
      const params: Record<string, string> = { kind: 'tool' };
      const ownerMemberId = typeof req.query.owner_member_id === 'string' ? req.query.owner_member_id : '';
      if (ownerMemberId) params.owner_member_id = ownerMemberId;
      const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
     if (scope) params.scope = scope;
    const raw = await hdwGetRaw<{ resources: Array<Record<string, unknown>> }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources`, params, getSsoCookies());
    const tools = (raw?.resources ?? []).map((r) => ({
      resourceId: r.id as string,
        ownerMemberId: r.ownerMemberId as string,
        ...(r.scope ? { scope: r.scope as string } : {}),
        ...((r.metadata as Record<string, unknown>) ?? {}),
        publisherName:
          (typeof (r.metadata as Record<string, unknown> | undefined)?.publisherName === 'string'
            && String((r.metadata as Record<string, unknown>).publisherName).trim())
            ? String((r.metadata as Record<string, unknown>).publisherName).trim()
            : (typeof r.ownerDisplayName === 'string' && r.ownerDisplayName.trim())
              ? r.ownerDisplayName.trim()
              : (r.ownerMemberId as string),
        createdAt: r.createdAt as string,
        updatedAt: r.updatedAt as string,
      }));
      res.json({ tools });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud tool list failed' });
    }
  });

  app.post('/api/workspace/tool/cloud', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const workspaceId = getWorkspaceId(req);
    const ownerMemberId = getOwnerMemberId(req);
    if (!workspaceId || !ownerMemberId) {
      return res.status(400).json({ error: 'workspace_id and owner_member_id are required' });
    }
    const metadata = req.body?.metadata;
    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({ error: 'metadata is required' });
    }
   try {
     const scope = typeof req.body?.scope === 'string' ? req.body.scope : null;
     const data = await hdwPost<{ resource: Record<string, unknown> }>(`/workspaces/${encodeURIComponent(workspaceId)}/resources`, {
       kind: 'tool',
       ownerMemberId,
       metadata,
       ...(scope ? { scope } : {}),
     }, getSsoCookies());
      if (!data) {
        return res.status(502).json({ error: 'HDW cloud create failed' });
      }
      const tool = {
        resourceId: data.resource.id as string,
        ownerMemberId: data.resource.ownerMemberId as string,
        ...(data.resource.scope ? { scope: data.resource.scope as string } : {}),
        ...((data.resource.metadata as Record<string, unknown>) ?? {}),
        createdAt: data.resource.createdAt as string,
        updatedAt: data.resource.updatedAt as string,
      };
      res.json({ tool });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud tool create failed' });
    }
  });

  app.delete('/api/workspace/tool/cloud/:resourceId', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
   const resourceId = typeof req.params.resourceId === 'string' ? decodeURIComponent(req.params.resourceId) : '';
   if (!resourceId) return res.status(400).json({ error: 'invalid resource id' });
   try {
     const workspaceId = getWorkspaceId(req);
     if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' });
      if (!hdwClient) return res.status(503).json({ error: 'HDW_CLOUD_NOT_CONFIGURED' });
    const record = await hdwClient.getResource(workspaceId, resourceId);
    if (!record) {
      return res.status(404).json({ error: 'CLOUD_TOOL_NOT_FOUND' });
      }
      if (record.ownerMemberId !== getOwnerMemberId(req)) {
        return res.status(403).json({ error: 'NOT_RESOURCE_OWNER', message: 'you can only delete resources you own' });
      }
     const data = await hdwDelete(
       `/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
       getSsoCookies(),
     );
      if (!data) {
        return res.status(502).json({ error: 'HDW cloud delete failed' });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'cloud tool delete failed' });
    }
  });
}

function getPublicBaseUrl(req: any) {
  const env = process.env.OD_PUBLIC_BASE_URL;
  if (env && /^https?:\/\//i.test(env)) {
    return env.replace(/\/+$/u, '');
  }
  const proto = req.protocol || 'http';
  const host = req.get('host');
  if (!host) return `http://localhost:${process.env.OD_PORT ?? '7456'}`;
  return `${proto}://${host}`;
}

function mcpOAuthCallbackUrl(req: any) {
  return `${getPublicBaseUrl(req)}/api/mcp/oauth/callback`;
}

function renderOAuthResultPage(opts: any) {
  const ok = Boolean(opts.ok);
  const title = ok ? 'Connected' : 'Authorization failed';
  const heading = ok ? '✅ Connected' : '⚠️ Authorization failed';
  const body = ok
    ? `Your MCP server <code>${escapeHtml(opts.serverId ?? '')}</code> is now connected. You can close this tab and return to HiDesign.`
    : escapeHtml(opts.message ?? 'Authorization could not be completed.');
  const accent = ok ? '#1a7f37' : '#cf222e';
  const payload = ok
    ? { type: 'mcp-oauth', ok: true, serverId: opts.serverId ?? null }
    : { type: 'mcp-oauth', ok: false, message: opts.message ?? null };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — HiDesign</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif;
    background: #f6f7f9; color: #1f2328; padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    .card { background: #161b22; border-color: #30363d; }
    code { background: #1f242c; }
  }
  .card {
    max-width: 420px; width: 100%; padding: 28px 28px 22px; border-radius: 12px;
    background: white; border: 1px solid #d0d7de; box-shadow: 0 8px 24px rgba(0,0,0,.06);
    text-align: left;
  }
  h1 { margin: 0 0 8px; font-size: 18px; color: ${accent}; }
  p  { margin: 0 0 16px; font-size: 14px; line-height: 1.55; }
  code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
  button {
    appearance: none; border: 1px solid #d0d7de; background: white;
    border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
  }
  button:hover { background: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    button { background: #21262d; border-color: #30363d; color: #e6edf3; }
    button:hover { background: #30363d; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${body}</p>
    <button type="button" onclick="window.close()">Close this tab</button>
  </div>
  <script>
    try {
      var payload = ${JSON.stringify(payload)};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, '*');
      }
      if (window.BroadcastChannel) {
        var bc = new BroadcastChannel('open-design-mcp-oauth');
        bc.postMessage(payload);
        bc.close();
      }
    } catch (e) { /* ignore postMessage failures */ }
  </script>
</body>
</html>`;
}

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
