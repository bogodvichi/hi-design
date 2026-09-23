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
  primaryCount,
  secondaryCount,
  primaryIcon = 'eye',
  secondaryIcon,
  primaryLabel,
  secondaryLabel,
  align = 'left',
}: {
  primaryCount?: number | null;
  secondaryCount?: number | null;
  primaryIcon?: IconName;
  secondaryIcon: IconName;
  primaryLabel: string;
  secondaryLabel: string;
  align?: 'left' | 'right';
}) {
  return (
    <div
      className={`${styles.stats}${align === 'right' ? ` ${styles.statsRight}` : ''}`}
      aria-label={`${primaryLabel} ${formatMetric(primaryCount)}, ${secondaryLabel} ${formatMetric(secondaryCount)}`}
    >
      <span className={styles.item} title={primaryLabel}>
        <Icon name={primaryIcon} size={13} aria-hidden />
        <span>{formatMetric(primaryCount)}</span>
      </span>
      <span className={styles.item} title={secondaryLabel}>
        <Icon name={secondaryIcon} size={13} aria-hidden />
        <span>{formatMetric(secondaryCount)}</span>
      </span>
    </div>
  );
}
