import { spawn } from 'node:child_process';
import { createCommandInvocation } from '@open-design/platform';
import type { CompactConversationRequest } from '@open-design/contracts';

export const activeClaudeCompactions = new Set<string>();
const COMPACT_TIMEOUT_MS = 5 * 60_000;

export interface ClaudeCompactResult {
  compacted: boolean;
  preTokens?: number;
  detail: string;
}

/** Resume the exact session and send only the native command, never a composed prompt. */
export function runClaudeCompact(input: CompactConversationRequest & {
  command: string;
  sessionId: string;
  model?: string | null;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onChild?: (child: ReturnType<typeof spawn>) => void;
}): Promise<ClaudeCompactResult> {
  return new Promise((resolve, reject) => {
    const invocation = createCommandInvocation({
      command: input.command,
      args: ['-p', '--resume', input.sessionId, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...(input.model && input.model !== 'default' ? ['--model', input.model] : [])],
      env: input.env,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd: input.cwd, env: input.env, shell: false,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    input.onChild?.(child);
    let buffer = '';
    let stderr = '';
    let compacted = false;
    let preTokens: number | undefined;
    let resultSeen = false;
    let resultError = false;
    let detail = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, COMPACT_TIMEOUT_MS);
    const handleLine = (line: string) => {
      let frame: Record<string, any>;
      try { frame = JSON.parse(line); } catch { return; }
      if (frame.type === 'system' && frame.subtype === 'compact_boundary') {
        compacted = true;
        if (typeof frame.compact_metadata?.pre_tokens === 'number') preTokens = frame.compact_metadata.pre_tokens;
      }
      if (frame.type === 'result') {
        resultSeen = true;
        resultError = frame.is_error === true || (typeof frame.subtype === 'string' && frame.subtype !== 'success');
        detail = Array.isArray(frame.errors) && frame.errors.length
          ? frame.errors.join('\n') : typeof frame.result === 'string' ? frame.result : '';
        child.stdin?.end();
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-16_384); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (buffer.trim()) handleLine(buffer);
      if (timedOut || code !== 0 || resultError || !resultSeen) {
        reject(new Error(timedOut ? 'Claude context compaction timed out.'
          : detail || stderr || `Claude context compaction failed (${signal ?? code}).`));
      } else if (!compacted && !/not enough messages|nothing to compact|already compact/i.test(detail)) {
        reject(new Error(detail || 'Claude did not report a compaction boundary. This CLI may not support /compact in this mode.'));
      } else {
        resolve({ compacted, ...(preTokens !== undefined ? { preTokens } : {}), detail });
      }
    });
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') child.kill('SIGTERM');
    });
    const prompt = input.instructions?.trim() ? `/compact ${input.instructions.trim()}` : '/compact';
    child.stdin?.end(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }) + '\n');
  });
}
