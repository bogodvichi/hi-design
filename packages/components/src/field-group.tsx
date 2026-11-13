import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { joinClassNames } from './class-names';
import styles from './field-group.module.css';

export interface FieldGroupProps extends ComponentPropsWithoutRef<'fieldset'> {
  label: ReactNode;
}

/** A normal, left-aligned field label with native grouping and disabled semantics. */
export function FieldGroup({ label, className, children, ...props }: FieldGroupProps) {
  return (
    <fieldset className={joinClassNames(styles.field, className)} {...props}>
      <legend className={styles.label}>{label}</legend>
      {children}
    </fieldset>
  );
}
