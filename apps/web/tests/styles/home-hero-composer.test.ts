import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeHeroCss = readFileSync(new URL('../../src/styles/home/home-hero.css', import.meta.url), 'utf8');

function cssDeclarations(selector: string): string {
  const cssWithoutComments = homeHeroCss.replace(/\/\*[\s\S]*?\*\//g, '');
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
});
