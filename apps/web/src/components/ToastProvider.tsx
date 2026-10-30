'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ToastContent } from './Toast';
import { OPERATION_TOAST_EVENT, ToastViewportContext, type OperationToast } from './toast-context';
import styles from './ToastProvider.module.css';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [toasts, setToasts] = useState<Array<OperationToast & { id: number }>>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const node = document.createElement('div');
    node.className = styles.viewport!;
    node.setAttribute('data-toast-viewport', '');
    // Fullscreen only paints descendants of its element. Move the same host
    // so notifications stay visible without restarting their four-second timers.
    const moveViewport = () => (document.fullscreenElement ?? document.body).appendChild(node);
    moveViewport();
    setViewport(node);
    const handleToast = (event: Event) => {
      const toast = (event as CustomEvent<OperationToast>).detail;
      const id = ++nextId.current;
      setToasts((current) => [...current.filter((item) => !toast.key || item.key !== toast.key), { ...toast, id }]);
    };
    window.addEventListener(OPERATION_TOAST_EVENT, handleToast);
    document.addEventListener('fullscreenchange', moveViewport);
    return () => {
      window.removeEventListener(OPERATION_TOAST_EVENT, handleToast);
      document.removeEventListener('fullscreenchange', moveViewport);
      node.remove();
    };
  }, []);

  return (
    <ToastViewportContext.Provider value={viewport}>
      {children}
      {viewport ? toasts.map(({ id, key: _key, ...toast }) => (
        <ToastContent key={id} {...toast} onDismiss={() => {
          toast.onDismiss?.();
          setToasts((current) => current.filter((item) => item.id !== id));
        }} />
      )) : null}
    </ToastViewportContext.Provider>
  );
}
