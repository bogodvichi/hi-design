import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../../src/styles/shell.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(new URL('../../src/styles/viewer/routines.css', import.meta.url), 'utf8');

function cssDeclarations(css: string, selector: string): string[] {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }

  return blocks;
}

describe('recvqadaNlQZNM — project focus mode chat pane jitters while collapsing', () => {
  it('keeps the animated shell grid as the final owner of the split tracks', () => {
    const shellImport = indexCss.indexOf("@import './styles/shell.css';");
    const routinesImport = indexCss.indexOf("@import './styles/viewer/routines.css';");

    expect(shellImport).toBeGreaterThanOrEqual(0);
    expect(routinesImport).toBeGreaterThan(shellImport);

    const shellSplit = cssDeclarations(shellCss, '.split').join('\n');
    expect(shellSplit).toMatch(
      /grid-template-columns:\s*var\(--project-chat-panel-width\)\s*var\(--project-chat-handle-width\)\s*var\(--project-workspace-panel-track\);/,
    );

    // routines.css is imported after shell.css and its `.app` selectors have
    // higher specificity. Any track declaration here wins the cascade and
    // turns the intended variable interpolation back into a hard 3→1 switch.
    for (const selector of ['.app .split:not(.split-focus)', '.app .split.split-focus']) {
      expect(cssDeclarations(routinesCss, selector).join('\n')).not.toMatch(/\bgrid-template-columns\s*:/);
    }
  });

  it('pins each split child to its track when focus mode unmounts the resize handle', () => {
    expect(cssDeclarations(shellCss, '.split-chat-slot').join('\n')).toMatch(/\bgrid-column:\s*1\s*;/);

    const handleRules = cssDeclarations(shellCss, '.split-resize-handle').join('\n');
    expect(handleRules).toMatch(/\bgrid-column:\s*2\s*;/);
    expect(cssDeclarations(shellCss, '.split-edit-divider').join('\n')).toMatch(/\bgrid-column:\s*2\s*;/);

    expect(cssDeclarations(shellCss, '.split > .workspace').join('\n')).toMatch(
      /\bgrid-column:\s*3\s*;/,
    );
  });

  it('clips a stable-width transcript instead of rewrapping it into the collapsed grid track', () => {
    const pane = cssDeclarations(shellCss, '.split-chat-slot > .pane').join('\n');
    expect(pane).toMatch(/width:\s*max\(0px,\s*calc\(var\(--project-chat-content-width,\s*460px\)\s*-\s*var\(--project-chat-content-inset,\s*0px\)\)\)/);
    expect(pane).toMatch(/min-width:\s*max\(0px,\s*calc\(var\(--project-chat-content-width/);
    expect(cssDeclarations(routinesCss, '.app .split-chat-slot').join('\n')).toMatch(/--project-chat-content-inset:\s*8px\s*;/);
  });
});
