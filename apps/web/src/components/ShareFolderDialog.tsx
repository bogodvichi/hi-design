import { notifyToast } from './toast-context';
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FieldGroup,
  DialogHeader,
  DialogBody,
  Dialog,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
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
  const titleId = useId();
  const [selected, setSelected] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selfEmail = typeof getStoredUserInfo()?.email === 'string'
    ? getStoredUserInfo().email.trim().toLowerCase()
    : '';
  const excludeEmails = selfEmail ? [selfEmail] : [];

  async function handleSubmit() {
    if (selected.length === 0 || submitting) return;
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
        notifyToast({ message: t('sharedSpace.shareFailed'), tone: 'error' });
        return;
      }
      notifyToast({ message: t('sharedSpace.shareSuccess'), tone: 'success' });
      onShared?.();
      onClose();
    } catch {
      notifyToast({ message: t('sharedSpace.shareFailed'), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <Dialog
      as="form"
      ariaLabelledBy={titleId}
      onClose={onClose}
      closeOnEscape
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle id={titleId}>{t('sharedSpace.shareFolderDialogTitle')}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className={styles.desc}>{t('sharedSpace.shareFolderDialogDesc')}</p>
        <div className={styles.project}>
          <strong>{folderName}</strong>
        </div>

        <FieldGroup label={t('sharedSpace.shareDialogRecipientLabel')}>
          <PersonPicker
            selected={selected}
            onChange={setSelected}
            multiple
            placeholder={t('sharedSpace.shareDialogRecipientPlaceholder')}
            excludeEmails={excludeEmails}
          />
        </FieldGroup>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter className="row">
        <button type="button" onClick={onClose} disabled={submitting}>
          {t('sharedSpace.shareDialogCancel')}
        </button>
        <button type="submit" className="primary" disabled={selected.length === 0 || submitting}>
          {t('sharedSpace.shareDialogSubmit')}
        </button>
      </DialogFooter>
    </Dialog>,
    document.body,
  );
}
