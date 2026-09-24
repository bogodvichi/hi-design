import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { getSharedSpaceMemberId, getTeamMemberId } from '../src/ids.js';
import { registerCollabContextHideSignRoutes } from '../src/routes/collab-context-hidesign.js';

const hdwMocks = vi.hoisted(() => ({
  shareToSharedSpace: vi.fn(),
}));

vi.mock('../src/http/hdw.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/http/hdw.js')>()),
  shareToSharedSpace: hdwMocks.shareToSharedSpace,
}));

vi.mock('../src/http/hik_logins/hicoo.js', () => ({
  readSsoConfigFile: () => ({
    username: 'project-owner',
    cookies: [],
    userInfo: { displayName: '项目所有者' },
  }),
  readSsoUsername: () => 'project-owner',
}));

const localFetch = globalThis.fetch;
let server: Server | undefined;
let origin = '';

beforeEach(async () => {
  hdwMocks.shareToSharedSpace.mockReset();
  hdwMocks.shareToSharedSpace.mockResolvedValue({ shared: 1, skipped: 0 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  const closing = server;
  server = undefined;
  if (closing?.listening) {
    closing.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      closing.close((error) => error ? reject(error) : resolve());
    });
  }
});

describe('shared-space project owner preservation', () => {
  it('publishes with the home-team owner while creating recipient-scoped share records', async () => {
    const requestTeamShare = vi.fn(async () => ({ version: 1 }));
    const app = express();
    app.use(express.json());
    registerCollabContextHideSignRoutes(app, {
      dataDir: '/test-data',
      requestTeamShare,
    });
    server = await new Promise<Server>((resolve) => {
      const running = createServer(app);
      running.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    origin = `http://127.0.0.1:${address.port}`;

    const response = await localFetch(`${origin}/api/shared-space/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        home_workspace_id: 'team-1',
        recipients: [{ username: 'recipient', displayname: '接收人' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(requestTeamShare).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        memberId: getTeamMemberId('team-1', 'project-owner'),
        teamId: 'team-1',
      }),
      null,
    );
    expect(requestTeamShare).not.toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ memberId: getSharedSpaceMemberId('project-owner') }),
      null,
    );
    expect(hdwMocks.shareToSharedSpace).toHaveBeenCalledWith('/test-data', expect.objectContaining({
      projectId: 'project-1',
      homeWorkspaceId: 'team-1',
      createdByUsername: 'project-owner',
      recipients: [{ username: 'recipient', displayname: '接收人' }],
    }));
  });
});
