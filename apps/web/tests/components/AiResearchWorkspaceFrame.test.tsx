// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOpenDesignHostAvailable } from '@open-design/host';
import { AiResearchWorkspaceFrame } from '../../src/components/AiResearchWorkspaceFrame';
import { dispatchOpenWorkspaceTab } from '../../src/components/workspaceTabEvents';
import type { Route } from '../../src/router';

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
});

beforeEach(() => {
  vi.mocked(isOpenDesignHostAvailable).mockReturnValue(false);
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
    expect(frame.getAttribute('src')).toContain('ticket=opaque');
    expect(queryByTestId('ai-research-workspace-loading')).not.toBeNull();

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

  it('uses an isolated top-level webview in the desktop client', async () => {
    vi.mocked(isOpenDesignHostAvailable).mockReturnValue(true);
    const bootstrapRoute: Route = {
      ...stableRoute,
      bootstrapUrl: 'https://drw.hikvision.com/api/auth/platform?ticket=opaque',
    };
    const { getByTestId, queryByTestId } = render(
      <AiResearchWorkspaceFrame route={bootstrapRoute} />,
    );
    const guest = getByTestId('ai-research-workspace-frame');

    expect(guest.tagName).toBe('WEBVIEW');
    expect(guest.getAttribute('partition')).toBe('persist:open-design-federated-tools');
    expect(guest.style.display).toBe('flex');
    expect(guest.style.visibility).toBe('hidden');

    fireEvent(guest, new Event('did-finish-load'));

    await waitFor(() => {
      expect(guest.style.visibility).toBe('visible');
      expect(queryByTestId('ai-research-workspace-loading')).toBeNull();
    });
  });
});
