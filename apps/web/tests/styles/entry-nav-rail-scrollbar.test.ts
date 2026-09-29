import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entryLayoutCss = readFileSync(
  new URL('../../src/styles/home/entry-layout.css', import.meta.url),
  'utf8',
);
const entryNavRailSource = readFileSync(
  new URL('../../src/components/EntryNavRail.tsx', import.meta.url),
  'utf8',
);

describe('entry navigation scrollbar', () => {
  it('keeps an 8px scrollbar hidden until the panel is hovered', () => {
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__group::-webkit-scrollbar\s*\{\s*width:\s*8px;/u,
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__group::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*transparent;/u,
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__panel:hover\s+\.entry-nav-rail__group::-webkit-scrollbar-thumb\s*\{[^}]*background:/u,
    );
  });

  it('keeps the search row above and outside the scrolling directory', () => {
    expect(entryNavRailSource.indexOf('className="entry-nav-rail__search-row"')).toBeLessThan(
      entryNavRailSource.indexOf('className="entry-nav-rail__group"'),
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__group\s*\{[^}]*overflow-y:\s*auto;/u,
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__search-row\s*\{[^}]*flex:\s*0 0 auto;[^}]*padding:\s*4px 10px 0;/u,
    );
  });
});
