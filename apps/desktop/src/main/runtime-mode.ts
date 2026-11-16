import type { App } from "electron";

export type DesktopRuntimeMode = "development" | "production";

/**
 * Resolve the desktop runtime mode from the strongest signal available. An
 * explicit NODE_ENV wins; otherwise Electron's packaging state is authoritative
 * because tools-dev boots the unbundled app while packaged builds import the
 * same runtime from an installed shell.
 */
export function resolveDesktopRuntimeMode(
  app: Pick<App, "isPackaged">,
  nodeEnv?: string,
): DesktopRuntimeMode {
  if (nodeEnv === "development") return "development";
  if (nodeEnv === "production") return "production";
  return app.isPackaged ? "production" : "development";
}
