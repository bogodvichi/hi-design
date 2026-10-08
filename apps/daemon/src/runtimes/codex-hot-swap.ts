import { retireCodexAppServerManagers } from './codex-app-server.js';
import { invalidateDetectedRuntimeForAgent } from './detection.js';
import { activateInstalledCodexExecutable } from './executables.js';

/**
 * Promote an already-installed official CLI without restarting the daemon.
 * New exec Runs resolve the promoted binary and new app-server Runs get a
 * fresh manager; existing app-server Runs drain on their previous process.
 */
export function switchToInstalledCodexCli(): boolean {
  if (!activateInstalledCodexExecutable()) return false;
  invalidateDetectedRuntimeForAgent('codex');
  retireCodexAppServerManagers();
  return true;
}
