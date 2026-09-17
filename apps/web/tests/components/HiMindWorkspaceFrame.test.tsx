// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiMindWorkspaceFrame } from '../../src/components/HiMindWorkspaceFrame';
import {
  dispatchOpenWorkspaceTab,
  OPEN_WORKSPACE_TAB_EVENT,
} from '../../src/components/workspaceTabEvents';
import type { Route } from '../../src/router';

const homeRoute: Route = { kind: 'home', view: 'home' };
const stableRoute: Route = {
  kind: 'external',
  url: 'http://himind.example/login',
  resourceKey: 'himind',
  title: 'HiMind',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HiMindWorkspaceFrame', () => {
  it('shows the iframe after it loads even when HiMind does not send an SSO ready message', async () => {
    const bootstrapRoute: Route = {
      ...stableRoute,
      bootstrapUrl: 'http://himind.example/callback?ticket=opaque',
    };
    const { getByTestId, queryByTestId } = render(
      <HiMindWorkspaceFrame route={bootstrapRoute} />,
    );
    const frame = getByTestId('himind-workspace-frame') as HTMLIFrameElement;

    expect(frame.style.visibility).toBe('hidden');
    expect(queryByTestId('himind-workspace-loading')).not.toBeNull();

    fireEvent.load(frame);

    await waitFor(() => {
      expect(frame.style.visibility).toBe('visible');
      expect(queryByTestId('himind-workspace-loading')).toBeNull();
    });
  });

  it('keeps the same iframe mounted while tabs switch', () => {
    const { rerender, getByTestId } = render(<HiMindWorkspaceFrame route={homeRoute} />);
    act(() => dispatchOpenWorkspaceTab({
      ...stableRoute,
      bootstrapUrl: 'http://himind.example/callback?ticket=opaque',
    }));
    const frame = getByTestId('himind-workspace-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toContain('ticket=opaque');

    rerender(<HiMindWorkspaceFrame route={stableRoute} />);
    expect(getByTestId('himind-workspace-frame')).toBe(frame);
    expect(frame.style.display).toBe('block');

    rerender(<HiMindWorkspaceFrame route={homeRoute} />);
    expect(getByTestId('himind-workspace-frame')).toBe(frame);
    expect(frame.style.display).toBe('none');
  });

  it('applies a later SSO bootstrap URL to an already-open HiMind tab', async () => {
    const { getByTestId, queryByTestId } = render(
      <HiMindWorkspaceFrame route={stableRoute} />,
    );
    const frame = getByTestId('himind-workspace-frame') as HTMLIFrameElement;
    fireEvent.load(frame);

    act(() => dispatchOpenWorkspaceTab({
      ...stableRoute,
      bootstrapUrl: 'http://himind.example/callback?ticket=fresh',
    }));

    await waitFor(() => {
      expect(getByTestId('himind-workspace-frame')).toBe(frame);
      expect(frame.getAttribute('src')).toContain('ticket=fresh');
      expect(frame.style.visibility).toBe('hidden');
      expect(queryByTestId('himind-workspace-loading')).not.toBeNull();
    });
  });

  it('accepts ready messages only from the exact HiMind frame and origin', async () => {
    const opened: Route[] = [];
    const onOpen = (event: Event) => {
      const route = (event as CustomEvent<{ route: Route }>).detail.route;
      if (route.kind === 'external' && !route.bootstrapUrl) opened.push(route);
    };
    window.addEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpen);
    const { getByTestId } = render(<HiMindWorkspaceFrame route={stableRoute} />);
    const frame = getByTestId('himind-workspace-frame') as HTMLIFrameElement;

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'himind:sso-ready', path: '/platform/creatChat' },
      origin: 'http://attacker.example',
      source: frame.contentWindow,
    }));
    expect(opened).toHaveLength(0);

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'himind:sso-ready', path: '/platform/creatChat' },
      origin: 'http://himind.example',
      source: frame.contentWindow,
    }));
    await waitFor(() => expect(opened).toEqual([{
      kind: 'external',
      url: 'http://himind.example/platform/creatChat',
      resourceKey: 'himind',
      title: 'HiMind',
    }]));
    window.removeEventListener(OPEN_WORKSPACE_TAB_EVENT, onOpen);
  });

  it('reauthenticates inside the existing iframe after auth expires', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      launchUrl: 'http://himind.example/callback?ticket=fresh',
      expiresIn: 60,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { getByTestId, queryByTestId } = render(<HiMindWorkspaceFrame route={stableRoute} />);
    const frame = getByTestId('himind-workspace-frame') as HTMLIFrameElement;
    fireEvent.load(frame);

    await waitFor(() => {
      expect(frame.style.visibility).toBe('visible');
      expect(queryByTestId('himind-workspace-loading')).toBeNull();
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'himind:auth-required' },
      origin: 'http://himind.example',
      source: frame.contentWindow,
    }));

    await waitFor(() => {
      expect(frame.style.visibility).toBe('hidden');
      expect(queryByTestId('himind-workspace-loading')).not.toBeNull();
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/himind/launch', { method: 'POST' });
      expect(frame.getAttribute('src')).toContain('ticket=fresh');
    });
    expect(getByTestId('himind-workspace-frame')).toBe(frame);

    fireEvent.load(frame);
    await waitFor(() => {
      expect(frame.style.visibility).toBe('visible');
      expect(queryByTestId('himind-workspace-loading')).toBeNull();
    });
  });
});
