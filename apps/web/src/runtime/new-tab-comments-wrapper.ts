import type { NewTabCommentWrapperOptions } from './new-tab-comments';

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

export function buildNewTabCommentsPreviewDocumentV2(
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
    currentMemberId: options.currentMemberId ?? null,
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
      --bg-panel: #fafafa;
      --bg-subtle: #ededed;
      --border: #dbdbdb;
      --border-soft: #ededed;
      --border-strong: #bdbdbd;
      --material-separator: rgba(73, 73, 73, 0.18);
      --text: #494949;
      --text-muted: #5c5c5c;
      --text-faint: #bdbdbd;
      --accent: #353535;
      --accent-contrast: #fafafa;
      --comment-accent: #d96a46;
      --danger: #f04142;
      --danger-bg: #fff0f0;
      --radius-xs: 2px;
      --radius-sm: 4px;
      --radius: 8px;
      --glass-regular: rgba(250, 250, 250, 0.66);
      --glass-backdrop: blur(28px) saturate(1.8);
      --shadow-lg: 0 24px 60px rgba(28, 27, 26, 0.16), 0 8px 16px rgba(28, 27, 26, 0.07);
    }
    * { box-sizing:border-box; }
    html,body { margin:0; width:100%; height:100%; overflow:hidden; color:var(--text); font:13px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f5f4f2; }
    button,textarea { font:inherit; color:inherit; }
    .app { position:relative; display:flex; width:100%; height:100%; overflow:hidden; }
    .stage { position:relative; flex:1 1 auto; min-width:0; height:100%; overflow:hidden; }
    iframe { display:block; width:100%; height:100%; border:0; background:#fff; }
    .toolbar { position:absolute; z-index:20; top:12px; right:12px; display:flex; align-items:center; gap:8px; }
    .toolbar button { position:relative; display:inline-flex; width:36px; height:36px; align-items:center; justify-content:center; padding:0; border:1px solid var(--border); border-radius:8px; background:rgb(255 255 255 / 95%); box-shadow:0 2px 10px rgb(15 23 42 / 10%); cursor:pointer; }
    .toolbar button:hover { border-color:var(--border-strong); background:#fff; }
    .toolbar button[aria-pressed="true"] { border-color:#93b4f7; background:#eef4ff; color:#1e4fae; }
    .toolbar .badge { position:absolute; top:-5px; right:-5px; display:inline-flex; min-width:17px; height:17px; padding:0 4px; align-items:center; justify-content:center; border:2px solid #fff; border-radius:999px; background:var(--comment-accent); color:#fff; font-size:10px; font-weight:700; line-height:1; }
    .toolbar svg { width:16px; height:16px; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .panel { position:relative; z-index:25; flex:0 0 min(320px,34vw); min-width:0; height:100%; overflow:hidden; border-left:1px solid var(--border); background:var(--bg-panel); box-shadow:-12px 0 32px rgb(0 0 0 / 8%); }
    .panel:not([hidden]) { display:flex; flex-direction:column; }
    .panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 12px; border-bottom:1px solid var(--border); }
    .panel-title { display:inline-flex; min-width:0; align-items:center; gap:7px; color:var(--text); font-size:12px; font-weight:700; }
    .panel-title svg { width:15px; height:15px; flex:0 0 auto; }
    .panel-title span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .panel-head-actions { display:inline-flex; flex:0 0 auto; align-items:center; gap:6px; }
    .panel-unresolved { color:var(--text-muted); font-size:11px; font-weight:650; white-space:nowrap; }
    .panel-unresolved[hidden] { display:none; }
    .panel-close { display:inline-flex; width:26px; height:26px; flex:0 0 auto; align-items:center; justify-content:center; padding:0; border:1px solid transparent; border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; }
    .panel-close:hover { border-color:var(--border); background:var(--bg-subtle); color:var(--text); }
    .panel-close svg { width:14px; height:14px; }
    .panel-controls { display:flex; flex:0 0 auto; align-items:center; gap:6px; padding:7px 10px; border-bottom:1px solid var(--border-soft); }
    .panel-search { display:inline-flex; min-width:0; min-height:30px; flex:1 1 auto; align-items:center; gap:6px; padding:0 8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); }
    .panel-search-icon { display:inline-flex; flex:0 0 auto; align-items:center; color:var(--text-muted); }
    .panel-search-icon svg { width:15px; height:15px; }
    .panel-search input { min-width:0; flex:1 1 auto; padding:4px 0; border:0; outline:0; background:transparent; color:var(--text); font:inherit; font-size:12px; }
    .panel-search input::placeholder { color:var(--text-faint); }
    .panel-menu-wrap { position:relative; display:inline-flex; flex:0 0 auto; }
    .panel-menu-toggle { display:inline-flex; width:30px; height:30px; align-items:center; justify-content:center; padding:0; border:1px solid transparent; border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; }
    .panel-menu-toggle:hover, .panel-menu-toggle[aria-expanded="true"] { border-color:var(--border); background:var(--bg-subtle); color:var(--text); }
    .panel-menu-toggle svg { width:16px; height:16px; }
    .panel-menu { position:absolute; z-index:30; top:calc(100% + 4px); right:0; display:flex; min-width:210px; flex-direction:column; gap:1px; padding:4px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-panel); box-shadow:0 8px 24px rgb(0 0 0 / 12%); }
    .panel-menu[hidden] { display:none; }
    .panel-menu button { display:flex; align-items:center; gap:6px; padding:6px 8px; border:0; border-radius:var(--radius-xs); background:transparent; color:var(--text); font-size:12px; text-align:left; cursor:pointer; }
    .panel-menu button:hover { background:var(--bg-subtle); }
    .panel-menu button[aria-current="true"] { color:var(--comment-accent); font-weight:700; }
    .panel-menu button svg { width:14px; height:14px; flex:0 0 auto; visibility:hidden; }
    .panel-menu button[aria-current="true"] svg { visibility:visible; }
    .panel-menu-sep { display:block; height:1px; margin:4px 0; background:var(--border); }
    .panel-summary { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; min-height:30px; padding:6px 12px; border-bottom:1px solid var(--border-soft); color:var(--text-muted); font-size:11px; }
    .panel-status { flex:0 0 auto; margin:8px 12px 0; padding:6px 8px; border-radius:var(--radius-sm); background:var(--bg-subtle); font-size:12px; }
    .panel-status:empty { display:none; }
    .list { flex:1 1 auto; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--text-muted) 34%,transparent) transparent; }
    .list::-webkit-scrollbar { width:6px; }
    .list::-webkit-scrollbar-thumb { border-radius:999px; background:color-mix(in srgb,var(--text-muted) 34%,transparent); }
    .empty { padding:28px 8px; text-align:center; color:var(--text-muted); font-size:13px; }
    .comment-card { position:relative; padding:10px 12px 10px 8px; border:1px solid transparent; border-radius:var(--radius); background:transparent; color:var(--text); cursor:pointer; }
    .comment-card:hover { border-color:var(--border-soft); background:rgb(255 255 255 / 58%); }
    .comment-card:focus-visible { outline:2px solid #93b4f7; outline-offset:-2px; }
    .comment-card.active { border-color:color-mix(in srgb,var(--comment-accent) 64%,var(--border)); background:color-mix(in srgb,var(--comment-accent) 10%,var(--bg-panel)); box-shadow:inset 3px 0 0 var(--comment-accent); }
    .comment-card.resolved .comment-card-copy { color:var(--text-muted); }
    .comment-card-header { display:flex; min-width:0; align-items:center; gap:8px; }
    .comment-card-avatar { position:relative; display:inline-flex; width:24px; height:24px; flex:0 0 auto; align-items:center; justify-content:center; overflow:hidden; border-radius:50%; color:#fff; font-size:11px; font-weight:650; }
    .comment-card-meta { display:flex; min-width:0; flex:1 1 auto; align-items:baseline; gap:6px; }
    .comment-card-author { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:1.25; }
    .comment-card-time { flex:0 0 auto; color:var(--text-muted); font-size:11px; white-space:nowrap; }
    .comment-status { display:inline-flex; flex:0 0 auto; align-items:center; gap:3px; color:var(--text-muted); font-size:10px; font-weight:650; }
    .comment-status svg { width:12px; height:12px; }
    .comment-card-copy { margin:7px 0 0 32px; color:var(--text); font-size:13px; line-height:1.45; overflow-wrap:anywhere; white-space:pre-wrap; }
    .comment-card-replies { display:flex; min-height:18px; align-items:center; gap:4px; margin:8px 0 0 32px; color:var(--text-muted); font-size:11px; }
    .comment-card-replies svg { width:12px; height:12px; flex:0 0 auto; }
    .comment-card-reply-avatar { position:relative; display:inline-flex; width:18px; height:18px; flex:0 0 auto; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--bg-panel); border-radius:50%; color:#fff; font-size:9px; font-weight:650; }
    button:disabled { cursor:not-allowed; opacity:.45; }
    .pins { position:absolute; z-index:15; inset:0; pointer-events:none; }
    .pins[hidden] { display:none; }
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
    .comment-user-avatar-image[hidden] { display:none; }
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
      border:1px solid var(--material-separator);
      border-radius:var(--radius);
      background:var(--glass-regular);
      -webkit-backdrop-filter:var(--glass-backdrop);
      backdrop-filter:var(--glass-backdrop);
      box-shadow:var(--shadow-lg);
    }
    .comment-popover[hidden] { display:none; }
    .comment-popover-composer { max-height:calc(100% - var(--comment-popover-top,120px)) !important; }
    .comment-popover-composer-wrap { display:flex; flex:1 1 auto; min-height:0; flex-direction:column; overflow-y:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--text-muted) 34%,transparent) transparent; }
    .comment-popover-composer-wrap::-webkit-scrollbar { width:6px; }
    .comment-popover-composer-wrap::-webkit-scrollbar-thumb { border-radius:999px; background:color-mix(in srgb,var(--text-muted) 34%,transparent); }
    .comment-popover-body { flex:1 1 auto; min-height:0; overflow:auto; }
    .comment-popover-composer-wrap > .comment-popover-body { flex:0 0 auto; min-height:auto; overflow:visible; }
    .comment-popover-composer > .comment-popover-titlebar { flex:0 0 auto; }
    .comment-popover-titlebar { display:flex; flex:0 0 auto; align-items:center; gap:8px; min-height:24px; margin:-2px 0 8px; }
    .comment-popover-drag-handle { display:inline-flex; width:22px; height:24px; flex:0 0 auto; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:grab; touch-action:none; }
    .comment-popover-drag-handle:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-drag-handle:active { cursor:grabbing; }
    .comment-popover-drag-handle span { width:12px; height:16px; background-image:radial-gradient(currentColor 1.3px,transparent 1.4px); background-position:0 0; background-size:6px 5px; }
    .comment-popover-dragging .comment-popover-drag-handle { cursor:grabbing; }
    .comment-popover-title { min-width:0; flex:1 1 auto; overflow:hidden; color:var(--text); font-size:12px; font-weight:650; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
    .comment-popover-existing-actions { display:inline-flex; flex:0 0 auto; align-items:center; gap:4px; margin-right:24px; }
    .comment-popover-header-action,.comment-popover-close-btn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:0; border-radius:var(--radius-xs); background:transparent; color:var(--text-muted); cursor:pointer; }
    .comment-popover-header-action { width:26px; height:26px; border-radius:6px; line-height:0; }
    .comment-popover-header-action:hover,.comment-popover-close-btn:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-header-action.danger:hover { background:var(--danger-bg); color:var(--danger); }
    .comment-popover-close-btn { position:absolute; top:10px; right:6px; z-index:10; }
    .comment-popover-section { min-width:0; }
    .comment-popover-section-params { display:grid; gap:8px; }
    .comment-popover-meta-line { display:flex; min-width:0; align-items:center; gap:8px; }
    .comment-popover-meta-avatar,.comment-popover-reply-avatar { position:relative; display:inline-flex; flex:0 0 auto; align-items:center; justify-content:center; border-radius:50%; color:#fff; font-weight:600; overflow:hidden; }
    .comment-popover-meta-avatar { width:24px; height:24px; font-size:13px; font-weight:650; line-height:1; }
    .comment-popover-reply-avatar { width:24px; height:24px; font-size:10px; }
    .comment-popover-meta-author,.comment-popover-reply-author { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); font-weight:600; }
    .comment-popover-meta-author { font-size:13px; line-height:1.25; }
    .comment-popover-reply-author { font-size:12px; line-height:1.25; }
    .comment-popover-meta-time,.comment-popover-reply-time { flex:0 0 auto; margin-left:2px; font-size:11px; line-height:1.25; white-space:nowrap; }
    .comment-popover-meta-time { color:var(--text-muted); }
    .comment-popover-reply-time { color:var(--text-faint); }
    .comment-popover-existing-note { min-width:0; padding:12px 8px 12px 32px; color:var(--text); font-size:13px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap; }
    .comment-popover-replies { display:grid; gap:0; }
    .comment-popover-reply-item { position:relative; min-width:0; color:var(--text); font-size:12px; line-height:1.45; }
    .comment-popover-reply-meta { display:flex; min-width:0; align-items:center; gap:6px; margin-bottom:4px; }
    .comment-popover-reply-note { min-width:0; padding:12px 8px 12px 32px; color:var(--text); overflow-wrap:anywhere; white-space:pre-wrap; }
    .comment-popover-reply-item-actions { position:absolute; top:0; right:0; display:inline-flex; align-items:center; justify-content:flex-end; gap:2px; opacity:0; transition:opacity 120ms ease; }
    .comment-popover-reply-item:hover .comment-popover-reply-item-actions,.comment-popover-reply-item:focus-within .comment-popover-reply-item-actions { opacity:1; }
    .comment-popover-reply-item-actions .icon-btn { display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-xs); background:transparent; color:var(--text-muted); cursor:pointer; }
    .comment-popover-reply-item-actions .icon-btn:hover { background:var(--bg-subtle); color:var(--text); }
    .comment-popover-reply-item-actions .icon-btn.danger:hover { background:var(--danger-bg); color:var(--danger); }
    .comment-popover-reply-bar { position:sticky; bottom:0; z-index:1; flex:0 0 auto; border:1px solid var(--border-soft); border-radius:var(--radius-sm); background:var(--bg-panel); }
    .comment-popover-reply-input-wrap { position:relative; min-width:0; }
    .comment-popover textarea { width:100%; min-height:66px; max-height:300px; resize:vertical; padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); outline:none; background:var(--bg); }
    textarea:focus { border-color:#a3a3a3; box-shadow:0 0 0 3px rgb(53 53 53 / 8%); }
    .comment-popover-new-input { min-height:96px !important; resize:none !important; }
    .comment-popover textarea.comment-popover-reply-input { max-height:120px; resize:none; overflow:hidden; }
    .comment-popover-reply-bar .comment-popover-reply-input { width:100%; min-height:36px; padding:8px 68px 8px 8px; border:0; background:transparent; }
    .comment-popover-reply-bar--expanded { padding:8px 12px 10px; }
    .comment-popover-reply-bar--expanded .comment-popover-reply-input { padding-right:10px; }
    .comment-popover-reply-floating-actions { position:absolute; right:12px; bottom:12px; display:inline-flex; align-items:center; gap:4px; padding-top:8px; }
    .comment-popover-reply-bar--expanded .comment-popover-reply-floating-actions { position:static; width:100%; justify-content:flex-end; border-top:1px solid var(--border-soft); }
    .comment-popover-reply-send { display:inline-flex; width:28px; height:28px; align-items:center; justify-content:center; padding:0; border:0; border-radius:var(--radius-xs); background:var(--accent); color:var(--accent-contrast,#fff); cursor:pointer; }
    .comment-popover-reply-send:hover:not(:disabled) { opacity:.88; }
    .comment-popover-reply-send:disabled { opacity:.4; cursor:not-allowed; }
    .comment-popover-actions { display:flex; flex:0 0 auto; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:8px; padding:8px 0; }
    .comment-popover-actions button { min-height:30px; padding:4px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text); box-shadow:0 1px 2px rgb(15 23 42 / 5%); cursor:pointer; }
    .comment-popover-actions button:hover:not(:disabled) { border-color:var(--border-strong); background:var(--bg-subtle); }
    .comment-popover-actions button.primary { border-color:var(--accent); background:var(--accent); color:var(--accent-contrast); }
    .comment-popover-actions button.primary:hover:not(:disabled) { background:#202020; }
    .comment-popover button > svg { display:block; flex:0 0 auto; }
    .comment-popover-close-btn > svg { width:14px; height:14px; }
    .comment-popover-header-action > svg { width:16px; height:16px; }
    .comment-popover-reply-send > svg { width:14px; height:14px; }
    @media (max-width:720px) {
      .comment-popover { width:calc(100% - 20px); max-height:calc(100% - 20px); }
      .comment-popover-reply-item-actions { opacity:1; }
      .toolbar { top:8px; right:8px; }
      .panel { position:absolute; top:0; right:0; bottom:0; width:min(320px,calc(100vw - 24px)); height:auto; flex-basis:auto; }
    }
  </style>
</head>
<body>
  <main class="app" id="app" data-comments-open="false">
    <section class="stage" id="stage" aria-label="${safeTitle}">
      <iframe id="preview" title="${safeTitle}" sandbox="${sandbox}" srcdoc="${escapeHtmlAttribute(doc)}"></iframe>
      <div class="hover-box" id="hover-box"><div class="hover-label" id="hover-label"></div></div>
      <div class="pins" id="pins" hidden></div>
      <div class="toolbar">
        <button id="comments-toggle" type="button" aria-pressed="false" aria-expanded="false" aria-controls="panel">
          <span id="comments-toggle-icon" aria-hidden="true"></span>
          <span class="sr-only" id="comments-toggle-label"></span>
          <span class="badge" id="comments-count">0</span>
        </button>
      </div>
      <section class="comment-popover comment-popover-composer" id="comment-popover" role="dialog" aria-modal="false" hidden>
        <button class="comment-popover-close-btn" id="comment-popover-close" type="button"></button>
        <div class="comment-popover-titlebar">
          <button class="comment-popover-drag-handle" id="comment-popover-drag" type="button"><span aria-hidden="true"></span></button>
          <span class="comment-popover-title" id="comment-popover-title"></span>
          <span class="comment-popover-existing-actions" id="comment-popover-actions"></span>
        </div>
        <div class="comment-popover-composer-wrap">
          <div class="comment-popover-body" id="comment-popover-body"></div>
        </div>
      </section>
    </section>
    <aside class="panel" id="panel" hidden>
      <header class="panel-head">
        <div class="panel-title">
          <span id="panel-title-icon" aria-hidden="true"></span>
          <span id="panel-title"></span>
        </div>
        <div class="panel-head-actions">
          <span class="panel-unresolved" id="panel-unresolved-count"></span>
          <button class="panel-close" id="panel-close" type="button"></button>
        </div>
      </header>
      <div class="panel-controls">
        <label class="panel-search">
          <span class="panel-search-icon" id="comment-search-icon" aria-hidden="true"></span>
          <input id="comment-search" type="search" autocomplete="off" />
        </label>
        <span class="panel-menu-wrap" id="sort-menu-wrap">
          <button class="panel-menu-toggle" id="sort-menu-toggle" type="button" aria-haspopup="menu" aria-expanded="false"></button>
          <div class="panel-menu" id="sort-menu" role="menu" hidden></div>
        </span>
      </div>
      <div class="panel-summary"><span id="visible-comment-count"></span></div>
      <div class="panel-status" id="status" role="status" aria-live="polite"></div>
      <div class="list" id="comment-list"></div>
    </aside>
  </main>
  <script data-od-new-tab-comments>
  (function(){
    "use strict";
    var CONFIG = ${config};
    var app = document.getElementById("app");
    var stage = document.getElementById("stage");
    var frame = document.getElementById("preview");
    var pinsEl = document.getElementById("pins");
    var hoverBox = document.getElementById("hover-box");
    var hoverLabel = document.getElementById("hover-label");
    var panel = document.getElementById("panel");
    var panelTitle = document.getElementById("panel-title");
    var panelTitleIcon = document.getElementById("panel-title-icon");
    var panelClose = document.getElementById("panel-close");
    var panelUnresolvedCount = document.getElementById("panel-unresolved-count");
    var searchIcon = document.getElementById("comment-search-icon");
    var searchInput = document.getElementById("comment-search");
    var sortMenuWrap = document.getElementById("sort-menu-wrap");
    var sortMenuToggle = document.getElementById("sort-menu-toggle");
    var sortMenu = document.getElementById("sort-menu");
    var visibleCommentCount = document.getElementById("visible-comment-count");
    var listEl = document.getElementById("comment-list");
    var statusEl = document.getElementById("status");
    var toggle = document.getElementById("comments-toggle");
    var toggleIcon = document.getElementById("comments-toggle-icon");
    var toggleLabel = document.getElementById("comments-toggle-label");
    var countEl = document.getElementById("comments-count");
    var popover = document.getElementById("comment-popover");
    var popoverTitle = document.getElementById("comment-popover-title");
    var popoverActions = document.getElementById("comment-popover-actions");
    var popoverBody = document.getElementById("comment-popover-body");
    var popoverComposerWrap = popoverBody.parentElement;
    var popoverClose = document.getElementById("comment-popover-close");
    var popoverDrag = document.getElementById("comment-popover-drag");
    var comments = [];
    var liveTargets = Object.create(null);
    var commentMode = false;
    var searchQuery = "";
    var sortMode = "newest";
    var filterCurrentPage = false;
    var filterShowResolved = false;
    var filterRelatedToMe = false;
    var sortMenuOpen = false;
    var connected = false;
    var activeCommentId = null;
    var currentTarget = null;
    var drafts = Object.create(null);
    var busy = Object.create(null);
    var pending = Object.create(null);
    var capabilities = { canCreate:false, canReply:false, canDelete:false, canChangeStatus:false };
    var channel = null;
    var composingNew = false;
    var composingReply = false;
    var popoverResizeObserver = null;
    var popoverPositionFrame = 0;
    var POPOVER_PAD = 14;
    var POPOVER_GAP = 6;
    var POPOVER_DEFAULT_WIDTH = 320;
    var POPOVER_EXPANDED_ESTIMATED_HEIGHT = 320;
    var POPOVER_MIN_VISIBLE_HEIGHT = 120;

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
    function safePoint(value) {
      if (!value || !finite(value.x) || !finite(value.y)) return null;
      if (Math.abs(value.x) > 1000000 || Math.abs(value.y) > 1000000) return null;
      return { x:value.x, y:value.y };
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
      var hoverPoint = safePoint(value.hoverPoint);
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
        hoverPoint:hoverPoint || undefined,
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
    function topLevel() {
      return comments.filter(function(comment) { return !comment.parentId; });
    }
    function commentActivityAt(comment) {
      return Math.max(
        finite(comment.updatedAt) ? comment.updatedAt : 0,
        finite(comment.createdAt) ? comment.createdAt : 0
      );
    }
    function commentMatchesSearch(comment, query) {
      if (!query) return true;
      return String(comment.note || "").toLowerCase().indexOf(query) >= 0
        || commentAuthorName(comment).toLowerCase().indexOf(query) >= 0;
    }
    function normalizedMemberId(value) {
      return String(value || "").trim().toLowerCase();
    }
    function commentIsRelatedToCurrentMember(comment, currentMemberId) {
      if (!currentMemberId) return true;
      if (normalizedMemberId(comment.authorMemberId) === currentMemberId) return true;
      return repliesFor(comment).some(function(reply) {
        return normalizedMemberId(reply.authorMemberId) === currentMemberId;
      });
    }
    function visibleComments() {
      var query = searchQuery.trim().toLowerCase();
      var currentMemberId = normalizedMemberId(CONFIG.currentMemberId);
      return topLevel().filter(function(comment) {
        if (!commentMatchesSearch(comment, query)) return false;
        if (!filterShowResolved && comment.status === "resolved") return false;
        if (filterCurrentPage && comment.filePath !== CONFIG.filePath) return false;
        if (filterRelatedToMe && currentMemberId && !commentIsRelatedToCurrentMember(comment, currentMemberId)) return false;
        return true;
      }).sort(function(a, b) {
        return sortMode === "oldest"
          ? commentActivityAt(a) - commentActivityAt(b)
          : commentActivityAt(b) - commentActivityAt(a);
      });
    }
    function unresolvedCount() {
      return comments.filter(function(comment) { return !comment.parentId && isUnresolved(comment); }).length;
    }
    function findComment(id) {
      if (!id) return null;
      for (var index = 0; index < comments.length; index += 1) {
        if (comments[index].id === id) return comments[index];
      }
      return null;
    }
    function sendFrame(type, payload) {
      if (!frame.contentWindow) return;
      try { frame.contentWindow.postMessage(Object.assign({ type:type }, payload || {}), "*"); } catch (_) {}
    }
    function sendCommentMode() {
      sendFrame("od:comment-mode", { enabled:commentMode, mode:"picker" });
    }
    function activateTarget(target) {
      sendFrame("od:comment-active-target", {
        elementId:target && target.elementId ? target.elementId : null,
        selector:target && target.selector ? target.selector : ""
      });
    }
    function setCommentsOpen(open) {
      commentMode = open;
      app.setAttribute("data-comments-open", open ? "true" : "false");
      toggle.setAttribute("aria-pressed", open ? "true" : "false");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      pinsEl.hidden = !open;
      if (!open) {
        activeCommentId = null;
        currentTarget = null;
        hoverBox.style.display = "none";
        activateTarget(null);
      }
      sendCommentMode();
      render();
    }
    function closePopover() {
      activeCommentId = null;
      currentTarget = null;
      hoverBox.style.display = "none";
      activateTarget(null);
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
    function targetDisplayName(target) {
      if (!target) return CONFIG.labels.comments;
      return target.label || target.text || target.elementId || CONFIG.labels.comment;
    }
    function submitNewComment() {
      if (!currentTarget || !capabilities.canCreate) return;
      var area = document.getElementById("new-comment-input");
      var note = area ? area.value.trim() : "";
      if (!note) return;
      var target = currentTarget;
      requestOperation("save-comment", { target:target, note:note }, function(comment) {
        if (comment) {
          upsertComment(comment);
          activeCommentId = comment.id;
        } else {
          var newest = null;
          comments.forEach(function(candidate) {
            if (candidate.parentId || candidate.elementId !== target.elementId) return;
            if (!newest || (candidate.createdAt || 0) >= (newest.createdAt || 0)) newest = candidate;
          });
          activeCommentId = newest ? newest.id : null;
        }
        currentTarget = null;
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function submitReply(comment) {
      var area = document.getElementById("reply-input-" + comment.id);
      var note = area ? area.value.trim() : (drafts[comment.id] || "").trim();
      if (!note || !capabilities.canReply) return;
      requestOperation("reply-comment", { commentId:comment.id, note:note }, function(reply) {
        if (reply) upsertComment(reply);
        delete drafts[comment.id];
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
        if (activeCommentId === comment.id || activeCommentId === rootId(comment)) activeCommentId = null;
        setStatus(CONFIG.labels.saved, false);
        render();
      });
    }
    function commentAuthorName(comment) {
      return comment && comment.authorDisplayName
        ? comment.authorDisplayName.trim() || "?"
        : "?";
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
    function populateAvatar(avatar, comment) {
      var name = commentAuthorName(comment);
      avatar.textContent = commentAuthorInitial(name);
      avatar.style.background = avatarColor(name);
      if (!comment.authorAvatarUrl) return avatar;
      var image = el("img", "comment-user-avatar-image");
      image.src = comment.authorAvatarUrl;
      image.alt = "";
      image.addEventListener("error", function() { image.hidden = true; });
      image.addEventListener("load", function() { image.hidden = false; });
      avatar.appendChild(image);
      return avatar;
    }
    function createAvatar(comment, className) {
      var avatar = el("span", className);
      avatar.setAttribute("aria-hidden", "true");
      return populateAvatar(avatar, comment);
    }
    function formatRelativeTime(value) {
      if (!finite(value) || value <= 0) return "";
      var diff = Math.max(0, Date.now() - value);
      var minute = 60000;
      var hour = 60 * minute;
      var day = 24 * hour;
      if (diff < minute) return CONFIG.labels.justNow || "Just now";
      if (diff < hour) return String(CONFIG.labels.minutesAgo || "{n} minutes ago").replace("{n}", String(Math.floor(diff / minute)));
      if (diff < day) return String(CONFIG.labels.hoursAgo || "{n} hours ago").replace("{n}", String(Math.floor(diff / hour)));
      if (diff < 7 * day) return String(CONFIG.labels.daysAgo || "{n} days ago").replace("{n}", String(Math.floor(diff / day)));
      try { return new Date(value).toLocaleDateString(); } catch (_) { return ""; }
    }
    function appendTime(container, className, value) {
      var label = formatRelativeTime(value);
      if (!label) return;
      var time = el("time", className, label);
      try { time.dateTime = new Date(value).toISOString(); } catch (_) {}
      container.appendChild(time);
    }
    function iconSvg(name) {
      var paths = {
        check:"<path d='M20 6 9 17l-5-5'/>",
        close:"<path d='M18 6 6 18'/><path d='m6 6 12 12'/>",
        reopen:"<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5'/>",
        trash:"<path d='M3 6h18'/><path d='M8 6V4h8v2'/><path d='M19 6l-1 14H6L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/>",
        message:"<path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z'/>",
        send:"<path d='m22 2-7 20-4-9-9-4z'/><path d='M22 2 11 13'/>",
        search:"<circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/>",
        "arrow-down-up":"<path d='m21 16-4 4-4-4'/><path d='M17 20V4'/><path d='m3 8 4-4 4 4'/><path d='M7 4v16'/>"
      };
      return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + (paths[name] || "") + "</svg>";
    }
    function createHeaderAction(icon, label, danger, onClick) {
      var button = el("button", "comment-popover-header-action" + (danger ? " danger" : ""));
      button.type = "button";
      button.innerHTML = iconSvg(icon);
      button.setAttribute("aria-label", label);
      button.title = label;
      button.addEventListener("click", onClick);
      return button;
    }
    function resizeReplyInput(area) {
      area.style.height = "auto";
      area.style.height = (area.scrollHeight - 8) + "px";
    }
    function schedulePopoverPosition() {
      if (popover.hidden || popoverPositionFrame) return;
      popoverPositionFrame = requestAnimationFrame(function() {
        popoverPositionFrame = 0;
        positionPopover();
      });
    }
    function observePopoverResize() {
      if (typeof ResizeObserver !== "function") return;
      popoverResizeObserver = new ResizeObserver(schedulePopoverPosition);
      popoverResizeObserver.observe(popover);
      popoverResizeObserver.observe(popoverComposerWrap);
    }
    function renderPopoverActions(comment) {
      popoverActions.textContent = "";
      if (!comment) return;
      if (capabilities.canDelete) {
        popoverActions.appendChild(createHeaderAction("trash", CONFIG.labels.deleteComment, true, function() {
          removeComment(comment);
        }));
      }
      if (capabilities.canChangeStatus) {
        var resolved = comment.status === "resolved";
        popoverActions.appendChild(createHeaderAction(
          resolved ? "reopen" : "check",
          resolved ? CONFIG.labels.reopen : CONFIG.labels.markResolved,
          false,
          function() { changeStatus(comment, resolved ? "open" : "resolved"); }
        ));
      }
    }
    function renderExistingComment(comment) {
      var section = el("section", "comment-popover-section comment-popover-section-params");
      var meta = el("div", "comment-popover-meta-line");
      meta.appendChild(createAvatar(comment, "comment-popover-meta-avatar"));
      meta.appendChild(el("strong", "comment-popover-meta-author", commentAuthorName(comment)));
      appendTime(meta, "comment-popover-meta-time", comment.createdAt || comment.updatedAt);
      section.appendChild(meta);
      section.appendChild(el("div", "comment-popover-existing-note", comment.note));
      var replies = repliesFor(comment).sort(function(a, b) {
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      if (replies.length) {
        var list = el("div", "comment-popover-replies");
        replies.forEach(function(reply) {
          var item = el("div", "comment-popover-reply-item");
          var replyMeta = el("div", "comment-popover-reply-meta");
          replyMeta.appendChild(createAvatar(reply, "comment-popover-reply-avatar"));
          replyMeta.appendChild(el("strong", "comment-popover-reply-author", commentAuthorName(reply)));
          appendTime(replyMeta, "comment-popover-reply-time", reply.createdAt || reply.updatedAt);
          if (capabilities.canDelete) {
            var actions = el("span", "comment-popover-reply-item-actions");
            var remove = el("button", "icon-btn danger");
            remove.type = "button";
            remove.innerHTML = iconSvg("trash");
            remove.setAttribute("aria-label", CONFIG.labels.deleteReply);
            remove.title = CONFIG.labels.deleteReply;
            remove.addEventListener("click", function() { removeComment(reply); });
            actions.appendChild(remove);
            replyMeta.appendChild(actions);
          }
          item.appendChild(replyMeta);
          item.appendChild(el("div", "comment-popover-reply-note", reply.note));
          list.appendChild(item);
        });
        section.appendChild(list);
      }
      popoverBody.appendChild(section);
      if (!capabilities.canReply) return;
      var bar = el("div", "comment-popover-reply-bar");
      var wrap = el("div", "comment-popover-reply-input-wrap");
      var area = el("textarea", "comment-popover-reply-input");
      area.id = "reply-input-" + comment.id;
      area.placeholder = CONFIG.labels.reply;
      area.setAttribute("aria-label", CONFIG.labels.reply);
      area.value = drafts[comment.id] || "";
      var hasDraft = Boolean(area.value.trim());
      if (hasDraft) bar.classList.add("comment-popover-reply-bar--expanded");
      var actions = el("div", "comment-popover-reply-floating-actions");
      var send = el("button", "comment-popover-reply-send");
      send.type = "button";
      send.innerHTML = iconSvg("send");
      send.title = CONFIG.labels.reply;
      send.setAttribute("aria-label", CONFIG.labels.reply);
      send.disabled = !hasDraft;
      area.addEventListener("input", function() {
        drafts[comment.id] = area.value;
        var nextHasDraft = Boolean(area.value.trim());
        bar.classList.toggle("comment-popover-reply-bar--expanded", nextHasDraft);
        send.disabled = !nextHasDraft;
        resizeReplyInput(area);
        positionPopover();
      });
      area.addEventListener("compositionstart", function() { composingReply = true; });
      area.addEventListener("compositionend", function() { composingReply = false; });
      area.addEventListener("keydown", function(event) {
        if (event.isComposing || composingReply || event.keyCode === 229) return;
        if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          submitReply(comment);
        }
      });
      send.addEventListener("click", function() { submitReply(comment); });
      wrap.appendChild(area);
      actions.appendChild(send);
      wrap.appendChild(actions);
      bar.appendChild(wrap);
      requestAnimationFrame(function() { resizeReplyInput(area); });
      return bar;
    }
    function renderComposer(target) {
      var section = el("section", "comment-popover-section");
      var area = el("textarea", "comment-popover-new-input");
      area.id = "new-comment-input";
      area.placeholder = CONFIG.labels.placeholder;
      area.setAttribute("aria-label", CONFIG.labels.placeholder);
      section.appendChild(area);
      if (capabilities.canCreate) {
        var actions = el("div", "comment-popover-actions");
        var cancel = el("button", "", CONFIG.labels.cancel);
        cancel.type = "button";
        cancel.addEventListener("click", closePopover);
        var submit = el("button", "primary", CONFIG.labels.comment);
        submit.type = "button";
        submit.disabled = true;
        area.addEventListener("input", function() { submit.disabled = !area.value.trim(); });
        area.addEventListener("compositionstart", function() { composingNew = true; });
        area.addEventListener("compositionend", function() { composingNew = false; });
        area.addEventListener("keydown", function(event) {
          if (event.isComposing || composingNew || event.keyCode === 229) return;
          if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            submitNewComment();
          }
        });
        submit.addEventListener("click", submitNewComment);
        actions.appendChild(cancel);
        actions.appendChild(submit);
        section.appendChild(actions);
      }
      popoverBody.appendChild(section);
      requestAnimationFrame(function() { area.focus(); });
    }
    function renderPopover() {
      popoverBody.textContent = "";
      Array.prototype.slice.call(popoverComposerWrap.children).forEach(function(child) {
        if (child !== popoverBody) popoverComposerWrap.removeChild(child);
      });
      popoverActions.textContent = "";
      var comment = findComment(activeCommentId);
      if (!comment && activeCommentId) activeCommentId = null;
      var target = comment || currentTarget;
      if (!target) {
        popover.hidden = true;
        return;
      }
      popover.hidden = false;
      popoverTitle.textContent = targetDisplayName(target);
      if (comment) {
        renderPopoverActions(comment);
        var replyBar = renderExistingComment(comment);
        if (replyBar) popoverComposerWrap.appendChild(replyBar);
      } else {
        renderComposer(target);
      }
      positionPopover();
    }
    function scrollCommentIntoView(id) {
      if (!id || panel.hidden) return;
      requestAnimationFrame(function() {
        var cards = listEl.querySelectorAll("[data-comment-id]");
        for (var index = 0; index < cards.length; index += 1) {
          if (cards[index].getAttribute("data-comment-id") === id) {
            cards[index].scrollIntoView({ block:"nearest" });
            return;
          }
        }
      });
    }
    function renderList() {
      listEl.textContent = "";
      var visible = visibleComments();
      visibleCommentCount.textContent = String(CONFIG.labels.nComments || "{n}").replace("{n}", String(visible.length));
      if (!visible.length) {
        listEl.appendChild(el("div", "empty", CONFIG.labels.empty));
        return;
      }
      visible.forEach(function(comment) {
        var thread = el(
          "article",
          "comment-card"
            + (activeCommentId === comment.id ? " active" : "")
            + (comment.status === "resolved" ? " resolved" : "")
        );
        thread.setAttribute("role", "button");
        thread.setAttribute("tabIndex", "0");
        thread.setAttribute("data-comment-id", comment.id);
        thread.setAttribute("data-active", activeCommentId === comment.id ? "true" : "false");
        if (activeCommentId === comment.id) thread.setAttribute("aria-current", "true");
        thread.setAttribute("aria-label", commentAuthorName(comment) + ": " + (comment.note || ""));

        var header = el("header", "comment-card-header");
        header.appendChild(createAvatar(comment, "comment-card-avatar"));
        var meta = el("span", "comment-card-meta");
        meta.appendChild(el("strong", "comment-card-author", commentAuthorName(comment)));
        appendTime(meta, "comment-card-time", comment.createdAt || comment.updatedAt);
        header.appendChild(meta);
        if (comment.status === "resolved") {
          var status = el("span", "comment-status");
          status.innerHTML = iconSvg("check");
          status.appendChild(document.createTextNode(CONFIG.labels.resolved));
          header.appendChild(status);
        }
        thread.appendChild(header);
        if (comment.note) thread.appendChild(el("div", "comment-card-copy", comment.note));

        var replies = repliesFor(comment).sort(function(a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        var repliesRow = el("div", "comment-card-replies");
        replies.slice(-3).forEach(function(reply) {
          repliesRow.appendChild(createAvatar(reply, "comment-card-reply-avatar"));
        });
        repliesRow.insertAdjacentHTML("beforeend", iconSvg("message"));
        repliesRow.appendChild(el(
          "span",
          "",
          String(CONFIG.labels.nReplies || "{n}").replace("{n}", String(replies.length))
        ));
        thread.appendChild(repliesRow);

        function activateComment() {
          activeCommentId = comment.id;
          currentTarget = null;
          activateTarget(comment);
          hideHover();
          render();
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
        listEl.appendChild(thread);
      });
    }
    function savedCommentHoverPoint(position, currentPosition) {
      var current = currentPosition || position;
      if (!position || !current || !finite(position.mx) || !finite(position.my)) return null;
      return { x:current.x + position.mx, y:current.y + position.my };
    }
    function markerPosition(comment) {
      var live = liveTargets[comment.elementId];
      var current = live && live.position ? live.position : comment.position;
      var position = {
        x:current.x,
        y:current.y,
        width:current.width,
        height:current.height
      };
      if (live && live.hoverPoint) position.hoverPoint = live.hoverPoint;
      if (finite(comment.position.mx) && finite(comment.position.my)) {
        position.mx = comment.position.mx;
        position.my = comment.position.my;
      }
      return position;
    }
    function savedMarkerPoint(comment) {
      var position = markerPosition(comment);
      return savedCommentHoverPoint(comment.position, position)
        || position.hoverPoint
        || { x:position.x, y:position.y };
    }
    function renderPins() {
      pinsEl.textContent = "";
      if (!commentMode) {
        pinsEl.hidden = true;
        return;
      }
      pinsEl.hidden = false;
      var visible = visibleComments();
      visible.forEach(function(comment) {
        var position = markerPosition(comment);
        if (!position) return;
        var marker = savedMarkerPoint(comment);
        var pin = el("button", "comment-saved-pin");
        pin.type = "button";
        pin.style.left = marker.x + "px";
        pin.style.top = marker.y + "px";
        var authorName = commentAuthorName(comment);
        pin.style.background = avatarColor(authorName);
        pin.setAttribute("data-status", comment.status === "resolved" ? "resolved" : "open");
        pin.setAttribute("data-active", activeCommentId === comment.id ? "true" : "false");
        pin.setAttribute("aria-label", CONFIG.labels.comment + ": " + authorName);
        pin.title = CONFIG.labels.comment + ": " + authorName;
        var content = el("span");
        content.appendChild(document.createTextNode(commentAuthorInitial(authorName)));
        if (comment.authorAvatarUrl) {
          var image = el("img", "comment-user-avatar-image");
          image.src = comment.authorAvatarUrl;
          image.alt = "";
          image.addEventListener("error", function() { image.hidden = true; });
          image.addEventListener("load", function() { image.hidden = false; });
          content.appendChild(image);
        }
        pin.appendChild(content);
        pin.addEventListener("click", function() {
          activeCommentId = comment.id;
          currentTarget = null;
          activateTarget(comment);
          hideHover();
          render();
          scrollCommentIntoView(comment.id);
        });
        pinsEl.appendChild(pin);
      });
    }
    function addSortMenuItem(label, role, selected, onClick) {
      var button = el("button");
      button.type = "button";
      button.setAttribute("role", role);
      button.setAttribute("aria-checked", selected ? "true" : "false");
      if (selected) button.setAttribute("aria-current", "true");
      button.innerHTML = iconSvg("check");
      button.appendChild(document.createTextNode(label));
      button.addEventListener("click", onClick);
      sortMenu.appendChild(button);
    }
    function renderSortMenu() {
      sortMenu.textContent = "";
      sortMenu.hidden = !sortMenuOpen;
      sortMenuToggle.setAttribute("aria-expanded", sortMenuOpen ? "true" : "false");
      if (!sortMenuOpen) return;
      addSortMenuItem(CONFIG.labels.sortNewest, "menuitemradio", sortMode === "newest", function() {
        sortMode = "newest";
        sortMenuOpen = false;
        render();
      });
      addSortMenuItem(CONFIG.labels.sortOldest, "menuitemradio", sortMode === "oldest", function() {
        sortMode = "oldest";
        sortMenuOpen = false;
        render();
      });
      var separator = el("i", "panel-menu-sep");
      separator.setAttribute("role", "separator");
      sortMenu.appendChild(separator);
      addSortMenuItem(CONFIG.labels.filterOpen, "menuitemcheckbox", filterCurrentPage, function() {
        filterCurrentPage = !filterCurrentPage;
        sortMenuOpen = false;
        render();
      });
      addSortMenuItem(CONFIG.labels.filterResolved, "menuitemcheckbox", filterShowResolved, function() {
        filterShowResolved = !filterShowResolved;
        sortMenuOpen = false;
        render();
      });
      addSortMenuItem(CONFIG.labels.filterMentioned, "menuitemcheckbox", filterRelatedToMe, function() {
        filterRelatedToMe = !filterRelatedToMe;
        sortMenuOpen = false;
        render();
      });
    }
    function renderLabels() {
      var unresolved = unresolvedCount();
      toggleLabel.textContent = CONFIG.labels.comments;
      toggleIcon.innerHTML = iconSvg("message");
      toggle.setAttribute("aria-label", CONFIG.labels.comments);
      toggle.title = CONFIG.labels.comments;
      countEl.textContent = String(unresolved);
      countEl.hidden = unresolved === 0;
      panelTitle.textContent = CONFIG.labels.comments;
      panelTitleIcon.innerHTML = iconSvg("message");
      panelClose.innerHTML = iconSvg("close");
      panelClose.setAttribute("aria-label", CONFIG.labels.close);
      panelClose.title = CONFIG.labels.close;
      panelUnresolvedCount.textContent = String(CONFIG.labels.unresolved || "{n}").replace("{n}", String(unresolved));
      panelUnresolvedCount.hidden = unresolved === 0;
      searchIcon.innerHTML = iconSvg("search");
      searchInput.placeholder = CONFIG.labels.searchPlaceholder;
      searchInput.setAttribute("aria-label", CONFIG.labels.searchPlaceholder);
      sortMenuToggle.innerHTML = iconSvg("arrow-down-up");
      sortMenuToggle.setAttribute("aria-label", CONFIG.labels.sortAndFilter);
      sortMenuToggle.title = CONFIG.labels.sortAndFilter;
      panel.setAttribute("aria-label", CONFIG.labels.comments);
      popoverClose.innerHTML = iconSvg("close");
      popoverClose.setAttribute("aria-label", CONFIG.labels.close);
      popoverClose.title = CONFIG.labels.close;
      renderSortMenu();
    }
    function render() {
      renderLabels();
      renderList();
      renderPins();
      renderPopover();
    }
    function anchorPoint(target, savedComment) {
      var position = target && target.position
        ? target.position
        : target
          && finite(target.x)
          && finite(target.y)
          && finite(target.width)
          && finite(target.height)
          ? target
          : null;
      if (!position) return null;
      var saved = savedComment ? savedCommentHoverPoint(savedComment.position, position) : null;
      if (saved) return saved;
      if (target.hoverPoint && finite(target.hoverPoint.x) && finite(target.hoverPoint.y)) {
        return { x:target.hoverPoint.x, y:target.hoverPoint.y };
      }
      return {
        x:position.x + Math.min(position.width, 24),
        y:position.y + Math.min(position.height, 24)
      };
    }
    function clampPopoverCoordinate(value, min) {
      if (!finite(value)) return min;
      return Math.max(min, Math.round(value));
    }
    function clampPopoverRange(value, min, max) {
      if (!finite(value)) return min;
      return Math.max(min, Math.min(max, Math.round(value)));
    }
    function clampPopoverPosition(left, top, size, width, height, maxHeightLimit) {
      var minLeft = POPOVER_PAD;
      var minTop = POPOVER_PAD;
      var maxLeft = Math.max(minLeft, width - size.width - POPOVER_PAD);
      var effectiveHeight = finite(maxHeightLimit)
        ? Math.min(size.height, Math.max(POPOVER_MIN_VISIBLE_HEIGHT, Math.floor(maxHeightLimit)))
        : size.height;
      var maxTop = Math.max(minTop, height - effectiveHeight - POPOVER_PAD);
      var clampedTop = clampPopoverRange(top, minTop, maxTop);
      var visibleHeight = Math.floor(height - clampedTop - POPOVER_PAD);
      var limitedHeight = finite(maxHeightLimit)
        ? Math.min(visibleHeight, Math.floor(maxHeightLimit))
        : visibleHeight;
      return {
        left:clampPopoverRange(left, minLeft, maxLeft),
        top:clampedTop,
        maxHeight:Math.max(POPOVER_MIN_VISIBLE_HEIGHT, limitedHeight)
      };
    }
    function positionPopover() {
      if (popover.hidden) return;
      var comment = findComment(activeCommentId);
      var target = comment ? markerPosition(comment) : currentTarget;
      var anchor = anchorPoint(target, comment);
      if (!anchor) return;
      var width = Math.max(1, stage.clientWidth || window.innerWidth);
      var height = Math.max(1, stage.clientHeight || window.innerHeight);
      var availableHeight = Math.max(POPOVER_MIN_VISIBLE_HEIGHT, height - POPOVER_PAD * 2);
      popover.style.setProperty("--comment-popover-top", "0px");
      popover.style.maxHeight = availableHeight + "px";
      var size = {
        width:popover.offsetWidth || Math.min(POPOVER_DEFAULT_WIDTH, width - POPOVER_PAD * 2),
        height:Math.min(popover.offsetHeight || POPOVER_EXPANDED_ESTIMATED_HEIGHT, availableHeight)
      };
      var viewportRight = width;
      var viewportBottom = height;
      var candidates = [
        {
          corner:"bottom-right",
          left:anchor.x + POPOVER_GAP,
          top:anchor.y,
          availableWidth:viewportRight - anchor.x - POPOVER_GAP - POPOVER_PAD,
          availableHeight:viewportBottom - anchor.y - POPOVER_PAD
        },
        {
          corner:"bottom-left",
          left:anchor.x - size.width - POPOVER_GAP,
          top:anchor.y,
          availableWidth:anchor.x - POPOVER_GAP - POPOVER_PAD,
          availableHeight:viewportBottom - anchor.y - POPOVER_PAD
        },
        {
          corner:"top-right",
          left:anchor.x + POPOVER_GAP,
          top:anchor.y - size.height,
          availableWidth:viewportRight - anchor.x - POPOVER_GAP - POPOVER_PAD,
          availableHeight:anchor.y - POPOVER_PAD
        },
        {
          corner:"top-left",
          left:anchor.x - size.width - POPOVER_GAP,
          top:anchor.y - size.height,
          availableWidth:anchor.x - POPOVER_GAP - POPOVER_PAD,
          availableHeight:anchor.y - POPOVER_PAD
        }
      ].filter(function(item) {
        return finite(item.availableWidth) && finite(item.availableHeight);
      });
      var ranked = candidates.map(function(item) {
        return {
          corner:item.corner,
          left:item.left,
          top:item.top,
          availableHeight:item.availableHeight,
          fits:item.availableWidth >= size.width && item.availableHeight >= size.height,
          visibleArea:Math.max(0, Math.min(size.width, item.availableWidth))
            * Math.max(0, Math.min(size.height, item.availableHeight)),
          preference:item.corner === "bottom-right" ? 4
            : item.corner === "bottom-left" ? 3
              : item.corner === "top-right" ? 2 : 1
        };
      }).sort(function(a, b) {
        return Number(b.fits) - Number(a.fits)
          || b.visibleArea - a.visibleArea
          || b.preference - a.preference;
      });
      var best = ranked[0];
      var style;
      if (best) {
        var nextHeightLimit = best.fits
          ? size.height
          : Math.max(POPOVER_MIN_VISIBLE_HEIGHT, best.availableHeight);
        style = clampPopoverPosition(best.left, best.top, size, width, height, nextHeightLimit);
      } else {
        var fallbackLeft = anchor.x + POPOVER_PAD + size.width <= viewportRight - POPOVER_PAD
          ? anchor.x + POPOVER_PAD
          : anchor.x - size.width - POPOVER_PAD;
        style = clampPopoverPosition(fallbackLeft, anchor.y + POPOVER_PAD, size, width, height);
      }
      popover.style.setProperty("--comment-popover-top", style.top + "px");
      popover.style.left = clampPopoverCoordinate(style.left, POPOVER_PAD) + "px";
      popover.style.top = clampPopoverCoordinate(style.top, POPOVER_PAD) + "px";
      popover.style.maxHeight = style.maxHeight + "px";
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
        positionPopover();
        return;
      }
      if (data.type === "od:comment-target") {
        var target = safeTarget(data);
        if (!target || !capabilities.canCreate) return;
        currentTarget = target;
        activeCommentId = null;
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
        if (activeCommentId && !findComment(activeCommentId)) activeCommentId = null;
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
    var dragState = null;
    function startDrag(event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      dragState = {
        pointerId:event.pointerId,
        startX:event.clientX,
        startY:event.clientY,
        left:parseFloat(popover.style.left) || popover.offsetLeft,
        top:parseFloat(popover.style.top) || popover.offsetTop
      };
      popover.classList.add("comment-popover-dragging");
      try { popoverDrag.setPointerCapture(event.pointerId); } catch (_) {}
      document.addEventListener("pointermove", moveDrag);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    }
    function moveDrag(event) {
      if (!dragState) return;
      var width = popover.offsetWidth;
      var height = popover.offsetHeight;
      var maxLeft = Math.max(14, stage.clientWidth - width - 14);
      var maxTop = Math.max(14, stage.clientHeight - height - 14);
      var left = Math.max(14, Math.min(maxLeft, dragState.left + event.clientX - dragState.startX));
      var top = Math.max(14, Math.min(maxTop, dragState.top + event.clientY - dragState.startY));
      popover.style.left = Math.round(left) + "px";
      popover.style.top = Math.round(top) + "px";
    }
    function endDrag() {
      if (!dragState) return;
      dragState = null;
      popover.classList.remove("comment-popover-dragging");
      document.removeEventListener("pointermove", moveDrag);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
    }
    toggle.addEventListener("click", function() {
      if (!connected) postHost("ready", {});
      setCommentsOpen(!commentMode);
    });
    searchInput.addEventListener("input", function() {
      searchQuery = searchInput.value;
      renderList();
      renderPins();
    });
    sortMenuToggle.addEventListener("click", function() {
      sortMenuOpen = !sortMenuOpen;
      renderSortMenu();
    });
    document.addEventListener("click", function(event) {
      if (!sortMenuOpen || sortMenuWrap.contains(event.target)) return;
      sortMenuOpen = false;
      renderSortMenu();
    });
    document.addEventListener("keydown", function(event) {
      if (event.key !== "Escape" || !sortMenuOpen) return;
      event.preventDefault();
      sortMenuOpen = false;
      renderSortMenu();
      sortMenuToggle.focus();
    });
    panelClose.addEventListener("click", function() { setCommentsOpen(false); });
    popoverClose.addEventListener("click", closePopover);
    popoverDrag.addEventListener("pointerdown", startDrag);
    popover.addEventListener("keydown", function(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover();
      }
    });
    frame.addEventListener("load", function() {
      sendCommentMode();
      activateTarget(findComment(activeCommentId) || currentTarget);
    });
    window.addEventListener("message", handleFrameMessage);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("pagehide", function() {
      if (popoverPositionFrame) cancelAnimationFrame(popoverPositionFrame);
      popoverPositionFrame = 0;
      if (popoverResizeObserver) popoverResizeObserver.disconnect();
      postHost("closed", {});
    });
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
    observePopoverResize();
    render();
    setTimeout(sendCommentMode, 0);
  })();
  </script>
</body>
</html>`;
}
