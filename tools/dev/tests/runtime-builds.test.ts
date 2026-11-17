import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { ensureRuntimeDependencyBuilds } from "../src/runtime-builds.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "od-runtime-builds-"));
  roots.push(root);
  const built: string[] = [];
  async function file(relative: string, content: string) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  async function pkg(name: string, dependencies: string[] = []) {
    await file(`packages/${name}/package.json`, JSON.stringify({
      name: `@open-design/${name}`, scripts: { build: "build" },
      dependencies: Object.fromEntries(dependencies.map((dependency) => [`@open-design/${dependency}`, "workspace:*"])),
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
        "./runtime": { types: "./dist/runtime.d.ts", default: "./dist/runtime.mjs" } },
    }));
    await file(`packages/${name}/src/index.ts`, `export const value = '${name}';`);
    await file(`packages/${name}/tsconfig.json`, "{}");
    await file(`packages/${name}/esbuild.config.mjs`, "// build config");
  }
  await pkg("release");
  await pkg("host", ["release"]);
  await pkg("contracts");
  await pkg("components");
  await pkg("unrelated");
  for (const app of ["daemon", "web", "desktop"]) {
    await file(`apps/${app}/package.json`, JSON.stringify({ dependencies: {
      [`@open-design/${app === "daemon" ? "contracts" : "host"}`]: "workspace:*",
      "@open-design/components": "workspace:*",
    } }));
  }
  await file("pnpm-lock.yaml", "lockfileVersion: '9.0'");
  await file("pnpm-workspace.yaml", "packages:\n  - packages/*\n  - apps/*\n");
  await file("package.json", JSON.stringify({ packageManager: "pnpm@10.33.2" }));
  const build = async (name: string) => {
    built.push(name);
    const directory = `packages/${name.replace("@open-design/", "")}`;
    const source = await readFile(path.join(root, directory, "src/index.ts"), "utf8");
    for (const output of ["index.mjs", "index.d.ts", "runtime.mjs", "runtime.d.ts"]) {
      await file(`${directory}/dist/${output}`, source);
    }
  };
  const ensure = (app: "daemon" | "web" | "desktop" = "web", builder = build) =>
    ensureRuntimeDependencyBuilds({ workspaceRoot: root, app, build: builder });
  return { root, built, file, ensure, build };
}

describe("runtime dependency builds", () => {
  it("checks web dependencies independently, builds upstream first, and skips unchanged outputs", async () => {
    const f = await fixture();
    await f.ensure();
    assert.deepEqual(f.built, ["@open-design/components", "@open-design/release", "@open-design/host"]);
    f.built.length = 0;
    await f.ensure();
    assert.deepEqual(f.built, []);
  });

  it("rebuilds changed source and its dependents even with an older modification time", async () => {
    const f = await fixture();
    await f.ensure();
    f.built.length = 0;
    await f.file("packages/release/src/index.ts", "export const changed = true;");
    await utimes(path.join(f.root, "packages/release/src/index.ts"), 1, 1);
    await f.ensure();
    assert.deepEqual(f.built, ["@open-design/release", "@open-design/host"]);
  });

  it("rebuilds a package whose sub-entry declaration or runtime file is missing", async () => {
    const f = await fixture();
    await f.ensure();
    for (const output of ["runtime.d.ts", "runtime.mjs"]) {
      f.built.length = 0;
      await rm(path.join(f.root, "packages/host/dist", output));
      await f.ensure();
      assert.deepEqual(f.built, ["@open-design/host"]);
    }
  });

  it("detects overwritten outputs and changes to build configuration", async () => {
    const f = await fixture();
    await f.ensure();
    f.built.length = 0;
    await f.file("packages/host/dist/index.mjs", "// stale externally rebuilt output");
    await f.ensure();
    assert.deepEqual(f.built, ["@open-design/host"]);
    f.built.length = 0;
    await f.file("packages/host/esbuild.config.mjs", "// changed build config");
    await f.ensure();
    assert.deepEqual(f.built, ["@open-design/host"]);
  });

  it("does not launch subsequent builds after a failed build and retries it next time", async () => {
    const f = await fixture();
    await assert.rejects(f.ensure("web", async (name) => {
      if (name === "@open-design/release") throw new Error("compiler failed");
      await f.build(name);
    }), /release.*compiler failed/);
    assert.deepEqual(f.built, ["@open-design/components"]);
    f.built.length = 0;
    await f.ensure();
    assert.deepEqual(f.built, ["@open-design/release", "@open-design/host"]);
  });

  it("rejects a successful command that leaves required outputs missing", async () => {
    const f = await fixture();
    await assert.rejects(f.ensure("web", async () => {}), /missing.*dist/);
  });

  it("checks daemon and desktop dependency sets without building unrelated packages", async () => {
    const f = await fixture();
    await f.ensure("daemon");
    assert.deepEqual(f.built, ["@open-design/components", "@open-design/contracts"]);
    f.built.length = 0;
    await f.ensure("desktop");
    assert.deepEqual(f.built, ["@open-design/release", "@open-design/host"]);
  });

  it("rechecks lockfile changes and does not certify a build against source changed mid-build", async () => {
    const f = await fixture();
    await f.ensure();
    f.built.length = 0;
    await f.file("pnpm-lock.yaml", "lockfileVersion: '10.0'");
    await f.ensure();
    assert.equal(f.built.length, 3);
    await f.file("packages/host/src/index.ts", "// first edit");
    await assert.rejects(f.ensure("web", async (name) => {
      await f.build(name);
      await f.file("packages/host/src/index.ts", "// edited during build");
    }), /changed during.*build/);
  });

  it("stops startup when an upstream package changes while a downstream package builds", async () => {
    const f = await fixture();
    await assert.rejects(f.ensure("web", async (name) => {
      await f.build(name);
      if (name === "@open-design/host") await f.file("packages/release/src/index.ts", "// late upstream edit");
    }), /release changed during dependency builds/);
  });
});
