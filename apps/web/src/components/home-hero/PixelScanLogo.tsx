import { useEffect, useRef, useState } from 'react';
import type { PixelScanField } from './pixel-scan/engine';
import styles from './PixelScanLogo.module.css';

interface Props {
  active?: boolean;
  animate?: boolean;
  className?: string;
  /** Accessible label for the wordmark (the canvas itself is decorative). */
  label?: string;
}

// Keep the static wordmark visible until interaction requests the WebGL engine.
export function PixelScanLogo({ active = true, animate = false, className, label = 'HiDesign' }: Props) {
  const [ready, setReady] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<PixelScanField | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!animate || !host || !canvas) return undefined;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    let disposed = false;
    let field: PixelScanField | null = null;
    let ro: ResizeObserver | null = null;
    let frame = 0;
    const syncVisibility = () => {
      if (activeRef.current && !document.hidden) {
        field?.resize();
        field?.start();
      } else {
        field?.stop();
      }
    };
    document.addEventListener('visibilitychange', syncVisibility);

    void Promise.all([import('three'), import('./pixel-scan/engine')])
      .then(([THREE, { PixelScanField }]) => {
        if (disposed) return;
        field = new PixelScanField(host, canvas, THREE);
        fieldRef.current = field;
        setReady(true);
        syncVisibility();
        ro = new ResizeObserver(() => {
          if (!activeRef.current || document.hidden) return;
          // Coalesce bursts of resize notifications into one re-measure per frame.
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            frame = 0;
            field?.resize();
          });
        });
        ro.observe(host);
      })
      .catch((err: unknown) => {
        // Surface the underlying failure — the static fallback must not mask it.
        console.error('[pixel-scan] falling back to static logo:', err);
        if (!disposed) setReady(false);
      });

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      field?.destroy();
      fieldRef.current = null;
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [animate]);

  useEffect(() => {
    if (active && !document.hidden) {
      fieldRef.current?.resize();
      fieldRef.current?.start();
    } else {
      fieldRef.current?.stop();
    }
  }, [active]);

  return (
    <div ref={hostRef} className={className} role="img" aria-label={label}>
      {!ready ? <img className={styles.poster} src="/logo-scan.svg" alt="" /> : null}
      <canvas ref={canvasRef} style={{ visibility: ready ? 'visible' : 'hidden' }} />
    </div>
  );
}
