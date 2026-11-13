// Entry → template-detail-modal mapping (飞书 recvqxDuYM6Uxk).
//
// Two template detail surfaces exist and each belongs to one entry point:
//   • the Community gallery card opens the FULL plugin details modal
//     (Use split action + Share menu + close);
//   • the creation page's active template chip opens the LIGHTWEIGHT
//     community preview (header title/category + close, footer category +
//     Remix).
// Before the swap the two entries were reversed. These specs pin the
// corrected mapping end-to-end through the real entry shell.

import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { ensureRailOpen } from '@/playwright/rail';
import { T } from '@/timeouts';

const DECK_PLUGIN = {
  id: 'mapping-fundraising-deck',
  title: 'Mapping Fundraising Deck',
  version: '1.0.0',
  trust: 'trusted',
  sourceKind: 'bundled',
  source: '/tmp/mapping-fundraising-deck',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/mapping-fundraising-deck',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'mapping-fundraising-deck',
    title: 'Mapping Fundraising Deck',
    version: '1.0.0',
    description: 'A decision-grade seed round narrative.',
    tags: ['deck'],
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      mode: 'deck',
      category: 'fundraising-pitch',
      preview: { type: 'html', entry: './example.html' },
      useCase: { query: { en: 'Create a seed round pitch deck.' } },
    },
  },
} as const;

const PROTOTYPE_PLUGIN = {
  ...DECK_PLUGIN,
  id: 'mapping-product-prototype',
  title: 'Mapping Product Prototype',
  source: '/tmp/mapping-product-prototype',
  fsPath: '/tmp/mapping-product-prototype',
  manifest: {
    ...DECK_PLUGIN.manifest,
    name: 'mapping-product-prototype',
    title: 'Mapping Product Prototype',
    description: 'A high-fidelity product prototype.',
    tags: ['prototype'],
    od: {
      ...DECK_PLUGIN.manifest.od,
      mode: 'prototype',
      category: 'product-prototype',
      useCase: { query: { en: 'Create a high-fidelity product prototype.' } },
    },
  },
} as const;

function makeApplyResult(pluginId: string) {
  return {
    ok: true,
    query: 'Create a seed round pitch deck.',
    contextItems: [],
    inputs: [],
    assets: [],
    mcpServers: [],
    trust: 'trusted',
    capabilitiesGranted: ['prompt:inject'],
    capabilitiesRequired: ['prompt:inject'],
    appliedPlugin: {
      snapshotId: `snap-${pluginId}`,
      pluginId,
      pluginVersion: '1.0.0',
      manifestSourceDigest: 'a'.repeat(64),
      inputs: {},
      resolvedContext: { items: [] },
      capabilitiesGranted: ['prompt:inject'],
      capabilitiesRequired: ['prompt:inject'],
      assetsStaged: [],
      taskKind: 'new-generation',
      appliedAt: 0,
      connectorsRequired: [],
      connectorsResolved: [],
      mcpServers: [],
      status: 'fresh',
    },
    projectMetadata: {},
  };
}

async function routeMappingFixtures(page: Page) {
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill({ json: { plugins: [DECK_PLUGIN, PROTOTYPE_PLUGIN] } });
  });
  await page.route(`**/api/plugins/${DECK_PLUGIN.id}/preview`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><body><h1>Deck preview</h1></body></html>',
    });
  });
  await page.route(`**/api/plugins/${DECK_PLUGIN.id}/apply`, async (route) => {
    await route.fulfill({ json: makeApplyResult(DECK_PLUGIN.id) });
  });
}

async function gotoCommunity(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading HiDesign…').waitFor({ state: 'hidden', timeout: T.long });
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve HiDesign' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-community').click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.locator('article.community-template-card').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  await routeMappingFixtures(page);
});

test('[P2] community preview aligns actions right and uses slim scrollbars inside its sandbox', async ({ page }, testInfo) => {
  test.setTimeout(T.xlong);
  await page.route(`**/api/plugins/${PROTOTYPE_PLUGIN.id}/preview`, route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      body{margin:0;min-height:2400px;background:#fff}
      *::-webkit-scrollbar{width:18px}
      #rounded,#clipped{width:320px;height:200px;margin:24px}
      #rounded{overflow:auto;border-radius:24px}
      #clipped{overflow:hidden;border-radius:32px}
      #inner{height:100%;overflow:auto}
      .long{height:800px;background:#eee}
    </style></head><body><h1>Scrollable prototype</h1>
      <section id="rounded"><div class="long">Rounded scrollport</div></section>
      <section id="clipped"><div id="inner"><div class="long">Rounded ancestor</div></div></section>
    </body></html>`,
  }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoCommunity(page);
  await page.getByRole('button', { name: 'Prototype', exact: true }).click();
  await page.locator('article.community-template-card').first().click();
  const dialog = page.locator('.ds-modal');
  await expect(dialog.locator('iframe')).toBeVisible();
  const header = dialog.locator('.ds-modal-header');
  const row = dialog.locator('.ds-modal-header-top');
  expect.soft(await row.evaluate(element => Math.abs(element.getBoundingClientRect().right - element.parentElement!.getBoundingClientRect().right + parseFloat(getComputedStyle(element.parentElement!).paddingRight))))
    .toBeLessThan(1);
  const frame = dialog.frameLocator('iframe');
  const tracks = frame.locator('[data-axis=vertical]:visible');
  await expect.soft(tracks).toHaveCount(3);
  const track = tracks.first();
  if (await track.count()) {
    const thumb = track.locator(':scope > div');
    const box = (await track.boundingBox())!;
    expect(await track.evaluate(e => e.getBoundingClientRect().width)).toBe(8);
    expect(await track.evaluate(e => window.innerWidth - e.getBoundingClientRect().right)).toBe(2);
    await page.mouse.move(0, 0);
    await expect.poll(() => thumb.evaluate(e => e.getBoundingClientRect().width)).toBe(4);
    await expect(thumb).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.4)');
    // The host's sidebar handle intentionally overlays the midpoint edge.
    await track.hover({ position: { x: 1, y: box.height / 4 } });
    await expect.poll(() => thumb.evaluate(e => e.getBoundingClientRect().width)).toBe(8);
    await expect(thumb).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
    await page.mouse.down();
    try {
      await expect(track).toHaveAttribute('data-dragging', '');
      await expect(thumb).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await page.mouse.move(box.x + 1, box.y + box.height / 4 + 24);
    } finally { await page.mouse.up(); }
    const before = await track.boundingBox();
    expect(await frame.locator('html').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
    expect((await track.boundingBox())!.y).toBe(before!.y);
  }
  await frame.locator('html').evaluate(e => { e.scrollTop = 0; });
  await expect(tracks).toHaveCount(3);
  for (const id of ['rounded', 'inner']) {
    await frame.locator(`#${id}`).evaluate(e => { e.scrollTop = e.scrollHeight; });
  }
  await expect.poll(() => frame.locator('html').evaluate(() => {
    const tracks = [...document.querySelectorAll<HTMLElement>('[data-axis=vertical]')];
    return ['rounded', 'inner'].every(id => {
      const element = document.getElementById(id)!;
      const radius = id === 'rounded' ? 24 : 32;
      const inset = radius * (1 - Math.sqrt(1 - (1 - 2 / radius) ** 2));
      const rect = element.getBoundingClientRect();
      const track = tracks.find(t => Math.abs(t.getBoundingClientRect().right - rect.right + 2) < 1
        && Math.abs(t.getBoundingClientRect().top - rect.top - inset) < 1);
      if (!track) return false;
      const thumb = track.firstElementChild!.getBoundingClientRect();
      return thumb.top >= rect.top + inset - 1 && thumb.bottom <= rect.bottom - inset + 1;
    });
  })).toBe(true);
  await page.mouse.move(0, 0);
  await expect(header).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('community-preview-scrollbars.png') });
});

test('[P1] community template card opens the full details modal (Use split + Share), not the lightweight preview', async ({ page }) => {
  await gotoCommunity(page);

  await page.locator('article.community-template-card').first().click();

  // Full modal chrome: Use split action (main face + caret), Share menu,
  // and the ds-modal shell — the lightweight footer-Remix preview must not
  // be what this card opens.
  await expect(page.getByTestId(`plugin-details-use-${DECK_PLUGIN.id}`)).toBeVisible();
  await expect(page.getByTestId(`plugin-details-use-${DECK_PLUGIN.id}-menu`)).toBeVisible();
  await expect(page.locator('.template-share-trigger')).toBeVisible();
  await expect(page.locator('.community-template-preview')).toHaveCount(0);

  // The split dropdown actually operates: it offers the prompt-loading Use,
  // the structure-only Use, and the community Remix mapping.
  await page.getByTestId(`plugin-details-use-${DECK_PLUGIN.id}-menu`).click();
  await expect(page.getByTestId(`plugin-details-use-with-query-${DECK_PLUGIN.id}`)).toBeVisible();
  await expect(page.getByTestId(`plugin-details-use-option-${DECK_PLUGIN.id}`)).toBeVisible();
  await expect(page.getByTestId(`plugin-details-duplicate-${DECK_PLUGIN.id}`)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('[P1] community Use hands into Home and the active template chip opens the lightweight preview', async ({ page }) => {
  await gotoCommunity(page);

  // Use from the community card's full modal routes the plugin as the Home
  // composer's active driver (EntryShell onUsePlugin hand-off).
  await page.locator('article.community-template-card').first().click();
  await page.getByTestId(`plugin-details-use-${DECK_PLUGIN.id}`).click();
  await expect(page.getByTestId('home-hero-active-plugin')).toBeVisible();

  // The chip's detail entry opens the LIGHTWEIGHT preview: footer category +
  // Remix, no Use split action, no Share menu.
  await page.getByTestId('home-hero-active-plugin').locator('.home-hero__active-chip-body').click();
  await expect(page.locator('.community-template-preview')).toBeVisible();
  const foot = page.locator('.community-template-preview__foot');
  await expect(foot).toContainText('Remix');
  await expect(page.getByTestId(`plugin-details-use-${DECK_PLUGIN.id}`)).toHaveCount(0);
  await expect(page.locator('.template-share-trigger')).toHaveCount(0);

  // Close chrome works and returns to the composer untouched.
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('.community-template-preview')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-active-plugin')).toBeVisible();
});

test('[P1] community category tabs filter the current template catalog', async ({ page }) => {
  await gotoCommunity(page);

  const cards = page.locator('article.community-template-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.locator('.community-template-card__foot')).toContainText('Slides');

  await page.getByRole('button', { name: 'Prototype', exact: true }).click();

  await expect(cards).toHaveCount(1);
  await expect(cards.locator('.community-template-card__foot')).toContainText('Prototype');
});

test('[P1] Remix finishes before returning to the preserved template page', async ({ page, toolsDev }, testInfo) => {
  const response = await page.request.get(`${toolsDev.daemonUrl}/api/plugins/example-dashboard`);
  expect(response.ok()).toBe(true);
  const plugin = await response.json();
  await page.route('**/api/plugins', (route) => route.fulfill({ json: { plugins: [plugin] } }));
  await gotoCommunity(page);
  // Freeze the old timeout so a slow browser cannot accidentally make the
  // regression pass by spending eight seconds opening the project.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  let copies = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/plugins/example-dashboard/duplicate-project')) copies += 1;
  });
  await page.getByRole('button', { name: 'Remix', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\//);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByTestId('entry-nav-community')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remix', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Loading…', exact: true })).toHaveCount(0);
  expect(copies).toBe(1);
  await testInfo.attach('remix-return-ready', { body: await page.screenshot(), contentType: 'image/png' });
});
