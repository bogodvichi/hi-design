import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './TeamSpaceView.module.css';

/**
 * More-menu anchor for a folder card. Sits at the card's top-right corner
 * (same pattern as `recent-projects__card-menu-anchor`): a "more" button
 * that is invisible until the card is hovered, and a dropdown menu with
 * a delete action. Shared by TeamSpaceView and PersonalAllView.
 */
export function FolderCardMenu({
  onRename,
  renameLabel,
  onDelete,
  deleteLabel,
  onShare,
  shareLabel,
}: {
  onRename?: () => void;
  renameLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  onShare?: () => void;
  shareLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open]);

  return (
    <div className={styles.folderCardMenuAnchor} ref={containerRef}>
      <button
        type="button"
        className={styles.folderCardMore}
        aria-label={t('designs.menuMore')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Icon name="more-horizontal" size={14} />
      </button>
      {open ? (
        <div
          className={styles.folderCardMenu}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        {onShare ? (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onShare(); }}
          >
            <Icon name="share" size={12} />
            <span>{shareLabel}</span>
          </button>
        ) : null}
        {onRename ? (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(); }}
          >
            <Icon name="edit" size={12} />
            <span>{renameLabel}</span>
          </button>
        ) : null}
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
            >
              <Icon name="trash" size={12} />
              <span>{deleteLabel}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
