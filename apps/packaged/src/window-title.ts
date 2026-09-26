import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";
import { OPEN_DESIGN_PRODUCT_NAME } from "@open-design/sidecar-proto";

const DEFAULT_WINDOW_TITLE = process.env.OD_PRODUCT_NAME ?? OPEN_DESIGN_PRODUCT_NAME;

export function resolvePackagedWindowTitle(config: { appVersion: string | null; namespace: string }): string {
  const channel =
    releaseChannelFromVersion(config.appVersion) ??
    releaseChannelFromNamespace(config.namespace);
  return channel == null ? DEFAULT_WINDOW_TITLE : releaseInstallIdentity(channel).productName;
}
