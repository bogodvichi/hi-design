// hdw cloud HTTP client — the transport layer for the hdw ResourceHub service.
//
// This mirrors the CollabCloudClient pattern: a factory with injectable
// fetch/config/timeout, constants-scoped address config, and a from-env
// constructor that always returns a usable client. `OD_HDW_API_TOKEN`
// remains the only HDW environment input.
//
// Unlike the vela CLI transport which shells out to a binary, this talks
// directly to the hdw REST API. Auth is a bearer token (OD_HDW_API_TOKEN);
// workspace identity is carried as request headers so hdw can authorize
// per-workspace without a shared session.

import {
  resolveHdwAddress,
} from '../http/hdw-constants.js';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/** Constants-derived address config for the hdw ResourceHub API. */
export interface HdwCloudConfig {
  baseUrl: string;
  token: string | null;
  /** Path prefix prepended to every request path. */
  pathPrefix?: string;
  /** SSO cookies for cookie-based auth, used when no bearer token is set. */
  cookies?: { name: string; value: string }[];
}

export function readHdwCloudConfig(
  env: NodeJS.ProcessEnv = process.env,
): HdwCloudConfig | null {
  return {
    ...resolveHdwAddress(env),
    token: env.OD_HDW_API_TOKEN?.trim() || null,
  };
}

export function hasExplicitHdwCloudConfig(
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return true;
}

export class HdwCloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `hdw cloud error ${status} (${code})`);
    this.name = 'HdwCloudError';
  }
}

export interface HdwCloudClientOptions {
  config?: HdwCloudConfig;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createHdwCloudClient(options: HdwCloudClientOptions = {}) {
  const config = options.config ?? readHdwCloudConfig();
  if (!config) {
    throw new Error('hdw cloud is not configured');
  }
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const pathPrefix = config!.pathPrefix ?? resolveHdwAddress().pathPrefix;

  /** Prepend the configured path prefix to a request path. */
  function prefixedPath(path: string): string {
    return pathPrefix + path;
  }

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...extra,
    };
   if (config!.token) headers.authorization = `Bearer ${config!.token}`;
   else if (config!.cookies?.length)
     headers.cookie = config!.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
   return headers;
 }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; payload: T; etag: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
   try {
      const response = await fetchImpl(new URL(prefixedPath(path), config!.baseUrl), {
        method,
        headers: authHeaders(extraHeaders),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const etag = response.headers.get('etag');
      if (response.status === 304) {
        return { status: 304, payload: {} as T, etag };
      }
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const code = typeof payload?.error === 'string' ? payload.error : 'unknown';
        throw new HdwCloudError(response.status, code, payload?.message);
      }
    return { status: response.status, payload: payload as T, etag };
   } finally {
     clearTimeout(timeout);
   }
 }

 return {
   isConfigured(): boolean {
     return true;
   },

    get baseUrl(): string {
      return config!.baseUrl;
    },

    /** Raw request escape hatch for adapter-level callers. */
    request,

    /** Upload a manifest + missing blobs and advance the published ref. */
    async publishResource(
      workspaceId: string,
      resourceId: string,
      body: {
        kind: string;
        manifest: HdwManifest;
        metadata?: Record<string, unknown> | null;
        ref?: string;
        ownerMemberId?: string;
        scope?: string;
      },
    ): Promise<HdwPublishResult> {
      const { payload } = await request<HdwPublishResult>(
        'PUT',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/versions`,
        body,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload;
    },

    /** Read the published head version without downloading content. */
    async getPublishedHead(
      workspaceId: string,
      resourceId: string,
      ref = 'published',
    ): Promise<HdwVersionHead | null> {
      try {
        const { payload } = await request<HdwVersionHead>(
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/refs/${encodeURIComponent(ref)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Materialize the published tree into the caller's local copy. */
    async pullResource(
      workspaceId: string,
      resourceId: string,
      ref = 'published',
    ): Promise<HdwPullResult | null> {
      try {
        const { payload } = await request<HdwPullResult>(
          'POST',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}/materialize`,
          { ref },
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Soft-delete a resource (tombstone). */
    async removeResource(workspaceId: string, resourceId: string): Promise<void> {
      try {
        await request<void>(
          'DELETE',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return;
        throw error;
      }
    },

    /** Upload a single blob by digest (raw body). */
    async uploadBlob(workspaceId: string, digest: string, data: Buffer): Promise<void> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
      const response = await fetchImpl(
        new URL(
          prefixedPath(`/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(digest)}`),
          config!.baseUrl,
        ),
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-hdw-workspace-id': workspaceId,
            ...(config!.token ? { authorization: `Bearer ${config!.token}` } : {}),
          },
          body: data,
          signal: controller.signal,
        },
      );
        if (!response.ok) {
          const text = await response.text();
          let code = 'unknown';
          try {
            const payload = JSON.parse(text);
            code = typeof payload?.error === 'string' ? payload.error : 'unknown';
          } catch {
            // keep default
          }
          throw new HdwCloudError(response.status, code, text);
        }
      } finally {
        clearTimeout(timeout);
      }
    },

    /** Download a single blob by digest. Returns the raw bytes. */
    async downloadBlob(workspaceId: string, digest: string): Promise<Buffer> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
      const response = await fetchImpl(
        new URL(
          prefixedPath(`/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(digest)}`),
          config!.baseUrl,
        ),
        {
          method: 'GET',
          headers: {
            'x-hdw-workspace-id': workspaceId,
            ...(config!.token ? { authorization: `Bearer ${config!.token}` } : {}),
          },
          signal: controller.signal,
        },
      );
        if (!response.ok) {
          throw new HdwCloudError(response.status, 'blob_fetch_failed');
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } finally {
        clearTimeout(timeout);
      }
    },

   async listResources(
     workspaceId: string,
     kind?: string,
     ownerMemberId?: string,
     scope?: string,
   ): Promise<HdwResourceRecord[]> {
     const params = new URLSearchParams();
     if (kind) params.set('kind', kind);
     if (ownerMemberId) params.set('owner_member_id', ownerMemberId);
     if (scope) params.set('scope', scope);
     const qs = params.toString() ? '?' + params : '';
    const { payload } = await request<{ resources: HdwResourceRecord[] }>(
      'GET',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/resources${qs}`,
      undefined,
      { 'x-hdw-workspace-id': workspaceId },
    );
    return payload.resources ?? [];
  },

    /** Fetch a single resource by ID. Does not filter by owner — any
     *  resource visible in the workspace is returned. Used by install /
     *  uninstall flows that need to resolve a resourceId regardless of
     *  who published it. */
    async getResource(
      workspaceId: string,
      resourceId: string,
    ): Promise<HdwResourceRecord | null> {
      try {
        const { payload } = await request<HdwResourceRecord>(
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/${encodeURIComponent(resourceId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Check whether a resource with the given kind+name already exists.
     *  Mirrors the HDW resources/check endpoint. */
    async checkResource(
      workspaceId: string,
      kind: string,
      name: string,
    ): Promise<boolean> {
      const params = new URLSearchParams();
      params.set('kind', kind);
      params.set('name', name);
      const { payload } = await request<{ exists: boolean }>(
        'GET',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/resources/check?${params}`,
        undefined,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload.exists ?? false;
    },

    /** List team projects for a workspace. The HDW backend already
     *  JOINs workspace_members to provide ownerDisplayName. */
    async listTeamProjects(
      workspaceId: string,
      folderId?: string | null,
    ): Promise<HdwTeamProjectRecord[]> {
      const qs = folderId === null
        ? '?folder_id=root'
        : folderId
          ? `?folder_id=${encodeURIComponent(folderId)}`
          : '';
      const { payload } = await request<{ projects: HdwTeamProjectRecord[] }>(
        'GET',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects${qs}`,
        undefined,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload.projects ?? [];
    },

    /** Get a single team project. */
    async getTeamProject(
      workspaceId: string,
      projectId: string,
    ): Promise<HdwTeamProjectRecord | null> {
      try {
        const { payload } = await request<HdwTeamProjectRecord>(
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
        return payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        throw error;
      }
    },

    /** Upsert a team project catalog entry. */
    async upsertTeamProject(
      workspaceId: string,
      projectId: string,
      input: HdwUpsertTeamProjectInput,
    ): Promise<HdwTeamProjectRecord | null> {
      const { payload } = await request<HdwTeamProjectRecord>(
        'PUT',
        `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
        input,
        { 'x-hdw-workspace-id': workspaceId },
      );
      return payload;
    },

    /** Remove a team project catalog entry. */
    async removeTeamProject(workspaceId: string, projectId: string): Promise<void> {
      try {
        await request<void>(
          'DELETE',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}`,
          undefined,
          { 'x-hdw-workspace-id': workspaceId },
        );
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return;
        throw error;
      }
    },

    /**
     * Transfer a project from one workspace to another. This is a metadata
     * operation: blobs stay where they are, only the resource and catalog
     * rows move.
     */
    async transferProject(
      sourceWorkspaceId: string,
      projectId: string,
      targetWorkspaceId: string,
      targetOwnerMemberId?: string,
      coverDigest?: string | null,
    ): Promise<HdwTransferResult> {
      const { payload } = await request<HdwTransferResult>(
        'POST',
        `/api/workspaces/${encodeURIComponent(sourceWorkspaceId)}/team-projects/${encodeURIComponent(projectId)}/transfer`,
        {
          targetWorkspaceId,
          ...(targetOwnerMemberId ? { targetOwnerMemberId } : {}),
          ...(coverDigest ? { coverDigest } : {}),
        },
        { 'x-hdw-workspace-id': sourceWorkspaceId },
      );
      return payload;
    },

    /** Move a team project to a folder (or to the workspace root when
     *  folderId is null). Uses the lightweight HDW folder/project/move
     *  endpoint — a single UPDATE on team_projects.folder_id — instead
     *  of the full catalog upsert path. */
    async moveProjectFolder(
      workspaceId: string,
      projectId: string,
      folderId: string | null,
      operatorMemberId?: string,
    ): Promise<void> {
      const { payload } = await request<HdwFolderApiResponse>(
        'POST',
        '/api/folder/project/move',
        {
          folder_id: folderId,
          project_id: projectId,
          workspace_id: workspaceId,
          ...(operatorMemberId ? { operator_member_id: operatorMemberId } : {}),
        },
        { 'x-hdw-workspace-id': workspaceId },
      );
      if (payload.code !== 0) {
        throw new HdwCloudError(200, 'folder_move_failed', payload.error || payload.msg);
      }
    },
  };
}

export type HdwCloudClient = ReturnType<typeof createHdwCloudClient>;

/** Build the client from env, or null when hdw cloud is not configured.
 *  When no bearer token is configured, SSO cookies from `dataDir` are used
 *  for cookie-based auth so the same login that works for the rest of the
 *  HDW integration also works for resource publish/pull. */
export function createHdwCloudClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): HdwCloudClient | null {
  const config = readHdwCloudConfig(env);
  if (!config) return null;
  if (!config.token && dataDir) {
    try {
      const { readSsoConfigFile } = require('../http/hik_logins/hicoo.js');
      const sso = readSsoConfigFile(dataDir);
      if (sso?.cookies?.length) config.cookies = sso.cookies;
    } catch { /* SSO not available — proceed without cookies */ }
  }
  return createHdwCloudClient({ config });
}

// ---- Wire types for hdw REST API ----

export interface HdwManifestEntry {
  path: string;
  digest: string;
  size: number;
  mode?: number;
}

export interface HdwManifest {
  entries: HdwManifestEntry[];
}

export interface HdwPublishResult {
  version: number;
  versionId: string;
  missingBlobs: string[];
}

export interface HdwVersionHead {
  version: number;
  versionId: string;
}

export interface HdwPullResult {
  version: number;
  versionId: string;
  manifest: HdwManifest;
  missingBlobs: string[];
}

export interface HdwResourceRecord {
  id: string;
  kind: string;
  ownerMemberId: string;
  /** Owner display name, enriched from the HDW workspace_members table
   *  by joining ownerMemberId -> workspace_member_id at query time. */
  ownerDisplayName?: string | null;
  metadata?: Record<string, unknown> | null;
  version: number | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HdwTeamProjectRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  resourceId: string;
  ownerMemberId: string;
  displayName: string | null;
  syncState: string;
  lastSyncedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  access?: {
    canView: boolean;
    canComment: boolean;
    canEdit: boolean;
    frozen: boolean;
  };
  metadata?: Record<string, unknown> | null;
  /** Folder this project belongs to (from the `folder_id` column on
   *  `team_projects`). Null/absent = root-level. The HDW backend may
   *  return this as `folder_id` (snake_case). */
  folderId?: string | null;
  folder_id?: string | null;
 /** Owner's display name, enriched from the HDW workspace_members table
  *  by joining ownerMemberId → workspace_member_id at query time. */
 ownerDisplayName?: string | null;
  /** SHA-256 digest of the project's entry screenshot blob. */
  coverDigest?: string | null;
}

export interface HdwUpsertTeamProjectInput {
  resourceId: string;
  displayName?: string | null;
  syncState?: string;
  lastSyncedVersionId?: string | null;
  metadata?: Record<string, unknown> | null;
  ownerMemberId?: string;
  folderId?: string | null;
  coverDigest?: string | null;
}

export interface HdwTransferResult {
  resourceId: string;
  workspaceId: string;
  version: number;
  versionId: string;
  /** The source owner's member ID in the TARGET workspace. The server
   * resolves this by looking up the source member's username and deriving
   * the target workspace_member_id deterministically. */
  targetOwnerMemberId?: string;
}

/** Response shape for HDW api endpoints (folder controllers). These
 *  return HTTP 200 with a code field: 0 = success, -1 = failure. */
export interface HdwFolderApiResponse {
  code: number;
  msg: string;
  data?: unknown;
  error?: string;
}
