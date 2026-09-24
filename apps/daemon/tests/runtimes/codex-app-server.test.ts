import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  CodexAppServerManager,
  createCodexAppServerVirtualChild,
} from '../../src/runtimes/codex-app-server.js';

class FakeAppServerProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  requests: Array<Record<string, unknown>> = [];
  private input = '';

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      this.input += chunk;
      let newline = this.input.indexOf('\n');
      while (newline >= 0) {
        const line = this.input.slice(0, newline);
        this.input = this.input.slice(newline + 1);
        if (line.trim()) this.handle(JSON.parse(line) as Record<string, unknown>);
        newline = this.input.indexOf('\n');
      }
    });
  }

  private send(value: unknown) {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  private handle(message: Record<string, unknown>) {
    this.requests.push(message);
    const id = message.id;
    const method = message.method;
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (typeof id !== 'number') return;

    if (method === 'initialize') {
      this.send({ id, result: { userAgent: 'fake-codex' } });
      return;
    }
    if (method === 'thread/start') {
      this.send({ id, result: { thread: { id: 'thr-1' } } });
      return;
    }
    if (method === 'thread/resume') {
      this.send({ id, result: { thread: { id: params.threadId } } });
      return;
    }
    if (method === 'turn/start') {
      const threadId = String(params.threadId);
      const turnId = threadId === 'thr-1' ? 'turn-1' : 'turn-resume';
      this.send({ id, result: { turn: { id: turnId, status: 'inProgress' } } });
      queueMicrotask(() => {
        this.send({
          method: 'turn/started',
          params: { threadId, turn: { id: turnId, status: 'inProgress' } },
        });
        this.send({
          method: 'item/agentMessage/delta',
          params: { threadId, turnId, itemId: 'msg-1', delta: 'HELLO' },
        });
        this.send({
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'completed' } },
        });
      });
      return;
    }
    if (method === 'turn/interrupt') {
      this.send({ id, result: {} });
      return;
    }
    this.send({ id, error: { code: -32601, message: `unknown method ${String(method)}` } });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed = true;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit('exit', null, signal);
      this.emit('close', null, signal);
    });
    return true;
  }
}

function fakeSpawnHarness() {
  const processes: FakeAppServerProcess[] = [];
  const spawnImpl = (() => {
    const proc = new FakeAppServerProcess();
    processes.push(proc);
    return proc as any;
  }) as any;
  return { spawnImpl, processes };
}

async function collectVirtualTurn(child: ReturnType<typeof createCodexAppServerVirtualChild>) {
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end('build the page');
  const result = await closed;
  return { result, output };
}

describe('Codex app-server manager', () => {
  it('initializes one persistent app-server and routes a turn through thread/start', async () => {
    const { spawnImpl, processes } = fakeSpawnHarness();
    const manager = new CodexAppServerManager('/fake/codex', { PATH: '/bin' }, spawnImpl);

    const child = createCodexAppServerVirtualChild({
      manager,
      command: '/fake/codex',
      env: { PATH: '/bin' },
      cwd: '/workspace',
      model: 'gpt-test',
      reasoning: 'medium',
      serviceTier: 'default',
      sandbox: 'workspace-write',
      writableRoots: ['/workspace/extra'],
    });

    const { result, output } = await collectVirtualTurn(child);

    expect(result).toEqual({ code: 0, signal: null });
    expect(processes).toHaveLength(1);
    expect(output).toContain('item/agentMessage/delta');
    expect(output).toContain('HELLO');

    const methods = processes[0]!.requests.map((request) => request.method);
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);

    const turnStart = processes[0]!.requests.find((request) => request.method === 'turn/start');
    expect(turnStart).toMatchObject({
      params: {
        threadId: 'thr-1',
        input: [{ type: 'text', text: 'build the page' }],
        effort: 'medium',
        sandboxPolicy: {
          type: 'workspaceWrite',
          networkAccess: true,
        },
      },
    });
  });

  it('reuses the persistent process and resumes the durable Codex thread', async () => {
    const { spawnImpl, processes } = fakeSpawnHarness();
    const manager = new CodexAppServerManager('/fake/codex', { PATH: '/bin' }, spawnImpl);

    const first = createCodexAppServerVirtualChild({
      manager,
      command: '/fake/codex',
      env: { PATH: '/bin' },
      cwd: '/workspace',
      sandbox: 'workspace-write',
    });
    await collectVirtualTurn(first);

    const second = createCodexAppServerVirtualChild({
      manager,
      command: '/fake/codex',
      env: { PATH: '/bin' },
      cwd: '/workspace',
      resumeSessionId: 'thr-1',
      sandbox: 'workspace-write',
    });
    await collectVirtualTurn(second);

    expect(processes).toHaveLength(1);
    expect(processes[0]!.requests.map((request) => request.method)).toContain('thread/resume');
  });

  it('strips run-scoped OD secrets from the persistent process environment', async () => {
    const { spawnImpl } = fakeSpawnHarness();
    let capturedEnv: NodeJS.ProcessEnv | null = null;
    const manager = new CodexAppServerManager(
      '/fake/codex',
      {
        PATH: '/bin',
        HOME: '/home/test',
        OD_TOOL_TOKEN: 'run-secret',
        OD_PROJECT_ID: 'project-secret',
        OD_MCP_BRIDGE_TEST: 'bridge-secret',
      },
      ((command: string, args: string[], options: any) => {
        capturedEnv = options.env;
        return spawnImpl(command, args, options);
      }) as any,
    );

    const child = createCodexAppServerVirtualChild({
      manager,
      command: '/fake/codex',
      env: {},
      cwd: '/workspace',
      sandbox: 'workspace-write',
    });
    await collectVirtualTurn(child);

    expect(capturedEnv).toMatchObject({ PATH: '/bin', HOME: '/home/test' });
    expect(capturedEnv).not.toHaveProperty('OD_TOOL_TOKEN');
    expect(capturedEnv).not.toHaveProperty('OD_PROJECT_ID');
    expect(capturedEnv).not.toHaveProperty('OD_MCP_BRIDGE_TEST');
  });
});
