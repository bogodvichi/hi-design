// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../src/analytics/provider', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/analytics/provider')>(),
  useAnalytics: () => analytics,
}));
vi.mock('../../src/i18n', async (importOriginal) => {
  const translate = (key: string) => key;
  return { ...await importOriginal<typeof import('../../src/i18n')>(), useT: () => translate };
});
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false, failure: null }),
  useSharedSpaceTeamId: () => null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('recent project sorting telemetry', () => {
  it.each([
    ['recentProjects.sortRecentlyViewed', 'recent_viewed'],
    ['recentProjects.sortNewest', 'updated_desc'],
    ['recentProjects.sortOldest', 'updated_asc'],
    ['recentProjects.sortName', 'name_asc'],
  ])('preserves the %s selection and reports %s', (label, value) => {
    render(<RecentProjectsStrip projects={[]} onOpen={vi.fn()} emptyContent={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.sortAria' }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(analytics.track).toHaveBeenCalledWith('ui_click', expect.objectContaining({
      page_name: 'home', area: 'project_collection', element: 'sort', sort_value: value,
    }), undefined);
    fireEvent.click(screen.getByRole('button', { name: 'recentProjects.sortAria' }));
    expect(screen.getByRole('button', { name: label }).className).toContain('is-active');
  });
});
