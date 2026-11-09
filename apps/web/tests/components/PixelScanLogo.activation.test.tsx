// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const field = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), stop: vi.fn(), resize: vi.fn(), destroy: vi.fn() }));
vi.mock('three', () => ({}));
vi.mock('../../src/components/home-hero/pixel-scan/engine', () => ({
  PixelScanField: class {
    constructor() { field.create(); }
    start = field.start; stop = field.stop; resize = field.resize; destroy = field.destroy;
  },
}));
import { PixelScanLogo } from '../../src/components/home-hero/PixelScanLogo';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('home logo activation', () => {
  it('keeps a static logo until requested, pauses offscreen and resumes on return', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const view = render(<PixelScanLogo active animate={false} />);
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/logo-scan.svg');
    expect(field.create).not.toHaveBeenCalled();
    view.rerender(<PixelScanLogo active animate />);
    await waitFor(() => expect(field.create).toHaveBeenCalledOnce());
    expect(field.start).toHaveBeenCalled();
    view.rerender(<PixelScanLogo active={false} animate />);
    expect(field.stop).toHaveBeenCalledOnce();
    const starts = field.start.mock.calls.length;
    await act(async () => { await Promise.resolve(); });
    expect(field.start).toHaveBeenCalledTimes(starts);
    view.rerender(<PixelScanLogo active animate />);
    expect(field.start).toHaveBeenCalledTimes(starts + 1);
    view.unmount();
    expect(field.destroy).toHaveBeenCalledOnce();
  });
});
