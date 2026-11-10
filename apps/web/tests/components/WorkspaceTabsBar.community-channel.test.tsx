// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/types';
import type { Route } from '../../src/router';

const RELEASE_CHANNEL_ENV = 'NEXT_PUBLIC_OD_RELEASE_CHANNEL';
const initialReleaseChannel = process.env[RELEASE_CHANNEL_ENV];
const STORAGE_KEY = 'open-design:workspace-tabs:v1';
const IDENTITY_SCOPE_KEY = 'user-1::ws-stable';

const project: Project = {
  id: 'project-alpha',
  name: 'Project Alpha',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const projectRoute: Route = {
  kind: 'project',
  projectId: project.id,
  conversationId: null,
  fileName: null,
};

async function loadStableTabsBar() {
  vi.resetModules();
  vi.stubEnv(RELEASE_CHANNEL_ENV, 'stable');
  const [{ WorkspaceTabsBar }, { I18nProvider }] = await Promise.all([
    import('../../src/components/WorkspaceTabsBar'),
    import('../../src/i18n'),
  ]);
  return { WorkspaceTabsBar, I18nProvider };
}

function storedEntryTabView(): string | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: Array<{ kind?: string; view?: string }>;
    };
    return parsed.tabs?.find((tab) => tab.kind === 'entry')?.view ?? null;
  } catch {
    return null;
  }
}

beforeEach(() => {
  window.localStorage.clear();
});

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

describe('WorkspaceTabsBar community persistence', () => {
  it('normalizes a restored community tab to home in stable builds', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scopeKey: IDENTITY_SCOPE_KEY,
        tabs: [
          {
            id: 'entry:community:persisted',
            kind: 'entry',
            view: 'community',
            entryRoute: { kind: 'home', view: 'community' },
            createdAt: 1,
            lastActiveAt: 1,
          },
        ],
        activeTabId: 'entry:community:persisted',
      }),
    );

    const { WorkspaceTabsBar, I18nProvider } = await loadStableTabsBar();
    render(
      <I18nProvider initial="en">
        <WorkspaceTabsBar
          route={projectRoute}
          projects={[project]}
          identityScopeKey={IDENTITY_SCOPE_KEY}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(storedEntryTabView()).toBe('home'));
    expect(screen.queryByText('community')).toBeNull();
  });
});
