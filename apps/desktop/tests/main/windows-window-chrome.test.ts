import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, test, vi } from "vitest";
import { installWindowsWindowControls, windowsWindowChrome } from "../../src/main/windows-window-chrome.js";

function fixture() {
  let maximized = false, fullscreen = false, destroyed = false;
  const contents = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const window = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: () => destroyed,
    isMaximized: () => maximized, isFullScreen: () => fullscreen,
    minimize: vi.fn(), close: vi.fn(),
    maximize: vi.fn(() => { maximized = true; window.emit("maximize"); }),
    unmaximize: vi.fn(() => { maximized = false; window.emit("unmaximize"); }),
  });
  const handlers = new Map<string, (event: IpcMainInvokeEvent, action?: unknown) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (event: IpcMainInvokeEvent, action?: unknown) => unknown) => { handlers.set(channel, listener); }),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
  };
  const event = { sender: contents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  const dispose = installWindowsWindowControls(window as unknown as BrowserWindow, ipc);
  return { window, contents, handlers, event, dispose,
    invoke: (channel: string, action?: unknown) => handlers.get(channel)!(event, action),
    fullscreen: () => { fullscreen = true; window.emit("enter-full-screen"); },
    destroy: () => { destroyed = true; window.emit("closed"); },
  };
}

describe("Windows integrated tab and title bar", () => {
  test("hides native captions only on Windows and retains the resizable window frame", () => {
    const options = windowsWindowChrome("win32");
    expect(options).toEqual({ titleBarStyle: "hidden", titleBarOverlay: false });
    expect(options).not.toHaveProperty("frame");
    expect(windowsWindowChrome("darwin")).toEqual({});
    expect(windowsWindowChrome("linux")).toEqual({});
  });

  test("minimizes, toggles maximize/restore, and sends close through the existing window lifecycle", () => {
    const f = fixture();
    expect(f.invoke("od:window:action", "minimize")).toEqual({ ok: true });
    expect(f.window.minimize).toHaveBeenCalledOnce();
    f.invoke("od:window:action", "toggle-maximize");
    expect(f.invoke("od:window:state")).toEqual({ maximized: true, fullscreen: false });
    expect(f.contents.send).toHaveBeenLastCalledWith("od:window:state-changed", { maximized: true, fullscreen: false });
    f.invoke("od:window:action", "toggle-maximize");
    expect(f.window.unmaximize).toHaveBeenCalledOnce();
    f.invoke("od:window:action", "close");
    expect(f.window.close).toHaveBeenCalledOnce();
    f.dispose();
  });

  test("rejects subframes, foreign webContents and unsupported actions", () => {
    const f = fixture(), action = f.handlers.get("od:window:action")!;
    expect(() => action({ ...f.event, senderFrame: {} } as IpcMainInvokeEvent, "close")).toThrow("main HiDesign frame");
    expect(() => action({ ...f.event, sender: {} } as IpcMainInvokeEvent, "close")).toThrow("main HiDesign frame");
    expect(f.invoke("od:window:action", "quit")).toEqual({ ok: false, reason: "unsupported window action" });
    expect(f.window.close).not.toHaveBeenCalled();
    f.dispose();
  });

  test("publishes fullscreen state and cleans IPC/listeners on shutdown, not hide-to-tray", () => {
    const f = fixture();
    f.fullscreen();
    expect(f.contents.send).toHaveBeenLastCalledWith("od:window:state-changed", { maximized: false, fullscreen: true });
    f.window.emit("close");
    expect(f.handlers.size).toBe(2);
    f.destroy();
    expect(f.handlers.size).toBe(0);
    expect(f.window.listenerCount("maximize")).toBe(0);
    f.dispose();
    expect(f.window.listenerCount("closed")).toBe(0);
  });
});
