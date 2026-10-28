import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";

type ApplicationSpawn = (
  command: string,
  args: string[],
  options: { cwd?: string; detached: true; env?: NodeJS.ProcessEnv; stdio: "ignore"; windowsHide: true },
) => Pick<ChildProcess, "once" | "unref">;

/**
 * Launch macOS bundles through Launch Services so the replacement application
 * gets its own lifecycle instead of retaining the exited parent's Dock entry.
 * Other executables retain the detached-process launch contract.
 */
export async function launchDetachedApplication(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: string | undefined;
    spawn?: ApplicationSpawn | undefined;
  } = {},
): Promise<void> {
  const bundle = dirname(dirname(dirname(executable)));
  const useLaunchServices = (options.platform ?? process.platform) === "darwin" && bundle.endsWith(".app");
  const child = (options.spawn ?? spawn)(
    useLaunchServices ? "/usr/bin/open" : executable,
    useLaunchServices ? ["-n", "-a", bundle, "--args", ...args] : args,
    {
      ...(options.cwd == null ? {} : { cwd: options.cwd }),
      ...(options.env == null ? {} : { env: options.env }),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    child.once("error", rejectLaunch);
    if (useLaunchServices) {
      // Spawning `open` alone does not mean Launch Services accepted the app.
      child.once("close", (code, signal) => {
        if (code === 0) resolveLaunch();
        else rejectLaunch(new Error(`application launch failed (${signal ?? code}): ${executable}`));
      });
    } else {
      child.once("spawn", () => resolveLaunch());
    }
  });
  child.unref();
}
