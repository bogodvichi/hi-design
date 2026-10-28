import { userFacingError } from '../utils/userFacingError';
import { useT } from '../i18n';
// OD Library — manual upload modal.
//
// Opened from the Library toolbar's Upload button (and seeded by a section-wide
// file drop). Supports every common way to get bytes in:
//   • choose files   — native multi-select picker
//   • drag & drop     — onto the dropzone
//   • paste           — image/file from the clipboard, or a text/JSON snippet
//
// Every file runs the shared upload policy (images, fonts, text, HTML, JSON /
// design data; no audio/video; size-capped). The daemon enforces the same
// policy as the source of truth, so a rejected file shows a per-row reason here
// without trusting the client. Uploads run concurrently and the grid refreshes
// once the batch settles (live clipper-style SSE also refreshes it).
//
// Feedback and controls use the shared translation dictionary.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { LIBRARY_UPLOAD_MAX_BYTES, libraryUploadAcceptAttr } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from './Icon';
import { modalOverlay, modalContent } from '../motion';
import { uploadLibraryFile, uploadLibraryText, type LibraryUploadOutcome } from '../providers/registry';
import styles from './LibraryUploadModal.module.css';

type ItemStatus = 'uploading' | 'done' | 'deduped' | 'error';

interface UploadItem {
  id: string;
  name: string;
  status: ItemStatus;
  message?: string;
}

interface Props {
  /** Files to enqueue immediately (e.g. from a section-wide drop). */
  seedFiles: File[] | null;
  onClose: () => void;
  /** Fired after the batch settles so the grid can refresh. */
  onUploaded: () => void;
}

let uploadSeq = 0;
const nextItemId = () => `upload-${(uploadSeq += 1)}`;
const maxMb = Math.round(LIBRARY_UPLOAD_MAX_BYTES / 1_000_000);

export function LibraryUploadModal({ seedFiles, onClose, onUploaded }: Props) {
  const t = useT();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(0);
  const seededRef = useRef<File[] | null>(null);

  const finishItem = useCallback((id: string, outcome: LibraryUploadOutcome) => {
    inFlight.current -= 1;
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? outcome.ok
            ? { ...it, status: outcome.deduped ? 'deduped' : 'done' }
            : { ...it, status: 'error', message: outcome.code === 'PAYLOAD_TOO_LARGE' ? t('feedback.fileTooLarge', { max: maxMb }) : outcome.code === 'UNSUPPORTED_MEDIA_TYPE' ? t('feedback.unsupportedFormat') : userFacingError(outcome.error, t, 'feedback.uploadFailed') }
          : it,
      ),
    );
    // Refresh the grid once every dispatched upload has settled.
    if (inFlight.current === 0) onUploaded();
  }, [onUploaded, t]);

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = nextItemId();
        setItems((prev) => [{ id, name: file.name, status: 'uploading' }, ...prev]);
        inFlight.current += 1;
        void uploadLibraryFile(file).then((outcome) => finishItem(id, outcome));
      }
    },
    [finishItem],
  );

  const addText = useCallback(
    (text: string) => {
      const id = nextItemId();
      setItems((prev) => [{ id, name: t('feedback.pastedText', { count: text.length }), status: 'uploading' }, ...prev]);
      inFlight.current += 1;
      void uploadLibraryText(text).then((outcome) => finishItem(id, outcome));
    },
    [finishItem, t],
  );

  // Enqueue files handed in from a section-wide drop. The ref guard makes this
  // idempotent (StrictMode double-invoke / parent re-renders re-pass the same
  // array reference, which we only process once).
  useEffect(() => {
    if (seedFiles && seedFiles.length && seedFiles !== seededRef.current) {
      seededRef.current = seedFiles;
      addFiles(seedFiles);
    }
  }, [seedFiles, addFiles]);

  // Clipboard paste: prefer image/file payloads, fall back to a text snippet.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files ?? []);
      if (!files.length) {
        for (const item of Array.from(dt.items ?? [])) {
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (files.length) {
        e.preventDefault();
        addFiles(files);
        return;
      }
      const text = dt.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        addText(text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, addText]);

  // Owns Escape while open (LibrarySection's own handler stands down).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = ''; // let the same file be re-picked
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) addFiles(files);
  };

  const pending = items.some((it) => it.status === 'uploading');
  const okCount = items.filter((it) => it.status === 'done' || it.status === 'deduped').length;
  const errCount = items.filter((it) => it.status === 'error').length;

  const modal = (
    <motion.div
      className={styles.backdrop}
      onClick={onClose}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="presentation"
    >
      <motion.div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-label={t('feedback.uploadLibrary')}
      >
        <header className={styles.head}>
          <span className={styles.headTitle}>{t('feedback.uploadLibrary')}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('feedback.closeUpload')}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div
          className={styles.dropzone}
          data-drag={dragOver ? 'true' : 'false'}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <Icon name="upload" size={26} className={styles.dropIcon} />
          <p className={styles.dropTitle}>
            {t('feedback.dropOrPaste')} <span className={styles.dropLink}>{t('feedback.chooseFiles')}</span>
          </p>
          <p className={styles.dropHint}>
            {t('feedback.uploadFormats', { max: maxMb })}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={libraryUploadAcceptAttr()}
            className={styles.fileInput}
            onChange={onPick}
          />
        </div>

        {items.length > 0 ? (
          <ul className={styles.list}>
            {items.map((it) => (
              <li key={it.id} className={styles.item} data-status={it.status}>
                <span className={styles.itemIcon} aria-hidden>
                  {it.status === 'uploading' ? (
                    <Icon name="spinner" size={15} className={styles.spin} />
                  ) : it.status === 'error' ? (
                    <Icon name="alert-triangle" size={15} />
                  ) : (
                    <Icon name="check" size={15} />
                  )}
                </span>
                <span className={styles.itemName} title={it.name}>
                  {it.name}
                </span>
                <span className={styles.itemStatus}>
                  {it.status === 'uploading'
                    ? t('feedback.uploading')
                    : it.status === 'deduped'
                      ? t('feedback.alreadyInLibrary')
                      : it.status === 'done'
                        ? t('feedback.saved')
                        : (it.message ?? t('feedback.uploadFailed'))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className={styles.foot}>
          <span className={styles.summary}>
            {items.length === 0
              ? t('feedback.noData')
              : pending
                ? t('feedback.uploading')
                : t('feedback.uploadSummary', { succeeded: okCount, failed: errCount })}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
