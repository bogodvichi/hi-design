import { Fragment } from 'react';
import type { WorkspaceContextItem } from '@open-design/contracts';

import { Icon, type IconName } from '../Icon';
import { mentionTokenPresent } from '../../utils/inlineMentions';

function classes(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

export interface ComposerContextChipItem {
  key: string;
  order?: number;
  icon: IconName;
  label: string;
  kind?: 'skill' | 'mcp' | 'plugin' | 'connector' | 'workspace';
  className?: string;
  title?: string;
  openTitle?: string;
  onOpen?: () => void;
  onRemove?: () => void;
  removeLabel: string;
  testId?: string;
}

export interface ComposerAttachmentChipItem {
  key: string;
  name: string;
  kind: string;
  order?: number;
  title?: string;
  previewTitle?: string;
  previewUrl?: string | null;
  previewLabel?: string;
  onPreview?: () => void;
  onRemove: () => void;
  removeLabel: string;
  testId?: string;
}

export function composerWorkspaceContextLabel(item: WorkspaceContextItem): string {
  if (item.label?.trim()) return item.label.trim();
  if (item.title?.trim()) return item.title.trim();
  const path = item.path || item.absolutePath;
  if (path) {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').filter(Boolean).pop() || path;
  }
  return item.id;
}

export function composerWorkspaceContextIcon(item: WorkspaceContextItem): IconName {
  if (item.kind === 'browser') return 'globe';
  if (item.kind === 'local-code' || item.kind === 'terminal') return 'terminal';
  if (item.kind === 'side-chat') return 'comment';
  if (item.kind === 'design-system') return 'blocks';
  if (item.kind === 'folder' || item.kind === 'design-files' || item.kind === 'project') return 'folder';
  return 'file';
}

export function composerWorkspaceContextTitle(item: WorkspaceContextItem): string {
  return [
    item.path ? `path: ${item.path}` : null,
    item.absolutePath ? `absolute: ${item.absolutePath}` : null,
    item.url ? `url: ${item.url}` : null,
    item.title ? `title: ${item.title}` : null,
  ].filter(Boolean).join(' | ') || composerWorkspaceContextLabel(item);
}

export function ComposerContextChip({ item }: { item: ComposerContextChipItem }) {
  const content = (
    <>
      <span className="staged-icon" aria-hidden>
        <Icon name={item.icon} size={12} />
      </span>
      <span className="staged-name" title={item.title ?? item.label}>{item.label}</span>
    </>
  );

  return (
    <div
      className={classes(
        'staged-chip',
        'staged-context',
        item.kind && `staged-context--${item.kind}`,
        item.className,
      )}
      data-testid={item.testId}
    >
      {item.onOpen ? (
        <button
          type="button"
          className="staged-context-open"
          onClick={item.onOpen}
          aria-label={item.label}
          title={item.openTitle ?? item.title ?? item.label}
        >
          {content}
        </button>
      ) : content}
      {item.onRemove ? (
        <button
          type="button"
          className="staged-remove od-tooltip"
          onClick={item.onRemove}
          aria-label={item.removeLabel}
          title={item.removeLabel}
          data-tooltip={item.removeLabel}
        >
          <Icon name="close" size={11} />
        </button>
      ) : null}
    </div>
  );
}

function ComposerAttachmentChip({
  item,
  displayOrder,
}: {
  item: ComposerAttachmentChipItem;
  displayOrder: number;
}) {
  const canPreview = Boolean(item.previewUrl && item.onPreview);
  return (
    <div
      className={classes(
        'staged-chip',
        `staged-${item.kind}`,
        canPreview && 'staged-chip--image-file',
      )}
      data-testid={item.testId}
    >
      <span className="staged-order" aria-label={`Attachment ${displayOrder}`}>
        {displayOrder}
      </span>
      {canPreview ? (
        <button
          type="button"
          className="staged-preview-trigger"
          onClick={item.onPreview}
          title={item.previewTitle ?? item.name}
          aria-label={item.previewLabel ?? `Preview ${item.name}`}
        >
          <img src={item.previewUrl!} alt="" aria-hidden />
        </button>
      ) : (
        <>
          <span className="staged-icon" aria-hidden>
            <Icon name="file" size={13} />
          </span>
          <span className="staged-name" title={item.title ?? item.name}>{item.name}</span>
        </>
      )}
      <button
        type="button"
        className="staged-remove od-tooltip"
        onClick={item.onRemove}
        aria-label={item.removeLabel}
        title={item.removeLabel}
        data-tooltip={item.removeLabel}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}

function orderedAttachments(items: ComposerAttachmentChipItem[]): ComposerAttachmentChipItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.item.order) ? a.item.order! : a.index;
      const bOrder = Number.isFinite(b.item.order) ? b.item.order! : b.index;
      return aOrder === bOrder ? a.index - b.index : aOrder - bOrder;
    })
    .map(({ item }) => item);
}

/**
 * All resource kinds share selection order; attachment numbering stays local
 * to attachments and does not determine their position in the resource row.
 */
export function ComposerOutsideContextList({
  attachments = [],
  plugins = [],
  resources = [],
  connectors = [],
  workspaces = [],
  additional = [],
}: {
  attachments?: ComposerAttachmentChipItem[];
  plugins?: ComposerContextChipItem[];
  resources?: ComposerContextChipItem[];
  connectors?: ComposerContextChipItem[];
  workspaces?: ComposerContextChipItem[];
  additional?: ComposerContextChipItem[];
}) {
  const items = [
    ...orderedAttachments(attachments).map((item, index) => ({
      key: `attachment:${item.key}`,
      order: item.order,
      content: <ComposerAttachmentChip item={item} displayOrder={index + 1} />,
    })),
    ...[...plugins, ...resources, ...connectors, ...workspaces, ...additional].map((item) => ({
      key: item.key,
      order: item.order,
      content: <ComposerContextChip item={item} />,
    })),
  ].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  return <>{items.map((item) => <Fragment key={item.key}>{item.content}</Fragment>)}</>;
}

/** A selected resource is shown once: in the editor when mentioned, otherwise above it. */
export function composerChipsOutsidePrompt(
  items: Array<ComposerContextChipItem & { mentionLabels: string[] }>,
  prompt: string,
): ComposerContextChipItem[] {
  return items.filter((item) => !item.mentionLabels.some((label) => mentionTokenPresent(prompt, label)));
}
