import { Menu, Tray, nativeImage, type BrowserWindow } from "electron";

/** Keep a restore and quit entry available while Windows hides the main window. */
export function installWindowsTray(window: BrowserWindow, options: {
  iconPath: string;
  title: string;
  osLocale?: string;
  show: () => void;
  quit: () => void;
}): () => void {
  if (process.platform !== "win32") return () => undefined;

  let tray: Tray | null = null;
  try {
    const icon = nativeImage.createFromPath(options.iconPath);
    if (icon.isEmpty()) throw new Error("desktop tray icon is empty");
    tray = new Tray(icon);
    const chinese = options.osLocale?.toLowerCase().startsWith("zh") ?? false;
    tray.setToolTip(options.title);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: chinese ? "显示主窗口" : "Show main window", click: options.show },
      { type: "separator" },
      { label: chinese ? "退出" : "Quit", click: options.quit },
    ]));
    tray.on("click", options.show);
    tray.on("double-click", options.show);
  } catch (error) {
    tray?.destroy();
    console.warn("[open-design desktop] system tray unavailable", error);
    return () => undefined;
  }

  const onMinimize = () => {
    if (!window.isDestroyed()) window.hide();
  };
  const dispose = () => {
    window.removeListener("minimize", onMinimize);
    window.removeListener("closed", dispose);
    tray?.destroy();
    tray = null;
  };
  window.on("minimize", onMinimize);
  window.on("closed", dispose);
  return dispose;
}
