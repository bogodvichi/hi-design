import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hidesign-mcp-diag-'));
process.env.OD_DATA_DIR = root;
process.env.OD_PROMPT_CORE = 'native';
process.env.OD_CODEX_TRANSPORT = 'exec';
process.env.REAL_CODEX_TARGET = '/Users/wengwenxiu/.nvm/versions/node/v24.18.0/bin/codex';
process.env.CODEX_WRAPPER_LOG = '/tmp/hidesign-codex-wrapper.log';

const [{ startServer }, { writeMcpConfig }] = await Promise.all([
  import('../src/server.js'),
  import('../src/mcp-config.js'),
]);

const mcpScript = path.resolve('tests/.tmp-benchmark-mcp.mjs');
const wrapper = path.resolve('tests/.tmp-codex-wrapper.mjs');
const mcpLog = '/tmp/hidesign-target-mcp.log';

const started = await startServer({ port: 0, returnServer: true }) as {
  url: string;
  server: import('node:http').Server;
  shutdown?: () => Promise<void> | void;
};

async function req(route: string, body: unknown, method = 'POST') {
  const r = await fetch(started.url + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

await writeMcpConfig(root, {
  servers: [{
    id: 'benchmark-mcp',
    label: 'Benchmark MCP',
    transport: 'stdio',
    enabled: true,
    command: process.execPath,
    args: [mcpScript],
    env: {
      BENCH_MCP_LOG: mcpLog,
      BENCH_MCP_TOKEN: 'MCP-HIDESIGN-44321',
    },
  }],
});

await req('/api/app-config', {
  agentId: 'codex',
  agentCliEnv: {
    codex: {
      CODEX_BIN: wrapper,
      CODEX_HOME: '/Users/wengwenxiu/.codex',
      REAL_CODEX_TARGET: process.env.REAL_CODEX_TARGET,
      CODEX_WRAPPER_LOG: process.env.CODEX_WRAPPER_LOG,
    },
  },
  telemetry: { metrics: true, content: false, artifactManifest: false },
  privacyDecisionAt: Date.now(),
}, 'PUT');

const projectId = `mcp_diag_${randomUUID()}`;
const project = await req('/api/projects', {
  id: projectId,
  name: 'MCP diagnostic',
  metadata: { kind: 'prototype' },
  skipDiscoveryBrief: true,
}) as { conversationId: string };

const created = await req('/api/runs', {
  projectId,
  conversationId: project.conversationId,
  assistantMessageId: `assistant_${randomUUID()}`,
  clientRequestId: `client_${randomUUID()}`,
  agentId: 'codex',
  model: 'gpt-5.6-sol',
  reasoning: 'medium',
  message: 'Use the selected Benchmark MCP server. Call get_benchmark_spec exactly once, then create mcp-result.md containing the exact token. Reply only DONE.',
  currentPrompt: 'Use the selected Benchmark MCP server. Call get_benchmark_spec exactly once, then create mcp-result.md containing the exact token. Reply only DONE.',
  context: {
    mcpServerIds: ['benchmark-mcp'],
    requiredMcpServerIds: ['benchmark-mcp'],
  },
}) as { runId: string };

let run: any = null;
for (let i = 0; i < 1800; i += 1) {
  const r = await fetch(started.url + '/api/runs/' + created.runId);
  run = await r.json();
  if (['succeeded', 'failed', 'canceled'].includes(run.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

console.log('DIAG_ROOT', root);
console.log('RUN', JSON.stringify({
  id: run?.id,
  status: run?.status,
  error: run?.error,
  transport: run?.agentTransport,
  requested: run?.agentTransportRequested,
  fallback: run?.agentTransportFallbackReason,
  eventsLogPath: run?.eventsLogPath,
  tools: run?.executionDiagnostics?.tools,
}, null, 2));

const raw = await fetch(started.url + '/api/projects/' + projectId + '/raw/mcp-result.md');
console.log('RESULT_FILE_STATUS', raw.status);
if (raw.ok) console.log('RESULT_FILE', await raw.text());

await Promise.resolve(started.shutdown?.());
if (started.server.listening) {
  await new Promise<void>((resolve) => started.server.close(() => resolve()));
}
