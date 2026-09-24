import { describe, expect, it, vi } from "vitest";

import { DESKTOP_UPDATE_CHANNELS, DESKTOP_UPDATE_STATES } from "@open-design/sidecar-proto";

import { createDesktopUpdaterScheduler } from "../../../src/main/updater/scheduler.js";

describe("desktop updater scheduler", () => {
  it("floors non-positive scheduled delays instead of spinning a zero-ms loop", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const updater = {
      checkForUpdates: vi.fn(async () => ({
        arch: "arm64",
        capabilities: {
          canApplyInPlace: false,
          canDownload: true,
          canOpenInstaller: true,
          requiresManualInstall: true,
        },
        channel: DESKTOP_UPDATE_CHANNELS.BETA,
        currentVersion: "1.0.0",
        enabled: true,
        mode: "package-launcher" as const,
        platform: "darwin",
        state: DESKTOP_UPDATE_STATES.NOT_AVAILABLE,
        supported: true,
      })),
      config: {
        arch: "arm64",
        autoCheck: true,
        autoDownload: true,
        autoOpen: false,
        channel: DESKTOP_UPDATE_CHANNELS.BETA,
        checkBackoffInitialMs: 60_000,
        checkBackoffMaxMs: 300_000,
        checkInitialDelayMs: 5_000,
        checkIntervalMs: 15 * 60 * 1000,
        currentVersion: "1.0.0",
        downloadRoot: "/tmp/open-design-updates",
        enabled: true,
        metadataUrl: "https://example.invalid/metadata.json",
        mode: "package-launcher" as const,
        platform: "darwin",
      },
      downloadUpdate: vi.fn(),
      handle: vi.fn(),
      installUpdate: vi.fn(),
      shouldAutoCheck: vi.fn(() => true),
      snapshot: vi.fn(() => ({
        arch: "arm64",
        capabilities: {
          canApplyInPlace: false,
          canDownload: true,
          canOpenInstaller: true,
          requiresManualInstall: true,
        },
        channel: DESKTOP_UPDATE_CHANNELS.BETA,
        currentVersion: "1.0.0",
        enabled: true,
        mode: "package-launcher" as const,
        platform: "darwin",
        state: DESKTOP_UPDATE_STATES.IDLE,
        supported: true,
      })),
      status: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    };

    try {
      const scheduler = createDesktopUpdaterScheduler(updater as any, {
        backoffInitialMs: 0,
        backoffMaxMs: 1000,
        initialDelayMs: 0,
        intervalMs: 0,
        logger: { warn } as any,
      });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(999);
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);

      scheduler.stop("test");
    } finally {
      vi.useRealTimers();
    }
  });
});
