import type { CSSProperties, ReactNode } from 'react';
import { FieldGroup } from './field-group';
import { joinClassNames } from './class-names';
import styles from './visual-choice-group.module.css';

export interface VisualChoiceOption<Value extends string> {
  value: Value;
  label: string;
  visual: ReactNode;
  disabled?: boolean;
}

export interface VisualChoiceGroupProps<Value extends string> {
  label: ReactNode;
  options: readonly VisualChoiceOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
  size?: number;
  radius?: number;
  className?: string;
}

/** Controlled visual choices. Callers own assets, labels, and persistence. */
export function VisualChoiceGroup<Value extends string>({
  label, options, value, onChange, disabled = false, size = 34, radius = 8, className,
}: VisualChoiceGroupProps<Value>) {
  const variables = {
    '--visual-choice-size': `${size}px`,
    '--visual-choice-radius': `${radius}px`,
  } as CSSProperties;
  return (
    <FieldGroup label={label} disabled={disabled} className={className} style={variables}>
      <div className={styles.options}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={value === option.value}
            disabled={option.disabled}
            className={joinClassNames(styles.option, value === option.value ? styles.selected : undefined)}
            onClick={() => onChange(option.value)}
          >
            {option.visual}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}
