import type { BrowserWindow, IpcMain } from "electron";
import type { OpenDesignHostActionResult } from "@open-design/host";

const FORCE_RELOAD_CHANNEL = "od:browser:force-reload";

/** Available in every desktop build, independently of native DevTools access. */
export function installForceReload(
  window: BrowserWindow,
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
): () => void {
  ipc.handle(FORCE_RELOAD_CHANNEL, (event): OpenDesignHostActionResult => {
    if (window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("force reload is only available to the main HiDesign frame");
    }
    // Matches Electron's native forceReload menu role; keep cookies/storage intact.
    window.webContents.reloadIgnoringCache();
    return { ok: true };
  });
  const dispose = () => {
    ipc.removeHandler(FORCE_RELOAD_CHANNEL);
    window.removeListener("closed", dispose);
  };
  window.once("closed", dispose);
  return dispose;
}
