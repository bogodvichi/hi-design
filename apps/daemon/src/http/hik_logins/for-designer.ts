import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ForDesigner is local user state, not a disposable copy of an app resource.
 * Never copy a bundled data/ directory, identity.json, or a bundled version.json
 * over an existing installation. The hourly Python updater shares this lock.
 */
const VERSION_FILE = 'version.json';
const UPDATE_LOCK = '.for-designer-update.lock';
const SCRIPT_FILES = ['collect_cowork.py', 'parse.py', 'static_org_map.py', 'update_collector.py'] as const;
const CONFIG_DEFAULTS = ['server.json', 'groups.json', 'group-map.json', 'pricing.json'] as const;
const INSTALLERS = ['install.command', 'install.bat', 'install.ps1'] as const;

export type ForDesignerIdentity = {
  username?: string;
  userInfo?: ({ displayName?: string } & Record<string, unknown>) | null;
};
export type ForDesignerSyncResult = {
  status: 'installed' | 'upgraded' | 'unchanged' | 'deferred' | 'missing-bundle';
  installedVersion: string | null;
  targetDir: string;
};
export type ForDesignerSyncOptions = {
  /** Test-only/integration override; normal callers always use the real home folder. */
  homeDir?: string;
  platform?: NodeJS.Platform;
  /** Pure filesystem tests must never register tasks, start collectors, or access the network. */
  launchProcesses?: boolean;
};

function versionParts(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts as [number, number, number];
}

function readVersion(root: string): string | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(root, VERSION_FILE), 'utf8')).version;
    return versionParts(value) ? value as string : null;
  } catch {
    return null;
  }
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left)!;
  const b = versionParts(right)!;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

function writeVersionAtomically(root: string, version: string): void {
  const temporary = path.join(root, `.for-designer-version-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version }, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, path.join(root, VERSION_FILE));
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function identicalBundledScripts(sourceScripts: string, installedScripts: string): boolean {
  try {
    // Python may create __pycache__ beside the installed scripts. Ignore
    // runtime artifacts and compare only the four versioned release files.
    return SCRIPT_FILES.every((name) => {
      const source = path.join(sourceScripts, name);
      const current = path.join(installedScripts, name);
      return fs.statSync(source).isFile() &&
        fs.statSync(current).isFile() &&
        fs.readFileSync(source).equals(fs.readFileSync(current));
    });
  } catch {
    return false;
  }
}

function upgradeScripts(sourceDir: string, targetDir: string, version: string): boolean {
  const lock = path.join(targetDir, UPDATE_LOCK);
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }

  const staging = path.join(targetDir, `.scripts-hidesign-stage-${crypto.randomUUID()}`);
  const backup = path.join(targetDir, `.scripts-hidesign-backup-${crypto.randomUUID()}`);
  const current = path.join(targetDir, 'scripts');
  let previousMoved = false;
  let newInstalled = false;
  try {
    fs.writeSync(descriptor, String(process.pid));
    // Recheck under the same lock used by the Python updater. A concurrent
    // hourly run must never cause a downgrade.
    const lockedVersion = readVersion(targetDir);
    if (lockedVersion && compareVersions(lockedVersion, version) > 0) return false;
    if (lockedVersion && compareVersions(lockedVersion, version) === 0 &&
        identicalBundledScripts(path.join(sourceDir, 'scripts'), current)) {
      return false;
    }
    fs.mkdirSync(staging);
    for (const name of SCRIPT_FILES) {
      const sourceFile = path.join(sourceDir, 'scripts', name);
      if (!fs.statSync(sourceFile).isFile()) {
        throw new Error(`ForDesigner bundle is missing ${name}`);
      }
      fs.copyFileSync(sourceFile, path.join(staging, name));
    }
    if (fs.existsSync(current)) {
      fs.renameSync(current, backup);
      previousMoved = true;
    }
    fs.renameSync(staging, current);
    newInstalled = true;
    writeVersionAtomically(targetDir, version);
    if (previousMoved) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* Do not undo a successful update. */ }
    }
    return true;
  } catch (error) {
    if (newInstalled) fs.rmSync(current, { recursive: true, force: true });
    if (previousMoved) fs.renameSync(backup, current);
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

function copyDefaultIfMissing(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

function staticGroupForUser(sourceDir: string, username: string): string {
  try {
    const file = path.join(sourceDir, 'config', 'member-groups.json');
    const map = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const group = map[username] ?? map[username.toLowerCase()];
    return typeof group === 'string' && group.trim() ? group : '未分组';
  } catch {
    return '未分组';
  }
}

function spawnDetached(file: string, args: string[], cwd: string): void {
  try {
    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HIDESIGN_FOR_DESIGNER_SILENT: '1' },
    });
    child.on('error', () => { /* No login failure when Python or the task tool is missing. */ });
    child.unref();
  } catch {
    // Background installer is best-effort; the existing hourly task remains intact.
  }
}

function launchInstaller(root: string, platform: NodeJS.Platform): void {
  if (platform === 'win32' && fs.existsSync(path.join(root, 'install.bat'))) {
    spawnDetached('cmd', ['/d', '/c', path.join(root, 'install.bat')], root);
  }
  if (platform === 'darwin' && fs.existsSync(path.join(root, 'install.command'))) {
    const installer = path.join(root, 'install.command');
    try { fs.chmodSync(installer, 0o755); } catch { /* Continue; bash can read scripts. */ }
    spawnDetached('bash', [installer], root);
  }
}

function launchUpdateCheck(root: string, platform: NodeJS.Platform): void {
  if (!fs.existsSync(path.join(root, 'scripts', 'update_collector.py'))) return;
  const scriptDir = path.join(root, 'scripts');
  // Same authoritative updater as the hourly collector: HTTPS, SHA-256, lock,
  // atomic script swap and monotonically increasing version.json.
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(scriptDir)}); from update_collector import check_for_updates; check_for_updates()`;
  const commands: Array<[string, string[]]> = platform === 'win32'
    ? [['python', ['-c', code]], ['python3', ['-c', code]], ['py', ['-3', '-c', code]]]
    : [['/usr/bin/python3', ['-c', code]], ['python3', ['-c', code]]];

  const tryNext = (index: number) => {
    if (index >= commands.length) return;
    const [program, args] = commands[index]!;
    try {
      const child = spawn(program, args, { cwd: root, windowsHide: true, detached: true, stdio: 'ignore' });
      let nextStarted = false;
      const retry = () => {
        if (nextStarted) return;
        nextStarted = true;
        tryNext(index + 1);
      };
      child.on('error', retry);
      child.on('exit', (code) => { if (code !== 0) retry(); });
      child.unref();
    } catch {
      tryNext(index + 1);
    }
  };
  tryNext(0);
}

/**
 * Called after OA login and once when a saved OA session is validated at app
 * startup. Both Windows and macOS use exactly the same version/identity rules.
 */
export function ensureForDesignerInstalled(
  sourceDir: string,
  session: ForDesignerIdentity,
  options: ForDesignerSyncOptions = {},
): ForDesignerSyncResult {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const targetDir = path.join(homeDir, 'for-designer');
  const sourceScripts = path.join(sourceDir, 'scripts');
  if (!fs.existsSync(path.join(sourceScripts, 'collect_cowork.py'))) {
    return { status: 'missing-bundle', installedVersion: readVersion(targetDir), targetDir };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const configDir = path.join(targetDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  for (const name of CONFIG_DEFAULTS) {
    copyDefaultIfMissing(path.join(sourceDir, 'config', name), path.join(configDir, name));
  }

  // Never overwrite an existing identity, even if OA now reports another
  // department. The collector's 66-person static map determines the group.
  const identityFile = path.join(configDir, 'identity.json');
  const username = (typeof session.userInfo?.displayName === 'string' && session.userInfo.displayName.trim()) ||
    (typeof session.username === 'string' && session.username.trim()) || '';
  if (!fs.existsSync(identityFile) && username) {
    const identity = {
      user: username,
      group: staticGroupForUser(sourceDir, username),
      machine: os.hostname(),
    };
    try {
      fs.writeFileSync(identityFile, JSON.stringify(identity, null, 2), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  const bundleVersion = readVersion(sourceDir);
  let installedVersion = readVersion(targetDir);
  const currentScripts = path.join(targetDir, 'scripts');
  const hasCollector = fs.existsSync(path.join(currentScripts, 'collect_cowork.py'));
  const missingRequiredScript = SCRIPT_FILES.some((name) => !fs.existsSync(path.join(currentScripts, name)));
  let status: ForDesignerSyncResult['status'] = 'unchanged';
  if (bundleVersion) {
    // An existing script set with no version marker may be newer than this
    // bundle. Never replace it until we can establish the installed version.
    const requiresInstall = !hasCollector || (installedVersion !== null && (
      missingRequiredScript || compareVersions(installedVersion, bundleVersion) < 0 ||
      (compareVersions(installedVersion, bundleVersion) === 0 &&
        !identicalBundledScripts(sourceScripts, currentScripts))
    ));
    if (requiresInstall && (!installedVersion || compareVersions(installedVersion, bundleVersion) <= 0)) {
      if (upgradeScripts(sourceDir, targetDir, bundleVersion)) {
        status = hasCollector ? 'upgraded' : 'installed';
        installedVersion = bundleVersion;
      } else {
        installedVersion = readVersion(targetDir);
        status = installedVersion && compareVersions(installedVersion, bundleVersion) >= 0
          ? 'unchanged' : 'deferred';
      }
    } else if (installedVersion === null && hasCollector) {
      // No marker does NOT mean an old version: retain unknown/newer user scripts.
      // Only adopt the bundle's marker when its bytes match exactly.
      if (identicalBundledScripts(sourceScripts, currentScripts)) {
        const lock = path.join(targetDir, UPDATE_LOCK);
        try {
          const fd = fs.openSync(lock, 'wx');
          try { writeVersionAtomically(targetDir, bundleVersion); installedVersion = bundleVersion; }
          finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      } else {
        status = 'deferred';
      }
    } else if (installedVersion && compareVersions(installedVersion, bundleVersion) > 0) {
      // Never downgrade a newer server-delivered script with an older client.
      status = 'unchanged';
    }
  } else {
    status = 'deferred';
  }

  // Installers are not user data. Keep these bundled entrypoints up-to-date,
  // but never let an older bundle replace entrypoints from a newer install.
  if (!installedVersion || (bundleVersion && compareVersions(bundleVersion, installedVersion) >= 0)) {
    for (const name of INSTALLERS) {
      const from = path.join(sourceDir, name);
      const to = path.join(targetDir, name);
      // Never replace an installer in an unknown-version installation.
      // It may be newer than the client package.
      if (fs.existsSync(from) && (installedVersion || !fs.existsSync(to))) {
        fs.copyFileSync(from, to);
      }
    }
  }

  if (options.launchProcesses !== false) {
    launchInstaller(targetDir, platform);
    launchUpdateCheck(targetDir, platform);
  }

  return { status, installedVersion, targetDir };
}
