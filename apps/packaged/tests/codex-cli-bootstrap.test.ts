import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  codexStandaloneBinDir,
  ensureCodexCliForInstalledCodex,
} from "../src/codex-cli-bootstrap.js";

describe("ensureCodexCliForInstalledCodex", () => {
  it("does nothing when an independent Codex CLI is already on PATH", async () => {
    const runInstaller = vi.fn();
    const result = await ensureCodexCliForInstalledCodex({
      env: { PATH: "/custom/bin:/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async (candidate) => candidate === "/custom/bin/codex",
      runInstaller,
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
    })).resolves.toEqual({ status: "already-installed", path: "/opt/codex/bin/codex" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("does not install for users without a local Codex app or state", async () => {
    const runInstaller = vi.fn();
    await expect(ensureCodexCliForInstalledCodex({
      env: { PATH: "/usr/bin" },
      home: "/Users/tester",
      platform: "darwin",
      pathExists: async () => false,
      runInstaller,
    })).resolves.toEqual({ status: "skipped-no-codex-app" });
    expect(runInstaller).not.toHaveBeenCalled();
  });

  it("does not treat the ChatGPT desktop app as a Codex installation", async () => {
    const runInstaller = vi.fn();
    const chatGptPath = "C:\\Users\\Ada\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe";
    await expect(ensureCodexCliForInstalledCodex({
      env: {
        LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
        PATH: "C:\\Windows\\System32",
      },
      home: "C:\\Users\\Ada",
      platform: "win32",
      pathExists: async (candidate) => candidate === chatGptPath,
      runInstaller,
    })).resolves.toEqual({ status: "skipped-no-codex-app" });
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
      expect.objectContaining({ CODEX_NON_INTERACTIVE: "1" }),
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
});
