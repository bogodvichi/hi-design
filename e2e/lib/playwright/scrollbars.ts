import type { Locator, Page } from '@playwright/test';
import { expect } from './suite.ts';

/** Drag the browser's own scrollbar, including in scaled opaque preview frames. */
export async function dragNativeScrollbar(page: Page, scrollport: Locator, axis: 'vertical' | 'horizontal' = 'vertical') {
  const box = (await scrollport.boundingBox())!;
  const metrics = await scrollport.evaluate((element, axis) => {
    const e = element as HTMLElement;
    const viewport = e === document.scrollingElement;
    const style = getComputedStyle(e);
    const vertical = axis === 'vertical';
    return {
      gutter: vertical
        ? (viewport ? innerWidth - e.clientWidth : e.offsetWidth - e.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth))
        : (viewport ? innerHeight - e.clientHeight : e.offsetHeight - e.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)),
      outerWidth: e.offsetWidth, outerHeight: e.offsetHeight,
      left: e.clientLeft, top: e.clientTop, width: e.clientWidth, height: e.clientHeight,
      position: vertical ? e.scrollTop : e.scrollLeft,
      content: vertical ? e.scrollHeight : e.scrollWidth,
    };
  }, axis);
  expect(metrics.gutter, 'native scrollbar must have a pointer hit area').toBeGreaterThan(0);
  const scaleX = box.width / metrics.outerWidth;
  const scaleY = box.height / metrics.outerHeight;
  const vertical = axis === 'vertical';
  const viewport = vertical ? metrics.height : metrics.width;
  const thumb = Math.max(24, viewport * viewport / metrics.content);
  // Author-owned standard scrollbars may retain native arrow buttons. Start
  // inside the thumb beyond that button, rather than dragging the up arrow.
  const along = metrics.position / (metrics.content - viewport) * (viewport - thumb) + Math.max(20, thumb / 2);
  const x = box.x + (metrics.left + (vertical ? metrics.width + metrics.gutter / 2 : along)) * scaleX;
  const y = box.y + (metrics.top + (vertical ? along : metrics.height + metrics.gutter / 2)) * scaleY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + (vertical ? 0 : 40 * scaleX), y + (vertical ? 40 * scaleY : 0), { steps: 4 });
  } finally {
    await page.mouse.up();
  }
}
