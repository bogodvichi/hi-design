import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './TeamSpaceView.module.css';

/**
 * More-menu anchor for a folder card. Sits at the card's top-right corner
 * (same pattern as `recent-projects__card-menu-anchor`): a "more" button
 * that is invisible until the card is hovered, and a dropdown menu with
 * the actions supplied by the owning view. Shared by team and personal folders.
 */
export function FolderCardMenu({
  onRename,
  renameLabel,
  onDelete,
  deleteLabel,
  onShare,
  shareLabel,
  onMove,
  moveLabel,
}: {
  onRename?: () => void;
  renameLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  onShare?: () => void;
  shareLabel?: string;
  onMove?: () => void;
  moveLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [contextPosition, setContextPosition] = useState<{ left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = containerRef.current?.closest<HTMLElement>('[role="button"]');
    if (!card) return;
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const anchorRect = containerRef.current?.getBoundingClientRect();
      setContextPosition({
        left: event.clientX - (anchorRect?.left ?? 0),
        top: event.clientY - (anchorRect?.top ?? 0),
      });
      setOpen(true);
    };
    card.addEventListener('contextmenu', onContextMenu);
    return () => card.removeEventListener('contextmenu', onContextMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setContextPosition(null);
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
        onClick={(e) => {
          e.stopPropagation();
          setContextPosition(null);
          setOpen((v) => !v);
        }}
      >
        <Icon name="more-horizontal" size={14} />
      </button>
      {open ? (
        <div
          className={styles.folderCardMenu}
          role="menu"
          style={contextPosition ? {
            left: contextPosition.left,
            top: contextPosition.top,
            right: 'auto',
          } : undefined}
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
        {onShare && (onRename || onMove || onDelete) ? (
          <div className={styles.folderCardMenuSeparator} role="separator" />
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
        {onMove ? (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onMove(); }}
          >
            <Icon name="move" size={12} />
            <span>{moveLabel}</span>
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
