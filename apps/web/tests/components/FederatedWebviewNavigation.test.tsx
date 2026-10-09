// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
  it('retains the login page after sso_invalid and never retries automatically', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, getByText } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    navigation(guest, 'did-start-navigation', ticket);
    navigation(guest, 'did-redirect-navigation', 'https://drw.hikvision.com/login?err=sso_invalid');
    fireEvent(guest, new Event('did-finish-load'));
    expect(getByText('federated.unavailable')).toBeTruthy();
    expect(guest.style.visibility).toBe('visible');
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('failed');
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

  it('manual selection interrupts a callback but later navigation events cannot re-enable SSO', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, getByRole } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    const stop = vi.fn();
    Object.assign(guest, { getURL: () => ticket, stop });
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    fireEvent.click(getByRole('button', { name: 'federated.manualAction' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(guest.getAttribute('src')).toBe(route.url);
    navigation(guest, 'did-start-navigation', ticket);
    navigation(guest, 'did-navigate', 'https://drw.hikvision.com/login?err=sso_invalid');
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('manual');
  });

  it('does not reload a manual login form that already finished loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, getByRole } = render(<AiResearchWorkspaceFrame route={route} />);
    const guest = getByTestId('ai-research-workspace-frame');
    const stop = vi.fn();
    Object.assign(guest, { getURL: () => 'https://drw.hikvision.com/login', stop });
    await waitFor(() => expect(guest.getAttribute('src')).toBe(ticket));
    fireEvent(guest, new Event('did-finish-load'));
    const assigned = guest.getAttribute('src');
    fireEvent.click(getByRole('button', { name: 'federated.manualAction' }));
    expect(stop).not.toHaveBeenCalled();
    expect(guest.getAttribute('src')).toBe(assigned);
  });

  it('callback confirmation timeout is bounded and is not falsely reported as authenticated', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fakeResponse());
    const { getByTestId, queryByTestId } = render(<AiResearchWorkspaceFrame route={route} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const guest = getByTestId('ai-research-workspace-frame');
    expect(guest.getAttribute('src')).toBe(ticket);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(getByTestId('ai-research-workspace-frame-shell').getAttribute('data-auth-state')).toBe('unconfirmed');
    expect(queryByTestId('ai-research-workspace-loading')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(guest.style.visibility).toBe('visible');
  });
});
