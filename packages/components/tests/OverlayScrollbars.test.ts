// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOverlayScrollbars } from '../src/overlay-scrollbars';

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
