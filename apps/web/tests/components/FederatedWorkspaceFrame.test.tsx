// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiResearchWorkspaceFrame } from '../../src/components/AiResearchWorkspaceFrame';
import { HiMindWorkspaceFrame } from '../../src/components/HiMindWorkspaceFrame';
import { dispatchCloseWorkspaceExternalTab, dispatchOpenWorkspaceTab } from '../../src/components/workspaceTabEvents';
import type { Route } from '../../src/router';

vi.mock('@open-design/host', () => ({ isOpenDesignHostAvailable: () => true }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
const cases = [
  { Component: HiMindWorkspaceFrame, key: 'himind', prefix: 'himind-workspace', url: 'http://himind.example/login', callback: '/api/v1/auth/hidesign/callback', endpoint: '/api/auth/himind/launch' },
  { Component: AiResearchWorkspaceFrame, key: 'ai-research-workbench', prefix: 'ai-research-workspace', url: 'https://drw.hikvision.com/', callback: '/api/auth/platform', endpoint: '/api/auth/ai-research/launch' },
] as const;
const response = (launchUrl: string, expiresIn = 60) => new Response(JSON.stringify({ launchUrl, expiresIn }), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(cases)('$key open-first federated login', ({ Component, key, prefix, url, callback, endpoint }) => {
  const route: Route = { kind: 'external', url, resourceKey: key, title: key };
  const ticketUrl = new URL(callback + '?ticket=fresh', url).href;
  it('opens the ordinary page while ticket issuance is pending; reactivating does not restart it', () => {
    const pending = deferred<Response>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const { getByTestId, rerender } = render(<Component route={route} />);
    const frame = getByTestId(prefix + '-frame');
    expect(frame.getAttribute('src')).toBe(url);
    expect(frame.style.visibility).not.toBe('hidden');
    expect(fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    act(() => dispatchOpenWorkspaceTab(route));
    rerender(<Component route={{ kind: 'home', view: 'home' }} />);
    rerender(<Component route={route} />);
    expect(getByTestId(prefix + '-frame')).toBe(frame);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the page and a local fallback notice when the OA launch endpoint rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'OA login is required' } }), { status: 401 }));
    const { getByTestId, getByText } = render(<Component route={route} />);
    await waitFor(() => expect(getByText('federated.unavailable')).toBeTruthy());
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(url);
    expect(getByTestId(prefix + '-frame').style.visibility).toBe('visible');
  });

  it('manual login aborts and ignores a late successful launch response', async () => {
    const pending = deferred<Response>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const { getByRole, getByTestId } = render(<Component route={route} />);
    const signal = fetch.mock.calls[0]![1]!.signal as AbortSignal;
    fireEvent.click(getByRole('button', { name: 'federated.manualAction' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response(ticketUrl)); await pending.promise; });
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(url);
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-auth-state')).toBe('manual');
    act(() => dispatchOpenWorkspaceTab({ ...route, bootstrapUrl: ticketUrl }));
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('closing a tab aborts its attempt and a late response cannot recreate it', async () => {
    const pending = deferred<Response>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const { queryByTestId } = render(<Component route={route} />);
    const signal = fetch.mock.calls[0]![1]!.signal as AbortSignal;
    act(() => dispatchCloseWorkspaceExternalTab(route));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response(ticketUrl)); await pending.promise; });
    expect(queryByTestId(prefix + '-frame')).toBeNull();
  });

  it('unmounting on identity change aborts the old request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<Component route={route} />);
    const signal = fetch.mock.calls[0]![1]!.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('timeout ends automatic attempts without hiding the login page or retrying', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<Component route={route} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-auth-state')).toBe('requesting');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-auth-state')).toBe('failed');
    expect(getByTestId(prefix + '-frame').style.visibility).toBe('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['https://attacker.example/api/auth/platform?ticket=private', 'javascript:alert(1)'])('rejects an untrusted callback without exposing or navigating its URL', async (unsafe) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(unsafe));
    const { getByTestId, getByText, container } = render(<Component route={route} />);
    await waitFor(() => expect(getByText('federated.unavailable')).toBeTruthy());
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(url);
    expect(container.textContent).not.toContain(unsafe);
  });

  it('loading a page never marks an unverified session authenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(ticketUrl));
    const { getByTestId } = render(<Component route={route} />);
    const frame = getByTestId(prefix + '-frame');
    await waitFor(() => expect(frame.getAttribute('src')).toBe(ticketUrl));
    fireEvent(frame, new Event(key === 'himind' ? 'load' : 'did-finish-load'));
    expect(frame.style.visibility).toBe('visible');
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-page-loaded')).toBe('true');
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-auth-state')).not.toBe('authenticated');
  });

  it('a ticket that has already expired is never navigated to', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(ticketUrl, 0));
    const { getByTestId, getByText } = render(<Component route={route} />);
    await waitFor(() => expect(getByText('federated.unavailable')).toBeTruthy());
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(url);
  });

  it('manual mode survives tab reactivation until the user explicitly retries', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    const { getByRole, getByTestId } = render(<Component route={route} />);
    fireEvent.click(getByRole('button', { name: 'federated.manualAction' }));
    act(() => dispatchOpenWorkspaceTab(route));
    act(() => dispatchOpenWorkspaceTab(route));
    expect(getByTestId(prefix + '-frame-shell').getAttribute('data-auth-state')).toBe('manual');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('explicit retry starts a new attempt; the prior response cannot override it', async () => {
    const old = deferred<Response>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(ticketUrl));
    const { getByRole, getByTestId } = render(<Component route={route} />);
    fireEvent.click(getByRole('button', { name: 'federated.manualAction' }));
    fireEvent.click(getByRole('button', { name: 'federated.retryAction' }));
    await waitFor(() => expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(ticketUrl));
    await act(async () => { old.resolve(response(ticketUrl.replace('fresh', 'old'))); await old.promise; });
    expect(getByTestId(prefix + '-frame').getAttribute('src')).toBe(ticketUrl);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
