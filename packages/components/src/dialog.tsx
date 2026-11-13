import {
  useEffect,
  forwardRef,
  type ComponentPropsWithoutRef,
  type FormEventHandler,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { joinClassNames } from './class-names';
import styles from './dialog.module.css';
import './dialog-chrome.css';

type DialogTag = 'div' | 'form';

export type DialogLayout = 'default' | 'sectioned' | 'scrollable';

export interface DialogProps {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  backdropClassName?: string;
  includeChromeClassName?: boolean;
  id?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  layout?: DialogLayout;
  /** Preview workspaces retain their internal content geometry. */
  appearance?: 'standard' | 'workspace';
  as?: DialogTag;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  [key: `data-${string}`]: string | number | undefined;
}

type DialogSectionProps = ComponentPropsWithoutRef<'div'>;

type DialogHeadingProps = ComponentPropsWithoutRef<'h2'>;

type DialogDescriptionProps = ComponentPropsWithoutRef<'p'>;

export function Dialog({
  children,
  onClose,
  className,
  backdropClassName,
  includeChromeClassName = true,
  id,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  closeOnBackdrop = true,
  closeOnEscape = false,
  layout = 'scrollable',
  appearance = 'standard',
  as = 'div',
  onSubmit,
  ...dataAttributes
}: DialogProps) {
  useEffect(() => {
    if (!onClose || !closeOnEscape) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose?.();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, onClose]);

  const sharedProps = {
    id,
    className: joinClassNames(
      includeChromeClassName ? styles.dialog : undefined,
      includeChromeClassName && layout === 'sectioned' ? styles.dialogSectioned : undefined,
      layout === 'scrollable' ? styles.dialogScrollable : undefined,
      includeChromeClassName ? 'modal' : undefined,
      className,
    ),
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    role,
    'aria-modal': 'true' as const,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'data-dialog-surface': appearance,
    ...dataAttributes,
  };

  return (
    <div
      className={joinClassNames(
        includeChromeClassName ? styles.backdrop : undefined,
        includeChromeClassName ? 'modal-backdrop' : undefined,
        backdropClassName,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
      data-dialog-backdrop=""
    >
      {as === 'form' ? (
        <form {...sharedProps} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div {...sharedProps}>{children}</div>
      )}
    </div>
  );
}

export function DialogHeader({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.header, className)} data-dialog-part="header" {...props} />;
}

export const DialogBody = forwardRef<HTMLDivElement, DialogSectionProps>(function DialogBody(
  { className, ...props }, ref,
) {
  return <div ref={ref} className={joinClassNames(styles.body, className)} data-dialog-part="body" {...props} />;
});

/** Fixed controls between the header and the scrollport, with a 4px safety gap. */
export function DialogToolbar({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.toolbar, className)} data-dialog-part="toolbar"
    data-dialog-tabs={props.role === 'tablist' ? '' : undefined} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.footer, className)} data-dialog-part="footer" {...props} />;
}

export function DialogTitle({ className, ...props }: DialogHeadingProps) {
  return <h2 className={joinClassNames(styles.title, className)} data-dialog-part="title" {...props} />;
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <p className={joinClassNames(styles.description, className)} data-dialog-part="description" {...props} />;
}
