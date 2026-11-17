import type { BrowserWindow, IpcMain } from "electron";
import type { OpenDesignHostActionResult } from "@open-design/host";
const OPEN_CHANNEL = "od:developer-tools:open";

/** End-user troubleshooting is available in both installed and development clients. */
export function installDeveloperTools(
  window: BrowserWindow,
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
): () => void {
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
