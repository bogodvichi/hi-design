import { join } from "node:path";

import type { ToolPackConfig } from "./config/index.js";

export function desktopIconResource(
  config: Pick<ToolPackConfig, "workspaceRoot">,
  platform: NodeJS.Platform,
): { from: string; to: string } {
  if (platform === "win32") {
    return {
      from: join(config.workspaceRoot, "tools", "pack", "resources", "win", "icon.ico"),
      to: "app-icon.ico",
    };
  }
  return {
    from: join(config.workspaceRoot, "apps", "web", "public", "app-icon.png"),
    to: "app-icon.png",
  };
}

export function domToPptxBundleResource(config: Pick<ToolPackConfig, "workspaceRoot">): { from: string; to: string } {
  return {
    from: join(config.workspaceRoot, "apps", "desktop", "vendor", "dom-to-pptx", "dom-to-pptx.bundle.js.gz"),
    to: "dom-to-pptx.bundle.js.gz",
  };
}
