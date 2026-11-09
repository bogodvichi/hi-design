import { useCallback, useEffect, useState } from 'react';
import { Lottie, type LottieHandle } from 'lottie-react';
import powerRobotAnimation from '../../assets/lottie/power-robot.json';

export function ComposerLottiePlayer() {
  const [item, setItem] = useState<LottieHandle['animationItem']>(null);
  const [ready, setReady] = useState(false);
  const attach = useCallback((handle: LottieHandle | null) => setItem(handle?.animationItem ?? null), []);

  useEffect(() => {
    if (!item || !ready) return;
    item.setSubframe(false);
    // Autoplay schedules at display Hz even when subframe interpolation is off.
    // This decorative loop only needs the artwork's own 30 Hz clock.
    const startedAt = performance.now();
    const frameCount = powerRobotAnimation.op - powerRobotAnimation.ip;
    let timer = 0;
    const draw = () => {
      const step = Math.floor((performance.now() - startedAt) * powerRobotAnimation.fr / 1000);
      item.goToAndStop(step % frameCount, true);
      // Browser timers round fractional delays. Target the next frame boundary
      // so a 33 ms interval cannot wake twice for the same 30 fps frame.
      const nextFrameAt = startedAt + (step + 1) * 1000 / powerRobotAnimation.fr;
      timer = window.setTimeout(draw, Math.max(1, Math.ceil(nextFrameAt - performance.now())));
    };
    draw();
    return () => window.clearTimeout(timer);
  }, [item, ready]);

  return <Lottie src={powerRobotAnimation} renderer="canvas" autoplay={false}
    lottieRef={attach} subscriptions={{ ready: () => setReady(true) }} />;
}
