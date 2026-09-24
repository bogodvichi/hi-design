import { normalizeRunContextSelection } from './chat-run-context.js';

export interface RunMcpPlan {
  /** MCPs persisted on the project as long-lived capabilities. */
  projectBindingIds: string[];
  /** MCPs the user explicitly picked for this turn. */
  explicitTurnSelectionIds: string[];
  /** MCPs a workflow/contract explicitly requires this turn. */
  requiredServerIds: string[];
  /** MCPs supplied by a run-scoped tool bundle. */
  runScopedServerIds: string[];
  /** MCPs explicitly referenced in the user-authored request. */
  mentionedServerIds: string[];
  /** Complete runtime capability set that should be mounted for the turn. */
  runtimeServerIds: string[];
}

function uniqueIds(...lists: Iterable<string>[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function buildRunMcpPlan({
  projectBindingIds = [],
  context,
  runScopedServerIds = [],
  mentionedServerIds = [],
}: {
  projectBindingIds?: Iterable<string>;
  context?: unknown;
  runScopedServerIds?: Iterable<string>;
  mentionedServerIds?: Iterable<string>;
}): RunMcpPlan {
  const normalized = normalizeRunContextSelection(context);
  const explicitTurnSelectionIds = uniqueIds(normalized.mcpServerIds ?? []);
  const requiredServerIds = uniqueIds(normalized.requiredMcpServerIds ?? []);
  const projectBindings = uniqueIds(projectBindingIds);
  const runScoped = uniqueIds(runScopedServerIds);
  const mentioned = uniqueIds(mentionedServerIds);

  return {
    projectBindingIds: projectBindings,
    explicitTurnSelectionIds,
    requiredServerIds,
    runScopedServerIds: runScoped,
    mentionedServerIds: mentioned,
    runtimeServerIds: uniqueIds(
      projectBindings,
      explicitTurnSelectionIds,
      requiredServerIds,
      runScoped,
      mentioned,
    ),
  };
}
