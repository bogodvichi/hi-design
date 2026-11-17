'use client';

import { useEffect } from 'react';
import { installNativeScrollbars } from './overlay-scrollbars-runtime';
export { installNativeScrollbars, buildNativeScrollbarsScript, installOverlayScrollbars, buildOverlayScrollbarsScript } from './overlay-scrollbars-runtime';

/** Apply native defaults once; the browser owns geometry and interaction. */
export function NativeScrollbars() {
  useEffect(() => installNativeScrollbars(document.body), [installNativeScrollbars]);
  return null;
}

/** @deprecated Use NativeScrollbars. */
export const OverlayScrollbars = NativeScrollbars;
