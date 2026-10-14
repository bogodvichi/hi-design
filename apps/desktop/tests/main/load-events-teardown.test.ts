import { EventEmitter } from "node:events";

import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DesktopRuntime } from "../../src/main/runtime.js";

const windows: MockWindow[] = [];

class MockWindow extends EventEmitter {
  destroyed = false;
  contentsDestroyed = false;
  onClosing?: () => void;
  contents = Object.assign(new EventEmitter(), {
    session: new EventEmitter(),
    isDestroyed: () => this.contentsDestroyed,
    getURL: vi.fn(() => {
      if (this.destroyed || this.contentsDestroyed) throw new TypeError("Object has been destroyed");
      return "od://app/";
    }),
    setWindowOpenHandler: vi.fn(),
    insertCSS: vi.fn(async () => ""),
    executeJavaScript: vi.fn(async () => undefined),
    send: vi.fn(),
  });

  constructor() {
    super();
    windows.push(this);
  }

  get webContents() {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.contents;
  }

  isDestroyed() { return this.destroyed; }
  getTitle = vi.fn(() => {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return "Hi Design Team";
  });
  setTitle = vi.fn();
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setWindowButtonVisibility = vi.fn();
  isFullScreen = vi.fn(() => false);
  close() {
    this.onClosing?.();
    this.destroyed = true;
    this.contentsDestroyed = true;
  }
}

vi.doMock("electron", () => ({
  BrowserWindow: MockWindow,
  app: {},
  ipcMain: Object.assign(new EventEmitter(), { handle: vi.fn(), removeHandler: vi.fn() }),
  nativeTheme: {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 900 } }) },
  webFrameMain: { fromId: vi.fn(() => undefined) },
}));

const events = ["did-start-loading", "dom-ready", "did-finish-load", "did-fail-load", "page-title-updated", "unresponsive", "responsive"] as const;

function emit(window: MockWindow, event: typeof events[number]) {
  if (event === "page-title-updated") {
    window.emit(event, { preventDefault: vi.fn() });
  } else if (event === "unresponsive" || event === "responsive") {
    window.emit(event);
  } else {
    window.contents.emit(event, {}, -3, "ERR_ABORTED", "od://app/", true, 1, 1);
  }
}

describe("main-window events during teardown", () => {
  let runtime: DesktopRuntime;
  let window: MockWindow;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    windows.length = 0;
    const splash = new MockWindow();
    const { createDesktopRuntime } = await import("../../src/main/runtime.js");
    runtime = await createDesktopRuntime({
      discoverUrl: async () => null,
      splashWindow: splash as unknown as BrowserWindow,
    });
    window = windows[2]; // Supplied splash, pet, main window.
  });

  afterEach(async () => {
    await runtime?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test.each(events)("ignores late %s after the window is destroyed", (event) => {
    window.close();
    expect(() => emit(window, event)).not.toThrow();
    expect(window.contents.getURL).not.toHaveBeenCalled();
    expect(window.getTitle).not.toHaveBeenCalled();
    expect(window.setTitle).not.toHaveBeenCalled();
    expect(window.contents.send).not.toHaveBeenCalled();
  });

  test.each(events)("ignores late %s after only webContents is destroyed", (event) => {
    window.contentsDestroyed = true;
    expect(() => emit(window, event)).not.toThrow();
    expect(window.contents.getURL).not.toHaveBeenCalled();
    expect(window.getTitle).not.toHaveBeenCalled();
    expect(window.setTitle).not.toHaveBeenCalled();
    expect(window.contents.send).not.toHaveBeenCalled();
  });

  test("ignores loading events once shutdown starts, before native destruction", async () => {
    window.onClosing = () => {
      expect(window.isDestroyed()).toBe(false);
      emit(window, "did-start-loading");
    };
    await runtime.close();
    expect(window.contents.getURL).not.toHaveBeenCalled();
  });

  test("keeps URL and title diagnostics while the window is alive", () => {
    emit(window, "did-start-loading");
    expect(console.info).toHaveBeenCalledWith(
      "[open-design desktop] main window did-start-loading",
      { pendingUrl: null, url: "od://app/" },
    );
    emit(window, "dom-ready");
    emit(window, "did-finish-load");
    expect(window.contents.getURL).toHaveBeenCalledTimes(3);
    expect(window.getTitle).toHaveBeenCalledTimes(2);
  });
});
