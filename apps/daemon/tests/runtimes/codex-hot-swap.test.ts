import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { switchToInstalledCodexCli } from '../../src/runtimes/codex-hot-swap.js';
import {
  ensureDetectedRuntimeVersions,
  getDetectedRuntimeVersions,
} from '../../src/runtimes/detection.js';
import { codexAgentDef } from '../../src/runtimes/defs/codex.js';
import {
  clearPreferredInstalledCodexExecutable,
  resolveAgentExecutable,
} from '../../src/runtimes/executables.js';
import {
  forgetRememberedLiveModels,
  getRememberedLiveModels,
  rememberLiveModels,
} from '../../src/runtimes/models.js';

const envSnapshot = {
  PATH: process.env.PATH,
  CODEX_BIN: process.env.CODEX_BIN,
  OD_AGENT_HOME: process.env.OD_AGENT_HOME,
};
const roots: string[] = [];

function fakeCodex(home: string, relative: string, version: string, delayMs = 0): string {
  const filename = path.join(home, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  const sleep = delayMs > 0 ? 'sleep 0.2\n' : '';
  writeFileSync(filename, '#!/bin/sh\n' + sleep + 'printf "%s\\n" "codex-cli ' + version + '"\n');
  chmodSync(filename, 0o755);
  return filename;
}

afterEach(() => {
  clearPreferredInstalledCodexExecutable();
  agentCapabilities.delete('codex');
  forgetRememberedLiveModels('codex');
  forgetRememberedLiveModels('claude');
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform !== 'win32')('Codex seamless upgrade', () => {
  it('promotes a verified official binary above a configured older CLI and refreshes cached versions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'codex-hot-swap-'));
    roots.push(root);
    process.env.OD_AGENT_HOME = root;
    const oldBin = fakeCodex(root, 'old/codex', '0.145.0');
    const newBin = fakeCodex(root, '.local/bin/codex', '0.161.0');
    process.env.PATH = path.dirname(oldBin) + path.delimiter + (envSnapshot.PATH ?? '');
    process.env.CODEX_BIN = oldBin;
    const configured = { CODEX_BIN: oldBin };

    expect(resolveAgentExecutable(codexAgentDef, configured)).toBe(oldBin);
    expect((await ensureDetectedRuntimeVersions('codex', configured))?.agentCliVersion).toContain('0.145.0');
    agentCapabilities.set('codex', {});
    rememberLiveModels('codex', [{ id: 'stale-old-model', label: 'Old model' }]);
    rememberLiveModels('claude', [{ id: 'unrelated-model', label: 'Keep' }]);

    expect(switchToInstalledCodexCli()).toBe(true);
    expect(resolveAgentExecutable(codexAgentDef, configured)).toBe(newBin);
    expect(getDetectedRuntimeVersions('codex')).toBeNull();
    expect(agentCapabilities.has('codex')).toBe(false);
    expect(getRememberedLiveModels('codex')).toEqual([]);
    expect(getRememberedLiveModels('claude')).toEqual([
      { id: 'unrelated-model', label: 'Keep' },
    ]);
    expect((await ensureDetectedRuntimeVersions('codex', configured))?.agentCliVersion).toContain('0.161.0');
  });

  it('rejects a missing official CLI without touching existing capability data', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'codex-hot-swap-missing-'));
    roots.push(root);
    process.env.OD_AGENT_HOME = root;
    const oldBin = fakeCodex(root, 'old/codex', '0.145.0');
    const configured = { CODEX_BIN: oldBin };
    agentCapabilities.set('codex', {});

    expect(switchToInstalledCodexCli()).toBe(false);
    expect(resolveAgentExecutable(codexAgentDef, configured)).toBe(oldBin);
    expect(agentCapabilities.has('codex')).toBe(true);
  });

  it('rejects a stale version probe result after a successful upgrade notification', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'codex-hot-swap-probe-'));
    roots.push(root);
    process.env.OD_AGENT_HOME = root;
    const oldBin = fakeCodex(root, 'old/codex', '0.145.0', 200);
    fakeCodex(root, '.local/bin/codex', '0.161.0');
    process.env.CODEX_BIN = oldBin;
    const configured = { CODEX_BIN: oldBin };
    const oldProbe = ensureDetectedRuntimeVersions('codex', configured);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switchToInstalledCodexCli()).toBe(true);
    await oldProbe;
    expect(getDetectedRuntimeVersions('codex')).toBeNull();
    expect((await ensureDetectedRuntimeVersions('codex', configured))?.agentCliVersion).toContain('0.161.0');
  });
});
