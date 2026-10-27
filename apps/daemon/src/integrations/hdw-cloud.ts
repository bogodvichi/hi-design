import { createHash } from 'node:crypto';
import { hdwSessionHeaders, type HdwSession } from '../http/hdw-session.js';
import { readSsoConfigFile } from '../http/hik_logins/hicoo.js';
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
  DEV_HDW_BASE_URL,
  DEV_HDW_PATH_PREFIX,
  DEV_HDW_BLOB_READ_FALLBACK,
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
  readSession?: () => HdwSession | null;
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
      ...hdwSessionHeaders(options.readSession?.()),
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
        redirect: 'error',
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


  // Two HDW processes can share the Dev database without sharing Blob disks.
  // Only local Egg 7002 may recover existing immutable bytes from the trusted
  // Dev gateway. All catalog reads, mutations and uploads stay on 7002.
  const devBlobRecoveryEnabled = process.env.NODE_ENV !== 'production'
    && config.baseUrl.replace(/\/+$/u, '') === DEV_HDW_BASE_URL
    && pathPrefix === DEV_HDW_PATH_PREFIX;
  const missingBlobMessage = '历史资源文件尚未同步到本机 HDW，请稍后重试或联系管理员。';

  function isLocalManifestMissing(error: unknown): boolean {
    return error instanceof HdwCloudError
      && ((error.status === 503 && error.code === 'local_blob_unavailable')
        || (error.status === 500 && /ENOENT|no such file or directory/iu.test(error.message)));
  }

  /** Authenticated read via a fixed first-party Dev gateway (no redirects). */
  async function readFromTrustedDev<T>(method: 'GET' | 'POST', path: string, workspaceId: string, body?: object): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(DEV_HDW_BLOB_READ_FALLBACK + path), {
        method,
        redirect: 'error',
        headers: authHeaders({ 'x-hdw-workspace-id': workspaceId }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? response.status : 503;
        throw new HdwCloudError(status, 'DEV_BLOB_RECOVERY_UNAVAILABLE', missingBlobMessage);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof HdwCloudError) throw error;
      throw new HdwCloudError(503, 'DEV_BLOB_RECOVERY_UNAVAILABLE', missingBlobMessage);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readBlobFromUrl(url: URL, workspaceId: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'x-hdw-workspace-id': workspaceId,
          ...authHeaders(),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new HdwCloudError(response.status, 'blob_fetch_failed');
      return Buffer.from(await response.arrayBuffer());
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

    async recordCommunityStat(input: {
      resourceType: 'project' | 'skill' | 'mcp' | 'tool';
      resourceId: string;
      metric: 'preview' | 'action';
      actorKey: string;
    }): Promise<HdwCommunityStatRecordResult> {
      const { payload } = await request<HdwCommunityStatRecordResult>(
        'POST',
        '/api/community/stats/record',
        input,
      );
      return payload;
    },

    async queryCommunityStats(
      resources: Array<{ resourceType: 'project' | 'skill' | 'mcp' | 'tool'; resourceId: string }>,
    ): Promise<HdwCommunityStat[]> {
      if (resources.length === 0) return [];
      const { payload } = await request<{ stats?: HdwCommunityStat[] }>(
        'POST',
        '/api/community/stats/query',
        { resources },
      );
      return payload.stats ?? [];
    },

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

    /** Read immutable published Skill trees. Local Dev HDW and remote Dev
     * may have the same database but different Blob disks; recover only when
     * the precise version matches and cloud files are complete. */
    async pullResource(
      workspaceId: string,
      resourceId: string,
      ref = 'published',
    ): Promise<HdwPullResult | null> {
      const resourcePath = '/api/workspaces/' + encodeURIComponent(workspaceId)
        + '/resources/' + encodeURIComponent(resourceId);
      let localSnapshot: HdwPullResult | null = null;
      try {
        const { payload } = await request<HdwPullResult>(
          'POST', resourcePath + '/materialize', { ref }, { 'x-hdw-workspace-id': workspaceId },
        );
        localSnapshot = payload;
      } catch (error) {
        if (error instanceof HdwCloudError && error.status === 404) return null;
        if (!devBlobRecoveryEnabled || ref !== 'published' || !isLocalManifestMissing(error)) throw error;
      }

      if (localSnapshot && (!devBlobRecoveryEnabled || ref !== 'published'
        || !localSnapshot.missingBlobs?.length)) return localSnapshot;

      // The manifest itself may be missing, or it may be present but point at
      // older immutable file bodies missing from 7002. Both cases are read-only.
      let localVersion: HdwVersionHead | null = localSnapshot
        ? { version: localSnapshot.version, versionId: localSnapshot.versionId }
        : null;
      if (!localVersion) {
        try {
          const head = await request<HdwVersionHead>(
            'GET', resourcePath + '/refs/' + encodeURIComponent(ref),
            undefined, { 'x-hdw-workspace-id': workspaceId },
          );
          localVersion = head.payload;
        } catch {
          throw new HdwCloudError(503, 'DEV_BLOB_RECOVERY_UNAVAILABLE', missingBlobMessage);
        }
      }

      const recovered = await readFromTrustedDev<HdwPullResult>(
        'POST', resourcePath + '/materialize', workspaceId, { ref },
      );
      if (!localVersion?.versionId || recovered?.versionId !== localVersion.versionId
        || recovered.version !== localVersion.version) {
        throw new HdwCloudError(409, 'DEV_BLOB_VERSION_MISMATCH', '本地与 Dev 云端的历史资源版本不一致，已停止读取。');
      }
      if (!Array.isArray(recovered.manifest?.entries) || recovered.missingBlobs?.length) {
        throw new HdwCloudError(503, 'DEV_BLOB_RECOVERY_UNAVAILABLE', missingBlobMessage);
      }
      return recovered;
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
          redirect: 'error',
          headers: {
            ...authHeaders(),
            'content-type': 'application/octet-stream',
            'x-hdw-workspace-id': workspaceId,
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

    /** Download bytes locally first. Missing local Dev blobs are read only
     * from the trusted Dev gateway and verified against their content hash. */
    async downloadBlob(workspaceId: string, digest: string): Promise<Buffer> {
      const blobPath = '/api/workspaces/' + encodeURIComponent(workspaceId)
        + '/blobs/' + encodeURIComponent(digest);
      try {
        return await readBlobFromUrl(new URL(prefixedPath(blobPath), config!.baseUrl), workspaceId);
      } catch (error) {
        if (!devBlobRecoveryEnabled || !(error instanceof HdwCloudError)
          || error.status !== 404 || !/^[0-9a-f]{64}$/u.test(digest)) throw error;
        let recovered: Buffer;
        try {
          recovered = await readBlobFromUrl(new URL(DEV_HDW_BLOB_READ_FALLBACK + blobPath), workspaceId);
        } catch {
          throw new HdwCloudError(503, 'DEV_BLOB_RECOVERY_UNAVAILABLE', missingBlobMessage);
        }
        if (createHash('sha256').update(recovered).digest('hex') !== digest) {
          throw new HdwCloudError(502, 'DEV_BLOB_INTEGRITY_FAILED', '历史资源文件校验失败，已停止安装。');
        }
        return recovered;
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
    const read = () => request<{ resources: HdwResourceRecord[] }>(
      'GET',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/resources${qs}`,
      undefined,
      { 'x-hdw-workspace-id': workspaceId },
    );
    // A failed upstream read must not discard the catalog after an isolated
    // database error. Retry this idempotent list once; writes never use this path.
    const { payload } = await read().catch((error: unknown) => {
      if (error instanceof HdwCloudError && error.status === 500 && error.code === 'internal_error') {
        return read();
      }
      throw error;
    });
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
    async removeTeamProject(workspaceId: string, projectId: string, deleteResource = false): Promise<void> {
      try {
        await request<void>(
          'DELETE',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/team-projects/${encodeURIComponent(projectId)}${deleteResource ? '?delete_resource=1' : ''}`,
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
  return createHdwCloudClient({ config, ...(dataDir ? { readSession: () => readSsoConfigFile(dataDir) } : {}) });
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
  scope?: string | null;
  /** Owner display name, enriched from the HDW workspace_members table
   *  by joining ownerMemberId -> workspace_member_id at query time. */
  ownerDisplayName?: string | null;
  metadata?: Record<string, unknown> | null;
  version: number | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: HdwCommunityStat;
}

export interface HdwCommunityStat {
  resourceType: 'project' | 'skill' | 'mcp' | 'tool';
  resourceId: string;
  previewCount: number;
  previewUserCount: number;
  actionCount: number;
  actionUserCount: number;
}

export interface HdwCommunityStatRecordResult {
  counted: boolean;
  stats: HdwCommunityStat;
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
