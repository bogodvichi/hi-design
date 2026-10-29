import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { closeDatabase, ensureWorkspaceResource, openDatabase } from '../../src/db.js';
import { listSkills } from '../../src/skills.js';

let root: string;
afterEach(async () => { closeDatabase(); if (root) await rm(root, { recursive: true, force: true }); });

it('returns the cloud source identity only with the visible installed Skill', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'skill-cloud-binding-'));
  const skillsRoot = path.join(root, 'skills');
  await mkdir(path.join(skillsRoot, 'review'), { recursive: true });
  await writeFile(path.join(skillsRoot, 'review', 'SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview.');
  const db = openDatabase(root, { dataDir: root });
  ensureWorkspaceResource(db, 'skill', 'workspace', 'review', {
    visibility: 'personal', resourceState: 'active', createdByWorkspaceMemberId: 'me',
    resourceHubResourceId: 'maas-skillhub:resource',
  });
  expect(await listSkills(skillsRoot, { db, workspaceId: 'workspace', workspaceMemberId: 'me' }))
    .toMatchObject([{ id: 'review', cloudResourceId: 'maas-skillhub:resource' }]);
  expect(await listSkills(skillsRoot, { db, workspaceId: 'workspace', workspaceMemberId: 'someone-else' })).toEqual([]);
  expect(await listSkills(skillsRoot, { db, workspaceId: 'another-workspace', workspaceMemberId: 'me' })).toEqual([]);
});
