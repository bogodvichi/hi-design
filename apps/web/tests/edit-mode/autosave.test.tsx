// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useManualEditAutosave } from '../../src/edit-mode/use-manual-edit-autosave';
import type { ManualEditPatch } from '../../src/edit-mode/types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const text = (id: string, value: string): ManualEditPatch => ({ kind: 'set-text', id, value });

describe('manual edit autosave', () => {
  it('coalesces changes at the debounce boundary without losing other elements or style fields', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const { result } = renderHook(() => useManualEditAutosave('file', save));
    act(() => {
      result.current.schedule(text('a', 'first'), 'Text');
      result.current.schedule(text('a', 'latest'), 'Text');
      result.current.schedule(text('b', 'other element'), 'Text');
      result.current.schedule({ kind: 'set-style', id: 'a', styles: { color: 'red' } }, 'Style');
      result.current.schedule({ kind: 'set-style', id: 'a', styles: { fontSize: '20px' } }, 'Style');
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(save.mock.calls).toEqual([
      [text('a', 'latest'), 'Text'],
      [text('b', 'other element'), 'Text'],
      [{ kind: 'set-style', id: 'a', styles: { color: 'red', fontSize: '20px' } }, 'Style'],
    ]);
    expect(result.current.state).toBe('saved');
  });

  it('serializes edits arriving during a slow save and flush waits for all of them', async () => {
    vi.useFakeTimers();
    let resolve!: (value: boolean) => void;
    const first = new Promise<boolean>((done) => { resolve = done; });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(true);
    const { result } = renderHook(() => useManualEditAutosave('file', save));
    act(() => { result.current.schedule(text('a', 'first'), 'Text'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    act(() => {
      result.current.schedule(text('a', 'newer'), 'Text');
      result.current.schedule(text('b', 'second target'), 'Text');
    });
    expect(save).toHaveBeenCalledTimes(1);
    let flushed!: Promise<boolean>;
    act(() => { flushed = result.current.flush(); });
    await act(async () => { resolve(true); expect(await flushed).toBe(true); });
    expect(save.mock.calls.map(([patch]) => patch)).toEqual([
      text('a', 'first'), text('a', 'newer'), text('b', 'second target'),
    ]);
    expect(result.current.state).toBe('saved');
  });

  it('retains a failed save and the following edits for explicit retry', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result } = renderHook(() => useManualEditAutosave('file', save));
    act(() => {
      result.current.schedule(text('a', 'unsaved'), 'Text');
      result.current.schedule(text('b', 'next'), 'Text');
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current.state).toBe('error');
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { expect(await result.current.flush()).toBe(true); });
    expect(save.mock.calls.map(([patch]) => patch)).toEqual([text('a', 'unsaved'), text('a', 'unsaved'), text('b', 'next')]);
  });

  it('cancels queued writes when the file changes', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const { result, rerender } = renderHook(({ file }) => useManualEditAutosave(file, save), { initialProps: { file: 'first' } });
    act(() => { result.current.schedule(text('a', 'old file'), 'Text'); });
    rerender({ file: 'second' });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(save).not.toHaveBeenCalled();
  });
});
