import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { resolveMacInstallIdentity } from "@/mac/identity.js";
import { resolveMacPaths } from "@/mac/paths.js";

function makeConfig(root: string, namespace: string): ToolPackConfig {
  return {
    containerized: false,
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    namespace,
    platform: "mac",
    portable: true,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      output: {
        appBuilderRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace, "builder"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", namespace),
        platformRoot: join(root, ".tmp", "tools-pack", "out", "mac"),
        root: join(root, ".tmp", "tools-pack", "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces", namespace),
      },
      cacheRoot: join(root, ".tmp", "tools-pack", "cache"),
      toolPackRoot: join(root, ".tmp", "tools-pack"),
    },
    signed: false,
    productName: "Hi Design Team",
    silent: true,
    to: "dmg",
    webOutputMode: "standalone",
    workspaceRoot: root,
  };
}

describe("resolveMacInstallIdentity", () => {
  it("keeps stable builds on the canonical mac identity", () => {
    expect(resolveMacInstallIdentity(makeConfig("/work", "release-stable"))).toMatchObject({
      appId: "io.hi-design-team.desktop",
      installerTitle: "Hi Design Team",
      productName: "Hi Design Team",
      publicAppBundleName: "Hi Design Team.app",
      systemAppBundleName: "Hi Design Team.release-stable.app",
    });
  });

  it("uses first-class beta app identity for beta release namespaces", () => {
    const config = makeConfig("/work", "release-beta");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.hi-design-team.desktop.beta",
      executableName: "Hi Design Team Beta",
      installerTitle: "Hi Design Team Beta",
      productName: "Hi Design Team Beta",
      publicAppBundleName: "Hi Design Team Beta.app",
      systemAppBundleName: "Hi Design Team Beta.release-beta.app",
    });
    expect(resolveMacPaths(config).appPath).toMatch(/Hi Design Team Beta\.app$/);
  });

  it("uses first-class preview app identity for preview release namespaces", () => {
    const config = makeConfig("/work", "release-preview");

    expect(resolveMacInstallIdentity(config)).toEqual({
      appId: "io.hi-design-team.desktop.preview",
      executableName: "Hi Design Team Preview",
      installerTitle: "Hi Design Team Preview",
      productName: "Hi Design Team Preview",
      publicAppBundleName: "Hi Design Team Preview.app",
      systemAppBundleName: "Hi Design Team Preview.release-preview.app",
    });
    expect(resolveMacPaths(config).appPath).toMatch(/Hi Design Team Preview\.app$/);
  });

  it("uses first-class prerelease app identity for prerelease release versions and namespaces", () => {
    const prereleaseVersionConfig = {
      ...makeConfig("/work", "release-stable"),
      appVersion: "0.8.0-prerelease.2",
    };
    const prereleaseNamespaceConfig = makeConfig("/work", "release-prerelease");

    expect(resolveMacInstallIdentity(prereleaseVersionConfig)).toEqual({
      appId: "io.hi-design-team.desktop.prerelease",
      executableName: "Hi Design Team Prerelease",
      installerTitle: "Hi Design Team Prerelease",
      productName: "Hi Design Team Prerelease",
      publicAppBundleName: "Hi Design Team Prerelease.app",
      systemAppBundleName: "Hi Design Team Prerelease.release-stable.app",
    });
    expect(resolveMacPaths(prereleaseVersionConfig).appPath).toMatch(/Hi Design Team Prerelease\.app$/);
    expect(resolveMacInstallIdentity(prereleaseNamespaceConfig)).toMatchObject({
      productName: "Hi Design Team Prerelease",
      publicAppBundleName: "Hi Design Team Prerelease.app",
      systemAppBundleName: "Hi Design Team Prerelease.release-prerelease.app",
    });
  });
});
