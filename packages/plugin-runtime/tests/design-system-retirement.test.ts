import { expect, it } from 'vitest';
import { adaptAgentSkill, resolveContext } from '../src/index.js';

it('ignores legacy design-system context while retaining template assets', () => {
  const resolved = resolveContext({
    specVersion: '1.0.0', name: 'legacy-template', version: '1.0.0',
    od: { context: { designSystem: { ref: 'apple', primary: true }, assets: ['./example.html'] } },
  }, {
    registry: { skills: [], designSystems: [{ id: 'apple' }], craft: [], atoms: [], activeProjectDesignSystem: { id: 'apple' } },
    warnOnMissing: true,
  });
  expect(resolved.context.items.some(item => item.kind === 'design-system')).toBe(false);
  expect(resolved.digestRefs.some(item => item.kind === 'design-system')).toBe(false);
  expect(resolved.warnings).toEqual([]);
  expect(resolved.context.items).toContainEqual({ kind: 'asset', path: './example.html', label: 'example.html' });
});

it('does not synthesize design-system inheritance from old SKILL frontmatter', () => {
  const result = adaptAgentSkill('---\nname: template\nod:\n  design_system:\n    requires: true\n    ref: apple\n---\nUse the supplied HTML.', { folderId: 'template' });
  expect(result.manifest.od?.context?.designSystem).toBeUndefined();
});
