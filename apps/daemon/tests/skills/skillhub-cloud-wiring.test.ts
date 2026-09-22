import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/server.ts',
);
const source = fs.readFileSync(serverSourcePath, 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `expected to find ${start}`).toBeGreaterThan(-1);
  expect(endIndex, `expected to find ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('Skillhub cloud skill wiring', () => {
  it('lists community skills from the resolved MAAS Skillhub workspace', () => {
    const route = sourceBetween(
      "app.get('/api/workspace/skills/cloud',",
      "app.post('/api/workspace/skills/cloud/:resourceId/install',",
    );

    expect(route).toContain('sourceProvider === MAAS_SKILLHUB_PROVIDER');
    expect(route).toContain("sourceProvider === 'all'");
    expect(route).toContain("maasSkillhubClient.listSkills('')");
    expect(route).toContain('communitySkillMatchesQuery(skill, searchQuery)');
    expect(route).toContain('homeWorkspaceId: maasWorkspaceId');
    expect(route).toContain('provider: MAAS_SKILLHUB_PROVIDER');
    expect(route).toContain('publisherName: skill.userNotesName || skill.userName || skill.userId || null');
    expect(route).toContain('iconUrl: skill.iconUrl ?? null');
    expect(route).toContain('category: normalizeSkillCategory(skill.skillSubType)');
    expect(route).toContain('category: normalizeSkillCategory((r.metadata as any)?.category)');
    expect(route).toContain('categoryCounts: counts');
    expect(route).toContain("normalized.filter((item) => item.category === requestedCategory)");
  });

  it('requires a category for community publishing and persists it in resource metadata', () => {
    const uploadRoute = sourceBetween(
      "app.post('/api/workspace/skills/cloud/upload',",
      'const teamResourceListByKind =',
    );

    expect(uploadRoute).toContain("resourceScope === 'public' && !isSkillCategory(requestedCategory)");
    expect(uploadRoute).toContain("const category = isSkillCategory(requestedCategory) ? requestedCategory : 'other'");
    expect(uploadRoute).toContain('category,');
    expect(uploadRoute).toContain("res.json({ shared: true, title: prepared.title, category");
  });

  it('downloads the selected MAAS Skill ZIP into the local skill directory and binds it', () => {
    const installRoute = sourceBetween(
      "app.post('/api/workspace/skills/cloud/:resourceId/install',",
      "app.delete('/api/workspace/skills/cloud/:resourceId/uninstall',",
    );

    expect(installRoute).toContain('preferredMaasWorkspaceId');
    expect(installRoute).toContain('maasSkillhubClient.getSkill(');
    expect(installRoute).toContain('maasWorkspaceId,');
    expect(installRoute).toContain('installMaasSkillLocally(');
    expect(installRoute).toContain('USER_SKILLS_DIR,');
    expect(installRoute).toContain("ensureWorkspaceResource(db, 'skill', workspaceId, localId");
    expect(installRoute).toContain("visibility: 'personal'");
    expect(installRoute).toContain('resourceHubResourceId: hubResourceId');
  });
});
