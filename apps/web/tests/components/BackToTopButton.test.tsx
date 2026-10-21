// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const smoothScrollToTop = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/smoothScrollToTop', () => ({ smoothScrollToTop }));

import { BackToTopButton } from '../../src/components/BackToTopButton';

function setScrollGeometry(
  element: HTMLElement,
  geometry: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: geometry.clientHeight },
    scrollHeight: { configurable: true, value: geometry.scrollHeight },
    scrollTop: { configurable: true, value: geometry.scrollTop, writable: true },
  });
}

afterEach(() => {
  cleanup();
  smoothScrollToTop.mockReset();
});

describe('<BackToTopButton>', () => {
  it('appears as soon as the page scrolls away from the top', () => {
    const { getByTestId } = render(
      <>
        <div className="workspace-shell__body">
          <main data-testid="page-scroll" style={{ overflowY: 'auto' }} />
        </div>
        <BackToTopButton />
      </>,
    );
    const scroller = getByTestId('page-scroll');
    setScrollGeometry(scroller, { clientHeight: 600, scrollHeight: 1800, scrollTop: 0 });

    fireEvent.scroll(scroller);
    expect(screen.queryByRole('button', { name: '回到顶部' })).toBeNull();

    scroller.scrollTop = 1;
    fireEvent.scroll(scroller);
    expect(screen.getByRole('button', { name: '回到顶部' })).toBeTruthy();

    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole('button', { name: '回到顶部' })).toBeNull();
  });

  it('scrolls the outer page container instead of a nested panel', () => {
    const { getByTestId } = render(
      <>
        <div className="workspace-shell__body">
          <main data-testid="page-scroll" style={{ overflowY: 'auto' }}>
            <div data-testid="nested-scroll" style={{ overflowY: 'auto' }} />
          </main>
        </div>
        <BackToTopButton />
      </>,
    );
    const pageScroller = getByTestId('page-scroll');
    const nestedScroller = getByTestId('nested-scroll');
    setScrollGeometry(pageScroller, { clientHeight: 600, scrollHeight: 1800, scrollTop: 900 });
    setScrollGeometry(nestedScroller, { clientHeight: 240, scrollHeight: 900, scrollTop: 500 });

    fireEvent.scroll(nestedScroller);
    fireEvent.click(screen.getByRole('button', { name: '回到顶部' }));

    expect(smoothScrollToTop).toHaveBeenCalledWith(pageScroller, 'gentle');
  });

  it('supports fractional scroll positions from the desktop client', () => {
    const { getByTestId } = render(
      <>
        <div className="workspace-shell__body">
          <main data-testid="page-scroll" style={{ overflowY: 'auto' }} />
        </div>
        <BackToTopButton />
      </>,
    );
    const scroller = getByTestId('page-scroll');
    setScrollGeometry(scroller, { clientHeight: 600, scrollHeight: 760, scrollTop: 0.5 });

    fireEvent.scroll(scroller);
    expect(screen.getByRole('button', { name: '回到顶部' })).toBeTruthy();
  });
});
