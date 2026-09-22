import { Icon, type IconName } from './Icon';
import styles from './CommunityResourceStats.module.css';

function formatMetric(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
}

export function CommunityResourceStats({
  previewCount,
  actionCount,
  actionIcon,
  previewLabel,
  actionLabel,
  align = 'left',
}: {
  previewCount?: number | null;
  actionCount?: number | null;
  actionIcon: IconName;
  previewLabel: string;
  actionLabel: string;
  align?: 'left' | 'right';
}) {
  return (
    <div
      className={`${styles.stats}${align === 'right' ? ` ${styles.statsRight}` : ''}`}
      aria-label={`${previewLabel} ${formatMetric(previewCount)}, ${actionLabel} ${formatMetric(actionCount)}`}
    >
      <span className={styles.item} title={previewLabel}>
        <Icon name="eye" size={13} aria-hidden />
        <span>{formatMetric(previewCount)}</span>
      </span>
      <span className={styles.item} title={actionLabel}>
        <Icon name={actionIcon} size={13} aria-hidden />
        <span>{formatMetric(actionCount)}</span>
      </span>
    </div>
  );
}
