import { createHash, type Hash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const BUILD_RECORD = ".tools-dev-build.json";

type PackageManifest = {
  name?: string;
  scripts?: { build?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  main?: string;
  types?: string;
  exports?: unknown;
};

type BuildRecord = { inputs: string; outputs: string };

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function hashPath(hash: Hash, root: string, relative: string): Promise<void> {
  const absolute = path.join(root, relative);
  const entry = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  hash.update(JSON.stringify([relative.split(path.sep).join("/"), entry?.isDirectory() ?? null]));
  if (!entry) return;
  if (entry.isDirectory()) {
    const children = (await readdir(absolute)).sort();
    for (const child of children) {
      if (child === BUILD_RECORD || child.startsWith(`${BUILD_RECORD}.`)) continue;
      await hashPath(hash, root, path.join(relative, child));
    }
  } else {
    const content = await readFile(absolute);
    hash.update(JSON.stringify(content.length));
    hash.update(content);
  }
}

async function hashPaths(root: string, paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of paths.sort()) await hashPath(hash, root, relative);
  return hash.digest("hex");
}

function distOutputs(value: unknown): string[] {
  if (typeof value === "string") {
    if (!value.startsWith("./dist/")) return [];
    if (value.includes("*")) throw new Error(`Cannot verify wildcard build output: ${value}`);
    return [value.slice(2)];
  }
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(distOutputs);
}

async function missingOutputs(root: string, outputs: string[]): Promise<string[]> {
  const missing = await Promise.all(outputs.map(async (output) =>
    (await lstat(path.join(root, output)).catch(() => null))?.isFile() ? null : output));
  return missing.filter((output): output is string => output !== null);
}

/** Build only the selected app's workspace dependencies, in dependency order.
 * Records certify source/configuration, upstream builds and the complete dist
 * tree together. Package timestamps alone cannot detect a branch switch or a
 * partial/manual build that left stale runtime files beside fresh declarations.
 */
export async function ensureRuntimeDependencyBuilds(input: {
  workspaceRoot: string;
  app: "daemon" | "web" | "desktop";
  build: (packageName: string, reason: string) => Promise<void>;
}): Promise<void> {
  const { workspaceRoot } = input;
  const packageRoots = new Map<string, string>();
  for (const entry of await readdir(path.join(workspaceRoot, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = path.join(workspaceRoot, "packages", entry.name);
    const manifest = await readJson<PackageManifest>(path.join(root, "package.json"));
    if (manifest.name) packageRoots.set(manifest.name, root);
  }
  const environment = [process.version, process.platform, process.arch, await hashPaths(workspaceRoot,
    ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])];
  const completed = new Map<string, string>();
  const active = new Set<string>();
  const validations: Array<() => Promise<void>> = [];

  async function dependencies(manifest: PackageManifest): Promise<string[]> {
    const workspaceDependencies = Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })
      .filter(([, version]) => version.startsWith("workspace:")).map(([name]) => name).sort();
    const hashes: string[] = [];
    for (const name of workspaceDependencies) hashes.push(await ensurePackage(name));
    return hashes;
  }

  async function ensurePackage(name: string): Promise<string> {
    if (completed.has(name)) return completed.get(name)!;
    if (active.has(name)) throw new Error(`Workspace build dependency cycle: ${name}`);
    const root = packageRoots.get(name);
    if (!root) throw new Error(`Workspace dependency not found: ${name}`);
    active.add(name);
    const manifest = await readJson<PackageManifest>(path.join(root, "package.json"));
    const upstream = await dependencies(manifest);
    if (!manifest.scripts?.build) throw new Error(`Workspace dependency has no build command: ${name}`);
    const fingerprint = async () => {
      const inputs = (await readdir(root)).filter((entry) =>
        entry === "src" || entry === "scripts" || /\.(?:[cm]?ts|[cm]?js|json|ya?ml)$/.test(entry));
      return createHash("sha256").update(JSON.stringify([
        1, name, environment, upstream, await hashPaths(root, inputs),
      ])).digest("hex");
    };
    const outputs = [...new Set(distOutputs([manifest.main, manifest.types, manifest.exports]))].sort();
    if (!outputs.length) throw new Error(`Workspace dependency declares no dist outputs: ${name}`);
    const sourceHash = await fingerprint();
    const recordPath = path.join(root, "dist", BUILD_RECORD);
    const record = await readJson<BuildRecord>(recordPath).catch(() => null);
    const missing = await missingOutputs(root, outputs);
    let outputHash = await hashPaths(root, ["dist"]);
    const reason = missing.length ? `missing outputs: ${missing.join(", ")}`
      : !record ? "build fingerprint is missing"
      : record.inputs !== sourceHash ? "source, configuration or dependencies changed"
      : record.outputs !== outputHash ? "build outputs changed" : null;
    if (reason) {
      try {
        await input.build(name, reason);
        const stillMissing = await missingOutputs(root, outputs);
        if (stillMissing.length) throw new Error(`missing build outputs: ${stillMissing.join(", ")}`);
        if (await fingerprint() !== sourceHash) throw new Error("source changed during the build; retry startup");
        outputHash = await hashPaths(root, ["dist"]);
        await mkdir(path.dirname(recordPath), { recursive: true });
        const temporary = `${recordPath}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ inputs: sourceHash, outputs: outputHash }) + "\n");
        await rename(temporary, recordPath);
      } catch (error) {
        throw new Error(`[tools-dev] ${name} build failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    const result = createHash("sha256").update(JSON.stringify([name, sourceHash, outputHash])).digest("hex");
    completed.set(name, result);
    active.delete(name);
    validations.push(async () => {
      if (await fingerprint() !== sourceHash || await hashPaths(root, ["dist"]) !== outputHash) {
        throw new Error(`[tools-dev] ${name} changed during dependency builds; retry startup`);
      }
    });
    return result;
  }

  await dependencies(await readJson<PackageManifest>(path.join(workspaceRoot, "apps", input.app, "package.json")));
  for (const validate of validations) await validate();
}
