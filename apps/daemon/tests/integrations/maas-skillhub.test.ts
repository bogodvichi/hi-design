import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMaasSkillhubClient,
  decryptMaasCurrentUser,
  extractMaasSkillZip,
  installMaasSkillLocally,
  maasSkillLocalId,
} from '../../src/integrations/maas-skillhub.js';
import type { Cookie, RawResult } from '../../src/http/http.js';

const tempDirs: string[] = [];
const ssoCookies: Cookie[] = [{ name: 'JwtToken', value: 'sso', domain: 'hikvision.com.cn' }];
const maasCookies: Cookie[] = [{ name: 'SESSION', value: 'maas', domain: 'maas.hikvision.com.cn' }];

function rawResult(body: unknown, cookies = maasCookies): RawResult {
  return {
    finalUrl: 'https://maas.hikvision.com.cn/',
    body: JSON.stringify(body),
    status: 200,
    cookies,
  };
}

function encryptCurrentUser(value: Record<string, unknown>): string {
  const cipher = crypto.createCipheriv(
    'aes-128-ecb',
    Buffer.from('hikvision1234567', 'utf8'),
    null,
  );
  return Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]).toString('hex');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('MAAS Skillhub client', () => {
  it('decrypts the employee identity used by MAAS request headers', () => {
    expect(decryptMaasCurrentUser(encryptCurrentUser({ userEmpid: 'HZ12345678' }))).toEqual({
      userEmpid: 'HZ12345678',
    });
  });

  it('resolves and caches the default MAAS workspace before querying available skills', async () => {
    const workspaceId = '1947900443998355458';
    const requestText = vi.fn(async (method: string, url: string, _cookies: Cookie[], opts?: any) => {
      if (url.endsWith('/maas/')) return rawResult('<html />', maasCookies);
      if (url.endsWith('/user/currentUser')) {
        return rawResult({ code: '0', data: encryptCurrentUser({ userEmpid: 'HZ12345678', curSpace: null }) });
      }
      if (url.endsWith('/space/spaceList')) {
        expect(method).toBe('GET');
        expect(opts.extraHeaders).toMatchObject({
          empid: 'HZ12345678',
          source: 'webContainer',
        });
        return rawResult({
          code: '0',
          data: [{ id: workspaceId, spaceName: '默认工作空间' }],
        });
      }
      expect(method).toBe('POST');
      expect(url).toContain('/component/skill/availableList');
      expect(opts.extraHeaders).toMatchObject({
        empid: 'HZ12345678',
        source: 'webContainer',
        spaceid: workspaceId,
      });
      expect(JSON.parse(opts.body)).toMatchObject({
        currentPage: 1,
        pageSize: 200,
        skillName: 'design',
      });
      return rawResult({
        code: '0',
        data: {
          data: [{ id: '2086', skillName: 'Design Review', skillSlug: 'design-review' }],
          total: 1,
        },
      });
    });
    const client = createMaasSkillhubClient('/data', {
      readSso: () => ({ username: 'designer', cookies: ssoCookies }),
      requestText: requestText as any,
    });

    const expected = {
      workspaceId,
      skills: [{ id: '2086', skillName: 'Design Review', skillSlug: 'design-review' }],
    };
    await expect(client.listSkills('design')).resolves.toEqual(expected);
    await expect(client.listSkills('design')).resolves.toEqual(expected);
    expect(requestText.mock.calls.filter(([, url]) => String(url).endsWith('/space/spaceList'))).toHaveLength(1);
  });

  it('refreshes the MAAS workspace after a cached workspace loses permission', async () => {
    const oldWorkspaceId = 'old-workspace';
    const newWorkspaceId = 'new-workspace';
    let workspaceListCalls = 0;
    const requestText = vi.fn(async (_method: string, url: string, _cookies: Cookie[], opts?: any) => {
      if (url.endsWith('/maas/')) return rawResult('<html />', maasCookies);
      if (url.endsWith('/user/currentUser')) {
        return rawResult({ code: '0', data: encryptCurrentUser({ userEmpid: 'HZ12345678', curSpace: null }) });
      }
      if (url.endsWith('/space/spaceList')) {
        workspaceListCalls += 1;
        const id = workspaceListCalls === 1 ? oldWorkspaceId : newWorkspaceId;
        return rawResult({ code: '0', data: [{ id, spaceName: '默认工作空间' }] });
      }
      if (url.endsWith('/component/skill/availableList') && opts.extraHeaders.spaceid === oldWorkspaceId) {
        return rawResult({ code: '0x03020007', msg: '无空间权限' });
      }
      return rawResult({
        code: '0',
        data: { data: [{ id: '2086', skillName: 'Design Review' }], total: 1 },
      });
    });
    const client = createMaasSkillhubClient('/data', {
      readSso: () => ({ username: 'designer', cookies: ssoCookies }),
      requestText: requestText as any,
    });

    await expect(client.listSkills()).resolves.toEqual({
      workspaceId: newWorkspaceId,
      skills: [{ id: '2086', skillName: 'Design Review' }],
    });
    expect(workspaceListCalls).toBe(2);
  });

  it('uses the workspace carried by a Skill card when multiple MAAS workspaces are available', async () => {
    const preferredWorkspaceId = 'workspace-b';
    const requestText = vi.fn(async (method: string, url: string, _cookies: Cookie[], opts?: any) => {
      if (url.endsWith('/maas/')) return rawResult('<html />', maasCookies);
      if (url.endsWith('/user/currentUser')) {
        return rawResult({ code: '0', data: encryptCurrentUser({ userEmpid: 'HZ12345678', curSpace: null }) });
      }
      if (url.endsWith('/space/spaceList')) {
        return rawResult({
          code: '0',
          data: [
            { id: 'workspace-a', spaceName: 'Workspace A' },
            { id: preferredWorkspaceId, spaceName: 'Workspace B' },
          ],
        });
      }
      expect(method).toBe('POST');
      expect(url).toContain('/component/skill/detail/2086');
      expect(opts.extraHeaders.spaceid).toBe(preferredWorkspaceId);
      return rawResult({ code: '0', data: { id: '2086', skillName: 'Design Review' } });
    });
    const client = createMaasSkillhubClient('/data', {
      readSso: () => ({ username: 'designer', cookies: ssoCookies }),
      requestText: requestText as any,
    });

    await expect(client.getSkill('2086', preferredWorkspaceId)).resolves.toEqual({
      workspaceId: preferredWorkspaceId,
      skill: { id: '2086', skillName: 'Design Review' },
    });
  });

  it('downloads and flattens a single-folder Skill ZIP', async () => {
    const zip = new JSZip();
    zip.file('design-review/SKILL.md', '# Design Review');
    zip.file('design-review/scripts/run.js', 'console.log("ok");');
    const archive = await zip.generateAsync({ type: 'nodebuffer' });
    const destination = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'maas-skillhub-test-'));
    tempDirs.push(destination);

    await extractMaasSkillZip(archive, destination);

    await expect(fs.promises.readFile(path.join(destination, 'SKILL.md'), 'utf8'))
      .resolves.toBe('# Design Review');
    await expect(fs.promises.readFile(path.join(destination, 'scripts/run.js'), 'utf8'))
      .resolves.toContain('console.log');
  });

  it('uses a stable fallback folder id when the MAAS slug is not filesystem-safe', () => {
    expect(maasSkillLocalId({ id: '2086', skillName: '设计评审', skillSlug: '设计评审' }))
      .toBe('maas-skill-2086');
  });

  it('prefers the canonical name declared by the downloaded SKILL.md', () => {
    expect(maasSkillLocalId({
      id: '2086',
      skillName: 'Design Review',
      skillSlug: 'design-review-r4Nd',
      skillMdContent: '---\nname: design-review\ndescription: Review designs\n---\nBody',
    })).toBe('design-review');
  });

  it('installs a downloaded package as a directly discoverable local skill', async () => {
    const dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'maas-local-skill-test-'));
    tempDirs.push(dataRoot);
    const skillsRoot = path.join(dataRoot, 'skills');

    const destination = await installMaasSkillLocally(
      skillsRoot,
      'maas-skill-2086',
      'Design Review',
      async (stagedFolder) => {
        await fs.promises.writeFile(
          path.join(stagedFolder, 'SKILL.md'),
          '---\nname: design-review\ndescription: Review designs\n---\n\nReview the supplied design.\n',
        );
      },
    );

    expect(destination).toEqual({
      dir: path.join(skillsRoot, 'maas-skill-2086'),
      localId: 'design-review',
    });
    await expect(fs.promises.readFile(path.join(destination.dir, 'SKILL.md'), 'utf8'))
      .resolves.toContain('name: design-review');
  });

  it('normalizes a package without frontmatter using its MAAS display name', async () => {
    const dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'maas-local-skill-test-'));
    tempDirs.push(dataRoot);
    const skillsRoot = path.join(dataRoot, 'skills');

    const installed = await installMaasSkillLocally(
      skillsRoot,
      'maas-skill-2086757671402340354',
      'Hiklink云文档工具包',
      async (stagedFolder) => {
        await fs.promises.writeFile(
          path.join(stagedFolder, 'SKILL.md'),
          'name: legacy-package\n\nRun the local cloud document tool.\n',
        );
      },
    );

    expect(installed.localId).toBe('Hiklink云文档工具包');
    await expect(fs.promises.readFile(path.join(installed.dir, 'SKILL.md'), 'utf8'))
      .resolves.toMatch(/^---\nname: "Hiklink云文档工具包"\n---/u);
  });
});
