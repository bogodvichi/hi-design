import { EventEmitter } from "node:events";

import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFromPath: vi.fn(),
  buildFromTemplate: vi.fn(),
  createTray: vi.fn(),
}));

const ipc = new EventEmitter();

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  Tray: class { constructor(icon: unknown) { return mocks.createTray(icon); } },
  nativeImage: { createFromPath: mocks.createFromPath },
  get ipcMain() { return ipc; },
}));

import { ensureWindowVisible } from "../../src/main/runtime.js";
import { installWindowsTray } from "../../src/main/windows-tray.js";

describe("Windows close to system tray", () => {
  let dispose: () => void;
  let tray: EventEmitter & { setToolTip: ReturnType<typeof vi.fn>; setContextMenu: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  let window: EventEmitter & {
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    webContents: EventEmitter & { isDestroyed: () => boolean; focus: ReturnType<typeof vi.fn>; mainFrame: object };
  };
  let quit: ReturnType<typeof vi.fn<() => void>>;
  let openProject: ReturnType<typeof vi.fn<(id: string) => void>>;
  let menu: MenuItemConstructorOptions[];

  function install(osLocale = "zh-CN") {
    return installWindowsTray(window as unknown as BrowserWindow, {
      iconPath: "/app/app-icon.png",
      title: "Hi Design Team",
      osLocale,
      show: () => ensureWindowVisible(window as unknown as BrowserWindow),
      quit,
      openProject,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    tray = Object.assign(new EventEmitter(), {
      setToolTip: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn(),
    });
    window = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true),
      isVisible: vi.fn(() => false), hide: vi.fn(), restore: vi.fn(),
      show: vi.fn(), focus: vi.fn(),
      webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, focus: vi.fn(), mainFrame: {} }),
    });
    quit = vi.fn();
    openProject = vi.fn();
    mocks.createFromPath.mockReturnValue({ isEmpty: () => false });
    mocks.createTray.mockReturnValue(tray);
    mocks.buildFromTemplate.mockImplementation((template) => { menu = template; return template; });
  });

  afterEach(() => {
    dispose?.();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("keeps the initial window visible and leaves minimization on the taskbar", () => {
    dispose = install();
    expect(window.hide).not.toHaveBeenCalled();
    window.emit("minimize");
    expect(window.hide).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(tray.destroy).not.toHaveBeenCalled();
    expect(tray.setToolTip).toHaveBeenCalledWith("Hi Design Team");
    expect(menu.map((item) => item.label ?? item.type)).toEqual([
      "显示主窗口", "separator", "最近项目", "暂无最近项目", "separator", "退出程序",
    ]);
  });

  test("cancels the close button and hides the window without quitting", () => {
    dispose = install();
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  test.each(["click", "double-click", "menu"])("restores, shows and focuses the hidden window via %s", (entry) => {
    dispose = install();
    window.emit("close", { preventDefault: vi.fn() });
    if (entry === "menu") menu[0].click?.(undefined!, undefined!, undefined!);
    else tray.emit(entry);
    expect(window.focus).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.webContents.focus).toHaveBeenCalledOnce();
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(window.focus.mock.invocationCallOrder[0]);
  });

  test("routes Quit through application shutdown and removes the tray when closed", () => {
    dispose = install("en-US");
    expect(menu.at(-1)?.label).toBe("Quit");
    menu.at(-1)?.click?.(undefined!, undefined!, undefined!);
    expect(quit).toHaveBeenCalledOnce();
    const closeEvent = { preventDefault: vi.fn() };
    window.emit("close", closeEvent);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    window.emit("closed");
    dispose();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(window.listenerCount("close")).toBe(0);
  });

  test("disposal permits shutdown before the native window is destroyed", () => {
    dispose = install();
    dispose();
    window.emit("close", { preventDefault: vi.fn() });
    expect(window.hide).not.toHaveBeenCalled();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(ipc.listenerCount("od:tray:recent-projects")).toBe(0);
  });

  test.each(["darwin", "linux"] as const)("does not change %s minimize behavior", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    dispose = install();
    window.emit("minimize");
    expect(mocks.createTray).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  test.each(["empty icon", "tray creation failure"])("permits normal closing on %s", (failure) => {
    if (failure === "empty icon") mocks.createFromPath.mockReturnValue({ isEmpty: () => true });
    else mocks.createTray.mockImplementationOnce(() => { throw new Error("tray unavailable"); });
    dispose = install();
    const closeEvent = { preventDefault: vi.fn() };
    window.emit("close", closeEvent);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  function publish(projects: unknown, sender = window.webContents, senderFrame = window.webContents.mainFrame) {
    ipc.emit("od:tray:recent-projects", { sender, senderFrame }, projects);
  }

  test("shows five current recent projects and opens the selected project's conversation", () => {
    dispose = install();
    publish(Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Project & ${i}` })));
    expect(menu.slice(3, -2)).toHaveLength(5);
    expect(menu[3].label).toBe("Project && 0");
    menu[4].click?.(undefined!, undefined!, undefined!);
    vi.runOnlyPendingTimers();
    expect(openProject).toHaveBeenCalledWith("p1");
  });

  test("rejects foreign senders and subframes, and filters invalid or duplicate entries", () => {
    dispose = install();
    const other = Object.assign(new EventEmitter(), { isDestroyed: () => false, focus: vi.fn(), mainFrame: {} });
    publish([{ id: "foreign", name: "Foreign" }], other);
    publish([{ id: "frame", name: "Frame" }], window.webContents, {});
    expect(menu[3].enabled).toBe(false);
    publish([null, { id: "../bad", name: "bad" }, { id: "ok", name: "Valid" }, { id: "ok", name: "Duplicate" }]);
    expect(menu.slice(3, -2).map((item) => item.label)).toEqual(["Valid"]);
  });

  test("clears shortcuts on document navigation and ignores queued activation after shutdown", () => {
    dispose = install();
    publish([{ id: "p", name: "Project" }]);
    window.webContents.emit("did-start-navigation", {}, "od://app/", false, true);
    expect(menu[3].enabled).toBe(false);
    tray.emit("click");
    dispose();
    vi.runOnlyPendingTimers();
    expect(window.focus).not.toHaveBeenCalled();
  });
});
