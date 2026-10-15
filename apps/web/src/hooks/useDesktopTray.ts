import { useEffect } from 'react';
import { getOpenDesignHost } from '@open-design/host';
import type { Project } from '../types';
import {
  readRecentlyOpenedProjectEntries,
  RECENTLY_OPENED_PROJECTS_CHANGED_EVENT,
} from '../lib/recently-opened-projects';

/** Publish the current user's project shortcuts; opening uses the normal authorization path. */
export function useDesktopTray(
  projects: Project[],
  onOpenProject: (projectId: string) => Promise<boolean>,
  enabled: boolean,
): void {
  useEffect(() => {
    const tray = getOpenDesignHost()?.tray;
    if (!tray) return;
    if (!enabled) {
      tray.setRecentProjects([]);
      return;
    }
    let publishedIds = new Set<string>();
    const publish = () => {
      const opened = new Map(readRecentlyOpenedProjectEntries().map((entry) => [entry.id, entry.openedAt]));
      const recent = [...projects]
        .sort((a, b) => (opened.get(b.id) ?? b.updatedAt) - (opened.get(a.id) ?? a.updatedAt))
        .slice(0, 5)
        .map(({ id, name }) => ({ id, name }));
      publishedIds = new Set(recent.map((project) => project.id));
      tray.setRecentProjects(recent);
    };
    publish();
    const unsubscribe = tray.subscribeOpenProject((id) => {
      if (publishedIds.has(id)) void onOpenProject(id);
    });
    window.addEventListener(RECENTLY_OPENED_PROJECTS_CHANGED_EVENT, publish);
    return () => {
      unsubscribe();
      window.removeEventListener(RECENTLY_OPENED_PROJECTS_CHANGED_EVENT, publish);
      tray.setRecentProjects([]);
    };
  }, [projects, onOpenProject, enabled]);
}
