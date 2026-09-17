import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import { PersonPicker, type Person } from './PersonPicker';
import { useT } from '../i18n';
import { getStoredUserInfo } from '../auth/auth';
import { shareProjectToSharedSpace } from '../collab/shared-space-catalog';
import styles from './ShareToSharedSpaceDialog.module.css';

/**
 * Modal dialog for sharing a project to the Shared Space.
 *
 * Uses PersonPicker in multiple mode so the user can select several
 * recipients. On submit, calls the daemon route which resolves the SSO
 * username server-side and forwards to the HDW backend.
 */
export function ShareToSharedSpaceDialog({
  projectId,
  homeWorkspaceId,
  projectName,
  onClose,
  onShared,
}: {
  projectId: string;
  homeWorkspaceId: string;
  projectName: string;
  onClose: () => void;
  onShared?: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Current user's email — used to exclude self from the recipient picker.
  // Sharing to yourself is not allowed in the shared space.
  const selfEmail = typeof getStoredUserInfo()?.email === 'string'
    ? getStoredUserInfo().email.trim().toLowerCase()
    : '';
  const excludeEmails = selfEmail ? [selfEmail] : [];

  async function handleSubmit() {
    if (selected.length === 0) return;
    // Guard against self-share even if the picker somehow let one through.
    if (selfEmail && selected.some((p) => {
      const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      return email === selfEmail;
    })) {
      setError(t('sharedSpace.cannotShareToSelf'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
     const result = await shareProjectToSharedSpace({
       projectId,
       homeWorkspaceId,
     recipients: selected
       .filter((p) => {
         const email = typeof p.email === 'string' ? p.email.trim() : '';
         return Boolean(email && email.includes('@'));
       })
       .map((p) => {
         // SSO username = email local-part (e.g. luqian from luqian@hikvision.com.cn)
         // PersonPicker id is employee code (HZ20068328), NOT the SSO username.
         const email = typeof p.email === 'string' ? p.email.trim() : '';
         const username = email.split('@')[0] || '';
         return {
           username,
           displayname: p.name,
         };
       }),
      });
      if (!result) {
        setError(t('sharedSpace.shareFailed'));
        return;
      }
      setSuccess(true);
      onShared?.();
      setTimeout(() => onClose(), 800);
    } catch {
      setError(t('sharedSpace.shareFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <Dialog
      as="form"
      onClose={onClose}
      closeOnEscape
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <DialogTitle>{t('sharedSpace.shareDialogTitle')}</DialogTitle>
      <p className={styles.desc}>
        {t('sharedSpace.shareDialogDesc')}
      </p>
      <div className={styles.project}>
        <strong>{projectName}</strong>
      </div>
      <label className={styles.label}>
        {t('sharedSpace.shareDialogRecipientLabel')}
      </label>
     <PersonPicker
       selected={selected}
       onChange={setSelected}
       multiple
       placeholder={t('sharedSpace.shareDialogRecipientPlaceholder')}
       excludeEmails={excludeEmails}
     />
      {error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : null}
      {success ? (
        <p className={styles.success} role="status">
          {t('sharedSpace.shareSuccess')}
        </p>
      ) : null}
      <DialogFooter className="row">
        <button type="button" onClick={onClose} disabled={submitting}>
          {t('sharedSpace.shareDialogCancel')}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={selected.length === 0 || submitting}
        >
          {t('sharedSpace.shareDialogSubmit')}
        </button>
      </DialogFooter>
    </Dialog>,
    document.body,
  );
}
