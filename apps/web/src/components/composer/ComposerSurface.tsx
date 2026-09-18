import type { ComponentPropsWithoutRef } from 'react';

type SurfacePartProps = ComponentPropsWithoutRef<'div'>;

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export interface ComposerSurfaceProps extends SurfacePartProps {
  variant: 'home' | 'project';
}

/**
 * Shared composer frame used by both the Home and project chat surfaces.
 * Product-specific state and actions stay with their hosts; the visible
 * gray tray / white editor structure has one owner here.
 */
export function ComposerSurface({ variant, className, ...props }: ComposerSurfaceProps) {
  return (
    <div
      {...props}
      className={classes(
        'home-hero__composer-card',
        `composer-surface--${variant}`,
        className,
      )}
      data-composer-surface={variant}
    />
  );
}

export function ComposerSurfaceOutside({ className, ...props }: SurfacePartProps) {
  return (
    <div
      {...props}
      className={classes('home-hero__outside-contexts', 'staged-row', className)}
      data-composer-surface-part="outside"
    />
  );
}

export function ComposerSurfaceInput({ className, ...props }: SurfacePartProps) {
  return (
    <div
      {...props}
      className={classes('home-hero__input-card', className)}
      data-composer-surface-part="input"
    />
  );
}

export function ComposerSurfaceInside({ className, ...props }: SurfacePartProps) {
  return (
    <div
      {...props}
      className={classes('home-hero__active', className)}
      data-composer-surface-part="inside"
    />
  );
}

export function ComposerSurfaceEditor({ className, ...props }: SurfacePartProps) {
  return (
    <div
      {...props}
      className={classes('home-hero__prompt-surface', className)}
      data-composer-surface-part="editor"
    />
  );
}

export function ComposerSurfaceFooter({ className, ...props }: SurfacePartProps) {
  return (
    <div
      {...props}
      className={classes('home-hero__input-foot', className)}
      data-composer-surface-part="footer"
    />
  );
}
