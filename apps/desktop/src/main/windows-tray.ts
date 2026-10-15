import { Menu, Tray, ipcMain, nativeImage, type BrowserWindow, type IpcMainEvent } from "electron";
import type { OpenDesignHostRecentProject } from "@open-design/host";

/** Closing hides to the tray; minimizing and startup keep normal window behavior. */
export function installWindowsTray(window: BrowserWindow, options: {
  iconPath: string;
  title: string;
  osLocale?: string;
  show: () => void;
  quit: () => void;
  openProject: (projectId: string) => void;
}): () => void {
  if (process.platform !== "win32") return () => undefined;

  const contents = window.webContents;
  let tray: Tray | null = null;
  let quitting = false;
  let recentProjects: OpenDesignHostRecentProject[] = [];
  // Yield until Windows finishes dispatching the native tray/menu mouse event
  // before transferring activation and input focus back to the main window.
  const activate = (action: () => void) => setImmediate(() => {
    if (tray != null && !quitting && !window.isDestroyed()) action();
  });
  const rebuildMenu = () => {
    const chinese = options.osLocale?.toLowerCase().startsWith("zh") ?? false;
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: chinese ? "显示主窗口" : "Show main window", click: () => activate(options.show) },
      { type: "separator" },
      { label: chinese ? "最近项目" : "Recent projects", enabled: false },
      ...(recentProjects.length > 0
        ? recentProjects.map((project) => ({
            label: project.name.replace(/&/g, "&&"),
            click: () => activate(() => options.openProject(project.id)),
          }))
        : [{ label: chinese ? "暂无最近项目" : "No recent projects", enabled: false }]),
      { type: "separator" },
      { label: chinese ? "退出程序" : "Quit", click: () => {
        quitting = true;
        options.quit();
      } },
    ]));
  };
  try {
    const icon = nativeImage.createFromPath(options.iconPath);
    if (icon.isEmpty()) throw new Error("desktop tray icon is empty");
    tray = new Tray(icon);
    tray.setToolTip(options.title);
    rebuildMenu();
    tray.on("click", () => activate(options.show));
    tray.on("double-click", () => activate(options.show));
  } catch (error) {
    tray?.destroy();
    console.warn("[open-design desktop] system tray unavailable", error);
    return () => undefined;
  }

  const onRecentProjects = (event: IpcMainEvent, input: unknown) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || !Array.isArray(input)) return;
    const seen = new Set<string>();
    recentProjects = input.filter((value): value is OpenDesignHostRecentProject => {
      if (value == null || typeof value !== "object") return false;
      const { id, name } = value;
      if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(id)
        || typeof name !== "string" || !name.trim() || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 5).map(({ id, name }) => ({ id, name: name.slice(0, 100) }));
    rebuildMenu();
  };
  const clearRecentProjects = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    recentProjects = [];
    rebuildMenu();
  };
  const onClose = (event: Electron.Event) => {
    if (quitting || window.isDestroyed()) return;
    event.preventDefault();
    window.hide();
  };
  const dispose = () => {
    window.removeListener("close", onClose);
    window.removeListener("closed", dispose);
    contents.removeListener("did-start-navigation", clearRecentProjects);
    ipcMain.removeListener("od:tray:recent-projects", onRecentProjects);
    tray?.destroy();
    tray = null;
  };
  window.on("close", onClose);
  window.on("closed", dispose);
  contents.on("did-start-navigation", clearRecentProjects);
  ipcMain.on("od:tray:recent-projects", onRecentProjects);
  return dispose;
}
