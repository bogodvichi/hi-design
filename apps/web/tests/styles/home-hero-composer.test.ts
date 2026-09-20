import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeHeroCss = readFileSync(new URL('../../src/styles/home/home-hero.css', import.meta.url), 'utf8');
const entranceCss = readFileSync(new URL('../../src/styles/entrance.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(new URL('../../src/styles/viewer/routines.css', import.meta.url), 'utf8');
const projectViewSource = readFileSync(new URL('../../src/components/ProjectView.tsx', import.meta.url), 'utf8');

function cssDeclarations(selector: string, css = homeHeroCss): string {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) return match[2] ?? '';
  }

  throw new Error(`Missing CSS block for ${selector}`);
}

function ruleValue(block: string, property: string): string {
  const match = block.match(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

describe('home hero composer visual contract', () => {
  it('keeps the inner prompt frame inset from the outer tray', () => {
    const outerCard = cssDeclarations('.home-hero__composer-card');
    const innerCard = cssDeclarations('.home-hero__input-card');

    expect(ruleValue(outerCard, 'padding')).toBe(
      'var(--spacing-4) var(--spacing-4) var(--spacing-8)',
    );
    expect(ruleValue(outerCard, 'border-radius')).toBe('20px');
    expect(ruleValue(innerCard, 'border-radius')).toBe('16px');
  });

  it('uses the approved shared Home background and composer surface colors', () => {
    const page = cssDeclarations(
      ".workspace-shell:has(.entry-main__view-home[data-active='true'])",
    );
    const outerCard = cssDeclarations('.home-hero__composer-card');
    const focusedOuterCard = cssDeclarations('.home-hero__composer-card:focus-within');
    const innerCard = cssDeclarations('.workspace-shell--web .home-hero__input-card');

    expect(ruleValue(page, 'background')).toBe('#e6e6e6');
    expect(ruleValue(outerCard, 'background')).toBe('#f5f5f5');
    expect(ruleValue(focusedOuterCard, 'background')).toBe('#f5f5f5');
    expect(ruleValue(innerCard, 'background')).toBe('#ffffff');
  });

  it('lets the focused state replace the transparent resting stroke', () => {
    const innerCard = cssDeclarations('.home-hero__input-card');
    const focusedCard = cssDeclarations('.home-hero__input-card:focus-within');

    expect(ruleValue(innerCard, 'border')).toBe('var(--stroke-thin) solid transparent');
    expect(ruleValue(focusedCard, 'border-color')).toBe('var(--border-strong)');
  });

  it('keeps the shared input frame out of entrance transforms', () => {
    const projectInput = cssDeclarations('.composer-surface--project > .home-hero__input-card');

    expect(entranceCss).not.toMatch(/home-hero__input-card/);
    expect(ruleValue(projectInput, 'animation')).toBe('none');
    expect(ruleValue(projectInput, 'transform')).toBe('none');
  });

  it('removes the hidden current-workspace row from fixed composer layout', () => {
    const hiddenCurrentWorkspace = cssDeclarations(
      '.chat-composer-fixed-layer .composer-outside-contexts--current-only',
      routinesCss,
    );

    expect(ruleValue(hiddenCurrentWorkspace, 'display')).toBe('none');
  });

  it('uses the same compact model switcher in Home and project composers', () => {
    const execution = cssDeclarations(
      '.app .composer-row .home-hero__execution-switcher',
      routinesCss,
    );

    expect(projectViewSource).toContain('<InlineModelSwitcher');
    expect(projectViewSource).not.toContain('<AvatarMenu');
    expect(ruleValue(execution, 'min-width')).toBe('104px');
    expect(ruleValue(execution, 'flex')).toBe('0 0 104px');
  });

  it('lets the bottom-anchored directory menu override the shared downward placement', () => {
    const upwardPanel = cssDeclarations(
      ".home-hero__working-dir-picker [data-testid='working-dir-panel'][data-placement='up']",
    );

    expect(ruleValue(upwardPanel, 'top')).toBe('auto');
    expect(ruleValue(upwardPanel, 'bottom')).toBe('calc(100% + 6px)');
  });
});
