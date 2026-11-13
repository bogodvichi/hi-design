'use client';

import { useEffect } from 'react';
import { installOverlayScrollbars } from './overlay-scrollbars-runtime';
export { installOverlayScrollbars, buildOverlayScrollbarsScript } from './overlay-scrollbars-runtime';

export function OverlayScrollbars() {
  useEffect(() => {
    if (typeof ResizeObserver !== 'undefined' && typeof document.elementFromPoint === 'function') {
      return installOverlayScrollbars(document.body);
    }
  }, []);
  return null;
}
