import { useEffect, useRef, useState } from 'react';
import type { ManualEditPatch, ManualEditStyles } from './types';

export type ManualEditSaveState = 'saved' | 'pending' | 'saving' | 'error';
type Edit = { patch: ManualEditPatch; label: string };

/** Coalesce each element's edits, serialize writes, and retain failed snapshots for retry. */
export function useManualEditAutosave(
  identity: string,
  save: (patch: ManualEditPatch, label: string) => Promise<boolean>,
) {
  const [state, setState] = useState<ManualEditSaveState>('saved');
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef(new Map<string, Edit>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const generation = useRef(0);

  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function clear() {
    generation.current += 1;
    clearTimer();
    pending.current.clear();
    running.current = null;
  }

  useEffect(() => {
    setState('saved');
    return clear;
  }, [identity]);

  function flush(): Promise<boolean> {
    clearTimer();
    if (running.current) return running.current;
    const currentGeneration = generation.current;
    const work = async () => {
      while (pending.current.size && currentGeneration === generation.current) {
        const [key, edit] = pending.current.entries().next().value!;
        setState('saving');
        let ok = false;
        try {
          ok = await saveRef.current(edit.patch, edit.label);
        } catch {
          // Keep this edit available for an explicit retry.
        }
        if (currentGeneration !== generation.current) return false;
        if (!ok) {
          setState('error');
          return false;
        }
        if (pending.current.get(key) === edit) pending.current.delete(key);
      }
      if (currentGeneration === generation.current) setState('saved');
      return true;
    };
    const promise = work().finally(() => {
      if (running.current === promise) running.current = null;
    });
    running.current = promise;
    return promise;
  }

  function schedule(patch: ManualEditPatch, label: string) {
    const key = `${'id' in patch ? patch.id : patch.kind}:${patch.kind === 'set-style' ? 'style' : 'content'}`;
    const previous = pending.current.get(key)?.patch;
    const nextPatch = patch.kind === 'set-style' && previous?.kind === 'set-style'
      ? { ...patch, styles: { ...previous.styles, ...patch.styles } }
      : patch;
    pending.current.set(key, { patch: nextPatch, label });
    setState('pending');
    clearTimer();
    timer.current = setTimeout(() => { void flush(); }, 400);
  }

  function cancelStyles(id: string, keys: Array<keyof ManualEditStyles>) {
    const key = `${id}:style`;
    const edit = pending.current.get(key);
    if (edit?.patch.kind !== 'set-style') return;
    const styles = { ...edit.patch.styles };
    for (const prop of keys) delete styles[prop];
    if (Object.keys(styles).length) {
      pending.current.set(key, { ...edit, patch: { ...edit.patch, styles } });
    } else {
      pending.current.delete(key);
      if (!pending.current.size && !running.current) setState('saved');
    }
  }

  function contentFor(id: string) {
    return pending.current.get(`${id}:content`)?.patch;
  }

  return { state, schedule, flush, clear, cancelStyles, contentFor };
}
