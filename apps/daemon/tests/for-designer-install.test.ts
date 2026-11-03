import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureForDesignerInstalled } from '../src/http/hik_logins/for-designer.js';

const FILES = ['collect_cowork.py', 'parse.py', 'static_org_map.py', 'update_collector.py'] as const;
const DEFAULTS = ['server.json', 'groups.json', 'group-map.json', 'pricing.json'] as const;
const roots: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fordesigner-client-upgrade-'));
  roots.push(root);
  const source = path.join(root, 'bundle');
  const home = path.join(root, 'home');
  const target = path.join(home, 'for-designer');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.mkdirSync(home);
  for (const name of FILES) {
    fs.writeFileSync(path.join(source, 'scripts', name), 'bundle-1.0.2/' + name);
  }
  fs.writeFileSync(path.join(source, 'version.json'), '{"version":"1.0.2"}\n');
  for (const name of DEFAULTS) {
    fs.writeFileSync(path.join(source, 'config', name), '{"source":"bundle"}\n');
  }
  fs.writeFileSync(path.join(source, 'config', 'member-groups.json'),
    JSON.stringify({ '翁文秀': '智能设计效能组', '张亚婷5': '基础平台设计组' }));
  for (const name of ['install.command', 'install.bat', 'install.ps1']) {
    fs.writeFileSync(path.join(source, name), 'bundle-installer/' + name);
  }
  fs.mkdirSync(path.join(source, 'data'));
  fs.writeFileSync(path.join(source, 'data', 'report_retry_queue.json'), '{"shouldNeverBeCopied":true}');
  fs.writeFileSync(path.join(source, 'config', 'identity.json'), '{"user":"shouldNeverBeCopied"}');
  fs.mkdirSync(path.join(source, 'scripts', '__pycache__'));
  fs.writeFileSync(path.join(source, 'scripts', '__pycache__', 'script.pyc'), 'runtime cache');
  return { root, source, home, target };
}

function writeLegacyInstall(target: string, version: string | null = '1.0.1') {
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(target, 'config'), { recursive: true });
  fs.mkdirSync(path.join(target, 'data'), { recursive: true });
  if (version) fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify({ version }));
  for (const name of FILES) fs.writeFileSync(path.join(target, 'scripts', name), 'existing/' + name);
  fs.writeFileSync(path.join(target, 'install.bat'), 'existing-installer');
  const identity = '{"user":"翁文秀","group":"设计体系管理组","machine":"old-pc"}';
  const retry = '{"session-one":{"session_id":"s1","group_name":"old"},"session-two":{"session_id":"s2"}}';
  const state = '{"collect_start_date":"2026-08-01","baselines":{"s1":{"last_total":100}}}';
  const log = 'historical log with 247 pending retries\n';
  const usage = '{"session_id":"previous"}\n';
  fs.writeFileSync(path.join(target, 'config', 'identity.json'), identity);
  fs.writeFileSync(path.join(target, 'config', 'server.json'), '{"url":"https://custom.example/report"}');
  fs.writeFileSync(path.join(target, 'data', 'report_retry_queue.json'), retry);
  fs.writeFileSync(path.join(target, 'data', 'collector_state.json'), state);
  fs.writeFileSync(path.join(target, 'data', 'cowork-collect.log'), log);
  fs.writeFileSync(path.join(target, 'data', 'usage.jsonl'), usage);
  return { identity, retry, state, log, usage };
}

function assertPreserved(target: string, original: ReturnType<typeof writeLegacyInstall>) {
  for (const [relative, expected] of [
    ['config/identity.json', original.identity],
    ['data/report_retry_queue.json', original.retry],
    ['data/collector_state.json', original.state],
    ['data/cowork-collect.log', original.log],
    ['data/usage.jsonl', original.usage],
  ] as const) {
    expect(fs.readFileSync(path.join(target, relative), 'utf8')).toBe(expected);
  }
  expect(fs.readFileSync(path.join(target, 'config', 'server.json'), 'utf8'))
    .toBe('{"url":"https://custom.example/report"}');
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ForDesigner cross-platform offline installation and upgrade', () => {
  it.each(['darwin', 'win32'] as const)(
    '%s installs once with the static group and does not import packaged data or identity',
    (platform) => {
      const { source, home, target } = createFixture();
      const session = {
        username: 'wengwenxiu5',
        userInfo: { displayName: '翁文秀', departmentDetail: '组织/旧组织/设计体系管理组' },
      };
      const result = ensureForDesignerInstalled(source, session, { homeDir: home, platform, launchProcesses: false });
      expect(result.status).toBe('installed');
      expect(result.installedVersion).toBe('1.0.2');
      expect(JSON.parse(fs.readFileSync(path.join(target, 'version.json'), 'utf8'))).toEqual({ version: '1.0.2' });
      expect(JSON.parse(fs.readFileSync(path.join(target, 'config', 'identity.json'), 'utf8')))
        .toMatchObject({ user: '翁文秀', group: '智能设计效能组' });
      expect(fs.existsSync(path.join(target, 'data'))).toBe(false);
      expect(fs.existsSync(path.join(target, 'scripts', '__pycache__'))).toBe(false);
      for (const name of FILES) {
        expect(fs.readFileSync(path.join(target, 'scripts', name), 'utf8')).toBe('bundle-1.0.2/' + name);
      }
      for (const name of DEFAULTS) expect(fs.existsSync(path.join(target, 'config', name))).toBe(true);
    },
  );

  it.each(['darwin', 'win32'] as const)(
    '%s upgrades a legacy installation while preserving identity, queue, baselines and log',
    (platform) => {
      const { source, home, target } = createFixture();
      const original = writeLegacyInstall(target);
      const result = ensureForDesignerInstalled(source, {
        username: 'another-account', userInfo: { displayName: '翁文秀', departmentDetail: '旧部门/某个新名字' },
      }, { homeDir: home, platform, launchProcesses: false });
      expect(result.status).toBe('upgraded');
      expect(result.installedVersion).toBe('1.0.2');
      assertPreserved(target, original);
      for (const name of FILES) {
        expect(fs.readFileSync(path.join(target, 'scripts', name), 'utf8')).toBe('bundle-1.0.2/' + name);
      }
      const before = fs.statSync(path.join(target, 'version.json')).mtimeMs;
      const second = ensureForDesignerInstalled(source, {
        username: 'newer-login', userInfo: { displayName: '张亚婷5' },
      }, { homeDir: home, platform, launchProcesses: false });
      expect(second.status).toBe('unchanged');
      expect(fs.statSync(path.join(target, 'version.json')).mtimeMs).toBe(before);
      assertPreserved(target, original);
    },
  );

  it('does not downgrade newer scripts or newer installer entrypoints', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target, '1.0.3');
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'darwin', launchProcesses: false });
    expect(result).toMatchObject({ status: 'unchanged', installedVersion: '1.0.3' });
    expect(fs.readFileSync(path.join(target, 'scripts', 'collect_cowork.py'), 'utf8'))
      .toBe('existing/collect_cowork.py');
    expect(fs.readFileSync(path.join(target, 'install.bat'), 'utf8')).toBe('existing-installer');
    assertPreserved(target, original);
  });

  it('repairs an incomplete same-version installation without resetting data', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target, '1.0.2');
    fs.unlinkSync(path.join(target, 'scripts', 'static_org_map.py'));
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'win32', launchProcesses: false });
    expect(result.status).toBe('upgraded');
    expect(fs.readFileSync(path.join(target, 'scripts', 'static_org_map.py'), 'utf8'))
      .toBe('bundle-1.0.2/static_org_map.py');
    assertPreserved(target, original);
  });

  it('repairs stale script bytes when the version marker already says v1.0.2', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target, '1.0.2');
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'win32', launchProcesses: false });
    expect(result.status).toBe('upgraded');
    for (const name of FILES) {
      expect(fs.readFileSync(path.join(target, 'scripts', name), 'utf8')).toBe('bundle-1.0.2/' + name);
    }
    assertPreserved(target, original);
  });

  it('adopts the bundle marker when unversioned scripts match, ignoring Python cache', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target, null);
    for (const name of FILES) fs.copyFileSync(path.join(source, 'scripts', name), path.join(target, 'scripts', name));
    fs.mkdirSync(path.join(target, 'scripts', '__pycache__'));
    fs.writeFileSync(path.join(target, 'scripts', '__pycache__', 'x.pyc'), 'must survive');
    const before = fs.statSync(path.join(target, 'scripts', 'collect_cowork.py')).mtimeMs;
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'darwin', launchProcesses: false });
    expect(result).toMatchObject({ status: 'unchanged', installedVersion: '1.0.2' });
    expect(fs.statSync(path.join(target, 'scripts', 'collect_cowork.py')).mtimeMs).toBe(before);
    expect(fs.readFileSync(path.join(target, 'scripts', '__pycache__', 'x.pyc'), 'utf8')).toBe('must survive');
    assertPreserved(target, original);
  });

  it('defers unknown unversioned scripts instead of assuming they are older', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target, null);
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'win32', launchProcesses: false });
    expect(result.status).toBe('deferred');
    expect(result.installedVersion).toBeNull();
    expect(fs.existsSync(path.join(target, 'version.json'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'scripts', 'collect_cowork.py'), 'utf8'))
      .toBe('existing/collect_cowork.py');
    expect(fs.readFileSync(path.join(target, 'install.bat'), 'utf8')).toBe('existing-installer');
    assertPreserved(target, original);
  });

  it('does not replace scripts while the hourly Python updater owns the shared lock', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target);
    fs.writeFileSync(path.join(target, '.for-designer-update.lock'), 'hourly-python-process');
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'darwin', launchProcesses: false });
    expect(result.status).toBe('deferred');
    expect(result.installedVersion).toBe('1.0.1');
    expect(fs.readFileSync(path.join(target, 'scripts', 'collect_cowork.py'), 'utf8'))
      .toBe('existing/collect_cowork.py');
    assertPreserved(target, original);
    expect(fs.readFileSync(path.join(target, '.for-designer-update.lock'), 'utf8'))
      .toBe('hourly-python-process');
  });

  it('fails closed and rolls back if an update bundle is incomplete', () => {
    const { source, home, target } = createFixture();
    const original = writeLegacyInstall(target);
    fs.rmSync(path.join(source, 'scripts', 'parse.py'));
    expect(() => ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'win32', launchProcesses: false })).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(target, 'version.json'), 'utf8')).version).toBe('1.0.1');
    expect(fs.readFileSync(path.join(target, 'scripts', 'collect_cowork.py'), 'utf8'))
      .toBe('existing/collect_cowork.py');
    assertPreserved(target, original);
    expect(fs.existsSync(path.join(target, '.for-designer-update.lock'))).toBe(false);
  });

  it('does not create a user directory when the app bundle is absent', () => {
    const { source, home, target } = createFixture();
    fs.rmSync(path.join(source, 'scripts', 'collect_cowork.py'));
    const result = ensureForDesignerInstalled(source, { username: '翁文秀' },
      { homeDir: home, platform: 'darwin', launchProcesses: false });
    expect(result.status).toBe('missing-bundle');
    expect(fs.existsSync(target)).toBe(false);
  });
});
