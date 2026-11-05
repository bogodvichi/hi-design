import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/types';
import { projectCover } from '../../src/components/RecentProjectsStrip';

import {
  communityOriginProjectId,
  communityOriginProjectName,
  projectFallbackVisual,
  selectProjectFileCover,
} from '../../src/components/project-cover';

describe('project cover identity', () => {
  const historicalProject = {
    id: 'historical-project', name: 'Historical project', createdAt: 1, updatedAt: 2,
    skillId: null, designSystemId: null, status: { value: 'succeeded' },
  } as Project;

  it.each(['notes.txt', 'notes.md'])('requests a persistent cover for historical text: %s', (entryFile) => {
    const metadata = { kind: 'prototype' as const, entryFile };
    expect(projectCover({ ...historicalProject, metadata }, null)).toMatchObject({
      kind: 'image', src: '/api/projects/historical-project/cover?v=2',
    });
  });

  it('discovers historical text files without entry metadata', () => {
    const override = selectProjectFileCover([{ name: 'notes.txt', kind: 'text', mtime: 1, size: 10, mime: 'text/plain' }]);
    expect(override?.generated).toBe(true);
    expect(projectCover(historicalProject, override)).toMatchObject({ kind: 'image', src: '/api/projects/historical-project/cover?v=2' });
  });

  it('keeps pure chat projects on the original fallback', () => {
    expect(projectCover(historicalProject, selectProjectFileCover([])).kind).toBe('fallback');
  });

  it('recognizes an image entry without relying on legacy project kind metadata', () => {
    const cover = projectCover({ ...historicalProject, metadata: { kind: 'prototype', entryFile: 'picture.png' } }, null);
    expect(cover.kind).toBe('image');
    expect(cover.src).toContain('picture.png');
  });

  it('keeps catalog-only placeholders from probing local content', () => {
    expect(projectCover({ ...historicalProject, metadata: { kind: 'prototype', sharedProjectPlaceholderAt: 1 } }, null).kind).toBe('fallback');
  });

  it('reuses the original project identity for community fallback covers', () => {
    const projectId = 'project-hik-login';
    const projectName = 'hik_login_tool_js';
    const tags = [
      'project',
      'community',
      `project-id:${projectId}`,
      `project-name:${encodeURIComponent(projectName)}`,
    ];

    expect(communityOriginProjectId(tags)).toBe(projectId);
    expect(communityOriginProjectName(tags)).toBe(projectName);

    const personal = projectFallbackVisual(projectId, projectName);
    const community = projectFallbackVisual(
      communityOriginProjectId(tags)!,
      communityOriginProjectName(tags)!,
    );

    expect(community).toEqual(personal);
    expect(community.initial).toBe('H');
  });
});
