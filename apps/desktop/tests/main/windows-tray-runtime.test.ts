import { EventEmitter } from "node:events";
import type { BrowserWindow, BrowserWindowConstructorOptions, MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DesktopRuntime } from "../../src/main/runtime.js";

const windows: MockWindow[] = [];
const ipc = Object.assign(new EventEmitter(), { handle: vi.fn(), removeHandler: vi.fn() });
const tray = Object.assign(new EventEmitter(), { setToolTip: vi.fn(), setContextMenu: vi.fn(), destroy: vi.fn() });
let menu: MenuItemConstructorOptions[] = [];
let petLoad: Promise<void> | undefined;

class MockWindow extends EventEmitter {
  destroyed = false;
  visible: boolean;
  contents = Object.assign(new EventEmitter(), {
    session: new EventEmitter(), mainFrame: {},
    isDestroyed: () => this.destroyed,
    getURL: () => "http://127.0.0.1:19573/",
    setWindowOpenHandler: vi.fn(), insertCSS: vi.fn(async () => ""),
    executeJavaScript: vi.fn(async () => true), send: vi.fn(), focus: vi.fn(),
  });
  constructor(options: BrowserWindowConstructorOptions) {
    super();
    this.visible = options.show ?? true;
    windows.push(this);
  }
  get webContents() {
    if (this.destroyed) throw new Error("Object has been destroyed");
    return this.contents;
  }
  isDestroyed = () => this.destroyed;
  isVisible = () => this.visible;
  isMinimized = () => false;
  isFullScreen = () => false;
  restore = vi.fn();
  show = vi.fn(() => { this.visible = true; });
  hide = vi.fn(() => { this.visible = false; });
  focus = vi.fn();
  setTitle = vi.fn();
  getTitle = () => "Hi Design Team";
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setWindowButtonVisibility = vi.fn();
  loadURL = vi.fn(async () => {
    if (this === windows[0]) await petLoad;
  });
  close() {
    const event = { preventDefault: vi.fn() };
    this.emit("close", event);
    if (event.preventDefault.mock.calls.length > 0) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

vi.mock("electron", () => ({
  BrowserWindow: MockWindow,
  app: {},
  get ipcMain() { return ipc; },
  nativeTheme: {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 900 } }) },
  webFrameMain: { fromId: vi.fn() },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  Tray: class { constructor() { return tray; } },
  Menu: { buildFromTemplate: (items: MenuItemConstructorOptions[]) => { menu = items; return items; } },
}));

let runtime: DesktopRuntime;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  windows.length = 0;
  petLoad = undefined;
});
afterEach(async () => {
  await runtime?.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  tray.removeAllListeners();
  vi.clearAllMocks();
});

test("startup reveals the main window; close hides it; tray restores input and opens a project; Quit tears down", async () => {
  const { createDesktopRuntime } = await import("../../src/main/runtime.js");
  let shutdown: Promise<void> | undefined;
  const quit = vi.fn(() => { shutdown = runtime.close(); });
  runtime = await createDesktopRuntime({
    discoverUrl: async () => "http://127.0.0.1:19573/",
    requestQuit: quit,
    windowTitle: "Hi Design Team",
  });
  const main = windows[1]; // Pet, main, splash.
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.status().windowVisible).toBe(true);
  expect(main.hide).not.toHaveBeenCalled();
  main.emit("minimize");
  expect(main.hide).not.toHaveBeenCalled();
  main.close();
  expect(main.destroyed).toBe(false);
  expect(runtime.status().windowVisible).toBe(false);
  expect(quit).not.toHaveBeenCalled();

  tray.emit("click");
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status().windowVisible).toBe(true);
  expect(main.contents.focus).toHaveBeenCalled();

  ipc.emit("od:tray:recent-projects", { sender: main.contents, senderFrame: main.contents.mainFrame }, [{ id: "p1", name: "Project 1" }]);
  main.close();
  menu[3].click?.(undefined!, undefined!, undefined!);
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status().windowVisible).toBe(true);
  expect(main.contents.send).toHaveBeenCalledWith("od:tray:open-project", "p1");

  menu.at(-1)?.click?.(undefined!, undefined!, undefined!);
  await shutdown;
  expect(quit).toHaveBeenCalledOnce();
  expect(main.destroyed).toBe(true);
  expect(tray.destroy).toHaveBeenCalledOnce();
  expect(ipc.listenerCount("od:tray:recent-projects")).toBe(0);
});

test("Windows displays the main loading window before URL discovery and can restore it before mount", async () => {
  const { createDesktopRuntime } = await import("../../src/main/runtime.js");
  runtime = await createDesktopRuntime({ discoverUrl: async () => null });
  const main = windows[1];
  expect(runtime.status().windowVisible).toBe(true);
  expect(main.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/));
  main.close();
  expect(runtime.status().windowVisible).toBe(false);
  tray.emit("click");
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status().windowVisible).toBe(true);
});

test("finishing app mount does not reopen the loading window after the user closes it to the tray", async () => {
  const { createDesktopRuntime } = await import("../../src/main/runtime.js");
  runtime = await createDesktopRuntime({ discoverUrl: async () => "http://127.0.0.1:19573/" });
  const main = windows[1];
  expect(runtime.status().windowVisible).toBe(true);
  main.close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.status().windowVisible).toBe(false);
});

test("a pending desktop-pet page cannot delay app mount completion", async () => {
  const { createDesktopRuntime } = await import("../../src/main/runtime.js");
  let finishPet!: () => void;
  petLoad = new Promise<void>((resolve) => { finishPet = resolve; });
  const onRevealed = vi.fn();
  runtime = await createDesktopRuntime({
    discoverUrl: async () => "http://127.0.0.1:19573/",
    onRevealed,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(onRevealed).toHaveBeenCalledOnce();
  finishPet();
});

test("packaged startup transfers the splash to the visible main loading window", async () => {
  const { createDesktopRuntime } = await import("../../src/main/runtime.js");
  const splash = new MockWindow({ show: true });
  runtime = await createDesktopRuntime({
    discoverUrl: async () => null,
    splashWindow: splash as unknown as BrowserWindow,
  });
  expect(splash.destroyed).toBe(true);
  expect(runtime.status().windowVisible).toBe(true);
});
