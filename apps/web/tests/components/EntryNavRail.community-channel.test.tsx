// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const RELEASE_CHANNEL_ENV = 'NEXT_PUBLIC_OD_RELEASE_CHANNEL';
const initialReleaseChannel = process.env[RELEASE_CHANNEL_ENV];

async function loadStableRail() {
  vi.resetModules();
  vi.stubEnv(RELEASE_CHANNEL_ENV, 'stable');
  const [{ EntryNavRail }, { I18nProvider }] = await Promise.all([
    import('../../src/components/EntryNavRail'),
    import('../../src/i18n'),
  ]);
  return { EntryNavRail, I18nProvider };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (initialReleaseChannel == null) {
    delete process.env[RELEASE_CHANNEL_ENV];
  } else {
    process.env[RELEASE_CHANNEL_ENV] = initialReleaseChannel;
  }
});

describe('EntryNavRail community visibility', () => {
  it('does not render the community template entry in stable builds', async () => {
    const { EntryNavRail, I18nProvider } = await loadStableRail();

    render(
      <I18nProvider initial="en">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          open
          context={null}
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('entry-nav-community')).toBeNull();
    expect(screen.getByTestId('entry-nav-home')).toBeTruthy();
  });
});
