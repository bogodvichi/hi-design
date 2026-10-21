import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function installedVelaBinary(): string | null {
  try {
    const { resolveVelaCliBin } = require("@powerformer/vela-cli") as typeof import("@powerformer/vela-cli");
    return resolveVelaCliBin();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

/** Supply project-owned agent binaries to the development daemon. */
export function resolveDevAgentEnv(
  env: NodeJS.ProcessEnv = process.env,
  resolveInstalledVela: () => string | null = installedVelaBinary,
): Record<string, string> {
  if (env.VELA_BIN?.trim()) return {};
  const vela = resolveInstalledVela();
  return vela ? { VELA_BIN: vela } : {};
}
