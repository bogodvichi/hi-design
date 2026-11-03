import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureForDesignerInstalled } from '../src/http/hik_logins/for-designer.js';

const workspaces: string[] = [];
function fixture(version = '1.0.2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fordesigner-upgrade-'));
  workspaces.push(root);
  const source = path.join(root, 'bundle', 'for-designer');
  const home = path.join(root, 'home');
  const installed = path.join(home, 'for-designer');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  for (const [name, content] of Object.entries({
    'collect_cowork.py': '# collector 1.0.2',
    'parse.py': '# parse 1.0.2',
    'update_collector.py': '# updater 1.0.2',
    'static_org_map.py': '# map 1.0.2',
  })) fs.writeFileSync(path.join(source, 'scripts', name), content);
  fs.writeFileSync(path.join(source, 'version.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(source, 'config', 'member-groups.json'), JSON.stringify({
    '翁文秀': '智能设计效能组',
    '张亚婷5': '基础平台设计组',
  }));
  for (const name of ['server.json', 'groups.json', 'group-map.json', 'pricing.json']) {
    fs.writeFileSync(path.join(source, 'config', name), JSON.stringify({ name, bundled: true }));
  }
  for (const name of ['install.bat', 'install.command', 'install.ps1']) {
    fs.writeFileSync(path.join(source, name), `bundle ${name}\n`);
  }
  fs.mkdirSync(path.join(source, 'data'));
  fs.writeFileSync(path.join(source, 'data', 'collector_state.json'), '{}');
  fs.writeFileSync(path.join(source, 'data', 'report_retry_queue.json'), '{}');
  return { root, source, home, installed };
}
function seedExisting(
  installed: string,
  version = '1.0.1',
  collector = '# collector 1.0.1',
) {
  fs.mkdirSync(path.join(installed, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(installed, 'config'), { recursive: true });
  fs.mkdirSync(path.join(installed, 'data'), { recursive: true });
  fs.writeFileSync(path.join(installed, 'version.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(installed, 'scripts', 'collect_cowork.py'), collector);
  fs.writeFileSync(path.join(installed, 'scripts', 'parse.py'), 'old parse');
  fs.writeFileSync(path.join(installed, 'config', 'identity.json'), JSON.stringify({
    user: '翁文秀', group: '旧分组', machine: 'old-machine',
  }));
  fs.writeFileSync(path.join(installed, 'config', 'server.json'), 'old server config');
  fs.writeFileSync(path.join(installed, 'data', 'collector_state.json'), '{"baselines":{"old":42}}');
  fs.writeFileSync(path.join(installed, 'data', 'report_retry_queue.json'), '{"retry":{"session_id":"old"}}');
  fs.writeFileSync(path.join(installed, 'data', 'usage.jsonl'), 'historical usage\n');
  fs.writeFileSync(path.join(installed, 'data', 'cowork-collect.log'), 'historical log\n');
}
function read(installed: string, relative: string) {
  return fs.readFileSync(path.join(installed, relative), 'utf8');
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.each(['darwin', 'win32'] as const)('ForDesigner %s installation / upgrade', (platform) => {
  it('installs fresh with static identity, v1.0.2, and does not seed data state', () => {
    const { source, home, installed } = fixture();
    const result = ensureForDesignerInstalled(source, {
      username: 'wengwenxiu', userInfo: { displayName: '翁文秀' },
    }, { homeDir: home, platform, launchProcesses: false });
    expect(result.status).toBe('installed');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.2');
    expect(JSON.parse(read(installed, 'config/identity.json'))).toMatchObject({
      user: '翁文秀', group: '智能设计效能组',
    });
    expect(read(installed, 'scripts/static_org_map.py')).toBe('# map 1.0.2');
    expect(fs.existsSync(path.join(installed, 'data', 'collector_state.json'))).toBe(false);
    expect(fs.existsSync(path.join(installed, 'data', 'report_retry_queue.json'))).toBe(false);
    expect(fs.existsSync(path.join(installed, 'install.command'))).toBe(true);
    expect(fs.existsSync(path.join(installed, 'install.bat'))).toBe(true);
  });

  it('upgrades older scripts while preserving identity and every data file byte-for-byte', () => {
    const { source, home, installed } = fixture();
    seedExisting(installed);
    const before = Object.fromEntries(
      ['config/identity.json', 'config/server.json', 'data/collector_state.json',
        'data/report_retry_queue.json', 'data/usage.jsonl', 'data/cowork-collect.log']
        .map((file) => [file, read(installed, file)]),
    );
    const result = ensureForDesignerInstalled(source, {
      username: 'new-account', userInfo: {
        displayName: '张亚婷5',
      },
    }, { homeDir: home, platform, launchProcesses: false });
    expect(result.status).toBe('upgraded');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.2');
    expect(read(installed, 'scripts/collect_cowork.py')).toBe('# collector 1.0.2');
    for (const [file, content] of Object.entries(before)) {
      expect(read(installed, file), file).toBe(content);
    }
    expect(fs.readdirSync(installed).some((entry) => entry.startsWith('.scripts-hidesign-'))).toBe(false);
  });

  it('repeat login is idempotent, does not change script mtimes or touch identity/data', () => {
    const { source, home, installed } = fixture();
    seedExisting(installed, '1.0.2', '# collector 1.0.2');
    // Same-version installation already has the exact four bundle scripts.
    for (const name of fs.readdirSync(path.join(source, 'scripts'))) {
      fs.copyFileSync(path.join(source, 'scripts', name), path.join(installed, 'scripts', name));
    }
    const code = path.join(installed, 'scripts/collect_cowork.py');
    const before = fs.statSync(code).mtimeMs;
    const snapshot = read(installed, 'data/report_retry_queue.json');
    const first = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    const second = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    expect(first.status).toBe('unchanged');
    expect(second.status).toBe('unchanged');
    expect(fs.statSync(code).mtimeMs).toBe(before);
    expect(read(installed, 'data/report_retry_queue.json')).toBe(snapshot);
    expect(JSON.parse(read(installed, 'config/identity.json')).group).toBe('旧分组');
  });

  it('never downgrades newer server-delivered versions', () => {
    const { source, home, installed } = fixture('1.0.2');
    seedExisting(installed, '1.0.3', '# collector 1.0.3');
    const result = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    expect(result.status).toBe('unchanged');
    expect(read(installed, 'scripts/collect_cowork.py')).toBe('# collector 1.0.3');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.3');
  });

  it('adopts a missing version marker only when bundled scripts exactly match', () => {
    const { source, home, installed } = fixture();
    seedExisting(installed);
    fs.rmSync(path.join(installed, 'version.json'));
    const unknown = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    expect(unknown.status).toBe('deferred');
    expect(fs.existsSync(path.join(installed, 'version.json'))).toBe(false);
    expect(read(installed, 'scripts/collect_cowork.py')).toBe('# collector 1.0.1');
    // A bundle already copied by the legacy client must not be recopied.
    for (const name of fs.readdirSync(path.join(source, 'scripts'))) {
      fs.copyFileSync(path.join(source, 'scripts', name), path.join(installed, 'scripts', name));
    }
    const repaired = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    expect(repaired.status).toBe('unchanged');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.2');
  });

  it('defers replacement while Python owns the update lock', () => {
    const { source, home, installed } = fixture();
    seedExisting(installed);
    fs.writeFileSync(path.join(installed, '.for-designer-update.lock'), 'python-lock');
    const result = ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false });
    expect(result.status).toBe('deferred');
    expect(read(installed, 'scripts/collect_cowork.py')).toBe('# collector 1.0.1');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.1');
    expect(read(installed, '.for-designer-update.lock')).toBe('python-lock');
  });

  it('rolls back script replacement and version when bundled script is missing', () => {
    const { source, home, installed } = fixture();
    seedExisting(installed);
    fs.rmSync(path.join(source, 'scripts', 'parse.py'));
    expect(() => ensureForDesignerInstalled(source, { userInfo: { displayName: '翁文秀' } },
      { homeDir: home, platform, launchProcesses: false })).toThrow();
    expect(read(installed, 'scripts/collect_cowork.py')).toBe('# collector 1.0.1');
    expect(JSON.parse(read(installed, 'version.json')).version).toBe('1.0.1');
    expect(read(installed, 'data/report_retry_queue.json')).toBe('{"retry":{"session_id":"old"}}');
  });
});
