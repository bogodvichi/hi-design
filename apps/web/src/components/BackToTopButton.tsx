import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { smoothScrollToTop } from '../utils/smoothScrollToTop';
import styles from './BackToTopButton.module.css';

const VERTICAL_SCROLL_OVERFLOWS = new Set(['auto', 'scroll', 'overlay']);

function isVerticallyScrollable(element: HTMLElement): boolean {
  const { overflowY } = window.getComputedStyle(element);
  return (
    VERTICAL_SCROLL_OVERFLOWS.has(overflowY)
    && element.scrollHeight > element.clientHeight
  );
}

function eventScrollElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : null;
}

/**
 * Resolve the outermost page-level scroll container for a scroll event.
 *
 * Entry pages, settings, plugin details, and design-system flows each own a
 * different internal scroller. Walking out to the shell boundary keeps a
 * nested list or panel from replacing its page's scroll position.
 */
function pageScrollContainer(target: EventTarget | null): HTMLElement | null {
  const source = eventScrollElement(target);
  if (!source) return null;

  const shellBody = document.querySelector<HTMLElement>('.workspace-shell__body');
  if (shellBody && source !== shellBody && !shellBody.contains(source)) return null;

  let container: HTMLElement | null = null;
  let current: HTMLElement | null = source;
  while (current) {
    if (isVerticallyScrollable(current)) container = current;
    if (current === shellBody) break;
    current = current.parentElement;
  }
  return container;
}

export function BackToTopButton() {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = (event: Event) => {
      const container = pageScrollContainer(event.target);
      if (!container) return;
      scrollContainerRef.current = container;
      setVisible(container.scrollTop > 0);
    };

    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, []);

  if (!visible) return null;

  return (
    <Button
      size="icon"
      className={styles.button}
      aria-label="回到顶部"
      onClick={() => {
        const container = scrollContainerRef.current;
        if (container) smoothScrollToTop(container, 'gentle');
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M24.0083 14.1006V42.0001"
          stroke="#333"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 26L24 14L36 26"
          stroke="#333"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 6H36"
          stroke="#333"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Button>
  );
}
