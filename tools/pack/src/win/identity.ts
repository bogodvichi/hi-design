import {
  SIDECAR_DEFAULTS,
  resolveWindowsReleaseNamespaceToken,
  resolveWindowsUninstallRegistryKey,
} from "@open-design/sidecar-proto";
import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";

import type { ToolPackConfig } from "../config/index.js";
import { PRODUCT_NAME } from "./constants.js";

export type WinInstallIdentity = {
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
  const displayName = channel == null ? `${PRODUCT_NAME} ${namespaceToken}` : releaseInstallIdentity(channel).productName;
  // The system identity (install dir, shortcut, app-paths key, uninstaller)
  // carries the namespace so different namespaces can coexist on the same
  // release channel. The default namespace stays clean as the canonical
  // baseline. Non-release namespaces already embed the namespace in
  // displayName, so only release channels need the suffix. displayName stays
  // clean for Add/Remove Programs.
  const isDefaultNamespace = config.namespace === SIDECAR_DEFAULTS.namespace;
  const systemName = (channel != null && !isDefaultNamespace)
    ? `${displayName}-${namespaceToken}`
    : displayName;

  return {
    appPathsKey: `Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${systemName}.exe`,
    displayName,
    exeName: `${PRODUCT_NAME}.exe`,
    installDirName: isDefaultNamespace ? PRODUCT_NAME : `${PRODUCT_NAME}-${namespaceToken}`,
    registryKey: resolveWindowsUninstallRegistryKey(config.namespace),
    shortcutName: `${systemName}.lnk`,
    uninstallerName: `Uninstall ${systemName}.exe`,
  };
}
