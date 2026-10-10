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
function navigation(element: HTMLElement, type: string, url: string, isMainFrame = true) {
  fireEvent(element, Object.assign(new Event(type), { url, isMainFrame }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('AI research webview SSO navigation', () => {
  it('silently reopens the ordinary login page after sso_invalid and never retries SSO', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, queryByRole } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    navigation(guest, 'did-start-navigation', ticket);
    navigation(guest, 'did-redirect-navigation', 'https://drw.hikvision.com/login?err=sso_invalid');
    expect(guest.getAttribute('src')).toBe(route.url);
    fireEvent(guest, new Event('did-finish-load'));
    expect(guest.style.visibility).toBe('visible');
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('failed');
    expect(queryByRole('status')).toBeNull();
    expect(queryByRole('button')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated subframe and cross-origin login navigations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    navigation(guest, 'did-start-navigation', ticket);
    navigation(guest, 'did-navigate', 'https://drw.hikvision.com/login?err=sso_invalid', false);
    navigation(guest, 'did-navigate', 'https://other.example/login?err=sso_invalid');
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('callback');
  });

  it('autofocus does not cancel a pending SSO ticket or block its callback', async () => {
    let resolveLaunch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveLaunch = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending);
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await act(async () => {});
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;

    // The real AI research login page has an autofocus username input.
    // A guest focus event is not proof that the user chose manual sign-in.
    fireEvent(guest, new Event('did-finish-load'));
    fireEvent.focus(guest);

    expect(signal.aborted).toBe(false);
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('requesting');
    await act(async () => { resolveLaunch(fakeResponse()); await pending; });
    expect(guest.getAttribute('src')).toBe(ticket);
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('callback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ERR_ABORTED from replacing an old webview load is not an SSO failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse());
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    fireEvent(guest, Object.assign(new Event('did-fail-load'), { errorCode: -3, isMainFrame: true }));
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('callback');
    expect(guest.getAttribute('src')).toBe(ticket);
  });

  it('guest autofocus during a callback does not reset the current navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    Object.assign(guest, { getURL: () => 'https://drw.hikvision.com/login' });
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    fireEvent(guest, new Event('did-finish-load'));
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
    fireEvent(guest, new Event('did-finish-load'));
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
