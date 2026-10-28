import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

const content = '---\nname: renamed-skill\ndescription: Browser upload\n---\n# Instructions\nKeep the original content.\n';
const personal = {
  workspaceId: 'markdown-personal', workspaceMemberId: 'personal-member',
  workspaceName: 'Personal', workspaceType: 'team', isDefaultTeam: true,
  role: 'owner', memberStatus: 'active', lifecycleState: 'active',
};
const team = { ...personal, workspaceId: 'markdown-team', workspaceMemberId: 'team-member',
  workspaceName: 'Markdown Team', isDefaultTeam: false };

for (const scope of ['personal', 'team'] as const) {
  for (const entryPoint of ['file picker', 'drop'] as const) {
    test(`[P1] ${scope} Skill ${entryPoint} sends renamed Markdown as SKILL.md`, async ({ page }) => {
      test.setTimeout(T.xlong);
      await applyStandardMocks(page);
      const workspace = scope === 'personal' ? personal : team;
      const context = { ...workspace, billingState: 'free', planId: null, permissions: {} };
      const uploads: Array<{ body: string; workspaceId: string | undefined }> = [];
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { value: 'Win32' });
        localStorage.setItem('open-design:auth-session', JSON.stringify({
          version: 1, username: 'markdown-test', loginAt: 1,
        }));
      });
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/api/auth/valid') {
          await route.fulfill({ json: { ok: true, username: 'markdown-test' } });
        } else if (path === '/api/workspace/directory') {
          await route.fulfill({ json: { items: [personal, team] } });
        } else if (path === '/api/workspace/context' || path === '/api/workspace/active') {
          await route.fulfill({ json: { context } });
        } else if (/\/api\/hdw\/api\/team\/.*\/member\//.test(path)) {
          await route.fulfill({ json: { code: 0, data: { workspace_member_id: workspace.workspaceMemberId, role: 'owner' } } });
        } else if (path === '/api/workspace/skills/cloud/check') {
          await route.fulfill({ json: { exists: false } });
        } else if (path === '/api/workspace/skills/cloud/upload') {
          uploads.push({ body: request.postDataBuffer()!.toString('utf8'),
            workspaceId: request.headers()['x-od-workspace-id'] });
          await route.fulfill({ json: { shared: true, title: 'renamed-skill', resourceId: 'markdown-source' } });
        } else if (path === '/api/workspace/skills/cloud/markdown-source/install') {
          await route.fulfill({ json: { installed: true } });
        } else if (path === '/api/workspace/skills/cloud' || path === '/api/workspace/skills/team') {
          await route.fulfill({ json: { skills: [], ids: [], resources: [] } });
        } else {
          await route.fallback();
        }
      });
      await page.goto(scope === 'personal' ? '/personal-all/skill' : `/team/${team.workspaceId}/skill`);
      await page.getByRole('button', { name: /^(Add Skill|添加 Skill)$/ }).click();
      const dialog = page.getByRole('dialog', { name: /^(Add Skill|添加 Skill)$/ });
      if (entryPoint === 'file picker') {
        const chooser = page.waitForEvent('filechooser');
        await dialog.getByRole('button', { name: /^(Choose file|Select file|选择文件)$/i }).click();
        await (await chooser).setFiles({ name: '2skill.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
      } else {
        const dataTransfer = await page.evaluateHandle((text) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([text], '2skill.md', { type: 'text/markdown' }));
          return transfer;
        }, content);
        await dialog.getByRole('button', { name: /拖拽或点击上传|Drag|Drop/i }).dispatchEvent('drop', { dataTransfer });
        await dataTransfer.dispose();
      }
      await expect(dialog.getByText('2skill.md', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: /^(Confirm|确认)$/ }).click();
      await expect(dialog).not.toBeVisible();
      expect(uploads).toHaveLength(1);
      const uploaded = uploads[0]!;
      expect(uploaded.workspaceId).toBe(workspace.workspaceId);
      expect(uploaded.body).toContain('filename="SKILL.md"');
      expect(uploaded.body).toContain('["SKILL.md"]');
      expect(uploaded.body).toContain(content);
      expect(uploaded.body).not.toContain('filename="2skill.md"');
    });
  }
}
