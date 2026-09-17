import { useT } from '../i18n';
import { BlankMark } from './EntryBlankState';
import styles from './PageEmptyState.module.css';

export function PageEmptyState({ title, search = false }: {
  title?: string;
  search?: boolean;
}) {
  const t = useT();
  return (
    <div className={styles.empty}>
      <div className={styles.illustration} aria-hidden><BlankMark /></div>
      <h2 className={styles.title}>{title ?? t(search ? 'pluginsView.emptyNoMatchTitle' : 'contentEmpty.title')}</h2>
    </div>
  );
}
