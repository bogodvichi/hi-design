// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ellipsisTitleHoverProps } from '../../src/utils/ellipsis-title';

function setWidths(element: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
}

describe('ellipsisTitleHoverProps', () => {
  it('adds the full title only when the text is actually truncated', () => {
    const element = document.createElement('span');
    setWidths(element, 100, 160);
    ellipsisTitleHoverProps('A very long project name').onMouseEnter({ currentTarget: element } as any);
    expect(element.getAttribute('title')).toBe('A very long project name');
  });

  it('does not show a native tooltip when the title fits', () => {
    const element = document.createElement('span');
    element.title = 'stale';
    setWidths(element, 160, 160);
    ellipsisTitleHoverProps('Short name').onMouseEnter({ currentTarget: element } as any);
    expect(element.hasAttribute('title')).toBe(false);
  });
});
