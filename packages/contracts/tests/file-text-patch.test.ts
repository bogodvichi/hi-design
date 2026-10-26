import { describe, expect, it } from 'vitest';
import { applyProjectFileTextEdits, projectFileTextPatchSchema } from '../src/api/files.js';

describe('file text patches', () => {
  it('applies ordered edits against base offsets, including Chinese and emoji text', () => {
    expect(applyProjectFileTextEdits('标题🙂 color:red; end', [
      { start: 0, deleteCount: 2, insert: '新标题' },
      { start: 11, deleteCount: 3, insert: 'blue' },
    ])).toBe('新标题🙂 color:blue; end');
  });

  it('rejects overlapping, out-of-bounds and invalid ranges', () => {
    for (const edits of [
      [{ start: 1, deleteCount: 3, insert: '' }, { start: 2, deleteCount: 0, insert: 'x' }],
      [{ start: 2, deleteCount: 9, insert: '' }],
      [{ start: -1, deleteCount: 1, insert: '' }],
    ]) expect(() => applyProjectFileTextEdits('hello', edits)).toThrow();
    expect(projectFileTextPatchSchema.safeParse({ baseDigest: 'bad', edits: [] }).success).toBe(false);
  });
});
