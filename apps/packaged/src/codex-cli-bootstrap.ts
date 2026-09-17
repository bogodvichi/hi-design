import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const CODEX_INSTALL_TIMEOUT_MS = 120_000;

export type CodexCliBootstrapResult =
  | { status: "already-installed"; path: string }
  | { status: "installed"; path: string }
  | { status: "skipped-no-codex-app" }
  | { status: "install-failed"; detail: string };

type CodexCliBootstrapOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  runInstaller?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
  pathExists?: (candidate: string, executable?: boolean) => Promise<boolean>;
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
  const dirs = [
    ...(env.PATH ?? env.Path ?? "").split(delimiter),
    codexStandaloneBinDir(platform, home, env),
  ];
  for (const dir of [...new Set(dirs.filter(Boolean))]) {
    for (const name of names) {
      const candidate = api.join(dir, name);
      if (await pathExists(candidate, true)) return candidate;
    }
  }
  return null;
}

async function hasCodexDesktopInstall(
  platform: NodeJS.Platform,
  home: string,
  pathExists: NonNullable<CodexCliBootstrapOptions["pathExists"]>,
): Promise<boolean> {
  const api = pathApi(platform);
  // Codex desktop and the CLI share this signed-in state. Using auth.json
  // instead of the directory itself avoids treating an empty ~/.codex folder
  // created by another integration as proof that Codex is installed.
  const candidates = [api.join(home, ".codex", "auth.json")];
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex",
      api.join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    );
  }
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true;
  }
  return false;
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
  const existing = await resolveStandaloneCodex(env, platform, home, pathExists);
  if (existing) return { status: "already-installed", path: existing };
  if (!(await hasCodexDesktopInstall(platform, home, pathExists))) {
    return { status: "skipped-no-codex-app" };
  }

  const { command, args } = installerCommand(platform);
  try {
    await (options.runInstaller ?? defaultRunInstaller)(command, args, {
      ...env,
      CODEX_NON_INTERACTIVE: "1",
    });
    const installed = await resolveStandaloneCodex(env, platform, home, pathExists);
    if (installed) return { status: "installed", path: installed };
    return { status: "install-failed", detail: "installer completed but the codex command was not found" };
  } catch (error) {
    return {
      status: "install-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
