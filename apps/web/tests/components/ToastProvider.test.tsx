// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../../src/components/Toast';
import { ToastProvider } from '../../src/components/ToastProvider';
import { notifyToast } from '../../src/components/toast-context';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('global operation feedback', () => {
  it('replaces the same operation result across failed retries instead of stacking notices', () => {
    const { rerender } = render(<ToastProvider><Toast message="Move failed" tone="error" toastKey="project-move" /></ToastProvider>);
    for (let attempt = 0; attempt < 3; attempt++) {
      rerender(<ToastProvider>{null}</ToastProvider>);
      rerender(<ToastProvider><Toast message="Move failed" tone="error" toastKey="project-move" /></ToastProvider>);
    }
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('portals existing toasts out of dialogs into one viewport', () => {
    render(<ToastProvider><div role="dialog"><Toast message="Saved" tone="success" /></div></ToastProvider>);
    expect(screen.getByRole('dialog').querySelector('.od-toast')).toBeNull();
    expect(screen.getByText('Saved').closest('[data-toast-viewport]')).not.toBeNull();
  });

  it('keeps operation results visible after their originating dialog unmounts', () => {
    const { rerender } = render(<ToastProvider><button onClick={() => notifyToast({ message: 'Shared', tone: 'success' })}>Share</button></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    rerender(<ToastProvider>{null}</ToastProvider>);
    expect(screen.getByText('Shared')).not.toBeNull();
  });

  it('keeps legacy result toasts for four seconds when their owner closes early', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ToastProvider><Toast message="Imported" tone="success" ttlMs={3500} /></ToastProvider>);
    act(() => vi.advanceTimersByTime(3500));
    rerender(<ToastProvider>{null}</ToastProvider>);
    expect(screen.getByText('Imported')).not.toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText('Imported')).toBeNull();
  });

  it('shows simultaneous results and dismisses success and failure after exactly four seconds', () => {
    vi.useFakeTimers();
    render(<ToastProvider>{null}</ToastProvider>);
    act(() => {
      notifyToast({ message: 'Copied', tone: 'success' });
      notifyToast({ message: 'Copy failed', tone: 'error' });
    });
    expect(screen.getByRole('status').textContent).toContain('Copied');
    expect(screen.getByRole('alert').textContent).toContain('Copy failed');
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getAllByText(/Cop/)).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.queryByText('Copy failed')).toBeNull();
  });

  it('dismisses one result without clearing another', () => {
    render(<ToastProvider>{null}</ToastProvider>);
    act(() => {
      notifyToast({ message: 'First', tone: 'success' });
      notifyToast({ message: 'Second', tone: 'error' });
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Second')).not.toBeNull();
  });

  it('keeps results visible in fullscreen without restarting their lifetime', () => {
    vi.useFakeTimers();
    const fullscreen = document.createElement('div');
    document.body.appendChild(fullscreen);
    const initial = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let activeFullscreen: Element | null = fullscreen;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => activeFullscreen });
    render(<ToastProvider>{null}</ToastProvider>);
    act(() => notifyToast({ message: 'Exported', tone: 'success' }));
    const notice = screen.getByText('Exported');
    expect(fullscreen.contains(notice)).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    activeFullscreen = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(fullscreen.contains(notice)).toBe(false);
    expect(screen.getByText('Exported')).toBe(notice);
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByText('Exported')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Exported')).toBeNull();
    if (initial) Object.defineProperty(document, 'fullscreenElement', initial);
    else Reflect.deleteProperty(document, 'fullscreenElement');
    fullscreen.remove();
  });
});
