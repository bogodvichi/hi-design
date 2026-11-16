type Axis = 'vertical' | 'horizontal';
interface ScrollContainer {
  element: HTMLElement;
  axes: Axis[];
  thickness: number;
  tracks: Map<Axis, HTMLDivElement>;
}

/** Self-contained so the same runtime can execute inside an opaque preview iframe.
 * Keep dependencies inside this function; buildOverlayScrollbarsScript serializes it. */
export function installOverlayScrollbars(root: HTMLElement, documentViewport = false): () => void {
  const MARKER = 'data-overlay-scrollbars';
  const SCROLLABLE = /^(auto|scroll|overlay)$/;
  const EDGE_GAP = 2;
  const styles = { layer: 'od-scrollbar-layer', track: 'od-scrollbar-track', thumb: 'od-scrollbar-thumb', vertical: 'od-scrollbar-vertical', horizontal: 'od-scrollbar-horizontal' };
  const stylesheet = document.createElement('style');
  stylesheet.dataset.odOverlayScrollbars = '';
  stylesheet.textContent = `.od-scrollbar-layer {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
}

.od-scrollbar-track {
  position: fixed;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}
.od-scrollbar-track[hidden] { display: none !important; }

.od-scrollbar-thumb {
  position: absolute;
  border-radius: 999px;
  background: rgb(0 0 0 / 20%);
  pointer-events: none;
  transition: width 140ms cubic-bezier(0.23, 1, 0.32, 1),
    height 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.od-scrollbar-vertical { width: var(--scrollbar-size); }
.od-scrollbar-vertical .od-scrollbar-thumb { right: 0; width: calc(var(--scrollbar-size) / 2); }
.od-scrollbar-horizontal { height: var(--scrollbar-size); }
.od-scrollbar-horizontal .od-scrollbar-thumb { bottom: 0; height: calc(var(--scrollbar-size) / 2); }
.od-scrollbar-vertical[data-expanded] .od-scrollbar-thumb { width: var(--scrollbar-size); }
.od-scrollbar-horizontal[data-expanded] .od-scrollbar-thumb { height: var(--scrollbar-size); }

.od-scrollbar-track[data-expanded] .od-scrollbar-thumb { background: rgb(0 0 0 / 40%); }
.od-scrollbar-track[data-dragging] .od-scrollbar-thumb { background: rgb(0 0 0 / 60%); }

@media (forced-colors: active) {
  .od-scrollbar-track .od-scrollbar-thumb { background: CanvasText !important; }
}

/* OverlayScrollbars owns these markers. Hidden tab-strip and editor
   scrollbars retain their existing component policy. */
[data-overlay-scrollbars] {
  scrollbar-width: none !important;
  scrollbar-gutter: auto !important;
}

[data-overlay-scrollbars]::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}

*::-webkit-scrollbar-button {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
`;
  document.head.append(stylesheet);
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

  // Intersect the full hit area with each corner ellipse. The resulting track
  // remains usable even in a pill/circle, where full-radius insets meet.
  function roundLimits(
    style: CSSStyleDeclaration,
    bounds: { left: number; top: number; right: number; bottom: number },
    vertical: boolean, crossStart: number, crossEnd: number,
  ): [number, number] {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const radius = (value: string) => {
      const [x = '0', y = x] = value.split(/\s+/);
      const px = (part: string, size: number) => Math.max(0, Number.parseFloat(part) || 0) * (part.endsWith('%') ? size / 100 : 1);
      return [px(x, width), px(y, height)] as const;
    };
    const tl = radius(style.borderTopLeftRadius || '0');
    const tr = radius(style.borderTopRightRadius || '0');
    const bl = radius(style.borderBottomLeftRadius || '0');
    const br = radius(style.borderBottomRightRadius || '0');
    const scale = Math.min(1,
      width / Math.max(1, tl[0] + tr[0]), width / Math.max(1, bl[0] + br[0]),
      height / Math.max(1, tl[1] + bl[1]), height / Math.max(1, tr[1] + br[1]));
    const inset = (crossRadius: number, alongRadius: number, distance: number) => {
      if (crossRadius <= 0 || alongRadius <= 0 || distance >= crossRadius) return 0;
      const ratio = Math.max(0, Math.min(1, 1 - distance / crossRadius));
      return alongRadius * (1 - Math.sqrt(1 - ratio * ratio));
    };
    const cap = (corner: readonly [number, number], distance: number) => vertical
      ? inset(corner[0] * scale, corner[1] * scale, distance)
      : inset(corner[1] * scale, corner[0] * scale, distance);
    if (vertical) {
      const start = Math.max(bounds.top,
        bounds.top + cap(tl, crossStart - bounds.left),
        bounds.top + cap(tr, bounds.right - crossEnd));
      const end = Math.min(bounds.bottom,
        bounds.bottom - cap(bl, crossStart - bounds.left),
        bounds.bottom - cap(br, bounds.right - crossEnd));
      return [start, end];
    }
    return [Math.max(bounds.left,
      bounds.left + cap(tl, crossStart - bounds.top),
      bounds.left + cap(bl, bounds.bottom - crossEnd)),
    Math.min(bounds.right,
      bounds.right - cap(tr, crossStart - bounds.top),
      bounds.right - cap(br, bounds.bottom - crossEnd))];
  }

  function discover(subtree: HTMLElement) {
    for (const element of [subtree, ...subtree.querySelectorAll<HTMLElement>('*')]) {
      if (layer.contains(element) || containers.has(element)) continue;
      const style = getComputedStyle(element);
      const axes: Axis[] = [];
      if (SCROLLABLE.test(style.overflowY) || (documentViewport && element === root && style.overflowY === 'visible')) axes.push('vertical');
      if (SCROLLABLE.test(style.overflowX) || (documentViewport && element === root && style.overflowX === 'visible')) axes.push('horizontal');
      if (!axes.length || style.scrollbarWidth === 'none') continue;
      const native = getComputedStyle(element, '::-webkit-scrollbar');
      if (native.display === 'none' || native.width === '0px') continue;
      const thickness = documentViewport ? 8 : Number.parseFloat(native.width) || 8;
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
    // Look through our own tracks without hiding them: hiding a hovered layer
    // invalidates :hover and can make expansion oscillate inside an iframe.
    const hovered = new Set(Array.from(containers.values()).flatMap(container =>
      Array.from(container.tracks.values()).filter(track => track.matches(':hover'))));
    const stackedHitTesting = typeof document.elementsFromPoint === 'function';
    if (!stackedHitTesting) layer.style.display = 'none';
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
      const isViewport = documentViewport && element === root;
      const left = isViewport ? 0 : rect.left + element.clientLeft;
      const top = isViewport ? 0 : rect.top + element.clientTop;
      const width = element.clientWidth;
      const height = element.clientHeight;
      // Clip overlays along with nested scrollports and rounded panel edges.
      let clipLeft = Math.max(0, left);
      let clipTop = Math.max(0, top);
      let clipRight = Math.min(window.innerWidth, left + width);
      let clipBottom = Math.min(window.innerHeight, top + height);
      const roundClips = [{ style: elementStyle, bounds: { left, top, right: left + width, bottom: top + height } }];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          roundClips.push({ style, bounds: {
            left: bounds.left + parent.clientLeft, top: bounds.top + parent.clientTop,
            right: bounds.left + parent.clientLeft + parent.clientWidth,
            bottom: bounds.top + parent.clientTop + parent.clientHeight,
          } });
        }
        if (style.overflowX !== 'visible') {
          clipLeft = Math.max(clipLeft, bounds.left + parent.clientLeft);
          clipRight = Math.min(clipRight, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          clipTop = Math.max(clipTop, bounds.top + parent.clientTop);
          clipBottom = Math.min(clipBottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
        if (parent === root) break;
      }
      for (const axis of container.axes) {
        const vertical = axis === 'vertical';
        const viewport = vertical ? height : width;
        const content = vertical ? element.scrollHeight : element.scrollWidth;
        if (content <= viewport + 1 && !container.tracks.has(axis)) continue;
        const track = container.tracks.get(axis) ?? makeTrack(container, axis);
        const thickness = container.thickness;
        const cross = vertical ? left + width - thickness - EDGE_GAP : top + height - thickness - EDGE_GAP;
        let start = vertical ? clipTop : clipLeft;
        let end = vertical ? clipBottom : clipRight;
        for (const clip of roundClips) {
          const [roundStart, roundEnd] = roundLimits(clip.style, clip.bounds, vertical, cross, cross + thickness);
          start = Math.max(start, roundStart);
          end = Math.min(end, roundEnd);
        }
        const trackLength = Math.max(0, end - start);
        const x = vertical ? cross : start;
        const y = vertical ? start : cross;
        const trackWidth = vertical ? thickness : trackLength;
        const trackHeight = vertical ? trackLength : thickness;
        // A floating panel may cover an end while leaving the midpoint exposed.
        // Hide the whole track so neither its thumb nor its hit area crosses it.
        // Stay a full CSS pixel inside both ends: Chromium may round a half
        // pixel into an adjacent footer/header even away from viewport edges.
        const sampleInset = Math.min(1, trackLength / 2);
        const exposed = [sampleInset, trackLength / 2, trackLength - sampleInset].every(offset => {
          // Chromium rounds hit-test coordinates: the last half pixel can
          // round outside the viewport and falsely hide an unobstructed track.
          const hitX = Math.max(0, Math.min(window.innerWidth - 1, vertical ? x + trackWidth / 2 : x + offset));
          const hitY = Math.max(0, Math.min(window.innerHeight - 1, vertical ? y + offset : y + trackHeight / 2));
          const hit = stackedHitTesting
            ? document.elementsFromPoint(hitX, hitY).find(element => !layer.contains(element))
            : document.elementFromPoint(hitX, hitY);
          return Boolean(hit && element.contains(hit));
        });
        const overflow = vertical ? elementStyle.overflowY : elementStyle.overflowX;
        const visible = (SCROLLABLE.test(overflow) || (isViewport && overflow === 'visible'))
          && content > viewport + 1 && viewport > 0
          && trackLength > 0
          && clipRight > clipLeft && clipBottom > clipTop
          && exposed;
        track.hidden = !visible;
        if (!visible) continue;
        Object.assign(track.style, {
          left: `${x}px`, top: `${y}px`, width: `${trackWidth}px`, height: `${trackHeight}px`,
          clipPath: `inset(${Math.max(0, clipTop - y)}px ${Math.max(0, x + trackWidth - clipRight)}px ${Math.max(0, y + trackHeight - clipBottom)}px ${Math.max(0, clipLeft - x)}px)`,
        });
        track.toggleAttribute('data-expanded', hovered.has(track) || dragging?.track === track);
        const thumb = track.firstElementChild as HTMLElement;
        const length = Math.min(trackLength, Math.max(24, trackLength * viewport / content));
        const scroll = vertical ? element.scrollTop : Math.abs(element.scrollLeft);
        const offset = Math.max(0, Math.min(1, scroll / (content - viewport))) * (trackLength - length);
        thumb.style[vertical ? 'height' : 'width'] = `${length}px`;
        thumb.style[vertical ? 'top' : 'left'] = `${offset}px`;
      }
    }
    if (!stackedHitTesting) layer.style.display = '';
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
  if (documentViewport) window.addEventListener('scroll', schedule, true);
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
    if (documentViewport) window.removeEventListener('scroll', schedule, true);
    containers.forEach(({ element }) => element.removeAttribute(MARKER));
    layer.remove();
    stylesheet.remove();
  };
}


/** Trusted bootstrap executed by the preview document without same-origin access. */
export function buildOverlayScrollbarsScript(): string {
  return `(() => {
    const boot = () => {
      if (typeof ResizeObserver !== 'undefined' && typeof document.elementFromPoint === 'function') {
        const dispose = (${installOverlayScrollbars.toString()})(document.documentElement, true);
        window.addEventListener('pagehide', dispose, { once: true });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  })()`;
}
