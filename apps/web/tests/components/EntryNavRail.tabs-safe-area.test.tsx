// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { EntryTopRightCluster } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const context = {
  workspaceId: 'ws-1',
  workspaceType: 'personal',
  workspaceMemberId: 'wm-1',
  displayName: 'Test',
  role: 'owner',
  memberStatus: 'active',
  lifecycleState: 'active',
  billingState: 'active',
  planId: 'pro',
  providerMode: 'platform_credits',
  seatSummary: { seatLimit: 1, usedSeats: 1, availableSeats: 0, isSeatFull: true },
  permissions: {},
} as WorkspaceCollabContext;

let clusterLeft: number;
let resize: () => void;
const disconnect = vi.fn();

function cluster(value: WorkspaceCollabContext | null) {
  return (
    <I18nProvider initial="zh-CN">
      <EntryTopRightCluster page="project" context={value} />
    </I18nProvider>
  );
}

function safeArea(): string {
  return document.documentElement.style.getPropertyValue('--workspace-tabs-right-safe-area');
}

beforeEach(() => {
  clusterLeft = window.innerWidth - 300;
  resize = () => {};
  disconnect.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], unreadCount: 0 })));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    left: clusterLeft, right: window.innerWidth, top: 9, bottom: 41,
    width: window.innerWidth - clusterLeft, height: 32, x: clusterLeft, y: 9,
    toJSON() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--workspace-tabs-right-safe-area');
});

it('reserves the account width when context is ready on mount', () => {
  render(cluster(context));
  expect(safeArea()).toBe('316px');
});

it('measures a late account cluster and tracks its width until it disappears', () => {
  const view = render(cluster(null));
  expect(document.querySelector('.entry-top-right-cluster')).toBeNull();
  expect(safeArea()).toBe('');

  view.rerender(cluster(context));
  expect(document.querySelector('.entry-top-right-cluster')).not.toBeNull();
  expect(safeArea()).toBe('316px');

  clusterLeft -= 100;
  act(() => resize());
  expect(safeArea()).toBe('416px');

  view.rerender(cluster(null));
  expect(safeArea()).toBe('');
  expect(disconnect).toHaveBeenCalledTimes(1);

  view.rerender(cluster(context));
  expect(safeArea()).toBe('416px');
});
