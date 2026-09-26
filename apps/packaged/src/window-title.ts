import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
} from "@open-design/release";
import { OPEN_DESIGN_DISPLAY_NAME } from "@open-design/sidecar-proto";

const DEFAULT_WINDOW_TITLE = process.env.OD_DISPLAY_NAME ?? OPEN_DESIGN_DISPLAY_NAME;

export function resolvePackagedWindowTitle(config: { appVersion: string | null; namespace: string }): string {
  const channel =
    releaseChannelFromVersion(config.appVersion) ??
    releaseChannelFromNamespace(config.namespace);
  return channel == null ? DEFAULT_WINDOW_TITLE : releaseInstallIdentity(channel).displayName;
}
