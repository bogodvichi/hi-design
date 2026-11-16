import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMain } from "electron";

export function windowsWindowChrome(
  platform: string,
): Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay"> {
  // Preload supplies compact controls, including on startup/recovery pages.
  return platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: false } : {};
}

export function installWindowsWindowControls(
  window: BrowserWindow,
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
): () => void {
  const state = () => ({ maximized: window.isMaximized(), fullscreen: window.isFullScreen() });
  const sendState = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("od:window:state-changed", state());
    }
  };
  const requireMainFrame = (event: Electron.IpcMainInvokeEvent) => {
    if (window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("window controls are only available to the main HiDesign frame");
    }
  };
  ipc.handle("od:window:state", event => {
    requireMainFrame(event);
    return state();
  });
  ipc.handle("od:window:action", (event, action: unknown) => {
    requireMainFrame(event);
    switch (action) {
      case "minimize": window.minimize(); break;
      case "toggle-maximize":
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case "close": window.close(); break; // Retains the Windows tray close hook.
      default: return { ok: false, reason: "unsupported window action" };
    }
    return { ok: true };
  });
  window.on("maximize", sendState);
  window.on("unmaximize", sendState);
  window.on("enter-full-screen", sendState);
  window.on("leave-full-screen", sendState);
  const dispose = () => {
    ipc.removeHandler("od:window:state");
    ipc.removeHandler("od:window:action");
    window.removeListener("maximize", sendState);
    window.removeListener("unmaximize", sendState);
    window.removeListener("enter-full-screen", sendState);
    window.removeListener("leave-full-screen", sendState);
    window.removeListener("closed", dispose);
  };
  window.once("closed", dispose);
  return dispose;
}
