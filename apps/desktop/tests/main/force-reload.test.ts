import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installForceReload } from "../../src/main/force-reload.js";

function fixture() {
  const contents = { mainFrame: {}, reloadIgnoringCache: vi.fn(), reload: vi.fn() };
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: vi.fn(() => false),
  });
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (event: IpcMainInvokeEvent) => unknown) => handlers.set(channel, listener)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
  const dispose = installForceReload(window as unknown as BrowserWindow, ipc);
  const event = { sender: contents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  return { window, contents, handlers, dispose, event };
}

describe("native force reload", () => {
  it("uses Electron's cache-bypassing reload for the main frame only", () => {
    const f = fixture();
    const reload = f.handlers.get("od:browser:force-reload")!;
    expect(() => reload({ ...f.event, sender: {} } as IpcMainInvokeEvent)).toThrow("main HiDesign frame");
    expect(() => reload({ ...f.event, senderFrame: {} } as IpcMainInvokeEvent)).toThrow("main HiDesign frame");
    expect(f.contents.reloadIgnoringCache).not.toHaveBeenCalled();
    expect(reload(f.event)).toEqual({ ok: true });
    expect(f.contents.reloadIgnoringCache).toHaveBeenCalledOnce();
    expect(f.contents.reload).not.toHaveBeenCalled();
    f.window.isDestroyed.mockReturnValue(true);
    expect(() => reload(f.event)).toThrow("main HiDesign frame");
    expect(f.contents.reloadIgnoringCache).toHaveBeenCalledOnce();
    f.dispose();
  });

  it("retains the handler when hidden to tray, removes it on shutdown, and supports a new window", () => {
    const f = fixture();
    f.window.emit("close");
    expect(f.handlers.size).toBe(1);
    f.window.emit("closed");
    expect(f.handlers.size).toBe(0);
    expect(f.window.listenerCount("closed")).toBe(0);
    f.dispose();
    const next = fixture();
    expect(next.handlers.size).toBe(1);
    next.dispose();
    expect(next.handlers.size).toBe(0);
  });
});
