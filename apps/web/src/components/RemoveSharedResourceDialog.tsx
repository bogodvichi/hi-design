import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import type { SharedResourceKind } from '@open-design/contracts';
import { removeResourceFromSharedWithMe } from '../collab/shared-space-catalog';
import { useI18n, useT } from '../i18n';

export function RemoveSharedResourceDialog({ shareId, kind, onClose, onRemoved }: {
  shareId: string;
  kind: SharedResourceKind;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
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
    <DialogDescription>{locale.startsWith('zh')
      ? '仅从“分享给我的”列表移除，不会删除原始资源，也不会影响其他接收人。已添加的 Skill 和已连接的 MCP 保持不变。'
      : 'Remove this reference from Shared with me. The original resource, other recipients, installed Skills and connected MCPs remain unchanged.'}</DialogDescription>
    {error ? <p role="alert">{t('sharedSpace.removeFromSharedWithMeFailed')}</p> : null}
    <DialogFooter>
      <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      <Button disabled={busy} onClick={() => void remove()}>{t('sharedSpace.removeFromSharedWithMeConfirm')}</Button>
    </DialogFooter>
  </Dialog>, document.body);
}
