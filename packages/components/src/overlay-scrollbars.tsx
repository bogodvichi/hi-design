'use client';

import { useEffect } from 'react';
import styles from './overlay-scrollbars.module.css';
import './scrollbars.css';

type Axis = 'vertical' | 'horizontal';
interface ScrollContainer {
  element: HTMLElement;
  axes: Axis[];
  thickness: number;
  tracks: Map<Axis, HTMLDivElement>;
}

const MARKER = 'data-overlay-scrollbars';
const SCROLLABLE = /^(auto|scroll|overlay)$/;
const EDGE_GAP = 2;

/** Keep scrolling native, with draggable thumbs drawn outside document flow.
 * Portals and newly mounted panels are discovered without wrapping React DOM.
 */
export function installOverlayScrollbars(root: HTMLElement): () => void {
  const layer = document.createElement('div');
  layer.className = styles.layer!;
  layer.setAttribute('aria-hidden', 'true');
  root.append(layer);
  const containers = new Map<HTMLElement, ScrollContainer>();
  const pending = new Set<HTMLElement>([root]);
  let frame = 0;
  let dragging: { track: HTMLElement; cancel: () => void } | null = null;

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);

  function discover(subtree: HTMLElement) {
    for (const element of [subtree, ...subtree.querySelectorAll<HTMLElement>('*')]) {
      if (layer.contains(element) || containers.has(element)) continue;
      const style = getComputedStyle(element);
      const axes: Axis[] = [];
      if (SCROLLABLE.test(style.overflowY)) axes.push('vertical');
      if (SCROLLABLE.test(style.overflowX)) axes.push('horizontal');
      if (!axes.length || style.scrollbarWidth === 'none') continue;
      const native = getComputedStyle(element, '::-webkit-scrollbar');
      if (native.display === 'none' || native.width === '0px') continue;
      const thickness = Number.parseFloat(native.width) || 8;
      containers.set(element, { element, axes, thickness, tracks: new Map() });
      element.setAttribute(MARKER, '');
      resize.observe(element);
    }
  }

  function makeTrack(container: ScrollContainer, axis: Axis) {
    const track = document.createElement('div');
    track.className = `${styles.track} ${styles[axis]}`;
    track.dataset.axis = axis;
    track.style.setProperty('--scrollbar-size', `${container.thickness}px`);
    const thumb = document.createElement('div');
    thumb.className = styles.thumb!;
    track.append(thumb);
    layer.append(track);
    const element = container.element;
    const vertical = axis === 'vertical';
    const position = () => vertical ? element.scrollTop : Math.abs(element.scrollLeft);
    const extent = () => vertical
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;
    const setPosition = (value: number) => {
      const bounded = Math.max(0, Math.min(extent(), value));
      if (vertical) element.scrollTop = bounded;
      else element.scrollLeft = getComputedStyle(element).direction === 'rtl' ? -bounded : bounded;
      schedule();
    };
    track.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      const length = vertical ? rect.height : rect.width;
      const thumbLength = vertical ? thumb.offsetHeight : thumb.offsetWidth;
      const travel = length - thumbLength;
      if (travel <= 0) return;
      const coordinate = vertical ? event.clientY - rect.top : event.clientX - rect.left;
      const offset = position() / extent() * travel;
      if (coordinate < offset || coordinate > offset + thumbLength) {
        setPosition((coordinate - thumbLength / 2) / travel * extent());
      }
      const start = vertical ? event.clientY : event.clientX;
      const initial = position();
      const move = (next: PointerEvent) => {
        setPosition(initial + ((vertical ? next.clientY : next.clientX) - start) / travel * extent());
      };
      const cancel = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('lostpointercapture', cancel);
        track.removeEventListener('pointerup', cancel);
        track.removeEventListener('pointercancel', cancel);
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        track.removeAttribute('data-dragging');
        dragging = null;
        schedule();
      };
      dragging?.cancel();
      dragging = { track, cancel };
      track.setAttribute('data-dragging', '');
      track.setPointerCapture(event.pointerId);
      track.addEventListener('pointermove', move);
      track.addEventListener('lostpointercapture', cancel);
      track.addEventListener('pointerup', cancel);
      track.addEventListener('pointercancel', cancel);
      schedule();
    });
    track.addEventListener('wheel', (event) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      setPosition(position() + (vertical ? event.deltaY : event.deltaX || event.deltaY) * unit);
    }, { passive: false });
    container.tracks.set(axis, track);
    return track;
  }

  function update() {
    frame = 0;
    for (const subtree of pending) {
      if (subtree.isConnected) discover(subtree);
    }
    pending.clear();
    // Hit-testing must see the app, not a previously rendered overlay track.
    const hovered = new Set(Array.from(containers.values()).flatMap(container =>
      Array.from(container.tracks.values()).filter(track => track.matches(':hover'))));
    layer.style.display = 'none';
    for (const [element, container] of containers) {
      if (!element.isConnected) {
        resize.unobserve(element);
        container.tracks.forEach(track => track.remove());
        element.removeAttribute(MARKER);
        containers.delete(element);
        continue;
      }
      const rect = element.getBoundingClientRect();
      const elementStyle = getComputedStyle(element);
      const left = rect.left + element.clientLeft;
      const top = rect.top + element.clientTop;
      const width = element.clientWidth;
      const height = element.clientHeight;
      // Clip overlays along with nested scrollports and rounded panel edges.
      let clipLeft = Math.max(0, left);
      let clipTop = Math.max(0, top);
      let clipRight = Math.min(window.innerWidth, left + width);
      let clipBottom = Math.min(window.innerHeight, top + height);
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          clipLeft = Math.max(clipLeft, bounds.left + parent.clientLeft);
          clipRight = Math.min(clipRight, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          clipTop = Math.max(clipTop, bounds.top + parent.clientTop);
          clipBottom = Math.min(clipBottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      for (const axis of container.axes) {
        const vertical = axis === 'vertical';
        const viewport = vertical ? height : width;
        const content = vertical ? element.scrollHeight : element.scrollWidth;
        if (content <= viewport + 1 && !container.tracks.has(axis)) continue;
        const track = container.tracks.get(axis) ?? makeTrack(container, axis);
        const thickness = container.thickness;
        const x = vertical ? left + width - thickness - EDGE_GAP : left;
        const y = vertical ? top : top + height - thickness - EDGE_GAP;
        const trackWidth = vertical ? thickness : width;
        const trackHeight = vertical ? height : thickness;
        const hitX = vertical ? x + thickness / 2 : Math.max(clipLeft, left) + Math.max(0, clipRight - clipLeft) / 2;
        const hitY = vertical ? Math.max(clipTop, top) + Math.max(0, clipBottom - clipTop) / 2 : y + thickness / 2;
        const hit = document.elementFromPoint(hitX, hitY);
        const visible = SCROLLABLE.test(vertical ? elementStyle.overflowY : elementStyle.overflowX)
          && content > viewport + 1 && viewport > 0
          && clipRight > clipLeft && clipBottom > clipTop
          && Boolean(hit && element.contains(hit));
        track.hidden = !visible;
        if (!visible) continue;
        Object.assign(track.style, {
          left: `${x}px`, top: `${y}px`, width: `${trackWidth}px`, height: `${trackHeight}px`,
          clipPath: `inset(${Math.max(0, clipTop - y)}px ${Math.max(0, x + trackWidth - clipRight)}px ${Math.max(0, y + trackHeight - clipBottom)}px ${Math.max(0, clipLeft - x)}px)`,
        });
        track.toggleAttribute('data-expanded', hovered.has(track) || dragging?.track === track);
        const thumb = track.firstElementChild as HTMLElement;
        const length = Math.min(viewport, Math.max(24, viewport * viewport / content));
        const scroll = vertical ? element.scrollTop : Math.abs(element.scrollLeft);
        const offset = Math.max(0, Math.min(1, scroll / (content - viewport))) * (viewport - length);
        thumb.style[vertical ? 'height' : 'width'] = `${length}px`;
        thumb.style[vertical ? 'top' : 'left'] = `${offset}px`;
      }
    }
    layer.style.display = '';
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (layer.contains(record.target)) continue;
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => { if (node instanceof HTMLElement) pending.add(node); });
      } else if (record.target instanceof HTMLElement) {
        pending.add(record.target);
      }
    }
    if (records.some(record => !layer.contains(record.target))) schedule();
  });
  mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  root.addEventListener('scroll', schedule, true);
  root.addEventListener('pointerover', schedule);
  root.addEventListener('pointerout', schedule);
  root.addEventListener('input', schedule);
  root.addEventListener('load', schedule, true);
  root.addEventListener('transitionend', schedule, true);
  root.addEventListener('animationend', schedule, true);
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    mutations.disconnect();
    resize.disconnect();
    dragging?.cancel();
    cancelAnimationFrame(frame);
    root.removeEventListener('scroll', schedule, true);
    root.removeEventListener('pointerover', schedule);
    root.removeEventListener('pointerout', schedule);
    root.removeEventListener('input', schedule);
    root.removeEventListener('load', schedule, true);
    root.removeEventListener('transitionend', schedule, true);
    root.removeEventListener('animationend', schedule, true);
    window.removeEventListener('resize', schedule);
    containers.forEach(({ element }) => element.removeAttribute(MARKER));
    layer.remove();
  };
}

export function OverlayScrollbars() {
  useEffect(() => {
    if (typeof ResizeObserver !== 'undefined' && typeof document.elementFromPoint === 'function') {
      return installOverlayScrollbars(document.body);
    }
  }, []);
  return null;
}
