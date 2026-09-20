// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ComposerOutsideContextList,
  composerWorkspaceContextLabel,
} from '../../src/components/composer/ComposerContextChips';

const chatCss = readFileSync(resolve(process.cwd(), 'src/styles/chat.css'), 'utf8');

function cssDeclarations(selector: string): string {
  const cssWithoutComments = chatCss.replace(/\/\*[\s\S]*?\*\//g, '');
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

describe('ComposerContextChips', () => {
  it('uses one attachment-first ordering contract for both composers', () => {
    const remove = vi.fn();
    render(
      <div data-testid="contexts">
        <ComposerOutsideContextList
          attachments={[
            {
              key: 'later',
              name: 'later.pdf',
              kind: 'file',
              order: 2,
              onRemove: remove,
              removeLabel: 'Remove later.pdf',
            },
            {
              key: 'first',
              name: 'first.pdf',
              kind: 'file',
              order: 0,
              onRemove: remove,
              removeLabel: 'Remove first.pdf',
            },
          ]}
          plugins={[{
            key: 'plugin',
            kind: 'plugin',
            icon: 'sparkles',
            label: 'Plugin',
            removeLabel: 'Remove Plugin',
          }]}
          connectors={[{
            key: 'connector',
            kind: 'connector',
            icon: 'link',
            label: 'Connector',
            removeLabel: 'Remove Connector',
          }]}
          workspaces={[{
            key: 'workspace',
            kind: 'workspace',
            icon: 'folder',
            label: 'Reference project',
            removeLabel: 'Remove Reference project',
          }]}
        />
      </div>,
    );

    expect(Array.from(screen.getByTestId('contexts').children).map((node) => node.textContent)).toEqual([
      '1first.pdf',
      '2later.pdf',
      'Plugin',
      'Connector',
      'Reference project',
    ]);
  });

  it('uses the selected label without adding a project-kind prefix', () => {
    expect(composerWorkspaceContextLabel({
      id: 'project-1',
      kind: 'project',
      label: 'Reference project',
    } as never)).toBe('Reference project');
  });

  it('uses the Skill close-button dimensions for every context chip', () => {
    const button = cssDeclarations('.staged-remove');
    const icon = cssDeclarations('.staged-remove svg');

    expect(ruleValue(button, 'width')).toBe('16px');
    expect(ruleValue(button, 'height')).toBe('16px');
    expect(ruleValue(button, 'flex')).toBe('0 0 16px');
    expect(ruleValue(icon, 'width')).toBe('10px');
    expect(ruleValue(icon, 'height')).toBe('10px');
  });
});
