import { useState } from 'react';
import { Toast } from '../Toast';
import { FeedbackDialog } from './FeedbackDialog';
import styles from './FeedbackFab.module.css';

/**
 * Floating feedback button pinned to the bottom-right of non-conversation views.
 *
 * A circular button with a feedback glyph. Click opens the feedback dialog
 * which submits a demand to the Hikke requirements project via the daemon
 * `/api/hik/hikke/demand` route. The current SSO user is the implicit creator
 * (the hikkeToken auth resolves the creator server-side).
 */
export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label="问题反馈"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby="feedback-fab-tooltip"
        onClick={() => setOpen(true)}
      >
        <span className={styles.fabIcon}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path
              d="M44 6H4V36H13V41L23 36H44V6Z"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 19.5V22.5"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M24 19.5V22.5"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M34 19.5V22.5"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span id="feedback-fab-tooltip" role="tooltip" className={styles.fabHint}>
          问题反馈
        </span>
      </button>
      {open ? (
        <FeedbackDialog
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setSubmitted(true);
          }}
        />
      ) : null}
      {submitted ? (
        <Toast
          message="提交反馈成功，感谢您的反馈"
          tone="success"
          onDismiss={() => setSubmitted(false)}
        />
      ) : null}
    </>
  );
}
