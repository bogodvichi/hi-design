import { describe, expect, it } from 'vitest';

import { resolveFloatingMenuHorizontalAlign } from '../../src/utils/floating-menu-placement';

describe('resolveFloatingMenuHorizontalAlign', () => {
  it('keeps start alignment when the menu fits to the right of the trigger', () => {
    expect(resolveFloatingMenuHorizontalAlign({
      triggerLeft: 300,
      triggerRight: 360,
      menuWidth: 180,
      viewportWidth: 1000,
      preferred: 'start',
    })).toBe('start');
  });

  it('flips to end alignment when start alignment would collide with the right viewport edge', () => {
    expect(resolveFloatingMenuHorizontalAlign({
      triggerLeft: 910,
      triggerRight: 970,
      menuWidth: 220,
      viewportWidth: 1000,
      preferred: 'start',
    })).toBe('end');
  });

  it('flips back to start when end alignment would collide with the left viewport edge', () => {
    expect(resolveFloatingMenuHorizontalAlign({
      triggerLeft: 12,
      triggerRight: 72,
      menuWidth: 180,
      viewportWidth: 1000,
      preferred: 'end',
    })).toBe('start');
  });
});
