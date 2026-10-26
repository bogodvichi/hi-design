import { describe, expect, it } from 'vitest';
import { isContextSizeError, parseCompactCommand } from '../src/api/native-commands.js';

describe('native command recognition', () => {
  it('recognizes only a standalone /compact command with optional focus', () => {
    expect(parseCompactCommand('/compact')).toEqual({ instructions: '' });
    expect(parseCompactCommand('/compact 保留布局要求')).toEqual({ instructions: '保留布局要求' });
    for (const text of ['What does /compact do?', '`/compact`', '```\n/compact\n```', '/compactness', '/compact\nPlease edit this file']) {
      expect(parseCompactCommand(text)).toBeNull();
    }
  });
  it('recognizes size failures without matching unrelated 400 errors', () => {
    for (const text of ['API Error: 400 {"error":"request body so large (1000)"}', 'Prompt is too long', 'maximum context length exceeded', 'context window exceeded', 'Payload Too Large']) expect(isContextSizeError(text)).toBe(true);
    for (const text of ['API Error: 400 invalid tool schema', 'HTTP 401 unauthorized', 'failed to upload image']) expect(isContextSizeError(text)).toBe(false);
  });
});
