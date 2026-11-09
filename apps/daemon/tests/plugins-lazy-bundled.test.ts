import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migratePlugins } from '../src/plugins/persistence.js';
import { configureLazyBundledPlugins, registerBundledPlugins } from '../src/plugins/bundled.js';
import { getInstalledPlugin, listInstalledPlugins } from '../src/plugins/registry.js';
import { loadAtomBodies, loadBundledAtomBodiesStrict } from '../src/plugins/atom-bodies.js';
import { grantCapabilities } from '../src/plugins/trust.js';

let db: Database.Database;
let root: string;
const rows = () => db.prepare('SELECT id FROM installed_plugins ORDER BY id').all();

async function fixture(folder: string, id: string) {
  const dir = path.join(root, 'atoms', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'open-design.json'), JSON.stringify({
    name: id, title: id, version: '0.1.0', description: 'fixture',
    od: { kind: 'atom', capabilities: ['prompt:inject'] },
  }));
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: fixture\n---\n# ${id}\n`);
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'od-lazy-bundled-'));
  db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE conversations (id TEXT PRIMARY KEY);');
  migratePlugins(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await rm(root, { recursive: true, force: true });
});

describe('lazy bundled plugins', () => {
  it('does no registration at setup or catalog read, then registers only the referenced plugin', async () => {
    configureLazyBundledPlugins({ db, bundledRoot: root });
    expect(rows()).toEqual([]);
    // Content appears after configuration: setup must not scan or cache an empty root.
    await fixture('first', 'example-first');
    const second = await fixture('second', 'example-second');
    await writeFile(path.join(second, 'preview.html'), '<html>Preview bytes</html>');
    const reads = vi.spyOn(fs, 'readFileSync');
    expect(listInstalledPlugins(db).map((p) => p.id).sort()).toEqual(['example-first', 'example-second']);
    expect(rows()).toEqual([]);
    expect(reads.mock.calls.some(([file]) => String(file).endsWith('preview.html'))).toBe(false);
    expect(getInstalledPlugin(db, 'example-second')?.sourceKind).toBe('bundled');
    expect(rows()).toEqual([{ id: 'example-second' }]);
    expect(reads.mock.calls.filter(([file]) => String(file).endsWith('preview.html'))).toHaveLength(1);
    const first = getInstalledPlugin(db, 'example-second');
    expect(getInstalledPlugin(db, 'example-second')).toEqual(first);
    expect(reads.mock.calls.filter(([file]) => String(file).endsWith('preview.html'))).toHaveLength(1);
    expect(getInstalledPlugin(db, 'missing')).toBeNull();
  });

  it('resolves a direct reference before any listing without loading unrelated skill bodies', async () => {
    await fixture('first', 'example-first');
    const second = await fixture('second', 'example-second');
    configureLazyBundledPlugins({ db, bundledRoot: root });
    const reads = vi.spyOn(fs, 'readFileSync');
    expect(getInstalledPlugin(db, 'example-first')?.id).toBe('example-first');
    expect(reads.mock.calls.some(([file]) => String(file) === path.join(second, 'SKILL.md'))).toBe(false);
    expect(rows()).toEqual([{ id: 'example-first' }]);
  });

  it('preserves unchanged timestamps and subsequent capability grants', async () => {
    await fixture('first', 'first');
    await registerBundledPlugins({ db, bundledRoot: root });
    const previous = getInstalledPlugin(db, 'first');
    configureLazyBundledPlugins({ db, bundledRoot: root });
    expect(getInstalledPlugin(db, 'first')).toEqual(previous);
    grantCapabilities({ db, pluginId: 'first', capabilities: ['fs:read'] });
    expect(getInstalledPlugin(db, 'first')?.capabilitiesGranted).toContain('fs:read');
    expect(listInstalledPlugins(db)[0]?.capabilitiesGranted).toContain('fs:read');
  });

  it('retains persisted bundled records if the resource root is missing', async () => {
    await fixture('first', 'first');
    await registerBundledPlugins({ db, bundledRoot: root });
    configureLazyBundledPlugins({ db, bundledRoot: path.join(root, 'missing') });
    expect(getInstalledPlugin(db, 'first')?.id).toBe('first');
    expect(rows()).toEqual([{ id: 'first' }]);
  });

  it('loads ordinary and strict atom dependencies without preinstalled rows', async () => {
    await fixture('todo-write', 'todo-write');
    await fixture('direction-picker', 'direction-picker');
    configureLazyBundledPlugins({ db, bundledRoot: root });
    expect((await loadAtomBodies(db, ['todo-write']))[0]?.body).toContain('# todo-write');
    expect((await loadBundledAtomBodiesStrict(db, ['direction-picker']))[0]?.body).toContain('# direction-picker');
    expect(rows()).toEqual([{ id: 'direction-picker' }, { id: 'todo-write' }]);
  });

  it('reconciles removed content and refreshes changed content on an upgraded runtime', async () => {
    const folder = await fixture('kept', 'kept');
    await fixture('removed', 'removed');
    await registerBundledPlugins({ db, bundledRoot: root });
    await rm(path.join(root, 'atoms', 'removed'), { recursive: true });
    await writeFile(path.join(folder, 'SKILL.md'), '---\nname: kept\ndescription: updated\n---\nChanged body');
    configureLazyBundledPlugins({ db, bundledRoot: root });
    expect(listInstalledPlugins(db).map((p) => p.id)).toEqual(['kept']);
    expect(getInstalledPlugin(db, 'removed')).toBeNull();
    expect(getInstalledPlugin(db, 'kept')?.manifest.description).toBe('fixture');
    expect((await loadAtomBodies(db, ['kept']))[0]?.body).toBe('Changed body');
  });

  it('keeps internal strategy packages out of lazy catalog and direct lookup', async () => {
    await cp(path.resolve(import.meta.dirname, '../../../plugins/_official/scenarios/od-next-strategy'),
      path.join(root, 'scenarios', 'od-next-strategy'), { recursive: true });
    configureLazyBundledPlugins({ db, bundledRoot: root });
    expect(listInstalledPlugins(db)).toEqual([]);
    expect(getInstalledPlugin(db, 'od-next-strategy')).toBeNull();
    expect(rows()).toEqual([]);
  });
});
