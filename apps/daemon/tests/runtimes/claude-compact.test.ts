import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { runClaudeCompact } from '../../src/runtimes/claude-compact.js';

describe('Claude native /compact transport', () => {
  let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  let inputText: string;
  beforeEach(() => {
    inputText = '';
    child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.stdin.on('data', (chunk) => { inputText += String(chunk); });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const start = () => runClaudeCompact({ command: '/usr/local/bin/claude', sessionId: 'current-session', cwd: '/project', env: {}, instructions: 'Keep layout constraints' });
  const emit = (frame: unknown) => child.stdout.write(JSON.stringify(frame) + '\n');
  it('resumes the exact session and sends only the native command, accepting split boundary frames', async () => {
    const pending = start();
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('--resume');
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('current-session');
    expect(JSON.parse(inputText).message.content).toEqual([{ type: 'text', text: '/compact Keep layout constraints' }]);
    child.stdout.write('{"type":"system","subtype":"compact_');
    child.stdout.write('boundary","compact_metadata":{"pre_tokens":12000}}\n');
    emit({ type: 'result', subtype: 'success', is_error: false });
    child.emit('close', 0, null);
    await expect(pending).resolves.toMatchObject({ compacted: true, preTokens: 12000 });
  });
  it('does not claim success from a model reply without a compaction boundary', async () => {
    const pending = start();
    emit({ type: 'result', result: 'I summarized the conversation.', is_error: false });
    child.emit('close', 0, null);
    await expect(pending).rejects.toThrow('I summarized');
  });
  it('reports a no-op without claiming compaction', async () => {
    const pending = start();
    emit({ type: 'result', result: 'Not enough messages to compact.', is_error: false });
    child.emit('close', 0, null);
    await expect(pending).resolves.toMatchObject({ compacted: false, detail: 'Not enough messages to compact.' });
  });
  it('preserves upstream errors even when the process exits zero', async () => {
    const pending = start();
    emit({ type: 'result', is_error: true, errors: ['API Error: 400 request body so large (1000)'] });
    child.emit('close', 0, null);
    await expect(pending).rejects.toThrow('request body so large');
  });
  it('rejects a truncated stream', async () => {
    const pending = start();
    emit({ type: 'system', subtype: 'compact_boundary' });
    child.emit('close', 1, null);
    await expect(pending).rejects.toThrow('failed');
  });
});
