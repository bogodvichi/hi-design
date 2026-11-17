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
  it('uses the shared native scrollbar instead of page-specific hover and pixel styling', () => {
    expect(entryLayoutCss).not.toContain('::-webkit-scrollbar-thumb');
    expect(entryLayoutCss).not.toContain('scrollbar-color:');
    expect(entryLayoutCss).toMatch(/\.entry-main--scroll\s*\{[^}]*scrollbar-gutter:\s*stable;/u);
  });

  it('keeps the search row above and outside the scrolling directory', () => {
    expect(entryNavRailSource.indexOf('className="entry-nav-rail__search-row"')).toBeLessThan(
      entryNavRailSource.indexOf('className="entry-nav-rail__group"'),
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__group\s*\{[^}]*overflow-y:\s*auto;/u,
    );
    expect(entryLayoutCss).toMatch(
      /\.entry-nav-rail__search-row\s*\{[^}]*flex:\s*0 0 auto;[^}]*padding:\s*0 10px;/u,
    );
  });
});
