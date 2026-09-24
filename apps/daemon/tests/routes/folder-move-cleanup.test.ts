import type { Express, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFolderRoutes } from '../../src/routes/folders.js';

const state = vi.hoisted(() => ({
  tree: [] as Array<{ folderId: string; folderPid: string | null; folderName: string; projectIds: string[] }>,
  owner: 'me', absent: false, transactionActive: false, delete: vi.fn(),
}));
vi.mock('../../src/db.js', () => ({
  createWorkspaceFolder: vi.fn(), listSubFolders: vi.fn(), updateWorkspaceFolder: vi.fn(),
  listFolderPreview: vi.fn(), countProjectsInFolder: vi.fn(), countProjectsInAllFolders: vi.fn(),
  getFolderPath: vi.fn(), listProjectsInFolder: vi.fn(), normalizeProject: vi.fn(),
  getWorkspaceFolder: () => state.absent ? undefined : { folderId: 'a', ownerMemberId: state.owner },
  getFolderTree: () => state.tree,
  deleteWorkspaceFolderPreservingContents: vi.fn(),
  deleteWorkspaceFolder: (...args: unknown[]) => {
    expect(state.transactionActive).toBe(true);
    state.delete(...args);
  },
}));

beforeEach(() => {
  state.tree = [
    { folderId: 'a', folderPid: 'parent', folderName: 'A', projectIds: [] },
    { folderId: 'c', folderPid: 'a', folderName: 'Child', projectIds: [] },
  ];
  state.owner = 'me'; state.absent = false; state.transactionActive = false; state.delete.mockClear();
});

async function cleanup(expectedEmptyTree: unknown = state.tree.map(({ projectIds: _ids, ...node }) => node)) {
  const post = vi.fn();
  const app = { get: vi.fn(), post, patch: vi.fn(), delete: vi.fn() } as unknown as Express;
  const db = { transaction: (run: () => unknown) => ({ immediate: () => {
    state.transactionActive = true;
    try { return run(); } finally { state.transactionActive = false; }
  } }) };
  registerFolderRoutes(app, {
    db, http: {
      requireLocalDaemonRequest: (_req, _res, next) => next(),
      sendApiError: (res: Response, status: number, error: string, message: string) => res.status(status).json({ code: 1, error, message }),
    },
  });
  const call = post.mock.calls.find(([path]) => path === '/api/folders/:folderId/move-cleanup');
  expect(call, 'migration cleanup must have a dedicated fail-closed endpoint').toBeDefined();
  const handler = call!.at(-1);
  const req = { params: { folderId: 'a' }, body: { workspaceId: 'personal', expectedEmptyTree }, get: () => 'me' } as unknown as Request;
  const res = { statusCode: 200, body: null as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  await handler(req, res);
  return res;
}

describe('conditional source cleanup after folder migration', () => {
  it('deletes only the same empty tree, in a write transaction', async () => {
    expect((await cleanup()).statusCode).toBe(200);
    expect(state.delete).toHaveBeenCalledWith(expect.anything(), 'personal', 'a');
  });
  it('refuses cleanup when a project was added during the migration', async () => {
    state.tree[1]!.projectIds.push('new-project');
    expect((await cleanup()).statusCode).toBe(409);
    expect(state.delete).not.toHaveBeenCalled();
  });
  it('refuses cleanup when a new empty subfolder was added', async () => {
    const expected = state.tree.map(({ projectIds: _ids, ...node }) => node);
    state.tree.push({ folderId: 'new', folderPid: 'a', folderName: 'New', projectIds: [] });
    expect((await cleanup(expected)).statusCode).toBe(409);
    expect(state.delete).not.toHaveBeenCalled();
  });
  it('refuses cleanup after a rename or reparent', async () => {
    const expected = state.tree.map(({ projectIds: _ids, ...node }) => node);
    state.tree[0]!.folderPid = 'elsewhere';
    expect((await cleanup(expected)).statusCode).toBe(409);
    expect(state.delete).not.toHaveBeenCalled();
  });
  it('refuses cleanup under a different folder owner', async () => {
    state.owner = 'someone-else';
    expect((await cleanup()).statusCode).toBe(403);
    expect(state.delete).not.toHaveBeenCalled();
  });
  it('rejects a missing or duplicate snapshot instead of ordinary deletion', async () => {
    expect((await cleanup([])).statusCode).toBe(400);
    expect((await cleanup([state.tree[0], state.tree[0]])).statusCode).toBe(400);
    expect(state.delete).not.toHaveBeenCalled();
  });
  it('is idempotent after a successful cleanup response was lost', async () => {
    state.absent = true;
    expect((await cleanup()).statusCode).toBe(200);
    expect(state.delete).not.toHaveBeenCalled();
  });
});
