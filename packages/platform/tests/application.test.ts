import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { launchDetachedApplication } from "../src/application.js";

function fixture() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const spawn = vi.fn(() => child as never);
  return { child, spawn };
}

describe("detached application launch", () => {
  it("waits for Launch Services acceptance and preserves arguments and environment", async () => {
    const { child, spawn } = fixture();
    const env = { OD_UPDATE_CHANNEL: "beta" };
    const args = ["--od-launcher-target-pid", "42", "opendesign://invite?a=b&c=d"];
    const launched = vi.fn();
    const launch = launchDetachedApplication("/tmp/release/Hi Design Team.app/Contents/MacOS/Hi Design Team", args, {
      cwd: "/tmp/release",
      env,
      platform: "darwin",
      spawn,
    }).then(launched);
    expect(spawn).toHaveBeenCalledExactlyOnceWith("/usr/bin/open", [
      "-n", "-a", "/tmp/release/Hi Design Team.app", "--args", ...args,
    ], { cwd: "/tmp/release", detached: true, env, stdio: "ignore", windowsHide: true });
    child.emit("spawn");
    await Promise.resolve();
    expect(launched).not.toHaveBeenCalled();
    expect(child.unref).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    await launch;
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it.each([[1, null], [null, "SIGTERM"]])("rejects a refused or interrupted application launch (%s, %s)", async (code, signal) => {
    const { child, spawn } = fixture();
    const launch = launchDetachedApplication("/tmp/Test.app/Contents/MacOS/Test", [], { platform: "darwin", spawn });
    child.emit("spawn");
    child.emit("close", code, signal);
    await expect(launch).rejects.toThrow("application launch failed");
    expect(child.unref).not.toHaveBeenCalled();
  });

  it("rejects a spawn failure", async () => {
    const { child, spawn } = fixture();
    const launch = launchDetachedApplication("/tmp/Test.app/Contents/MacOS/Test", [], { platform: "darwin", spawn });
    child.emit("error", new Error("spawn EACCES"));
    await expect(launch).rejects.toThrow("spawn EACCES");
    expect(child.unref).not.toHaveBeenCalled();
  });

  it.each(["win32", "linux", "darwin"] as const)("preserves direct executable launches on %s", async (platform) => {
    const { child, spawn } = fixture();
    const launch = launchDetachedApplication("/tmp/payload/app", ["--after-quit"], { platform, spawn });
    expect(spawn).toHaveBeenCalledExactlyOnceWith("/tmp/payload/app", ["--after-quit"], {
      detached: true, stdio: "ignore", windowsHide: true,
    });
    child.emit("spawn");
    await launch;
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
