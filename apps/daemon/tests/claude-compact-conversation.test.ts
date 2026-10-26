import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { closeDatabase, getAgentSessionRecord, getConversation, getProject, insertConversation, insertProject, listMessages, openDatabase, upsertAgentSession, upsertMessage } from '../src/db.js';
import { readAppConfig } from '../src/app-config.js';
import { resolveAgentResumeContext, resolveAgentResumePromptPolicy } from '../src/agent-session-resume.js';
import { createChatRunService } from '../src/runtimes/runs.js';
import { activeClaudeCompactions, runClaudeCompact } from '../src/runtimes/claude-compact.js';
import { registerProjectConversationRoutes } from '../src/routes/project/conversations.js';

vi.mock('../src/runtimes/claude-compact.js', () => ({ activeClaudeCompactions: new Set(), runClaudeCompact: vi.fn() }));
vi.mock('../src/agents.js', () => ({ resolveAgentLaunch: () => ({ launchPath: '/claude', childPathPrepend: [] }), applyAgentLaunchEnv: (env: unknown) => env, spawnEnvForAgent: (_id: string, _env: unknown, configured: unknown) => configured }));
vi.mock('../src/runtimes/mmd-routes.js', () => ({ loadMmdRouteLaunchEnv: async () => null }));

let root: string;
let db: ReturnType<typeof openDatabase>;
let runs: ReturnType<typeof createChatRunService>;
let compact: (request: any, response: any) => Promise<unknown>;
let authorize: ReturnType<typeof vi.fn>;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'od-compact-conversation-'));
  db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'project', name: 'P', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'conversation', projectId: 'project', createdAt: 1, updatedAt: 1 });
  upsertMessage(db, 'conversation', { id: 'assistant', role: 'assistant', content: 'Existing design', createdAt: 1, runStatus: 'succeeded' });
  upsertAgentSession(db, { conversationId: 'conversation', agentId: 'claude', sessionId: 'native-session', cwd: path.join(root, 'project'), model: 'sonnet', stablePromptHash: 'cached', lastMessageId: 'assistant' });
  runs = createChatRunService({ createSseResponse: vi.fn(), createSseErrorPayload: (code: string, message: string) => ({ code, message }) });
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((verb) => [verb, (url: string, handler: unknown) => { routes.set(`${verb} ${url}`, handler); }]));
  authorize = vi.fn(async () => true);
  registerProjectConversationRoutes(app as unknown as Express, {
    db, design: { runs }, http: { sendApiError: (res: any, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: root }, projectStore: { getProject }, conversations: { getConversation, upsertMessage },
    ids: { randomId: randomUUID }, appConfig: { readAppConfig }, agents: { getAgentDef: () => ({ id: 'claude' }) },
    authorizeProjectRequest: authorize, runtimeDataDir: root,
  } as unknown as Parameters<typeof registerProjectConversationRoutes>[1]);
  compact = routes.get('post /api/projects/:id/conversations/:cid/compact');
  vi.mocked(runClaudeCompact).mockResolvedValue({ compacted: true, preTokens: 8000, detail: '' });
});
afterEach(() => { activeClaudeCompactions.clear(); closeDatabase(); rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); });

async function request(body = {}, conversationId = 'conversation') {
  const response = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
  await compact({ params: { id: 'project', cid: conversationId }, body }, response);
  return response;
}

describe('compact conversation route', () => {
  it('keeps the native handle and cached instructions so the next turn skips old transcript', async () => {
    const result = await request({ locale: 'zh-CN', instructions: 'Keep current layout' });
    expect(result.statusCode).toBe(200);
    expect(result.body.compacted).toBe(true);
    expect(runClaudeCompact).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'native-session', cwd: path.join(root, 'project'), instructions: 'Keep current layout', env: expect.objectContaining({ OD_DATA_DIR: root }) }));
    const record = getAgentSessionRecord(db, 'conversation', 'claude');
    expect(record).toMatchObject({ sessionId: 'native-session', stablePromptHash: 'cached', lastMessageId: result.body.message.id });
    const resume = resolveAgentResumeContext(db, { conversationId: 'conversation', agentId: 'claude', currentModel: 'sonnet', currentCwd: path.join(root, 'project') });
    expect(resolveAgentResumePromptPolicy(resume)).toMatchObject({ skipTranscript: true, requiresFullTranscript: false, resumeSessionId: 'native-session' });
    expect(listMessages(db, 'conversation')).toHaveLength(2);
    expect(activeClaudeCompactions.size).toBe(0);
  });
  it('does not create or seed a replacement session when no native session exists', async () => {
    insertConversation(db, { id: 'empty', projectId: 'project', createdAt: 2, updatedAt: 2 });
    expect((await request({}, 'empty')).statusCode).toBe(409);
    expect(runClaudeCompact).not.toHaveBeenCalled();
  });
  it('preserves the session and transcript on upstream failure', async () => {
    vi.mocked(runClaudeCompact).mockRejectedValue(new Error('request body so large (1000)'));
    const result = await request();
    expect(result.statusCode).toBe(422);
    expect(result.body.error.message).toContain('request body so large');
    expect(getAgentSessionRecord(db, 'conversation', 'claude')?.lastMessageId).toBe('assistant');
    expect(listMessages(db, 'conversation')).toHaveLength(1);
    expect(activeClaudeCompactions.size).toBe(0);
  });
  it('rejects a concurrent turn and does not start a second process', async () => {
    runs.create({ conversationId: 'conversation', agentId: 'claude' });
    expect((await request()).statusCode).toBe(409);
    expect(runClaudeCompact).not.toHaveBeenCalled();
  });
  it('uses the project write authority before executing anything', async () => {
    authorize.mockImplementation(async (_req, res) => { res.status(403).json({ error: 'denied' }); return false; });
    expect((await request()).statusCode).toBe(403);
    expect(runClaudeCompact).not.toHaveBeenCalled();
  });
});
