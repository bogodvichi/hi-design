import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DAEMON_STARTUP_TIMEOUT_MS,
  WEB_STARTUP_TIMEOUT_MS,
  waitForDaemonRuntime,
  waitForDesktopRuntime,
  waitForWebRuntime,
} from "../src/sidecar-client.js";

describe("sidecar startup waits", () => {
  it("allows daemon initialization to continue past the legacy 35 second deadline", () => {
    assert.equal(DAEMON_STARTUP_TIMEOUT_MS, 120_000);
  });

  it("leaves web startup enough time for the slow next.js dev first-start initialization", () => {
    // `next dev` blocks on `getRequestHandlers()` (tsconfig/webpack config load plus dev
    // watchers) before the sidecar publishes status; on this workspace that measured
    // 16-60s, so the legacy 35s deadline killed healthy starts.
    assert.ok(WEB_STARTUP_TIMEOUT_MS >= 180_000, `only ${WEB_STARTUP_TIMEOUT_MS}ms`);
  });

  it("fails immediately when a spawned app exits before publishing status", async () => {
    const waits = [
      ["daemon", waitForDaemonRuntime],
      ["web", waitForWebRuntime],
      ["desktop", waitForDesktopRuntime],
    ] as const;

    for (const [appName, waitForRuntime] of waits) {
      const startedAt = Date.now();
      await assert.rejects(
        waitForRuntime(
          { base: "unused", namespace: `exited-${appName}-${process.pid}` },
          5_000,
          () => false,
        ),
        new RegExp(`${appName} exited before exposing status`),
      );
      assert.ok(Date.now() - startedAt < 1_000);
    }
  });
});
