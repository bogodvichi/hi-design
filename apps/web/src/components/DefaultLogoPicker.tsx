import type { ReactNode } from 'react';
import { VisualChoiceGroup } from '@open-design/components';

export function DefaultLogoPicker<Key extends string>({
  value, onChange, locale, options, labels, renderLogo,
}: {
  value: Key;
  onChange: (value: Key) => void;
  locale: string;
  options: readonly Key[];
  labels: Record<Key, { zh: string; en: string }>;
  renderLogo: (key: Key) => ReactNode;
}) {
  return (
    <VisualChoiceGroup
      label={locale.startsWith('zh') ? '默认 Logo' : 'Default logo'}
      value={value}
      onChange={onChange}
      options={options.map(key => ({
        value: key,
        label: locale.startsWith('zh') ? labels[key].zh : labels[key].en,
        visual: renderLogo(key),
      }))}
    />
  );
}
