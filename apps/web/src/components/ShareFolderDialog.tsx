import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogFooter, DialogTitle } from '@open-design/components';
import { PersonPicker, type Person } from './PersonPicker';
import { useT } from '../i18n';
import { getStoredUserInfo } from '../auth/auth';
import { shareFolderToSharedSpace } from '../collab/shared-space-catalog';
import styles from './ShareToSharedSpaceDialog.module.css';

/**
 * Modal dialog for sharing an entire folder (including subfolders and
 * all projects) to the Shared Space.
 *
 * Mirrors ShareToSharedSpaceDialog but calls the folder-share endpoint
 * which batch-creates cloud folders and batch-shares all projects with
 * folder_id. Self-sharing is blocked in the picker and as a submit guard.
 */
export function ShareFolderDialog({
  folderId,
  workspaceId,
  homeWorkspaceId,
  folderName,
  onClose,
  onShared,
}: {
  folderId: string;
  workspaceId: string;
  homeWorkspaceId: string;
  folderName: string;
  onClose: () => void;
  onShared?: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selfEmail = typeof getStoredUserInfo()?.email === 'string'
    ? getStoredUserInfo().email.trim().toLowerCase()
    : '';
  const excludeEmails = selfEmail ? [selfEmail] : [];

  async function handleSubmit() {
    if (selected.length === 0) return;
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
      const result = await shareFolderToSharedSpace({
        folderId,
        workspaceId,
        homeWorkspaceId,
        recipients: selected
          .filter((p) => {
            const email = typeof p.email === 'string' ? p.email.trim() : '';
            return Boolean(email && email.includes('@'));
          })
          .map((p) => {
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
      <DialogTitle>{t('sharedSpace.shareFolderDialogTitle')}</DialogTitle>
      <p className={styles.desc}>
        {t('sharedSpace.shareFolderDialogDesc')}
      </p>
      <div className={styles.project}>
        <strong>{folderName}</strong>
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
