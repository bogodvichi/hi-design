import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createHdwHttpResourceAdapter } from '../../src/collab/hdw-http-resource-adapter.js';
import { createHdwCloudClient, type HdwCloudClient, type HdwManifest } from '../../src/integrations/hdw-cloud.js';
import { createCollabRuntime } from '../../src/collab/runtime.js';

describe('HDW resource blob uploads', () => {
  it('carries a transfer destination folder and original author through the runtime and HTTP adapter', async () => {
    const cloudFetch = vi.fn<typeof fetch>(async () => Response.json({
      resourceId: 'transferred-resource', workspaceId: 'target', version: 3, versionId: 'version-3',
      targetOwnerMemberId: 'target-author', folderId: 'target-folder',
    }));
    const client = createHdwCloudClient({ config: { baseUrl: 'https://cloud.example', pathPrefix: '/hdw', token: null }, fetch: cloudFetch });
    const upsert = vi.fn();
    const runtime = createCollabRuntime({ teamProjectCatalog: { upsert, remove: vi.fn() }, adapter: createHdwHttpResourceAdapter({
      resolveProjectDir: () => { throw new Error('Transfer must not read project files'); },
      hasTeamIdentity: () => true, client,
    }) });
    try {
      const result = await runtime.requestTeamTransfer('project', 'source', 'target', {
        teamId: 'target', memberId: 'target-mover', role: 'member', lifecycleState: 'active',
      }, null, 'target-folder');
      expect(cloudFetch).toHaveBeenCalledOnce();
      const [url, init] = cloudFetch.mock.calls[0]!;
      expect(String(url)).toBe('https://cloud.example/hdw/api/workspaces/source/team-projects/project/transfer');
      expect(JSON.parse(init!.body as string)).toEqual({ targetWorkspaceId: 'target', targetOwnerMemberId: 'target-mover', targetFolderId: 'target-folder' });
      expect(result).toMatchObject({ resourceId: 'transferred-resource', targetOwnerMemberId: 'target-author', folderId: 'target-folder' });
      expect(runtime.projectOwnerMemberId('project')).toBe('target-author');
      expect(upsert).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
  });

  it.each([false, true])('bounds concurrent transfers and finishes reads before returning (failure=%s)', async (fail) => {
    const dir = await mkdtemp(join(tmpdir(), 'hdw-publish-'));
    let active = 0;
    let peak = 0;
    let completed = 0;
    const publishResource = vi.fn(async (_workspace: string, _resource: string, input: { manifest: HdwManifest }) => ({
      version: 1,
      missingBlobs: completed === 0 ? input.manifest.entries.map(entry => entry.digest) : [],
    }));
    const uploadBlob = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      active--;
      completed++;
      if (fail && completed === 1) throw new Error('upload failed');
    });
    try {
      await Promise.all(Array.from({ length: 24 }, (_, i) => writeFile(join(dir, `${i}.md`), `Reference ${i}`)));
      const adapter = createHdwHttpResourceAdapter({
        kind: 'skill', resolveProjectDir: () => dir, hasTeamIdentity: () => true,
        client: { publishResource, uploadBlob } as unknown as HdwCloudClient,
      });
      const publish = adapter.publish({ projectId: 'skill', reason: 'share', principal: {
        teamId: 'team', memberId: 'member', role: 'owner', lifecycleState: 'active',
      } });
      if (fail) await expect(publish).rejects.toThrow('upload failed');
      else await expect(publish).resolves.toMatchObject({ version: 1 });
      expect(active).toBe(0);
      expect(completed).toBe(24);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(publishResource).toHaveBeenCalledTimes(fail ? 1 : 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
