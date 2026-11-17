import { expect, test } from '@/playwright/suite';
import { dragNativeScrollbar } from '@/playwright/scrollbars';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { AMR_PERSONAL_WORKSPACE_CONTEXT, mockAmrPersonalWorkspace } from '@/playwright/amr';
import { ensureRailOpen } from '@/playwright/rail';
import { T } from '@/timeouts';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  await mockAmrPersonalWorkspace(page);
  await page.addInitScript(() => {
    localStorage.setItem('open-design:locale', 'zh-CN');
    localStorage.setItem('open-design:locale-source', 'manual');
  });
  await page.route('**/api/workspace/skills/cloud?**', route => route.fulfill({ json: { skills: [] } }));
});

test('[P2] long settings pages expose the global scrollbar in a short window', async ({ page }) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize({ width: 1000, height: 360 });
  await page.goto('/settings');
  await page.getByTestId('settings-nav-execution').click();
  const content = page.locator('.settings-content');
  await expect(page.locator('body')).toHaveAttribute('data-od-native-scrollbars', '');
  await expect.poll(() => content.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  await dragNativeScrollbar(page, content);
  await expect.poll(() => content.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await content.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect.poll(() => content.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^通用/ }).click();
  const general = page.locator('.settings-general-section');
  await expect(general).toBeVisible();
  // The general section must grow inside the card, so the card's right edge
  // owns the scrollbar instead of the narrower centered settings column.
  expect(await general.evaluate(e => {
    e.scrollTop = e.scrollHeight;
    return { scrollTop: e.scrollTop, overflowY: getComputedStyle(e).overflowY };
  })).toEqual({ scrollTop: 0, overflowY: 'visible' });
  await expect.poll(() => content.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  await content.evaluate(e => { e.scrollTop = 0; });
  await dragNativeScrollbar(page, content);
  await expect.poll(() => content.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  expect(await general.evaluate(e => e.scrollTop)).toBe(0);
});

test('[P2] resource import keeps its heading, source tabs and actions visible in a short window', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  const context = { ...AMR_PERSONAL_WORKSPACE_CONTEXT, workspaceType: 'team', isDefaultTeam: true };
  await page.route('**/api/workspace/directory', route => route.fulfill({ json: {
    items: [context], activeWorkspaceId: context.workspaceId,
  } }));
  await page.route('**/api/workspace/context', route => route.fulfill({ json: { context } }));
  await page.route('**/api/workspace/active', route => route.fulfill({ json: { context } }));
  await page.route(/\/api\/hdw\/api\/team\/.*\/member\//, route => route.fulfill({ json: {
    code: 0, data: { workspace_member_id: context.workspaceMemberId, role: 'owner' },
  } }));
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.goto('/personal-all/skill');
  await page.getByRole('button', { name: '添加 Skill', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加 Skill', exact: true });
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const header = dialog.locator(':scope > [data-dialog-part=header]');
  const tabs = dialog.getByRole('tablist');
  const body = dialog.locator(':scope > [data-dialog-part=body]');
  const footer = dialog.locator(':scope > [data-dialog-part=footer]');
  const headerBefore = (await header.boundingBox())!;
  const tabsBefore = (await tabs.boundingBox())!;
  const footerBefore = (await footer.boundingBox())!;
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBe(headerBefore.y);
  expect((await tabs.boundingBox())!.y).toBe(tabsBefore.y);
  expect((await footer.boundingBox())!.y).toBe(footerBefore.y);
  expect((await body.boundingBox())!.y - tabsBefore.y - tabsBefore.height).toBe(4);
  expect(headerBefore.y).toBeGreaterThanOrEqual(24);
  expect(footerBefore.y + footerBefore.height).toBeLessThanOrEqual(396);
  expect(await header.getByRole('heading').evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
  expect(await footer.getByRole('button', { name: '确认', exact: true }).evaluate(element => getComputedStyle(element).height)).toBe('36px');
  await page.screenshot({ path: testInfo.outputPath('skill-import-short-window.png') });
  await tabs.getByRole('tab', { name: '外部链接', exact: true }).click();
  expect(await body.evaluate(element => element.scrollTop)).toBe(0);
  await expect(body.getByRole('textbox')).toBeEditable();
  await body.getByRole('textbox').fill('https://example.com/unfinished-skill');
  await dialog.locator('..').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await expect(body.getByRole('textbox')).toHaveValue('https://example.com/unfinished-skill');
  await dialog.locator('[data-dialog-part=close]').click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: '添加 MCP', exact: true }).click();
  const mcpDialog = page.getByRole('dialog', { name: '添加 MCP', exact: true });
  const types = mcpDialog.getByRole('group', { name: 'MCP类型', exact: true });
  await expect(types).toBeVisible();
  expect(await types.evaluate(element => ({
    border: getComputedStyle(element).borderWidth,
    padding: getComputedStyle(element).padding,
    formGap: getComputedStyle(element.parentElement!).gap,
    formPadding: getComputedStyle(element.parentElement!).padding,
    labelSize: getComputedStyle(element.querySelector('legend')!).fontSize,
    labelWeight: getComputedStyle(element.querySelector('legend')!).fontWeight,
    aligned: element.getBoundingClientRect().left === element.querySelector('button')!.getBoundingClientRect().left,
  }))).toEqual({ border: '0px', padding: '0px', formGap: '18px', formPadding: '0px', labelSize: '13px', labelWeight: '500', aligned: true });
  const mcpName = mcpDialog.getByRole('textbox', { name: 'MCP 名称', exact: true });
  expect(await mcpName.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    radius: getComputedStyle(element).borderRadius,
    labelGap: getComputedStyle(element.parentElement!).gap,
  }))).toEqual({ height: 40, radius: '6px', labelGap: '6px' });
  await types.getByRole('button', { name: 'fetch', exact: true }).click();
  await expect(mcpName).toHaveValue('fetch');
  await expect(mcpDialog.getByRole('button', { name: '确认', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('add-mcp-unified-fields.png') });
});

test('[P2] shared confirmation uses the same chrome and cancel leaves the account signed in', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/');
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-account').hover();
  await page.getByRole('menuitem', { name: /Sign out|退出登录/i }).click();
  const dialog = page.getByTestId('sign-out-confirm-dialog');
  await expect(dialog).toBeVisible();
  const title = dialog.getByRole('heading');
  expect(await title.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
  expect(await dialog.evaluate(element => getComputedStyle(element).borderRadius)).toBe('12px');
  const footer = dialog.locator('[data-dialog-part=footer]');
  for (const button of await footer.getByRole('button').all()) {
    expect(await button.evaluate(element => ({ height: getComputedStyle(element).height, radius: getComputedStyle(element).borderRadius }))).toEqual({ height: '36px', radius: '6px' });
  }
  await page.screenshot({ path: testInfo.outputPath('sign-out-confirm.png') });
  await dialog.getByRole('button', { name: /Cancel|取消/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('entry-nav-account')).toBeVisible();
});

test('[P2] feedback keeps its actions outside the form scrollport on a narrow screen', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/');
  await page.getByRole('button', { name: '问题反馈', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '反馈', exact: true });
  const body = dialog.locator(':scope > [data-dialog-part=body]');
  const header = dialog.locator(':scope > [data-dialog-part=header]');
  const footer = dialog.locator(':scope > [data-dialog-part=footer]');
  await expect(dialog.getByRole('heading', { name: '反馈意见' })).toBeVisible();
  // Measure pinned regions after the entrance transform has settled.
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const panel = (await dialog.boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(24);
  expect(panel.x + panel.width).toBeLessThanOrEqual(366);
  const beforeHeader = (await header.boundingBox())!;
  const beforeFooter = (await footer.boundingBox())!;
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBe(beforeHeader.y);
  expect((await footer.boundingBox())!.y).toBe(beforeFooter.y);
  expect(beforeHeader.y).toBeGreaterThanOrEqual(24);
  expect(beforeFooter.y + beforeFooter.height).toBeLessThanOrEqual(456);
  await expect(footer.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await dialog.getByPlaceholder('请输入反馈标题').fill('未提交的反馈');
  await dialog.locator('..').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('请输入反馈标题')).toHaveValue('未提交的反馈');
  await page.screenshot({ path: testInfo.outputPath('feedback-narrow-screen.png') });
  await footer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
});
