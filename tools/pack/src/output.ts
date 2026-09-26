import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Constructs the `.output` target filename in the form:
 * `Hi.Design-{version}-{platform}-{arch}{suffix}`
 *
 * The suffix typically includes the leading separator and the file extension.
 */
export function outputArtifactName(
  version: string,
  platform: string,
  arch: string,
  suffix: string,
): string {
  return `Hi.Design-${version}-${platform}-${arch}${suffix}`;
}

/**
 * Copies a single build artifact to the project root `.output/` directory,
 * nested under `releases/download/open-design-v<version>/` to mirror the
 * GitHub Release asset URL structure.
 */
export async function copyArtifactToOutput(
  workspaceRoot: string,
  source: string,
  targetName: string,
  version: string,
): Promise<string> {
  // const outputDir = join(workspaceRoot, "releases", "download", `open-design-v${version}`);
  const outputDir = join(workspaceRoot, ".output");
  await mkdir(outputDir, { recursive: true });
  const destPath = join(outputDir, targetName);
  await cp(source, destPath);
  return destPath;
}