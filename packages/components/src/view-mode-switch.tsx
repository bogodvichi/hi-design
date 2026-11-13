import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { joinClassNames } from './class-names';
import styles from './view-mode-switch.module.css';

export interface ViewModeOption<Value extends string> {
  value: Value;
  label: string;
  icon: ReactNode;
  disabled?: boolean | undefined;
  title?: string | undefined;
}

export interface ViewModeSwitchProps<Value extends string> {
  label: string;
  value: Value;
  options: readonly ViewModeOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
  collapseLabels?: boolean;
}

/** Controlled view selection with one keyboard stop and disabled-aware navigation. */
export function ViewModeSwitch<Value extends string>({
  label, value, options, onChange, className, collapseLabels = true,
}: ViewModeSwitchProps<Value>) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  const enabled = options.filter(option => !option.disabled);
  const tabStop = enabled.some(option => option.value === value) ? value : enabled[0]?.value;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: Value) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !enabled.length) return;
    event.preventDefault();
    const index = enabled.findIndex(option => option.value === current);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? enabled.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[nextIndex]!;
    buttons.current.get(next.value)?.focus();
    onChange(next.value);
  }

  return (
    <div className={joinClassNames(styles.switch, className)} role="tablist" aria-label={label}
      data-view-mode-switch="true" data-collapse-labels={collapseLabels}>
      {options.map(option => (
        <button key={option.value} type="button" role="tab" className={styles.option}
          aria-label={option.label} aria-selected={value === option.value}
          disabled={option.disabled} title={option.title ?? option.label}
          tabIndex={tabStop === option.value ? 0 : -1}
          ref={node => { if (node) buttons.current.set(option.value, node); else buttons.current.delete(option.value); }}
          onClick={() => onChange(option.value)} onKeyDown={event => navigate(event, option.value)}>
          <span className={styles.icon} aria-hidden="true">{option.icon}</span>
          <span className={styles.label}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
