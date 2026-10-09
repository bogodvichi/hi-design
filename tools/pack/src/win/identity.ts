import {
  SIDECAR_DEFAULTS,
  resolveWindowsReleaseNamespaceToken,
  resolveWindowsUninstallRegistryKey,
} from "@open-design/sidecar-proto";
import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
  releaseNamespace,
} from "@open-design/release";

import type { ToolPackConfig } from "../config/index.js";
import { DISPLAY_NAME, PRODUCT_NAME } from "./constants.js";

export type WinInstallIdentity = {
  appId: string;
  appPathsKey: string;
  displayName: string;
  exeName: string;
  installDirName: string;
  registryKey: string;
  shortcutName: string;
  uninstallerName: string;
};

export function resolveWinInstallIdentity(config: Pick<ToolPackConfig, "namespace" | "appVersion">): WinInstallIdentity {
  const namespaceToken = resolveWindowsReleaseNamespaceToken(config.namespace);
  const channel = releaseChannelFromVersion(config.appVersion)
    ?? releaseChannelFromNamespace(config.namespace, SIDECAR_DEFAULTS.namespace);
  const channelIdentity = channel == null
    ? { appId: "io.hi-design-team.desktop", displayName: DISPLAY_NAME, productName: PRODUCT_NAME }
    : releaseInstallIdentity(channel);
  const displayName = channel == null ? `${DISPLAY_NAME} ${namespaceToken}` : channelIdentity.displayName;
  // The system identity (install dir, shortcut, app-paths key, uninstaller)
  // carries the namespace so different namespaces can coexist on the same
  // release channel. The default namespace stays clean as the canonical
  // baseline. The standard release namespace for a channel
  // (release-{channel}-win) already embeds the channel in appId and
  // registry key, so the suffix is redundant there and only non-standard
  // namespaces on a release channel need it. displayName stays
  // clean for Add/Remove Programs.
  const isDefaultNamespace = config.namespace === SIDECAR_DEFAULTS.namespace;
  const isStandardReleaseNamespace = channel != null
    && config.namespace === releaseNamespace(channel, "win");
  const systemName = (channel != null && !isDefaultNamespace && !isStandardReleaseNamespace)
    ? `${displayName}-${namespaceToken}`
    : displayName;

  return {
    appId: channelIdentity.appId,
    appPathsKey: `Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${systemName}.exe`,
    displayName,
    exeName: `${PRODUCT_NAME}.exe`,
    installDirName: isDefaultNamespace ? PRODUCT_NAME : `${PRODUCT_NAME}-${namespaceToken}`,
    registryKey: resolveWindowsUninstallRegistryKey(config.namespace),
    shortcutName: `${systemName}.lnk`,
    uninstallerName: `Uninstall ${systemName}.exe`,
  };
}
