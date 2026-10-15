import { EventEmitter } from "node:events";

import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFromPath: vi.fn(),
  buildFromTemplate: vi.fn(),
  createTray: vi.fn(),
}));

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  Tray: class { constructor(icon: unknown) { return mocks.createTray(icon); } },
  nativeImage: { createFromPath: mocks.createFromPath },
}));

import { ensureWindowVisible } from "../../src/main/runtime.js";
import { installWindowsTray } from "../../src/main/windows-tray.js";

describe("Windows minimize to system tray", () => {
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
  };
  let quit: ReturnType<typeof vi.fn<() => void>>;
  let menu: MenuItemConstructorOptions[];

  function install(osLocale = "zh-CN") {
    return installWindowsTray(window as unknown as BrowserWindow, {
      iconPath: "/app/app-icon.png",
      title: "Hi Design Team",
      osLocale,
      show: () => ensureWindowVisible(window as unknown as BrowserWindow),
      quit,
    });
  }

  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    tray = Object.assign(new EventEmitter(), {
      setToolTip: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn(),
    });
    window = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true),
      isVisible: vi.fn(() => false), hide: vi.fn(), restore: vi.fn(),
      show: vi.fn(), focus: vi.fn(),
    });
    quit = vi.fn();
    mocks.createFromPath.mockReturnValue({ isEmpty: () => false });
    mocks.createTray.mockReturnValue(tray);
    mocks.buildFromTemplate.mockImplementation((template) => { menu = template; return template; });
  });

  afterEach(() => {
    dispose?.();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("hides on minimize without closing or quitting, and keeps a named tray entry", () => {
    dispose = install();
    window.emit("minimize");
    expect(window.hide).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    expect(tray.destroy).not.toHaveBeenCalled();
    expect(tray.setToolTip).toHaveBeenCalledWith("Hi Design Team");
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["显示主窗口", "separator", "退出"]);
  });

  test.each(["click", "double-click", "menu"])("restores, shows and focuses the hidden window via %s", (entry) => {
    dispose = install();
    window.emit("minimize");
    if (entry === "menu") menu[0].click?.(undefined!, undefined!, undefined!);
    else tray.emit(entry);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(window.focus.mock.invocationCallOrder[0]);
  });

  test("routes Quit through application shutdown and removes the tray when closed", () => {
    dispose = install("en-US");
    expect(menu[2].label).toBe("Quit");
    menu[2].click?.(undefined!, undefined!, undefined!);
    expect(quit).toHaveBeenCalledOnce();
    window.emit("closed");
    dispose();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(window.listenerCount("minimize")).toBe(0);
  });

  test("disposal stops minimizing to tray before the native window is destroyed", () => {
    dispose = install();
    dispose();
    window.emit("minimize");
    expect(window.hide).not.toHaveBeenCalled();
    expect(tray.destroy).toHaveBeenCalledOnce();
  });

  test.each(["darwin", "linux"] as const)("does not change %s minimize behavior", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    dispose = install();
    window.emit("minimize");
    expect(mocks.createTray).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  test.each(["empty icon", "tray creation failure"])("keeps normal minimization on %s", (failure) => {
    if (failure === "empty icon") mocks.createFromPath.mockReturnValue({ isEmpty: () => true });
    else mocks.createTray.mockImplementationOnce(() => { throw new Error("tray unavailable"); });
    dispose = install();
    window.emit("minimize");
    expect(window.hide).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
