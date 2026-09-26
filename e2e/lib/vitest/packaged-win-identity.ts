import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";
import { OPEN_DESIGN_PRODUCT_NAME } from "@open-design/sidecar-proto";

export { releaseAppVersionArgs } from "./packaged-release-version.js";

export type PackagedWinInstallIdentity = {
  displayName: string;
  namespaceToken: string;
  productName: string;
  systemName: string;
};

function sanitizeNamespace(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function resolvePackagedWinInstallIdentity(options: {
  namespace: string;
  releaseVersion: string | null | undefined;
}): PackagedWinInstallIdentity {
  const namespaceToken = sanitizeNamespace(options.namespace);
  const channel = releaseChannelFromVersion(options.releaseVersion)
    ?? releaseChannelFromNamespace(options.namespace, "default");
  const identity = channel == null ? null : releaseInstallIdentity(channel);
  const displayName = identity?.displayName ?? `Hi Design ${namespaceToken}`;
  const isDefaultNamespace = options.namespace === "default";
  // Mirror resolveWinInstallIdentity in tools/pack/src/win/identity.ts:
  // release channels carry the namespace suffix in systemName so different
  // namespaces can coexist; the default namespace stays clean.
  const systemName = (identity != null && !isDefaultNamespace)
    ? `${displayName}-${namespaceToken}`
    : displayName;
  return {
    displayName,
    namespaceToken,
    productName: OPEN_DESIGN_PRODUCT_NAME,
    systemName,
  };
}
