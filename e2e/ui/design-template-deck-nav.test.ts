import { readFile } from 'node:fs/promises';

import { clusterTest as test, expect } from '@/playwright/suite';

// These standalone artifacts need a browser, without a daemon or web runtime.
test.use({ viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
});

test('[P1] editorial example keeps its documented standalone vertical layout', async ({ page }) => {
  const html = await readFile(new URL('../../plugins/_official/examples/html-ppt-taste-editorial/example.html', import.meta.url), 'utf8');
  await page.setContent(html);
  const slides = page.locator('.deck > .slide');
  await expect(slides).toHaveCount(10);
  await expect(slides.first()).toBeInViewport();
  await slides.nth(1).scrollIntoViewIfNeeded();
  await expect(slides.nth(1)).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('[P1] simple-deck moves exactly one slide per key and keeps its counter aligned', async ({ page }) => {
  const html = await readFile(new URL('../../plugins/_official/examples/simple-deck/example.html', import.meta.url), 'utf8');
  await page.setContent(html);
  const counter = page.locator('#counter');
  await expect(counter).toHaveText('1 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 6');
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollLeft, document.body.scrollLeft,
  ))).toBe(1280);
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('3 / 6');
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollLeft, document.body.scrollLeft,
  ))).toBe(2560);
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('2 / 6');
});
