import { expect, test } from '@/playwright/suite';
import { AMR_PERSONAL_WORKSPACE_HEADERS, createProjectViaApi, gotoProject, putAppConfig, seedBrowserConfig } from '@/playwright/amr';
import { routeAgents } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

test('[P1] context size failure offers compaction and a blank conversation', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('open-design:locale', 'zh-CN');
    localStorage.setItem('open-design:locale-source', 'manual');
    localStorage.setItem('open-design.project.chatPanelWidth', '360');
  });
  await page.route('**/api/auth/valid', (route) => route.fulfill({ json: { ok: true, username: 'context-recovery-test', userInfo: { username: 'context-recovery-test' } } }));
  await page.route('**/api/auth/lanz', (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await routeAgents(page, [{ id: 'claude', name: 'Claude Code', bin: 'claude', available: true, version: 'test', models: [{ id: 'default', label: 'Default' }] }]);
  await page.route('**/api/skills', (route) => route.fulfill({ json: { skills: [] } }));
  await page.route('**/api/design-templates', (route) => route.fulfill({ json: { designTemplates: [] } }));
  await page.route('**/api/design-systems', (route) => route.fulfill({ json: { designSystems: [] } }));
  const config = { mode: 'daemon', apiKey: '', baseUrl: '', model: '', agentId: 'claude', skillId: null, designSystemId: null, onboardingCompleted: true, privacyDecisionAt: 1, mediaProviders: {}, agentModels: { claude: { model: 'default', reasoning: 'default' } } };
  await seedBrowserConfig(page, config);
  await putAppConfig(page, config);
  const projectId = `context-recovery-${Date.now()}`;
  const { conversationId } = await createProjectViaApi(page, projectId, '上下文恢复');
  const response = await page.request.put(`/api/projects/${projectId}/conversations/${conversationId}/messages/failure`, {
    headers: { ...AMR_PERSONAL_WORKSPACE_HEADERS },
    data: { role: 'assistant', content: 'API Error: 400 {"error":"request body so large (1000)"}', agentId: 'claude', runStatus: 'failed', createdAt: Date.now(),
      events: [{ kind: 'status', label: 'error', detail: 'API Error: 400 {"error":"request body so large (1000)"}', code: 'AGENT_EXECUTION_FAILED' }] },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await gotoProject(page, projectId);
  const actions = page.getByTestId('context-recovery-actions');
  await expect(actions).toBeVisible({ timeout: T.long });
  await expect(actions.getByRole('button')).toHaveCount(2);
  await expect(actions.getByRole('button', { name: '压缩上下文' })).toBeEnabled();
  await expect(actions.getByRole('button', { name: '新建对话' })).toBeEnabled();
  for (const button of await actions.getByRole('button').all()) {
    await expect(button).toHaveCSS('height', '36px');
    await expect(button).toHaveCSS('padding', '6px 10px');
    await expect(button).toHaveCSS('font-size', '12px');
    await expect(button).toHaveCSS('border-radius', '999px');
  }
  const layout = await actions.evaluate((element) => {
    const card = document.querySelector('[data-user-action-card="run-recovery"]');
    return { below: !!card && card.getBoundingClientRect().bottom <= element.getBoundingClientRect().top, fits: element.scrollWidth <= element.clientWidth };
  });
  expect(layout).toEqual({ below: true, fits: true });
  await page.screenshot({ path: testInfo.outputPath('context-recovery.png') });
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/projects/${projectId}/conversations`));
  await actions.getByRole('button', { name: '新建对话' }).click();
  const createdResponse = await created;
  expect(createdResponse.ok()).toBeTruthy();
  const fresh = (await createdResponse.json()).conversation;
  expect(fresh.id).not.toBe(conversationId);
  const messages = await page.request.get(`/api/projects/${projectId}/conversations/${fresh.id}/messages`, { headers: { ...AMR_PERSONAL_WORKSPACE_HEADERS } });
  expect(messages.ok()).toBeTruthy();
  expect((await messages.json()).messages).toEqual([]);
  await expect(actions).toHaveCount(0);
});
