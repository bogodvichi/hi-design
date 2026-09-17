import { Fragment, useState } from 'react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './ModuleBreadcrumb.module.css';

interface Ancestor {
  key: string;
  label: string;
  onNavigate: () => void;
}

/** Ancestors only: the current directory is displayed by the page heading. */
export function ModuleBreadcrumb({ items }: { items: Ancestor[] }) {
  const t = useT();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const pathKey = JSON.stringify(items.map((item) => item.key));
  const collapsed = items.length > 2 && expandedPath !== pathKey;
  const parent = items[items.length - 1];
  if (!parent) return null;

  return (
    <nav className={styles.breadcrumb} aria-label="breadcrumb">
      <Button
        variant="ghost"
        className={styles.back}
        onClick={parent.onNavigate}
        aria-label={`${t('entry.upgradeBack')} · ${parent.label}`}
        title={`${t('entry.upgradeBack')} · ${parent.label}`}
      >
        <Icon name="arrow-left" size={16} aria-hidden />
      </Button>
      {items.map((item, index) => {
        if (collapsed && index > 0 && index < items.length - 1) {
          return index === 1 ? (
            <Fragment key="collapsed">
              <span className={styles.separator} aria-hidden>/</span>
              <Button variant="ghost" className={styles.ancestor}
                aria-label={t('designFiles.expandGroup')}
                aria-expanded={false}
                title={items.slice(1, -1).map((ancestor) => ancestor.label).join(' / ')}
                onClick={() => setExpandedPath(pathKey)}>…</Button>
            </Fragment>
          ) : null;
        }
        return (
          <Fragment key={item.key}>
            {index > 0 ? <span className={styles.separator} aria-hidden>/</span> : null}
            <Button variant="ghost" className={styles.ancestor} title={item.label} onClick={item.onNavigate}>
              <span>{item.label}</span>
            </Button>
          </Fragment>
        );
      })}
    </nav>
  );
}
