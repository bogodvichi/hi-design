// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime/axure-export', () => ({ exportProjectAsAxureZip: vi.fn() }));
vi.mock('../../src/runtime/uedro-html-review-export', () => ({ exportProjectAsHtmlReviewZip: vi.fn() }));
vi.mock('../../src/state/projects', () => ({ getProject: vi.fn(async () => null) }));

import { ReviewManuscriptUpdateModal } from '../../src/components/ReviewManuscriptUpdateModal';
import { exportProjectAsAxureZip } from '../../src/runtime/axure-export';
import { exportProjectAsHtmlReviewZip } from '../../src/runtime/uedro-html-review-export';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HTML review manuscript update', () => {
  it('re-uploads the current project as an HTML ZIP, then confirms the new manuscript', async () => {
    vi.mocked(exportProjectAsHtmlReviewZip).mockResolvedValue({
      ok: true,
      blob: new Blob(['PK-content'], { type: 'application/zip' }),
      zipName: 'html-review',
    });
    const calls: Array<{ url: string; body?: BodyInit | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      calls.push({ url: path, body: init?.body });
      if (path.endsWith('/reUploadManuscript')) {
        return { ok: true, json: async () => ({
          ok: true, data: { manuscriptId: 'old-1', middleManuscriptId: 'middle-1', reviewType: '12' },
        }) };
      }
      if (path.endsWith('/reUploadConfirm')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error('Unexpected request ' + path);
    }));

    render(<ReviewManuscriptUpdateModal
      open
      reviewId="review-1"
      manuscriptId="old-1"
      category="12"
      projectId="project-1"
      onClose={() => {}}
    />);
    const source = screen.getByRole('button', { name: '来自当前项目' }) as HTMLButtonElement;
    expect(source.disabled).toBe(false);
    fireEvent.click(source);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(calls.map((c) => c.url)).toEqual([
      '/api/hik/uedro/reUploadManuscript',
      '/api/hik/uedro/reUploadConfirm',
    ]));
    expect(exportProjectAsHtmlReviewZip).toHaveBeenCalledWith({
      projectId: 'project-1', projectName: '',
    });
    const fd = calls[0]?.body as FormData;
    expect((fd.get('file') as File).name).toBe('html-review.zip');
    expect(fd.get('manuscriptId')).toBe('old-1');
    expect(fd.get('reviewType')).toBe('12');
    expect(fd.get('carrierType')).toBe('web');
    expect(fd.get('h5Size')).toBe('390x844');
    expect(JSON.parse(String(calls[1]?.body))).toMatchObject({
      manuscriptId: 'old-1', middleManuscriptId: 'middle-1',
    });
    expect(exportProjectAsAxureZip).not.toHaveBeenCalled();
  });

  it('does not confirm if UEDRO classifies the uploaded manuscript as another type', async () => {
    vi.mocked(exportProjectAsHtmlReviewZip).mockResolvedValue({
      ok: true,
      blob: new Blob(['PK'], { type: 'application/zip' }),
      zipName: 'html-review',
    });
    const calls: Array<{ url: string; body?: BodyInit | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body });
      return { ok: true, json: async () => ({
        ok: true, data: { manuscriptId: 'old', middleManuscriptId: 'mid', reviewType: '1' },
      }) };
    }));
    render(<ReviewManuscriptUpdateModal
      open reviewId="review" manuscriptId="old" category="12" projectId="project"
      onClose={() => {}}
    />);
    fireEvent.click(screen.getByRole('radio', { name: 'H5' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'H5尺寸' }), { target: { value: '412x915' } });
    fireEvent.click(screen.getByRole('button', { name: '来自当前项目' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.getByText(/羽点识别的评审稿类型与当前评审不一致/)).toBeTruthy());
    expect(calls.map((c) => c.url)).toEqual(['/api/hik/uedro/reUploadManuscript']);
    const fd = calls[0]?.body as FormData;
    expect(fd.get('carrierType')).toBe('h5');
    expect(fd.get('h5Size')).toBe('412x915');
  });
});
