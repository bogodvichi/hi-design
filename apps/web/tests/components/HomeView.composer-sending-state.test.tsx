// @vitest-environment jsdom


// Home composer send must show an in-flight state (#4082).
//
// Submitting from Home kicks off an async project-creation /
// conversation-creation roundtrip before navigation unmounts the screen.
// Without a sending state the button stays idle through that window, so
// the app "looks frozen" and accepts duplicate sends. These tests pin the
// contract: while the submit promise is pending the button is disabled and
// labelled Sending…, repeat clicks are swallowed, and a failed creation
// re-enables the composer with a visible error so the user can retry.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>();
  return {
    ...actual,
    useWorkspaceContext: () => ({
      context: null,
      loading: false,
      failure: 'unsupported' as const,
    }),
  };
});

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { ProjectCreateError } from '../../src/state/projects';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';
import { setHomeHeroPrompt } from '../helpers/home-hero-lexical';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
});

function stubPluginsFetch(plugins: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (typeof url === 'string' && url === '/api/plugins') {
      return new Response(JSON.stringify({ plugins }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

function renderHome(onSubmit: (payload: unknown) => Promise<boolean> | void) {
  // Keep the first-run guide quiet so sheen classes never race the
  // sending-state classes asserted below.
  writeHomeGuideStage('done');
  stubPluginsFetch();
  return render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
      />
    </I18nProvider>,
  );
}

describe('home composer sending state', () => {
  it('uses automatic routing for a free-form Design submit without installed templates', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderHome(onSubmit);

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Build a launch dashboard');
    fireEvent.click(await screen.findByTestId('home-hero-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: null,
      pluginSelectionProvenance: 'automatic-default',
      conversationMode: 'design',
    }));
  });

  it('shows Sending… and swallows repeat clicks while creation is in flight', async () => {
    let resolveSubmit: (accepted: boolean) => void = () => undefined;
    const onSubmit = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveSubmit = resolve; }),
    );
    renderHome(onSubmit);

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Build a landing page');
    const submit = (await screen.findByTestId('home-hero-submit')) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => {
      expect(submit.disabled).toBe(true);
    });
    // #5517 made the submit button icon-only (spinner while sending); the
    // Sending… state now lives on the accessible name instead of a label span.
    expect(submit.getAttribute('aria-label')).toBe('Sending…');
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.className).toContain('is-sending');

    // A second click during the in-flight window must not start a second run.
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Flush the resolution so the trailing state update lands inside the test.
    resolveSubmit(true);
    await waitFor(() => {
      expect(submit.getAttribute('aria-busy')).not.toBe('true');
      expect(screen.getByTestId('home-hero-input').textContent).toBe('');
    });
    expect(submit.disabled).toBe(true);
  });

  it('re-enables the composer and surfaces an error when creation fails', async () => {
    let resolveSubmit: (accepted: boolean) => void = () => undefined;
    const onSubmit = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveSubmit = resolve; }),
    );
    renderHome(onSubmit);

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Build a landing page');
    const submit = (await screen.findByTestId('home-hero-submit')) as HTMLButtonElement;

    fireEvent.click(submit);
    await waitFor(() => {
      expect(submit.disabled).toBe(true);
    });

    resolveSubmit(false);
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    // Icon-only button (#5517): the idle accessible name replaces the old
    // visible Send label.
    expect(submit.getAttribute('aria-label')).toBe('Run');
    expect(submit.className).not.toContain('is-sending');
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i);

    // The failure path must leave the composer retryable.
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('shows the daemon recovery message only for a transport failure and preserves the draft', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    renderHome(onSubmit);

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Keep this draft while the daemon reconnects');
    fireEvent.click(await screen.findByTestId('home-hero-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Local service connection interrupted. Recovering automatically…',
    );
    expect(screen.getByTestId('home-hero-input')).toHaveTextContent(
      'Keep this draft while the daemon reconnects',
    );
  });

  it('surfaces a business HTTP error without claiming the daemon is unreachable', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ProjectCreateError(
      'Workspace membership authority is temporarily unavailable',
      503,
      'WORKSPACE_AUTHORITY_UNAVAILABLE',
      true,
      'request-1',
    ));
    renderHome(onSubmit);

    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Keep the business failure distinct');
    fireEvent.click(await screen.findByTestId('home-hero-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace membership authority is temporarily unavailable',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Local service');
    expect(screen.getByTestId('home-hero-input')).toHaveTextContent(
      'Keep the business failure distinct',
    );
  });

});
