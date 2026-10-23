import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
let server: http.Server;
let base: string;
const requests: Array<{ url: string | undefined; method: string | undefined }> = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.method === 'DELETE' ? { ok: true } : { resources: [{ shareId: 'my-share', resourceId: 'original' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { requests.length = 0; });
async function cli(args: string[]) {
  return run(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'apps/daemon/src/cli.ts'), 'shared-space', ...args,
    '--daemon-url', base, '--json'], { cwd: root, timeout: 15_000, env: { ...process.env, NODE_OPTIONS: undefined } });
}
describe.each(['skill', 'mcp'])('shared %s CLI', (kind) => {
  it('lists the recipient resource share IDs', async () => {
    const result = await cli(['list', '--kind', kind]);
    expect(JSON.parse(result.stdout)).toMatchObject({ resources: [{ shareId: 'my-share' }] });
    expect(requests).toEqual([{ url: `/api/resource-share/shared-with-me?kind=${kind}`, method: 'GET' }]);
  });
  it('removes the recipient share through the same API as the UI', async () => {
    const result = await cli(['remove-resource', 'share/id', '--kind', kind]);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    expect(requests).toEqual([{ url: `/api/resource-share/shared-with-me/share%2Fid?kind=${kind}`, method: 'DELETE' }]);
  });
});
