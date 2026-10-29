import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyProjectFileTextEdits } from '@open-design/contracts';
import { createProjectFileTextPatch } from '../../src/runtime/project-file-text-patch';
import { applyManualEditPatch } from '../../src/edit-mode/source-patches';

describe('incremental file writes', () => {
  it('keeps a style edit below four KiB even when HTML serialization changes both ends of a seven MiB file', async () => {
    const dom = new JSDOM('');
    globalThis.DOMParser = dom.window.DOMParser;
    try {
      // Capture the editor's real serialization changes on a small document;
      // parsing a multi-MiB DOM is unrelated to this diff/round-trip contract.
      const template = '<!DOCTYPE html><html><body><div id="root"></div><!--LARGE_PAYLOAD--></body></html>\n';
      const result = applyManualEditPatch(template, { kind: 'set-style', id: 'runtime:body > div:nth-of-type(1) > p:nth-of-type(1)', styles: { color: 'blue' } });
      expect(result.ok).toBe(true);
      expect(result.source).toContain('<!--LARGE_PAYLOAD-->');
      const payload = 'x'.repeat(7 * 1024 * 1024);
      const before = template.replace('LARGE_PAYLOAD', payload);
      const after = result.source.replace('LARGE_PAYLOAD', payload);
      const patch = await createProjectFileTextPatch(before, after);
      expect(new TextEncoder().encode(JSON.stringify(patch)).length).toBeLessThan(4096);
      expect(applyProjectFileTextEdits(before, patch.edits)).toBe(after);
    } finally {
      Reflect.deleteProperty(globalThis, 'DOMParser');
      dom.window.close();
    }
  });
});
