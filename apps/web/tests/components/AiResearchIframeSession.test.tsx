// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiResearchWorkspaceFrame } from '../../src/components/AiResearchWorkspaceFrame';
import type { Route } from '../../src/router';

vi.mock('@open-design/host', () => ({ isOpenDesignHostAvailable: () => true }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
const route: Route = { kind: 'external', resourceKey: 'ai-research-workbench', title: 'AI research', url: 'https://drw.hikvision.com/' };
const ticket = 'https://drw.hikvision.com/api/auth/platform?ticket=opaque';
const fakeResponse = () => new Response(JSON.stringify({ launchUrl: ticket, expiresIn: 60 }), { status: 200 });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('AI research iframe SSO session', () => {
  it('autofocus does not cancel a pending SSO ticket or block its callback', async () => {
    let resolveLaunch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveLaunch = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending);
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await act(async () => {});
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;

    // The real AI research login page has an autofocus username input.
    // An iframe focus event is not proof that the user chose manual sign-in.
    fireEvent.load(guest);
    fireEvent.focus(guest);

    expect(signal.aborted).toBe(false);
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('requesting');
    await act(async () => { resolveLaunch(fakeResponse()); await pending; });
    expect(guest.getAttribute('src')).toBe(ticket);
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('callback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('iframe autofocus during a callback does not reset the current navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    fireEvent.load(guest);
    const assigned = guest.getAttribute('src');
    fireEvent.focus(guest);
    expect(guest.getAttribute('src')).toBe(assigned);
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('callback');
  });

  it('React StrictMode sends one launch request despite the duplicate development-only effect', async () => {
    let resolveLaunch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveLaunch = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending);
    const { getByTestId } = render(<StrictMode><AiResearchWorkspaceFrame route={route} /></StrictMode>);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    const guest = getByTestId('ai-research-workspace-frame');
    fireEvent.load(guest);
    fireEvent.focus(guest);
    expect(signal.aborted).toBe(false);
    await act(async () => { resolveLaunch(fakeResponse()); await pending; });
    expect(guest.getAttribute('src')).toBe(ticket);
  });

  it('a stalled SSO callback silently falls back to the native login page', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, queryByRole } = render(<AiResearchWorkspaceFrame route={route} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const guest = getByTestId('ai-research-workspace-frame');
    expect(guest.getAttribute('src')).toBe(ticket);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('failed');
    expect(guest.getAttribute('src')).toBe(route.url);
    expect(queryByRole('status')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(guest.style.visibility).toBe('visible');
  });
});
