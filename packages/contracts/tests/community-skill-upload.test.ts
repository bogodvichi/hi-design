import { describe, expect, it } from 'vitest';
import { findSingleSkillEntry } from '../src/api/community.js';

describe('single Skill upload directory resolution', () => {
  it.each(['one/two/three/SKILL.md', 'one\\two\\three\\skill.md', 'SKILL.md'])('finds a unique manifest at any depth: %s', async manifest => {
    expect(await findSingleSkillEntry(['wrapper/README.md', manifest, 'one/two/assets/example.md'], async () => 'Reference')).toEqual({ ok: true, index: 1 });
  });
  it.each(['one/two/2SKILL.md', 'one/two/design-review.md', 'one/two/使用说明.MD'])('identifies a renamed Skill by its frontmatter: %s', async manifest => {
    const paths = ['wrapper/README.md', manifest, 'one/two/references/example.md'];
    const contents = ['Wrapper only', '---\nname: renamed-skill\n---\n# Skill', 'Example'];
    expect(await findSingleSkillEntry(paths, async index => contents[index]!)).toEqual({ ok: true, index: 1 });
  });
  it('rejects two renamed Skills without counting reference Markdown as a Skill', async () => {
    expect(await findSingleSkillEntry(['one/first.md', 'two/second.md'], async () => '---\nname: skill\n---')).toEqual({ ok: false, error: 'MULTIPLE_SKILLS' });
  });
  it('rejects a nested second manifest instead of selecting the first', async () => {
    expect(await findSingleSkillEntry(['SKILL.md', 'one/two/SKILL.md'], async () => '')).toEqual({ ok: false, error: 'MULTIPLE_SKILLS' });
  });
  it('reports a missing manifest', async () => {
    expect(await findSingleSkillEntry(['one/two/example.txt'], async () => 'Example')).toEqual({ ok: false, error: 'SKILL_MD_NOT_FOUND' });
  });
  it('selects a sole Markdown file so the caller can validate missing metadata', async () => {
    expect(await findSingleSkillEntry(['one/two/custom.md'], async () => '# Missing name')).toEqual({ ok: true, index: 0 });
  });
  it('ignores macOS ZIP metadata', async () => {
    expect(await findSingleSkillEntry(['__MACOSX/one/SKILL.md', 'one/SKILL.md'], async () => '')).toEqual({ ok: true, index: 1 });
  });
});
