import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { parseLauncherAfterQuitArgs, parseLauncherDelegatedArgs } from "@open-design/launcher-proto";

import { launchPayloadAppAfterQuit, type SpawnInstallerHelper } from "../../src/main/updater/deferred-launch.js";

describe("payload update relaunch", () => {
  it("uses macOS application launch without losing the wait-for-exit or activation pointer", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnDetached = vi.fn<SpawnInstallerHelper>(() => child as never);
    const launch = launchPayloadAppAfterQuit({
      appPid: 42,
      cwd: "/tmp/runtime",
      delegated: { generation: 2, version: "0.21.2" },
      launchPath: "/tmp/payload/Hi Design Team.app/Contents/MacOS/Hi Design Team",
      root: "/tmp/updates",
      timeoutMs: 60_000,
    }, { now: () => new Date(), platform: "darwin", spawnDetached });
    child.emit("close", 0, null);
    await expect(launch).resolves.toEqual({});
    expect(spawnDetached.mock.calls[0]?.[0]).toBe("/usr/bin/open");
    const args = spawnDetached.mock.calls[0]?.[1] ?? [];
    expect(args.slice(0, 5)).toEqual(["-n", "-a", "/tmp/payload/Hi Design Team.app", "--args", "--od-launcher-after-quit"]);
    expect(parseLauncherAfterQuitArgs(args)).toEqual({ targetPid: 42, timeoutMs: 60_000 });
    expect(parseLauncherDelegatedArgs(args)).toEqual({ generation: 2, version: "0.21.2" });
  });

  it("reports a Launch Services rejection as a failed relaunch", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const launch = launchPayloadAppAfterQuit({
      appPid: 42, cwd: "/tmp/runtime", launchPath: "/tmp/Test.app/Contents/MacOS/Test", root: "/tmp/updates", timeoutMs: 60_000,
    }, { now: () => new Date(), platform: "darwin", spawnDetached: () => child as never });
    child.emit("close", 1, null);
    await expect(launch).resolves.toMatchObject({ error: expect.stringContaining("application launch failed") });
    expect(child.unref).not.toHaveBeenCalled();
  });
});
