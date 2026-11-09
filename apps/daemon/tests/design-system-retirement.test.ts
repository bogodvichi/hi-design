import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase, updateProject } from '../src/db.js';

const roots: string[] = [];
afterEach(() => {
  closeDatabase();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('retires old bindings on upgrade without deleting projects', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'od-retire-design-systems-'));
  roots.push(root);
  let db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'historical', name: 'Preserved project', createdAt: 1, updatedAt: 1 });
  db.prepare("UPDATE projects SET design_system_id = 'apple' WHERE id = 'historical'").run();
  const projectFiles = path.join(root, 'projects', 'historical');
  mkdirSync(projectFiles, { recursive: true });
  writeFileSync(path.join(projectFiles, 'DESIGN.md'), '# User reference\n');
  db.prepare("INSERT INTO conversations (id, project_id, created_at, updated_at) VALUES ('history', 'historical', 1, 1)").run();
  closeDatabase();
  db = openDatabase(root, { dataDir: root });
  expect(getProject(db, 'historical')).toMatchObject({ id: 'historical', name: 'Preserved project', designSystemId: null });
  expect(readFileSync(path.join(projectFiles, 'DESIGN.md'), 'utf8')).toBe('# User reference\n');
  expect(db.prepare("SELECT id FROM conversations WHERE id = 'history'").get()).toEqual({ id: 'history' });
  insertProject(db, { id: 'imported', name: 'Imported project', designSystemId: 'hui', createdAt: 2, updatedAt: 2 });
  updateProject(db, 'imported', { designSystemId: 'apple' });
  expect(getProject(db, 'imported')?.designSystemId).toBeNull();
});
