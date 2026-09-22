import type { MouseEvent } from 'react';

type EllipsisTitleTarget = HTMLElement & { title: string };

function syncEllipsisTitle(target: EllipsisTitleTarget, fullText: string): void {
  const isTruncated = target.scrollWidth > target.clientWidth + 1;
  if (isTruncated) target.title = fullText;
  else target.removeAttribute('title');
}

export function ellipsisTitleHoverProps(fullText: string) {
  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      syncEllipsisTitle(event.currentTarget as EllipsisTitleTarget, fullText);
    },
  };
}
