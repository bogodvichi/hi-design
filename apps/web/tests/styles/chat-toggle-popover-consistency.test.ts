import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../src/styles/chat.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(
  new URL('../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);

describe('conversation visibility popovers', () => {
  it('keeps the expand and collapse panel geometry in sync', () => {
    const panelRule = /left:\s*-4px;[\s\S]*?min-width:\s*148px;[\s\S]*?padding:\s*4px;[\s\S]*?border-radius:\s*8px;[\s\S]*?background:\s*var\(--bg-elevated\);[\s\S]*?box-shadow:\s*var\(--shadow-md\);/;
    expect(chatCss).toMatch(panelRule);
    expect(routinesCss).toMatch(panelRule);
  });

  it('keeps both action rows left-aligned with matching insets', () => {
    const actionRule = /justify-content:\s*flex-start;[\s\S]*?gap:\s*8px;[\s\S]*?height:\s*30px;[\s\S]*?padding-block:\s*0;[\s\S]*?padding-inline:\s*5px 8px;[\s\S]*?border-radius:\s*6px;/;
    expect(chatCss).toMatch(actionRule);
    expect(routinesCss).toMatch(actionRule);
  });
});
