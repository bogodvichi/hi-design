import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopExportArtifactInput } from '@open-design/sidecar-proto';
import { renderProjectCover, selectProjectCoverEntry } from '../../src/artifacts/project-cover.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function renderer(check: (input: DesktopExportArtifactInput) => void | Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'od-cover-test-'));
  roots.push(root);
  const output = path.join(root, 'cover.png');
  return { output, render: vi.fn(async (input: DesktopExportArtifactInput) => {
    await check(input);
    await writeFile(output, Buffer.from('cover-png'));
    return { ok: true, path: output };
  }) };
}

describe('project community covers', () => {
  it('keeps the selected entry and discovers non-HTML entries without selecting generated manifests', () => {
    const files = ['SKILL.md', 'open-design.json', 'trip.pdf', 'notes.txt'].map((name) => ({ name }));
    expect(selectProjectCoverEntry(files)).toBe('trip.pdf');
    expect(selectProjectCoverEntry(files, 'notes.txt')).toBe('notes.txt');
    expect(selectProjectCoverEntry(files, 'missing.html')).toBe('trip.pdf');
    expect(selectProjectCoverEntry([{ name: 'SKILL.md' }])).toBeNull();
  });

  it('keeps a large HTML document and its asset base while limiting the cover to a viewport', async () => {
    const source = '<html><head></head><body>' + 'x'.repeat(7_000_000) + '</body></html>';
    const capture = await renderer((input) => {
      expect(input.html).toContain('x'.repeat(7_000_000));
      expect(input.viewportOnly).toBe(true);
      expect(input.baseHref).toBe('http://127.0.0.1:1234/raw/');
    });
    expect(await renderProjectCover({ file: { name: 'index.html', buffer: Buffer.from(source) }, title: 'Demo', baseHref: 'http://127.0.0.1:1234/raw/', exporter: capture.render })).toEqual(Buffer.from('cover-png'));
    await expect(access(capture.output)).rejects.toThrow();
  });

  it.each(['pdf', 'png', 'svg', 'mp4', 'mp3'])('serves %s bytes to the renderer without decoding them as HTML or exposing project paths', async (extension) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([1200, 675]);
    const data = extension === 'pdf' ? Buffer.from(await pdf.save()) : Buffer.from([0, 255, 200, 1]);
    let sourceUrl = '';
    const capture = await renderer(async (input) => {
      sourceUrl = (input.sourceUrl ?? input.html.match(/(?:src)="(http:[^"]+)"/)![1]!).replace(/#.*$/, '');
      expect(input.html).not.toContain('file://');
      expect(input.baseHref).toBeUndefined();
      expect(Buffer.from(await (await fetch(sourceUrl)).arrayBuffer())).toEqual(data);
      expect((await fetch(sourceUrl, { headers: { Range: 'bytes=1-2' } })).status).toBe(206);
      expect((await fetch(new URL('/other-file', sourceUrl))).status).toBe(404);
      if (extension === 'pdf') expect(input.sourceUrl).toContain('#page=1&toolbar=0');
    });
    await renderProjectCover({ file: { name: `file.${extension}`, buffer: data }, title: 'Media', exporter: capture.render });
    await expect(fetch(sourceUrl)).rejects.toThrow();
  });

  it.each([
    ['docx', 'word/document.xml', '<w:document><w:p><w:r><w:t>Document content</w:t></w:r></w:p></w:document>', 'Document content'],
    ['pptx', 'ppt/slides/slide1.xml', '<p:sld><a:t>First slide</a:t></p:sld>', 'First slide'],
    ['xlsx', 'xl/worksheets/sheet1.xml', '<worksheet><row><c><v>42</v></c></row></worksheet>', '42'],
  ])('uses the existing %s content preview', async (extension, entry, xml, text) => {
    const zip = new JSZip();
    zip.file(entry, xml);
    const capture = await renderer((input) => { expect(input.html).toContain(text); });
    await renderProjectCover({ file: { name: `file.${extension}`, buffer: await zip.generateAsync({ type: 'nodebuffer' }) }, title: 'Office', exporter: capture.render });
  });

  it.each(['md', 'txt', 'ts', 'zip', 'sketch.json'])('generates a cover for %s with escaped content and file metadata', async (extension) => {
    const capture = await renderer((input) => {
      expect(input.html).toContain('Project &lt;title&gt;');
      expect(input.html).toContain(`file.${extension}`);
      if (['md', 'txt', 'ts'].includes(extension)) expect(input.html).toContain('&lt;script&gt;');
    });
    await renderProjectCover({ file: { name: `file.${extension}`, buffer: Buffer.from('<script>') }, title: 'Project <title>', exporter: capture.render });
  });

  it('falls back to a file cover when a content renderer fails', async () => {
    const capture = await renderer(() => {});
    capture.render.mockImplementationOnce(async () => ({ ok: false, path: '' }));
    await renderProjectCover({ file: { name: 'index.html', buffer: Buffer.from('<h1>Broken</h1>') }, title: 'Fallback', exporter: capture.render });
    expect(capture.render).toHaveBeenCalledTimes(2);
    expect(capture.render.mock.calls[1]![0].html).toContain('file-icon');
  });
});
