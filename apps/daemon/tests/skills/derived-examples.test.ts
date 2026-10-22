import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSkillById, listSkills, resolveDerivedExamplePath } from '../../src/skills.js';

describe('Skill example catalog entries', () => {
  let root: string;
  let dir: string;
  const id = 'ued-requirement-analysis';
  const keys = ['analysis-report', 'dashboard-analysis-report', 'single-view-analysis-report'];

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-skill-examples-'));
    dir = path.join(root, id);
    await mkdir(path.join(dir, 'examples'), { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Analyze requirements.\n---\nFollow the requirement analysis workflow.\n`);
    for (const key of keys) {
      await writeFile(path.join(dir, 'examples', `${key}.html`), `<main>${key}</main>`);
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('identifies the three examples separately from their selectable parent Skill', async () => {
    const catalog = await listSkills(root);
    expect(catalog).toHaveLength(4);
    expect(catalog.filter((entry) => !('parentSkillId' in entry))).toMatchObject([
      { id, aggregatesExamples: true },
    ]);
    for (const key of keys) {
      expect(findSkillById(catalog, `${id}:${key}`)).toMatchObject({
        parentSkillId: id,
        aggregatesExamples: false,
      });
    }
  });

  it.each(keys)('keeps the stored example id and preview usable for %s', async (key) => {
    const catalog = await listSkills(root);
    const parent = findSkillById(catalog, id)!;
    const example = findSkillById(catalog, `${id}:${key}`)!;
    expect(example.id).toBe(`${id}:${key}`);
    expect(example.body).toBe(parent.body);
    expect(example.body).toContain('Follow the requirement analysis workflow.');
    expect(await readFile(resolveDerivedExamplePath(example.dir, key)!, 'utf8'))
      .toBe(`<main>${key}</main>`);
    expect(findSkillById(catalog, `${id}:missing-example`)).toBeUndefined();
  });
});
