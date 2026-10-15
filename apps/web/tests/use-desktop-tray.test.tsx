// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import type { Project } from '../src/types';
import { useDesktopTray } from '../src/hooks/useDesktopTray';

function project(id: string, updatedAt: number): Project {
  return { id, name: `Project ${id}`, createdAt: 1, updatedAt, skillId: null, designSystemId: null };
}

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); });

function install() {
  const setRecentProjects = vi.fn();
  const unsubscribe = vi.fn();
  let open: (id: string) => void = () => undefined;
  restore = installMockOpenDesignHost({ host: { tray: {
    setRecentProjects,
    subscribeOpenProject: (listener) => { open = listener; return unsubscribe; },
  } } });
  return { setRecentProjects, unsubscribe, open: (id: string) => open(id) };
}

describe('desktop tray project shortcuts', () => {
  it('preserves the Home recent feed order instead of sorting by project update time', () => {
    const tray = install();
    const projects = Array.from({ length: 7 }, (_, i) => project(`p${i}`, i));
    const { unmount } = renderHook(() => useDesktopTray(projects, vi.fn(async () => true), true));
    expect(tray.setRecentProjects).toHaveBeenLastCalledWith(
      ['p0', 'p1', 'p2', 'p3', 'p4'].map((id) => ({ id, name: `Project ${id}` })),
    );
    unmount();
    expect(tray.unsubscribe).toHaveBeenCalledOnce();
    expect(tray.setRecentProjects).toHaveBeenLastCalledWith([]);
  });

  it('opens through the existing project handler and drops deleted or stale shortcuts', () => {
    const tray = install();
    const onOpen = vi.fn(async () => true);
    const { rerender, unmount } = renderHook(({ projects }) => useDesktopTray(projects, onOpen, true), {
      initialProps: { projects: [project('p1', 1)] },
    });
    act(() => { tray.open('p1'); tray.open('foreign'); });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('p1');
    rerender({ projects: [] });
    act(() => tray.open('p1'));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(tray.setRecentProjects).toHaveBeenLastCalledWith([]);
    unmount();
  });

  it('follows Home feed changes and clears during account transitions', () => {
    const tray = install();
    const projects = [project('p1', 1), project('p2', 2)];
    const onOpen = vi.fn(async () => true);
    const { rerender, unmount } = renderHook(({ projects, enabled }) => useDesktopTray(projects, onOpen, enabled), {
      initialProps: { projects, enabled: true },
    });
    rerender({ projects: [...projects].reverse(), enabled: true });
    expect(tray.setRecentProjects.mock.lastCall?.[0][0].id).toBe('p2');
    rerender({ projects: [], enabled: false });
    expect(tray.setRecentProjects).toHaveBeenLastCalledWith([]);
    unmount();
  });

  it('works in a browser or an older desktop without a tray bridge', () => {
    const { unmount } = renderHook(() => useDesktopTray([], vi.fn(async () => true), true));
    unmount();
  });
});
