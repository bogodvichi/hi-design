import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));

describe('workspace project transfer CLI', () => {
  it.each(['move', 'batch-move'])('sends source identity and the exact destination for %s', async (command) => {
    const requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: unknown }> = [];
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url!, headers: req.headers, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ project: { id: 'project', workspaceId: 'target' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    try {
      const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', cli,
        'workspace', 'projects', command, ...(command === 'move' ? ['project'] : ['--project', 'project']),
        '--workspace', 'personal', '--workspace-type', 'personal', '--member', 'personal-member',
        '--visibility', 'team', '--target-workspace', 'target', '--target-folder', 'root',
        '--daemon-url', `http://127.0.0.1:${address.port}`, '--json',
      ], { cwd: daemonRoot, env: { ...process.env } });
      expect(JSON.parse(stdout)).toMatchObject({ project: { workspaceId: 'target' } });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: `/api/workspaces/personal/projects/${command === 'move' ? 'project/move' : 'batch-move'}`,
        headers: { 'x-od-workspace-id': 'personal', 'x-od-workspace-member-id': 'personal-member' },
        body: { visibility: 'team', targetWorkspaceId: 'target', targetFolderId: null,
          ...(command === 'batch-move' ? { projectIds: ['project'] } : {}) },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
