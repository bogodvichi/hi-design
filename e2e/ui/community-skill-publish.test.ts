import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { mockAmrPersonalWorkspace } from '@/playwright/amr';
import { T } from '@/timeouts';

test('[P1] publishing a local Skill locks removal and restores editing after failure', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  await applyStandardMocks(page);
  await mockAmrPersonalWorkspace(page);
  await page.addInitScript(() => {
    localStorage.setItem('open-design:locale', 'zh-CN');
    localStorage.setItem('open-design:locale-source', 'manual');
  });
  await page.route('**/api/workspace/skills/cloud?**', route => route.fulfill({ json: { skills: [] } }));
  await page.route('**/api/workspace/skills/cloud/check?**', route => route.fulfill({ json: { exists: false } }));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let uploads = 0;
  let uploadedLastFile = false;
  let uploadedWrapper = false;
  await page.route('**/api/workspace/skills/cloud/upload?scope=public', async route => {
    uploads++;
    const body = route.request().postDataBuffer();
    uploadedLastFile = body?.includes(Buffer.from('reference-599.md')) ?? false;
    uploadedWrapper = (body?.includes(Buffer.from('outside-wrapper.md')) || body?.includes(Buffer.from('one/two/three/'))) ?? false;
    await pending;
    await route.fulfill({ status: 503, json: { error: 'RESOURCE_NAME_REGISTRY_NOT_READY' } });
  });
  try {
    await page.goto('/square/skill');
    await page.getByRole('button', { name: /New Publish|新建发布/ }).click();
    const dialog = page.getByTestId('publish-dialog');
    await dialog.getByRole('tab', { name: /Import local Skill|导入本地 Skill/i }).click();
    const limits = dialog.getByText(/Supports folders|支持文件夹/);
    await expect(limits).toBeVisible();
    await expect(limits).toContainText(/500\s*MB/);
    await expect(limits).not.toContainText('10 MB');
    await expect(dialog.getByText(/No file count limit\.|不限制文件数量/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('skill-upload-limits.png') });
    const folder = join(testInfo.outputDir, 'skill-folder');
    const skillRoot = join(folder, 'one', 'two', 'three');
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(folder, 'outside-wrapper.md'), 'Wrapper only');
    await writeFile(join(skillRoot, '2SKILL.md'), '---\nname: ui-publish-test\n---\n# Skill');
    await Promise.all(Array.from({ length: 600 }, (_, i) => writeFile(join(skillRoot, `reference-${i}.md`), `Reference ${i}`)));
    await dialog.locator('input[type=file][multiple]').setInputFiles(folder);
    await expect(limits).toHaveCount(0);
    const summary = dialog.getByRole('group', {name: '已选择的 Skill'});
    await expect(summary).toContainText('skill-folder');
    await expect(summary).toContainText('602 个文件');
    await expect(summary).toContainText(/\d+(?:\.\d+)? (?:B|KB|MB)/);
    await expect(summary.getByRole('button', {name: '删除已导入 Skill'})).toBeVisible();
    await page.screenshot({path: testInfo.outputPath('community-skill-selected.png')});
    await dialog.getByRole('radio', { name: /Developer tools|开发工具/i }).click();
    const confirm = dialog.getByRole('button', { name: /^Publish$|确认发布/i });
    await expect(confirm).toBeEnabled();
    const remove = dialog.getByRole('button', { name: /Remove imported Skill|删除已导入 Skill/ });
    await expect(remove).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByRole('button', { name: /Publishing|发布中/ })).toBeVisible();
    await expect(remove).toBeDisabled();
    expect(await remove.evaluate(button => button.matches(':disabled'))).toBe(true);
    await remove.evaluate(button => (button as HTMLButtonElement).click());
    await expect(dialog.getByText('skill-folder', { exact: true })).toBeVisible();
    await expect.poll(() => uploads).toBe(1);
    expect(uploadedLastFile).toBe(true);
    expect(uploadedWrapper).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('publishing-disabled.png') });
    release();
    await expect(remove).toBeEnabled();
    await expect(page.getByText(/The publishing service is not ready|发布服务尚未就绪/)).toBeVisible();
    await remove.click();
    await expect(dialog.getByText('skill-folder', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test('[P1] local Skill folders report missing and multiple manifests before upload', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  await applyStandardMocks(page);
  await mockAmrPersonalWorkspace(page);
  await page.route('**/api/workspace/skills/cloud?**', route => route.fulfill({ json: { skills: [] } }));
  let uploads = 0;
  await page.route('**/api/workspace/skills/cloud/upload?**', route => {
    uploads++;
    return route.fulfill({ status: 500, json: { error: 'unexpected upload' } });
  });
  await page.goto('/square/skill');
  await page.getByRole('button', { name: /New Publish|新建发布/ }).click();
  const dialog = page.getByTestId('publish-dialog');
  await dialog.getByRole('tab', { name: /Import local Skill|导入本地 Skill/i }).click();
  for (const entry of [
    { name: 'missing', paths: ['one/two/example.txt'], error: /SKILL.md was not found|未找到skill.md文件/ },
    { name: 'multiple', paths: ['one/SKILL.md', 'two/three/skill.md'], error: /Multiple Skills cannot be uploaded|无法上传多个skill/ },
  ]) {
    const folder = join(testInfo.outputDir, entry.name);
    for (const file of entry.paths) {
      const target = join(folder, file);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, entry.name === 'missing' ? '# Readme' : '---\nname: example\n---\n# Skill');
    }
    await dialog.locator('input[type=file][multiple]').setInputFiles(folder);
    await expect(dialog.getByRole('alert')).toContainText(entry.error);
    await expect(dialog.getByRole('button', { name: /^Publish$|确认发布/i })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`skill-${entry.name}.png`) });
    await dialog.getByRole('button', { name: /Remove imported Skill|删除已导入 Skill/ }).click();
  }
  expect(uploads).toBe(0);
});
