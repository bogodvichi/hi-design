import { describe, expect, it, vi } from 'vitest';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';

const root = 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw';
const workspace = 'owned-workspace';
const resourcePath = '/api/workspaces/owned-workspace/resources/skill-owned';

function client(fetchImpl: typeof fetch) {
  return createHdwCloudClient({
    fetch: fetchImpl,
    readSession: () => ({ username: 'alice', cookies: [{ name: 'session', value: 'fake-for-tests' }] }),
  });
}

describe('remote HDW resource authority', () => {
  it('uploads metadata, manifests and bytes to the same remote service', async () => {
    const bytes = Buffer.from('# Uploaded Skill');
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ version: 1, versionId: 'v1', missingBlobs: [] }));
    const cloud = client(fetchImpl);
    const manifest = { entries: [{ path: 'SKILL.md', digest: 'a'.repeat(64), size: bytes.length }] };
    await cloud.publishResource(workspace, 'skill-owned', { kind: 'skill', manifest, ownerMemberId: 'owner' });
    await cloud.uploadBlob(workspace, 'a'.repeat(64), bytes);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      root + resourcePath + '/versions', root + '/api/workspaces/owned-workspace/blobs/' + 'a'.repeat(64),
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({ kind: 'skill', manifest });
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toEqual(bytes);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe('PUT');
      expect(init?.redirect).toBe('error');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-hdw-username')).toBe('alice');
      expect(headers.get('x-hdw-oa-session')).toBeTruthy();
      expect(headers.get('x-hdw-workspace-id')).toBe(workspace);
    }
  });

  it('reads the published manifest and bytes from the catalog service', async () => {
    const bytes = Buffer.from('# Remote Skill');
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'POST'
      ? Response.json({ version: 2, versionId: 'v2', manifest: { entries: [] }, missingBlobs: [] })
      : new Response(bytes));
    const cloud = client(fetchImpl);
    expect(await cloud.pullResource(workspace, 'skill-owned')).toMatchObject({ versionId: 'v2' });
    expect(await cloud.downloadBlob(workspace, 'b'.repeat(64))).toEqual(bytes);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      root + resourcePath + '/materialize', root + '/api/workspaces/owned-workspace/blobs/' + 'b'.repeat(64),
    ]);
  });

  it.each([401, 403, 500, 503])('preserves remote failure %s without reading a different backend', async status => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: 'remote_unavailable', message: 'remote file missing' }, { status }));
    await expect(client(fetchImpl).pullResource(workspace, 'skill-owned')).rejects.toMatchObject({ status, code: 'remote_unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not replace a missing remote blob with a local or alternate copy', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: 'not_found' }, { status: 404 }));
    await expect(client(fetchImpl).downloadBlob(workspace, 'c'.repeat(64))).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
