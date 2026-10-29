import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { T } from "@/timeouts";

import { uiP0Groups, validatePlaywrightSuiteTopology } from "../lib/playwright/suites.ts";

const execFileAsync = promisify(execFile);
const launchEnv = { ...process.env };
const launchPath = launchEnv.PATH ?? launchEnv.Path ?? "";
const nodeBinDir = dirname(process.execPath);
const e2eRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(e2eRoot);
const configureCiParallelismActionPath = join(
  workspaceRoot,
  ".github",
  "actions",
  "configure-ci-parallelism",
  "action.yml",
);
const playwrightConfigPath = join(e2eRoot, "playwright.config.ts");
const rerunInfraCancelScriptPath = join(workspaceRoot, ".github", "scripts", "rerun_infra_cancel.py");
const flakePath = join(workspaceRoot, "flake.nix");
const convergenceScriptPath = join(workspaceRoot, ".github", "scripts", "convergence.py");
const r2PythonLibPath = join(workspaceRoot, ".github", "scripts", "lib", "r2.py");
const releaseBetaWorkflowPath = join(workspaceRoot, ".github", "workflows", "release-beta.yml");
const dailyBetaRecoveryScriptPath = join(
  workspaceRoot,
  ".github",
  "scripts",
  "release",
  "resolve-daily-beta-recovery.ts",
);
const releasePrereleaseWorkflowPath = join(workspaceRoot, ".github", "workflows", "release-prerelease.yml");
const releaseStableWorkflowPath = join(workspaceRoot, ".github", "workflows", "release-stable.yml");
const releaseStableNotesScriptPath = join(workspaceRoot, ".github", "scripts", "release", "github", "stable-notes.sh");
const releaseStableScriptPath = join(workspaceRoot, "tools", "release", "src", "metadata", "prepare-stable.ts");
const releaseBetaScriptPath = join(workspaceRoot, "tools", "release", "src", "metadata", "prepare-beta.ts");
const packagedPackageJsonPath = join(workspaceRoot, "apps", "packaged", "package.json");
const scopesScriptPath = join(workspaceRoot, ".github", "scripts", "scopes.py");
const runnersScriptPath = join(workspaceRoot, ".github", "scripts", "runners.py");
const feishuCardScriptPath = join(workspaceRoot, "tools", "release", "src", "notifications", "feishu.ts");
const releasePublishMetadataScriptPath = join(
  workspaceRoot,
  "tools",
  "release",
  "src",
  "storage",
  "publish-metadata.ts",
);
const releaseBetaPosixBuildScriptPath = join(workspaceRoot, "tools", "release", "scripts", "build-platform.sh");
const releaseBetaWindowsBuildScriptPath = join(workspaceRoot, "tools", "release", "scripts", "build-platform.ps1");
function workflowFixtureEnv(
  overrides: Record<string, string>,
  executableDir?: string,
): NodeJS.ProcessEnv {
  const childPath = [executableDir, nodeBinDir, launchPath].filter(Boolean).join(delimiter);
  return {
    ...launchEnv,
    ...overrides,
    Path: childPath,
    PATH: childPath,
  };
}

function sectionBetween(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}

function parseGithubOutput(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const sep = line.indexOf("=");
        expect(sep).toBeGreaterThan(0);
        return [line.slice(0, sep), line.slice(sep + 1)];
      }),
  );
}

async function gitPatchId(mode: "--stable" | "--verbatim", diff: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = execFile("git", ["patch-id", mode], { cwd: workspaceRoot, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve(stdout.trim().split(/\s+/)[0] ?? "");
    });
    child.stdin?.end(diff);
  });
}

async function runReleaseStableForFailure(env: Record<string, string>): Promise<string> {
  try {
    await execFileAsync(process.execPath, ["--experimental-strip-types", releaseStableScriptPath], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "nexu-io/open-design",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        OPEN_DESIGN_RELEASE_CHANNEL: "stable",
        ...env,
      },
    });
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string };
    return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }

  throw new Error("release-stable script unexpectedly succeeded");
}

async function readPackagedVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(packagedPackageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("apps/packaged/package.json must define a version");
  }
  return packageJson.version;
}

async function runScopesPrint(eventName: string, eventPayload: unknown, changedFiles: string[] = []): Promise<Record<string, unknown>> {
  const inputMode = (eventPayload as { inputs?: { ci_mode?: string } }).inputs?.ci_mode;
  const context =
    eventName === "workflow_dispatch" && inputMode !== "hot"
      ? "full"
      : eventName === "merge_group" && changedFiles.length === 0
        ? "full"
        : eventName === "merge_group"
          ? "merge-queue"
          : "pr";
  const { stdout } = await execFileAsync("python3", [scopesScriptPath, "plan", "--context", context, "--files", ...changedFiles], {
    cwd: workspaceRoot,
  });
  const value = JSON.parse(stdout) as {
    scopes: Record<string, unknown>;
    enabled: Record<string, boolean>;
  };
  return {
    ...value.scopes,
    run_e2e_vitest: value.enabled.e2e_vitest,
    run_playwright_critical: value.enabled.playwright_critical,
    run_playwright_visual: value.enabled.playwright_visual,
    run_preflight: value.enabled.preflight,
    run_ui_p0: value.enabled.ui_p0,
    run_web_workspace_tests: value.enabled.web_workspace_tests,
    run_windows_tools_pack_payload_tests: value.enabled.windows_tools_pack_payload_tests,
    run_workspace_unit_tests: value.enabled.workspace_unit_tests,
  };
}

async function runRunners(mode?: string): Promise<Record<string, string>> {
  const env = { ...process.env };
  if (mode === undefined) {
    delete env.OD_CI_RUNNER_MODE;
  } else {
    env.OD_CI_RUNNER_MODE = mode;
  }
  delete env.GITHUB_OUTPUT;

  const { stdout } = await execFileAsync("python3", [runnersScriptPath], {
    cwd: workspaceRoot,
    env,
  });
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        expect(separatorIndex).toBeGreaterThan(0);
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

function runnerOutput(profiles: Record<string, string>, key: string): string {
  const value = profiles[key];
  if (value === undefined) {
    throw new Error(`Missing runner profile output: ${key}`);
  }
  return value;
}

function runnerDecision(profiles: Record<string, string>): { schema_version: number; mode: string } {
  return JSON.parse(runnerOutput(profiles, "decision")) as { schema_version: number; mode: string };
}

function runnerRunsOn(profiles: Record<string, string>): Record<string, string[]> {
  return JSON.parse(runnerOutput(profiles, "runs_on")) as Record<string, string[]>;
}

async function writeFakeGhBin(binDir: string, releases: unknown[]): Promise<void> {
  const ghPath = join(binDir, "gh");
  const ghCmdPath = join(binDir, "gh.cmd");
  await writeFile(
    ghPath,
    `#!/usr/bin/env node
if (process.argv[2] === "api" && /^repos\\/[^/]+\\/[^/]+\\/releases\\?/.test(process.argv[3] ?? "")) {
  const url = new URL(process.argv[3], "https://api.github.com/");
  const page = url.searchParams.get("page") ?? "1";
  process.stdout.write(JSON.stringify(page === "1" ? ${JSON.stringify(releases)} : []));
  process.exit(0);
}
console.error("unexpected gh invocation: " + process.argv.slice(2).join(" "));
process.exit(1);
`,
  );
  await chmod(ghPath, 0o755);
  await writeFile(ghCmdPath, `@echo off\r\n"${process.execPath}" "%~dp0gh" %*\r\n`);
}

async function renderFeishuBuildCard(env: Record<string, string>): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      payload = JSON.parse(raw) as Record<string, unknown>;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ code: 0 }));
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Feishu card fixture did not bind to a TCP port");
  }

  try {
    await execFileAsync(process.execPath, ["--experimental-strip-types", feishuCardScriptPath], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        BUILD_STATE: "success",
        CHANNEL_LABEL: "Prerelease",
        FEISHU_WEBHOOK: `http://127.0.0.1:${address.port}`,
        VERSION: "0.19.0-prerelease.1",
        ...env,
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error == null ? resolve() : reject(error)));
    });
  }

  if (payload == null) throw new Error("Feishu card fixture received no payload");
  return payload;
}

describe("packaged smoke workflow", () => {

  it("[P2] keeps the backport patch-equivalence gate whitespace-sensitive", async () => {
    const compactDiff = [
      "diff --git a/script.py b/script.py",
      "--- a/script.py",
      "+++ b/script.py",
      "@@ -1 +1 @@",
      "-print(1)",
      "+print(2)",
      "",
    ].join("\n");
    const whitespaceDiff = [
      "diff --git a/script.py b/script.py",
      "--- a/script.py",
      "+++ b/script.py",
      "@@ -1 +1 @@",
      "-print(1)",
      "+ print(2)",
      "",
    ].join("\n");

    const compactStable = await gitPatchId("--stable", compactDiff);
    const whitespaceStable = await gitPatchId("--stable", whitespaceDiff);
    const compactVerbatim = await gitPatchId("--verbatim", compactDiff);
    const whitespaceVerbatim = await gitPatchId("--verbatim", whitespaceDiff);

    expect(compactStable).toBe(whitespaceStable);
    expect(compactVerbatim).not.toBe(whitespaceVerbatim);
  });

  it("[P2] skips the critical fallback for pure packaged-leaf changes and stays fail-closed elsewhere", async () => {
    const hot = { inputs: { ci_mode: "hot" } };

    // Playwright never starts the desktop, packaged, or tools-pack
    // entrypoints, so a change confined to those leaf roots keeps its
    // package tests but must not pay the two-job critical fallback.
    for (const file of [
      "apps/desktop/src/main.ts",
      "apps/packaged/src/index.ts",
      "tools/pack/src/win/installer.ts",
    ]) {
      await expect(runScopesPrint("workflow_dispatch", hot, [file])).resolves.toMatchObject({
        run_playwright_critical: false,
        run_ui_p0: false,
        tools_dev_tests_required: true,
        tools_pack_tests_required: true,
        ui_critical_validation_required: false,
        workspace_validation_required: true,
      });
    }

    const mergeGroup = {
      merge_group: {
        base_sha: "1111111111111111111111111111111111111111",
        head_sha: "2222222222222222222222222222222222222222",
      },
    };
    await expect(runScopesPrint("merge_group", mergeGroup, ["apps/desktop/src/main.ts"])).resolves.toMatchObject({
      run_e2e_vitest: false,
      run_playwright_critical: false,
      run_playwright_visual: false,
      run_ui_p0: false,
      run_web_workspace_tests: false,
      run_windows_tools_pack_payload_tests: false,
      tools_dev_tests_required: true,
      tools_pack_tests_required: true,
      windows_tools_pack_payload_tests_required: false,
      workspace_validation_required: true,
    });

    await expect(runScopesPrint("merge_group", mergeGroup, ["tools/pack/src/mac/app.ts"])).resolves.toMatchObject({
      run_windows_tools_pack_payload_tests: false,
      tools_pack_tests_required: true,
      windows_tools_pack_payload_tests_required: false,
    });

    await expect(runScopesPrint("merge_group", mergeGroup, ["tools/pack/src/win/custom-installer.ts"])).resolves.toMatchObject({
      run_windows_tools_pack_payload_tests: true,
      tools_pack_tests_required: true,
      windows_tools_pack_payload_tests_required: true,
    });

    await expect(runScopesPrint("merge_group", mergeGroup, ["packages/launcher-proto/src/index.ts"])).resolves.toMatchObject({
      run_windows_tools_pack_payload_tests: true,
      windows_tools_pack_payload_tests_required: true,
    });

    await expect(runScopesPrint("merge_group", mergeGroup, ["apps/desktop/package.json"])).resolves.toMatchObject({
      run_e2e_vitest: true,
      run_playwright_visual: true,
      run_ui_p0: true,
      run_web_workspace_tests: true,
    });

    // Fail-closed: anything that can reach the Playwright runtime — tools-dev,
    // transitive packages (including the undeclared metatool edge), scripts,
    // runtime resources, or unknown roots — retains the fallback.
    for (const file of [
      "tools/dev/src/index.ts",
      "packages/metatool/src/index.ts",
      "packages/agui-adapter/src/adapter.ts",
      "packages/diagnostics/src/index.ts",
      "packages/plugin-runtime/src/index.ts",
      "packages/registry-protocol/src/index.ts",
      "scripts/guard.ts",
      "mocks/bin/opencode",
      "some-new-root/file.ts",
    ]) {
      await expect(runScopesPrint("workflow_dispatch", hot, [file])).resolves.toMatchObject({
        run_playwright_critical: true,
        ui_critical_validation_required: true,
      });
    }

    // A mixed leaf + runtime change retains the fallback.
    await expect(
      runScopesPrint("workflow_dispatch", hot, ["apps/desktop/src/main.ts", "tools/dev/src/index.ts"]),
    ).resolves.toMatchObject({
      run_playwright_critical: true,
      ui_critical_validation_required: true,
    });

    // Root manifest/lock/workspace files keep enabling P0, which retains the
    // existing critical/P0 mutual exclusion.
    for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      await expect(runScopesPrint("workflow_dispatch", hot, [file])).resolves.toMatchObject({
        run_ui_p0: true,
        run_playwright_critical: false,
      });
    }

    // Documentation-only changes stay exempt from both.
    await expect(runScopesPrint("workflow_dispatch", hot, ["docs/spec.md"])).resolves.toMatchObject({
      run_playwright_critical: false,
      ui_critical_validation_required: false,
      workspace_validation_required: false,
    });

    // merge_group/full behavior is unchanged: everything is required and the
    // matrix covers critical, so the fallback stays off.
    await expect(runScopesPrint("merge_group", {})).resolves.toMatchObject({
      ci_mode: "full",
      ui_critical_validation_required: true,
      run_playwright_critical: false,
      run_ui_p0: true,
    });
  }, T.medium);

  it("[P1] includes launcher protocol in the Nix daemon workspace build", async () => {
    const flake = await readFile(flakePath, "utf8");
    const daemonWorkspaces = sectionBetween(flake, "      daemonWorkspacePaths = [", "      ];");

    expect(daemonWorkspaces).toContain('"packages/launcher-proto"');
    expect(daemonWorkspaces.indexOf('"packages/launcher-proto"')).toBeLessThan(
      daemonWorkspaces.indexOf('"apps/daemon"'),
    );
  });


  it.each([
    {
      name: "Functional E2E commit pin",
      workflowPath: releasePrereleaseWorkflowPath,
      jobStart: "  functional_e2e:",
      jobEnd: "  e2e_vitest:",
      marker: "ref: ${{ needs.metadata.outputs.commit }}",
    },
  ])("[P1] keeps $name bounded to its owning job", async ({
    workflowPath,
    jobStart,
    jobEnd,
    marker,
  }) => {
    const workflow = await readFile(workflowPath, "utf8");
    const owningJob = sectionBetween(workflow, jobStart, jobEnd);
    const mutated = workflow.replace(owningJob, owningJob.replaceAll(marker, "regressed-marker"));

    expect(sectionBetween(mutated, jobStart, jobEnd)).not.toContain(marker);
  });

  it("[P2] caps Playwright concurrency independently from build concurrency", async () => {
    const action = await readFile(configureCiParallelismActionPath, "utf8");

    expect(action).toContain('playwright_workers="$workers"');
    expect(action).toContain('if [ "$playwright_workers" -gt 2 ]; then');
    expect(action).toContain("playwright_workers=2");
    expect(action).toContain('echo "OD_PLAYWRIGHT_WORKERS=$playwright_workers"');
    expect(action).toContain('echo "OPEN_DESIGN_WORKSPACE_CONCURRENCY=$workers"');
  });

  it("[P2] keeps strict visual specs out of functional Playwright runs", async () => {
    const config = await readFile(playwrightConfigPath, "utf8");
    expect(config).toContain("testIgnore: 'visual-*.test.ts'");
  });

  it("[P2] rejects duplicate file assignments across UI P0 shards", () => {
    const files = uiP0Groups["workspace-restoration"].files as unknown as string[];
    files.push("ui/app.test.ts");
    try {
      expect(validatePlaywrightSuiteTopology()).toContain(
        "UI P0 CI matrix covers ui/app.test.ts more than once",
      );
    } finally {
      files.pop();
    }
  });

  it("[P2] resolves CI runner profiles by mode", async () => {
    const defaultProfiles = await runRunners();
    const defaultRunsOn = runnerRunsOn(defaultProfiles);
    expect(runnerDecision(defaultProfiles)).toEqual({ schema_version: 1, mode: "default" });
    expect(Object.keys(defaultRunsOn).sort()).toEqual([
      "control",
      "general_medium",
      "js_hot",
      "ui_hot",
      "ui_p0",
      "ui_p0_heavy",
      "visual_hot",
      "windows_tools",
      "workspace_unit",
    ]);
    expect(defaultRunsOn.control).toEqual(["nexu-runners-small"]);
    expect(defaultRunsOn.general_medium).toEqual(["nexu-runners-medium"]);
    expect(defaultRunsOn.workspace_unit).toEqual(["nexu-runners-medium"]);
    expect(defaultRunsOn.windows_tools).toEqual(["windows-latest"]);
    expect(defaultRunsOn.js_hot).toEqual(["nexu-runners-medium"]);
    expect(defaultRunsOn.ui_hot).toEqual(["nexu-runners-large"]);
    expect(defaultRunsOn.ui_p0).toEqual(["nexu-runners-medium"]);
    expect(defaultRunsOn.ui_p0_heavy).toEqual(["nexu-runners-xlarge"]);
    expect(defaultRunsOn.visual_hot).toEqual(["nexu-runners-large"]);
    expect(defaultProfiles).not.toHaveProperty("contabo_control");
    expect(defaultProfiles).not.toHaveProperty("hosted_or_blacksmith");
    expect(defaultProfiles).not.toHaveProperty("blacksmith_default");

    const performanceProfiles = await runRunners("performance");
    const performanceRunsOn = runnerRunsOn(performanceProfiles);
    expect(runnerDecision(performanceProfiles)).toEqual({ schema_version: 1, mode: "default" });
    expect(performanceRunsOn.control).toEqual(["nexu-runners-small"]);
    expect(performanceRunsOn.general_medium).toEqual(["nexu-runners-medium"]);
    expect(performanceRunsOn.workspace_unit).toEqual(["nexu-runners-medium"]);
    expect(performanceRunsOn.windows_tools).toEqual(["windows-latest"]);
    expect(performanceRunsOn.js_hot).toEqual(["nexu-runners-medium"]);
    expect(performanceRunsOn.ui_hot).toEqual(["nexu-runners-large"]);
    expect(performanceRunsOn.ui_p0).toEqual(["nexu-runners-medium"]);
    expect(performanceRunsOn.ui_p0_heavy).toEqual(["nexu-runners-xlarge"]);
    expect(performanceRunsOn.visual_hot).toEqual(["nexu-runners-large"]);

    const blacksmithProfiles = await runRunners("blacksmith");
    const blacksmithRunsOn = runnerRunsOn(blacksmithProfiles);
    expect(runnerDecision(blacksmithProfiles)).toEqual({ schema_version: 1, mode: "blacksmith" });
    expect(blacksmithRunsOn.control).toEqual(["blacksmith-4vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.general_medium).toEqual(["blacksmith-4vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.workspace_unit).toEqual(["blacksmith-4vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.windows_tools).toEqual(["windows-latest"]);
    expect(blacksmithRunsOn.js_hot).toEqual(["blacksmith-4vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.ui_hot).toEqual(["blacksmith-8vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.ui_p0).toEqual(["blacksmith-8vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.ui_p0_heavy).toEqual(["blacksmith-8vcpu-ubuntu-2404"]);
    expect(blacksmithRunsOn.visual_hot).toEqual(["blacksmith-8vcpu-ubuntu-2404"]);

    const economicProfiles = await runRunners("economic");
    const economicRunsOn = runnerRunsOn(economicProfiles);
    expect(runnerDecision(economicProfiles)).toEqual({ schema_version: 1, mode: "economic" });
    expect(economicRunsOn.control).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.general_medium).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.workspace_unit).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.windows_tools).toEqual(["windows-latest"]);
    expect(economicRunsOn.js_hot).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.ui_hot).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.ui_p0).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.ui_p0_heavy).toEqual(["ubuntu-24.04"]);
    expect(economicRunsOn.visual_hot).toEqual(["ubuntu-24.04"]);

    for (const invalidMode of ["Economic", " economic "]) {
      await expect(runRunners(invalidMode)).rejects.toThrow("unknown runner mode");
    }
  });

  it("[P1] keeps infra-cancel rerun eligibility gates unit-tested", async () => {
    const { stdout, stderr } = await execFileAsync("python3", [rerunInfraCancelScriptPath, "self-check"], {
      cwd: workspaceRoot,
    });
    expect(stderr).toBe("");
    expect(stdout).toContain("rerun_infra_cancel self-check OK");
  });

  it("[P1] keeps workload policy above the narrow Python R2 transport", async () => {
    const [convergence, r2] = await Promise.all([
      readFile(convergenceScriptPath, "utf8"),
      readFile(r2PythonLibPath, "utf8"),
    ]);
    expect(convergence).toContain("from lib.r2 import R2Client");
    expect(convergence).toContain("def publish_command");
    expect(r2).toContain("class R2Client");
    expect(r2).toContain('headers["if-none-match"] = "*"');
    expect(r2).not.toContain("workload result");
    expect(r2).not.toContain("handoff");
  });

  it.each(["beta", "stable"])("[P2] verifies all HiDesign %s builds before publishing", async (channel) => {

    const workflow = await readFile(channel === "beta" ? releaseBetaWorkflowPath : releaseStableWorkflowPath, "utf8");
    const verify = sectionBetween(workflow, "  verify:", "  build_mac:");
    expect(verify).toContain("pnpm install --frozen-lockfile");
    expect(verify).toContain("run: pnpm -r --workspace-concurrency=4 --if-present run typecheck");
    expect(verify).toContain("run: pnpm guard");
    const buildJobs = [
      sectionBetween(workflow, "  build_mac:", "  build_mac_intel:"),
      sectionBetween(workflow, "  build_mac_intel:", "  build_win:"),
      sectionBetween(workflow, "  build_win:", "  publish:"),
    ];
    for (const job of buildJobs) expect(job).toContain("needs: verify");
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    for (const job of ["verify", "build_mac", "build_mac_intel", "build_win"]) {
      expect(publish).toContain(`      - ${job}`);
      expect(publish).toContain(`needs.${job}.result == 'success'`);
    }
    expect(publish).toContain('--target "$(git rev-parse HEAD)"');
  });

  it("[P2] preserves prerelease linux AppImage smoke reports for release publication", async () => {
    const workflow = await readFile(releasePrereleaseWorkflowPath, "utf8");
    const build = sectionBetween(workflow, "      - name: Build prerelease linux artifacts", "      - name: Smoke prerelease linux AppImage runtime");
    expect(build).toContain('report_dir="$RUNNER_TEMP/release-report/linux_x64"');
    expect(build).toContain('tee "$report_dir/tools-pack.json"');
    expect(build).toContain('tee -a "$report_dir/tools-pack.log"');
    expect(build).toContain('JSON.parse(fs.readFileSync(process.argv[1], "utf8"))');
    const smoke = sectionBetween(workflow, "      - name: Smoke prerelease linux AppImage runtime", "      - name: Upload linux e2e spec report");
    expect(smoke).toContain('cat > "$report_dir/manifest.json"');
    expect(smoke).toContain('tee "$report_dir/vitest.log"');
    const aptIndex = smoke.indexOf("sudo apt-get update");
    expect(aptIndex).toBeGreaterThan(0);
    expect(smoke.indexOf('mkdir -p "$report_dir/screenshots"')).toBeGreaterThan(0);
    expect(smoke.indexOf('mkdir -p "$report_dir/screenshots"')).toBeLessThan(aptIndex);
    expect(smoke.indexOf('cat > "$report_dir/manifest.json"')).toBeLessThan(aptIndex);
    expect(workflow).toContain("name: open-design-prerelease-linux-e2e-report");
    expect(workflow).toContain("name: open-design-prerelease-linux-x64-publish-manifest");
  });

  it("[P2] keeps release namespaces aligned with release channels", async () => {
    const [releaseStableWorkflow, releaseStableScript, releasePrereleaseWorkflow, releaseBetaWorkflow] = await Promise.all([
      readFile(releaseStableWorkflowPath, "utf8"),
      readFile(releaseStableScriptPath, "utf8"),
      readFile(releasePrereleaseWorkflowPath, "utf8"),
      readFile(releaseBetaWorkflowPath, "utf8"),
    ]);

    expect(releaseStableScript).toContain('mac: releaseNamespace(channel, "mac"),');
    expect(releaseStableScript).toContain('setOutput("namespace", namespaces.mac);');
    expect(releaseStableScript).toContain('setOutput("mac_intel_namespace", namespaces.macIntel);');
    expect(releaseStableScript).toContain('setOutput("win_namespace", namespaces.win);');
    expect(releaseStableScript).toContain('setOutput("linux_namespace", namespaces.linux);');

    expectChannelWorkflowNamespaces(releasePrereleaseWorkflow, "prerelease", { hasLinuxSmoke: true });
    for (const [workflow, channel] of [[releaseBetaWorkflow, "beta"], [releaseStableWorkflow, "stable"]] as const) {
      const mac = sectionBetween(workflow, "  build_mac:", "  build_mac_intel:");
      const intel = sectionBetween(workflow, "  build_mac_intel:", "  build_win:");
      const win = sectionBetween(workflow, "  build_win:", "  publish:");
      expect(mac).toContain(`--namespace release-${channel}`);
      expect(intel).toContain(`--namespace release-${channel}-intel`);
      expect(win).toContain(`"--namespace", "release-${channel}-win"`);
      expect(workflow).toContain(`/hi-design/${channel}/latest/metadata.json`);
    }
    expect(releaseBetaWorkflow).toContain("OD_PACKAGED_E2E_NAMESPACE: release-beta");
    expect(releaseBetaWorkflow).toContain("OD_PACKAGED_E2E_NAMESPACE: release-beta-win");
    const betaBuildScript = await readFile(releaseBetaPosixBuildScriptPath, "utf8");
    expect(betaBuildScript).toContain("required RELEASE_CHANNEL");
    expect(betaBuildScript).toContain('release_channel="$RELEASE_CHANNEL"');
    expect(betaBuildScript).not.toContain('RELEASE_CHANNEL:-beta');
    expect(betaBuildScript).toContain('OD_PACKAGED_E2E_RELEASE_CHANNEL="$release_channel"');
    expect(betaBuildScript).toContain('OD_PACKAGED_E2E_RELEASE_VERSION="$RELEASE_VERSION"');
    expect(betaBuildScript).toContain('OD_PACKAGED_E2E_MAC_UPDATE_FIXTURE="${update_build_json_path:+tools-serve}"');
    const betaWindowsBuildScript = await readFile(releaseBetaWindowsBuildScriptPath, "utf8");
    expect(betaWindowsBuildScript).toContain('throw "RELEASE_CHANNEL is required"');
    expect(betaWindowsBuildScript).not.toContain('"beta" } else { $env:RELEASE_CHANNEL }');
    expect(betaWindowsBuildScript).toContain('Test-JsonString $manifest.channel "channel" $ReleaseChannel');
    expect(betaWindowsBuildScript).toContain('channel = $ReleaseChannel');
    expect(betaWindowsBuildScript).toContain('$env:OD_PACKAGED_E2E_RELEASE_CHANNEL = $ReleaseChannel');
    expect(betaWindowsBuildScript).toContain('$env:OD_PACKAGED_E2E_WIN_UPDATE_FIXTURE = "tools-serve"');

    expectWindowsUpdaterSmokeContract(releasePrereleaseWorkflow, "prerelease");
  });

  it("[P2] prerelease publishes github.commit so its changelog has a baseline", async () => {
    // The Feishu release card computes its changelog as `git log <previous>..<current>`,
    // where <previous> is read from prerelease/latest/metadata.json's `.github.commit`
    // (notify-release-feishu.yml). That field is written by githubInfo() from the
    // RELEASE_COMMIT env. release-prerelease historically omitted it, so every prerelease published an
    // empty github.commit and the card could never diff against the prior prerelease
    // ("首个 Prerelease 包"). Require RELEASE_COMMIT on the prerelease build + publish jobs
    // so the per-platform manifests and the final metadata.json carry the built commit and
    // stay mutually consistent (publish-metadata rejects a manifest whose commit disagrees).
    const prereleaseWorkflow = await readFile(releasePrereleaseWorkflowPath, "utf8");

    const releaseCommitEnv = "RELEASE_COMMIT: ${{ needs.metadata.outputs.commit }}";
    const jobBounds: Array<[string, string]> = [
      ["  build_mac:", "  build_mac_intel:"],
      ["  build_mac_intel:", "  build_win:"],
      ["  build_win:", "  build_linux:"],
      ["  build_linux:", "  publish:"],
      ["  publish:", "  cleanup_partial_release_assets:"],
    ];
    for (const [start, end] of jobBounds) {
      expect(sectionBetween(prereleaseWorkflow, start, end)).toContain(releaseCommitEnv);
    }
  });

  it("[P2] keeps counted release workflow calls on a consistent ref and output contract", async () => {
    const prereleaseWorkflow = await readFile(releasePrereleaseWorkflowPath, "utf8");

    expectCountedReleaseWorkflowCallContract(prereleaseWorkflow, "prerelease");

    expect(prereleaseWorkflow).toContain("OPEN_DESIGN_STABLE_VERSION: ${{ inputs.release_version }}");
    expect(prereleaseWorkflow).toContain("Required when ref is not release/vX.Y.Z");
  });

  it("[P2] retires dedicated betas and preview release entrypoints", () => {
    for (const path of [
      join(workspaceRoot, ".github", "workflows", "release-beta-s.yml"),
      join(workspaceRoot, ".github", "workflows", "release-preview.yml"),
      join(workspaceRoot, "tools", "release", "src", "metadata", "prepare-betas.ts"),
      join(workspaceRoot, "tools", "release", "src", "metadata", "prepare-preview.ts"),
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it.each(["beta", "stable"])("[P2] hands all HiDesign %s build artifacts to the publish job", async (channel) => {

    const workflow = await readFile(channel === "beta" ? releaseBetaWorkflowPath : releaseStableWorkflowPath, "utf8");
    const prefix = channel === "beta" ? "beta" : "release";
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    const jobs = [
      ["mac-arm64", sectionBetween(workflow, "  build_mac:", "  build_mac_intel:")],
      ["mac-intel", sectionBetween(workflow, "  build_mac_intel:", "  build_win:")],
      ["win", sectionBetween(workflow, "  build_win:", "  publish:")],
    ];
    for (const [target, job] of jobs) {
      const artifact = `name: open-design-${prefix}-${target}-assets`;
      expect(job).toContain("uses: actions/upload-artifact@v7");
      expect(job).toContain("if-no-files-found: error");
      expect(job).toContain(artifact);
      expect(publish).toContain(artifact);
    }
    expect(publish).toContain('gh release upload "$VERSION_TAG" "$RUNNER_TEMP/release-assets"/*');
    expect(publish).toContain('gh release delete "$VERSION_TAG" --cleanup-tag --yes');
    expect(publish).toContain("if: failure() && steps.create_release.outcome == 'success'");
  });

  it("[P2] publishes prerelease notes before its metadata through tools-release", async () => {
    const workflows = await Promise.all([
      readFile(releasePrereleaseWorkflowPath, "utf8"),
    ]);

    for (const workflow of workflows) {
      expect(workflow).toContain("tools-release prepare-release-note");
      expect(workflow).toContain("tools-release publish-release-note");
      expect(workflow).toContain("tools-release verify-release-note");
      expect(workflow).toContain("RELEASE_NOTE_MANIFEST_PATH:");
      expect(workflow.indexOf("tools-release prepare-release-note")).toBeLessThan(
        workflow.indexOf("tools-release publish-release-note"),
      );
      expect(workflow.indexOf("tools-release publish-release-note")).toBeLessThan(
        workflow.indexOf("tools-release verify-release-note"),
      );
      expect(workflow.indexOf("tools-release verify-release-note")).toBeLessThan(
        workflow.indexOf("tools-release publish-metadata"),
      );
    }

  });

  it("[P2] accepts an explicit stable version and source ref for the direct HiDesign build", async () => {

    const workflow = await readFile(releaseStableWorkflowPath, "utf8");
    const dispatch = sectionBetween(workflow, "  workflow_dispatch:", "permissions:");
    expect(dispatch).toMatch(/release_version:\s+description:.*\s+required: true/);
    expect(dispatch).toContain("ref:");
    // Verify, all three builds, and publish check out the same selected source.
    expect(workflow.match(/ref: \$\{\{ inputs\.ref \}\}/g)).toHaveLength(5);
    expect(workflow).toContain('VERSION_TAG="v${{ inputs.release_version }}"');
    expect(workflow).toContain('if git ls-remote --exit-code --tags origin "refs/tags/$VERSION_TAG"');
    expect(workflow).toContain('if gh release view "$VERSION_TAG"');
    expect(workflow).toContain('--latest');
  });

  it("[P2] rejects stable release runs without the release version branch", async () => {
    const output = await runReleaseStableForFailure({
      GITHUB_REF_NAME: "main",
      OPEN_DESIGN_STABLE_VERSION: "",
    });

    expect(output).toContain("release-stable requires GITHUB_REF_NAME to be release/vX.Y.Z; got main");
  });

  it("[P2] ignores explicit stable version inputs in favor of the release branch gate", async () => {
    const output = await runReleaseStableForFailure({
      GITHUB_REF_NAME: "main",
      OPEN_DESIGN_STABLE_VERSION: "0.10.1",
    });

    expect(output).toContain("release-stable requires GITHUB_REF_NAME to be release/vX.Y.Z; got main");
  });

  it("[P2] reads beta metadata.json written with releaseVersion/releaseNumber field names", async () => {
    // The unified publisher refactor (.github/workflow/scripts/release/storage)
    // and the in-flight tools-release rewrite stamp beta/latest/metadata.json
    // with generic releaseVersion/releaseNumber fields instead of the legacy
    // betaVersion/betaNumber. tools-release's daily-beta reader must accept
    // those aliases or the scheduled build dies at metadata time.
    const packagedVersion = JSON.parse(
      await readFile(join(workspaceRoot, "apps", "packaged", "package.json"), "utf8"),
    ).version as string;

    const objects: Record<string, unknown> = {
      "stable/latest/metadata.json": { channel: "stable", stableVersion: "0.0.1" },
      "beta/latest/metadata.json": {
        baseVersion: packagedVersion,
        channel: "beta",
        releaseNumber: 4,
        releaseVersion: `${packagedVersion}-beta.4`,
      },
    };
    const fixture = await startStablePrereleaseMetadataServer(objects);
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-beta-reader-"));
    const outputPath = join(runnerTemp, "outputs.txt");

    try {
      const result = await execFileAsync(process.execPath, ["--experimental-strip-types", releaseBetaScriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          GITHUB_REF_NAME: "main",
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          OPEN_DESIGN_BETA_METADATA_URL: `${fixture.origin}/beta/latest/metadata.json`,
          OPEN_DESIGN_STABLE_METADATA_URL: `${fixture.origin}/stable/latest/metadata.json`,
        },
        maxBuffer: 1024 * 1024,
      });

      expect(result.stdout).toContain(`[release-beta] beta version: ${packagedVersion}-beta.5`);
      const outputs = await readFile(outputPath, "utf8");
      expect(outputs).toContain(`beta_version=${packagedVersion}-beta.5`);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it.skip("[P1] lets the daily main build recover a shared beta advanced by a feature branch", async () => {
    const packagedVersion = "1.2.3";
    const foreignAheadBaseVersion = "1.3.0";
    const objects: Record<string, unknown> = {
      "beta/latest/metadata.json": {
        baseVersion: foreignAheadBaseVersion,
        channel: "beta",
        github: { branch: "feat/standalone-closure" },
        releaseNumber: 9,
        releaseVersion: `${foreignAheadBaseVersion}-beta.9`,
      },
    };
    const fixture = await startStablePrereleaseMetadataServer(objects);
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-beta-foreign-recovery-"));
    const outputPath = join(runnerTemp, "outputs.txt");
    const baseEnv = {
      ...process.env,
      BUILD_REF: "main",
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_NUMBER: "4242",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      OPEN_DESIGN_BETA_METADATA_URL: `${fixture.origin}/beta/latest/metadata.json`,
      PACKAGED_VERSION: packagedVersion,
    };

    try {
      const recovered = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", dailyBetaRecoveryScriptPath],
        {
          cwd: workspaceRoot,
          env: baseEnv,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(recovered.stdout).toContain(
        "[daily-beta] recovering shared beta from foreign branch feat/standalone-closure",
      );
      const recoveryOutputs = await readFile(outputPath, "utf8");
      expect(recoveryOutputs).toContain("force=true");
      expect(recoveryOutputs).toContain("promote=false");
      expect(recoveryOutputs).toContain(`release_version=${packagedVersion}-beta.4242`);

      await writeFile(outputPath, "", "utf8");
      const featureBuild = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", dailyBetaRecoveryScriptPath],
        {
          cwd: workspaceRoot,
          env: { ...baseEnv, BUILD_REF: "feat/standalone-closure" },
          maxBuffer: 1024 * 1024,
        },
      );
      expect(featureBuild.stdout).toContain("[daily-beta] recovery disabled for non-main ref");
      const featureOutputs = await readFile(outputPath, "utf8");
      expect(featureOutputs).toContain("force=false");
      expect(featureOutputs).toContain("promote=true");
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("[P1] keeps download actions on a prerelease card with a failed Windows smoke", async () => {
    const payload = await renderFeishuBuildCard({
      MAC_ARM64_SMOKE_RESULT: "success",
      MAC_ARM64_URL: "https://releases.example/mac.dmg",
      WIN_X64_SMOKE_RESULT: "failure",
      WIN_URL: "https://releases.example/windows.exe",
    });
    const card = payload.card as {
      elements: Array<{ actions?: Array<{ url?: string }>; text?: { content?: string } }>;
      header: { template?: string; title?: { content?: string } };
    };

    expect(card.header).toMatchObject({
      template: "orange",
      title: { content: expect.stringContaining("Windows x64 smoke 失败") },
    });
    expect(card.elements.map((element) => element.text?.content).filter(Boolean)).toContain(
      "**Smoke 告警**\n- Windows x64 smoke 失败\n\n产物已继续发布，可通过下方链接下载。",
    );
    expect(card.elements.flatMap((element) => element.actions ?? []).map((action) => action.url)).toEqual([
      "https://releases.example/mac.dmg",
      "https://releases.example/windows.exe",
    ]);
  });

  it("[P1] keeps download actions on a partial beta card without claiming latest promotion", async () => {
    const payload = await renderFeishuBuildCard({
      CHANNEL_LABEL: "Beta",
      MAC_ARM64_URL: "https://releases.example/beta-mac.dmg",
      RELEASE_NOTE: "共享 beta/latest 版本高于 main，本次仅发布版本化快照。",
      RELEASE_STATE: "partial",
      VERSION: "0.18.2-beta.4242",
      WIN_URL: "https://releases.example/beta-windows.exe",
    });
    const card = payload.card as {
      elements: Array<{ actions?: Array<{ url?: string }>; text?: { content?: string } }>;
      header: { template?: string; title?: { content?: string } };
    };

    expect(card.header).toMatchObject({
      template: "orange",
      title: { content: expect.stringContaining("未更新 Beta latest") },
    });
    expect(card.elements.map((element) => element.text?.content).filter(Boolean)).toContain(
      "**渠道状态**\n产物已发布并可下载，但未更新 Beta latest。\n\n共享 beta/latest 版本高于 main，本次仅发布版本化快照。",
    );
    expect(card.elements.flatMap((element) => element.actions ?? []).map((action) => action.url)).toEqual([
      "https://releases.example/beta-mac.dmg",
      "https://releases.example/beta-windows.exe",
    ]);
  });

  it("[P2] retains metadata and prepublish modes in the standalone stable promotion helper", async () => {
    const script = await readFile(releaseStableScriptPath, "utf8");
    expect(script).toContain("function parseStableDryRunMode");
    expect(script).toContain("OPEN_DESIGN_RELEASE_DRY_RUN must be metadata, prepublish, true, or false");
    expect(script).toContain('setOutput("dry_run", dryRun ? "true" : "false");');
    expect(script).toContain('setOutput("dry_run_mode", stableDryRunMode);');
    expect(script).toContain('setOutput("run_prepublish_jobs", runPrepublishJobs ? "true" : "false");');
    expect(script).toContain('setOutput("publish_side_effects_enabled", publishSideEffectsEnabled ? "true" : "false");');
  });

  it("[P2] writes stable release notes from the release public origin variable", async () => {
    for (const [envName, origin] of [
      ["RELEASE_PUBLIC_ORIGIN", "https://releases.open-design.ai/current/"],
      ["CLOUDFLARE_R2_RELEASES_PUBLIC_ORIGIN", "https://releases.open-design.ai/legacy/"],
    ] as const) {
      const runnerTemp = await mkdtemp(join(tmpdir(), "od-stable-notes-"));
      const outputPath = join(runnerTemp, "github-output.txt");

      try {
        await execFileAsync("bash", [releaseStableNotesScriptPath], {
          cwd: workspaceRoot,
          env: workflowFixtureEnv({
            BRANCH_NAME: "release/v0.13.0",
            CLOUDFLARE_R2_RELEASES_PUBLIC_ORIGIN: envName === "CLOUDFLARE_R2_RELEASES_PUBLIC_ORIGIN" ? origin : "",
            GITHUB_OUTPUT: outputPath,
            GITHUB_REPOSITORY: "nexu-io/open-design",
            GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
            RELEASE_CHANNEL: "stable",
            RELEASE_PUBLIC_ORIGIN: envName === "RELEASE_PUBLIC_ORIGIN" ? origin : "",
            RELEASE_SIGNED: "true",
            RELEASE_VERSION: "0.13.0",
            RUNNER_TEMP: runnerTemp,
            VERSION_TAG: "open-design-v0.13.0",
          }),
        });

        const outputs = parseGithubOutput(await readFile(outputPath, "utf8"));
        const notes = await readFile(outputs.notes_file ?? "", "utf8");
        expect(notes).toContain(`R2 metadata: ${origin.replace(/\/+$/, "")}/stable/latest/metadata.json`);
        expect(notes).toContain(`E2E report: ${origin.replace(/\/+$/, "")}/stable/versions/0.13.0/report.zip`);
      } finally {
        await rm(runnerTemp, { force: true, recursive: true });
      }
    }
  });

  it("[P2] validates stable dry-run prerelease metadata from a release branch", async () => {
    const baseVersion = await readPackagedVersion();
    const prereleaseVersion = `${baseVersion}-prerelease.12`;
    const objects: Record<string, unknown> = {};
    const fixture = await startStablePrereleaseMetadataServer(objects);
    objects[`prerelease/versions/${prereleaseVersion}/metadata.json`] = stablePrereleaseMetadataFixture(
      baseVersion,
      prereleaseVersion,
      fixture.origin,
    );
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-stable-dry-run-"));

    try {
      await mkdir(join(runnerTemp, "bin"), { recursive: true });
      await writeFakeGhBin(join(runnerTemp, "bin"), []);
      const result = await execFileAsync(process.execPath, ["--experimental-strip-types", releaseStableScriptPath], {
        cwd: workspaceRoot,
        env: workflowFixtureEnv({
          GITHUB_REF_NAME: `release/v${baseVersion}`,
          GITHUB_REPOSITORY: "nexu-io/open-design",
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          OPEN_DESIGN_RELEASE_CHANNEL: "stable",
          OPEN_DESIGN_RELEASE_DRY_RUN: "true",
          OPEN_DESIGN_RELEASES_PUBLIC_ORIGIN: fixture.origin,
          OPEN_DESIGN_GH_NODE_SCRIPT: join(runnerTemp, "bin", "gh"),
          OPEN_DESIGN_STABLE_PRERELEASE_VERSION: prereleaseVersion,
        }, join(runnerTemp, "bin")),
      });

      expect(result.stdout).toContain(`[release-stable] validated prerelease: ${prereleaseVersion}`);
      expect(result.stdout).toContain("[release-stable] channel: stable");
      expect(result.stdout).toContain("[release-stable] dry run: true");
      expect(result.stdout).toContain(`[release-stable] version tag: hi-design-team-v${baseVersion}`);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("[P2] rejects invalid release dry-run values before remote checks", async () => {
    const output = await runReleaseStableForFailure({
      GITHUB_REF_NAME: "release/v0.10.0",
      OPEN_DESIGN_RELEASE_DRY_RUN: "maybe",
      OPEN_DESIGN_STABLE_VERSION: "",
    });

    expect(output).toContain("OPEN_DESIGN_RELEASE_DRY_RUN must be metadata, prepublish, true, or false");
  });

  it.each(["beta", "stable"])("generates usable HiDesign %s installer and payload metadata from the built artifacts", async (channel) => {
    const version = channel === "beta" ? "0.21.4-beta.1" : "0.21.4";
    const workflow = await readFile(channel === "beta" ? releaseBetaWorkflowPath : releaseStableWorkflowPath, "utf8");
    const step = sectionBetween(workflow, "      - name: Generate metadata.json", "      - name: Create draft");
    const script = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length)
      .split("\n").map((line) => line.slice(10)).join("\n")
      .replaceAll("${{ inputs.release_version }}", version);
    const temp = await mkdtemp(join(tmpdir(), "od-hidesign-metadata-"));
    const assets = join(temp, "release-assets");
    const targets = [
      ["mac", "arm64", "dmg", "mac-arm64.dmg", "mac-arm64-payload.zip"],
      ["macIntel", "x64", "dmg", "mac-x64.dmg", "mac-x64-payload.zip"],
      ["win", "x64", "installer", "win-x64-setup.exe", "win-x64-payload.7z"],
    ] as const;
    try {
      await mkdir(assets);
      for (const [, , , installer, payload] of targets) {
        for (const suffix of [installer, payload]) {
          await writeFile(join(assets, `Hi Design-${version}-${suffix}`), suffix);
        }
      }
      // Execute the actual generator with local bytes; no publishing or network calls.
      await execFileAsync("bash", ["-c", script], { env: workflowFixtureEnv({ RUNNER_TEMP: temp }) });
      const metadata = JSON.parse(await readFile(join(assets, "metadata.json"), "utf8"));
      expect(metadata.channel).toBe(channel);
      expect(metadata[`${channel}Version`]).toBe(version);
      expect(Object.keys(metadata.platforms).sort()).toEqual(["mac", "macIntel", "win"]);
      for (const [platform, arch, installerKind, installer, payload] of targets) {
        expect(metadata.platforms[platform]).toMatchObject({ enabled: true, arch });
        for (const [kind, suffix] of [[installerKind, installer], ["payload", payload]] as const) {
          expect(metadata.platforms[platform].artifacts[kind]).toEqual({
            url: `https://pixso.hikvision.com.cn/hik-plugin/hidesign-web-offical/public/webresources/download/hi-design/${channel}/versions/v${version}/Hi.Design-${version}-${suffix}`,
            sha256: createHash("sha256").update(suffix).digest("hex"),
          });
        }
      }
      // Missing build output must fail instead of publishing incomplete metadata.
      await rm(join(assets, `Hi Design-${version}-win-x64-payload.7z`));
      await expect(execFileAsync("bash", ["-c", script], { env: workflowFixtureEnv({ RUNNER_TEMP: temp }) })).rejects.toThrow();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it.each(["beta", "stable"])("keeps both the HiDesign %s Intel installer and launcher payload in its release assets", async (channel) => {

    const workflow = await readFile(channel === "beta" ? releaseBetaWorkflowPath : releaseStableWorkflowPath, "utf8");
    const intel = sectionBetween(workflow, "  build_mac_intel:", "  build_win:");
    expect(intel).toContain('"$ASSETS_DIR/Hi Design-$VERSION-mac-x64.dmg"');
    expect(intel).toContain('"$ASSETS_DIR/Hi Design-$VERSION-mac-x64-payload.zip"');
    expect(intel).toContain('shasum -a 256 "Hi Design-$VERSION-mac-x64.dmg"');
    expect(intel).toContain('shasum -a 256 "Hi Design-$VERSION-mac-x64-payload.zip"');
  });

  it("rejects stale latest platform manifests from a previous beta version", async () => {
    const fixture = await startReleaseMetadataObjectStore({});
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-betas-metadata-"));
    const platformManifestRoot = join(runnerTemp, "release-platform-manifests");

    try {
      await mkdir(platformManifestRoot, { recursive: true });
      await writeFile(
        join(platformManifestRoot, "mac_arm64.json"),
        `${JSON.stringify(
          {
        artifacts: {
          dmg: {
            url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.3.unsigned/Hi Design Beta.dmg",
          },
        },
        channel: "beta",
        github: {
          commit: "current-sha",
          runAttempt: 2,
          runId: 222222222,
        },
        legacyPlatformKey: "mac",
        platformKey: "mac_arm64",
        releaseTarget: "mac_arm64",
        r2: {
          versionPrefix: "beta/versions/1.2.3-beta.3.unsigned",
        },
        releaseVersion: "1.2.3-beta.3",
        signed: false,
        status: "published",
      },
          null,
          2,
        )}\n`,
      );
      const result = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", releasePublishMetadataScriptPath],
        {
          cwd: workspaceRoot,
          env: {
            ...process.env,
            BASE_VERSION: "1.2.3",
            ENABLE_LINUX_X64: "false",
            ENABLE_MAC_ARM64: "true",
            ENABLE_MAC_X64: "false",
            ENABLE_WIN_X64: "false",
            RELEASE_RUN_ATTEMPT: "2",
            RELEASE_RUN_ID: "222222222",
            RELEASE_COMMIT: "current-sha",
            MAC_ARM64_RESULT: "success",
            RELEASE_CHANNEL: "beta",
            RELEASE_MANIFEST_DIR: platformManifestRoot,
            RELEASE_METADATA_DIR: join(runnerTemp, "release-metadata"),
            RELEASE_OUTPUTS_PATH: join(runnerTemp, "release-metadata", "outputs.json"),
            RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai",
            RELEASE_SIGNED: "false",
            RELEASE_STORAGE_ACCESS_KEY_ID: "test-access-key",
            RELEASE_STORAGE_BUCKET: fixture.bucket,
            RELEASE_STORAGE_ENDPOINT: fixture.endpointUrl,
            RELEASE_STORAGE_REGION: "auto",
            RELEASE_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
            RELEASE_VERSION: "1.2.3-beta.4",
            STATE_SOURCE: "test",
          },
          maxBuffer: 1024 * 1024,
        },
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ reason, status: "rejected" as const }),
      );

      expect(result.status).toBe("rejected");
      expect(String(result.status === "rejected" ? result.reason : "")).toContain(
        "refusing stale mac_arm64 platform manifest for 1.2.3-beta.4: releaseVersion=1.2.3-beta.3",
      );
      expect(fixture.uploadedObjectKeys()).toEqual([]);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("rejects stale latest platform manifests from a previous same-version beta workflow run", async () => {
    const fixture = await startReleaseMetadataObjectStore({});
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-betas-metadata-"));
    const platformManifestRoot = join(runnerTemp, "release-platform-manifests");

    try {
      await mkdir(platformManifestRoot, { recursive: true });
      await writeFile(
        join(platformManifestRoot, "mac_arm64.json"),
        `${JSON.stringify(
          {
        artifacts: {
          dmg: {
            url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/Hi Design Beta.dmg",
          },
        },
        channel: "beta",
        github: {
          commit: "previous-sha",
          runAttempt: 1,
          runId: 111111111,
        },
        legacyPlatformKey: "mac",
        platformKey: "mac_arm64",
        releaseTarget: "mac_arm64",
        r2: {
          versionPrefix: "beta/versions/1.2.3-beta.4.unsigned",
        },
        releaseVersion: "1.2.3-beta.4",
        signed: false,
        status: "published",
      },
          null,
          2,
        )}\n`,
      );
      const result = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", releasePublishMetadataScriptPath],
        {
          cwd: workspaceRoot,
          env: {
            ...process.env,
            BASE_VERSION: "1.2.3",
            ENABLE_LINUX_X64: "false",
            ENABLE_MAC_ARM64: "true",
            ENABLE_MAC_X64: "false",
            ENABLE_WIN_X64: "false",
            RELEASE_RUN_ATTEMPT: "2",
            RELEASE_RUN_ID: "222222222",
            RELEASE_COMMIT: "current-sha",
            MAC_ARM64_RESULT: "success",
            RELEASE_CHANNEL: "beta",
            RELEASE_MANIFEST_DIR: platformManifestRoot,
            RELEASE_METADATA_DIR: join(runnerTemp, "release-metadata"),
            RELEASE_OUTPUTS_PATH: join(runnerTemp, "release-metadata", "outputs.json"),
            RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai",
            RELEASE_SIGNED: "false",
            RELEASE_STORAGE_ACCESS_KEY_ID: "test-access-key",
            RELEASE_STORAGE_BUCKET: fixture.bucket,
            RELEASE_STORAGE_ENDPOINT: fixture.endpointUrl,
            RELEASE_STORAGE_REGION: "auto",
            RELEASE_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
            RELEASE_VERSION: "1.2.3-beta.4",
            STATE_SOURCE: "test",
          },
          maxBuffer: 1024 * 1024,
        },
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ reason, status: "rejected" as const }),
      );

      expect(result.status).toBe("rejected");
      expect(String(result.status === "rejected" ? result.reason : "")).toContain(
        "refusing stale mac_arm64 platform manifest for 1.2.3-beta.4: github.runId=111111111",
      );
      expect(fixture.uploadedObjectKeys()).toEqual([]);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("accepts same-run latest platform manifests from an older workflow attempt", async () => {
    const fixture = await startReleaseMetadataObjectStore({});
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-betas-metadata-"));
    const platformManifestRoot = join(runnerTemp, "release-platform-manifests");

    try {
      await mkdir(platformManifestRoot, { recursive: true });
      await writeFile(
        join(platformManifestRoot, "mac_arm64.json"),
        `${JSON.stringify(
          {
        artifacts: {
          dmg: {
            url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/Hi Design Beta.dmg",
          },
        },
        channel: "beta",
        github: {
          commit: "current-sha",
          runAttempt: 1,
          runId: 222222222,
        },
        legacyPlatformKey: "mac",
        platformKey: "mac_arm64",
        releaseTarget: "mac_arm64",
        r2: {
          versionPrefix: "beta/versions/1.2.3-beta.4.unsigned",
        },
        releaseVersion: "1.2.3-beta.4",
        signed: false,
        status: "published",
      },
          null,
          2,
        )}\n`,
      );
      await execFileAsync(process.execPath, ["--experimental-strip-types", releasePublishMetadataScriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          BASE_VERSION: "1.2.3",
          ENABLE_LINUX_X64: "false",
          ENABLE_MAC_ARM64: "true",
          ENABLE_MAC_X64: "false",
          ENABLE_WIN_X64: "false",
          RELEASE_RUN_ATTEMPT: "2",
          RELEASE_RUN_ID: "222222222",
          RELEASE_COMMIT: "current-sha",
          MAC_ARM64_RESULT: "success",
          RELEASE_CHANNEL: "beta",
          RELEASE_MANIFEST_DIR: platformManifestRoot,
          RELEASE_METADATA_DIR: join(runnerTemp, "release-metadata"),
          RELEASE_OUTPUTS_PATH: join(runnerTemp, "release-metadata", "outputs.json"),
          RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai",
          RELEASE_SIGNED: "false",
          RELEASE_STORAGE_ACCESS_KEY_ID: "test-access-key",
          RELEASE_STORAGE_BUCKET: fixture.bucket,
          RELEASE_STORAGE_ENDPOINT: fixture.endpointUrl,
          RELEASE_STORAGE_REGION: "auto",
          RELEASE_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
          RELEASE_VERSION: "1.2.3-beta.4",
          STATE_SOURCE: "test",
        },
        maxBuffer: 1024 * 1024,
      });

      expect(fixture.uploadedObjectKeys()).toEqual([
        "beta/versions/1.2.3-beta.4/metadata.json",
        "beta/latest/metadata.json",
        "beta/latest/platforms/mac_arm64.json",
      ]);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("resolves auto asset suffix from target-first win_x64 platform manifests in beta metadata publish", async () => {
    const fixture = await startReleaseMetadataObjectStore({
      "beta/versions/1.2.3-beta.4.unsigned/latest.yml": "versioned updater feed",
    });
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-betas-win-metadata-"));
    const platformManifestRoot = join(runnerTemp, "release-platform-manifests");

    try {
      await mkdir(platformManifestRoot, { recursive: true });
      await writeFile(
        join(platformManifestRoot, "win_x64.json"),
        `${JSON.stringify(
          {
            artifacts: {
              installer: {
                url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-win-x64-setup.exe",
              },
            },
            channel: "beta",
            github: {
              commit: "current-sha",
              runAttempt: 2,
              runId: 222222222,
            },
            legacyPlatformKey: "win",
            feed: {
              name: "latest.yml",
              url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/latest.yml",
            },
            platform: "win",
            platformKey: "win_x64",
            releaseTarget: "win_x64",
            releaseVersion: "1.2.3-beta.4",
            r2: {
              versionPrefix: "beta/versions/1.2.3-beta.4.unsigned",
            },
            signed: false,
            status: "published",
          },
          null,
          2,
        )}\n`,
      );

      await execFileAsync(process.execPath, ["--experimental-strip-types", releasePublishMetadataScriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          BASE_VERSION: "1.2.3",
          ENABLE_LINUX_X64: "false",
          ENABLE_MAC_ARM64: "false",
          ENABLE_MAC_X64: "false",
          ENABLE_WIN_X64: "true",
          RELEASE_RUN_ATTEMPT: "2",
          RELEASE_RUN_ID: "222222222",
          RELEASE_COMMIT: "current-sha",
          RELEASE_ASSET_SUFFIX: "auto",
          RELEASE_CHANNEL: "beta",
          RELEASE_MANIFEST_DIR: platformManifestRoot,
          RELEASE_METADATA_DIR: join(runnerTemp, "release-metadata"),
          RELEASE_OUTPUTS_PATH: join(runnerTemp, "release-metadata", "outputs.json"),
          RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai",
          RELEASE_SIGNED: "false",
          RELEASE_STORAGE_ACCESS_KEY_ID: "test-access-key",
          RELEASE_STORAGE_BUCKET: fixture.bucket,
          RELEASE_STORAGE_ENDPOINT: fixture.endpointUrl,
          RELEASE_STORAGE_REGION: "auto",
          RELEASE_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
          RELEASE_VERSION: "1.2.3-beta.4",
          STATE_SOURCE: "test",
          WIN_X64_RESULT: "success",
        },
        maxBuffer: 1024 * 1024,
      });

      const metadata = JSON.parse(await readFile(join(runnerTemp, "release-metadata", "metadata.json"), "utf8"));
      expect(metadata.assetVersionSuffix).toBe(".unsigned");
      expect(metadata.readyTargets).toEqual(["win_x64"]);
      expect(metadata.platforms.win.r2.versionPrefix).toBe("beta/versions/1.2.3-beta.4.unsigned");
      expect(metadata.releaseTargets.win_x64.r2.versionPrefix).toBe("beta/versions/1.2.3-beta.4.unsigned");
      expect(fixture.uploadedObjectKeys()).toEqual([
        "beta/versions/1.2.3-beta.4.unsigned/metadata.json",
        "beta/latest/metadata.json",
        "beta/latest/platforms/win_x64.json",
        "beta/latest/latest.yml",
      ]);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("preserves launcher payload artifacts in beta latest metadata and action outputs", async () => {
    const fixture = await startReleaseMetadataObjectStore({
      "beta/versions/1.2.3-beta.4.unsigned/latest.yml": "versioned updater feed",
    });
    const runnerTemp = await mkdtemp(join(tmpdir(), "od-release-betas-payload-metadata-"));
    const platformManifestRoot = join(runnerTemp, "release-platform-manifests");

    try {
      await mkdir(platformManifestRoot, { recursive: true });
      await writeFile(
        join(platformManifestRoot, "mac_arm64.json"),
        `${JSON.stringify(
          {
            artifacts: {
              dmg: {
                url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-mac-arm64.dmg",
              },
              payload: {
                sha256Url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-mac-arm64-payload.zip.sha256",
                url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-mac-arm64-payload.zip",
              },
            },
            channel: "beta",
            github: {
              commit: "current-sha",
              runAttempt: 2,
              runId: 222222222,
            },
            legacyPlatformKey: "mac",
            platform: "mac",
            platformKey: "mac_arm64",
            releaseTarget: "mac_arm64",
            releaseVersion: "1.2.3-beta.4",
            r2: {
              versionPrefix: "beta/versions/1.2.3-beta.4.unsigned",
            },
            signed: false,
            status: "published",
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(platformManifestRoot, "win_x64.json"),
        `${JSON.stringify(
          {
            artifacts: {
              installer: {
                url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-win-x64-setup.exe",
              },
              payload: {
                sha256Url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-win-x64-payload.7z.sha256",
                url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/open-design-1.2.3-beta.4.unsigned-win-x64-payload.7z",
              },
            },
            channel: "beta",
            feed: {
              name: "latest.yml",
              url: "https://releases.open-design.ai/betas/versions/1.2.3-beta.4.unsigned/latest.yml",
            },
            github: {
              commit: "current-sha",
              runAttempt: 2,
              runId: 222222222,
            },
            legacyPlatformKey: "win",
            platform: "win",
            platformKey: "win_x64",
            releaseTarget: "win_x64",
            releaseVersion: "1.2.3-beta.4",
            r2: {
              versionPrefix: "beta/versions/1.2.3-beta.4.unsigned",
            },
            signed: false,
            status: "published",
          },
          null,
          2,
        )}\n`,
      );

      await execFileAsync(process.execPath, ["--experimental-strip-types", releasePublishMetadataScriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          BASE_VERSION: "1.2.3",
          ENABLE_LINUX_X64: "false",
          ENABLE_MAC_ARM64: "true",
          ENABLE_MAC_X64: "false",
          ENABLE_WIN_X64: "true",
          RELEASE_RUN_ATTEMPT: "2",
          RELEASE_RUN_ID: "222222222",
          RELEASE_COMMIT: "current-sha",
          RELEASE_ASSET_SUFFIX: "auto",
          RELEASE_CHANNEL: "beta",
          RELEASE_MANIFEST_DIR: platformManifestRoot,
          RELEASE_METADATA_DIR: join(runnerTemp, "release-metadata"),
          RELEASE_OUTPUTS_PATH: join(runnerTemp, "release-metadata", "outputs.json"),
          RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai",
          RELEASE_SIGNED: "false",
          RELEASE_STORAGE_ACCESS_KEY_ID: "test-access-key",
          RELEASE_STORAGE_BUCKET: fixture.bucket,
          RELEASE_STORAGE_ENDPOINT: fixture.endpointUrl,
          RELEASE_STORAGE_REGION: "auto",
          RELEASE_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
          RELEASE_VERSION: "1.2.3-beta.4",
          STATE_SOURCE: "test",
          MAC_ARM64_RESULT: "success",
          WIN_X64_RESULT: "success",
        },
        maxBuffer: 1024 * 1024,
      });

      const metadata = JSON.parse(await readFile(join(runnerTemp, "release-metadata", "metadata.json"), "utf8")) as {
        platforms: {
          mac: { artifacts?: { payload?: { sha256Url?: string; url?: string } } };
          win: { artifacts?: { payload?: { sha256Url?: string; url?: string } } };
        };
        releaseTargets: {
          mac_arm64: { artifacts?: { payload?: { sha256Url?: string; url?: string } } };
          win_x64: { artifacts?: { payload?: { sha256Url?: string; url?: string } } };
        };
      };
      const outputs = JSON.parse(await readFile(join(runnerTemp, "release-metadata", "outputs.json"), "utf8")) as Record<string, string>;

      expect(metadata.platforms.mac.artifacts?.payload?.url).toContain("mac-arm64-payload.zip");
      expect(metadata.platforms.mac.artifacts?.payload?.sha256Url).toContain("mac-arm64-payload.zip.sha256");
      expect(metadata.platforms.win.artifacts?.payload?.url).toContain("win-x64-payload.7z");
      expect(metadata.platforms.win.artifacts?.payload?.sha256Url).toContain("win-x64-payload.7z.sha256");
      expect(metadata.releaseTargets.mac_arm64.artifacts?.payload?.url).toBe(metadata.platforms.mac.artifacts?.payload?.url);
      expect(metadata.releaseTargets.win_x64.artifacts?.payload?.url).toBe(metadata.platforms.win.artifacts?.payload?.url);
      expect(outputs.mac_arm64_payload_url).toBe(metadata.platforms.mac.artifacts?.payload?.url);
      expect(outputs.win_x64_payload_url).toBe(metadata.platforms.win.artifacts?.payload?.url);
      expect(fixture.uploadedObjectKeys()).toEqual([
        "beta/versions/1.2.3-beta.4.unsigned/metadata.json",
        "beta/latest/metadata.json",
        "beta/latest/platforms/mac_arm64.json",
        "beta/latest/platforms/win_x64.json",
        "beta/latest/latest.yml",
      ]);
    } finally {
      await fixture.close();
      await rm(runnerTemp, { force: true, recursive: true });
    }
  });

  it("resolves the generated Windows update fixture outside the measured build child scope", async () => {
    const winBuildScript = await readFile(releaseBetaWindowsBuildScriptPath, "utf8");

    expect(winBuildScript).toMatch(
      /Measure-Step "tools-pack win build update fixture" \{[\s\S]*?\r?\n    \}\r?\n    \$updateBuild = Get-Content -LiteralPath \$fixtureJsonPath -Raw \| ConvertFrom-Json\r?\n    \$localUpdateArtifactPath = \[string\]\$updateBuild\.installerPath/,
    );
    expect(winBuildScript).toContain('$env:OD_PACKAGED_E2E_WIN_UPDATE_FIXTURE = "tools-serve"');
    expect(winBuildScript).toContain("$env:OD_PACKAGED_E2E_WIN_UPDATE_ARTIFACT_PATH = $localUpdateArtifactPath");
  });
});

function expectChannelWorkflowNamespaces(
  workflow: string,
  channel: "beta" | "prerelease",
  options: { hasLinuxSmoke: boolean },
): void {
  const namespace = `release-${channel}`;
  expect(workflow).toContain(`--namespace ${namespace}`);
  expect(workflow).toContain(`OD_PACKAGED_E2E_NAMESPACE: ${namespace}`);
  expect(workflow).toContain(`--namespace ${namespace}-intel`);
  expect(workflow).toContain(`"--namespace", "${namespace}-win",`);
  expect(workflow).toContain(`OD_PACKAGED_E2E_NAMESPACE: ${namespace}-win`);
  expect(workflow).toContain(`--namespace ${namespace}-linux`);

  if (options.hasLinuxSmoke) {
    expect(workflow).toContain(`OD_PACKAGED_E2E_NAMESPACE: ${namespace}-linux`);
  }
}

function expectWindowsUpdaterSmokeContract(workflow: string, channel: "beta" | "preview" | "prerelease" | "stable"): void {
  expect(workflow).toContain("win_x64_smoke_mode:");
  expect(workflow).toContain("win_x64_update_metadata_url:");
  expect(workflow).toContain("win_x64_update_target_version:");
  expect(workflow).toMatch(/win_x64_smoke_mode:[\s\S]*?options:[\s\S]*?- skip[\s\S]*?- core[\s\S]*?- full[\s\S]*?default: core/);
  expect(workflow).toContain("OD_PACKAGED_E2E_WIN_SMOKE_PROFILE: ${{ inputs.win_x64_smoke_mode }}");
  expect(workflow).toContain("OD_PACKAGED_E2E_WIN_UPDATE_FIXTURE: ${{ inputs.win_x64_smoke_mode == 'full' && inputs.win_x64_update_metadata_url == '' && inputs.win_x64_update_target_version == '' && 'tools-serve' || '' }}");
  expect(workflow).toContain("OD_PACKAGED_E2E_WIN_UPDATE_METADATA_URL: ${{ inputs.win_x64_update_metadata_url }}");
  expect(workflow).toContain("OD_PACKAGED_E2E_WIN_UPDATE_VERSION: ${{ inputs.win_x64_update_target_version }}");
  if (channel === "stable") {
    expect(workflow).toContain("Build stable win_x64 update fixture");
    expect(workflow).toContain('full Windows stable smoke requires stable version x.y.z');
    expect(workflow).toContain('pnpm.cmd exec tools-pack win cleanup --dir $toolsPackDir --namespace "${{ needs.metadata.outputs.win_namespace }}" --json');
    expect(workflow).toContain("--cache-dir $cacheDir `");
    expect(workflow).toContain('pnpm.cmd exec tools-pack win validate-payload --namespace "${{ needs.metadata.outputs.win_namespace }}" --payload-path $build.payloadPath --expected-version "${{ needs.metadata.outputs.release_version }}" --json');
  } else {
    expect(workflow).toContain(`Build ${channel} win_x64 update fixture`);
    expect(workflow).toContain(`full Windows smoke requires a counted ${channel} version`);
  }
  expect(workflow).not.toContain("OD_PACKAGED_E2E_WIN_SMOKE_PROFILE: core");
}

function expectCountedReleaseWorkflowCallContract(workflow: string, channel: "preview" | "prerelease"): void {
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("workflow_call:");
  expect(workflow).toContain("ref:");
  expect(workflow).toContain("release_version:");
  expect(workflow).toContain("description: \"Optional git ref to build.");
  expect(workflow).toContain("ref: ${{ inputs.ref != '' && inputs.ref || github.ref }}");
  expect(workflow).toContain("Resolve built commit");
  expect(workflow).toContain("GITHUB_SHA: ${{ env.BUILT_SHA }}");
  expect(workflow).toContain("GITHUB_REF_NAME: ${{ inputs.ref != '' && inputs.ref || github.ref_name }}");
  expect(workflow).toContain(`Capture previous ${channel} commit`);
  expect(workflow).toContain("previous_commit: ${{ steps.prev.outputs.previous_commit }}");
  expect(workflow).toContain("version_metadata_url:");
  expect(workflow).toContain("mac_arm64_url:");
  expect(workflow).toContain("mac_intel_url:");
  expect(workflow).toContain("win_url:");
  expect(workflow).toContain("linux_url:");
  expect(workflow).toContain("GITHUB_SHA: ${{ needs.metadata.outputs.commit }}");
  expect(workflow).toContain("version_metadata_url: ${{ steps.outputs.outputs.version_metadata_url }}");
  expect(workflow).toContain("mac_arm64_url: ${{ steps.outputs.outputs.mac_arm64_dmg_url }}");
  expect(workflow).toContain("mac_intel_url: ${{ steps.outputs.outputs.mac_x64_dmg_url }}");
  expect(workflow).toContain("win_url: ${{ steps.outputs.outputs.win_x64_installer_url }}");
  expect(workflow).toContain("linux_url: ${{ steps.outputs.outputs.linux_x64_appImage_url }}");
}

async function startStablePrereleaseMetadataServer(objects: Record<string, unknown>): Promise<{
  close: () => Promise<void>;
  origin: string;
}> {
  const server = createHttpsServer(
    {
      cert: stablePrereleaseMetadataCert,
      key: stablePrereleaseMetadataKey,
    },
    (request, response) => {
      const objectKey = decodeURIComponent(new URL(request.url ?? "/", "https://127.0.0.1").pathname.replace(/^\/+/, ""));
      if (request.method !== "GET" || !(objectKey in objects)) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(objects[objectKey]));
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("stable prerelease metadata server did not bind to a TCP port");
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)));
      }),
    origin: `https://127.0.0.1:${address.port}`,
  };
}

function stablePrereleaseMetadataFixture(baseVersion: string, prereleaseVersion: string, publicOrigin: string): Record<string, unknown> {
  const versionPrefix = `prerelease/versions/${prereleaseVersion}`;
  const versionUrl = `${publicOrigin}/${versionPrefix}`;
  const artifact = (name: string) => ({
    sha256Url: `${versionUrl}/${name}.sha256`,
    url: `${versionUrl}/${name}`,
  });

  return {
    baseVersion,
    channel: "prerelease",
    github: {
      branch: `release/v${baseVersion}`,
      commit: "0123456789abcdef0123456789abcdef01234567",
      repository: "nexu-io/open-design",
      workflow: "release-prerelease",
    },
    prereleaseNumber: 12,
    prereleaseVersion,
    platforms: {
      mac: {
        arch: "arm64",
        artifacts: {
          dmg: artifact("Hi Design.dmg"),
          zip: artifact("Hi Design-mac-arm64.zip"),
        },
        enabled: true,
        signed: true,
      },
      macIntel: {
        arch: "x64",
        artifacts: {
          dmg: artifact("Hi Design Intel.dmg"),
          zip: artifact("Hi Design-mac-x64.zip"),
        },
        enabled: true,
        signed: true,
      },
      win: {
        arch: "x64",
        artifacts: {
          installer: artifact("Hi Design Setup.exe"),
        },
        enabled: true,
      },
    },
    r2: {
      report: {
        type: "zip",
        url: `${versionUrl}/report.zip`,
      },
      reportZipUrl: `${versionUrl}/report.zip`,
      versionMetadataUrl: `${versionUrl}/metadata.json`,
      versionPrefix,
    },
    releaseVersion: prereleaseVersion,
    signed: true,
  };
}

async function startReleaseMetadataObjectStore(objects: Record<string, unknown>): Promise<{
  bucket: string;
  close: () => Promise<void>;
  endpointUrl: string;
  uploadedObjectKeys: () => string[];
}> {
  const bucket = "release-bucket";
  const uploadedObjectKeys: string[] = [];
  const server = createServer((request, response) => {
    void handleReleaseMetadataObjectStoreRequest(request, response, bucket, objects, uploadedObjectKeys);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("release metadata object store did not bind to a TCP port");
  }

  return {
    bucket,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)));
      }),
    endpointUrl: `http://127.0.0.1:${address.port}`,
    uploadedObjectKeys: () => [...uploadedObjectKeys],
  };
}

async function handleReleaseMetadataObjectStoreRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bucket: string,
  objects: Record<string, unknown>,
  uploadedObjectKeys: string[],
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const bucketPrefix = `/${bucket}/`;
  if (!path.startsWith(bucketPrefix)) {
    response.statusCode = 404;
    response.end("not found");
    return;
  }

  const objectKey = decodeURIComponent(path.slice(bucketPrefix.length));
  if (request.method === "GET") {
    if (!(objectKey in objects)) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    const body = JSON.stringify(objects[objectKey]);
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(body);
    return;
  }

  if (request.method === "PUT") {
    uploadedObjectKeys.push(objectKey);
    for await (const _chunk of request) {
      // Drain the request body so the client can complete cleanly.
    }
    response.statusCode = 200;
    response.end("ok");
    return;
  }

  response.statusCode = 405;
  response.end("method not allowed");
}

const stablePrereleaseMetadataKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC1hoV1GwxqTYdO
Zs0pY5hnp8BtTwdF6dWsXoFWYw9IPpBTmyNeleRcLtrht/oc5oRS05tC97qmb5eL
RigyXUmwrpt/VjJ7ursDa3qGnljkqVxqBkRAUdXBMCVPkMogKWvJy/S61Vthvf7K
K5HhofwcuPPvRBdhdZgtw/7nZY49HYutd7wP/U7iqCYBMpWr0I29jSs1S2xY9fH8
ih/exDGe3PHm8yQao4pHUUFVXoAI5w6tYsmNep6b+5NYPHnHSaXd7h5gaF+nIJE4
78jgRQHKjQ2iNf/53/o/d5SAMb/9lZ7stNT8RIFOJUz1IP8Zsz3VKwAvXKXZDObr
0MS4JrPdAgMBAAECggEATcF0HD/8VvKjsU0ut3pud4QvVINEGcn6mY2XuFHRY4BN
IUr0YRkyytvVLVe5vrRtXO9Ac/Sakp19XA6uvDgijxiUCfz5ve80GVhqEQz2BeiX
6eCKTsTfG5QMf2MFebZUcgm36Gno7VrNr3rvT6erzv/YmZZgr4IIMB5i62qgfYOY
ABSg6b223RSVeZXNvWxovKycBUUa26lrzRu5jpuexjAccmgbiE86exhzW7FK2zjZ
XH8rOxSDJ49+ipPOGsJ+rZMdtvHq6BO/QU4O9IkBLNuHAIbr/WcjBgnAPskQTrOM
i3vWqPNVw3tPjBWCOtzy0UllG0L5Sxnx5cceFvL9HwKBgQDieIaM89In+VETI+x4
aUmQXxVcisZR0FWQytl+XbWe4T1zxEj4fFjd/phgv0M60599/mwCCGrImxKM8cnb
mjxv2FX+or9+2IFpaSOi+Qj6/IxcTTWoMU0t4AQjOgbRf3iBpVz6JysnKKpqqukT
GGOnzGWz0gFmDAqKm0zkGy7czwKBgQDNMb6hrSGobMRlCndgx//w/SdDq/IqAbIS
QyAvYgNuOXV3J4sD2Z1TwYxZM2Oq5rhOPfZr8SnqM7d+LknLPiGMKV7z6vL/BOu8
ZB5+EmMZwqNmSOMaFZM+77OC/zxDCznqTm4N5vDdg+6SByCtuyCm+Jraj0PtHtkD
krdWqBfHkwKBgDpTzluZJGQ1OyNR2kJ843xycL7/4uoJXTBIflGkcvVzj280e5K7
++tY+gfY2sjY3jgGAe1YG6CFB/cTAukzRSONNUC6y9Uwj8wFTy9XMm/qAYB4RjyG
Thllm8sy07S7Pt8tJtAqrFuOhq2oTRUk7+20n/D7Qm705PYj317UfXJTAoGABdYM
XfzWoDu3ukf57T7DAM+ydjJFyPwTXIGcQLzA7DmmJaVyRsHBv8gZfdAAXbQCOfd5
MsjBMHAYH/ahEq7JtXrXwIhGMQqqycjvNRbAytLGYvpfuzYx4fBfYrJvvFhtZUSl
zK9s2mAOQQkC3O4dl6IqhVzdybi+42Mg484UHxECgYEAht1ef0Gc6RKZpmqttlZJ
1G4lsR1Aws3dintACs8lza5aaufrY07gF8z3rkW6tPGEWfol3CYOT2U5UiUw+iKG
F/Pa3L5wCxuRKKWx0ip0PFhDPrpWfVCm2CLlUlZLEjpmF2iUZgmkaScjYqG8R16a
C8cywTs1ku5aYIaN8YcAigI=
-----END PRIVATE KEY-----`;

const stablePrereleaseMetadataCert = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUbNGmwcWmZP5tw6gm8s2RXzWJv+IwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDYwODA0MDczNVoXDTI2MDYw
OTA0MDczNVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAtYaFdRsMak2HTmbNKWOYZ6fAbU8HRenVrF6BVmMPSD6Q
U5sjXpXkXC7a4bf6HOaEUtObQve6pm+Xi0YoMl1JsK6bf1Yye7q7A2t6hp5Y5Klc
agZEQFHVwTAlT5DKIClrycv0utVbYb3+yiuR4aH8HLjz70QXYXWYLcP+52WOPR2L
rXe8D/1O4qgmATKVq9CNvY0rNUtsWPXx/Iof3sQxntzx5vMkGqOKR1FBVV6ACOcO
rWLJjXqem/uTWDx5x0ml3e4eYGhfpyCROO/I4EUByo0NojX/+d/6P3eUgDG//ZWe
7LTU/ESBTiVM9SD/GbM91SsAL1yl2Qzm69DEuCaz3QIDAQABo1MwUTAdBgNVHQ4E
FgQU8Z0Oy/q8fAqp9005cn2sW4K6oB4wHwYDVR0jBBgwFoAU8Z0Oy/q8fAqp9005
cn2sW4K6oB4wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAlJTb
7zi4FKJqYuXZ9YWmV96Ri+vBcNfO2dwKBxFtJXm0Ai2Q4ruutuFPYwY6UYGTN5gC
HJ0/WxuPK5ftAE6UU+Mghu0dJlH+gWmOq5cDyhYdnEi8R6z5AsPtPEYlkkIvhUO1
k1BtCP0h4Kh8fuaILGuXQNOaKizIWF2lEEHfCmvKhgOF6dKWs38zdetFQCLRIaHg
ZyGlUhPCUbKdTiBJuCGaDKzeEAlC8dsar2zjg9CVue7w3CaamQpjnV0d2IHJiVAH
QONQvdtLnZ6GeNPe06oBrq7R9SL5/tkqgSq8lCrDE6jFZnfXNMdDmZY3wTcFcdyG
yW/DsIUs5ZzcHza5rw==
-----END CERTIFICATE-----`;
