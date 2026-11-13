// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOverlayScrollbars, buildOverlayScrollbarsScript } from '../src/overlay-scrollbars';

let dispose: (() => void) | undefined;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const nativeStyle = window.getComputedStyle.bind(window);

function scroller({ hidden = false, horizontal = false } = {}) {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  element.style.overflowX = horizontal ? 'auto' : 'hidden';
  if (hidden) element.style.scrollbarWidth = 'none';
  Object.defineProperties(element, {
    clientWidth: { value: 300 }, clientHeight: { value: 200 },
    scrollWidth: { value: horizontal ? 600 : 300 }, scrollHeight: { value: 800 },
  });
  element.getBoundingClientRect = () => new DOMRect(10, 20, 300, 200);
  document.body.append(element);
  return element;
}

async function flush() {
  await Promise.resolve(); // Deliver native MutationObserver records.
  const callbacks = Array.from(frames.values());
  frames.clear();
  callbacks.forEach(callback => callback(0));
}

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string) => pseudo
    ? { width: '8px', display: 'block' }
    : nativeStyle(element));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('overlay scrollbars', () => {
  it('retains a usable track inside percentage-based pill corners', async () => {
    const element = scroller();
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) element.style[corner] = '50%';
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    expect(track.hidden).toBe(false);
    expect(parseFloat(track.style.height)).toBeGreaterThan(24);
    expect(parseFloat(track.style.top)).toBeGreaterThan(20);
  });
  it('keeps both axes inside their scrollport corner radii', async () => {
    const element = scroller({ horizontal: true });
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) element.style[corner] = '16px';
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const vertical = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    const horizontal = document.querySelector<HTMLElement>('[data-axis=horizontal]')!;
    const cap = 16 * (1 - Math.sqrt(1 - (14 / 16) ** 2));
    expect(parseFloat(vertical.style.top)).toBeCloseTo(20 + cap);
    expect(parseFloat(vertical.style.height)).toBeCloseTo(200 - 2 * cap);
    expect(parseFloat(horizontal.style.left)).toBeCloseTo(10 + cap);
    expect(parseFloat(horizontal.style.width)).toBeCloseTo(300 - 2 * cap);
    element.scrollTop = 600;
    element.dispatchEvent(new Event('scroll'));
    await flush();
    const thumb = vertical.firstElementChild as HTMLElement;
    expect(parseFloat(thumb.style.top) + parseFloat(thumb.style.height)).toBeCloseTo(200 - 2 * cap);
  });

  it('also respects rounded clipping ancestors when the inner scrollport is square', async () => {
    const element = scroller();
    const panel = document.createElement('section');
    panel.style.overflowX = 'hidden';
    panel.style.overflowY = 'hidden';
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) panel.style[corner] = '24px';
    Object.defineProperties(panel, { clientWidth: { value: 320 }, clientHeight: { value: 200 } });
    panel.getBoundingClientRect = () => new DOMRect(0, 20, 320, 200);
    document.body.append(panel);
    panel.append(element);
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const track = [...document.querySelectorAll<HTMLElement>('[data-axis=vertical]')].find(e => e.style.left === '300px')!;
    const cap = 24 * (1 - Math.sqrt(1 - (12 / 24) ** 2));
    expect(parseFloat(track.style.top)).toBeCloseTo(20 + cap);
    expect(parseFloat(track.style.height)).toBeCloseTo(200 - 2 * cap);
  });

  it('boots the serialized runtime without host dependencies and keeps viewport tracks fixed while scrolling', async () => {
    const root = document.documentElement;
    root.style.overflowY = 'visible';
    root.style.overflowX = 'hidden';
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(300);
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(200);
    vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(800);
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, -root.scrollTop, 300, 800));
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    try {
      new Function(buildOverlayScrollbarsScript())();
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      expect(root.hasAttribute('data-overlay-scrollbars')).toBe(true);
      const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
      expect(track.hidden).toBe(false);
      expect(track.style.top).toBe('0px');
      expect(track.style.height).toBe('200px');
      expect(track.style.left).toBe('290px');
      root.scrollTop = 100;
      document.dispatchEvent(new Event('scroll'));
      await flush();
      expect(track.style.top).toBe('0px');
      window.dispatchEvent(new Event('pagehide'));
      expect(document.querySelector('[data-od-overlay-scrollbars]')).toBeNull();
      expect(root.hasAttribute('data-overlay-scrollbars')).toBe(false);
    } finally {
      window.dispatchEvent(new Event('pagehide'));
      root.removeAttribute('style');
      root.scrollTop = 0;
    }
  });
  it('overlays both axes without changing the scrollport or scroll position', async () => {
    const element = scroller({ horizontal: true });
    element.scrollTop = 400;
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    expect(element.hasAttribute('data-overlay-scrollbars')).toBe(true);
    expect(element.clientWidth).toBe(300);
    expect(element.scrollTop).toBe(400);
    const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    expect(track.hidden).toBe(false);
    expect(track.style.left).toBe('300px');
    expect(track.style.width).toBe('8px');
    const thumb = track.firstElementChild as HTMLElement;
    expect(thumb.style.height).toBe('50px');
    expect(thumb.style.top).toBe('100px');
    expect(document.querySelector('[data-axis=horizontal]')).not.toBeNull();
    element.scrollTop = 600;
    element.dispatchEvent(new Event('scroll'));
    await flush();
    expect(thumb.style.top).toBe('150px');
  });

  it('discovers portaled content and preserves deliberately hidden scrollbars', async () => {
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const hidden = scroller({ hidden: true });
    const visible = scroller();
    vi.mocked(document.elementFromPoint).mockReturnValue(visible);
    await flush();
    expect(hidden.hasAttribute('data-overlay-scrollbars')).toBe(false);
    expect(visible.hasAttribute('data-overlay-scrollbars')).toBe(true);
    expect(document.querySelector('[data-axis=vertical]')).not.toBeNull();
    visible.remove();
    await flush();
    expect(visible.hasAttribute('data-overlay-scrollbars')).toBe(false);
    expect(document.querySelector('[data-axis=vertical]')).toBeNull();
  });

  it('hides scrollbars behind modal backdrops', async () => {
    const element = scroller();
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    const backdrop = document.createElement('div');
    vi.mocked(document.elementFromPoint).mockReturnValue(backdrop);
    document.body.append(backdrop);
    await flush();
    expect(track.hidden).toBe(true);
  });

  it('expands only over the full-width scrollbar track, not over its scroll container', async () => {
    const element = scroller();
    vi.spyOn(element, 'matches').mockReturnValue(true);
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    expect(track.hasAttribute('data-expanded')).toBe(false);
    vi.spyOn(track, 'matches').mockReturnValue(true);
    track.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await flush();
    expect(track.hasAttribute('data-expanded')).toBe(true);
    vi.mocked(track.matches).mockReturnValue(false);
    track.dispatchEvent(new Event('pointerout', { bubbles: true }));
    await flush();
    expect(track.hasAttribute('data-expanded')).toBe(false);
  });

  it('supports wheel scrolling and thumb dragging, then removes its listeners and markers', async () => {
    const element = scroller();
    vi.mocked(document.elementFromPoint).mockReturnValue(element);
    dispose = installOverlayScrollbars(document.body);
    await flush();
    const track = document.querySelector<HTMLElement>('[data-axis=vertical]')!;
    track.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(element.scrollTop).toBe(100);
    element.scrollTop = 0;
    track.getBoundingClientRect = () => new DOMRect(300, 20, 8, 200);
    Object.defineProperty(track.firstElementChild, 'offsetHeight', { value: 50 });
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = () => false;
    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 30 }));
    expect(track.hasAttribute('data-dragging')).toBe(true);
    track.dispatchEvent(new MouseEvent('pointermove', { clientY: 105 }));
    expect(element.scrollTop).toBe(300);
    track.dispatchEvent(new MouseEvent('pointerup'));
    expect(track.hasAttribute('data-dragging')).toBe(false);
    dispose();
    dispose = undefined;
    expect(element.hasAttribute('data-overlay-scrollbars')).toBe(false);
    expect(document.querySelector('[data-axis]')).toBeNull();
    expect(frames.size).toBe(0);
  });
});
