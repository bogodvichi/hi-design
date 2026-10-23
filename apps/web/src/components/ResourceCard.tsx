import { useState, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import { Icon } from './Icon';
import { CardActionMenu, type CardActionMenuItem } from './CardActionMenu';
import { useT } from '../i18n';
import styles from './CloudSkillList.module.css';

interface ResourceCardProps {
  kind: 'skill' | 'mcp';
  title: string;
  icon: ReactNode;
  meta: ReactNode;
  source?: ReactNode;
  description?: string | null | undefined;
  stats?: ReactNode;
  installed: boolean;
  installing: boolean;
  uninstalling?: boolean;
  busy: boolean;
  onInstall: () => void;
  actions: {
    share?: () => void;
    uninstall?: () => void;
    unpublish?: () => void;
    delete?: () => void;
    removeShare?: () => void;
  };
}

/** One visual contract for Skill/MCP cards; callers supply only permitted actions. */
export function ResourceCard({ kind, title, icon, meta, source, description, stats, installed, installing, uninstalling = false, busy, onInstall, actions }: ResourceCardProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const prefix = kind === 'skill' ? 'personalScope.cloudSkill' : 'personalScope.cloudMcp';
  const canUninstall = installed && !!actions.uninstall;
  const showUninstall = canUninstall && (hovered || focused) && !busy;
  const label = t(`${prefix}${uninstalling ? 'Uninstalling' : installing ? 'Installing' : installed ? 'Installed' : 'Add'}`);
  const uninstallLabel = t(`${prefix}Uninstall`);

  const menuItems: CardActionMenuItem[] = [
    ...(actions.share ? [{ id: 'share' as const, label: t(`${prefix}Share`), onClick: actions.share }] : []),
    ...(actions.unpublish ? [{ id: 'unpublish' as const, label: t('squareScope.unpublish'), onClick: actions.unpublish }] : []),
    ...(actions.delete ? [{ id: 'delete' as const, label: t('common.delete'), onClick: actions.delete }] : []),
    ...(actions.removeShare ? [{ id: 'remove-share' as const, label: t('sharedSpace.removeFromSharedWithMe'), onClick: actions.removeShare }] : []),
  ];

  return <article className={styles.teamAssetCard}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon} aria-hidden>{icon}</span>
        <div className={`${styles.cardHeaderInfo}${menuItems.length ? ` ${styles.resourceCardHeaderInfo}` : ''}`}>
          <strong className={styles.cardTitle}>{title}</strong>
          <small className={styles.cardMeta}>{meta}</small>
          {source ? <small className={`${styles.cardMeta} ${styles.cardSourceLine}`}>{source}</small> : null}
        </div>
        <CardActionMenu items={menuItems.map((item) => ({ ...item, disabled: busy }))} className={styles.resourceCardMenuAnchor} />
      </div>
      {description ? <p className={`${styles.cardDesc} ${styles.squareCardDesc}`}>{description}</p> : null}
      <footer className={`community-template-card__foot ${styles.resourceCardFooter}`}>
        {stats}
        <div className="community-template-card__actions">
          <Button className={styles.resourceCardInstallButton} data-installed={installed}
            data-reversing={showUninstall} aria-label={showUninstall ? uninstallLabel : label}
            aria-busy={installing || uninstalling}
            disabled={busy || installing || uninstalling || (installed && !canUninstall)}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onClick={() => {
              setHovered(false);
              setFocused(false);
              if (installed) actions.uninstall?.(); else onInstall();
            }}>
            <span className={styles.resourceCardActionLabel} aria-hidden style={{ visibility: showUninstall ? 'hidden' : 'visible' }}>
              <Icon name={installing || uninstalling ? 'spinner' : installed ? 'check' : 'plus'} size={14} aria-hidden />
              {label}
            </span>
            {canUninstall ? <span className={styles.resourceCardActionLabel} aria-hidden style={{ visibility: showUninstall ? 'visible' : 'hidden' }}>
              <Icon name={kind === 'mcp' ? 'unlink' : 'minus-circle'} size={14} aria-hidden />
              {uninstallLabel}
            </span> : null}
          </Button>
        </div>
      </footer>
    </article>;
}
