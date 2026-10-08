import { getSharedSpaceTeamId, getSharedSpaceMemberId, getCollaboratorMemberId } from '../ids.js';
import { UA, type Cookie } from './http.js';
import { readSsoConfigFile, readSsoUsername } from './hik_logins/hicoo.js';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  resolveHdwAddress,
} from './hdw-constants.js';

/**
 * Resolve the HDW REST API base URL from the shared constants.
 */
function resolveHdwBase(env: NodeJS.ProcessEnv = process.env): string {
  const { baseUrl, pathPrefix } = resolveHdwAddress(env);
  return `${baseUrl}${pathPrefix}/api`;
}

export const HDW_BASE = resolveHdwBase();

interface HdwResponse<T> {
  code: number;
  msg: string;
  data?: T;
  error?: string;
}

export async function hdwGet<T>(
  path: string,
  params?: Record<string, string>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] GET ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] GET ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(`[hdw] GET ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

/** Like hdwGet but for endpoints that return raw JSON (not {code,msg,data}).
 *  Used by the resource controller check endpoint. */
export async function hdwGetRaw<T>(
  path: string,
  params?: Record<string, string>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] GET raw ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    return await resp.json() as T;
  } catch (err) {
    console.warn(`[hdw] GET raw ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export async function hdwPost<T>(
  path: string,
  body: Record<string, unknown>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] POST ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] POST ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
  return json.data;
  } catch (err) {
    console.warn(`[hdw] POST ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export async function fetchHiMindLaunch(
  dataDir: string,
  post: typeof hdwPost = hdwPost,
): Promise<{ launchUrl: string; expiresIn: number } | null> {
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim().toLowerCase() ?? '';
  if (!username || !session?.cookies?.length) return null;
  const data = await post<{ launch_url: string; expires_in: number }>(
    '/auth/himind/launch',
    {
      username,
      // The Pixso gateway does not forward the standard Cookie header to the
      // Egg upstream. Send the OA cookie jar as structured server-to-server
      // input so hidesign-web can validate it without exposing it to the web UI.
      oa_cookies: session.cookies.map(({ name, value }) => ({ name, value })),
    },
  );
  if (!data || typeof data.launch_url !== 'string' || !data.launch_url) return null;
  return {
    launchUrl: data.launch_url,
    expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : 60,
  };
}

export async function fetchAiResearchLaunch(
  dataDir: string,
  post: typeof hdwPost = hdwPost,
): Promise<{ launchUrl: string; expiresIn: number } | null> {
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim().toLowerCase() ?? '';
  if (!username || !session?.cookies?.length) return null;
  const data = await post<{ launch_url: string; expires_in: number }>(
    '/auth/ai-research/launch',
    {
      username,
      oa_cookies: session.cookies.map(({ name, value }) => ({ name, value })),
    },
  );
  if (!data || typeof data.launch_url !== 'string' || !data.launch_url) return null;
  return {
    launchUrl: data.launch_url,
    expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : 60,
  };
}

export interface HiMindMcpToken {
  accessToken: string;
  expiresIn: number;
}

interface HiMindMcpTokenWire {
  access_token: string;
  token_type: string;
  expires_in: number;
}

type HiMindMcpTokenPost = (
  path: string,
  body: Record<string, unknown>,
  cookies?: Cookie[],
) => Promise<HiMindMcpTokenWire | null>;

/**
 * Mint a short-lived MCP access token from the central HDW service after it
 * validates the run's OA session. Shared by HiMind and the AI research
 * workbench; only the central endpoint path and error label differ so a token
 * minted for one MCP audience cannot be requested against another by mistake.
 */
async function fetchMcpToken(
  dataDir: string,
  runId: string,
  endpointPath: string,
  serviceLabel: string,
  post: HiMindMcpTokenPost = hdwPost,
): Promise<HiMindMcpToken | null> {
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim().toLowerCase() ?? '';
  if (!username || !session?.cookies?.length) return null;
  const data = await post(
    endpointPath,
    {
      username,
      run_id: runId,
      oa_cookies: session.cookies.map(({ name, value }) => ({ name, value })),
    },
  );
  if (!data) {
    throw new Error(
      `${serviceLabel} MCP token issuance was rejected by the central HDW service; verify the OA session and ${serviceLabel} MCP JWT deployment configuration`,
    );
  }
  if (
    typeof data.access_token !== 'string'
    || !data.access_token.trim()
    || typeof data.token_type !== 'string'
    || data.token_type.toLowerCase() !== 'bearer'
  ) {
    throw new Error(`${serviceLabel} MCP token response from the central HDW service is invalid`);
  }
  return {
    accessToken: data.access_token.trim(),
    expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : 300,
  };
}

export async function fetchHiMindMcpToken(
  dataDir: string,
  runId: string,
  post: HiMindMcpTokenPost = hdwPost,
): Promise<HiMindMcpToken | null> {
  return fetchMcpToken(dataDir, runId, '/auth/himind/mcp-token', 'HiMind', post);
}

export async function fetchAiResearchMcpToken(
  dataDir: string,
  runId: string,
  post: HiMindMcpTokenPost = hdwPost,
): Promise<HiMindMcpToken | null> {
  return fetchMcpToken(dataDir, runId, '/auth/ai-research/mcp-token', 'AI research', post);
}

export async function hdwPutRaw(
  path: string,
  body: Buffer,
  cookies?: Cookie[],
): Promise<boolean> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Folder share — batch-create cloud folders then batch-share all projects
// in those folders to the shared space with folder_id on each share row.
// ---------------------------------------------------------------------------

/**
 * Batch-create cloud folders via HDW `POST /folder/create`. The body is
 * `{ workspace_id, folders: [{ folder_id, folder_pid, folder_name }, ...] }`.
 * HDW idempotently skips folders whose folder_id already exists.
 */
export async function createHdwFolders(
  dataDir: string | undefined,
  input: {
    workspaceId: string;
    folders: Array<{
      folder_id: string;
      folder_pid: string | null;
      folder_name: string;
      recipient_member_id?: string;
    }>;
  },
): Promise<{ created: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ created: number; skipped: number }>(
    '/folder/create',
    {
      workspace_id: input.workspaceId,
      folders: input.folders,
    },
    session?.cookies,
  );
}

/**
 * Batch-create folder_shares records via HDW `POST /folder/share`.
 * Each record maps a folder_id to a recipient_member_id so the cloud
 * knows which users a folder (and its future subfolders) was shared to.
 * HDW idempotently skips duplicates (folder_id + recipient_member_id).
 */
export async function createHdwFolderShares(
  dataDir: string | undefined,
  input: {
    workspaceId: string;
    shares: Array<{
      folder_id: string;
      recipient_member_id: string;
      shared_by_username?: string;
      shared_by_member_id?: string;
    }>;
  },
): Promise<{ created: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ created: number; skipped: number }>(
    '/folder/share',
    {
      workspace_id: input.workspaceId,
      shares: input.shares,
    },
    session?.cookies,
  );
}

/**
 * Fetch the recipient_member_ids for a folder via HDW
 * `GET /folder/shares?folder_id=<id>`. Returns the list of
 * member IDs the folder was shared to. Used when creating a new
 * subfolder under an already-shared parent: the new subfolder
 * inherits the parent's share recipients.
 */
export async function fetchHdwFolderShareRecipients(
  dataDir: string | undefined,
  folderId: string,
): Promise<string[]> {
  if (!dataDir) return [];
  const session = readSsoConfigFile(dataDir);
  const data = await hdwGet<{ recipients: Array<{ recipient_member_id: string }> }>(
    '/folder/shares',
    { folder_id: folderId },
    session?.cookies,
  );
  if (!data?.recipients) return [];
  return data.recipients
    .map((r) => r.recipient_member_id)
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
}

/**
 * Check whether a folder exists on the HDW cloud by querying
 * `GET /folder/detail?folder_id=<id>`. Returns the folder record
 * (with folder_pid, folder_name) or null when the folder is not
 * found on the cloud.
 */
/**
 * Unshare a folder (and all its descendants) from a recipient via HDW
 * `DELETE /folder/unshare`. The HDW endpoint recursively finds all
 * descendant folders, deletes their `folder_shares` records, and removes
 * the corresponding `workspace_project_shares` rows for that recipient.
 *
 * Returns true on success, false on failure.
 */
export async function unshareHdwFolder(
  dataDir: string | undefined,
  input: { workspaceId: string; folderId: string; recipientMemberId: string },
): Promise<boolean> {
  if (!dataDir) return false;
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/folder/unshare`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        folder_id: input.folderId,
        recipient_member_id: input.recipientMemberId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

export async function fetchHdwFolderTree(
  dataDir: string | undefined,
  folderId: string,
  workspaceId?: string,
): Promise<Array<{ folderId: string; folderPid: string | null; folderName: string; projectIds: string[] }> | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  const data = await hdwGet<{ folders: Array<{ folderId: string; folderPid: string | null; folderName: string; projectIds: string[] }> }>(
    '/folder/tree',
    { folder_id: folderId, ...(workspaceId ? { workspace_id: workspaceId } : {}) },
    session?.cookies,
  );
  return data?.folders ?? null;
}

export async function fetchHdwFolderDetail(
  dataDir: string | undefined,
  folderId: string,
): Promise<{ folder_id: string; folder_pid: string | null; folder_name: string } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  const data = await hdwGet<{ folder_id: string; folder_pid: string | null; folder_name: string }>(
    '/folder/detail',
    { folder_id: folderId },
    session?.cookies,
  );
  return data ?? null;
}

/**
 * Batch-share multiple projects to the shared space in one HDW call via
 * `POST /shared-space/share-batch`. Each item carries its folder_id so
 * the HDW `workspace_project_shares` row records which cloud folder the
 * project belongs to.
 */
export async function shareFolderProjectsToSharedSpace(
  dataDir: string | undefined,
  input: {
    homeWorkspaceId: string;
    createdByUsername: string;
    recipients: Array<{ username: string; displayname?: string }>;
    createdByDisplayname?: string | null;
    items: Array<{ project_id: string; folder_id: string; cover_digest?: string | null }>;
  },
): Promise<{ shared: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ shared: number; skipped: number }>(
    '/shared-space/share-batch',
    {
      home_workspace_id: input.homeWorkspaceId,
      created_by_username: input.createdByUsername,
      created_by_member_id: getSharedSpaceMemberId(input.createdByUsername),
      created_by_displayname: input.createdByDisplayname || undefined,
      recipients: input.recipients.map((r) => ({
        ...r,
        recipient_member_id: getSharedSpaceMemberId(r.username),
      })),
      items: input.items.map((item) => ({
        project_id: item.project_id,
        folder_id: item.folder_id,
        ...(item.cover_digest ? { coverDigest: item.cover_digest } : {}),
      })),
    },
    session?.cookies,
  );
}


/**
 * Share one or more projects into a cloud folder. Unlike
 * `shareFolderProjectsToSharedSpace` which is called during the initial
 * folder-share flow (and carries an explicit recipient list), this is the
 * incremental path used when a project is *moved* into an already-shared
 * folder (or one of its descendants). The HDW side walks the folder_shares
 * ancestor chain to discover recipients, so the daemon only needs to supply
 * the folder id and project ids.
 */
export async function shareProjectsIntoSharedFolder(
  dataDir: string | undefined,
  input: {
    workspaceId: string;
    folderId: string;
    projectIds: string[];
    createdByUsername: string;
    createdByDisplayname?: string | null;
    coverDigests?: Array<{ project_id: string; cover_digest: string }>;
  },
): Promise<{ shared: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ shared: number; skipped: number }>(
    '/folder/share-projects',
    {
      workspace_id: input.workspaceId,
      folder_id: input.folderId,
      project_ids: input.projectIds,
      created_by_username: input.createdByUsername,
      created_by_member_id: getSharedSpaceMemberId(input.createdByUsername),
      ...(input.createdByDisplayname ? { created_by_displayname: input.createdByDisplayname } : {}),
      ...(input.coverDigests && input.coverDigests.length > 0 ? { cover_digests: input.coverDigests } : {}),
    },
    session?.cookies,
  );
}

export async function hdwPut<T>(
  path: string,
  body: Record<string, unknown>,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'PUT', headers, body: bodyStr, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] PUT ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] PUT ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(`[hdw] PUT ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export async function hdwDelete<T>(
  path: string,
  cookies?: Cookie[],
): Promise<T | null> {
  try {
    const url = new URL(`${HDW_BASE}${path}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (cookies?.length) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[hdw] DELETE ${path} failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as HdwResponse<T>;
    if (json.code !== 0 || !json.data) {
      console.warn(`[hdw] DELETE ${path} error: code=${json.code} msg=${json.msg} error=${json.error ?? ''}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(`[hdw] DELETE ${path} network error: ${(err as Error).message}`);
    return null;
  }
}

export interface HdwCommunityPublishInput {
  name: string;
  version: string;
  archiveDigest: string;
  archiveSize?: number;
  archiveIntegrity?: string;
  manifestDigest?: string;
  prompt?: string;
  title?: string;
  titleI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
  icon?: string;
  tags?: string[];
  capabilitiesSummary?: string[];
  coverDigest?: string;
  homepage?: string;
  license?: string;
  publisherUsername: string;
  publisherMemberId?: string;
  publisherWorkspaceId?: string;
  publisherDisplayname?: string;
  publisherGithub?: string;
  publisherUrl?: string;
  changelog?: string;
}

export interface HdwCommunityPublishResult {
  pluginId: string;
  versionId: string;
  name: string;
  version: string;
}

const COMMUNITY_AVATAR_MAX_BYTES = 3 * 1024 * 1024;

type CommunityAvatarFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface SyncHdwCommunityAvatarDeps {
  fetchAvatar?: CommunityAvatarFetcher;
  putRaw?: typeof hdwPutRaw;
  post?: (
    path: string,
    body: Record<string, unknown>,
    cookies?: Cookie[],
  ) => Promise<{ synced: boolean } | null>;
}

function isSupportedAvatarImage(data: Buffer): boolean {
  return (
    (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    || (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ])))
    || (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP')
    || (data.length >= 6 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a'))
  );
}

/**
 * Persist the current user's UPlus avatar in HDW's content-addressed blob
 * store, then point the shared community publisher profile at that digest.
 * The profile survives local logout and applies to historical publications.
 */
export async function syncHdwCommunityAvatar(
  dataDir: string,
  usernameValue: string,
  avatarUrlValue: string,
  deps: SyncHdwCommunityAvatarDeps = {},
): Promise<boolean> {
  const username = usernameValue.trim().toLowerCase();
  const avatarUrl = avatarUrlValue.trim();
  if (!username || !avatarUrl) return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(avatarUrl);
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return false;

  const session = readSsoConfigFile(dataDir);
  if (!session?.cookies?.length) return false;

  try {
    const response = await (deps.fetchAvatar ?? fetch)(parsedUrl.toString(), {
      headers: { Accept: 'image/*', 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > COMMUNITY_AVATAR_MAX_BYTES) return false;
    const avatar = Buffer.from(await response.arrayBuffer());
    if (avatar.length === 0 || avatar.length > COMMUNITY_AVATAR_MAX_BYTES || !isSupportedAvatarImage(avatar)) {
      return false;
    }

    const digest = createHash('sha256').update(avatar).digest('hex');
    const uploaded = await (deps.putRaw ?? hdwPutRaw)(
      `/community/blobs/${digest}`,
      avatar,
      session.cookies,
    );
    if (!uploaded) return false;

    const post = deps.post ?? hdwPost<{ synced: boolean }>;
    const result = await post(
      `/community/publishers/${encodeURIComponent(username)}/avatar`,
      {
        avatarDigest: digest,
        oa_cookies: session.cookies.map(({ name, value }) => ({ name, value })),
      },
      session.cookies,
    );
    return result?.synced === true;
  } catch {
    return false;
  }
}

export async function uploadHdwCommunityBlob(
  archivePath: string,
  dataDir: string,
): Promise<{ digest: string; size: number } | null> {
  const session = readSsoConfigFile(dataDir);
  let data: Buffer;
  try {
    data = await fsp.readFile(archivePath);
  } catch {
    return null;
  }
  const digest = createHash('sha256').update(data).digest('hex');
  const ok = await hdwPutRaw(`/community/blobs/${digest}`, data, session?.cookies);
  if (!ok) return null;
  return { digest, size: data.length };
}

export interface HdwPublishDetail {
  ok: boolean;
  result?: HdwCommunityPublishResult;
  errorCode?: number;
  errorMsg?: string;
}

export async function publishHdwCommunityPluginDetailed(
  input: HdwCommunityPublishInput,
  dataDir: string,
): Promise<HdwPublishDetail> {
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/community/plugins`);
    const bodyStr = JSON.stringify(input);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      return { ok: false, errorMsg: `HTTP ${resp.status} ${resp.statusText}` };
    }
    const json = (await resp.json()) as HdwResponse<HdwCommunityPublishResult>;
    if (json.code !== 0 || !json.data) {
      return { ok: false, errorCode: json.code, errorMsg: json.error || json.msg || 'unknown HDW error' };
    }
    return { ok: true, result: json.data };
  } catch (err) {
    return { ok: false, errorMsg: `network error: ${(err as Error).message}` };
  }
}

export interface HdwCommunityPluginDetail {
  version: string;
  prompt?: string;
  title?: string;
  description?: string;
  license?: string;
  capabilitiesSummary?: string[];
  manifestDigest?: string;
  coverDigest?: string;
  tags?: string[];
}

export async function fetchHdwCommunityPluginDetail(
  name: string,
  dataDir: string,
): Promise<HdwCommunityPluginDetail | null> {
  const session = readSsoConfigFile(dataDir);
  return hdwGet<HdwCommunityPluginDetail>(
    `/community/plugins/${encodeURIComponent(name)}`,
    undefined,
    session?.cookies,
  );
}

/**
 * Resolve the version to use for a community plugin publish.
 *
 * HDW treats a plugin name + version as immutable, so re-publishing the same
 * auto-generated project must move to the next free patch number instead of
 * retrying an identical "already exists" version. Mirrors the CLI's previous
 * publish-hdw behavior before this helper was shared between both surfaces.
 */
export function resolveHdwCommunityPublishVersion(
  existingVersion: string | undefined,
  fallbackVersion: string,
): string {
  if (!existingVersion || compareCommunityVersionStrings(existingVersion, fallbackVersion) < 0) {
    return fallbackVersion;
  }
  const parts = existingVersion.split('.');
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return `${parts[0]}.${parts[1]}.${parseInt(parts[2] ?? '0', 10) + 1}`;
  }
  return `${existingVersion}-1`;
}

export const HDW_COMMUNITY_PUBLICATION_VERSION = '0.0.0';

/**
 * A project publish is an immutable community snapshot, not a new version of
 * an earlier card. The attempt id makes each explicit publish unique while
 * keeping retries of that same user action on the same upstream identity.
 */
export function createHdwCommunityPublicationName(
  projectId: string,
  publishAttemptId: string,
): string {
  return createHash('md5')
    .update(projectId)
    .update('\0')
    .update(publishAttemptId)
    .digest('hex');
}

// Compare two simple numeric major.minor.patch strings. Non-numeric or
// missing segments are treated as 0, matching the CLI's previous helper.
function compareCommunityVersionStrings(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  for (let i = 0; i < 3; i += 1) {
    const valueA = parseInt(partsA[i] ?? '0', 10) || 0;
    const valueB = parseInt(partsB[i] ?? '0', 10) || 0;
    if (valueA < valueB) return -1;
    if (valueA > valueB) return 1;
  }
  return 0;
}

export interface HdwTeam {
  workspace_id: string;
  workspace_name: string;
  workspace_member_id: string;
  owner_username: string;
  owner_displayname: string;
  created_at: string;
  role: string;
  joined_at: string;
}

export class HdwTeamDirectoryUnavailableError extends Error {
  constructor() {
    super('Team directory is temporarily unavailable');
    this.name = 'HdwTeamDirectoryUnavailableError';
  }
}

// Retry configuration for upstream HDW reads that are safe to retry.
// Exported so tests can zero out delays without waiting real time.
export const hdwRetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
};

// Retry an async operation with exponential backoff (2x per attempt, equal
// jitter). Returns the first non-null result, or null after all attempts are
// exhausted. Mirrors the backoff conventions in run-retry-policy.ts.
async function withRetry<T>(fn: () => Promise<T | null>): Promise<T | null> {
  const { maxAttempts, baseDelayMs } = hdwRetryConfig;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fn();
    if (result !== null) return result;
    if (attempt < maxAttempts - 1) {
      const raw = baseDelayMs * 2 ** attempt;
      const half = raw / 2;
      const jitter = Math.min(1, Math.max(0, Math.random())) * half;
      await new Promise(resolve => setTimeout(resolve, Math.round(half + jitter)));
    }
  }
  return null;
}

export async function fetchHdwTeams(dataDir: string | undefined): Promise<HdwTeam[]> {
  if (!dataDir) return [];
  const session = readSsoConfigFile(dataDir);
    const username = session?.username?.trim() ?? '';
  if (!username) return [];
  const data = await withRetry(
    () => hdwGet<{ teams: HdwTeam[] }>('/team/my', { username }, session?.cookies),
  );
  // A failed membership read is not an authoritative empty directory.
  // Let callers keep their last successful view and retry after recovery.
  if (!Array.isArray(data?.teams)) throw new HdwTeamDirectoryUnavailableError();
  return data.teams;
}

export interface HdwSharedSpaceInfo {
  workspace_id: string;
  workspace_name: string;
  workspace_type: string;
  workspace_member_id: string;
  collaborator_member_id: string;
  role: string;
}

export interface HdwSharedWithMeProject {
  shareId: string;
  projectId: string;
  homeWorkspaceId: string;
 sharedByUsername: string;
  sharedByDisplayname: string | null;
 sharedAt: string;
  resourceId: string | null;
  ownerMemberId: string | null;
  displayName: string | null;
  syncState: string;
 folderId: string | null;
 metadata: Record<string, unknown> | null;
 lastSyncedVersionId: string | null;
 coverDigest?: string | null;
 access: {
    canView: boolean;
    canComment: boolean;
    canEdit: boolean;
    frozen: boolean;
  };
}

export async function fetchSharedSpaceInfo(
  dataDir: string | undefined,
): Promise<HdwSharedSpaceInfo | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return null;
  const displayName =
    typeof session?.userInfo?.displayName === 'string'
      ? session.userInfo.displayName.trim()
      : '';
  const email =
    typeof session?.userInfo?.email === 'string'
      ? session.userInfo.email.trim()
      : '';
  const params: Record<string, string> = { username };
  if (displayName) params.displayname = displayName;
  if (email) params.email = email;
  const cloud = await hdwGet<HdwSharedSpaceInfo>('/shared-space/info', params, session?.cookies);
  if (cloud) return cloud;
  return {
    workspace_id: getSharedSpaceTeamId(),
    workspace_name: '共享空间',
    workspace_type: 'team',
    workspace_member_id: getSharedSpaceMemberId(username),
    collaborator_member_id: getCollaboratorMemberId(username),
    role: 'member',
  };
}

export async function fetchSharedWithMe(
  dataDir: string | undefined,
): Promise<HdwSharedWithMeProject[]> {
  if (!dataDir) return [];
  const username = readSsoUsername(dataDir);
  if (!username) return [];
  const data = await hdwGet<{ projects: HdwSharedWithMeProject[] }>(
    '/shared-space/shared-with-me',
    { username, recipient_member_id: getSharedSpaceMemberId(username) },
  );
  return data?.projects ?? [];
}

/**
 * Fetch folders from the shared space, filtered by recipient_member_id
 * so only folders shared to the current user are returned. The HDW
 * /folder/list endpoint does not filter server-side, so we filter
 * client-side after fetching.
 *
 * When folderPid is provided, lists subfolders of that folder.
 * When omitted, lists root-level folders (folder_pid IS NULL or empty).
 */
export async function fetchSharedFolders(
  dataDir: string | undefined,
  folderPid?: string | null,
): Promise<{ folders: Array<Record<string, unknown>> }> {
  if (!dataDir) return { folders: [] };
  const session = readSsoConfigFile(dataDir);
  const username = session?.username?.trim() ?? '';
  if (!username) return { folders: [] };
  const recipientMemberId = getSharedSpaceMemberId(username);
  // When fetching shared-with-me folders, do not send workspace_id
  // folders from any team workspace should be visible by recipient.
  const params: Record<string, string> = {};
  if (folderPid) params.folder_pid = folderPid;
  params.recipient_member_id = recipientMemberId;
   const data = await hdwGet<{ folders: Array<Record<string, unknown>> }>(
     '/folder/list',
     params,
     session?.cookies,
   );
   return { folders: data?.folders ?? [] };
}

export async function shareToSharedSpace(
  dataDir: string | undefined,
  input: {
    projectId: string;
    homeWorkspaceId: string;
    createdByUsername: string;
    recipients: Array<{ username: string; displayname?: string }>;
    displayName?: string | null;
    metadata?: Record<string, unknown> | null;
    coverDigest?: string | null;
  },
): Promise<{ shared: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ shared: number; skipped: number }>(
    '/shared-space/share',
   {
     project_id: input.projectId,
     home_workspace_id: input.homeWorkspaceId,
     created_by_username: input.createdByUsername,
     created_by_member_id: getSharedSpaceMemberId(input.createdByUsername),
     ...(input.displayName ? { created_by_displayname: input.displayName } : {}),
     recipients: input.recipients.map((r) => ({
        ...r,
        recipient_member_id: getSharedSpaceMemberId(r.username),
     })),
     ...(input.metadata ? { metadata: input.metadata } : {}),
     ...(input.coverDigest ? { coverDigest: input.coverDigest } : {}),
   },
    session?.cookies,
  );
}

export async function unshareFromSharedSpace(
  dataDir: string | undefined,
  shareId: string,
): Promise<boolean> {
  if (!dataDir) return false;
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/shared-space/${encodeURIComponent(shareId)}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

/** Remove every shared-with-me grant for a source project. */
export async function unshareProjectFromSharedSpace(
  dataDir: string | undefined,
  projectId: string,
): Promise<boolean> {
  if (!dataDir) return false;
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/shared-space/project/${encodeURIComponent(projectId)}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}

export async function downloadHdwCommunityArchive(
  name: string,
  version: string,
  dataDir: string,
): Promise<Buffer | null> {
  try {
    const session = readSsoConfigFile(dataDir);
    const archivePath = `/community/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/archive`;
    const url = new URL(HDW_BASE + archivePath);
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(cook => `${cook.name}=${cook.value}`).join('; ');
    }
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

export const HDW_MARKETPLACE_ID = 'hdw-community';
export const HDW_MARKETPLACE_PATH = '/community/marketplace';
export const HDW_MARKETPLACE_URL = `${HDW_BASE}${HDW_MARKETPLACE_PATH}`;

/**
 * Locally stored mapping of plugin name → cover blob digest.
 *
 * The HDW backend accepts `coverDigest` on the publish endpoint but does not
 * persist or return it in the marketplace manifest. We store the mapping
 * ourselves so `fetchHdwMarketplaceManifestText` can augment each entry with
 * a `coverUrl` pointing to the HDW blob proxy (`/api/hdw/api/community/blobs/<digest>`).
 */
function coverDigestsPath(dataDir: string): string {
  return path.join(dataDir, 'hdw-cover-digests.json');
}

export function readCoverDigests(dataDir: string): Record<string, string> {
  try {
    const text = fs.readFileSync(coverDigestsPath(dataDir), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch { /* file missing or invalid — treat as empty */ }
  return {};
}

export function writeCoverDigest(dataDir: string, pluginName: string, coverDigest: string): void {
  try {
    const digests = readCoverDigests(dataDir);
    digests[pluginName] = coverDigest;
    fs.writeFileSync(coverDigestsPath(dataDir), JSON.stringify(digests, null, 2));
  } catch { /* best-effort: cover will just be missing */ }
}

/**
 * Locally stored deletion state for HDW community plugins.
 *
 * The HDW community marketplace backend has no durable unpublish/delete API
 * that this daemon can rely on today, so we keep a small mirror under the
 * daemon data root. Public `/square` lists filter these entries out; the
 * owner's "my publishes" list includes soft-deleted entries and marks them
 * with `deletedAt` so the UI can show the unpublished state.
 */
export interface HdwCommunityDeletionState {
  [pluginName: string]: {
    deletedAt?: string;
    hardDeleted?: boolean;
  };
}

function hdwCommunityDeletionsPath(dataDir: string): string {
  return path.join(dataDir, 'hdw-community-deletions.json');
}

export function readHdwCommunityDeletions(dataDir: string): HdwCommunityDeletionState {
  try {
    const text = fs.readFileSync(hdwCommunityDeletionsPath(dataDir), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as HdwCommunityDeletionState;
    }
  } catch { /* file missing or invalid — treat as empty */ }
  return {};
}

export function writeHdwCommunityDeletion(dataDir: string, pluginName: string, deletedAt: string): boolean {
  try {
    const state = readHdwCommunityDeletions(dataDir);
    state[pluginName] = { ...(state[pluginName] ?? {}), deletedAt };
    delete state[pluginName]!.hardDeleted;
    fs.writeFileSync(hdwCommunityDeletionsPath(dataDir), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function removeHdwCommunityDeletion(dataDir: string, pluginName: string): boolean {
  try {
    const state = readHdwCommunityDeletions(dataDir);
    delete state[pluginName];
    fs.writeFileSync(hdwCommunityDeletionsPath(dataDir), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function markHdwCommunityHardDeleted(dataDir: string, pluginName: string): boolean {
  try {
    const state = readHdwCommunityDeletions(dataDir);
    state[pluginName] = { hardDeleted: true };
    fs.writeFileSync(hdwCommunityDeletionsPath(dataDir), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

export async function fetchHdwMarketplaceManifestText(
  url: string,
  dataDir: string,
  params?: Record<string, string>,
): Promise<string | null> {
  if (!url.startsWith(HDW_BASE)) return null;
  const hdwPath = url.slice(HDW_BASE.length);
  const session = readSsoConfigFile(dataDir);
  const manifest = await hdwGet<unknown>(hdwPath, params, session?.cookies);
  if (!manifest) return null;
  // Augment plugin entries with coverUrl from locally stored cover digests.
  // The HDW backend does not return coverDigest in the marketplace manifest,
  // so we look up the digest we stored at publish time and construct a
  // coverUrl pointing to the HDW blob proxy endpoint.
  const coverDigests = readCoverDigests(dataDir);
  // Cloud-sourced: check HDW manifest's own cover_digest field first.
  const m = manifest as { plugins?: Array<Record<string, unknown>> };
  if (Array.isArray(m.plugins)) {
    for (const entry of m.plugins) {
      const name = typeof entry.name === 'string' ? entry.name : undefined;
      const cloudDigest = typeof entry.cover_digest === 'string'
        ? entry.cover_digest.trim()
        : undefined;
      if (cloudDigest && !entry.coverUrl) {
        entry.coverUrl = `/api/hdw/api/community/blobs/${cloudDigest}`;
      }
      // Fallback: locally stored digest from publish time.
      if (name && coverDigests[name] && !entry.coverUrl) {
        entry.coverUrl = `/api/hdw/api/community/blobs/${coverDigests[name]}`;
      }
    }
  }
  return JSON.stringify(manifest);
}


// ---------------------------------------------------------------------------
// Resource shares (skill / mcp) - mirrors project sharing but targets the
// workspace_resource_shares table via the HDW resource-share controller.
// ---------------------------------------------------------------------------

export interface HdwSharedWithMeResource {
  shareId: string;
  resourceId: string;
  kind: string;
  homeWorkspaceId: string;
  sharedByUsername: string;
  sharedByDisplayname: string | null;
  sharedAt: string;
  ownerMemberId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function fetchResourcesSharedWithMe(
  dataDir: string | undefined,
  kind: 'skill' | 'mcp',
): Promise<HdwSharedWithMeResource[]> {
  if (!dataDir) return [];
  const username = readSsoUsername(dataDir);
  if (!username) return [];
  const data = await hdwGet<{ resources: HdwSharedWithMeResource[] }>(
    '/resource-share/shared-with-me',
    { username, kind },
  );
  return data?.resources ?? [];
}

export async function shareResourceToSharedSpace(
  dataDir: string | undefined,
  input: {
    resourceId: string;
    kind: 'skill' | 'mcp';
    homeWorkspaceId: string;
    createdByUsername: string;
    recipients: Array<{ username: string; displayname?: string }>;
    displayName?: string | null;
  },
): Promise<{ shared: number; skipped: number } | null> {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  return hdwPost<{ shared: number; skipped: number }>(
    '/resource-share/share',
    {
      resource_id: input.resourceId,
      kind: input.kind,
      home_workspace_id: input.homeWorkspaceId,
      created_by_username: input.createdByUsername,
      ...(input.displayName ? { created_by_displayname: input.displayName } : {}),
      recipients: input.recipients.map((r) => ({
        ...r,
        recipient_member_id: getSharedSpaceMemberId(r.username),
      })),
    },
    session?.cookies,
  );
}

export async function unshareResourceFromSharedSpace(
  dataDir: string | undefined,
  shareId: string,
): Promise<boolean> {
  if (!dataDir) return false;
  const session = readSsoConfigFile(dataDir);
  try {
    const url = new URL(`${HDW_BASE}/resource-share/${encodeURIComponent(shareId)}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    if (session?.cookies?.length) {
      headers.Cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    const resp = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return false;
    const json = (await resp.json()) as HdwResponse<unknown>;
    return json.code === 0;
  } catch {
    return false;
  }
}
