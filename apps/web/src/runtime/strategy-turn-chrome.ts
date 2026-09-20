import type { AppliedPluginSnapshot } from '@open-design/contracts';

/**
 * An applied snapshot carries `strategy` only when the daemon bound an internal
 * strategy package to the turn — `AppliedPluginSnapshotSchema.strategy` stays
 * unset for every ordinary plugin apply. The user never picked that package, so
 * its title and version are implementation detail rather than context they
 * attached to the message, and the chat must not surface either.
 */
export function isInternalStrategySnapshot(
  snapshot: Pick<AppliedPluginSnapshot, 'strategy'> | null | undefined,
): boolean {
  return Boolean(snapshot?.strategy);
}
