import { SIDECAR_DEFAULTS } from "@open-design/sidecar-proto";
import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";

import type { ToolPackConfig } from "../config/index.js";
import { PRODUCT_NAME } from "./constants.js";

export type MacInstallIdentity = {
  appId: string;
  executableName: string;
  installerTitle: string;
  productName: string;
  publicAppBundleName: string;
  systemAppBundleName: string;
};

function sanitizeNamespace(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function resolveMacInstallIdentity(config: Pick<ToolPackConfig, "namespace" | "appVersion">): MacInstallIdentity {
  const namespaceToken = sanitizeNamespace(config.namespace);
  const channel = releaseChannelFromVersion(config.appVersion)
    ?? releaseChannelFromNamespace(config.namespace, SIDECAR_DEFAULTS.namespace);
  const channelIdentity = channel == null
    ? { appId: "io.hi-design-team.desktop", productName: PRODUCT_NAME }
    : releaseInstallIdentity(channel);
  const publicAppBundleName = `${channelIdentity.productName}.app`;
  // The system (installed) app bundle name carries the namespace so different
  // namespaces can coexist in /Applications even on the same release channel.
  // The default namespace stays clean as the canonical baseline. The public
  // (DMG) name always stays clean for the drag-install surface.
  const isDefaultNamespace = config.namespace === SIDECAR_DEFAULTS.namespace;
  const systemAppBundleName = isDefaultNamespace
    ? publicAppBundleName
    : `${channelIdentity.productName}.${namespaceToken}.app`;

  return {
    ...channelIdentity,
    executableName: channelIdentity.productName,
    installerTitle: channel == null ? `${PRODUCT_NAME}-${namespaceToken}` : channelIdentity.productName,
    publicAppBundleName,
    systemAppBundleName,
  };
}
