import { useEffect } from 'react';
import { getOpenDesignHost } from '@open-design/host';
import type { Project } from '../types';

/** Publish Home's ordered recent feed without introducing a second list policy. */
export function useDesktopTray(
  projects: Project[],
  onOpenProject: (projectId: string) => Promise<boolean | void> | boolean | void,
  enabled: boolean,
): void {
  useEffect(() => {
    const tray = getOpenDesignHost()?.tray;
    if (!tray) return;
    if (!enabled) {
      tray.setRecentProjects([]);
      return;
    }
    const recent = projects.slice(0, 5).map(({ id, name }) => ({ id, name }));
    const publishedIds = new Set(recent.map((project) => project.id));
    tray.setRecentProjects(recent);
    const unsubscribe = tray.subscribeOpenProject((id) => {
      if (publishedIds.has(id)) void onOpenProject(id);
    });
    return () => {
      unsubscribe();
      tray.setRecentProjects([]);
    };
  }, [projects, onOpenProject, enabled]);
}
