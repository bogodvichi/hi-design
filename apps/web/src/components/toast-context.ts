'use client';

import { createContext } from 'react';
import type { ToastProps } from './Toast';

export const ToastViewportContext = createContext<HTMLElement | null>(null);
export const OPERATION_TOAST_EVENT = 'od:operation-toast';
export type OperationToast = Omit<ToastProps, 'placement'> & { key?: string };

/** Operation results belong to the app, so closing a dialog cannot erase them. */
export function notifyToast(toast: OperationToast): void {
  window.dispatchEvent(new CustomEvent<OperationToast>(OPERATION_TOAST_EVENT, { detail: toast }));
}
