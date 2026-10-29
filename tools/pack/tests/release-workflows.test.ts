import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import linuxPack from "@/linux.ts?raw";
import macBuild from "@/mac/build.ts?raw";
import macFs from "@/mac/fs.ts?raw";
import macWorkspace from "@/mac/workspace.ts?raw";
import winApp from "@/win/app.ts?raw";
import winLifecycle from "@/win/lifecycle.ts?raw";

function sectionBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

function sectionAfter(content: string, start: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  return content.slice(startIndex);
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe("release workflows", () => {
  it("retains only the newest outer tools-pack cache in each prerelease platform lane", async () => {
    const workflow = await readFile(
      new URL("../../../.github/workflows/release-prerelease.yml", import.meta.url), "utf8",
    );
    expect(countOccurrences(workflow, "keep=1")).toBe(2);
    expect(countOccurrences(workflow, "$keep = 1")).toBe(1);
    expect(workflow).not.toContain("keep=3");
    expect(workflow).not.toContain("$keep = 3");
  });

  it("preserves shared packaging and prerelease publishing contracts", async () => {
    const [prerelease, stablePrepare, buildMac, buildWin, prepareMac, prepareWin, publishPlatform, desktopUpdater, installUnsafeDmg] = await Promise.all([
      readFile(new URL("../../../.github/workflows/release-prerelease.yml", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/src/metadata/prepare-stable.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/scripts/build-platform.sh", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/scripts/build-platform.ps1", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/scripts/prepare-platform-assets.sh", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/scripts/prepare-platform-assets.ps1", import.meta.url), "utf8"),
      readFile(new URL("../../../tools/release/src/storage/publish-platform.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/desktop/src/main/updater/payload.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../scripts/install-unsafe-dmg.sh", import.meta.url), "utf8"),
    ]);
    const prereleaseMetadata = sectionBetween(prerelease, "  metadata:", "  verify:");
    const prereleasePublish = sectionBetween(prerelease, "  publish:", "  cleanup_partial_release_assets:");
    const prereleaseMac = sectionBetween(prerelease, "  build_mac:", "  build_mac_intel:");
    const prereleaseMacX64 = sectionBetween(prerelease, "  build_mac_intel:", "  build_win:");
    const prereleaseWin = sectionBetween(prerelease, "  build_win:", "  build_linux:");
    expect(buildMac).toContain("build_args+=(--require-vela-cli)");
    expect(buildMac).toContain("update_args+=(--require-vela-cli)");
    expect(buildMac).toContain('--cache-dir "$TOOLS_PACK_CACHE_DIR"');
    expect(buildMac).toContain('tools-pack mac build update fixture');
    expect(buildMac).toContain('OD_PACKAGED_E2E_MAC_UPDATE_BUILD_JSON_PATH="$update_build_json_path"');
    expect(buildMac).toContain('OD_PACKAGED_E2E_MAC_UPDATE_VERSION="${OD_PACKAGED_E2E_MAC_UPDATE_VERSION:-$update_version}"');
    expect(buildMac).not.toContain("::warning::Expected Electron framework symlink");
    expect(buildWin).toContain('$buildArgs += "--require-vela-cli"');
    expect(buildWin).toContain('$updateArgs += "--require-vela-cli"');
    expect(macBuild).toContain('runPhase("xattr-scrub"');
    expect(macBuild).toContain("scrubMacExtendedAttributes(paths.appPath)");
    expect(macFs).toContain("com.apple.provenance");
    expect(macFs).toContain("com.apple.macl");
    expect(desktopUpdater).toContain("MAC_PAYLOAD_XATTRS_TO_SCRUB");
    expect(desktopUpdater).toContain('execFileAsync("xattr", ["-dr", attribute, input.destinationRoot])');
    expect(desktopUpdater).toContain("com.apple.macl");
    expect(installUnsafeDmg).toContain("com.apple.macl");
    expect(prepareMac).not.toContain("required RELEASE_ASSET_SUFFIX");
    expect(prepareMac).toContain('RELEASE_ASSET_SUFFIX="${RELEASE_ASSET_SUFFIX:-}"');
    expect(prepareWin).toContain("[AllowEmptyString()]");
    expect(prepareWin).toContain("$sourcePayload = [string]$build.payloadPath");
    expect(prepareWin).toContain("hi-design-team-$ReleaseVersion$ReleaseAssetSuffix-win-x64-payload.7z");
    expect(publishPlatform).toContain("hi-design-team-${releaseVersion}${assetSuffix}-win-x64-payload.7z");
    expect(publishPlatform).toContain("payload: assetEntry(payload)");
    expect(publishPlatform).toContain("versionLockObjectKey(releaseVersion, countedReleaseChannel)");
    expect(publishPlatform).toContain("assertCurrentVersionReservation(storage, releaseVersion, versionLockKey, countedReleaseChannel)");
    expect(buildWin).toContain("function Validate-WinLauncherPayloadArchive");
    expect(buildWin).toContain('Measure-Step "clean tools-pack win namespace"');
    expect(buildWin.indexOf('Measure-Step "clean tools-pack win namespace"')).toBeLessThan(buildWin.indexOf('Measure-Step "tools-pack win build"'));
    expect(buildWin).toContain('"tools-pack", "win", "cleanup"');
    expect(winLifecycle).toContain("const launcher = resolveToolPackLauncherLayout(config)");
    expect(winLifecycle).toContain("await removeTree(launcher.paths.namespaceRoot)");
    expect(winLifecycle).toContain("removedLauncherNamespaceRoot");
    expect(buildWin).toContain('Measure-Step "validate launcher payload artifact"');
    expect(buildWin).toContain('Measure-Step "validate launcher payload update fixture"');
    expect(buildWin).toContain('Test-JsonString $manifest.entry.executable "entry.executable" $PayloadExecutablePath');
    for (const workspaceBuild of [winApp, macWorkspace, linuxPack]) {
      const sidecarProtoBuild = 'await runPnpm(config, ["--filter", "@open-design/sidecar-proto", "build"])';
      const launcherProtoBuild = 'await runPnpm(config, ["--filter", "@open-design/launcher-proto", "build"])';
      const sidecarBuild = 'await runPnpm(config, ["--filter", "@open-design/sidecar", "build"])';
      const dshRuntimeBuild = 'await runPnpm(config, ["--filter", "@open-design/dsh-runtime", "build"])';
      const daemonBuild = 'await runPnpm(config, ["--filter", "@open-design/daemon", "build"])';
      expect(workspaceBuild).toContain(launcherProtoBuild);
      expect(workspaceBuild).toContain(dshRuntimeBuild);
      expect(workspaceBuild.indexOf(sidecarProtoBuild)).toBeLessThan(workspaceBuild.indexOf(launcherProtoBuild));
      expect(workspaceBuild.indexOf(launcherProtoBuild)).toBeLessThan(workspaceBuild.indexOf(sidecarBuild));
      expect(workspaceBuild.indexOf(dshRuntimeBuild)).toBeLessThan(workspaceBuild.indexOf(daemonBuild));
    }
    expect(prerelease).toContain("name: release-prerelease");
    expect(prerelease).toContain("pnpm exec tools-release prepare prerelease");
    expect(prerelease).toContain("OPEN_DESIGN_PRERELEASE_METADATA_URL");
    expect(prerelease).toContain("RELEASE_CHANNEL: prerelease");
    expect(prerelease).toContain("open-design-prerelease-mac-arm64-publish-manifest");
    expect(prerelease).toContain("open-design-prerelease-win-x64-publish-manifest");
    expect(prerelease).toContain("workflow_call:");
    expect(prerelease).toContain("OPEN_DESIGN_STABLE_VERSION: ${{ inputs.release_version }}");
    expect(prerelease).toContain("GITHUB_SHA: ${{ needs.metadata.outputs.commit }}");
    expect(prerelease).toContain("previous_commit: ${{ steps.prev.outputs.previous_commit }}");
    expect(prerelease).toContain("version_metadata_url: ${{ steps.outputs.outputs.version_metadata_url }}");
    expect(prerelease).not.toContain("RELEASE_CHANNEL: Prerelease");
    expect(prerelease).not.toContain("tools-release prepare preview");
    expect(prereleaseMetadata).toContain("GH_TOKEN: ${{ github.token }}");
    expect(prereleaseMetadata).toContain("OPEN_DESIGN_RELEASE_CHANNEL: prerelease");
    expect(prereleasePublish).toContain('GITHUB_RELEASE_ENABLED: "false"');
    expect(prerelease).not.toContain("gh release");
    expect(prereleaseMac).toContain("uses: actions/cache/restore@v5");
    expect(prereleaseMac).toContain("uses: actions/cache/save@v5");
    expect(prereleaseMac).toContain("tools-pack-mac-v1-prerelease-${RUNNER_OS}-arm64-");
    expect(prereleaseMac).toContain("pnpm exec tools-pack mac cleanup --dir \"$RUNNER_TEMP/tools-pack\" --namespace release-prerelease --json");
    expect(prereleaseMac).toContain("exec tools-pack mac build");
    expect(prereleaseMac).toContain("--cache-dir \"$RUNNER_TEMP/tools-pack-cache\"");
    expect(countOccurrences(prereleaseMac, "--notarize")).toBe(2);
    // Both the primary build and the cache-miss retry must carry Apple notary
    // env, or notarization fails closed on the retry path.
    expect(
      countOccurrences(prereleaseMac, "APPLE_ID: ${{ secrets.APPLE_ID }}"),
    ).toBe(2);
    expect(
      countOccurrences(
        prereleaseMac,
        "APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}",
      ),
    ).toBe(2);
    expect(
      countOccurrences(prereleaseMac, "APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}"),
    ).toBe(2);
    expect(prereleaseMac).toContain("tools-release write-report");
    expect(prereleaseMacX64).toContain("uses: actions/cache/restore@v5");
    expect(prereleaseMacX64).toContain("uses: actions/cache/save@v5");
    expect(prereleaseMacX64).toContain("tools-pack-mac-v1-prerelease-${RUNNER_OS}-x64-");
    expect(prereleaseMacX64).toContain("pnpm exec tools-pack mac cleanup --dir \"$RUNNER_TEMP/tools-pack\" --namespace release-prerelease-intel --json");
    expect(prereleaseMacX64).toContain("exec tools-pack mac build");
    expect(prereleaseMacX64).toContain("--cache-dir \"$RUNNER_TEMP/tools-pack-cache\"");
    expect(countOccurrences(prereleaseMacX64, "--notarize")).toBe(2);
    expect(
      countOccurrences(prereleaseMacX64, "APPLE_ID: ${{ secrets.APPLE_ID }}"),
    ).toBe(2);
    expect(
      countOccurrences(
        prereleaseMacX64,
        "APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}",
      ),
    ).toBe(2);
    expect(
      countOccurrences(prereleaseMacX64, "APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}"),
    ).toBe(2);
    expect(prereleaseMacX64).toContain("tools-release write-report");
    for (const [prereleaseMacJob, nextStep] of [
      [prereleaseMac, "Smoke prerelease mac"],
      [prereleaseMacX64, "Write mac_x64 release report"],
    ] as const) {
      expect(prereleaseMacJob).toContain("Verify prerelease mac");
      expect(prereleaseMacJob).toContain('hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_point"');
      expect(prereleaseMacJob).toContain('codesign --verify --deep --strict "$candidate_app"');
      expect(prereleaseMacJob).toContain('xcrun stapler validate "$candidate_app"');
      expect(prereleaseMacJob).toContain('spctl --assess --type execute --verbose=4 "$candidate_app"');
      expect(prereleaseMacJob.indexOf("Verify prerelease mac")).toBeLessThan(
        prereleaseMacJob.indexOf(nextStep),
      );
    }
    expect(prereleaseWin).toContain("tools-pack-win-v1-prerelease-$env:RUNNER_OS-");
    expect(prereleaseWin).toContain("tools-pack win validate-payload");
    expect(prereleaseWin).toContain("release-build\\win_x64\\build.json");
    expect(prereleaseWin).toContain("tools-release write-report");
    expect(stablePrepare).toContain('expectStringFieldIfPresent(github, "workflow", "release-prerelease"');
    expect(stablePrepare).toContain('parseStableDryRunMode');
    expect(stablePrepare).toContain('setOutput("run_prepublish_jobs"');
    expect(stablePrepare).toContain('setOutput("publish_side_effects_enabled"');
    expect(prerelease).toContain("tools-release check-storage");
    for (const job of [prereleaseMetadata, prereleasePublish]) {
      expect(job).toContain("uses: pnpm/action-setup@v5");
      expect(job).toContain("run: pnpm install --frozen-lockfile");
      expect(job.indexOf("run: pnpm install --frozen-lockfile")).toBeLessThan(job.indexOf("tools-release"));
    }
  });

  it.each(["beta", "stable"])("requires Vela CLI and signed mac artifacts for each HiDesign %s target", async (channel) => {
    const workflow = await readFile(new URL(`../../../.github/workflows/release-${channel}.yml`, import.meta.url), "utf8");
    const jobs = [
      sectionBetween(workflow, "  build_mac:", "  build_mac_intel:"),
      sectionBetween(workflow, "  build_mac_intel:", "  build_win:"),
      sectionAfter(workflow, "  build_win:").split("\n  publish:")[0],
    ];
    for (const job of jobs) {
      expect(job).toContain("--require-vela-cli");
      expect(job).toContain("--portable");
      expect(job).toContain("inputs.release_version");
    }
    for (const job of jobs.slice(0, 2)) {
      expect(job).toContain("--signed");
      expect(job).toContain("--notarize");
      expect(job).toContain("APPLE_ID: ${{ secrets.APPLE_ID }}");
    }
  });

  it("bakes the AMR profile and complete Vela origin map into the prerelease pipeline", async () => {
    const prerelease = await readFile(new URL("../../../.github/workflows/release-prerelease.yml", import.meta.url), "utf8");
    expect(prerelease).toContain("OPEN_DESIGN_AMR_PROFILE: ${{ inputs.amr_profile }}");
    expect(prerelease).toContain("OD_VELA_WEB_URL:");
    for (const profile of ["FEATURE_TEST", "TEST", "PROD"]) {
      expect(prerelease).toContain(`OD_VELA_WEB_URL_${profile}: \${{ secrets.VELA_WEB_URL_${profile} }}`);
    }
  });

  it("passes launcher version floor repo vars through to prerelease metadata publish and verify verbatim", async () => {
    const prerelease = await readFile(new URL("../../../.github/workflows/release-prerelease.yml", import.meta.url), "utf8");

    const passthrough = (suffix: string): string[] => [
      `RELEASE_LAUNCHER_VERSION_MIN_${suffix}: \${{ vars.RELEASE_LAUNCHER_VERSION_MIN_${suffix} }}`,
      `RELEASE_LAUNCHER_VERSION_MIN_URL_${suffix}: \${{ vars.RELEASE_LAUNCHER_VERSION_MIN_URL_${suffix} }}`,
    ];

    // Each channel workflow forwards its own repo-vars pair plus the STABLE
    // fallback pair verbatim; channel policy (pair-level stable fallback,
    // format/https/floor validation) lives only in
    // tools/release/src/storage/launcher-version-floor.ts, never in YAML.
    const lanes: Array<{ minSteps: number; suffix: string; workflow: string }> = [
      { minSteps: 2, suffix: "PRERELEASE", workflow: prerelease },
    ];
    for (const lane of lanes) {
      for (const key of [...passthrough(lane.suffix), ...passthrough("STABLE")]) {
        // publish-metadata always carries the pair; lanes with a
        // verify-metadata step must carry it there too.
        expect(countOccurrences(lane.workflow, key)).toBeGreaterThanOrEqual(lane.minSteps);
      }
      expect(lane.workflow).not.toContain(`vars.RELEASE_LAUNCHER_VERSION_MIN_${lane.suffix} ||`);
    }
  });
});
