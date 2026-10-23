import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
let server: http.Server;
let base: string;
const requests: Array<{ url: string | undefined; headers: http.IncomingHttpHeaders; body: string }> = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.method !== 'GET' ? { ok: true } : { templates: [{ resourceId: 'mcp-team', label: 'Team MCP' }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { requests.length = 0; });

async function cli(args: string[], kind = 'mcp') {
  return run(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'apps/daemon/src/cli.ts'), kind, ...args,
    '--workspace', 'team', '--workspace-member', 'team-member', '--daemon-url', base, '--json'], { cwd: root, timeout: 15_000, env: { ...process.env, NODE_OPTIONS: undefined } });
}
describe('cloud MCP CLI', () => {
  it.each(['skill', 'mcp'])('deletes an owned %s cloud resource through the source workspace API', async (kind) => {
    const result = await cli([...(kind === 'mcp' ? ['cloud'] : []), 'delete', 'cloud-resource'], kind);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    expect(requests).toEqual([expect.objectContaining({ url: `/api/workspace/${kind === 'skill' ? 'skills' : 'mcp'}/cloud/cloud-resource`,
      headers: expect.objectContaining({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' }), body: '' })]);
  });
  it.each([false, true])('lists community MCPs with mine=%s through the shared API', async (mine) => {
    const result = await cli(['cloud', 'list', ...(mine ? ['--mine'] : [])]);
    expect(JSON.parse(result.stdout)).toMatchObject({ templates: [{ resourceId: 'mcp-team' }] });
    const params = new URL(requests[0]!.url!, base).searchParams;
    expect(params.get('scope')).toBe('public');
    expect(params.get('owner_member_id')).toBe(mine ? 'team-member' : null);
  });
  it('publishes the existing resource with the exact source workspace identity', async () => {
    const result = await cli(['publish', 'mcp-team', '--description', 'Team description']);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    expect(requests).toEqual([expect.objectContaining({ url: '/api/workspace/mcp/cloud/mcp-team/publish',
      headers: expect.objectContaining({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' }),
      body: JSON.stringify({ description: 'Team description' }) })]);
  });
});
