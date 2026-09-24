import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';
import { writeMcpConfig } from '../src/mcp-config.js';

type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type Run = {
  id: string;
  status: string;
  agentTransport?: string | null;
  agentTransportRequested?: string | null;
  agentTransportFallbackReason?: string | null;
};

describe('codex app-server transport integration', () => {
  const oldTransport = process.env.OD_CODEX_TRANSPORT;
  const oldPromptCore = process.env.OD_PROMPT_CORE;
  let started: Started | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server?.listening) {
      await new Promise<void>((resolve) => started!.server.close(() => resolve()));
    }
    started = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
    setEnv('OD_CODEX_TRANSPORT', oldTransport);
    setEnv('OD_PROMPT_CORE', oldPromptCore);
  });

  it('reuses one app-server process and resumes its thread on turn two', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'od-codex-app-server-'));
    const { bin, log } = await writeFake(dir);
    process.env.OD_CODEX_TRANSPORT = 'app-server';
    process.env.OD_PROMPT_CORE = 'native';

    started = (await startServer({ port: 0, returnServer: true })) as Started;
    if (!process.env.OD_DATA_DIR) throw new Error('OD_DATA_DIR missing');
    await writeMcpConfig(process.env.OD_DATA_DIR, { servers: [] });
    await put(started.url, '/api/app-config', {
      agentId: 'codex',
      agentCliEnv: { codex: { CODEX_BIN: bin, CODEX_HOME: dir } },
      telemetry: { metrics: true, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const projectId = `codex_app_${randomUUID()}`;
    const project = await put(started.url, '/api/projects', {
      id: projectId,
      name: 'app server smoke',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }) as { conversationId: string };

    const first = await run(started.url, projectId, project.conversationId, 'first');
    expect(first).toMatchObject({
      status: 'succeeded',
      agentTransportRequested: 'app-server',
      agentTransport: 'app-server',
      agentTransportFallbackReason: null,
    });

    const second = await run(started.url, projectId, project.conversationId, 'second');
    expect(second).toMatchObject({ status: 'succeeded', agentTransport: 'app-server' });

    const records = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; argv?: string[]; method?: string });
    expect(records.filter((r) => r.kind === 'process' && r.argv?.includes('app-server'))).toHaveLength(1);
    const methods = records.filter((r) => r.kind === 'rpc').map((r) => r.method);
    expect(methods.filter((m) => m === 'initialize')).toHaveLength(1);
    expect(methods.filter((m) => m === 'thread/start')).toHaveLength(1);
    expect(methods.filter((m) => m === 'thread/resume')).toHaveLength(1);
    expect(methods.filter((m) => m === 'turn/start')).toHaveLength(2);
  });
});

async function run(url: string, projectId: string, conversationId: string, message: string): Promise<Run> {
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId: `assistant_${randomUUID()}`,
      clientRequestId: `client_${randomUUID()}`,
      agentId: 'codex',
      message,
      currentPrompt: message,
    }),
  });
  expect(response.status).toBe(202);
  const { runId } = await response.json() as { runId: string };
  for (let i = 0; i < 160; i += 1) {
    const status = await fetch(`${url}/api/runs/${runId}`);
    const value = await status.json() as Run;
    if (['succeeded', 'failed', 'canceled'].includes(value.status)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function put(url: string, route: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${url}${route}`, {
    method: route === '/api/app-config' ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function writeFake(dir: string): Promise<{ bin: string; log: string }> {
  const bin = path.join(dir, 'codex-fake');
  const log = path.join(dir, 'rpc.jsonl');
  const src = `#!/usr/bin/env node
const fs=require('node:fs'),argv=process.argv.slice(2),log=${JSON.stringify(log)},thread='thread-app-server';
const rec=x=>fs.appendFileSync(log,JSON.stringify(x)+'\\n');
rec({kind:'process',argv});
if(argv.includes('--version')){console.log('codex-cli 0.154.0');process.exit(0)}
if(argv.includes('--help')){console.log('Usage: codex exec');process.exit(0)}
if(argv.includes('debug')&&argv.includes('models')){console.log(JSON.stringify({models:[{slug:'gpt-test',display_name:'GPT Test',visibility:'list'}]}));process.exit(0)}
if(argv.includes('login')&&argv.includes('status')){console.log('Logged in using ChatGPT');process.exit(0)}
if(!argv.includes('app-server')) process.exit(2);
let buf='',turn=0;
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\\n'))>=0){const s=buf.slice(0,n);buf=buf.slice(n+1);if(!s)continue;const m=JSON.parse(s);rec({kind:'rpc',method:m.method});if(m.id===undefined)continue;
if(m.method==='initialize')send({id:m.id,result:{}});
else if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:thread}}});
else if(m.method==='turn/start'){turn++;const id='turn-'+turn;send({id:m.id,result:{turn:{id,status:'inProgress'}}});queueMicrotask(()=>{send({method:'turn/started',params:{threadId:thread,turn:{id,status:'inProgress'}}});send({method:'item/agentMessage/delta',params:{threadId:thread,turnId:id,itemId:'msg-'+turn,delta:'ok-'+turn}});send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'completed'}}})})}
else if(m.method==='turn/interrupt')send({id:m.id,result:{}});
else send({id:m.id,error:{code:-32601,message:'unsupported'}})}});process.stdin.resume();`;
  await writeFile(bin, src, 'utf8');
  await chmod(bin, 0o755);
  return { bin, log };
}
