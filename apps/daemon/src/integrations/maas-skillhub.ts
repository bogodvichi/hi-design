import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import * as https from 'node:https';
import path from 'node:path';
import JSZip from 'jszip';

import { parseFrontmatter } from '../design-systems/frontmatter.js';
import {
  cookieHeader,
  rawRequest,
  type Cookie,
  type RawResult,
} from '../http/http.js';
import {
  readSsoConfigFile,
  type SsoSession,
} from '../http/hik_logins/hicoo.js';

export const MAAS_SKILLHUB_PROVIDER = 'maas-skillhub';

const MAAS_ORIGIN = 'https://maas.hikvision.com.cn';
const MAAS_APP_URL = `${MAAS_ORIGIN}/maas/`;
const MAAS_API_BASE = `${MAAS_ORIGIN}/api/maas-web-config/component/skill`;
const MAAS_USER_URL = `${MAAS_ORIGIN}/api/maas-web-admin/user/currentUser`;
const MAAS_SPACE_LIST_URL = `${MAAS_ORIGIN}/api/maas-web-config/space/spaceList`;
const MAAS_AES_KEY = Buffer.from('hikvision1234567', 'utf8');
const MAX_SKILL_ZIP_BYTES = 50 * 1024 * 1024;
const LIST_PAGE_SIZE = 200;
const MAX_LIST_PAGES = 20;
const SESSION_CACHE_MS = 5 * 60_000;

export interface MaasSkillhubSkill {
  id: string;
  skillName: string;
  skillSlug?: string;
  skillDesc?: string;
  skillVersion?: string;
  skillType?: string;
  skillSubType?: string;
  userId?: string;
  userName?: string;
  userNotesName?: string;
  iconUrl?: string;
  createTime?: string;
  updateTime?: string;
  isPublic?: boolean;
  downloadCount?: number;
  skillMdContent?: string;
}

interface MaasAuthContext {
  cookies: Cookie[];
  empid: string;
  currentWorkspaceId: string | null;
}

interface MaasSkillhubWorkspace {
  id: string;
  spaceName?: string;
  isDefault?: boolean;
  defaultSpace?: boolean;
  spaceDefault?: boolean;
}

interface BinaryResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface MaasSkillhubClientDeps {
  readSso?: (dataDir: string) => SsoSession | null;
  requestText?: typeof rawRequest;
  requestBinary?: (
    method: string,
    url: string,
    cookies: Cookie[],
    extraHeaders: Record<string, string>,
  ) => Promise<BinaryResult>;
}

function authHeaders(empid: string): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: MAAS_ORIGIN,
    Referer: MAAS_APP_URL,
    'X-Requested-With': 'XMLHttpRequest',
    empid,
    source: 'webContainer',
  };
}

function commonHeaders(workspaceId: string, empid: string): Record<string, string> {
  return {
    ...authHeaders(empid),
    spaceid: workspaceId,
  };
}

function workspaceIdFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'spaceId', 'workspaceId']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function normalizeWorkspaces(value: unknown): MaasSkillhubWorkspace[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? ['data', 'records', 'list', 'items'].flatMap((key) => {
          const nested = (value as Record<string, unknown>)[key];
          return Array.isArray(nested) ? nested : [];
        })
      : [];
  const workspaces = new Map<string, MaasSkillhubWorkspace>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const id = workspaceIdFromUnknown(record);
    if (!id) continue;
    workspaces.set(id, {
      id,
      ...(typeof record.spaceName === 'string' ? { spaceName: record.spaceName } : {}),
      ...(typeof record.isDefault === 'boolean' ? { isDefault: record.isDefault } : {}),
      ...(typeof record.defaultSpace === 'boolean' ? { defaultSpace: record.defaultSpace } : {}),
      ...(typeof record.spaceDefault === 'boolean' ? { spaceDefault: record.spaceDefault } : {}),
    });
  }
  return [...workspaces.values()];
}

function isWorkspacePermissionError(error: unknown): boolean {
  return error instanceof Error && /(?:无空间权限|空间.*权限)/u.test(error.message);
}

function parseApiResponse<T>(result: RawResult, action: string): T {
  let payload: any;
  try {
    payload = JSON.parse(result.body);
  } catch {
    throw new Error(`MAAS Skillhub ${action} returned invalid JSON`);
  }
  if (result.status < 200 || result.status >= 300 || payload?.code !== '0') {
    const message = payload?.msg || payload?.message || payload?.error;
    throw new Error(message ? String(message) : `MAAS Skillhub ${action} failed`);
  }
  return payload.data as T;
}

export function decryptMaasCurrentUser(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string' || !/^[0-9a-f]+$/iu.test(input)) {
    throw new Error('MAAS current user payload is invalid');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', MAAS_AES_KEY, null);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(input, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(decrypted);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('MAAS current user payload could not be decrypted');
  }
}

export function maasSkillLocalId(skill: MaasSkillhubSkill): string {
  const frontmatter = typeof skill.skillMdContent === 'string'
    ? parseFrontmatter(skill.skillMdContent).data
    : {};
  const declaredName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  if (declaredName && /^[a-zA-Z0-9._-]+$/u.test(declaredName) && declaredName !== '.' && declaredName !== '..') {
    return declaredName;
  }
  const preferred = typeof skill.skillSlug === 'string' ? skill.skillSlug.trim() : '';
  if (preferred && /^[a-zA-Z0-9._-]+$/u.test(preferred) && preferred !== '.' && preferred !== '..') {
    return preferred;
  }
  if (!/^[a-zA-Z0-9_-]+$/u.test(skill.id)) {
    throw new Error('MAAS Skillhub skill id is invalid');
  }
  return `maas-skill-${skill.id}`;
}

function safeZipPath(input: string): string {
  const value = input.replaceAll('\\', '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:\//u.test(value)) {
    throw new Error('MAAS Skillhub ZIP contains an invalid path');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('MAAS Skillhub ZIP contains an unsafe path');
  }
  return parts.join('/');
}

export async function extractMaasSkillZip(
  buffer: Buffer,
  destination: string,
  maxBytes = MAX_SKILL_ZIP_BYTES,
): Promise<void> {
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new Error('MAAS Skillhub ZIP is empty or too large');
  }
  const zip = await JSZip.loadAsync(buffer);
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (fileEntries.length === 0) throw new Error('MAAS Skillhub ZIP contains no files');

  const safeNames = fileEntries.map((entry) => safeZipPath(entry.name));
  const topLevelSkill = safeNames.includes('SKILL.md');
  const firstSegments = new Set(safeNames.map((name) => name.split('/')[0]));
  const commonRoot = !topLevelSkill && firstSegments.size === 1
    ? [...firstSegments][0]
    : undefined;
  if (!topLevelSkill && (!commonRoot || !safeNames.includes(`${commonRoot}/SKILL.md`))) {
    throw new Error('MAAS Skillhub ZIP does not contain SKILL.md at its root');
  }

  let extractedBytes = 0;
  for (let index = 0; index < fileEntries.length; index += 1) {
    const entry = fileEntries[index]!;
    const safeName = safeNames[index]!;
    const relativeName = commonRoot ? safeName.slice(commonRoot.length + 1) : safeName;
    if (!relativeName) continue;
    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error(`MAAS Skillhub ZIP contains a symbolic link: ${entry.name}`);
    }
    const content = await entry.async('nodebuffer');
    extractedBytes += content.length;
    if (extractedBytes > maxBytes) throw new Error('MAAS Skillhub ZIP expands beyond 50 MiB');
    const target = path.join(destination, ...relativeName.split('/'));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content, {
      mode: (unixMode & 0o777) || 0o644,
    });
  }
}

export async function installMaasSkillLocally(
  userSkillsRoot: string,
  storageName: string,
  fallbackLocalId: string,
  downloadInto: (destination: string) => Promise<void>,
  allowInstallIdentity?: (localId: string) => boolean | Promise<boolean>,
): Promise<{ dir: string; localId: string }> {
  if (!/^[a-zA-Z0-9._-]+$/u.test(storageName) || storageName === '.' || storageName === '..') {
    throw new Error('MAAS Skillhub storage identity is invalid');
  }
  await fs.promises.mkdir(userSkillsRoot, { recursive: true });
  const stageRoot = await fs.promises.mkdtemp(
    path.join(path.dirname(userSkillsRoot), '.od-maas-skill-'),
  );
  const stagedSkill = path.join(stageRoot, 'skill');
  try {
    await fs.promises.mkdir(stagedSkill, { recursive: true });
    await downloadInto(stagedSkill);
    const manifestPath = path.join(stagedSkill, 'SKILL.md');
    const manifest = await fs.promises.readFile(manifestPath, 'utf8');
    const parsed = parseFrontmatter(manifest);
    const declaredName = typeof parsed.data?.name === 'string' ? parsed.data.name.trim() : '';
    const localId = declaredName || fallbackLocalId.trim();
    if (
      !localId
      || localId.length > 200
      || localId === '.'
      || localId === '..'
      || /[\0-\x1f]/u.test(localId)
    ) {
      throw new Error('Downloaded MAAS Skillhub package has an invalid skill identity');
    }
    if (typeof parsed.body !== 'string' || !parsed.body.trim()) {
      throw new Error('Downloaded MAAS Skillhub package has no workflow instructions');
    }
    if (!declaredName) {
      await fs.promises.writeFile(
        manifestPath,
        `---\nname: ${JSON.stringify(localId)}\n---\n\n${manifest}`,
        'utf8',
      );
    }
    if (allowInstallIdentity && !await allowInstallIdentity(localId)) {
      throw new Error(`A skill named "${localId}" is already installed`);
    }
    const destination = path.join(userSkillsRoot, storageName);
    if (await fs.promises.lstat(destination).then(() => true).catch(() => false)) {
      throw new Error(`A skill named "${localId}" is already installed`);
    }
    await fs.promises.rename(stagedSkill, destination);
    return { dir: destination, localId };
  } finally {
    await fs.promises.rm(stageRoot, { recursive: true, force: true });
  }
}

async function directBinaryRequest(
  method: string,
  urlString: string,
  cookies: Cookie[],
  extraHeaders: Record<string, string>,
): Promise<BinaryResult> {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname + url.search,
        method,
        rejectUnauthorized: false,
        headers: {
          ...extraHeaders,
          Cookie: cookieHeader(cookies, urlString),
          'Content-Length': '0',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_SKILL_ZIP_BYTES) {
            response.destroy(new Error('MAAS Skillhub download exceeds 50 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', finishWithError);
      },
    );
    request.setTimeout(30_000, () => request.destroy(new Error('MAAS Skillhub download timed out')));
    request.on('error', finishWithError);
    request.end();
  });
}

export function createMaasSkillhubClient(
  dataDir: string,
  deps: MaasSkillhubClientDeps = {},
) {
  const readSso = deps.readSso ?? readSsoConfigFile;
  const requestText = deps.requestText ?? rawRequest;
  const requestBinary = deps.requestBinary ?? directBinaryRequest;
  let cachedAuth: { value: MaasAuthContext; expiresAt: number } | null = null;
  let cachedWorkspace: { id: string; empid: string; expiresAt: number } | null = null;

  async function authenticate(): Promise<MaasAuthContext> {
    if (cachedAuth && cachedAuth.expiresAt > Date.now()) return cachedAuth.value;
    const sso = readSso(dataDir);
    if (!sso?.cookies?.length) {
      throw new Error('Please sign in to HiDesign before accessing MAAS Skillhub');
    }
    const appSession = await requestText('GET', MAAS_APP_URL, sso.cookies);
    const userResult = await requestText('GET', MAAS_USER_URL, appSession.cookies, {
      extraHeaders: {
        Accept: 'application/json, text/plain, */*',
        Referer: MAAS_APP_URL,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const encryptedUser = parseApiResponse<unknown>(userResult, 'authentication');
    const user = decryptMaasCurrentUser(encryptedUser);
    const empid = typeof user.userEmpid === 'string' ? user.userEmpid.trim() : '';
    if (!/^HZ[0-9]+$/u.test(empid)) {
      throw new Error('MAAS Skillhub employee identity is unavailable');
    }
    const value = {
      cookies: appSession.cookies,
      empid,
      currentWorkspaceId: workspaceIdFromUnknown(user.curSpace),
    };
    cachedAuth = { value, expiresAt: Date.now() + SESSION_CACHE_MS };
    return value;
  }

  async function resolveWorkspaceId(preferredWorkspaceId?: string): Promise<string> {
    const auth = await authenticate();
    const preferred = preferredWorkspaceId?.trim() || null;
    if (
      cachedWorkspace
      && cachedWorkspace.empid === auth.empid
      && cachedWorkspace.expiresAt > Date.now()
      && (!preferred || preferred === cachedWorkspace.id)
    ) {
      return cachedWorkspace.id;
    }

    const result = await requestText('GET', MAAS_SPACE_LIST_URL, auth.cookies, {
      extraHeaders: authHeaders(auth.empid),
    });
    const workspaces = normalizeWorkspaces(parseApiResponse<unknown>(result, 'workspace list'));
    if (workspaces.length === 0) {
      throw new Error('MAAS Skillhub has no accessible workspace');
    }
    const selected = (preferred ? workspaces.find((workspace) => workspace.id === preferred) : undefined)
      ?? (auth.currentWorkspaceId
        ? workspaces.find((workspace) => workspace.id === auth.currentWorkspaceId)
        : undefined)
      ?? workspaces.find((workspace) => (
        workspace.isDefault === true
        || workspace.defaultSpace === true
        || workspace.spaceDefault === true
        || workspace.spaceName?.trim() === '默认工作空间'
      ))
      ?? (workspaces.length === 1 ? workspaces[0] : undefined);
    if (!selected) {
      throw new Error('MAAS Skillhub has multiple workspaces but no current or default workspace');
    }
    cachedWorkspace = {
      id: selected.id,
      empid: auth.empid,
      expiresAt: Date.now() + SESSION_CACHE_MS,
    };
    return selected.id;
  }

  async function requestApi<T>(
    method: 'GET' | 'POST',
    url: string,
    workspaceId: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const auth = await authenticate();
    const result = await requestText(method, url, auth.cookies, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      extraHeaders: {
        ...commonHeaders(workspaceId, auth.empid),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return parseApiResponse<T>(result, method === 'GET' ? 'request' : 'query');
  }

  async function withResolvedWorkspace<T>(
    preferredWorkspaceId: string | undefined,
    action: (workspaceId: string) => Promise<T>,
  ): Promise<{ workspaceId: string; value: T }> {
    let workspaceId = await resolveWorkspaceId(preferredWorkspaceId);
    try {
      return { workspaceId, value: await action(workspaceId) };
    } catch (error) {
      if (!isWorkspacePermissionError(error)) throw error;
      cachedWorkspace = null;
      const refreshedWorkspaceId = await resolveWorkspaceId();
      if (refreshedWorkspaceId === workspaceId) throw error;
      workspaceId = refreshedWorkspaceId;
      return { workspaceId, value: await action(workspaceId) };
    }
  }

  return {
    async listSkills(search = ''): Promise<{ workspaceId: string; skills: MaasSkillhubSkill[] }> {
      const resolved = await withResolvedWorkspace(undefined, async (workspaceId) => {
        const skills: MaasSkillhubSkill[] = [];
        for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
          const result = await requestApi<{ data?: MaasSkillhubSkill[]; total?: number }>(
            'POST',
            `${MAAS_API_BASE}/availableList`,
            workspaceId,
            {
              currentPage: page,
              pageSize: LIST_PAGE_SIZE,
              skillName: search.trim(),
              orderBy: '1',
              skillSubTypes: [],
              skillType: 'system',
            },
          );
          const pageItems = Array.isArray(result?.data) ? result.data : [];
          skills.push(...pageItems.filter((item) => item && typeof item.id === 'string'));
          const total = typeof result?.total === 'number' ? result.total : skills.length;
          if (skills.length >= total || pageItems.length < LIST_PAGE_SIZE) break;
        }
        return [...new Map(skills.map((skill) => [skill.id, skill])).values()];
      });
      return { workspaceId: resolved.workspaceId, skills: resolved.value };
    },

    async getSkill(
      skillId: string,
      preferredWorkspaceId?: string,
    ): Promise<{ workspaceId: string; skill: MaasSkillhubSkill }> {
      const resolved = await withResolvedWorkspace(
        preferredWorkspaceId,
        (workspaceId) => requestApi<MaasSkillhubSkill>(
          'POST',
          `${MAAS_API_BASE}/detail/${encodeURIComponent(skillId)}`,
          workspaceId,
        ),
      );
      return { workspaceId: resolved.workspaceId, skill: resolved.value };
    },

    async downloadSkillInto(workspaceId: string, skillId: string, destination: string): Promise<void> {
      const auth = await authenticate();
      const result = await requestBinary(
        'POST',
        `${MAAS_API_BASE}/download/${encodeURIComponent(skillId)}`,
        auth.cookies,
        commonHeaders(workspaceId, auth.empid),
      );
      if (result.status < 200 || result.status >= 300 || result.body.subarray(0, 2).toString('binary') !== 'PK') {
        throw new Error('MAAS Skillhub download did not return a valid ZIP');
      }
      await extractMaasSkillZip(result.body, destination);
    },
  };
}

export type MaasSkillhubClient = ReturnType<typeof createMaasSkillhubClient>;
