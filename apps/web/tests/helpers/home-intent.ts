import { act, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { requestHomeChip } from '../../src/runtime/home-intent';

// Other entry-shell views hand scenarios to Home through this public intent.
// The in-composer template picker is no longer rendered.
export async function pickHomeTemplate(chipId: string): Promise<void> {
  await act(async () => {
    requestHomeChip(chipId);
  });
  await waitFor(() => {
    const draft = JSON.parse(window.localStorage.getItem('open-design:home-composer:chip') ?? '{}');
    expect(draft.chipId).toBe(chipId);
  });
}

// Existing drafts remain supported after the picker and example rail retired.
// Seed their durable representation before mounting Home, as a returning user.
export function seedHomeDraft(draft: {
  chipId: string;
  pluginId: string;
  projectKind: string;
  prototypeSubtypeId?: string;
  explicitPick?: boolean;
  examplePick?: boolean;
}, prompt?: string): void {
  window.localStorage.setItem('open-design:home-composer:chip', JSON.stringify(draft));
  if (prompt !== undefined) {
    window.localStorage.setItem('open-design:home-composer:prompt', prompt);
  }
}
