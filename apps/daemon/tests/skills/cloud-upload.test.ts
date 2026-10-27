import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupSkillTempDir,
  prepareSkillFromFiles,
  prepareSkillFromZip,
} from '../../src/skills/cloud-upload.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'od-cloud-skill-upload-'));
});

afterEach(async () => {
  await cleanupSkillTempDir(tempRoot).catch(() => {});
  rmSync(tempRoot, { recursive: true, force: true });
});

async function zipFor(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) {
    zip.file(name, body);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('cloud skill upload metadata', () => {
  it('reads the description from a zipped SKILL.md', async () => {
    const buffer = await zipFor({
      'design-helper/SKILL.md': [
        '---',
        'name: Design Helper',
        'description: Turns brand notes into a design system.',
        '---',
        '',
        'Use the helper.',
      ].join('\n'),
    });

    const prepared = await prepareSkillFromZip(buffer, tempRoot);

    expect(prepared).toMatchObject({
      slug: 'design-helper',
      title: 'Design Helper',
      description: 'Turns brand notes into a design system.',
    });
  });

  it('omits the description when the zipped SKILL.md has none', async () => {
    const buffer = await zipFor({
      'plain-skill/SKILL.md': [
        '---',
        'name: Plain Skill',
        '---',
        '',
        'No description here.',
      ].join('\n'),
    });

    const prepared = await prepareSkillFromZip(buffer, tempRoot);

    expect(prepared).toMatchObject({ slug: 'plain-skill', title: 'Plain Skill' });
    expect('description' in prepared).toBe(false);
  });

  it('reads multi-line descriptions from uploaded files', async () => {
    const prepared = await prepareSkillFromFiles(
      [{
        path: 'SKILL.md',
        body: Buffer.from([
          '---',
          'name: Block Skill',
          'description: |',
          '  First line.',
          '  Second line.',
          '---',
          '',
          'Body',
        ].join('\n'), 'utf8'),
      }],
      tempRoot,
    );

    expect(prepared.description).toBe('First line.\nSecond line.');
  });

  it('keeps folder fallback metadata when frontmatter cannot be parsed', async () => {
    const prepared = await prepareSkillFromFiles(
      [{
        path: 'legacy-skill/SKILL.md',
        body: Buffer.from('---\nname:\n  - a\n    - b\n---\nBody', 'utf8'),
      }],
      tempRoot,
    );

    expect(prepared).toMatchObject({ slug: 'legacy-skill', title: 'legacy-skill' });
    expect('description' in prepared).toBe(false);
  });
});
