import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  attached: false,
  attachmentProtocol: '',
  commands: [] as Array<{ method: string; params?: Record<string, unknown> }>,
  detached: false,
  fallbackCalls: 0,
}));

vi.mock('electron', () => {
  const staleImage = {
    toJPEG: () => Buffer.from('stale-jpeg-frame'),
    toPNG: () => Buffer.from('stale-blank-frame'),
  };
  const freshImage = {
    toJPEG: () => Buffer.from('fresh-jpeg-frame'),
    toPNG: () => Buffer.from('fresh-png-frame'),
  };

  class BrowserWindow {
    readonly webContents = {
      capturePage: vi.fn(async () => {
        state.fallbackCalls += 1;
        return staleImage;
      }),
      debugger: {
        attach: (protocol: string) => {
          state.attached = true;
          state.attachmentProtocol = protocol;
        },
        detach: () => {
          state.attached = false;
          state.detached = true;
        },
        isAttached: () => state.attached,
        sendCommand: async (method: string, params?: Record<string, unknown>) => {
          state.commands.push({ method, params });
          if (method === 'Page.captureScreenshot') {
            return { data: Buffer.from('fresh-cdp-frame').toString('base64') };
          }
          return {};
        },
      },
      executeJavaScript: vi.fn(async () => true),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };

    async loadURL(): Promise<void> {}
    getContentSize(): [number, number] { return [1200, 800]; }
    setContentSize(): void {}
    setOpacity(): void {}
    showInactive(): void {}
    isDestroyed(): boolean { return false; }
    destroy(): void {}
  }

  return {
    BrowserWindow,
    nativeImage: {
      createFromBuffer: vi.fn((buffer: Buffer) => {
        expect(buffer).toEqual(Buffer.from('fresh-cdp-frame'));
        return freshImage;
      }),
    },
  };
});

vi.mock('../../src/main/pdf-export.js', () => ({
  DECK_PAGE_SIZE: {},
  DECK_PRINT_CSS: '',
  inferPageSize: vi.fn(),
  waitForPrintableContent: vi.fn(),
}));

import { exportArtifact } from '../../src/main/artifact-export.js';

beforeEach(() => {
  state.attached = false;
  state.attachmentProtocol = '';
  state.commands.length = 0;
  state.detached = false;
  state.fallbackCalls = 0;
});

describe('artifact image capture freshness', () => {
  it('uses a freshly rendered CDP frame instead of the stale capturePage frame', async () => {
    const result = await exportArtifact({
      deck: false,
      format: 'image',
      html: '<main>ready</main>',
      imageFormat: 'png',
      title: 'Project cover',
      viewportOnly: true,
    });

    try {
      expect(result.ok).toBe(true);
      expect(await readFile(result.path!)).toEqual(Buffer.from('fresh-png-frame'));
      expect(state.fallbackCalls).toBe(0);
      expect(state.attachmentProtocol).toBe('1.3');
      expect(state.detached).toBe(true);

      const capture = state.commands.find((command) => command.method === 'Page.captureScreenshot');
      expect(capture?.params).toEqual({
        clip: { height: 800, scale: 1, width: 1200, x: 0, y: 0 },
        format: 'png',
        fromSurface: true,
      });
    } finally {
      if (result.path) await rm(dirname(result.path), { force: true, recursive: true });
    }
  });

  it('captures JPEG directly from Chromium with the expected quality', async () => {
    const result = await exportArtifact({
      deck: false,
      format: 'image',
      html: '<main>ready</main>',
      imageFormat: 'jpeg',
      title: 'Project cover',
      viewportOnly: true,
    });

    try {
      expect(result.ok).toBe(true);
      expect(result.mime).toBe('image/jpeg');
      expect(await readFile(result.path!)).toEqual(Buffer.from('fresh-jpeg-frame'));
      expect(state.fallbackCalls).toBe(0);

      const capture = state.commands.find((command) => command.method === 'Page.captureScreenshot');
      expect(capture?.params).toMatchObject({ format: 'jpeg', quality: 92 });
    } finally {
      if (result.path) await rm(dirname(result.path), { force: true, recursive: true });
    }
  });
});
