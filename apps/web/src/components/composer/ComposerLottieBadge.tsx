import { memo, Suspense, lazy } from 'react';
import powerRobotAnimation from '../../assets/lottie/power-robot.json';

/**
 * Small Lottie badge pinned to the top-right corner of the home composer card.
 * Home-only; project surfaces do not render it.
 *
 * The lottie-react engine touches canvas/SVG globals at import time, which
 * jsdom does not provide. We lazy-load the component only in a real browser
 * environment so test runners that render HomeHero in jsdom stay stable.
 */
const LottiePlayer = lazy(async () => {
  const mod = await import('lottie-react');
  return {
    default: ({ src }: { src: string | object }) => {
      const Lottie = mod.Lottie;
      return <Lottie src={src} loop autoplay />;
    },
  };
});

export const ComposerLottieBadge = memo(function ComposerLottieBadge() {
  // jsdom defines window but lacks a real canvas context; lottie-web crashes
  // on import there. Defer to a lazy chunk that only loads in a browser.
  if (typeof window === 'undefined') {
    return null;
  }
  // In jsdom, getContext('2d') returns null — skip rendering there.
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('2d')) {
    return null;
  }
  return (
    <div className="composer-lottie-badge" aria-hidden>
      <Suspense fallback={null}>
        <LottiePlayer src={powerRobotAnimation} />
      </Suspense>
    </div>
  );
});
