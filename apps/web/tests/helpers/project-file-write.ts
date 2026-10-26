import { applyProjectFileTextEdits, type ProjectFileTextPatch } from '@open-design/contracts';

export function projectFileWriteContent(body: BodyInit | null | undefined, currentSource: string): string {
  const payload = JSON.parse(String(body)) as { content?: string; patch?: ProjectFileTextPatch };
  return payload.patch ? applyProjectFileTextEdits(currentSource, payload.patch.edits) : payload.content!;
}
