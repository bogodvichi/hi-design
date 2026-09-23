import { describe, expect, it } from 'vitest';

import {
  communityOriginProjectId,
  communityOriginProjectName,
  projectFallbackVisual,
} from '../../src/components/project-cover';

describe('project cover identity', () => {
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
