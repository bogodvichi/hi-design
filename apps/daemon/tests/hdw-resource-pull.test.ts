import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createHdwHttpResourceAdapter } from '../src/collab/hdw-http-resource-adapter.js';
import type { HdwCloudClient } from '../src/integrations/hdw-cloud.js';

const principal = { teamId: 'team-a', memberId: 'member-a', role: 'owner', lifecycleState: 'active' } as const;
describe('HDW scoped resource pull', () => {
  it.each(['SKILL.md', '../escape', '/escape', '..\\escape', 'C:\\escape'])('materializes only safe scoped manifest paths: %s', async path => {
    const dir = await mkdtemp(join(tmpdir(), 'hdw-resource-'));
    const pullResource = vi.fn().mockResolvedValue({ version: 1, manifest: { entries: [{ path, digest: 'digest' }] } });
    const downloadBlob = vi.fn().mockResolvedValue(Buffer.from('content'));
    const adapter = createHdwHttpResourceAdapter({
      kind: 'skill', resolveProjectDir: () => dir, resourceIdFor: () => 'skill-exact-id', hasTeamIdentity: () => true,
      client: { pullResource, downloadBlob } as unknown as HdwCloudClient,
    });
    try {
      if (path === 'SKILL.md') {
        await adapter.pull?.({ projectId: 'local-id', principal });
        expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe('content');
        expect(pullResource).toHaveBeenCalledWith('team-a', 'skill-exact-id', 'published');
        expect(downloadBlob).toHaveBeenCalledWith('team-a', 'digest');
      } else {
        await expect(adapter.pull?.({ projectId: 'local-id', principal })).rejects.toThrow('unsafe path');
        expect(downloadBlob).not.toHaveBeenCalled();
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
