const WORKSPACE_CONTEXT_KINDS = new Set([
  'design-files',
  'design-system',
  'file',
  'folder',
  'project',
  'local-code',
  'browser',
  'terminal',
  'side-chat',
  'live-artifact',
]);

export interface WorkspaceContextItem {
  id: string;
  kind: string;
  label: string;
  tabId?: string;
  path?: string;
  absolutePath?: string;
  url?: string;
  title?: string;
}

export interface RunContextSelection {
  skillIds?: string[];
  pluginIds?: string[];
  /** MCP servers the user explicitly selected for this turn. */
  mcpServerIds?: string[];
  /** MCP servers a workflow/contract requires this turn to call. */
  requiredMcpServerIds?: string[];
  connectorIds?: string[];
  workspaceItems?: WorkspaceContextItem[];
}

type MetadataContextRef = {
  id?: unknown;
  title?: unknown;
  label?: unknown;
  name?: unknown;
  provider?: unknown;
  transport?: unknown;
  status?: unknown;
  accountLabel?: unknown;
};

type ProjectMetadataContext = {
  contextPlugins?: unknown;
  contextMcpServers?: unknown;
  contextConnectors?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeWorkspaceContextItems(items: unknown): WorkspaceContextItem[] {
  if (!Array.isArray(items)) return [];
  const out: WorkspaceContextItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const kind = cleanString(item.kind, 64);
    if (!WORKSPACE_CONTEXT_KINDS.has(kind)) continue;
    const id = cleanString(item.id, 240);
    const label = cleanString(item.label, 240);
    if (!id || !label) continue;
    const dedupeKey = `${kind}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normalized: WorkspaceContextItem = { id, kind, label };
    const tabId = cleanString(item.tabId, 240);
    const pathValue = cleanString(item.path, 500);
    const absolutePath = cleanString(item.absolutePath, 1000);
    const url = cleanString(item.url, 1000);
    const title = cleanString(item.title, 500);
    if (tabId) normalized.tabId = tabId;
    if (pathValue) normalized.path = pathValue;
    if (absolutePath) normalized.absolutePath = absolutePath;
    if (url) normalized.url = url;
    if (title) normalized.title = title;
    out.push(normalized);
  }
  return out;
}

export function normalizeRunContextSelection(value: unknown): RunContextSelection {
  if (!isRecord(value)) return {};
  const stringList = (items: unknown): string[] => {
    if (!Array.isArray(items)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  };
  return {
    skillIds: stringList(value.skillIds),
    pluginIds: stringList(value.pluginIds),
    mcpServerIds: stringList(value.mcpServerIds),
    requiredMcpServerIds: stringList(value.requiredMcpServerIds),
    connectorIds: stringList(value.connectorIds),
    workspaceItems: normalizeWorkspaceContextItems(value.workspaceItems),
  };
}

export function mergeRunContextSelections(...contexts: unknown[]): RunContextSelection {
  const merged: Required<RunContextSelection> = {
    skillIds: [],
    pluginIds: [],
    mcpServerIds: [],
    requiredMcpServerIds: [],
    connectorIds: [],
    workspaceItems: [],
  };
  const listKeys = [
    'skillIds',
    'pluginIds',
    'mcpServerIds',
    'requiredMcpServerIds',
    'connectorIds',
  ] as const;
  const workspaceSeen = new Set<string>();
  for (const context of contexts) {
    const normalized = normalizeRunContextSelection(context);
    for (const key of listKeys) {
      const seen = new Set(merged[key]);
      for (const id of normalized[key] ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          merged[key].push(id);
        }
      }
    }
    for (const item of normalized.workspaceItems ?? []) {
      const key = `${item.kind}:${item.id}`;
      if (workspaceSeen.has(key)) continue;
      workspaceSeen.add(key);
      merged.workspaceItems.push(item);
    }
  }
  return Object.fromEntries(
    Object.entries(merged).filter(([, ids]) => ids.length > 0),
  ) as RunContextSelection;
}

export function projectMetadataContextSelection(metadata: unknown): RunContextSelection {
  if (!isRecord(metadata)) return {};
  const contextMetadata = metadata as ProjectMetadataContext;
  const idsFromRefs = (refs: unknown): string[] => (
    Array.isArray(refs)
      ? refs
          .map((item) => isRecord(item) ? item.id : undefined)
          .filter((id): id is string => typeof id === 'string')
      : []
  );
  return {
    pluginIds: idsFromRefs(contextMetadata.contextPlugins),
    mcpServerIds: idsFromRefs(contextMetadata.contextMcpServers),
    connectorIds: idsFromRefs(contextMetadata.contextConnectors),
  };
}

function formatContextRefList(ids: string[], refs: unknown, titleKey: 'title' | 'label' | 'name' = 'title') {
  const byId = new Map<string, MetadataContextRef>();
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (isRecord(ref) && typeof ref.id === 'string') byId.set(ref.id, ref);
    }
  }
  return ids
    .map((id) => {
      const ref = byId.get(id);
      const titleValue = ref?.[titleKey];
      const label =
        typeof titleValue === 'string' && titleValue.trim()
          ? titleValue.trim()
          : typeof ref?.label === 'string' && ref.label.trim()
            ? ref.label.trim()
            : typeof ref?.name === 'string' && ref.name.trim()
              ? ref.name.trim()
              : id;
      const meta = [
        ref?.provider,
        ref?.transport,
        ref?.status,
        ref?.accountLabel,
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' · ');
      return `- ${label} (\`${id}\`)${meta ? ` — ${meta}` : ''}`;
    })
    .join('\n');
}

function formatWorkspaceContextList(items: WorkspaceContextItem[]) {
  return items
    .map((item, index) => {
      const details = [
        item.path ? `path: \`${item.path}\`` : null,
        item.absolutePath ? `absolute: \`${item.absolutePath}\`` : null,
        item.url ? `url: ${item.url}` : null,
        item.title ? `title: ${item.title}` : null,
        item.tabId ? `tab: \`${item.tabId}\`` : null,
      ].filter(Boolean).join(' | ');
      return `${index + 1}. ${item.kind}: ${item.label} (\`${item.id}\`)${details ? ` — ${details}` : ''}`;
    })
    .join('\n');
}

function renderWorkspaceContextToolHints(items: WorkspaceContextItem[]) {
  if (items.length === 0) return '';
  const kinds = new Set(items.map((item) => item.kind).filter(Boolean));
  const hints: string[] = [];
  if (kinds.has('browser')) {
    hints.push(
      '- Browser tabs: use the selected browser tab URL/title as the target for requests about logos, fonts, images, colors, motion code, element/page screenshots, accessibility, OG/meta tags, or page structure. Prefer mounted browser automation / browser-use style tools when available (DOM snapshot, page screenshot, element screenshot, accessibility tree, evaluated JavaScript). If only URL/title context is available and no inspection tool is mounted, say that explicitly and do not invent page internals.',
    );
  }
  if (kinds.has('terminal')) {
    hints.push(
      '- Terminal tabs: treat the selected terminal tab as the target shell/session. If the exact scrollback is not included in the prompt, run safe project-local read-only commands or ask for the terminal transcript instead of guessing hidden output.',
    );
  }
  if (kinds.has('file') || kinds.has('folder') || kinds.has('design-files')) {
    hints.push(
      '- File and Design Files tabs: use project-relative paths exactly as shown. Read before editing, and keep generated screenshots/briefs/assets in Design Files when the user asks to capture or extract references.',
    );
  }
  if (kinds.has('project')) {
    hints.push(
      '- Referenced projects: use the absolute path as a read-only reference project when present. Search and read relevant files before applying ideas to the current project; do not edit the referenced project unless the user explicitly asks.',
    );
  }
  if (kinds.has('local-code')) {
    hints.push(
      '- Local code folders: use the absolute path as read-only implementation context. Inspect files under that folder when useful, align with its conventions, and make edits only in the active HiDesign project unless the user explicitly asks otherwise.',
    );
  }
  if (kinds.has('live-artifact')) {
    hints.push(
      '- Live artifact tabs: treat the selected live artifact as the preview target. Inspect or modify its source files rather than editing generated runtime output when possible.',
    );
  }
  return hints.join('\n');
}

export function renderRunContextPrompt(selection: unknown, metadata: unknown) {
  const projectContext = projectMetadataContextSelection(metadata);
  const turnContext = normalizeRunContextSelection(selection);
  const context = mergeRunContextSelections(projectContext, turnContext);
  const metadataRecord = isRecord(metadata) ? metadata : {};
  const lines: string[] = [];
  if (Array.isArray(context.workspaceItems) && context.workspaceItems.length > 0) {
    lines.push('### Active workspace context');
    lines.push(
      'The user selected these workspace contexts or HiDesign inferred the currently focused workspace tab. Use them as the default target for phrases like "this", "current", "the browser", "the terminal", "that file", or "the referenced code/project" unless the user says otherwise. Use project-relative paths exactly when reading or editing project files, and treat absolute local paths as reference context unless explicitly asked to edit them.',
    );
    lines.push(formatWorkspaceContextList(context.workspaceItems));
    const toolHints = renderWorkspaceContextToolHints(context.workspaceItems);
    if (toolHints) lines.push(toolHints);
  }
  if (Array.isArray(context.pluginIds) && context.pluginIds.length > 0) {
    lines.push('### Selected plugins');
    lines.push(
      'The user selected these plugins as run context. When an active plugin snapshot is pinned, follow that executable plugin block; otherwise combine these plugins as requested references.',
    );
    lines.push(formatContextRefList(context.pluginIds, metadataRecord.contextPlugins, 'title'));
  }
  const projectMcpIds = projectContext.mcpServerIds ?? [];
  if (projectMcpIds.length > 0) {
    lines.push(
      '### Project MCP bindings',
      'These MCP servers are available to this project. They are capabilities, not a requirement to call them on every turn. Use them only when relevant, explicitly selected for this turn, or required by the task.',
      formatContextRefList(projectMcpIds, metadataRecord.contextMcpServers, 'label'),
    );
  }

  const requiredMcpIds = turnContext.requiredMcpServerIds ?? [];
  const requiredMcpSet = new Set(requiredMcpIds);
  const selectedMcpIds = (turnContext.mcpServerIds ?? []).filter((id) => !requiredMcpSet.has(id));
  if (selectedMcpIds.length > 0) {
    lines.push(...selectedMcpContextLines(selectedMcpIds, metadataRecord));
  }
  if (requiredMcpIds.length > 0) {
    lines.push(...requiredMcpContextLines(requiredMcpIds, metadataRecord));
  }
  if (Array.isArray(context.connectorIds) && context.connectorIds.length > 0) {
    lines.push('### Selected connectors');
    lines.push(
      'The user selected these connectors for this run. Discover available read-only connector tools first with `"$OD_NODE_BIN" "$OD_BIN" tools connectors list --format compact`, then execute relevant tools through `tools connectors execute`; do not ask for a data source that is already selected.',
    );
    lines.push(formatContextRefList(context.connectorIds, metadataRecord.contextConnectors, 'name'));
  }
  if (lines.length === 0) return '';
  return ['## Selected run context', ...lines].join('\n');
}

function selectedMcpContextLines(
  serverIds: string[],
  metadata: Record<string, unknown>,
): string[] {
  return [
    '### Selected MCP servers',
    'The user explicitly selected these MCP servers for this turn. Use a selected server when it is relevant to the request, and prefer it over general knowledge or local fallback for information/actions that server is intended to provide. Do not make a no-op tool call merely to satisfy the selection. If a needed selected-server tool call fails, report the failure clearly rather than silently substituting another source.',
    formatContextRefList(serverIds, metadata.contextMcpServers, 'label'),
  ];
}

function requiredMcpContextLines(
  serverIds: string[],
  metadata: Record<string, unknown>,
): string[] {
  return [
    '### Required MCP servers',
    'The current task explicitly requires these MCP servers. Before answering, make at least one relevant tool call to each required server. If a required server is unavailable or its tool call fails, report that failure clearly; do not silently substitute local files or general knowledge unless the user asks for a fallback.',
    formatContextRefList(serverIds, metadata.contextMcpServers, 'label'),
  ];
}

/**
 * Native prompt mode deliberately omits Open Design's general run-context
 * prompt, but a context-only MCP pick has no inline `@server` token for the
 * agent to see. Preserve just that explicit tool-use intent so choosing an MCP
 * from the composer "+" menu behaves the same as mentioning it inline.
 */
export function renderSelectedMcpRunContextPrompt(selection: unknown, metadata: unknown) {
  const turnContext = normalizeRunContextSelection(selection);
  const selectedMcpIds = turnContext.mcpServerIds ?? [];
  const requiredMcpIds = turnContext.requiredMcpServerIds ?? [];
  if (selectedMcpIds.length === 0 && requiredMcpIds.length === 0) return '';

  const metadataRecord = isRecord(metadata) ? metadata : {};
  const requiredMcpSet = new Set(requiredMcpIds);
  const preferredOnlyIds = selectedMcpIds.filter((id) => !requiredMcpSet.has(id));

  return [
    '## Selected run context',
    ...(preferredOnlyIds.length > 0
      ? selectedMcpContextLines(preferredOnlyIds, metadataRecord)
      : []),
    ...(requiredMcpIds.length > 0
      ? requiredMcpContextLines(requiredMcpIds, metadataRecord)
      : []),
  ].join('\n');
}
