#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const target = process.env.REAL_CODEX_TARGET;
const logPath = process.env.CODEX_WRAPPER_LOG;
if (!target) {
  console.error('REAL_CODEX_TARGET is required');
  process.exit(2);
}
const argv = process.argv.slice(2);
const mcpEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith('OD_MCP_BRIDGE_')),
);
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({
    at: Date.now(),
    argv,
    mcpEnvKeys: Object.keys(mcpEnv),
    mcpEnv,
  }) + '\n');
}
const child = spawn(target, argv, {
  env: process.env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch {}
    return;
  }
  process.exit(code ?? 1);
});
