import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureForDesignerInstalled } from '../src/http/hik_logins/for-designer.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const roots: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fordesigner-launch-'));
  roots.push(root);
  const source = path.join(root, 'bundle');
  const home = path.join(root, 'home');
  const target = path.join(home, 'for-designer');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  for (const name of ['collect_cowork.py', 'parse.py', 'static_org_map.py', 'update_collector.py']) {
    fs.writeFileSync(path.join(source, 'scripts', name), `bundle/${name}`);
  }
  fs.writeFileSync(path.join(source, 'version.json'), JSON.stringify({ version: '1.0.2' }));
  for (const name of ['server.json', 'groups.json', 'group-map.json', 'pricing.json']) {
    fs.writeFileSync(path.join(source, 'config', name), '{}');
  }
  fs.writeFileSync(path.join(source, 'config', 'member-groups.json'), JSON.stringify({}));
  for (const name of ['install.command', 'install.bat', 'install.ps1']) {
    fs.writeFileSync(path.join(source, name), `installer ${name}`);
  }
  return { source, home, target };
}

function seedUnchanged(target: string, source: string) {
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(target, 'config'), { recursive: true });
  fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify({ version: '1.0.2' }));
  for (const name of fs.readdirSync(path.join(source, 'scripts'))) {
    fs.copyFileSync(path.join(source, 'scripts', name), path.join(target, 'scripts', name));
  }
}

beforeEach(() => {
  const child = { on: vi.fn(), unref: vi.fn() } as unknown as ChildProcess;
  spawnMock.mockReset();
  spawnMock.mockReturnValue(child);
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ForDesigner background launch behavior', () => {
  it('launches the Windows installer directly in a hidden PowerShell host', () => {
    const { source, home, target } = createFixture();
    const result = ensureForDesignerInstalled(source, { username: 'user01' }, { homeDir: home, platform: 'win32' });

    expect(result.status).toBe('installed');
    const call = spawnMock.mock.calls.find(([file]) => file === 'powershell.exe');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      path.join(target, 'install.ps1'),
    ]);
    expect(call?.[2]).toMatchObject({
      cwd: target,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    expect((call?.[2] as { env?: Record<string, string> }).env?.HIDESIGN_FOR_DESIGNER_SILENT).toBe('1');
    expect(spawnMock.mock.calls.some(([file]) => /^(cmd|cmd\.exe)$/i.test(String(file)))).toBe(false);
  });

  it('does not relaunch an installer when the installation is unchanged', () => {
    const { source, home, target } = createFixture();
    seedUnchanged(target, source);
    const result = ensureForDesignerInstalled(source, { username: 'user01' }, { homeDir: home, platform: 'win32' });

    expect(result.status).toBe('unchanged');
    const installerCalls = spawnMock.mock.calls.filter(([file]) =>
      /^(cmd|cmd\.exe|powershell|powershell\.exe)$/i.test(String(file)));
    expect(installerCalls).toEqual([]);
  });
});
