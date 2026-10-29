// @vitest-environment jsdom


// Static prompt-example cards must show the Send cue too.
//
// When a chip has no example plugins, HomeHero falls back to static
// prompt-example cards (`home-hero-prompt-example`) handled entirely
// inside the component. Seeding the composer through that path must
// trigger the same send-button attention sheen as the HomeView-routed
// plugin Use / preset flows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HomeView } from '../../src/components/HomeView';
import { createPluginUseHandoff } from '../../src/components/home-hero/plugin-authoring';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

const WEB_PROTOTYPE_PLUGIN = {
  id: 'example-web-prototype',
  title: 'Web Prototype',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/web-prototype',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/web-prototype',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'example-web-prototype',
    title: 'Web Prototype',
    version: '0.1.0',
    description: 'General-purpose desktop web prototype.',
    od: { kind: 'scenario', taskKind: 'new-generation' },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
});

const REQUIRED_INPUT_PLUGIN = {
  ...WEB_PROTOTYPE_PLUGIN,
  id: 'required-input-plugin',
  title: 'Required Input Plugin',
  source: '/tmp/required-input',
  fsPath: '/tmp/required-input',
  manifest: {
    ...WEB_PROTOTYPE_PLUGIN.manifest,
    name: 'required-input-plugin',
    title: 'Required Input Plugin',
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Build a landing page about {{topic}}.' },
      inputs: [{ name: 'topic', type: 'string', required: true }],
    },
  },
};

describe('use-with-query send pulse gating', () => {
  it('does not pulse Send when required inputs are still missing', async () => {
    writeHomeGuideStage('done');
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [REQUIRED_INPUT_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const view = render(
      <I18nProvider initial="en">
        <div className="entry-main--scroll">
          <HomeView
            projects={[]}
            onSubmit={() => undefined}
            onOpenProject={() => undefined}
            onViewAllProjects={() => undefined}
            promptHandoff={createPluginUseHandoff(1, 'required-input-plugin', {
              action: 'use-with-query',
            })}
          />
        </div>
      </I18nProvider>,
    );
    const scrollContainer = view.container.querySelector('.entry-main--scroll') as HTMLElement;
    scrollContainer.scrollTop = 240;

    const submit = (await screen.findByTestId('home-hero-submit')) as HTMLButtonElement;
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-active-plugin')).toBeTruthy();
    });
    expect(submit.disabled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(submit.className).not.toContain('home-hero__attention-sheen');
  });
});
