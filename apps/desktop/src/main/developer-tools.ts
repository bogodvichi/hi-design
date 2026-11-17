import type { BrowserWindow, IpcMain } from "electron";
import type { OpenDesignHostActionResult } from "@open-design/host";
import type { DesktopRuntimeMode } from "./runtime-mode.js";

export const DEVELOPER_TOOLS_ARGUMENT = "--od-developer-tools=enabled";
const OPEN_CHANNEL = "od:developer-tools:open";

/** Window chrome and debugging are independent; production requires an explicit opt-in. */
export function desktopDeveloperToolsEnabled(mode: DesktopRuntimeMode, optIn: string | undefined): boolean {
  return mode === "development" || optIn === "1";
}

export function installDeveloperTools(
  window: BrowserWindow,
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  enabled: boolean,
): () => void {
  if (!enabled) return () => {};
  ipc.handle(OPEN_CHANNEL, (event): OpenDesignHostActionResult => {
    if (window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("developer tools are only available to the main HiDesign frame");
    }
    window.webContents.openDevTools({ mode: "detach" });
    return { ok: true };
  });
  const dispose = () => {
    ipc.removeHandler(OPEN_CHANNEL);
    window.removeListener("closed", dispose);
  };
  window.once("closed", dispose);
  return dispose;
}
