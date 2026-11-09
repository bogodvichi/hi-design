// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const animation = vi.hoisted(() => ({ setSubframe: vi.fn(), goToAndStop: vi.fn(), autoplay: vi.fn() }));
vi.mock('lottie-react', () => ({
  Lottie: ({ lottieRef, subscriptions, autoplay }: {
    lottieRef: (handle: unknown) => void; subscriptions: { ready: () => void }; autoplay: boolean;
  }) => {
    animation.autoplay(autoplay);
    useEffect(() => { lottieRef({ animationItem: animation }); subscriptions.ready(); }, []);
    return null;
  },
}));
import { ComposerLottiePlayer } from '../../src/components/composer/ComposerLottiePlayer';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it('uses at most 30 artwork updates per second, loops and retires its clock on unmount', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const view = render(<ComposerLottiePlayer />);
  expect(animation.autoplay).toHaveBeenCalledWith(false);
  expect(animation.setSubframe).toHaveBeenCalledWith(false);
  animation.goToAndStop.mockClear();
  act(() => vi.advanceTimersByTime(10_000));
  const frames = animation.goToAndStop.mock.calls.map(([frame]) => frame as number);
  expect(frames.length).toBeGreaterThanOrEqual(290);
  expect(frames.length).toBeLessThanOrEqual(300);
  expect(frames.every(frame => frame >= 0 && frame < 100)).toBe(true);
  expect(frames.some((frame, index) => index > 0 && frame < frames[index - 1]!)).toBe(true);
  view.unmount();
  act(() => vi.advanceTimersByTime(10_000));
  expect(animation.goToAndStop).toHaveBeenCalledTimes(frames.length);
  expect(vi.getTimerCount()).toBe(0);
});
