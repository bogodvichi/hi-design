import { memo, Suspense, lazy, useEffect, useState } from 'react';
import styles from './ComposerLottieBadge.module.css';

const LottiePlayer = lazy(() => import('./ComposerLottiePlayer').then(module => ({ default: module.ComposerLottiePlayer })));

export const ComposerLottieBadge = memo(function ComposerLottieBadge({ active = true, animate = false }: { active?: boolean; animate?: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const poster = <img className={styles.poster} src="/power-robot-poster.png" alt="" />;
  const play = active && animate && visible
    && typeof window.CanvasRenderingContext2D === 'function'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="composer-lottie-badge" aria-hidden>
      <Suspense fallback={poster}>
        {play ? <LottiePlayer /> : poster}
      </Suspense>
    </div>
  );
});
