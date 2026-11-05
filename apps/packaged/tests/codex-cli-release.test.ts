import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn, execFile: vi.fn() }));

import { ensureCodexCliForInstalledCodex } from "../src/codex-cli-bootstrap.js";

afterEach(() => spawn.mockReset());

function respond(failGithub: boolean) {
  spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    queueMicrotask(() => {
      const fail = !args.at(-1)?.includes("api.github.com") || failGithub;
      if (fail) child.stderr.write("curl: (22) The requested URL returned error: 403");
      else child.stdout.write(JSON.stringify({ tag_name: "rust-v0.161.0" }));
      child.emit("close", fail ? 22 : 0);
    });
    return child;
  });
}

async function check() {
  return ensureCodexCliForInstalledCodex({
    env: { PATH: "/opt/codex" }, home: "/Users/tester", platform: "darwin",
    pathExists: async (candidate) => candidate === "/opt/codex/codex",
    getInstalledVersion: async () => "codex-cli 0.161.0",
    runInstaller: async () => { throw new Error("must not install"); },
  });
}

describe("Codex release source failures", () => {
  it("retains both endpoint failures instead of a generic network error", async () => {
    respond(true);
    const result = await check();
    expect(result.status).toBe("version-check-failed");
    expect(result).toMatchObject({ detail: expect.stringMatching(/releases\.openai\.com: .*403.*api\.github\.com: .*403/) });
  });

  it("still checks GitHub when the official version feed fails", async () => {
    respond(false);
    expect(await check()).toEqual({ status: "already-installed", path: "/opt/codex/codex" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
