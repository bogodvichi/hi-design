import { useId } from 'react';
import { createPortal } from 'react-dom';
import {
  DialogHeader,
  DialogBody,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';

import { useT } from '../i18n';
import { AgentIcon } from './AgentIcon';
import styles from './DeepSeekHarnessSetupDialog.module.css';

interface Props {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeepSeekHarnessSetupDialog({ busy, error, onCancel, onConfirm }: Props) {
  const t = useT();
  const titleId = useId();
  const dialog = (
    <Dialog
      className={styles.dialog}
      role="alertdialog"
      onClose={onCancel}
      closeOnEscape={!busy}
      ariaLabelledBy={titleId}
      data-testid="deepseek-harness-setup-dialog"
    >
      <DialogHeader>
        <div className={styles.heading}>
          <span className={styles.icon} aria-hidden="true">
            <AgentIcon id="deepseek-harness" size={24} />
          </span>
          <div>
            <DialogTitle id={titleId}>{t('settings.dshSetupTitle')}</DialogTitle>
            <DialogDescription>{t('settings.dshSetupDescription')}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <DialogBody>
        <div className={styles.note}>{t('settings.dshSetupNote')}</div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter data-dialog-part="actions" className={styles.actions}>
        <Button type="button" variant="default" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onConfirm}
          disabled={busy}
          data-testid="deepseek-harness-setup-confirm"
        >
          {busy ? t('settings.dshSetupInstalling') : t('settings.dshSetupConfirm')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
