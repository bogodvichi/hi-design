// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { PixelScanLogo } from '../../src/components/home-hero/PixelScanLogo';
import { AppWashKineticGrid } from '../../src/components/AppWashKineticGrid';
import { ComposerLottieBadge } from '../../src/components/composer/ComposerLottieBadge';

const engine = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), destroy: vi.fn(), resize: vi.fn() }));
const animation = vi.hoisted(() => ({ setSubframe: vi.fn(), goToAndStop: vi.fn() }));
vi.mock('three', () => ({}));
vi.mock('lottie-react', () => ({
  Lottie: ({ lottieRef, subscriptions }: { lottieRef: (handle: unknown) => void; subscriptions: { ready: () => void } }) => {
    useEffect(() => {
      lottieRef({ animationItem: animation });
      subscriptions.ready();
    }, []);
    return <div data-testid="lottie-player" />;
  },
}));
vi.mock('../../src/components/home-hero/pixel-scan/engine', () => ({
  PixelScanField: class {
    start = engine.start;
    stop = engine.stop;
    destroy = engine.destroy;
    resize = engine.resize;
  },
  drawStaticLogo: vi.fn(),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('loads the logo after interaction, pauses while inactive or hidden, and resumes on return', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { rerender } = render(<PixelScanLogo active />);
  expect(engine.start).not.toHaveBeenCalled();
  rerender(<PixelScanLogo active animate />);
  await waitFor(() => expect(engine.start).toHaveBeenCalled());
  engine.stop.mockClear();
  rerender(<PixelScanLogo active={false} animate />);
  expect(engine.stop).toHaveBeenCalled();
  engine.start.mockClear();
  rerender(<PixelScanLogo active animate />);
  expect(engine.start).toHaveBeenCalled();
  engine.stop.mockClear();
  act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
  expect(engine.stop).toHaveBeenCalled();
  engine.start.mockClear();
  act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
  expect(engine.start).toHaveBeenCalled();
});

it('draws the settled dot grid once and wakes on pointer movement', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => frames.delete(handle));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const context = { clearRect: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  render(<div><AppWashKineticGrid /></div>);
  for (let step = 0; step < 4; step++) {
    const pending = [...frames.values()]; frames.clear();
    act(() => pending.forEach((callback) => callback(step * 16)));
  }
  expect(frames.size).toBe(0);
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 })));
  expect(frames.size).toBe(1);
});

it('unmounts the Lottie player while inactive or hidden and restores it on return', async () => {
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { rerender } = render(<ComposerLottieBadge active />);
  expect(screen.queryByTestId('lottie-player')).toBeNull();
  rerender(<ComposerLottieBadge active animate />);
  await screen.findByTestId('lottie-player');
  expect(animation.setSubframe).toHaveBeenCalledWith(false);
  rerender(<ComposerLottieBadge active={false} animate />);
  expect(screen.queryByTestId('lottie-player')).toBeNull();
  const inactiveFrames = animation.goToAndStop.mock.calls.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); });
  expect(animation.goToAndStop).toHaveBeenCalledTimes(inactiveFrames);
  rerender(<ComposerLottieBadge active animate />);
  expect(screen.getByTestId('lottie-player')).toBeInTheDocument();
  act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByTestId('lottie-player')).toBeNull();
  const hiddenFrames = animation.goToAndStop.mock.calls.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); });
  expect(animation.goToAndStop).toHaveBeenCalledTimes(hiddenFrames);
  act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.getByTestId('lottie-player')).toBeInTheDocument();
  await waitFor(() => expect(animation.goToAndStop.mock.calls.length).toBeGreaterThan(hiddenFrames));
});

it('keeps the Lottie poster when Canvas is unavailable or reduced motion is requested', () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('CanvasRenderingContext2D', undefined);
  const view = render(<ComposerLottieBadge active animate />);
  expect(screen.queryByTestId('lottie-player')).toBeNull();
  expect(view.container.querySelector('img')).not.toBeNull();
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  view.rerender(<ComposerLottieBadge active animate />);
  expect(screen.queryByTestId('lottie-player')).toBeNull();
});
