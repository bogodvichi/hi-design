import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renameWithRetry } from "@/cache/index.js";

function transientRenameError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("renameWithRetry", () => {
  it("retries transient Windows rename errors before publishing the entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "hi-design-team-tools-pack-rename-"));
    const source = join(root, "staging");
    const target = join(root, "entry");
    const delays: number[] = [];
    let attempts = 0;

    try {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "value.txt"), "built\n", "utf8");

      await renameWithRetry(source, target, {
        rename: async (from, to) => {
          attempts += 1;
          if (attempts <= 2) throw transientRenameError("EPERM");
          await rename(from, to);
        },
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

      expect(attempts).toBe(3);
      expect(delays).toEqual([100, 250]);
      expect(await readFile(join(target, "value.txt"), "utf8")).toBe("built\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not retry non-transient rename errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "hi-design-team-tools-pack-rename-fail-"));
    const source = join(root, "missing");
    const target = join(root, "entry");
    let attempts = 0;

    try {
      await expect(renameWithRetry(source, target, {
        rename: async () => {
          attempts += 1;
          throw transientRenameError("ENOENT");
        },
        sleep: async () => undefined,
      })).rejects.toMatchObject({ code: "ENOENT" });

      expect(attempts).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
