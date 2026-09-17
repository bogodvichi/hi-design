import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './PageRefreshButton.module.css';

export function PageRefreshButton() {
  const t = useT();
  return (
    <Button
      className={`${styles.refresh} od-tooltip`}
      aria-label={t('designFiles.refresh')}
      title={t('designFiles.refresh')}
      data-tooltip={t('designFiles.refresh')}
      data-tooltip-placement="bottom"
      data-testid="entry-page-refresh"
      onClick={() => window.location.reload()}
    >
      <Icon name="refresh" size={16} aria-hidden />
    </Button>
  );
}
