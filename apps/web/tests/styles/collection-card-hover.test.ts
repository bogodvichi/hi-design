import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const projectCss = source('styles/home/recent-projects.css');
const folderCss = source('components/TeamSpaceView.module.css');
const communityCss = source('components/MyPublishes.module.css');

// Compare the two shared collection surfaces to the actual community rules,
// rather than maintaining a second set of animation constants in the test.
function rule(css: string, selector: string, last = false): Record<string, string> {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector));
  const match = last ? blocks.at(-1) : blocks[0];
  if (!match) throw new Error(`Missing style rule: ${selector}`);
  return Object.fromEntries((match[2] ?? '').split(';').filter((part) => part.includes(':')).map((part) => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' ')];
  }));
}

const surfaces = [
  { name: 'project', css: projectCss, card: '.recent-projects__card', preview: '.recent-projects__card-thumb' },
  { name: 'folder', css: folderCss, card: '.folderCard', preview: '.folderCardGrid' },
];

describe('collection cards share the community hover treatment', () => {
  for (const surface of surfaces) {
    it(`${surface.name} uses the community transition without a reveal delay`, () => {
      const base = rule(surface.css, surface.card);
      expect(base.transition).toBe(rule(communityCss, '.communityProjectCard').transition);
      expect(base['transition-delay']).toBeUndefined();
    });

    it(`${surface.name} lifts and casts the same shadow for hover and keyboard focus`, () => {
      const reference = rule(communityCss, '.communityProjectCard:hover');
      for (const state of [':hover', ':focus-within']) {
        const value = rule(surface.css, surface.card + state);
        expect(value.transform).toBe(reference.transform);
        expect(value.filter).toBe(reference.filter);
        expect(value['box-shadow']).toBeUndefined();
        expect(value.background).toBeUndefined();
      }
    });

    if (surface.name === 'folder') {
      it('keeps the folder preview flat without its own shadow or animation', () => {
        const preview = rule(surface.css, surface.preview);
        for (const property of ['box-shadow', 'filter', 'transform', 'transition']) {
          expect(preview[property]).toBeUndefined();
        }
        // Elevation belongs to the whole folder, not its four-cell preview.
        for (const state of [':hover', ':focus-within', '[aria-pressed]:hover', '[aria-pressed]:focus-within']) {
          expect(() => rule(surface.css, `${surface.card}${state} ${surface.preview}`))
            .toThrow(/Missing style rule/);
        }
      });
    } else {
      it('project preview uses the community shadow without scaling the contents', () => {
        expect(rule(surface.css, surface.preview).transition)
          .toBe(rule(communityCss, '.communityProjectCard :global(.recent-projects__card-thumb)').transition);
        for (const state of [':hover', ':focus-within']) {
          const value = rule(surface.css, `${surface.card}${state} ${surface.preview}`);
          expect(value['box-shadow']).toBe(rule(communityCss, '.communityProjectCard:hover :global(.recent-projects__card-thumb)')['box-shadow']);
          expect(value.transform).toBeUndefined();
        }
      });
    }

    it(`${surface.name} disables lift and animation for reduced motion`, () => {
      expect(surface.css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(rule(surface.css, surface.card, true).transition).toBe('none');
      expect(rule(surface.css, surface.preview, true).transition)
        .toBe(surface.name === 'folder' ? undefined : 'none');
      for (const state of [':hover', ':focus-within']) {
        const value = rule(surface.css, surface.card + state, true);
        expect(value.transform).toBe('none');
        expect(value.filter).toBe('none');
      }
    });
  }

  it('keeps selection rings and prevents lift during multi-selection', () => {
    expect(rule(projectCss, '.recent-projects__card.is-selected .recent-projects__card-thumb::after')['box-shadow'])
      .toBe('inset 0 0 0 1px #353535');
    expect(rule(folderCss, '.folderCardSelected:hover').border).toBe('1px solid #353535');
    for (const state of [':hover', ':focus-within']) {
      expect(rule(projectCss, `.recent-projects__row.is-selecting .recent-projects__card${state}`)).toMatchObject({ transform: 'none', filter: 'none' });
      expect(rule(folderCss, `.folderCard[aria-pressed]${state}`)).toMatchObject({ transform: 'none', filter: 'none' });
    }
  });

  it('keeps open menus above the new card stacking contexts', () => {
    expect(Number(rule(projectCss, '.recent-projects__card.is-menu-open')['z-index'])).toBeGreaterThan(0);
    expect(Number(rule(folderCss, '.folderCard:has(.folderCardMore[aria-expanded="true"])')['z-index'])).toBeGreaterThan(0);
    expect(rule(projectCss, '.recent-projects__card.is-menu-open').overflow).toBe('visible');
  });

  it('does not reintroduce animation on the folder more-button reveal', () => {
    const button = rule(folderCss, '.folderCardMore');
    expect(button.opacity).toBe('0');
    expect(button.transform).toBeUndefined();
    expect(button.transition).not.toMatch(/(?:opacity|transform|\ball\b)/);
    expect(rule(folderCss, '.folderCard:hover .folderCardMore').opacity).toBe('1');
  });

  it('retains the existing card dimensions and background instead of redesigning the layout', () => {
    expect(rule(projectCss, '.recent-projects__card')).toMatchObject({ background: 'transparent', border: '1px solid transparent', padding: '0' });
    expect(rule(folderCss, '.folderCard')).toMatchObject({ background: 'var(--bg)', border: '1px solid var(--border)', padding: '16px' });
    expect(rule(projectCss, '.recent-projects__card-thumb')['aspect-ratio']).toBe('16 / 9');
    expect(rule(folderCss, '.folderCardGrid')['aspect-ratio']).toBe('16 / 9');
  });
});
