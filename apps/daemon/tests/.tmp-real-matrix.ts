import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const transport = process.env.BENCH_TRANSPORT === 'app-server' ? 'app-server' : 'exec';
const samples = Number(process.env.BENCH_SAMPLES || '3');
const requestedScenarios = new Set(
  (process.env.BENCH_SCENARIOS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const wants = (scenario: string) =>
  requestedScenarios.size === 0 || requestedScenarios.has(scenario);
const codexBin = process.env.REAL_CODEX_BIN;
const codexHome = process.env.REAL_CODEX_HOME || path.join(os.homedir(), '.codex');
const mcpScript = process.env.BENCH_MCP_SCRIPT;
const outPath = process.env.BENCH_OUT;

if (!codexBin || !mcpScript || !outPath) {
  throw new Error('REAL_CODEX_BIN, BENCH_MCP_SCRIPT and BENCH_OUT are required');
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `hidesign-matrix-${transport}-`));
process.env.OD_DATA_DIR = dataDir;
process.env.OD_CODEX_TRANSPORT = transport;
process.env.OD_PROMPT_CORE = 'native';
process.env.POSTHOG_KEY = '';
process.env.LANGFUSE_PUBLIC_KEY = '';
process.env.LANGFUSE_SECRET_KEY = '';

const [{ startServer }, { writeMcpConfig }] = await Promise.all([
  import('../src/server.js'),
  import('../src/mcp-config.js'),
]);

type Started = {
  url: string;
  server: import('node:http').Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = Record<string, any>;
type MatrixRow = {
  transportRequested: string;
  transportActual: string | null;
  fallbackReason: string | null;
  sample: number;
  scenario: string;
  status: string;
  promptBuildMs: number | null;
  preflightMs: number | null;
  spawnMs: number | null;
  stdinMs: number | null;
  firstModelMs: number | null;
  firstVisibleMs: number | null;
  toolDurationMs: number | null;
  totalMs: number | null;
  toolCalls: number | null;
  cacheHit: boolean | null;
  verification: boolean;
  error: string | null;
};

const rows: MatrixRow[] = [];
let server: Started | null = null;

function valueOf(diag: any): number | null {
  return diag && typeof diag === 'object' && typeof diag.value === 'number'
    ? diag.value
    : null;
}

async function requestJson(
  url: string,
  route: string,
  body: unknown,
  method = 'POST',
): Promise<any> {
  const response = await fetch(url + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function waitRun(
  url: string,
  runId: string,
): Promise<{ run: RunStatus; timedOut: boolean }> {
  const deadline = Date.now() + 300_000;
  let lastRun: RunStatus | null = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error(`run status ${response.status}`);
    const run = await response.json() as RunStatus;
    lastRun = run;
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) {
      return { run, timedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await fetch(`${url}/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: 'benchmark_timeout' }),
  }).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const finalResponse = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
  const finalRun = finalResponse.ok
    ? await finalResponse.json() as RunStatus
    : lastRun ?? { id: runId, status: 'running' };
  return { run: finalRun, timedOut: true };
}

async function rawText(url: string, projectId: string, file: string): Promise<string> {
  const response = await fetch(
    `${url}/api/projects/${encodeURIComponent(projectId)}/raw/${file.split('/').map(encodeURIComponent).join('/')}`,
  );
  if (!response.ok) return '';
  return response.text();
}

async function createProject(
  url: string,
  id: string,
  metadata: Record<string, unknown> = { kind: 'prototype' },
): Promise<{ conversationId: string }> {
  return requestJson(url, '/api/projects', {
    id,
    name: id,
    metadata,
    skipDiscoveryBrief: true,
  });
}

async function runTurn(args: {
  url: string;
  projectId: string;
  conversationId: string;
  sample: number;
  scenario: string;
  message: string;
  skillIds?: string[];
  context?: Record<string, unknown>;
  verify: () => Promise<boolean>;
}): Promise<RunStatus> {
  const body = await requestJson(args.url, '/api/runs', {
    projectId: args.projectId,
    conversationId: args.conversationId,
    assistantMessageId: `assistant_${randomUUID()}`,
    clientRequestId: `client_${randomUUID()}`,
    agentId: 'codex',
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    message: args.message,
    currentPrompt: args.message,
    ...(args.skillIds ? { skillIds: args.skillIds } : {}),
    ...(args.context ? { context: args.context } : {}),
  });

  const { run, timedOut } = await waitRun(args.url, body.runId);
  const timing = run.executionDiagnostics?.timing ?? {};
  const tools = run.executionDiagnostics?.tools ?? {};
  const verification =
    !timedOut && run.status === 'succeeded'
      ? await args.verify().catch(() => false)
      : false;
  const row: MatrixRow = {
    transportRequested: run.agentTransportRequested ?? transport,
    transportActual: run.agentTransport ?? null,
    fallbackReason: run.agentTransportFallbackReason ?? null,
    sample: args.sample,
    scenario: args.scenario,
    status: timedOut ? 'benchmark_timeout' : run.status,
    promptBuildMs: valueOf(timing.promptBuildDurationMs),
    preflightMs: valueOf(timing.launchPreflightDurationMs),
    spawnMs: valueOf(timing.processSpawnDurationMs),
    stdinMs: valueOf(timing.stdinWriteDurationMs),
    firstModelMs: valueOf(timing.firstModelEventWaitMs),
    firstVisibleMs: valueOf(timing.firstVisibleOutputWaitMs),
    toolDurationMs: valueOf(timing.toolDurationMs),
    totalMs: valueOf(timing.totalDurationMs),
    toolCalls: tools?.total && typeof tools.total.value === 'number' ? tools.total.value : null,
    cacheHit: typeof run.promptCache?.hit === 'boolean' ? run.promptCache.hit : null,
    verification,
    error: timedOut
      ? `benchmark timeout after 300s (run status: ${run.status})`
      : run.error ?? null,
  };
  rows.push(row);
  await fs.writeFile(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    transport,
    samples,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    complete: false,
    rows,
  }, null, 2), 'utf8');
  console.log('MATRIX_RESULT ' + JSON.stringify(row));
  if (run.status !== 'succeeded' || !verification) {
    console.error('MATRIX_FAILURE ' + JSON.stringify(row));
  }
  return run;
}

async function writeDirectFixture(
  projectId: string,
  file: string,
  text: string,
): Promise<void> {
  const dir = path.join(dataDir, 'projects', projectId);
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await fs.writeFile(path.join(dir, file), text, 'utf8');
}

try {
  server = await startServer({ port: 0, returnServer: true }) as Started;

  const mcpLog = path.join(dataDir, `benchmark-mcp-${transport}.jsonl`);
  await writeMcpConfig(dataDir, {
    servers: [{
      id: 'benchmark-mcp',
      label: 'Benchmark MCP',
      transport: 'stdio',
      enabled: true,
      command: process.execPath,
      args: [mcpScript],
      env: {
        BENCH_MCP_LOG: mcpLog,
        BENCH_MCP_TOKEN: 'MCP-FIXTURE-938271',
      },
    }],
  });

  await requestJson(server.url, '/api/app-config', {
    agentId: 'codex',
    agentCliEnv: { codex: { CODEX_BIN: codexBin, CODEX_HOME: codexHome } },
    telemetry: { metrics: true, content: false, artifactManifest: false },
    privacyDecisionAt: Date.now(),
  }, 'PUT');

  for (let sample = 1; sample <= samples; sample += 1) {
    if (wants('direct_html') || wants('html_edit')) {
      const projectId = `matrix_direct_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      const { conversationId } = await createProject(server.url, projectId);
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'direct_html',
        message: 'Create a self-contained index.html dashboard with a header, three statistic cards, and a compact activity list. Use only HTML and CSS, no external assets or packages. Keep it concise. After writing the file, reply only DONE.',
        verify: async () => (await rawText(server!.url, projectId, 'index.html')).includes('<html'),
      });
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'html_edit',
        message: 'Modify index.html: add a small System Status badge in the header and improve mobile spacing. Keep the page self-contained. Reply only DONE.',
        verify: async () => /system status/i.test(await rawText(server!.url, projectId, 'index.html')),
      });
    }

    if (wants('requirements_md') || wants('requirements_to_html')) {
      const projectId = `matrix_req_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      const { conversationId } = await createProject(server.url, projectId);
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'requirements_md',
        message: 'Create 需求.md for a compact B2B device operations dashboard. Include goals, target users, information architecture, key modules, interaction rules, visual constraints, and acceptance criteria. Keep it practical and under 900 Chinese characters. Reply only DONE.',
        verify: async () => {
          const text = await rawText(server!.url, projectId, '需求.md');
          return text.length > 150;
        },
      });
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'requirements_to_html',
        message: 'Read 需求.md and implement its main page as a self-contained index.html using only HTML and CSS. The page must visibly include the core modules described in the requirements. Reply only DONE.',
        verify: async () => (await rawText(server!.url, projectId, 'index.html')).includes('<html'),
      });
    }

    if (wants('skill_html')) {
      const projectId = `matrix_skill_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      const { conversationId } = await createProject(server.url, projectId);
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'skill_html',
        skillIds: ['swiss-creative-mode-template'],
        message: 'Use the selected swiss-creative-mode-template skill to create a self-contained index.html for a compact AI design workspace landing page. Follow the skill guidance and create the file. Reply only DONE.',
        verify: async () => (await rawText(server!.url, projectId, 'index.html')).includes('<html'),
      });
    }

    if (wants('cross_project')) {
      const referenceId = `matrix_reference_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      await createProject(server.url, referenceId);
      const marker = `REF-${transport.toUpperCase()}-${sample}-7319`;
      await writeDirectFixture(
        referenceId,
        'reference.md',
        `# Reference project\n\nUnique marker: ${marker}\n\nDesign rule: use a two-column layout, a compact navy header, and a highlighted orange insight card.\n`,
      );
      const referenceDir = path.join(dataDir, 'projects', referenceId);

      const projectId = `matrix_cross_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      const { conversationId } = await createProject(server.url, projectId, {
        kind: 'prototype',
        linkedDirs: [referenceDir],
      });
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'cross_project',
        message: 'Read reference.md from the linked reference project. Create a self-contained index.html in the current project that follows its design rule and includes the exact unique marker from that reference file in visible text. Reply only DONE.',
        verify: async () => (await rawText(server!.url, projectId, 'index.html')).includes(marker),
      });
    }

    if (wants('mcp')) {
      const beforeCalls = await fs.readFile(mcpLog, 'utf8').catch(() => '');
      const beforeCount = beforeCalls.trim() ? beforeCalls.trim().split('\n').length : 0;
      const projectId = `matrix_mcp_${transport.replace('-', '_')}_${sample}_${randomUUID()}`;
      const { conversationId } = await createProject(server.url, projectId);
      await runTurn({
        url: server.url,
        projectId,
        conversationId,
        sample,
        scenario: 'mcp',
        context: {
          mcpServerIds: ['benchmark-mcp'],
          requiredMcpServerIds: ['benchmark-mcp'],
        },
        message: 'Use the selected Benchmark MCP server and call its get_benchmark_spec tool. Then create mcp-result.md containing the returned title and exact token. Do not invent the token. Reply only DONE.',
        verify: async () => {
          const [body, afterCalls] = await Promise.all([
            rawText(server!.url, projectId, 'mcp-result.md'),
            fs.readFile(mcpLog, 'utf8').catch(() => ''),
          ]);
          const afterCount = afterCalls.trim() ? afterCalls.trim().split('\n').length : 0;
          return body.includes('MCP-FIXTURE-938271') && afterCount > beforeCount;
        },
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    transport,
    samples,
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    complete: true,
    rows,
  };
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('MATRIX_OUT ' + outPath);
} finally {
  await Promise.resolve(server?.shutdown?.()).catch(() => {});
  if (server?.server?.listening) {
    await new Promise<void>((resolve) => server!.server.close(() => resolve()));
  }
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
