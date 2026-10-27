import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportProjectAsHtmlReviewZip } from '../../src/runtime/uedro-html-review-export';

afterEach(() => vi.unstubAllGlobals());

describe('exportProjectAsHtmlReviewZip', () => {
  it('fetches the HTML-review archive for the current page, not the Axure archive', async () => {
    const zip = new Blob(['PK-archive'], { type: 'application/zip' });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => zip }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await exportProjectAsHtmlReviewZip({
      projectId: 'p 123',
      projectName: '页面: 测试',
      entryFile: 'screens/index.html',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/p%20123/archive?format=html-review&entryFile=screens%2Findex.html',
      {},
    );
    expect(result).toMatchObject({ ok: true, zipName: '页面 测试' });
    if (result.ok) expect(result.blob).toBe(zip);
  });

  it('does not pass non-HTML active files as the ZIP entry', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['PK'], { type: 'application/zip' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await exportProjectAsHtmlReviewZip({ projectId: 'p', entryFile: 'README.md' });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p/archive?format=html-review', {});
  });

  it('surfaces server-side HTML export failures instead of uploading an invalid ZIP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: '当前项目没有 HTML 页面' } }),
    })));
    await expect(exportProjectAsHtmlReviewZip({ projectId: 'p' }))
      .resolves.toEqual({ ok: false, error: '当前项目没有 HTML 页面' });
  });
});
