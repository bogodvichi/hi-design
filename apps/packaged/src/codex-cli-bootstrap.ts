import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { mergeProxyAwareEnv } from "@open-design/platform";

// Give enterprise networks time to download, verify, and extract the official package.
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

function hasHttpsProxy(env: NodeJS.ProcessEnv): boolean {
  return [env.HTTPS_PROXY, env.https_proxy, env.ALL_PROXY, env.all_proxy]
    .some((value) => Boolean(value?.trim()));
}

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
    resolveProxy?: (url: string) => Promise<string>;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const platform = options.platform ?? process.platform;
  if (hasHttpsProxy(baseEnv)) return baseEnv;

  let resolvedEnv = baseEnv;
  const shell = baseEnv.SHELL?.trim() || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  if (platform !== "win32") try {
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
    resolvedEnv = mergeProxyAwareEnv(platform, baseEnv, shellProxyEnv);
  } catch {
    // An empty or broken shell must not prevent system PAC discovery.
  }
  if (hasHttpsProxy(resolvedEnv) || !options.resolveProxy) return resolvedEnv;

  // Chromium evaluates the OS PAC/WPAD configuration for the official Codex
  // distribution host. curl and installer subprocesses cannot evaluate PAC.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      options.resolveProxy(CODEX_LATEST_RELEASE_URL),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve("DIRECT"), CODEX_VERSION_CHECK_TIMEOUT_MS); }),
    ]);
    const [kind, address] = result.split(";", 1)[0].trim().split(/\s+/);
    const schemes: Record<string, string> = { PROXY: "http", HTTPS: "https", SOCKS: "socks4a", SOCKS4: "socks4a", SOCKS5: "socks5h" };
    const scheme = schemes[kind];
    if (!scheme || !address) return resolvedEnv;
    const proxy = new URL(`${scheme}://${address}`);
    if (!proxy.hostname || proxy.username || proxy.password || (proxy.pathname && proxy.pathname !== "/") || proxy.search || proxy.hash) return resolvedEnv;
    const endpoint = `${scheme}://${proxy.host}`;
    return mergeProxyAwareEnv(platform, resolvedEnv, scheme.startsWith("socks")
      ? { ALL_PROXY: endpoint }
      : { HTTPS_PROXY: endpoint });
  } catch {
    return resolvedEnv;
  } finally {
    clearTimeout(timer);
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

/** Keep actionable installer failures in logs without retaining proxy credentials. */
export function formatCodexCliBootstrapLog(result: CodexCliBootstrapResult, env: NodeJS.ProcessEnv): string {
  const prefix = `[open-design packaged] Codex CLI background check status=${result.status}`;
  if (!("detail" in result)) return prefix;
  let detail = result.detail;
  for (const [key, value] of Object.entries(env)) {
    if (/^(?:https?|all)_proxy$/i.test(key) && value) detail = detail.replaceAll(value, "[proxy]");
  }
  detail = detail.replace(/(?:https?|socks[\w]*):\/\/[^\s"'<>]+/gi, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch { return "[url]"; }
  }).replace(/[\r\n\t]+/g, " ").slice(0, 1500);
  return `${prefix} detail=${detail}`;
}

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
  const failures: string[] = [];
  for (const url of [CODEX_LATEST_RELEASE_URL, CODEX_GITHUB_RELEASE_URL]) {
    try {
      const output = platform === "win32"
        ? await captureCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec 8).Content`], env, CODEX_VERSION_CHECK_TIMEOUT_MS)
        : await captureCommand("curl", ["-fsSL", "--connect-timeout", "3", "--max-time", "8", url], env, CODEX_VERSION_CHECK_TIMEOUT_MS);
      const metadata = JSON.parse(output) as { tag_name?: unknown };
      if (typeof metadata.tag_name !== "string") throw new Error("release metadata missing tag_name");
      return parseVersion(metadata.tag_name);
    } catch (error) {
      failures.push(`${new URL(url).hostname}: ${error instanceof Error ? error.message : String(error)}`);
      // Mirror the official installer: fall back to GitHub if the release feed is unavailable.
    }
  }
  throw new Error(`could not check latest Codex release; ${failures.join("; ")}`);
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
    args: ["-s"],
  };
}

async function defaultRunInstaller(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let script: string | undefined;
  if (command === "/bin/sh") {
    const officialScript = await captureCommand("curl", [
      "-fsSL", "--connect-timeout", "10", "--max-time", "30", "https://chatgpt.com/codex/install.sh",
    ], env, 30_000);
    // Keep the official source selection and integrity checks. Its fixed
    // 300s CDN transfer limit is too short on enterprise connections; only
    // asset downloads get the larger budget inside our overall 45m limit.
    const assetTimeout = Math.floor(CODEX_INSTALL_TIMEOUT_MS / 1000) - 300;
    script = `curl() {
  for od_codex_arg do
    case "$od_codex_arg" in
      https://releases.openai.com/codex/releases/*/*)
        command curl "$@" --max-time ${assetTimeout}
        return ;;
    esac
  done
  command curl "$@"
}
${officialScript}`;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: [script ? "pipe" : "ignore", "ignore", "pipe"],
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
    if (script) {
      child.stdin?.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin?.end(script);
    }
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
