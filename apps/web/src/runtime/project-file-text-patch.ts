import { diffChars } from 'diff';
import type { ProjectFileTextPatch } from '@open-design/contracts';
import { artifactVersionContentDigest } from '../artifacts/version-origin';

export async function createProjectFileTextPatch(before: string, after: string): Promise<ProjectFileTextPatch> {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const edits: ProjectFileTextPatch['edits'] = [];
  let offset = start;
  let pending: ProjectFileTextPatch['edits'][number] | undefined;
  for (const change of diffChars(before.slice(start, oldEnd), after.slice(start, newEnd))) {
    if (!change.added && !change.removed) {
      if (pending) edits.push(pending);
      pending = undefined;
      offset += change.value.length;
    } else {
      pending ??= { start: offset, deleteCount: 0, insert: '' };
      if (change.removed) {
        pending.deleteCount += change.value.length;
        offset += change.value.length;
      } else pending.insert += change.value;
    }
  }
  if (pending) edits.push(pending);
  return { baseDigest: await artifactVersionContentDigest(before), edits };
}
