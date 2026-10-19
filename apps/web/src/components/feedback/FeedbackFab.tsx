import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { FeedbackDialog } from './FeedbackDialog';
import styles from './FeedbackFab.module.css';

/**
 * Floating feedback button pinned to the bottom-right of the home view.
 *
 * A circular button with an envelope glyph. Click opens the feedback dialog
 * which submits a demand to the Hikke requirements project via the daemon
 * `/api/hik/hikke/demand` route. The current SSO user is the implicit creator
 * (the hikkeToken auth resolves the creator server-side).
 */
export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const dismissedRef = useRef(false);

  // Show the "反馈" tooltip hint for the first few seconds, then retire it
  // so it doesn't visually clutter the corner on every home visit.
  useEffect(() => {
    if (dismissedRef.current) return;
    const t = window.setTimeout(() => setHint(false), 6000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label="反馈"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dismissedRef.current = true;
          setHint(false);
          setOpen(true);
        }}
      >
        <span className={styles.fabIcon}>
          <Icon name="mail" size={22} strokeWidth={1.6} aria-hidden />
        </span>
        {hint && !open ? <span className={styles.fabHint}>反馈</span> : null}
      </button>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
