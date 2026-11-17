import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { expect, it } from "vitest";

const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)));

it("loads current browser development exports even when dist predates a new action", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "host-development-exports-"));
  try {
    const packageRoot = join(fixture, "node_modules/@open-design/host");
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await cp(join(hostRoot, "src"), join(packageRoot, "src"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), await readFile(join(hostRoot, "package.json")));
    // Model a checkout/merge with a valid old build that lacks the new export.
    await writeFile(join(packageRoot, "dist/index.mjs"), 'export const origin = "built";');

    const dev = await build({
      stdin: {
        contents: 'import { forceReloadHostWindow } from "@open-design/host"; globalThis.reloadAction = forceReloadHostWindow;',
        resolveDir: fixture,
      },
      bundle: true,
      platform: "browser",
      conditions: ["development"],
      write: false,
      logLevel: "silent",
    });
    const scope: { reloadAction?: unknown } = {};
    runInNewContext(dev.outputFiles![0]!.text, scope);
    expect(typeof scope.reloadAction).toBe("function");

    // Production consumers retain the compiled-package contract.
    const production = await build({
      stdin: {
        contents: 'import { origin } from "@open-design/host"; globalThis.origin = origin;',
        resolveDir: fixture,
      },
      bundle: true,
      platform: "browser",
      conditions: [],
      write: false,
      logLevel: "silent",
    });
    const productionScope: { origin?: string } = {};
    runInNewContext(production.outputFiles![0]!.text, productionScope);
    expect(productionScope.origin).toBe("built");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
