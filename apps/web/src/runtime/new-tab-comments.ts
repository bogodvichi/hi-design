import type {
  PreviewAnnotationStyle,
  PreviewComment,
  PreviewCommentStatus,
  PreviewCommentTarget,
} from '@open-design/contracts';
import { avatarColorForDisplayName } from '../utils/avatarColor';

export const NEW_TAB_COMMENT_CHANNEL_PREFIX = 'hi-design:new-tab-comments:';

const MAX_NOTE_LENGTH = 20_000;
const MAX_ID_LENGTH = 512;
const MAX_SELECTOR_LENGTH = 4_096;
const MAX_LABEL_LENGTH = 512;
const MAX_TEXT_LENGTH = 4_000;
const MAX_HTML_HINT_LENGTH = 8_000;
const MAX_AVATAR_URL_LENGTH = 65_536;
const MAX_STYLE_VALUE_LENGTH = 512;
const MAX_POSITION_ABS = 1_000_000;
const MAX_POSITION_EXTENT = 1_000_000;
const MAX_REQUEST_ID_LENGTH = 256;

const STYLE_KEYS: Array<keyof PreviewAnnotationStyle> = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'fontFamily',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
];

export interface NewTabCommentLabels {
  comments: string;
  comment: string;
  placeholder: string;
  empty: string;
  showResolved: string;
  unresolved: string;
  searchPlaceholder: string;
  sortAndFilter: string;
  sortNewest: string;
  sortOldest: string;
  filterOpen: string;
  filterResolved: string;
  filterMentioned: string;
  nComments: string;
  resolved: string;
  markResolved: string;
  reopen: string;
  deleteComment: string;
  deleteReply: string;
  reply: string;
  nReplies: string;
  saved: string;
  sending: string;
  failed: string;
  close: string;
  cancel: string;
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
}

export interface NewTabCommentSnapshot {
  id: string;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewCommentTarget['position'];
  htmlHint: string;
  style?: PreviewAnnotationStyle;
  selectionKind?: PreviewCommentTarget['selectionKind'];
  slideIndex?: number;
  note: string;
  status: PreviewCommentStatus;
  createdAt: number;
  updatedAt: number;
  pinSeq?: number;
  parentId?: string;
  rootCommentId?: string;
  authorMemberId?: string;
  authorDisplayName?: string;
  authorAvatarUrl?: string;
  authorAvatarColor?: string;
}

export interface NewTabCommentAuthor {
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface NewTabCommentSession {
  token: string;
  channelName: string;
  filePath: string;
  isClosed(): boolean;
  updateSnapshot(comments: readonly PreviewComment[]): void;
  close(): void;
}

export interface NewTabCommentSessionOptions {
  filePath: string;
  comments: readonly PreviewComment[];
  onSave?: (
    target: PreviewCommentTarget,
    note: string,
  ) => Promise<PreviewComment | null>;
  onReply?: (
    comment: PreviewComment,
    note: string,
  ) => Promise<PreviewComment | null | void> | PreviewComment | null | void;
  onRemove?: (commentId: string) => Promise<boolean> | boolean;
  onChangeStatus?: (
    commentId: string,
    status: PreviewCommentStatus,
  ) => Promise<void> | void;
  resolveAuthor?: (
    memberId: string | null | undefined,
  ) => NewTabCommentAuthor | null;
  onClosed?: () => void;
  channelFactory?: (name: string) => BroadcastChannel;
  expectedOrigin?: string;
  readyTimeoutMs?: number;
}

export interface NewTabCommentWrapperOptions {
  token: string;
  channelName: string;
  filePath: string;
  labels: NewTabCommentLabels;
  currentMemberId?: string | null;
  allowModals?: boolean;
}

interface ChannelMessage {
  type?: unknown;
  token?: unknown;
  channel?: unknown;
  origin?: unknown;
  requestId?: unknown;
  [key: string]: unknown;
}

interface NewTabCommentCapabilities {
  canCreate: boolean;
  canReply: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;
}

function expectedWindowOrigin(explicit?: string): string {
  if (typeof explicit === 'string' && explicit) return explicit;
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
    return window.location.origin;
  }
  return 'null';
}

function absoluteAssetUrl(value: string, baseUrl: string): string {
  if (!value || !baseUrl || baseUrl === 'null') return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function createRandomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(
  value: unknown,
  maxLength: number,
  options: { trim?: boolean; allowEmpty?: boolean } = {},
): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  const clean = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && clean.length === 0) return null;
  return clean;
}

function cleanFiniteNumber(
  value: unknown,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (options.integer && !Number.isInteger(value)) return null;
  if (options.min !== undefined && value < options.min) return null;
  if (options.max !== undefined && value > options.max) return null;
  return value;
}

function cleanPosition(value: unknown): PreviewCommentTarget['position'] | null {
  if (!isRecord(value)) return null;
  const x = cleanFiniteNumber(value.x, { min: -MAX_POSITION_ABS, max: MAX_POSITION_ABS });
  const y = cleanFiniteNumber(value.y, { min: -MAX_POSITION_ABS, max: MAX_POSITION_ABS });
  const width = cleanFiniteNumber(value.width, { min: 0, max: MAX_POSITION_EXTENT });
  const height = cleanFiniteNumber(value.height, { min: 0, max: MAX_POSITION_EXTENT });
  if (x === null || y === null || width === null || height === null) return null;
  const position: PreviewCommentTarget['position'] = { x, y, width, height };
  if (value.mx !== undefined || value.my !== undefined) {
    const mx = cleanFiniteNumber(value.mx, { min: -MAX_POSITION_ABS, max: MAX_POSITION_ABS });
    const my = cleanFiniteNumber(value.my, { min: -MAX_POSITION_ABS, max: MAX_POSITION_ABS });
    if (mx === null || my === null) return null;
    position.mx = mx;
    position.my = my;
  }
  return position;
}

function cleanStyle(value: unknown): PreviewAnnotationStyle | undefined {
  if (!isRecord(value)) return undefined;
  const style: PreviewAnnotationStyle = {};
  let hasValue = false;
  for (const key of STYLE_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    const clean = cleanString(raw, MAX_STYLE_VALUE_LENGTH, {
      trim: false,
      allowEmpty: true,
    });
    if (clean === null) return undefined;
    style[key] = clean;
    hasValue = true;
  }
  return hasValue ? style : undefined;
}

export function isNewTabCommentStatus(value: unknown): value is PreviewCommentStatus {
  return value === 'open'
    || value === 'attached'
    || value === 'applying'
    || value === 'needs_review'
    || value === 'resolved'
    || value === 'failed';
}

export function normalizeNewTabCommentTarget(
  value: unknown,
  filePath: string,
): PreviewCommentTarget | null {
  if (!isRecord(value)) return null;
  const elementId = cleanString(value.elementId, MAX_ID_LENGTH);
  const selector = cleanString(value.selector, MAX_SELECTOR_LENGTH);
  const label = cleanString(value.label, MAX_LABEL_LENGTH, { allowEmpty: true });
  const text = cleanString(value.text, MAX_TEXT_LENGTH, { allowEmpty: true });
  const htmlHint = cleanString(value.htmlHint, MAX_HTML_HINT_LENGTH, { allowEmpty: true });
  const position = cleanPosition(value.position);
  if (
    elementId === null
    || selector === null
    || label === null
    || text === null
    || htmlHint === null
    || position === null
  ) {
    return null;
  }
  const target: PreviewCommentTarget = {
    filePath,
    elementId,
    selector,
    label,
    text,
    position,
    htmlHint,
  };
  const style = cleanStyle(value.style);
  if (style) target.style = style;
  if (value.selectionKind === 'element' || value.selectionKind === 'pod') {
    target.selectionKind = value.selectionKind;
  }
  if (value.slideIndex !== undefined) {
    const slideIndex = cleanFiniteNumber(value.slideIndex, {
      min: 0,
      max: 100_000,
      integer: true,
    });
    if (slideIndex === null) return null;
    target.slideIndex = slideIndex;
  }
  return target;
}

function snapshotComment(
  comment: PreviewComment,
  filePath: string,
  resolveAuthor?: NewTabCommentSessionOptions['resolveAuthor'],
  origin?: string,
): NewTabCommentSnapshot {
  const snapshot: NewTabCommentSnapshot = {
    id: comment.id,
    filePath,
    elementId: comment.elementId,
    selector: comment.selector,
    label: comment.label,
    text: comment.text,
    position: { ...comment.position },
    htmlHint: comment.htmlHint,
    note: comment.note,
    status: comment.status,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
  if (comment.style) snapshot.style = { ...comment.style };
  if (comment.selectionKind) snapshot.selectionKind = comment.selectionKind;
  if (typeof comment.slideIndex === 'number') snapshot.slideIndex = comment.slideIndex;
  if (typeof comment.pinSeq === 'number') snapshot.pinSeq = comment.pinSeq;
  if (comment.parentId) snapshot.parentId = comment.parentId;
  if (comment.rootCommentId) snapshot.rootCommentId = comment.rootCommentId;
  if (comment.authorMemberId) snapshot.authorMemberId = comment.authorMemberId;
  const author = resolveAuthor?.(comment.authorMemberId) ?? null;
  const authorDisplayName =
    comment.authorDisplayName?.trim()
    || author?.displayName?.trim()
    || '';
  if (authorDisplayName) {
    snapshot.authorDisplayName = authorDisplayName;
    snapshot.authorAvatarColor = avatarColorForDisplayName(authorDisplayName);
  }
  const authorAvatarUrl = absoluteAssetUrl(
    comment.authorAvatarUrl?.trim()
    || author?.avatarUrl?.trim()
    || '',
    origin || '',
  );
  if (authorAvatarUrl) snapshot.authorAvatarUrl = authorAvatarUrl;
  return snapshot;
}

function commentsForFile(
  comments: readonly PreviewComment[],
  filePath: string,
): PreviewComment[] {
  return comments.filter((comment) => comment.filePath === filePath);
}

function resultCommentForFile(
  value: PreviewComment | null | void,
  filePath: string,
): PreviewComment | null {
  if (!value || value.filePath !== filePath) return null;
  return value;
}

function removeCommentSubtree(comments: PreviewComment[], commentId: string): PreviewComment[] {
  const removed = new Set([commentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of comments) {
      if (
        !removed.has(comment.id)
        && (
          (comment.parentId && removed.has(comment.parentId))
          || (comment.rootCommentId && removed.has(comment.rootCommentId))
        )
      ) {
        removed.add(comment.id);
        changed = true;
      }
    }
  }
  return comments.filter((comment) => !removed.has(comment.id));
}

function upsertComment(comments: PreviewComment[], comment: PreviewComment): PreviewComment[] {
  const index = comments.findIndex((candidate) => candidate.id === comment.id);
  if (index === -1) return [...comments, comment];
  const next = [...comments];
  next[index] = comment;
  return next;
}

export function createNewTabCommentSession(
  options: NewTabCommentSessionOptions,
): NewTabCommentSession {
  const token = createRandomToken();
  const channelName = `${NEW_TAB_COMMENT_CHANNEL_PREFIX}${token}`;
  const origin = expectedWindowOrigin(options.expectedOrigin);
  const channelFactory = options.channelFactory ?? ((name: string) => new BroadcastChannel(name));
  const channel = channelFactory(channelName);
  let comments = commentsForFile(options.comments, options.filePath);
  let closed = false;
  let ready = false;
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  const capabilities: NewTabCommentCapabilities = {
    canCreate: Boolean(options.onSave),
    canReply: Boolean(options.onReply),
    canDelete: Boolean(options.onRemove),
    canChangeStatus: Boolean(options.onChangeStatus),
  };

  const post = (message: Record<string, unknown>): void => {
    if (closed) return;
    try {
      channel.postMessage({
        token,
        channel: channelName,
        origin,
        ...message,
      });
    } catch {
      // A tab that closed between the host state change and this post is not
      // actionable. Its BroadcastChannel teardown arrives separately.
    }
  };

  const postSnapshot = (): void => {
    post({
      type: 'comments-snapshot',
      comments: comments.map((comment) => snapshotComment(
        comment,
        options.filePath,
        options.resolveAuthor,
        origin,
      )),
      capabilities,
    });
  };

  const operationResult = (
    requestId: string,
    ok: boolean,
    payload: Record<string, unknown> = {},
  ): void => {
    post({
      type: 'operation-result',
      requestId,
      ok,
      ...payload,
    });
  };

  const close = (): void => {
    if (closed) return;
    post({ type: 'closed' });
    closed = true;
    for (const timer of pendingTimeouts) clearTimeout(timer);
    pendingTimeouts.clear();
    channel.removeEventListener('message', handleMessage);
    channel.close();
    options.onClosed?.();
  };

  const readyTimer = setTimeout(() => {
    if (!ready) close();
  }, options.readyTimeoutMs ?? 120_000);
  pendingTimeouts.add(readyTimer);

  const materializeOperationComment = (comment: PreviewComment): void => {
    comments = upsertComment(comments, comment);
    postSnapshot();
  };

  async function handleOperation(message: ChannelMessage): Promise<void> {
    const requestId = cleanString(message.requestId, MAX_REQUEST_ID_LENGTH);
    if (requestId === null) return;
    const commentId = cleanString(message.commentId, MAX_ID_LENGTH);
    const existing = commentId
      ? comments.find((comment) => comment.id === commentId) ?? null
      : null;
    const noteValue = cleanString(message.note, MAX_NOTE_LENGTH);

    try {
      if (message.type === 'save-comment') {
        if (!options.onSave) {
          operationResult(requestId, false, { error: 'unavailable' });
          return;
        }
        const target = normalizeNewTabCommentTarget(message.target, options.filePath);
        if (!target || noteValue === null) {
          operationResult(requestId, false, { error: 'invalid_request' });
          return;
        }
        const saved = await options.onSave(target, noteValue);
        if (!saved || saved.filePath !== options.filePath) {
          operationResult(requestId, false, { error: 'save_failed' });
          return;
        }
        materializeOperationComment(saved);
        operationResult(requestId, true, {
          comment: snapshotComment(
            saved,
            options.filePath,
            options.resolveAuthor,
            origin,
          ),
        });
        return;
      }

      if (message.type === 'reply-comment') {
        if (!options.onReply) {
          operationResult(requestId, false, { error: 'unavailable' });
          return;
        }
        if (!existing || noteValue === null) {
          operationResult(requestId, false, { error: 'invalid_request' });
          return;
        }
        const reply = await options.onReply(existing, noteValue);
        const replyComment = resultCommentForFile(reply, options.filePath);
        if (replyComment) materializeOperationComment(replyComment);
        operationResult(requestId, true, replyComment
          ? {
              comment: snapshotComment(
                replyComment,
                options.filePath,
                options.resolveAuthor,
                origin,
              ),
            }
          : {});
        return;
      }

      if (message.type === 'remove-comment') {
        if (!options.onRemove) {
          operationResult(requestId, false, { error: 'unavailable' });
          return;
        }
        if (!existing) {
          operationResult(requestId, false, { error: 'invalid_request' });
          return;
        }
        const removed = await options.onRemove(existing.id);
        if (!removed) {
          operationResult(requestId, false, { error: 'remove_failed' });
          return;
        }
        comments = removeCommentSubtree(comments, existing.id);
        postSnapshot();
        operationResult(requestId, true, { commentId: existing.id });
        return;
      }

      if (message.type === 'change-comment-status') {
        if (!options.onChangeStatus) {
          operationResult(requestId, false, { error: 'unavailable' });
          return;
        }
        const status = message.status;
        if (
          !existing
          || (status !== 'open' && status !== 'resolved')
        ) {
          operationResult(requestId, false, { error: 'invalid_request' });
          return;
        }
        const nextStatus: PreviewCommentStatus = status;
        await options.onChangeStatus(existing.id, nextStatus);
        const updated: PreviewComment = {
          ...existing,
          status: nextStatus,
          updatedAt: Date.now(),
        };
        comments = upsertComment(comments, updated);
        postSnapshot();
        operationResult(requestId, true, {
          comment: snapshotComment(
            updated,
            options.filePath,
            options.resolveAuthor,
            origin,
          ),
        });
        return;
      }
    } catch {
      operationResult(requestId, false, { error: 'operation_failed' });
    }
  }

  function handleMessage(event: MessageEvent): void {
    if (closed) return;
    if (event.origin && event.origin !== origin) return;
    const data = event.data as ChannelMessage | null;
    if (
      !isRecord(data)
      || data.token !== token
      || data.channel !== channelName
      || data.origin !== origin
      || typeof data.type !== 'string'
    ) {
      return;
    }
    if (data.type === 'ready') {
      ready = true;
      clearTimeout(readyTimer);
      pendingTimeouts.delete(readyTimer);
      post({ type: 'ready-ack' });
      postSnapshot();
      return;
    }
    if (data.type === 'closed') {
      close();
      return;
    }
    if (
      data.type === 'save-comment'
      || data.type === 'reply-comment'
      || data.type === 'remove-comment'
      || data.type === 'change-comment-status'
    ) {
      void handleOperation(data);
    }
  }

  channel.addEventListener('message', handleMessage);

  return {
    token,
    channelName,
    filePath: options.filePath,
    isClosed: () => closed,
    updateSnapshot(nextComments: readonly PreviewComment[]) {
      if (closed) return;
      comments = commentsForFile(nextComments, options.filePath);
      if (ready) postSnapshot();
    },
    close,
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildNewTabCommentsPreviewDocument(
  doc: string,
  title: string,
  options: NewTabCommentWrapperOptions,
): string {
  const safeTitle = escapeHtmlAttribute(title || 'Preview');
  const sandbox = options.allowModals ? 'allow-scripts allow-modals' : 'allow-scripts';
  const config = safeJson({
    token: options.token,
    channelName: options.channelName,
    filePath: options.filePath,
    labels: options.labels,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #fff;
      --bg-panel: #fbfbfa;
      --bg-subtle: #f1f1ef;
      --border: #dededb;
      --border-soft: #ececea;
      --border-strong: #c9c9c5;
      --text: #353535;
      --text-muted: #666;
      --text-faint: #929292;
      --accent: #353535;
      --accent-contrast: #fff;
      --comment-accent: #ff5a3c;
      --danger: #f04142;
      --danger-bg: #fff0f0;
      --radius-xs: 2px;
      --radius-sm: 4px;
      --radius: 8px;
      --radius-pill: 999px;
      --glass-regular: rgb(255 255 255 / 94%);
      --glass-backdrop: blur(18px) saturate(1.15);
      --shadow-lg: 0 18px 50px rgb(24 20 17 / 18%), 0 4px 12px rgb(24 20 17 / 8%);
    }
    * { box-sizing:border-box; }
    html,body { margin:0; width:100%; height:100%; overflow:hidden; color:var(--text); font:13px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f5f4f2; }
    button,textarea { font:inherit; color:inherit; }
    .app,.stage { position:relative; width:100%; height:100%; overflow:hidden; }
    iframe { display:block; width:100%; height:100%; border:0; background:#fff; }
    .toolbar { position:absolute; z-index:20; top:12px; right:12px; display:flex; align-items:center; gap:8px; }
    .toolbar button { display:inline-flex; align-items:center; min-height:32px; padding:5px 10px; border:1px solid var(--border); border-radius:6px; background: rgb(255 255 255 / 95%); box-shadow:0 2px 10px rgb(15 23 42 / 10%); cursor:pointer; }
    .toolbar button:hover { border-color:var(--border-strong); background:#fff; }
    .toolbar button[aria-pressed="true"] { border-color:#93b4f7; background:#eef4ff; color:#1e4fae; }
    .toolbar .badge { display:inline-flex; min-width:18px; height:18px; margin-left:6px; align-items:center; justify-content:center; border-radius:9px; background:#e5e9f0; color:#4a5568; font-size:11px; }
    .toolbar svg { width:14px; height:14px; margin-right:5px; }
    .status { position:absolute; z-index:21; top:54px; right:12px; max-width:min(320px,calc(100% - 24px)); padding:6px 9px; border-radius:var(--radius-sm); background:rgb(255 255 255 / 95%); box-shadow:0 4px 16px rgb(15 23 42 / 12%); font-size:12px; }
    .status:empty { display:none; }
    button:disabled { cursor:not-allowed; opacity:.55; }
    .comment-overlay-layer { position:absolute; z-index:15; inset:0; pointer-events:none; }
    .comment-saved-markers { position:absolute; inset:0; }
    .comment-saved-pin {
      position:absolute;
      z-index:2;
      width:42px;
      height:42px;
      padding:0;
      border:3px solid #fff;
      border-radius:50%;
      color:#fff;
      font-size:18px;
      font-weight:700;
      line-height:36px;
      text-align:center;
      overflow:hidden;
      box-shadow:0 10px 22px rgb(33 24 18 / 22%);
      pointer-events:auto;
      cursor:pointer;
      transform:translate(-50%,-50%);
      transition:filter 120ms ease,transform 120ms ease;
    }
    .comment-saved-pin:hover { filter:brightness(.9); transform:translate(-50%,calc(-50% - 1px)); }
    .comment-saved-pin:active { transform:translate(-50%,-50%); }
    .comment-saved-pin[data-active="true"] { border-color:var(--comment-accent); }
    .comment-saved-pin[data-status="resolved"] { filter:saturate(.45); opacity:.78; }
    .comment-saved-pin > span { display:inline-flex; align-items:center; justify-content:center; width:100%; height:100%; }
    .comment-user-avatar-image { position:absolute; inset:0; width:100%; height:100%; display:block; object-fit:cover; }
    .hover-box { position:absolute; z-index:14; display:none; border:1px dashed #1677ff; background:transparent; pointer-events:none; }
    .hover-box.selected { border-width:2px; }
    .hover-label { position:absolute; left:0; bottom:100%; max-width:260px; padding:2px 6px; overflow:hidden; border-radius:4px 4px 0 0; background:#1677ff; color:#fff; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
    .comment-popover {
      position:absolute;
      z-index:40;
      display:flex;
      width:min(320px,calc(100% - 28px));
      max-height:calc(100% - 28px);
      flex-direction:column;
      overflow:hidden;
      padding:10px;
      border:1px solid var(--border);
      border-radius:var(--radius);
      background:var(--glass-regular);
      -webkit-backdrop-filter:var(--glass-backdrop);
      backdrop-filter:var(--glass-backdrop);
      box-shadow:var(--shadow-lg);
    }
    .comment-popover[hidden] { display:none; }
    .comment-popover-composer-wrap { display:flex; flex:1 1 auto; min-height:0; flex-direction:column; overflow-y:auto; }
    .comment-popover-body { flex:1 1 auto; min-height:0; overflow:auto; }
    .comment-popover-titlebar { display:flex; flex:0 0 auto; align-items:center; gap:8px; min-height:24px; margin:-2px 28px 8px 0; }
    .comment-popover-drag-handle { display:inline-flex; width:22px; height:24px; flex:0 0 auto; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:grab; touch-action:none; }
    .comment-popover-drag-handle:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-drag-handle span { width:12px; height:16px; background-image:radial-gradient(currentColor 1.3px,transparent 1.4px); background-position:0 0; background-size:6px 5px; }
    .comment-popover-dragging .comment-popover-drag-handle { cursor:grabbing; }
    .comment-popover-title { min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:650; }
    .comment-popover-existing-actions { display:inline-flex; flex:0 0 auto; align-items:center; gap:3px; }
    .comment-popover-header-action,.comment-popover-close-btn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:0; border-radius:var(--radius-xs); background:transparent; color:var(--text-muted); cursor:pointer; }
    .comment-popover-header-action:hover,.comment-popover-close-btn:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-header-action.danger:hover { background:var(--danger-bg); color:var(--danger); }
    .comment-popover-close-btn { position:absolute; top:10px; right:6px; z-index:10; }
    .comment-popover-section { min-width:0; }
    .comment-popover-section-params { display:grid; gap:8px; }
    .comment-popover-meta-line { display:flex; min-width:0; align-items:center; gap:8px; }
    .comment-popover-meta-avatar,.comment-popover-reply-avatar { position:relative; display:inline-flex; flex:0 0 auto; align-items:center; justify-content:center; border-radius:50%; color:#fff; font-weight:600; overflow:hidden; }
    .comment-popover-meta-avatar { width:24px; height:24px; font-size:13px; }
    .comment-popover-reply-avatar { width:24px; height:24px; font-size:10px; }
    .comment-popover-meta-author,.comment-popover-reply-author { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); font-weight:600; }
    .comment-popover-meta-author { font-size:13px; }
    .comment-popover-reply-author { font-size:12px; }
    .comment-popover-meta-time,.comment-popover-reply-time { flex:0 0 auto; margin-left:2px; color:var(--text-faint); font-size:11px; white-space:nowrap; }
    .comment-popover-existing-note { min-width:0; padding:12px 8px 12px 32px; color:var(--text); font-size:13px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap; }
    .comment-popover-status { display:flex; justify-content:flex-end; padding:0 2px 4px; color:var(--text-muted); font-size:11px; }
    .comment-popover-replies { display:grid; gap:0; }
    .comment-popover-reply-item { position:relative; min-width:0; color:var(--text); font-size:12px; line-height:1.45; }
    .comment-popover-reply-meta { display:flex; min-width:0; align-items:center; gap:6px; margin-bottom:4px; padding-right:52px; }
    .comment-popover-reply-note { min-width:0; padding:0 8px 12px 32px; color:var(--text); overflow-wrap:anywhere; white-space:pre-wrap; }
    .comment-popover-reply-item-actions { position:absolute; top:0; right:0; display:inline-flex; align-items:center; gap:2px; opacity:0; transition:opacity 120ms ease; }
    .comment-popover-reply-item:hover .comment-popover-reply-item-actions,.comment-popover-reply-item:focus-within .comment-popover-reply-item-actions { opacity:1; }
    .comment-popover-reply-item-actions .icon-btn { display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-xs); background:transparent; color:var(--text-muted); cursor:pointer; }
    .comment-popover-reply-item-actions .icon-btn:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-reply-item-actions .icon-btn.danger:hover { background:var(--danger-bg); color:var(--danger); }
    .comment-popover-reply-bar { position:sticky; z-index:1; bottom:0; flex:0 0 auto; margin-top:6px; border:1px solid var(--border-soft); border-radius:var(--radius-sm); background:var(--bg-panel); }
    .comment-popover-reply-input-wrap { position:relative; min-width:0; }
    .comment-popover textarea { width:100%; min-height:66px; max-height:300px; resize:vertical; padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); outline:none; background:var(--bg); }
    textarea:focus { border-color:#a3a3a3; box-shadow:0 0 0 3px rgb(53 53 53 / 8%); }
    .comment-popover-reply-bar .comment-popover-reply-input { min-height:36px; padding:8px 44px 8px 9px; resize:none; border:0; background:transparent; }
    .comment-popover-reply-send { position:absolute; right:6px; bottom:6px; display:inline-flex; width:28px; height:28px; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-xs); background:var(--accent); color:var(--accent-contrast); cursor:pointer; }
    .comment-popover-reply-send:hover { opacity:.88; }
    .comment-popover-actions { display:flex; flex:0 0 auto; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:8px; padding:8px 0; }
    .comment-popover-actions button { min-height:30px; padding:4px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text); box-shadow:0 1px 2px rgb(15 23 42 / 5%); cursor:pointer; }
    .comment-popover-actions button:hover { border-color:var(--border-strong); background:var(--bg-subtle); }
    .comment-popover-actions button.primary { border-color:var(--accent); background:var(--accent); color:var(--accent-contrast); }
    .comment-popover-actions button.primary:hover { background:#202020; }
    .comment-popover button > svg { display:block; flex:0 0 auto; }
    @media (max-width:720px) {
      .comment-popover { width:calc(100% - 20px); max-height:calc(100% - 20px); }
      .comment-popover-reply-item-actions { opacity:1; }
      .toolbar { top:8px; right:8px; }
      .status { top:48px; right:8px; }
    }
  </style>
</head>
<body>
  <main class="app" id="app" data-comments-open="false">
    <section class="stage" aria-label="${safeTitle}">
      <iframe id="preview" title="${safeTitle}" sandbox="${sandbox}" srcdoc="${escapeHtmlAttribute(doc)}"></iframe>
      <div class="hover-box" id="hover-box"><div class="hover-label" id="hover-label"></div></div>
      <div class="pins" id="pins" hidden></div>
      <div class="toolbar">
        <button id="comments-toggle" type="button" aria-pressed="false">
          <span id="comments-toggle-label"></span><span class="badge" id="comments-count">0</span>
        </button>
      </div>
    </section>
    <aside class="panel" id="panel" aria-label="${safeTitle}">
      <div class="panel-inner">
        <header class="panel-head">
          <div class="panel-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
            <span id="panel-title"></span>
          </div>
          <button id="comments-close" type="button"></button>
        </header>
        <div class="panel-tools">
          <button id="resolved-toggle" type="button" aria-pressed="false"></button>
        </div>
        <div class="status" id="status" role="status" aria-live="polite"></div>
        <div class="list" id="list"></div>
      </div>
    </aside>
  </main>
  <script data-od-new-tab-comments>
  (function(){
    "use strict";
    var CONFIG = ${config};
    var app = document.getElementById("app");
    var frame = document.getElementById("preview");
    var pinsEl = document.getElementById("pins");
    var hoverBox = document.getElementById("hover-box");
    var hoverLabel = document.getElementById("hover-label");
    var listEl = document.getElementById("list");
    var statusEl = document.getElementById("status");
    var toggle = document.getElementById("comments-toggle");
    var toggleLabel = document.getElementById("comments-toggle-label");
    var countEl = document.getElementById("comments-count");
    var closeButton = document.getElementById("comments-close");
    var resolvedToggle = document.getElementById("resolved-toggle");
    var panelTitle = document.getElementById("panel-title");
    var comments = [];
    var liveTargets = Object.create(null);
    var commentMode = false;
    var showResolved = false;
    var connected = false;
    var activeCommentId = null;
    var replyFor = null;
    var currentTarget = null;
    var drafts = Object.create(null);
    var busy = Object.create(null);
    var pending = Object.create(null);
    var capabilities = { canCreate:false, canReply:false, canDelete:false, canChangeStatus:false };
    var channel = null;

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function cleanString(value, max) {
      return typeof value === "string" && value.length <= max ? value : "";
    }
    function finite(value) {
      return typeof value === "number" && Number.isFinite(value);
    }
    function safePosition(value) {
      if (!value || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) return null;
      if (Math.abs(value.x) > 1000000 || Math.abs(value.y) > 1000000 || value.width < 0 || value.height < 0 || value.width > 1000000 || value.height > 1000000) return null;
      var position = { x:value.x, y:value.y, width:value.width, height:value.height };
      if (finite(value.mx) && finite(value.my) && Math.abs(value.mx) <= 1000000 && Math.abs(value.my) <= 1000000) {
        position.mx = value.mx;
        position.my = value.my;
      }
      return position;
    }
    function safeStyle(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      var keys = ["color","backgroundColor","fontSize","fontWeight","lineHeight","textAlign","fontFamily","paddingTop","paddingRight","paddingBottom","paddingLeft","borderRadius"];
      var style = {};
      var hasValue = false;
      keys.forEach(function(key) {
        var raw = value[key];
        if (raw === undefined || raw === null) return;
        if (typeof raw !== "string" || raw.length > 512) return;
        style[key] = raw;
        hasValue = true;
      });
      return hasValue ? style : undefined;
    }
    function safeTarget(value) {
      if (!value) return null;
      var position = safePosition(value.position);
      var elementId = cleanString(value.elementId, 512);
      var selector = cleanString(value.selector, 4096);
      if (!position || !elementId || !selector) return null;
      return {
        filePath:CONFIG.filePath,
        elementId:elementId,
        selector:selector,
        label:cleanString(value.label, 512),
        text:cleanString(value.text, 4000),
        position:position,
        htmlHint:cleanString(value.htmlHint, 8000),
        style:safeStyle(value.style),
        selectionKind:value.selectionKind === "pod" ? "pod" : "element",
        slideIndex:typeof value.slideIndex === "number" && Number.isInteger(value.slideIndex) && value.slideIndex >= 0 ? value.slideIndex : undefined
      };
    }
    function safeStatus(value) {
      return value === "open"
        || value === "attached"
        || value === "applying"
        || value === "needs_review"
        || value === "resolved"
        || value === "failed"
        ? value
        : "open";
    }
    function safeComment(value) {
      if (!value || typeof value !== "object") return null;
      var position = safePosition(value.position);
      var id = cleanString(value.id, 512);
      if (!id || !position) return null;
      return {
        id:id,
        filePath:CONFIG.filePath,
        elementId:cleanString(value.elementId, 512),
        selector:cleanString(value.selector, 4096),
        label:cleanString(value.label, 512),
        text:cleanString(value.text, 4000),
        position:position,
        htmlHint:cleanString(value.htmlHint, 8000),
        note:cleanString(value.note, 20000),
        status:safeStatus(value.status),
        createdAt:finite(value.createdAt) ? value.createdAt : 0,
        updatedAt:finite(value.updatedAt) ? value.updatedAt : 0,
        pinSeq:typeof value.pinSeq === "number" && Number.isFinite(value.pinSeq) ? value.pinSeq : undefined,
        slideIndex:typeof value.slideIndex === "number" && Number.isInteger(value.slideIndex) && value.slideIndex >= 0 ? value.slideIndex : undefined,
        parentId:cleanString(value.parentId, 512) || undefined,
        rootCommentId:cleanString(value.rootCommentId, 512) || undefined,
        authorMemberId:cleanString(value.authorMemberId, 512) || undefined,
        authorDisplayName:cleanString(value.authorDisplayName, 512) || undefined,
        authorAvatarUrl:cleanString(value.authorAvatarUrl, 65536) || undefined,
        authorAvatarColor:cleanString(value.authorAvatarColor, 128) || undefined
      };
    }
    function postHost(type, payload) {
      if (!channel) return;
      var message = payload && typeof payload === "object" ? payload : {};
      message.type = type;
      message.token = CONFIG.token;
      message.channel = CONFIG.channelName;
      message.origin = location.origin;
      try { channel.postMessage(message); } catch (_) {}
    }
    function requestId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      } catch (_) {}
      return "ntc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }
    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.style.color = isError ? "#b42318" : "#067647";
    }
    function isUnresolved(comment) {
      return comment.status !== "resolved";
    }
    function rootId(comment) {
      return comment.rootCommentId || comment.id;
    }
    function repliesFor(comment) {
      return comments.filter(function(item) {
        return !!item.parentId && rootId(item) === comment.id;
      });
    }
    function threadIsVisible(comment) {
      return showResolved || isUnresolved(comment) || repliesFor(comment).some(isUnresolved);
    }
    function topLevel() {
      return comments.filter(function(comment) { return !comment.parentId; });
    }
    function unresolvedCount() {
      return comments.filter(function(comment) { return !comment.parentId && isUnresolved(comment); }).length;
    }
    function sendFrame(type, payload) {
      if (!frame.contentWindow) return;
      try { frame.contentWindow.postMessage(Object.assign({ type:type }, payload || {}), "*"); } catch (_) {}
    }
    function sendCommentMode() {
      sendFrame("od:comment-mode", { enabled:commentMode, mode:"picker" });
    }
    function activateTarget(target) {
      if (!target) return;
      sendFrame("od:comment-active-target", {
        elementId:target.elementId || null,
        selector:target.selector || ""
      });
    }
    function setCommentsOpen(open) {
      commentMode = open;
      app.setAttribute("data-comments-open", open ? "true" : "false");
      toggle.setAttribute("aria-pressed", open ? "true" : "false");
      pinsEl.hidden = !open;
      if (open) {
        activeCommentId = null;
        currentTarget = null;
        replyFor = null;
      } else {
        hoverBox.style.display = "none";
      }
      sendCommentMode();
      render();
    }
    function upsertComment(comment) {
      if (!comment) return;
      var index = -1;
      for (var i = 0; i < comments.length; i += 1) {
        if (comments[i].id === comment.id) { index = i; break; }
      }
      if (index >= 0) comments[index] = comment;
      else comments.push(comment);
    }
    function removeCommentLocally(id) {
      var removed = Object.create(null);
      removed[id] = true;
      var changed = true;
      while (changed) {
        changed = false;
        comments.forEach(function(comment) {
          if (removed[comment.id]) return;
          if ((comment.parentId && removed[comment.parentId]) || (comment.rootCommentId && removed[comment.rootCommentId])) {
            removed[comment.id] = true;
            changed = true;
          }
        });
      }
      comments = comments.filter(function(comment) { return !removed[comment.id]; });
    }
    function requestOperation(type, payload, onSuccess) {
      if (!connected) {
        setStatus(CONFIG.labels.failed, true);
        return;
      }
      var id = requestId();
      busy[id] = true;
      pending[id] = { type:type, onSuccess:onSuccess };
      setStatus(CONFIG.labels.sending, false);
      postHost(type, Object.assign({ requestId:id }, payload || {}));
      render();
    }
    function finishBusy(id) {
      delete busy[id];
      delete pending[id];
      render();
    }
    function submitNewComment() {
      if (!currentTarget || !capabilities.canCreate) return;
      var area = document.getElementById("new-comment-input");
      var note = area ? area.value.trim() : "";
      if (!note) return;
      requestOperation("save-comment", { target:currentTarget, note:note }, function(comment) {
        if (comment) upsertComment(comment);
        currentTarget = null;
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function submitReply(comment) {
      var area = document.getElementById("reply-input-" + comment.id);
      var note = area ? area.value.trim() : "";
      if (!note || !capabilities.canReply) return;
      requestOperation("reply-comment", { commentId:comment.id, note:note }, function(reply) {
        if (reply) upsertComment(reply);
        delete drafts[comment.id];
        replyFor = null;
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function changeStatus(comment, status) {
      if (!capabilities.canChangeStatus) return;
      requestOperation("change-comment-status", { commentId:comment.id, status:status }, function(updated) {
        if (updated) upsertComment(updated);
        else {
          comment.status = status;
          comment.updatedAt = Date.now();
        }
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function removeComment(comment) {
      if (!capabilities.canDelete) return;
      requestOperation("remove-comment", { commentId:comment.id }, function() {
        removeCommentLocally(comment.id);
        if (activeCommentId === comment.id) activeCommentId = null;
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function formatTime(value) {
      if (!finite(value) || value <= 0) return "";
      try {
        var date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "";
        function pad(number) { return String(number).padStart(2, "0"); }
        return date.getFullYear() + "/" + pad(date.getMonth() + 1) + "/" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
      } catch (_) {
        return "";
      }
    }
    function commentAuthorName(comment) {
      return comment.authorDisplayName || "?";
    }
    function commentAuthorInitial(name) {
      var trimmed = String(name || "").trim();
      if (!trimmed) return "?";
      var first = Array.from(trimmed)[0] || "?";
      return first.toUpperCase();
    }
    function avatarColor(name) {
      var normalized = String(name || "").normalize("NFKC").trim().replace(/\\s+/g, " ").toLowerCase();
      if (!normalized) return "hsl(210, 65%, 65%)";
      var hash = 0;
      for (var index = 0; index < normalized.length; index += 1) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
      }
      var value = Math.abs(hash);
      var hue = value % 360;
      var saturation = 65 + ((value >> 8) % 25);
      var lightness = 45 + ((value >> 16) % 15);
      return "hsl(" + hue + ", " + saturation + "%, " + lightness + "%)";
    }
    function iconSvg(name) {
      var paths = {
        check:"<path d='M20 6 9 17l-5-5'/>",
        close:"<path d='M18 6 6 18'/><path d='m6 6 12 12'/>",
        reopen:"<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5'/>",
        trash:"<path d='M3 6h18'/><path d='M8 6V4h8v2'/><path d='M19 6l-1 14H6L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/>",
        pin:"<path d='M12 17v5'/><path d='M5 17h14'/><path d='M8 3h8l-1 5 3 3v2H6v-2l3-3z'/>",
        message:"<path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z'/>",
        target:"<path d='m3 3 7.07 17 2.51-7.39L21 11.07z'/>"
      };
      return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + (paths[name] || "") + "</svg>";
    }
    function createAuthorAvatar(comment) {
      var name = commentAuthorName(comment);
      var avatar = el("span", "avatar mini comment-card-avatar", commentAuthorInitial(name));
      avatar.style.background = comment.authorAvatarColor || avatarColor(name);
      avatar.setAttribute("aria-hidden", "true");
      if (comment.authorAvatarUrl) {
        var image = el("img", "comment-user-avatar-image");
        image.src = comment.authorAvatarUrl;
        image.alt = "";
        image.addEventListener("error", function() { image.style.display = "none"; });
        image.addEventListener("load", function() { image.style.display = "block"; });
        avatar.appendChild(image);
      }
      return avatar;
    }
    function appendAuthorAvatar(container, comment) {
      var avatar = createAuthorAvatar(comment);
      container.appendChild(avatar);
      return avatar;
    }
    function replyCountText(count) {
      return String(CONFIG.labels.nReplies || "{n}").replace("{n}", String(count));
    }
    function appendAuthorHeader(container, comment) {
      var name = commentAuthorName(comment);
      var header = el("div", "comment-card-header");
      var meta = el("span", "comment-card-meta-stack");
      appendAuthorAvatar(meta, comment);
      var lines = el("span", "comment-card-meta-lines");
      lines.appendChild(el("strong", "comment-card-author", name));
      var timestamp = comment.createdAt || comment.updatedAt;
      var timeLabel = formatTime(timestamp);
      if (timeLabel) {
        var time = el("time", "comment-card-time", timeLabel);
        try { time.dateTime = new Date(timestamp).toISOString(); } catch (_) {}
        lines.appendChild(time);
      }
      meta.appendChild(lines);
      header.appendChild(meta);
      var headerActions = el("span", "comment-card-header-actions");
      if (capabilities.canChangeStatus) {
        var statusButton = el("button", "icon-btn");
        statusButton.type = "button";
        statusButton.innerHTML = iconSvg(comment.status === "resolved" ? "reopen" : "check");
        statusButton.setAttribute("aria-label", comment.status === "resolved" ? CONFIG.labels.reopen : CONFIG.labels.markResolved);
        statusButton.title = comment.status === "resolved" ? CONFIG.labels.reopen : CONFIG.labels.markResolved;
        statusButton.addEventListener("click", function(event) {
          event.stopPropagation();
          changeStatus(comment, comment.status === "resolved" ? "open" : "resolved");
        });
        headerActions.appendChild(statusButton);
      }
      if (capabilities.canDelete) {
        var deleteButton = el("button", "icon-btn danger");
        deleteButton.type = "button";
        deleteButton.innerHTML = iconSvg("trash");
        deleteButton.setAttribute("aria-label", comment.parentId ? CONFIG.labels.deleteReply : CONFIG.labels.deleteComment);
        deleteButton.title = comment.parentId ? CONFIG.labels.deleteReply : CONFIG.labels.deleteComment;
        deleteButton.addEventListener("click", function(event) {
          event.stopPropagation();
          removeComment(comment);
        });
        headerActions.appendChild(deleteButton);
      }
      if (headerActions.childNodes.length) header.appendChild(headerActions);
      if (comment.status === "resolved") {
        var resolved = el("span", "comment-status");
        resolved.innerHTML = iconSvg("check");
        resolved.appendChild(document.createTextNode(CONFIG.labels.resolved));
        header.appendChild(resolved);
      }
      container.appendChild(header);
    }
    function appendCommentBody(container, comment, isReply) {
      appendAuthorHeader(container, comment);
      if (comment.note) container.appendChild(el("p", "comment-card-copy", comment.note));
      var footerRow = el("div", "comment-card-footer-row");
      var anchor = el("button", "comment-anchor");
      anchor.type = "button";
      anchor.innerHTML = iconSvg("target");
      var pinLabel = "#" + (comment.pinSeq || "") + " · " + (comment.filePath || CONFIG.filePath) + " · " + (comment.label || comment.text || comment.elementId || CONFIG.labels.comment);
      anchor.appendChild(el("span", "", pinLabel));
      anchor.title = pinLabel;
      anchor.addEventListener("click", function(event) {
        event.stopPropagation();
        activeCommentId = comment.parentId ? rootId(comment) : comment.id;
        activateTarget(comment);
        render();
      });
      footerRow.appendChild(anchor);
      var replyCount = isReply ? 0 : repliesFor(comment).length;
      var replyText = isReply ? CONFIG.labels.reply : replyCountText(replyCount);
      if (capabilities.canReply) {
        var replyButton = el("button", "comment-card-user-inline");
        replyButton.type = "button";
        replyButton.setAttribute("aria-label", replyText);
        replyButton.title = replyText;
        replyButton.appendChild(createAuthorAvatar(comment));
        replyButton.insertAdjacentHTML("beforeend", iconSvg("message"));
        replyButton.appendChild(el("span", "", replyText));
        replyButton.addEventListener("click", function(event) {
          event.stopPropagation();
          replyFor = replyFor === comment.id ? null : comment.id;
          activeCommentId = comment.id;
          activateTarget(comment);
          render();
          var input = document.getElementById("reply-input-" + comment.id);
          if (input) input.focus();
        });
        footerRow.appendChild(replyButton);
      } else if (!isReply) {
        var replyCountEl = el("span", "comment-card-user-inline");
        replyCountEl.appendChild(createAuthorAvatar(comment));
        replyCountEl.insertAdjacentHTML("beforeend", iconSvg("message"));
        replyCountEl.appendChild(el("span", "", replyCountText(replyCount)));
        footerRow.appendChild(replyCountEl);
      }
      container.appendChild(footerRow);
    }
    function appendReplyForm(container, comment) {
      if (replyFor !== comment.id || !capabilities.canReply) return;
      var form = el("div", "reply-form");
      var area = el("textarea");
      area.id = "reply-input-" + comment.id;
      area.placeholder = CONFIG.labels.reply;
      area.value = drafts[comment.id] || "";
      area.addEventListener("input", function() { drafts[comment.id] = area.value; });
      form.appendChild(area);
      var actions = el("div", "form-actions");
      var cancel = el("button", "", CONFIG.labels.cancel);
      cancel.type = "button";
      cancel.addEventListener("click", function() {
        replyFor = null;
        render();
      });
      var submit = el("button", "primary", CONFIG.labels.reply);
      submit.type = "button";
      submit.addEventListener("click", function() { submitReply(comment); });
      actions.appendChild(cancel);
      actions.appendChild(submit);
      form.appendChild(actions);
      container.appendChild(form);
    }
    function renderComposer() {
      if (!currentTarget || !capabilities.canCreate) return;
      var composer = el("div", "composer");
      composer.appendChild(el("div", "composer-title", currentTarget.label || currentTarget.text || currentTarget.elementId));
      var area = el("textarea");
      area.id = "new-comment-input";
      area.placeholder = CONFIG.labels.placeholder;
      composer.appendChild(area);
      var actions = el("div", "form-actions");
      var cancel = el("button", "", CONFIG.labels.cancel);
      cancel.type = "button";
      cancel.addEventListener("click", function() {
        currentTarget = null;
        render();
      });
      var submit = el("button", "primary", CONFIG.labels.comment);
      submit.type = "button";
      submit.addEventListener("click", submitNewComment);
      actions.appendChild(cancel);
      actions.appendChild(submit);
      composer.appendChild(actions);
      listEl.appendChild(composer);
      area.focus();
    }
    function renderList() {
      listEl.textContent = "";
      renderComposer();
      var visible = topLevel().filter(threadIsVisible).sort(function(a, b) {
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });
      if (!visible.length) {
        listEl.appendChild(el("div", "empty", CONFIG.labels.empty));
        return;
      }
      visible.forEach(function(comment) {
        var thread = el(
          "article",
          "comment-card" +
            (activeCommentId === comment.id ? " active" : "") +
            (comment.status === "resolved" ? " resolved" : "")
        );
        thread.setAttribute("role", "button");
        thread.setAttribute("tabIndex", "0");
        thread.setAttribute("data-comment-id", comment.id);
        thread.setAttribute("data-active", activeCommentId === comment.id ? "true" : "false");
        if (activeCommentId === comment.id) thread.setAttribute("aria-current", "true");
        thread.setAttribute("aria-label", commentAuthorName(comment) + ": " + (comment.note || ""));
        function activateComment() {
          activeCommentId = comment.id;
          replyFor = comment.id;
          currentTarget = null;
          activateTarget(comment);
          render();
          var input = document.getElementById("reply-input-" + comment.id);
          if (input) input.focus();
        }
        thread.addEventListener("click", function(event) {
          var target = event.target;
          if (target && target !== thread && typeof target.closest === "function" && target.closest("button,textarea,input,a")) return;
          activateComment();
        });
        thread.addEventListener("keydown", function(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activateComment();
        });
        appendCommentBody(thread, comment, false);
        var replies = repliesFor(comment).sort(function(a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        if (replies.length) {
          var repliesEl = el("div", "replies");
          replies.forEach(function(reply) {
            var replyEl = el("div", "reply");
            appendCommentBody(replyEl, reply, true);
            appendReplyForm(replyEl, reply);
            repliesEl.appendChild(replyEl);
          });
          thread.appendChild(repliesEl);
        }
        appendReplyForm(thread, comment);
        listEl.appendChild(thread);
      });
    }
    function markerPosition(comment) {
      var live = liveTargets[comment.elementId];
      return live && live.position ? live.position : comment.position;
    }
    function renderPins() {
      pinsEl.textContent = "";
      if (!commentMode) return;
      var visible = topLevel().filter(threadIsVisible);
      visible.forEach(function(comment, index) {
        var position = markerPosition(comment);
        if (!position) return;
        var pin = el("button", "pin");
        pin.type = "button";
        pin.style.left = (position.x + position.width - 12) + "px";
        pin.style.top = (position.y - 12) + "px";
        pin.setAttribute("data-status", comment.status === "resolved" ? "resolved" : "open");
        pin.setAttribute("data-active", activeCommentId === comment.id ? "true" : "false");
        pin.setAttribute("aria-label", comment.label || comment.text || CONFIG.labels.comment);
        pin.appendChild(el("span", "", String(comment.pinSeq || index + 1)));
        pin.addEventListener("click", function() {
          activeCommentId = comment.id;
          replyFor = null;
          currentTarget = null;
          activateTarget(comment);
          render();
          var threads = listEl.querySelectorAll(".comment-card");
          var targetIndex = visible.findIndex(function(item) { return item.id === comment.id; });
          if (threads[targetIndex]) threads[targetIndex].scrollIntoView({ block:"nearest" });
        });
        pinsEl.appendChild(pin);
      });
    }
    function renderLabels() {
      toggleLabel.textContent = CONFIG.labels.comments;
      panelTitle.textContent = CONFIG.labels.comments;
      countEl.textContent = String(unresolvedCount());
      closeButton.innerHTML = iconSvg("close");
      closeButton.setAttribute("aria-label", CONFIG.labels.close);
      closeButton.title = CONFIG.labels.close;
      resolvedToggle.textContent = CONFIG.labels.showResolved;
      resolvedToggle.setAttribute("aria-pressed", showResolved ? "true" : "false");
    }
    function render() {
      renderLabels();
      renderList();
      renderPins();
    }
    function showHover(target) {
      if (!target || !commentMode) return;
      var position = target.position;
      hoverBox.style.display = "block";
      hoverBox.style.left = position.x + "px";
      hoverBox.style.top = position.y + "px";
      hoverBox.style.width = position.width + "px";
      hoverBox.style.height = position.height + "px";
      hoverLabel.textContent = target.label || target.text || target.elementId;
    }
    function hideHover() {
      hoverBox.style.display = "none";
      hoverLabel.textContent = "";
    }
    function handleFrameMessage(event) {
      if (event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "od:comment-targets") {
        liveTargets = Object.create(null);
        if (Array.isArray(data.targets)) {
          data.targets.forEach(function(value) {
            var target = safeTarget(value);
            if (target) liveTargets[target.elementId] = target;
          });
        }
        renderPins();
        return;
      }
      if (data.type === "od:comment-target") {
        var target = safeTarget(data);
        if (!target) return;
        currentTarget = target;
        activeCommentId = null;
        replyFor = null;
        activateTarget(target);
        hideHover();
        setStatus("", false);
        render();
        return;
      }
      if (data.type === "od:comment-hover") {
        showHover(safeTarget(data));
        return;
      }
      if (data.type === "od:comment-leave") hideHover();
    }
    function handleChannelMessage(event) {
      var data = event.data;
      if (!data || data.token !== CONFIG.token || data.channel !== CONFIG.channelName || data.origin !== location.origin) return;
      if (data.type === "ready-ack") {
        connected = true;
        setStatus("", false);
        return;
      }
      if (data.type === "comments-snapshot") {
        connected = true;
        comments = Array.isArray(data.comments)
          ? data.comments.map(safeComment).filter(Boolean)
          : [];
        if (data.capabilities && typeof data.capabilities === "object") {
          capabilities = {
            canCreate:!!data.capabilities.canCreate,
            canReply:!!data.capabilities.canReply,
            canDelete:!!data.capabilities.canDelete,
            canChangeStatus:!!data.capabilities.canChangeStatus
          };
        }
        render();
        return;
      }
      if (data.type === "operation-result" && typeof data.requestId === "string") {
        var operation = pending[data.requestId];
        if (!operation) return;
        if (data.ok && typeof operation.onSuccess === "function") operation.onSuccess(data.comment || null);
        else setStatus(CONFIG.labels.failed, true);
        finishBusy(data.requestId);
        return;
      }
      if (data.type === "closed") {
        connected = false;
        setStatus(CONFIG.labels.failed, true);
      }
    }
    toggle.addEventListener("click", function() {
      if (!connected) postHost("ready", {});
      setCommentsOpen(!commentMode);
    });
    closeButton.addEventListener("click", function() { setCommentsOpen(false); });
    resolvedToggle.addEventListener("click", function() {
      showResolved = !showResolved;
      render();
    });
    frame.addEventListener("load", function() {
      sendCommentMode();
      activateTarget(currentTarget);
    });
    window.addEventListener("message", handleFrameMessage);
    window.addEventListener("pagehide", function() { postHost("closed", {}); });
    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(CONFIG.channelName);
        channel.addEventListener("message", handleChannelMessage);
        postHost("ready", {});
      } else {
        setStatus(CONFIG.labels.failed, true);
      }
    } catch (_) {
      setStatus(CONFIG.labels.failed, true);
    }
    render();
    setTimeout(sendCommentMode, 0);
  })();
  </script>
</body>
</html>`;
}
