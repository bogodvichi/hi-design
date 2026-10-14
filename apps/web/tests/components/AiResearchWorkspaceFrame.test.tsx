// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOpenDesignHostAvailable } from '@open-design/host';
import { AiResearchWorkspaceFrame } from '../../src/components/AiResearchWorkspaceFrame';
import { dispatchOpenWorkspaceTab } from '../../src/components/workspaceTabEvents';
import type { Route } from '../../src/router';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));

vi.mock('@open-design/host', () => ({
  isOpenDesignHostAvailable: vi.fn(() => false),
}));

const homeRoute: Route = { kind: 'home', view: 'home' };
const stableRoute: Route = {
  kind: 'external',
  url: 'https://drw.hikvision.com/',
  resourceKey: 'ai-research-workbench',
  title: 'AI用研工作台',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(isOpenDesignHostAvailable).mockReturnValue(false);
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
});

describe('AiResearchWorkspaceFrame', () => {
  it('uses the one-time callback without persisting it as the canonical route', async () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <AiResearchWorkspaceFrame route={homeRoute} />,
    );

    act(() => dispatchOpenWorkspaceTab({
      ...stableRoute,
      bootstrapUrl: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque&next=%2F',
    }));

    const frame = getByTestId('ai-research-workspace-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toContain('ticket=opaque'));
    expect(queryByTestId('ai-research-workspace-loading')).toBeNull();

    rerender(<AiResearchWorkspaceFrame route={stableRoute} />);
    fireEvent.load(frame);

    await waitFor(() => {
      expect(getByTestId('ai-research-workspace-frame')).toBe(frame);
      expect(frame.style.visibility).toBe('visible');
      expect(queryByTestId('ai-research-workspace-loading')).toBeNull();
    });

    rerender(<AiResearchWorkspaceFrame route={homeRoute} />);
    expect(getByTestId('ai-research-workspace-frame')).toBe(frame);
    expect(frame.style.display).toBe('none');
  });

  it('uses an iframe in the desktop client and keeps it mounted across tab switches', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    const bootstrapRoute: Route = {
      ...stableRoute,
      bootstrapUrl: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque',
    };
    const { getByTestId, queryByTestId, rerender } = render(
      <AiResearchWorkspaceFrame route={bootstrapRoute} />,
    );
    const guest = getByTestId('ai-research-workspace-frame');

    expect(guest.tagName).toBe('IFRAME');
    expect(guest.getAttribute('partition')).toBeNull();
    expect(guest.style.display).toBe('block');
    expect(guest.style.visibility).toBe('visible');

    await waitFor(() => expect(guest.getAttribute('src')).toContain('ticket=opaque'));
    fireEvent.load(guest);

    await waitFor(() => {
      expect(guest.style.visibility).toBe('visible');
      expect(queryByTestId('ai-research-workspace-loading')).toBeNull();
      expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-page-loaded')).toBe('true');
    });

    rerender(<AiResearchWorkspaceFrame route={homeRoute} />);
    expect(getByTestId('ai-research-workspace-frame')).toBe(guest);
    expect(guest.style.display).toBe('none');
    rerender(<AiResearchWorkspaceFrame route={stableRoute} />);
    expect(getByTestId('ai-research-workspace-frame')).toBe(guest);
    expect(guest.getAttribute('src')).toContain('ticket=opaque');
  });
});
