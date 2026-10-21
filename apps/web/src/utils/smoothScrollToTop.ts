// Animated scroll-to-top for app scroll containers.
//
// `scrollTo({ top: 0 })` snaps the viewport in a single frame; layered on
// top of a closing modal (the plugin detail flow routes Use → Home composer)
// the jump reads as a stutter rather than a transition. This helper tweens
// `scrollTop` with the house ease-out so the trip back to the composer reads
// as one continuous gesture.
//
// Contract:
// - eases to 0 with `cubic-bezier(0.23, 1, 0.32, 1)` (AGENTS.md → UI
//   animation philosophy); duration scales with distance, capped so long
//   flights stay decisive
// - the user grabbing the scroll mid-flight (wheel / touch) cancels the tween
//   immediately — their input wins
// - `prefers-reduced-motion: reduce` (and environments without rAF) jump
//   instantly, preserving the previous behavior
// - re-invoking on the same container retargets instead of running two
//   competing tweens

// cubic-bezier(x1, y1, x2, y2) solver (WebKit UnitBezier shape). Local math
// instead of motion's `cubicBezier` because 'motion/react' is module-mocked
// in the web test environment.
function unitBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}

// House ease-out (AGENTS.md → UI animation philosophy).
const EASE_OUT = unitBezier(0.23, 1, 0.32, 1);
// A gentler acceleration/deceleration curve for an explicit user-requested
// trip. It avoids the fast initial pull that is useful for automatic route
// transitions but can feel abrupt on a visible back-to-top control.
const GENTLE_EASE = unitBezier(0.4, 0, 0.2, 1);

type SmoothScrollProfile = 'default' | 'gentle';

const SCROLL_PROFILES = {
  default: {
    ease: EASE_OUT,
    minDurationMs: 260,
    maxDurationMs: 600,
    distancePerMs: 6,
  },
  gentle: {
    ease: GENTLE_EASE,
    minDurationMs: 420,
    maxDurationMs: 900,
    distancePerMs: 4,
  },
} satisfies Record<SmoothScrollProfile, {
  ease: (x: number) => number;
  minDurationMs: number;
  maxDurationMs: number;
  distancePerMs: number;
}>;

const inFlight = new WeakMap<HTMLElement, () => void>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function smoothScrollToTop(
  container: HTMLElement,
  profile: SmoothScrollProfile = 'default',
): void {
  inFlight.get(container)?.();

  container.scrollLeft = 0;
  const from = container.scrollTop;
  if (from <= 0) return;

  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    container.scrollTop = 0;
    return;
  }

  const motion = SCROLL_PROFILES[profile];
  const duration = Math.min(
    motion.maxDurationMs,
    motion.minDurationMs + from / motion.distancePerMs,
  );

  let frame = 0;
  let start: number | null = null;
  const cancel = () => {
    cancelAnimationFrame(frame);
    cleanup();
  };
  const cleanup = () => {
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('touchstart', cancel);
    if (inFlight.get(container) === cancel) inFlight.delete(container);
  };

  const step = (now: number) => {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / duration);
    container.scrollTop = from * (1 - motion.ease(t));
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      cleanup();
    }
  };

  container.addEventListener('wheel', cancel, { passive: true });
  container.addEventListener('touchstart', cancel, { passive: true });
  inFlight.set(container, cancel);
  frame = requestAnimationFrame(step);
}
