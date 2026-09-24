import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/components/ProjectReferenceModal.module.css', import.meta.url),
  'utf8',
);

function cssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

function ruleValue(block: string, property: string): string {
  const match = new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

describe('project reference modal styles', () => {
  it('does not apply hover or focus styling to selected project rows', () => {
    const selectedHover = cssBlock('.item.itemSelected:hover:not(:disabled)');

    expect(css).toContain('.item:not(.itemSelected):hover');
    expect(css).toContain('.item:not(.itemSelected):focus-visible');
    expect(css).not.toMatch(/\.item:hover[\s,\{]/);
    expect(ruleValue(selectedHover, 'border-color')).toBe('transparent');
    expect(ruleValue(selectedHover, 'background')).toBe(
      'var(--color-surface, var(--bg-elevated))',
    );
    expect(ruleValue(selectedHover, 'box-shadow')).toBe('none');
  });

  it('matches the publish picker row geometry and shows six complete projects', () => {
    const browser = cssBlock('.browser');
    const list = cssBlock('.list');
    const item = cssBlock('.item');
    const cover = cssBlock('.itemCover');

    expect(ruleValue(browser, 'grid-template-columns')).toBe('184px minmax(0, 1fr)');
    // Six 54px rows + five 3px gaps = 339px.
    expect(ruleValue(list, 'max-height')).toBe('339px');
    expect(ruleValue(list, 'gap')).toBe('3px');
    expect(ruleValue(list, 'padding')).toBe('0');
    expect(ruleValue(item, 'min-height')).toBe('54px');
    expect(ruleValue(item, 'grid-template-columns')).toBe('42px minmax(0, 1fr) 20px');
    expect(ruleValue(cover, 'width')).toBe('40px');
    expect(ruleValue(cover, 'height')).toBe('30px');
  });
});
