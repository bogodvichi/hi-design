import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { mergeProxyAwareEnv } from "@open-design/platform";

// GitHub Releases is selected below to avoid the official release CDN's
// hardcoded 300-second asset download limit. Give slower enterprise networks
// enough time to download, verify, and extract the official package.
// Installation remains background-only and never delays desktop startup.
const CODEX_INSTALL_TIMEOUT_MS = 45 * 60 * 1000;
const CODEX_VERSION_CHECK_TIMEOUT_MS = 8_000;
const CODEX_LOCAL_VERSION_TIMEOUT_MS = 5_000;
const CODEX_PROXY_LOGIN_SHELL_TIMEOUT_MS = 8_000;
const CODEX_CHECK_AFTER_READY_DELAY_MS = 5_000;
const CODEX_LATEST_RELEASE_URL = "https://releases.openai.com/codex/channels/latest";
const CODEX_GITHUB_RELEASE_URL = "https://api.github.com/repos/openai/codex/releases/latest";

const CODEX_PROXY_ENV_KEYS = new Set([
  "all_proxy", "http_proxy", "https_proxy", "no_proxy", "node_use_env_proxy",
]);

/**
 * The packaged startup's synchronous (2s) login-shell probe can miss
 * company proxy exports when zsh initialization takes longer. The CLI
 * updater runs after the UI is ready, so retry that probe asynchronously
 * here without delaying rendering or introducing a periodic refresh.
 */
export async function resolveCodexCliUpdaterEnv(
  baseEnv: NodeJS.ProcessEnv,
  options: {
    platform?: NodeJS.Platform;
    readLoginShell?: (shell: string, env: NodeJS.ProcessEnv) => Promise<string>;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32" || [
    baseEnv.HTTPS_PROXY, baseEnv.https_proxy, baseEnv.ALL_PROXY, baseEnv.all_proxy,
  ].some((value) => Boolean(value?.trim()))) {
    return baseEnv;
  }

  const shell = baseEnv.SHELL?.trim() || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  try {
    const stdout = await (options.readLoginShell ?? ((command, env) =>
      new Promise<string>((resolve, reject) => {
        execFile(command, ["-ilc", "command env"], {
          encoding: "utf8",
          env,
          timeout: CODEX_PROXY_LOGIN_SHELL_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        }, (error, output) => error ? reject(error) : resolve(output));
      })))(shell, baseEnv);
    const shellProxyEnv: NodeJS.ProcessEnv = {};
    for (const line of stdout.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator);
      if (CODEX_PROXY_ENV_KEYS.has(key.toLowerCase())) {
        shellProxyEnv[key] = line.slice(separator + 1);
      }
    }
    return mergeProxyAwareEnv(platform, baseEnv, shellProxyEnv);
  } catch {
    // Do not change the CLI installer environment on timeout or shell errors.
    return baseEnv;
  }
}

/**
 * Perform a single best-effort CLI check only after the packaged UI is ready.
 * Never block startup or schedule recurring checks for long-lived desktops.
 * Closing the desktop cancels the pending timer; an already-started check
 * completes independently of the UI lifecycle.
 */
export function scheduleCodexCliCheckAfterStartup(
  check: () => Promise<void>,
  delayMs = CODEX_CHECK_AFTER_READY_DELAY_MS,
): () => void {
  const timer = setTimeout(() => {
    void Promise.resolve().then(check).catch((error: unknown) => {
      console.warn("[open-design packaged] background Codex CLI check failed", error);
    });
  }, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

export type CodexCliBootstrapResult =
  | { status: "already-installed"; path: string }
  | { status: "installed"; path: string }
  | { status: "updated"; path: string; fromVersion: string | null; toVersion: string }
  | { status: "version-check-failed"; path: string; detail: string }
  | { status: "update-failed"; path: string; detail: string }
  | { status: "install-failed"; detail: string };

type CodexCliBootstrapOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  runInstaller?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
  pathExists?: (candidate: string, executable?: boolean) => Promise<boolean>;
  getInstalledVersion?: (binary: string, env: NodeJS.ProcessEnv) => Promise<string>;
  getLatestVersion?: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => Promise<string>;
};

async function defaultPathExists(candidate: string, executable = false): Promise<boolean> {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    await access(candidate, executable && process.platform !== "win32" ? constants.X_OK : constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathApi(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

export function codexStandaloneBinDir(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.win32.join(home, "AppData", "Local");
    return path.win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin");
  }
  return path.posix.join(home, ".local", "bin");
}

async function resolveStandaloneCodex(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  pathExists: NonNullable<CodexCliBootstrapOptions["pathExists"]>,
): Promise<string | null> {
  const api = pathApi(platform);
  const configured = env.CODEX_BIN?.trim();
  if (configured && api.isAbsolute(configured) && await pathExists(configured, true)) {
    return configured;
  }
  const delimiter = platform === "win32" ? ";" : ":";
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
  const dirs = [codexStandaloneBinDir(platform, home, env), ...(env.PATH ?? env.Path ?? "").split(delimiter)];
  for (const dir of [...new Set(dirs.filter(Boolean))]) {
    for (const name of names) {
      const candidate = api.join(dir, name);
      if (await pathExists(candidate, true)) return candidate;
    }
  }
  return null;
}

async function resolveOfficialInstalledCodex(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  pathExists: NonNullable<CodexCliBootstrapOptions["pathExists"]>,
): Promise<string | null> {
  const api = pathApi(platform);
  const binDir = codexStandaloneBinDir(platform, home, env);
  for (const name of platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"]) {
    const candidate = api.join(binDir, name);
    if (await pathExists(candidate, true)) return candidate;
  }
  return null;
}

function parseVersion(raw: string): string {
  const match = raw.match(/(?:^|[^\d])(\d+\.\d+\.\d+(?:-[\w.]+)?)(?!\d)/);
  if (!match) throw new Error(`invalid Codex version: ${raw.slice(0, 100)}`);
  return match[1];
}

function compareVersions(left: string, right: string): number {
  const [leftMain, leftPre] = left.split("-", 2);
  const [rightMain, rightPre] = right.split("-", 2);
  const a = leftMain.split(".").map(Number);
  const b = rightMain.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  return leftPre.localeCompare(rightPre, "en", { numeric: true });
}

async function captureCommand(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1_048_576) {
        child.kill();
        finish(new Error("Codex version metadata too large"));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-1024); });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Codex version check timed out"));
    }, timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `exit code ${code}`)));
  });
}

async function defaultLatestVersion(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string> {
  for (const url of [CODEX_LATEST_RELEASE_URL, CODEX_GITHUB_RELEASE_URL]) {
    try {
      const output = platform === "win32"
        ? await captureCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec 8).Content`], env, CODEX_VERSION_CHECK_TIMEOUT_MS)
        : await captureCommand("curl", ["-fsSL", "--connect-timeout", "3", "--max-time", "8", url], env, CODEX_VERSION_CHECK_TIMEOUT_MS);
      const metadata = JSON.parse(output) as { tag_name?: unknown };
      if (typeof metadata.tag_name !== "string") throw new Error("release metadata missing tag_name");
      return parseVersion(metadata.tag_name);
    } catch {
      // Mirror the official installer: fall back to GitHub if the release feed is unavailable.
    }
  }
  throw new Error("could not check latest Codex release (network or release metadata unavailable)");
}

function installerCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://chatgpt.com/codex/install.ps1 | iex",
      ],
    };
  }
  return {
    command: "/bin/sh",
    args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
  };
}

async function defaultRunInstaller(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4096);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex CLI installer timed out"));
    }, CODEX_INSTALL_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Codex CLI installer exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function ensureCodexCliForInstalledCodex(
  options: CodexCliBootstrapOptions = {},
): Promise<CodexCliBootstrapResult> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  const getInstalledVersion = (binary: string) =>
    (options.getInstalledVersion ?? ((executable, childEnv) =>
      captureCommand(executable, ["--version"], childEnv, CODEX_LOCAL_VERSION_TIMEOUT_MS)))(binary, env).then(parseVersion);
  let existing = await resolveStandaloneCodex(env, platform, home, pathExists);
  // A stale explicit CODEX_BIN may coexist with the newer official install
  // selected during the previous startup. Prefer that newer binary so we
  // don't download it again on every subsequent launch.
  if (existing && existing === env.CODEX_BIN?.trim()) {
    const official = await resolveOfficialInstalledCodex(env, platform, home, pathExists);
    if (official && official !== existing) {
      const [requested, standalone] = await Promise.allSettled([
        getInstalledVersion(existing), getInstalledVersion(official),
      ]);
      if (standalone.status === "fulfilled" &&
          (requested.status === "rejected" || compareVersions(standalone.value, requested.value) > 0)) {
        existing = official;
      }
    }
  }
  let latestVersion: string | null = null;
  let installedVersion: string | null = null;
  if (existing) {
    try {
      [latestVersion, installedVersion] = await Promise.all([
        (options.getLatestVersion ?? defaultLatestVersion)(env, platform).then(parseVersion),
        getInstalledVersion(existing).catch(() => null),
      ]);
    } catch (error) {
      return { status: "version-check-failed", path: existing, detail: String(error) };
    }
    if (installedVersion && compareVersions(installedVersion, latestVersion) >= 0) {
      return { status: "already-installed", path: existing };
    }
  }

  const { command, args } = installerCommand(platform);
  try {
    await (options.runInstaller ?? defaultRunInstaller)(command, args, {
      ...env,
      CODEX_NON_INTERACTIVE: "1",
      // The official install scripts support this switch; keep their own
      // release metadata and integrity verification instead of forking them.
      CODEX_INSTALLER_USE_RELEASES_OPENAI_COM: "0",
    });
    // The official installer writes to ~/.local/bin (or LOCALAPPDATA on Windows).
    // Do not rediscover the stale PATH/CODEX_BIN binary after updating it.
    const installed = await resolveOfficialInstalledCodex(env, platform, home, pathExists);
    if (!installed) throw new Error("official installer completed but its Codex CLI was not found");
    if (latestVersion) {
      const after = await getInstalledVersion(installed);
      if (compareVersions(after, latestVersion) < 0) throw new Error(`CLI is still ${after}, latest is ${latestVersion}`);
      return { status: "updated", path: installed, fromVersion: installedVersion, toVersion: after };
    }
    return { status: "installed", path: installed };
  } catch (error) {
    return {
      status: existing ? "update-failed" : "install-failed",
      ...(existing ? { path: existing } : {}),
      detail: error instanceof Error ? error.message : String(error),
    } as CodexCliBootstrapResult;
  }
}
