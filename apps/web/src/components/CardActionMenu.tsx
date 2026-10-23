import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';

const ACTION_ICONS = {
  share: 'share',
  publish: 'arrow-up',
  unpublish: 'eye-off',
  delete: 'trash',
  'remove-share': 'minus-circle',
} as const satisfies Record<string, IconName>;

export interface CardActionMenuItem {
  id: keyof typeof ACTION_ICONS;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Resource cards use the project card menu's single visual contract. */
export function CardActionMenu({ items, className, triggerLabel }: {
  items: CardActionMenuItem[];
  className?: string;
  triggerLabel?: string;
}) {
  const t = useT();
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', closeOutside, { capture: true });
  }, [open]);
  if (!items.length) return null;
  return <div ref={container} className={`recent-projects__card-menu-anchor${className ? ` ${className}` : ''}`}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const buttons = [...container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? buttons.length - 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }
    }}>
    <Button ref={trigger} className="recent-projects__card-more" aria-label={triggerLabel ?? t('nextStep.more')}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)}>
      <Icon name="more-horizontal" size={14} aria-hidden />
    </Button>
    {open ? <div id={menuId} className="recent-projects__card-menu" role="menu">
      {items.map((item) => <Button key={item.id} role="menuitem" disabled={item.disabled}
        onClick={() => { setOpen(false); item.onClick(); }}>
        <Icon name={ACTION_ICONS[item.id]} size={14} aria-hidden /><span>{item.label}</span>
      </Button>)}
    </div> : null}
  </div>;
}
