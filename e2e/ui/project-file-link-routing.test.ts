import { expect, test } from '@/playwright/suite';
import { dragNativeScrollbar } from '@/playwright/scrollbars';
import type { Page } from '@playwright/test';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { expectAllProjectFilesActive, openAllProjectFiles } from '@/playwright/workspace';
import { T } from '@/timeouts';

const ACTIVE_ARTIFACT_PREVIEW_SELECTOR = '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible, [data-testid="live-artifact-preview-frame"]:visible';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe.configure({ timeout: 30_000 });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

test('[P1] assistant project file links open workspace tabs instead of new browser windows', async ({ page }) => {
  const { projectId, conversationId } = await seedProjectWithAssistantFileLink(page);

  await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await waitForWorkspaceReady(page);
  await expect(page.getByText('已完成单文件原型：')).toBeVisible();

  const fileTab = page.getByRole('tab', { name: /index\.html/i });
  await expect(fileTab).toBeVisible();
  await openAllProjectFiles(page);
  await expectAllProjectFilesActive(page);

  const pageCountBefore = page.context().pages().length;
  const popupPromise = page.waitForEvent('popup', { timeout: 1_000 }).catch(() => null);
  await page.locator('.msg.assistant a.md-link', { hasText: 'index.html' }).click();
  const popup = await popupPromise;

  expect(popup).toBeNull();
  expect(page.context().pages()).toHaveLength(pageCountBefore);
  await expect(fileTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.frameLocator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR).getByRole('heading', {
    name: 'Project file link target',
  })).toBeVisible();
});

test('[P1] conversation HTML previews use native scrollbars in URL and inline edit modes', async ({ page }) => {
  test.setTimeout(T.xlong);
  const html = '<!doctype html><html><head><style>body{margin:0}main{min-height:2200px;padding:24px;box-sizing:border-box}section{height:150px;overflow:auto;border-radius:24px}article{height:700px}</style></head><body><main><h1>Project file link target</h1><section><article>Nested scrolling</article></section></main></body></html>';
  const { projectId, conversationId } = await seedProjectWithAssistantFileLink(page, html);
  await page.goto(`/projects/${projectId}/conversations/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await waitForWorkspaceReady(page);
  const fileTab = page.getByRole('tab', { name: /index\.html/i });
  await fileTab.click();
  const urlPreview = page.locator('iframe[data-od-render-mode="url-load"]:visible');
  await expect(urlPreview).toBeVisible();
  expect(await urlPreview.getAttribute('sandbox')).not.toContain('allow-same-origin');
  await page.evaluate(() => {
    const state = window as Window & { scrollbarEditEvents?: string[] };
    state.scrollbarEditEvents = [];
    window.addEventListener('message', (event) => {
      if (['od-edit-select', 'od-edit-background', 'od-edit-drag-commit', 'od:comment-target', 'od:pod-select'].includes(event.data?.type)) {
        state.scrollbarEditEvents!.push(event.data.type);
      }
    });
  });

  for (const mode of ['url-load', 'srcdoc']) {
    if (mode === 'srcdoc') {
      await page.getByTestId('manual-edit-mode-toggle').click();
      await expect(page.getByTestId('manual-edit-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
    }
    const preview = page.locator(`iframe[data-od-render-mode="${mode}"]:visible`);
    await expect(preview).toBeVisible();
    const frame = preview.contentFrame();
    const root = frame.locator('html');
    await expect(root).toHaveAttribute('data-od-native-scrollbars', '');
    await expect(frame.locator('.od-scrollbar-layer')).toHaveCount(0);
    await page.evaluate(() => { (window as Window & { scrollbarEditEvents?: string[] }).scrollbarEditEvents = []; });
    await dragNativeScrollbar(page, root);
    await expect.poll(() => root.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await root.evaluate(element => { element.scrollTop = 0; });
    const nested = frame.locator('section');
    await dragNativeScrollbar(page, nested);
    await expect.poll(() => nested.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as Window & { scrollbarEditEvents?: string[] }).scrollbarEditEvents)).toEqual([]);
  }
  expect(await (await page.request.get(`/api/projects/${projectId}/raw/index.html`)).text()).toBe(html);
});

async function seedProjectWithAssistantFileLink(
  page: Page,
  html = '<!doctype html><html><body><main><h1>Project file link target</h1></main></body></html>',
): Promise<{ projectId: string; conversationId: string }> {
  const projectId = `file-link-routing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectResponse = await page.request.post('/api/projects', {
    data: {
      id: projectId,
      name: 'File Link Routing',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'prototype' },
    },
  });
  expect(projectResponse.ok(), `create project: ${await projectResponse.text()}`).toBeTruthy();
  const { conversationId } = (await projectResponse.json()) as { conversationId: string };

  const fileResponse = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      name: 'index.html',
      content: html,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: 'index.html',
        entry: 'index.html',
        renderer: 'html',
        exports: ['html'],
      },
    },
  });
  expect(fileResponse.ok(), `seed index.html: ${await fileResponse.text()}`).toBeTruthy();

  const localAbsoluteHref = `/Users/mac/open-design/open-design-preview-0.10.0/projects/File%20Link%20Routing/index.html`;
  const assistantText = `已完成单文件原型：[index.html](${localAbsoluteHref})。`;
  const assistantResponse = await page.request.put(
    `/api/projects/${projectId}/conversations/${conversationId}/messages/a-${projectId}`,
    {
      data: {
        role: 'assistant',
        content: assistantText,
        runStatus: 'succeeded',
        events: [{ kind: 'text', text: assistantText }],
        createdAt: Date.now() - 1_000,
      },
    },
  );
  expect(assistantResponse.ok(), `seed assistant message: ${await assistantResponse.text()}`).toBeTruthy();

  return { projectId, conversationId };
}

async function waitForWorkspaceReady(page: Page) {
  await page.getByText('Loading HiDesign…').waitFor({ state: 'hidden', timeout: T.medium }).catch(() => {});
  await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: T.medium });
  await expect(page.getByTestId('file-workspace')).toBeVisible({ timeout: T.medium });
}
