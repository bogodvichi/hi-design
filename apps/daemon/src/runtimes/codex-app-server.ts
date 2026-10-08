import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

type JsonRecord = Record<string, unknown>;
type AppServerMessage = JsonRecord & {
  id?: number | string;
  method?: string;
  params?: JsonRecord;
  result?: unknown;
  error?: unknown;
};

type SpawnLike = typeof spawn;

const RUN_SCOPED_ENV_KEYS = new Set([
  'OD_TOOL_TOKEN',
  'OD_PROJECT_ID',
  'OD_PROJECT_DIR',
  'OD_TASK_INPUT_DIR',
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeManagerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (RUN_SCOPED_ENV_KEYS.has(key) || key.startsWith('OD_MCP_BRIDGE_')) continue;
    out[key] = value;
  }
  return out;
}

function envFingerprint(env: NodeJS.ProcessEnv): string {
  const stable = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value ?? '']);
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function appServerErrorMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value)) {
    if (typeof value.message === 'string' && value.message.trim()) return value.message.trim();
    if (typeof value.error === 'string' && value.error.trim()) return value.error.trim();
  }
  return 'Codex app-server request failed';
}

function messageThreadId(message: AppServerMessage): string | null {
  const params = message.params;
  if (!params) return null;
  if (typeof params.threadId === 'string') return params.threadId;
  if (isRecord(params.thread) && typeof params.thread.id === 'string') return params.thread.id;
  return null;
}

function messageTurnId(message: AppServerMessage): string | null {
  const params = message.params;
  if (!params) return null;
  if (typeof params.turnId === 'string') return params.turnId;
  if (isRecord(params.turn) && typeof params.turn.id === 'string') return params.turn.id;
  return null;
}

function responseThreadId(result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (isRecord(result.thread) && typeof result.thread.id === 'string') return result.thread.id;
  if (typeof result.threadId === 'string') return result.threadId;
  if (typeof result.id === 'string') return result.id;
  return null;
}

function responseTurnId(result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (isRecord(result.turn) && typeof result.turn.id === 'string') return result.turn.id;
  if (typeof result.turnId === 'string') return result.turnId;
  if (typeof result.id === 'string') return result.id;
  return null;
}

function turnStatusFromCompleted(message: AppServerMessage): string {
  const params = message.params;
  if (!params || !isRecord(params.turn)) return '';
  return typeof params.turn.status === 'string' ? params.turn.status : '';
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CodexAppServerTurnOptions {
  command: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  prompt: string;
  resumeSessionId?: string | null;
  model?: string | null;
  reasoning?: string | null;
  serviceTier?: string | null;
  sandbox: 'workspace-write' | 'danger-full-access';
  writableRoots?: string[];
  onNotification: (message: AppServerMessage) => void;
}

export interface CodexAppServerTurnController {
  threadId: string;
  turnId: string;
  completed: Promise<{ status: string }>;
  interrupt: () => Promise<void>;
}

export class CodexAppServerManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeChildren = 0;
  private retiring = false;
  private readBuffer = '';
  private nextRequestId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private initialized: Promise<void> | null = null;
  private readonly sanitizedEnv: NodeJS.ProcessEnv;

  constructor(
    readonly command: string,
    env: NodeJS.ProcessEnv,
    private readonly spawnImpl: SpawnLike = spawn,
    private readonly startupConfigArgs: readonly string[] = [],
  ) {
    super();
    this.sanitizedEnv = sanitizeManagerEnv(env);
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  /** Hold the current app-server alive while a virtual Run is using it. */
  acquireRunLease(): () => void {
    this.activeChildren++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeChildren--;
      if (this.retiring && this.activeChildren === 0) this.shutdown();
    };
  }

  /** Prevent new Runs from reusing this manager, without interrupting existing ones. */
  retireWhenIdle(): void {
    if (this.retiring) return;
    this.retiring = true;
    if (this.activeChildren === 0) this.shutdown();
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('fatal', error);
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: AppServerMessage;
    try {
      const parsed = JSON.parse(trimmed);
      if (!isRecord(parsed)) return;
      message = parsed as AppServerMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined && message.error !== null) {
        pending.reject(new Error(appServerErrorMessage(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && typeof message.method === 'string') {
      // The initial app-server integration runs with approvalPolicy=never and
      // registers no dynamic tools. Any unexpected server-initiated request
      // must resolve rather than hanging the turn indefinitely.
      this.writeMessage({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported HiDesign app-server request: ${message.method}`,
        },
      });
      return;
    }

    if (typeof message.method === 'string') {
      this.emit('notification', message);
    }
  }

  private writeMessage(message: JsonRecord) {
    const proc = this.process;
    if (!proc || proc.exitCode !== null || proc.killed) {
      throw new Error('Codex app-server is not running');
    }
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: JsonRecord, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.writeMessage({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: JsonRecord = {}) {
    this.writeMessage({ method, params });
  }

  private ensureStarted(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = new Promise<void>((resolve, reject) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = this.spawnImpl(this.command, [...this.startupConfigArgs, 'app-server', '--stdio'], {
          env: this.sanitizedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        }) as ChildProcessWithoutNullStreams;
      } catch (error) {
        this.initialized = null;
        reject(error);
        return;
      }
      this.process = proc;

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        this.readBuffer += chunk;
        let newline = this.readBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = this.readBuffer.slice(0, newline);
          this.readBuffer = this.readBuffer.slice(newline + 1);
          this.handleLine(line);
          newline = this.readBuffer.indexOf('\n');
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk: string) => {
        this.emit('stderr', chunk);
      });
      proc.once('error', (error) => {
        this.failAll(error);
        this.initialized = null;
        reject(error);
      });
      proc.once('close', (code, signal) => {
        const error = new Error(
          `Codex app-server exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`,
        );
        this.process = null;
        this.initialized = null;
        this.readBuffer = '';
        this.failAll(error);
      });

      this.request('initialize', {
        clientInfo: {
          name: 'hidesign',
          title: 'HiDesign',
          version: process.env.npm_package_version || '0.20.3',
        },
      })
        .then(() => {
          this.notify('initialized');
          resolve();
        })
        .catch((error) => {
          this.initialized = null;
          reject(error);
        });
    });
    return this.initialized;
  }

  async prepare(): Promise<void> {
    await this.ensureStarted();
  }

  async startTurn(options: CodexAppServerTurnOptions): Promise<CodexAppServerTurnController> {
    await this.ensureStarted();

    const threadParams: JsonRecord = {
      cwd: options.cwd,
      approvalPolicy: 'never',
      sandbox: options.sandbox,
      ...(options.model && options.model !== 'default' ? { model: options.model } : {}),
      ...(options.serviceTier && options.serviceTier !== 'default'
        ? { serviceTier: options.serviceTier }
        : {}),
    };

    const threadResult = options.resumeSessionId
      ? await this.request('thread/resume', {
          threadId: options.resumeSessionId,
          ...threadParams,
        })
      : await this.request('thread/start', threadParams);

    const threadId = responseThreadId(threadResult) ?? options.resumeSessionId ?? null;
    if (!threadId) throw new Error('Codex app-server did not return a thread id');

    // The response is enough to capture the durable Codex thread even if a
    // thread/started notification raced ahead of listener registration.
    options.onNotification({
      method: 'thread/started',
      params: { thread: { id: threadId } },
    });

    let turnId: string | null = null;
    let settleCompleted!: (value: { status: string }) => void;
    let rejectCompleted!: (error: Error) => void;
    let settled = false;
    const completed = new Promise<{ status: string }>((resolve, reject) => {
      settleCompleted = resolve;
      rejectCompleted = reject;
    });

    const onNotification = (message: AppServerMessage) => {
      const notificationThreadId = messageThreadId(message);
      if (notificationThreadId && notificationThreadId !== threadId) return;
      const notificationTurnId = messageTurnId(message);
      if (turnId && notificationTurnId && notificationTurnId !== turnId) return;

      options.onNotification(message);
      if (message.method === 'turn/completed') {
        settled = true;
        this.off('notification', onNotification);
        this.off('fatal', onFatal);
        settleCompleted({ status: turnStatusFromCompleted(message) });
      }
    };
    const onFatal = (error: Error) => {
      if (settled) return;
      settled = true;
      this.off('notification', onNotification);
      rejectCompleted(error);
    };

    this.on('notification', onNotification);
    this.once('fatal', onFatal);

    try {
      const writableRoots = Array.from(new Set([options.cwd, ...(options.writableRoots ?? [])]));
      const turnParams: JsonRecord = {
        threadId,
        input: [{ type: 'text', text: options.prompt }],
        approvalPolicy: 'never',
        sandboxPolicy: options.sandbox === 'danger-full-access'
          ? { type: 'dangerFullAccess' }
          : {
              type: 'workspaceWrite',
              writableRoots,
              networkAccess: true,
            },
        ...(options.model && options.model !== 'default' ? { model: options.model } : {}),
        ...(options.reasoning && options.reasoning !== 'default'
          ? { effort: options.reasoning }
          : {}),
      };
      const turnResult = await this.request('turn/start', turnParams);
      turnId = responseTurnId(turnResult);
      if (!turnId) throw new Error('Codex app-server did not return a turn id');
    } catch (error) {
      this.off('notification', onNotification);
      this.off('fatal', onFatal);
      settled = true;
      rejectCompleted(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return {
      threadId,
      turnId,
      completed,
      interrupt: async () => {
        if (settled) return;
        await this.request('turn/interrupt', { threadId, turnId }, 10_000);
      },
    };
  }

  shutdown() {
    const proc = this.process;
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {}
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
}

const managers = new Map<string, CodexAppServerManager>();

function managerKey(
  command: string,
  env: NodeJS.ProcessEnv,
  startupConfigArgs: readonly string[],
): string {
  return `${command}\0${envFingerprint(sanitizeManagerEnv(env))}\0${JSON.stringify(startupConfigArgs)}`;
}

export function getCodexAppServerManager(
  command: string,
  env: NodeJS.ProcessEnv,
  startupConfigArgs: readonly string[] = [],
): CodexAppServerManager {
  const key = managerKey(command, env, startupConfigArgs);
  let manager = managers.get(key);
  if (!manager) {
    manager = new CodexAppServerManager(command, env, spawn, startupConfigArgs);
    managers.set(key, manager);
  }
  return manager;
}

/**
 * On a successful CLI install, new Runs must not reuse a Codex app-server
 * process that was spawned by the old binary (even when ~/.local/bin/codex
 * still resolves to the same path). In-flight Runs retain their manager
 * until their virtual children close, then that manager shuts down.
 */
export function retireCodexAppServerManagers(): void {
  const previous = [...managers.values()];
  managers.clear();
  for (const manager of previous) manager.retireWhenIdle();
}

export interface CodexAppServerVirtualChildOptions
  extends Omit<CodexAppServerTurnOptions, 'prompt' | 'onNotification'> {
  manager?: CodexAppServerManager;
  startupConfigArgs?: readonly string[];
}

export class CodexAppServerVirtualChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  private readonly promptChunks: Buffer[] = [];
  private controller: CodexAppServerTurnController | null = null;
  private readonly preparePromise: Promise<void>;
  private closeStarted = false;

  constructor(private readonly options: CodexAppServerVirtualChildOptions) {
    super();
    const manager = options.manager ?? getCodexAppServerManager(
      options.command,
      options.env,
      options.startupConfigArgs,
    );
    const releaseManager = manager.acquireRunLease();
    this.once('close', releaseManager);
    this.preparePromise = manager.prepare();
    // Startup begins as soon as the virtual child is created so a cold
    // app-server can initialize in parallel with the daemon wiring parsers and
    // SSE listeners. The prompt-final callback below owns surfacing failures.
    this.preparePromise.catch(() => undefined);
    this.pid = manager.pid;

    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.promptChunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
        callback();
      },
      final: (callback) => {
        callback();
        const prompt = Buffer.concat(this.promptChunks).toString('utf8');
        void this.preparePromise.then(() => manager.startTurn({
          ...options,
          prompt,
          onNotification: (message) => {
            this.stdout.write(`${JSON.stringify(message)}\n`);
          },
        })).then((controller) => {
          this.controller = controller;
          this.pid = manager.pid;
          return controller.completed;
        }).then(({ status }) => {
          const success = status === 'completed' || status === '';
          this.finish(success ? 0 : 1, null);
        }).catch((error) => {
          if (this.closeStarted) return;
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
          this.finish(1, null);
        });
      },
    });

    const onManagerStderr = (chunk: string) => {
      if (!this.closeStarted) this.stderr.write(chunk);
    };
    manager.on('stderr', onManagerStderr);
    this.once('close', () => manager.off('stderr', onManagerStderr));
  }

  private finish(code: number | null, signal: NodeJS.Signals | null) {
    if (this.closeStarted) return;
    this.closeStarted = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => {
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
    });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.closeStarted) return false;
    this.killed = true;
    this.signalCode = signal;
    if (this.controller) {
      void this.controller.interrupt()
        .catch(() => undefined)
        .finally(() => {
          if (!this.closeStarted) this.finish(null, signal);
        });
    } else {
      this.finish(null, signal);
    }
    return true;
  }
}

export function createCodexAppServerVirtualChild(
  options: CodexAppServerVirtualChildOptions,
): CodexAppServerVirtualChild {
  return new CodexAppServerVirtualChild(options);
}

export function shutdownCodexAppServers() {
  for (const manager of managers.values()) manager.shutdown();
  managers.clear();
}
