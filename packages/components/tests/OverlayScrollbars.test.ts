// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeScrollbars, buildNativeScrollbarsScript } from '../src/overlay-scrollbars-runtime';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.head.querySelectorAll('[data-od-native-scrollbars-style]').forEach(node => node.remove());
  document.documentElement.removeAttribute('data-od-native-scrollbars');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native scrollbars', () => {
  it('preserves scroll state and component policies without scanning, observing or scheduling the document', () => {
    document.body.innerHTML = '<section style="overflow:auto;scrollbar-gutter:stable"><div></div></section><nav style="scrollbar-width:none"></nav>';
    const section = document.querySelector('section')!;
    section.scrollTop = 123;
    section.scrollLeft = 12;
    const before = section.getAttribute('style');
    const fail = () => { throw new Error('native styles must not run a layout observer'); };
    vi.stubGlobal('ResizeObserver', fail);
    vi.stubGlobal('MutationObserver', fail);
    vi.stubGlobal('requestAnimationFrame', fail);
    vi.stubGlobal('getComputedStyle', fail);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fail);
    vi.spyOn(document.body, 'querySelectorAll').mockImplementation(fail);
    dispose = installNativeScrollbars(document.body);
    expect(section.scrollTop).toBe(123);
    expect(section.scrollLeft).toBe(12);
    expect(section.getAttribute('style')).toBe(before);
    expect(document.querySelector('nav')!.style.scrollbarWidth).toBe('none');
    expect(document.querySelector('.od-scrollbar-layer')).toBeNull();
    expect(document.querySelector('[data-overlay-scrollbars]')).toBeNull();
  });

  it('cleans up only its styles and restores an existing root marker', () => {
    document.body.setAttribute('data-od-native-scrollbars', 'existing');
    const unrelated = document.createElement('style');
    document.head.append(unrelated);
    dispose = installNativeScrollbars(document.body);
    dispose();
    dispose();
    expect(document.body.getAttribute('data-od-native-scrollbars')).toBe('existing');
    expect(document.head.querySelector('[data-od-native-scrollbars-style]')).toBeNull();
    expect(unrelated.isConnected).toBe(true);
    unrelated.remove();
    document.body.removeAttribute('data-od-native-scrollbars');
  });

  it('boots inside previews without ResizeObserver and does not duplicate styles or dispose on pagehide', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    const script = buildNativeScrollbarsScript();
    new Function(script)();
    new Function(script)();
    expect(document.documentElement.hasAttribute('data-od-native-scrollbars')).toBe(true);
    expect(document.head.querySelectorAll('[data-od-native-scrollbars-style]')).toHaveLength(1);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    expect(document.head.querySelectorAll('[data-od-native-scrollbars-style]')).toHaveLength(1);
    expect(document.querySelector('.od-scrollbar-layer')).toBeNull();
  });
});
