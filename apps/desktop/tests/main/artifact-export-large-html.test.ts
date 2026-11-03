import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ url: '', loadedBytes: 0, destroyed: false, contentHeight: 800, painted: false, opacity: 1 }));
beforeEach(() => { state.destroyed = false; state.contentHeight = 800; state.painted = false; state.opacity = 1; });
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn(), on: vi.fn(),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('document.write(')) state.loadedBytes = Buffer.byteLength(script);
        return state.contentHeight;
      }),
      capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from(state.painted ? 'png' : 'stale-blank-frame') })),
    };
    async loadURL(url: string) {
      state.url = url;
      if (url.length > 2_000_000) throw new Error('ERR_INVALID_URL');
    }
    getContentSize() { return [1200, 800]; }
    setContentSize() {}
    setOpacity(opacity: number) { state.opacity = opacity; }
    showInactive() { expect(state.opacity).toBe(0); state.painted = true; }
    isDestroyed() { return state.destroyed; }
    destroy() { state.destroyed = true; }
  },
}));
vi.mock('../../src/main/pdf-export.js', () => ({
  DECK_PAGE_SIZE: {}, DECK_PRINT_CSS: '', inferPageSize: vi.fn(), waitForPrintableContent: vi.fn(),
}));

import { exportArtifact } from '../../src/main/artifact-export.js';
import { readFile, rm } from 'node:fs/promises';

describe('large HTML cover capture', () => {
  it('paints the cover without a visible window or focus change before capturing', async () => {
    const result = await exportArtifact({ deck: false, viewportOnly: true, format: 'image', title: 'Document', html: '<h1>Document contents</h1>' });
    try {
      expect(result.ok).toBe(true);
      expect(await readFile(result.path!)).toEqual(Buffer.from('png'));
    } finally { if (result.path) await rm(result.path, { force: true }); }
  });

  it('captures a tall document as one viewport when requested', async () => {
    state.contentHeight = 50_000;
    const result = await exportArtifact({ deck: false, viewportOnly: true, format: 'image', title: 'Cover', html: '<h1>Long document</h1>' });
    try { expect(result.ok).toBe(true); }
    finally { if (result.path) await rm(result.path, { force: true }); }
  });

  it('transfers a 7 MB document outside the URL while preserving an opaque origin', async () => {
    const result = await exportArtifact({
      deck: false, format: 'image', imageFormat: 'png', title: 'Large project',
      html: `<html><body>${'x'.repeat(7_000_000)}</body></html>`, width: 1200, height: 800,
    });
    try {
      expect(result.ok).toBe(true);
      expect(state.loadedBytes).toBeGreaterThan(7_000_000);
      expect(state.destroyed).toBe(true);
      expect(state.url).toMatch(/^data:text\/html/);
      expect(state.url.length).toBeLessThan(1000);
    } finally {
      if (result.path) await rm(result.path, { force: true });
    }
  });
});
