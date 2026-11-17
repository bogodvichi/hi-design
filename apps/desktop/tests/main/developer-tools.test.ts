import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { desktopDeveloperToolsEnabled, installDeveloperTools } from "../../src/main/developer-tools.js";

function fixture(enabled = true) {
  const contents = { mainFrame: {}, openDevTools: vi.fn() };
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: vi.fn(() => false),
  });
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (event: IpcMainInvokeEvent) => unknown) => handlers.set(channel, listener)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
  const dispose = installDeveloperTools(window as unknown as BrowserWindow, ipc, enabled);
  const event = { sender: contents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  return { window, contents, handlers, ipc, dispose, event };
}

describe("native developer tools", () => {
  it("requires an explicit opt-in outside development, independently of window chrome", () => {
    expect(desktopDeveloperToolsEnabled("development", undefined)).toBe(true);
    expect(desktopDeveloperToolsEnabled("production", undefined)).toBe(false);
    expect(desktopDeveloperToolsEnabled("production", "true")).toBe(false);
    expect(desktopDeveloperToolsEnabled("production", "1")).toBe(true);
    expect(fixture(false).ipc.handle).not.toHaveBeenCalled();
  });

  it("opens detached tools for the main frame and rejects foreign senders, subframes and destroyed windows", () => {
    const f = fixture();
    const open = f.handlers.get("od:developer-tools:open")!;
    expect(open(f.event)).toEqual({ ok: true });
    expect(f.contents.openDevTools).toHaveBeenCalledWith({ mode: "detach" });
    expect(() => open({ ...f.event, sender: {} } as IpcMainInvokeEvent)).toThrow("main HiDesign frame");
    expect(() => open({ ...f.event, senderFrame: {} } as IpcMainInvokeEvent)).toThrow("main HiDesign frame");
    f.window.isDestroyed.mockReturnValue(true);
    expect(() => open(f.event)).toThrow("main HiDesign frame");
    expect(f.contents.openDevTools).toHaveBeenCalledOnce();
    f.dispose();
  });

  it("retains the handler when hidden to tray and removes it on shutdown", () => {
    const f = fixture();
    f.window.emit("close");
    expect(f.handlers.size).toBe(1);
    f.window.emit("closed");
    expect(f.handlers.size).toBe(0);
    expect(f.window.listenerCount("closed")).toBe(0);
    f.dispose();
  });
});
