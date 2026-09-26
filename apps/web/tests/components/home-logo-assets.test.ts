import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const homeHeroSource = read('../../src/components/HomeHero.tsx');
const entryNavRailSource = read('../../src/components/EntryNavRail.tsx');
const logoSvg = read('../../public/logo.svg');
const brandIconSvg = read('../../public/brand-icon.svg');

// The current Hi Design brand glyph is the connected-nodes superellipse tile:
// a rounded square whose two node clusters are cut out of the fill, so every
// export of the mark starts with this clip-path command.
const CURRENT_GLYPH_PATH_PREFIX = 'M41,0 C76.5753032';
// Retired glyphs: the 444x444 dark tile (#202020) whose cursor arrow started at
// M212.059, and the ink superellipse cursor mark whose outline started at
// "M41 0.726562" (space-separated) — both must be gone from the exports.
const RETIRED_GLYPH_MARKERS = ['#202020', 'M212.059', 'width="444"', 'M41 0.726562'];

describe('Home logo assets', () => {
  it('ships the current brand glyph in the public logo assets', () => {
    expect(logoSvg).toContain(CURRENT_GLYPH_PATH_PREFIX);
    expect(brandIconSvg).toContain(CURRENT_GLYPH_PATH_PREFIX);
    for (const marker of RETIRED_GLYPH_MARKERS) {
      expect(logoSvg).not.toContain(marker);
      expect(brandIconSvg).not.toContain(marker);
    }
  });

  it('keeps brand-icon.svg maskable (theme color comes from CSS)', () => {
    expect(brandIconSvg).toContain('currentColor');
  });

  it('renders the brand glyph on both Home entry surfaces', () => {
    expect(homeHeroSource).toContain('od-brand-glyph');
    expect(homeHeroSource).not.toContain('src="/app-icon.svg"');

    expect(entryNavRailSource).toContain('od-brand-glyph');
    expect(entryNavRailSource).not.toContain('src="/app-icon.svg"');
  });
});
