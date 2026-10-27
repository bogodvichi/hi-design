import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createHdwCloudClient } from '../../src/integrations/hdw-cloud.js';

const localOrigin = 'http://127.0.0.1:7002';
const remoteRoot = 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web/hdw';
const workspace = 'private-workspace';
const resource = 'skill-shared';
const resourcePath = '/api/workspaces/private-workspace/resources/skill-shared/materialize';
const headPath = '/api/workspaces/private-workspace/resources/skill-shared/refs/published';

function client(fetchImpl: typeof fetch, origin = localOrigin) {
  return createHdwCloudClient({
    config: { baseUrl: origin, pathPrefix: '/hdw', token: null },
    fetch: fetchImpl,
    readSession: () => ({ username: 'alice', cookies: [{ name: 'session', value: 'fake-for-tests' }] }),
    timeoutMs: 5000,
  });
}

describe('Dev HDW missing historical Blob recovery (read only)', () => {
  it('reads a missing local manifest from matching Dev cloud version using the same OA identity', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      urls.push(url);
      expect(init?.redirect).toBe('error');
      if (url === localOrigin + '/hdw' + resourcePath) {
        return Response.json({ error: 'internal_error', message: "ENOENT: no such file or directory, open '/local/data/blobs/11/private'" }, { status: 500 });
      }
      if (url === localOrigin + '/hdw' + headPath) {
        return Response.json({ version: 1, versionId: 'v1' });
      }
      if (url === remoteRoot + resourcePath) {
        const headers = new Headers(init?.headers);
        expect(headers.get('x-hdw-username')).toBe('alice');
        expect(headers.get('x-hdw-oa-session')).toBeTruthy();
        return Response.json({ version: 1, versionId: 'v1', manifest: { entries: [] }, missingBlobs: [] });
      }
      throw new Error('unexpected request: ' + url);
    });

    await expect(client(fetchImpl).pullResource(workspace, resource)).resolves.toMatchObject({
      versionId: 'v1', manifest: { entries: [] },
    });
    expect(urls).toEqual([
      localOrigin + '/hdw' + resourcePath,
      localOrigin + '/hdw' + headPath,
      remoteRoot + resourcePath,
    ]);
  });


  it('recovers a valid manifest whose file bodies are missing only from local Dev storage', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url === localOrigin + '/hdw' + resourcePath) {
        return Response.json({
          version: 3, versionId: 'v3',
          manifest: { entries: [{ path: 'SKILL.md', digest: 'a'.repeat(64), size: 5 }] },
          missingBlobs: ['a'.repeat(64)],
        });
      }
      if (url === remoteRoot + resourcePath) {
        return Response.json({
          version: 3, versionId: 'v3',
          manifest: { entries: [{ path: 'SKILL.md', digest: 'a'.repeat(64), size: 5 }] },
          missingBlobs: [],
        });
      }
      throw new Error('Unexpected URL: ' + url);
    });
    const result = await client(fetchImpl).pullResource(workspace, resource);
    expect(result?.versionId).toBe('v3');
    expect(result?.missingBlobs).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('downloads local-missing historical file bytes from Dev cloud and verifies their SHA-256', async () => {
    const bytes = Buffer.from('# Existing shared Skill contents');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const blobPath = '/api/workspaces/' + workspace + '/blobs/' + digest;
    const urls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === localOrigin + '/hdw' + blobPath) return Response.json({ error: 'not_found' }, { status: 404 });
      if (url === remoteRoot + blobPath) return new Response(bytes, { status: 200 });
      throw new Error('unexpected request: ' + url);
    });
    await expect(client(fetchImpl).downloadBlob(workspace, digest)).resolves.toEqual(bytes);
    expect(urls).toEqual([localOrigin + '/hdw' + blobPath, remoteRoot + blobPath]);
  });

  it('rejects corrupt recovered bytes without exposing local file paths', async () => {
    const digest = createHash('sha256').update('correct').digest('hex');
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith(localOrigin)) return Response.json({ error: 'not_found' }, { status: 404 });
      return new Response('wrong', { status: 200 });
    });
    await expect(client(fetchImpl).downloadBlob(workspace, digest)).rejects.toMatchObject({
      code: 'DEV_BLOB_INTEGRITY_FAILED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not bypass permissions nor apply the fallback to official clients', async () => {
    const fetchLocal = vi.fn<typeof fetch>(async () => Response.json({ error: 'forbidden' }, { status: 403 }));
    await expect(client(fetchLocal).pullResource(workspace, resource)).rejects.toMatchObject({ status: 403 });
    expect(fetchLocal).toHaveBeenCalledTimes(1);

    const fetchOfficial = vi.fn<typeof fetch>(async () => Response.json({ error: 'internal_error', message: 'ENOENT: private path' }, { status: 500 }));
    await expect(client(fetchOfficial, 'https://pixso.hikvision.com.cn').pullResource(workspace, resource))
      .rejects.toMatchObject({ status: 500 });
    expect(fetchOfficial).toHaveBeenCalledTimes(1);
  });

  it('refuses the remote manifest if its version differs from local HDW', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === localOrigin + '/hdw' + resourcePath) return Response.json({ error: 'local_blob_unavailable' }, { status: 503 });
      if (url === localOrigin + '/hdw' + headPath) return Response.json({ version: 2, versionId: 'local-v2' });
      if (url === remoteRoot + resourcePath) return Response.json({ version: 1, versionId: 'remote-v1', manifest: { entries: [] }, missingBlobs: [] });
      throw new Error('Unexpected URL');
    });
    await expect(client(fetchImpl).pullResource(workspace, resource)).rejects.toMatchObject({ code: 'DEV_BLOB_VERSION_MISMATCH' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
