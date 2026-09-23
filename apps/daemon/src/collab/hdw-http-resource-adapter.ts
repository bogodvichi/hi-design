// hdw HTTP transport for the publish/pull machinery. Instead of shelling out
// to `vela resource push/pull/head/remove`, this adapter talks directly to
// the hdw REST API through the HdwCloudClient. It implements the same
// ResourcePublishAdapter interface so the CollabPublishScheduler can use it
// as a drop-in replacement.
//
// The publish flow is a two-phase content-addressed protocol:
//   1. Scan the project dir, compute file digests, build a manifest.
//   2. PUT the manifest to hdw. hdw checks which blobs it already has and
//      returns either a committed version (all blobs present) or a list of
//      missing digests.
//   3. Upload each missing blob, then re-PUT the manifest. hdw now has all
//      blobs and creates the version + advances the published ref.
//
// The pull flow:
//   1. POST materialize → hdw returns the manifest + list of blob digests.
//   2. Download each blob.
//   3. Write files to the local pull directory based on the manifest.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { HdwCloudClient, HdwManifest, HdwManifestEntry } from '../integrations/hdw-cloud.js';
import type { ResourcePublishAdapter } from './publish-scheduler.js';
import type { ResourceHubPrincipal } from './resource-principal.js';
import { projectResourceIdFor } from '../integrations/vela-team-projects.js';
import { IGNORED_PROJECT_DIR_NAMES } from '../project-ignored-dirs.js';

const PUBLISHED_REF = 'published';
const PROJECT_KIND = 'project';

// Same exclusion list as the vela CLI adapter — secret-bearing entries and
// generated/installed trees must never leave the author's machine.
const EXCLUDED_ENTRIES = new Set([
  '.file-versions',
  '.live-artifacts',
  '.od-skills',
  '.od-frames',
  '.git',
  'node_modules',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.aws',
  '.ssh',
  '.azure',
  '.docker',
  '.gnupg',
  '.kube',
  '.pulumi',
  '.terraform',
  '.git-credentials',
  '.netrc',
  '.pypirc',
  'terraform.tfstate',
  'terraform.tfstate.backup',
]);

const EXCLUDED_PREFIXES = ['.env', 'deriveddata-/'];

function shouldSkipEntry(name: string, isDirectory: boolean): boolean {
  if (EXCLUDED_ENTRIES.has(name)) return true;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (prefix.endsWith('/') && isDirectory && name === prefix.slice(0, -1)) return true;
    if (!prefix.endsWith('/') && name.startsWith(prefix)) return true;
  }
  return false;
}

async function collectManifestEntries(
  dir: string,
  relDir = '',
  out: HdwManifestEntry[] = [],
): Promise<HdwManifestEntry[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith('.artifact.json')) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipEntry(entry.name, true)) continue;
      // Also check against IGNORED_PROJECT_DIR_NAMES for directory-only matching
      if (IGNORED_PROJECT_DIR_NAMES.has(entry.name)) continue;
      await collectManifestEntries(full, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipEntry(entry.name, false)) continue;
    try {
      const data = await readFile(full);
      const digest = createHash('sha256').update(data).digest('hex');
      const st = await stat(full);
      out.push({ path: rel, digest, size: st.size, mode: st.mode & 0o777 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  return out;
}

export interface HdwHttpResourceAdapterOptions {
  /** The project's source directory to publish (managed-project root). */
  resolveProjectDir: (projectId: string) => string | Promise<string>;
  /** Where a member materializes pulled content. Defaults to the project dir. */
  resolvePullDir?: (projectId: string) => string | Promise<string>;
  /** Resource-index metadata for team project discovery/cards. */
  describeProject?: (
    projectId: string,
  ) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  /** (projectId, principal) -> hub resourceId. */
  resourceIdFor?: (projectId: string, principal?: ResourceHubPrincipal | null) => string;
  /** Hub resource kind. */
  kind?: string;
  /** Whether the caller currently has a team identity. */
  hasTeamIdentity: (
    principal?: ResourceHubPrincipal | null,
  ) => boolean | Promise<boolean>;
  /** The hdw cloud client. */
  client: HdwCloudClient;
}

export function createHdwHttpResourceAdapter(
  options: HdwHttpResourceAdapterOptions,
): ResourcePublishAdapter {
  const resolvePullDir = options.resolvePullDir ?? options.resolveProjectDir;
  const resourceIdFor = options.resourceIdFor ?? projectResourceIdFor;
  const kind = options.kind ?? PROJECT_KIND;

  async function gated<T>(
    principal: ResourceHubPrincipal | null | undefined,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    return (await options.hasTeamIdentity(principal)) ? fn() : fallback;
  }

  return {
   async publish({ projectId, principal, resourceScope, metadata: metadataOverride }) {
      return gated(principal, async () => {
       const dir = await options.resolveProjectDir(projectId);
       const resourceId = resourceIdFor(projectId, principal);
       const workspaceId = principal!.teamId;
       const entries = await collectManifestEntries(dir);
       const manifest: HdwManifest = { entries };
       const describedMetadata = await options.describeProject?.(projectId);
       const metadata = {
         ...(describedMetadata ?? {}),
         ...(metadataOverride ?? {}),
       };

       // Phase 1: send manifest, find out what the server still needs.
      let result = await options.client.publishResource(workspaceId, resourceId, {
        kind,
        manifest,
        ...(metadata && Object.keys(metadata).length > 0
          ? { metadata }
          : {}),
        ref: PUBLISHED_REF,
        ownerMemberId: principal!.memberId,
        ...(resourceScope ? { scope: resourceScope } : {}),
      });

      // Phase 2: upload missing blobs and retry.
      let attempts = 0;
      while (result.missingBlobs.length > 0 && attempts < 3) {
        await uploadMissingBlobs(options.client, dir, workspaceId, result.missingBlobs, entries);
        result = await options.client.publishResource(workspaceId, resourceId, {
          kind,
          manifest,
          ...(metadata && Object.keys(metadata).length > 0
            ? { metadata }
            : {}),
          ref: PUBLISHED_REF,
          ownerMemberId: principal!.memberId,
          ...(resourceScope ? { scope: resourceScope } : {}),
        });
          attempts++;
        }

        if (result.missingBlobs.length > 0) {
          throw new Error(
            `hdw publish failed: ${result.missingBlobs.length} blobs still missing after ${attempts} attempts`,
          );
        }

        return {
          version: result.version,
          ...(result.versionId ? { versionId: result.versionId } : {}),
        };
      }, null);
    },

    syncLatest({ projectId, principal }) {
      return gated(principal, async () => {
        const resourceId = resourceIdFor(projectId, principal);
        const head = await options.client.getPublishedHead(
          principal!.teamId,
          resourceId,
          PUBLISHED_REF,
        );
        if (!head) return null;
        return {
          version: head.version,
          ...(head.versionId ? { versionId: head.versionId } : {}),
        };
      }, null);
    },

    async pull({ projectId, principal }) {
      return gated(principal, async () => {
        const dir = await resolvePullDir(projectId);
        const resourceId = resourceIdFor(projectId, principal);
        const workspaceId = principal!.teamId;

        const result = await options.client.pullResource(
          workspaceId,
          resourceId,
          PUBLISHED_REF,
        );
        if (!result) return null;

        // Download all blobs and write files.
        const blobCache = new Map<string, Buffer>();
        for (const entry of result.manifest.entries) {
          let data = blobCache.get(entry.digest);
          if (!data) {
            data = await options.client.downloadBlob(workspaceId, entry.digest);
            blobCache.set(entry.digest, data);
          }
          const filePath = join(dir, entry.path);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, data, { mode: entry.mode ?? 0o644 });
        }

        return {
          version: result.version,
          ...(result.versionId ? { versionId: result.versionId } : {}),
        };
      }, null);
    },

    async unpublish({ projectId, principal }) {
      await gated(principal, async () => {
        const resourceId = resourceIdFor(projectId, principal);
        await options.client.removeResource(principal!.teamId, resourceId);
      }, undefined);
    },

   async transferToWorkspace({ projectId, principal, sourceWorkspaceId, targetWorkspaceId, coverDigest }) {
     return gated(principal, async () => {
       const result = await options.client.transferProject(
         sourceWorkspaceId,
         projectId,
         targetWorkspaceId,
          principal?.memberId,
          coverDigest,
       );
       return {
         version: result.version,
         ...(result.versionId ? { versionId: result.versionId } : {}),
         ...(result.targetOwnerMemberId ? { targetOwnerMemberId: result.targetOwnerMemberId } : {}),
       };
     }, null);
   },
  };
}

/** Read each file whose digest is in the missing list and upload it. */
async function uploadMissingBlobs(
  client: HdwCloudClient,
  dir: string,
  workspaceId: string,
  missingDigests: string[],
  entries: HdwManifestEntry[],
): Promise<void> {
  const digestToPath = new Map<string, string>();
  for (const entry of entries) {
    digestToPath.set(entry.digest, entry.path);
  }
  await Promise.all(
    missingDigests.map(async (digest) => {
      const relPath = digestToPath.get(digest);
      if (!relPath) return; // server asked for a blob we don't have
      const data = await readFile(join(dir, relPath));
      await client.uploadBlob(workspaceId, digest, data);
    }),
  );
}
