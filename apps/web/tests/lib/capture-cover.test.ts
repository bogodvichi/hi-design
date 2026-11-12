// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@open-design/host', () => ({
  isOpenDesignHostAvailable: () => true,
}));

import { captureCoverForEditedHtml } from '../../src/lib/capture-cover';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('captureCoverForEditedHtml', () => {
  it('asks the daemon to render the exact HTML file that was edited', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { coverDigest: 'digest-1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const digest = await captureCoverForEditedHtml(
      'project-1',
      '<h1>edited</h1>',
      'pages/edited.html',
    );

    expect(digest).toBe('digest-1');
    // Without ?file=, the daemon falls back to metadata.entryFile (or the
    // first HTML alphabetically), which can be a different page than the one
    // the user just edited.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/cover/generate?file=pages%2Fedited.html',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps workspace identity headers on the regenerate request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { coverDigest: 'digest-2' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await captureCoverForEditedHtml('project-1', '<h1>edited</h1>', 'index.html', {
      headers: { 'x-od-workspace-id': 'workspace-1' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/cover/generate?file=index.html',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-od-workspace-id': 'workspace-1' }),
      }),
    );
  });
});
