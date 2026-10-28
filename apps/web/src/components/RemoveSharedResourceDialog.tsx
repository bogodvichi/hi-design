import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import type { SharedResourceKind } from '@open-design/contracts';
import { removeResourceFromSharedWithMe } from '../collab/shared-space-catalog';
import { useT } from '../i18n';

export function RemoveSharedResourceDialog({ shareId, kind, resourceName, onClose, onRemoved }: {
  shareId: string;
  kind: SharedResourceKind;
  resourceName: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function remove() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      if (await removeResourceFromSharedWithMe(shareId, kind)) onRemoved();
      else setError(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return createPortal(<Dialog role="alertdialog" ariaLabel={t('sharedSpace.removeFromSharedWithMeTitle')}
    onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy} closeOnBackdrop={!busy}>
    <DialogTitle>{t('sharedSpace.removeFromSharedWithMeTitle')}</DialogTitle>
    <DialogDescription>{t('feedback.shareResourceBody')}{' '}
      {t('feedback.shareQuestionBefore')}{' '}<strong>{resourceName}</strong>{' '}{t('feedback.shareQuestionAfter')}
    </DialogDescription>
    {error ? <p role="alert">{t('sharedSpace.removeFromSharedWithMeFailed')}</p> : null}
    <DialogFooter>
      <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={busy} onClick={() => void remove()}>{t('sharedSpace.removeFromSharedWithMeConfirm')}</Button>
    </DialogFooter>
  </Dialog>, document.body);
}
