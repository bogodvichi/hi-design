import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  codexStandaloneBinDir,
  ensureCodexCliForInstalledCodex,
  resolveCodexCliUpdaterEnv,
  scheduleCodexCliCheckAfterStartup,
} from "../src/codex-cli-bootstrap.js";

describe("resolveCodexCliUpdaterEnv", () => {
  it("waits asynchronously for a slow login shell and forwards only normalized proxy keys", async () => {
    vi.useFakeTimers();
    try {
      const readLoginShell = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3_750));
        return "HTTPS_PROXY=http://proxy.example:8080\nNO_PROXY=.example\nTOKEN=not-a-proxy\n";
      });
      const baseEnv = { PATH: "/usr/bin", SHELL: "/bin/zsh" };
      const promise = resolveCodexCliUpdaterEnv(baseEnv, { platform: "darwin", readLoginShell });
      await vi.advanceTimersByTimeAsync(3_749);
      expect(readLoginShell).toHaveBeenCalledWith("/bin/zsh", baseEnv);
      await vi.advanceTimersByTimeAsync(1);
      const updatedEnv = await promise;
      expect(updatedEnv).toMatchObject({
        PATH: "/usr/bin",
        HTTPS_PROXY: "http://proxy.example:8080",
        https_proxy: "http://proxy.example:8080",
      });
      expect(updatedEnv.NO_PROXY).toContain(".example");
      expect(updatedEnv.TOKEN).toBeUndefined();
      expect("HTTPS_PROXY" in baseEnv).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-read login shell when an HTTPS proxy is already configured", async () => {
    const readLoginShell = vi.fn();
    const env = { HTTPS_PROXY: "http://proxy.example:8080" };
    expect(await resolveCodexCliUpdaterEnv(env, { platform: "darwin", readLoginShell })).toBe(env);
    expect(readLoginShell).not.toHaveBeenCalled();
  });

  it("keeps existing environment if shell proxy discovery fails", async () => {
    const env = { PATH: "/usr/bin", SHELL: "/bin/zsh" };
    const result = await resolveCodexCliUpdaterEnv(env, {
      platform: "darwin",
      readLoginShell: async () => { throw new Error("login shell timeout"); },
    });
    expect(result).toBe(env);
  });

  it("does not try POSIX login shell on Windows", async () => {
    const readLoginShell = vi.fn();
    const env = { PATH: "C:\\Windows\\System32" };
    expect(await resolveCodexCliUpdaterEnv(env, { platform: "win32", readLoginShell })).toBe(env);
    expect(readLoginShell).not.toHaveBeenCalled();
  });
});

describe("scheduleCodexCliCheckAfterStartup", () => {
  it("defers the CLI check, does not await its completion, and never checks periodically", async () => {
    vi.useFakeTimers();
    try {
      let finishCheck: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => { finishCheck = resolve; });
      const check = vi.fn(() => pending);
      const cancel = scheduleCodexCliCheckAfterStartup(check);

      expect(check).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(check).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledOnce();

      // A design session may remain open for days: there must be no interval.
      await vi.advanceTimersByTimeAsync(72 * 60 * 60 * 1_000);
      expect(check).toHaveBeenCalledOnce();
      finishCheck?.();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the pending check when the client closes before it begins", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(async () => undefined);
      scheduleCodexCliCheckAfterStartup(check)();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(check).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps background check failures from becoming unhandled rejections", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      scheduleCodexCliCheckAfterStartup(async () => { throw new Error("offline"); }, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(warning).toHaveBeenCalledWith(
        "[open-design packaged] background Codex CLI check failed", expect.any(Error),
      );
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("ensureCodexCliForInstalledCodex", () => {
  it("does not install again when the existing CLI matches the official latest release", async () => {
    const runInstaller = vi.fn();
    const result = await ensureCodexCliForInstalledCodex({
      env: { PATH: "/custom/bin:/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/custom/bin/codex",
      runInstaller,
      getInstalledVersion: async () => "codex-cli 0.161.0",
      getLatestVersion: async () => "rust-v0.161.0",
    });

    expect(result).toEqual({ status: "already-installed", path: "/custom/bin/codex" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("honors an explicit Codex CLI path without installing another copy", async () => {
    const runInstaller = vi.fn();
    await expect(ensureCodexCliForInstalledCodex({
      env: { CODEX_BIN: "/opt/codex/bin/codex", PATH: "/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/opt/codex/bin/codex",
      runInstaller,
      getInstalledVersion: async () => "codex-cli 0.161.0",
      getLatestVersion: async () => "0.161.0",
    })).resolves.toEqual({ status: "already-installed", path: "/opt/codex/bin/codex" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("installs even when the user has no Codex desktop app or auth state", async () => {
    const runInstaller = vi.fn();
    const installedPath = "/Users/tester/.local/bin/codex";
    const existing = new Set<string>();
    runInstaller.mockImplementation(async () => { existing.add(installedPath); });
    await expect(ensureCodexCliForInstalledCodex({
      env: { PATH: "/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => existing.has(candidate),
      runInstaller,
    })).resolves.toEqual({ status: "installed", path: installedPath });
    expect(runInstaller).toHaveBeenCalledOnce();
  });

  it("does not downgrade when the local CLI is newer than the stable release", async () => {
    const runInstaller = vi.fn();
    await expect(ensureCodexCliForInstalledCodex({
      env: { PATH: "/custom/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/custom/bin/codex",
      runInstaller,
      getInstalledVersion: async () => "codex-cli 0.162.0",
      getLatestVersion: async () => "0.161.0",
    })).resolves.toEqual({ status: "already-installed", path: "/custom/bin/codex" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("uses the official non-interactive installer when Codex exists but the CLI does not", async () => {
    const home = "/Users/tester";
    const installedPath = path.posix.join(home, ".local", "bin", "codex");
    const existing = new Set([path.posix.join(home, ".codex", "auth.json")]);
    const runInstaller = vi.fn(async (_command: string, _args: string[]) => {
      existing.add(installedPath);
    });

    const result = await ensureCodexCliForInstalledCodex({
      env: {
        HTTPS_PROXY: "http://proxy.corp:8080",
        NO_PROXY: "localhost,127.0.0.1,[::1]",
        PATH: "/usr/bin",
      },
      home,
      platform: "darwin",
      pathExists: async (candidate) => existing.has(candidate),
      runInstaller,
    });

    expect(result).toEqual({ status: "installed", path: installedPath });
    expect(runInstaller).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
      expect.objectContaining({
        CODEX_NON_INTERACTIVE: "1",
        CODEX_INSTALLER_USE_RELEASES_OPENAI_COM: "0",
        HTTPS_PROXY: "http://proxy.corp:8080",
        NO_PROXY: "localhost,127.0.0.1,[::1]",
      }),
    );
  });

  it("uses the official Windows installer and install directory", async () => {
    const home = "C:\\Users\\Ada";
    const env = {
      LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
      PATH: "C:\\Windows\\System32",
    };
    const installedPath = path.win32.join(
      codexStandaloneBinDir("win32", home, env),
      "codex.exe",
    );
    const existing = new Set([path.win32.join(home, ".codex", "auth.json")]);
    const runInstaller = vi.fn(async () => {
      existing.add(installedPath);
    });

    await expect(ensureCodexCliForInstalledCodex({
      env,
      home,
      platform: "win32",
      pathExists: async (candidate) => existing.has(candidate),
      runInstaller,
    })).resolves.toEqual({ status: "installed", path: installedPath });
    expect(runInstaller).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["irm https://chatgpt.com/codex/install.ps1 | iex"]),
      expect.objectContaining({
        CODEX_NON_INTERACTIVE: "1",
        CODEX_INSTALLER_USE_RELEASES_OPENAI_COM: "0",
      }),
    );
  });

  it("keeps client startup recoverable when automatic installation fails", async () => {
    await expect(ensureCodexCliForInstalledCodex({
      env: { PATH: "/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/Users/tester/.codex/auth.json",
      runInstaller: async () => {
        throw new Error("network unavailable");
      },
    })).resolves.toEqual({ status: "install-failed", detail: "network unavailable" });
  });

  it("upgrades outdated CLI and selects the official installed binary instead of stale CODEX_BIN/PATH", async () => {
    const oldBin = "/opt/old/codex";
    const newBin = "/Users/tester/.local/bin/codex";
    const installed = new Set([oldBin]);
    const runInstaller = vi.fn(async () => { installed.add(newBin); });
    const getInstalledVersion = vi.fn(async (binary: string) =>
      binary === newBin ? "codex-cli 0.161.0" : "codex-cli 0.145.0");
    await expect(ensureCodexCliForInstalledCodex({
      env: { CODEX_BIN: oldBin, PATH: "/opt/old:/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => installed.has(candidate),
      getInstalledVersion,
      getLatestVersion: async () => "rust-v0.161.0",
      runInstaller,
    })).resolves.toEqual({ status: "updated", path: newBin, fromVersion: "0.145.0", toVersion: "0.161.0" });
    expect(runInstaller).toHaveBeenCalledOnce();
    expect(getInstalledVersion).toHaveBeenCalledWith(newBin, expect.anything());
  });

  it("reuses a previously updated official CLI when CODEX_BIN still names the old version", async () => {
    const oldBin = "/opt/old/codex";
    const newBin = "/Users/tester/.local/bin/codex";
    const runInstaller = vi.fn();
    await expect(ensureCodexCliForInstalledCodex({
      env: { CODEX_BIN: oldBin, PATH: "/opt/old:/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === oldBin || candidate === newBin,
      getInstalledVersion: async (binary) => binary === newBin ? "codex-cli 0.161.0" : "codex-cli 0.145.0",
      getLatestVersion: async () => "0.161.0",
      runInstaller,
    })).resolves.toEqual({ status: "already-installed", path: newBin });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("retains the existing CLI when latest-version detection is offline", async () => {
    const runInstaller = vi.fn();
    const result = await ensureCodexCliForInstalledCodex({
      env: { PATH: "/opt/codex" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/opt/codex/codex",
      getLatestVersion: async () => { throw new Error("network unavailable"); },
      getInstalledVersion: async () => "codex-cli 0.145.0",
      runInstaller,
    });
    expect(result).toEqual({ status: "version-check-failed", path: "/opt/codex/codex", detail: "Error: network unavailable" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("retains the old binary when an upgrade fails", async () => {
    const result = await ensureCodexCliForInstalledCodex({
      env: { PATH: "/opt/old" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/opt/old/codex",
      getLatestVersion: async () => "0.161.0",
      getInstalledVersion: async () => "codex-cli 0.145.0",
      runInstaller: async () => { throw new Error("permission denied"); },
    });
    expect(result).toEqual({ status: "update-failed", path: "/opt/old/codex", detail: "permission denied" });
  });

  it("does not report success when installation leaves an outdated CLI", async () => {
    const installed = new Set(["/opt/old/codex"]);
    const newBin = "/Users/tester/.local/bin/codex";
    const result = await ensureCodexCliForInstalledCodex({
      env: { PATH: "/opt/old" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => installed.has(candidate),
      getLatestVersion: async () => "0.161.0",
      getInstalledVersion: async () => "codex-cli 0.145.0",
      runInstaller: async () => { installed.add(newBin); },
    });
    expect(result).toEqual({ status: "update-failed", path: "/opt/old/codex", detail: "CLI is still 0.145.0, latest is 0.161.0" });
  });
});
