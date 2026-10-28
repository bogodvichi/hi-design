// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/PersonPicker', () => ({
  PersonPicker: ({ placeholder, onChange }: {
    placeholder: string;
    onChange: (people: Array<{ name: string }>) => void;
  }) => (
    <button type="button" onClick={() => onChange([{ name: placeholder }])}>
      {placeholder}
    </button>
  ),
}));
vi.mock('../../src/auth/auth', () => ({ getStoredUserInfo: () => null }));
vi.mock('../../src/runtime/axure-export', () => ({ exportProjectAsAxureZip: vi.fn() }));
vi.mock('../../src/runtime/uedro-html-review-export', () => ({ exportProjectAsHtmlReviewZip: vi.fn() }));
vi.mock('../../src/state/projects', () => ({ getProject: vi.fn(async () => null) }));
vi.mock('../../src/providers/registry', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../../src/components/uedroLaunch', () => ({
  resolveUedroLaunchUrl: vi.fn(async () => null),
}));

import { ReviewAddModal } from '../../src/components/ReviewAddModal';
import { exportProjectAsAxureZip } from '../../src/runtime/axure-export';
import { exportProjectAsHtmlReviewZip } from '../../src/runtime/uedro-html-review-export';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HTML review creation', () => {
  it('offers html评审 for both department and project review modes', () => {
    render(<ReviewAddModal open onClose={() => {}} />);
    expect(screen.getByRole('option', { name: 'html评审' }).getAttribute('value')).toBe('12');

    fireEvent.click(screen.getByLabelText('项目评审'));
    expect(screen.getByRole('option', { name: 'html评审' }).getAttribute('value')).toBe('12');
  });


  it('packages the current HTML project and submits that ZIP before creating an HTML review', async () => {
    vi.mocked(exportProjectAsHtmlReviewZip).mockResolvedValue({
      ok: true,
      blob: new Blob(['ZIP with index.html and assets'], { type: 'application/zip' }),
      zipName: '可视化页面',
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      requests.push({ url: path, init });
      if (path.endsWith('/uploadManuscript')) {
        return { ok: true, json: async () => ({ ok: true, data: { manuscriptId: 'html-project-1', reviewType: '12' } }) };
      }
      if (path.endsWith('/reviewAddition')) {
        return { ok: true, json: async () => ({ ok: true, data: 'review-project-1' }) };
      }
      throw new Error('Unexpected request: ' + path);
    }));

    render(<ReviewAddModal open onClose={() => {}} projectId="project-7" entryFile="screens/main.html" />);
    fireEvent.change(screen.getByPlaceholderText('请输入评审名称'), { target: { value: '来自当前项目的 HTML 评审' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } });
    const sourceButton = screen.getByRole('button', { name: '来自当前项目' }) as HTMLButtonElement;
    expect(sourceButton.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（评审组长）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（作者）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（核心评委）' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => {
      expect(exportProjectAsHtmlReviewZip).toHaveBeenCalledWith({
        projectId: 'project-7',
        projectName: '',
        entryFile: 'screens/main.html',
        workspaceContext: undefined,
      });
      expect(requests.map((r) => r.url)).toEqual([
        '/api/hik/uedro/uploadManuscript',
        '/api/hik/uedro/reviewAddition',
      ]);
    });
    const upload = requests[0]!.init?.body as FormData;
    const file = upload.get('file') as File;
    expect(file.name).toBe('可视化页面.zip');
    expect(file.type).toBe('application/zip');
    expect(upload.get('excelJson')).toBe('');
    expect(upload.get('reviewType')).toBe('12');
    expect(upload.get('carrierType')).toBe('web');
    expect(upload.get('h5Size')).toBe('390x844');
    expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({
      reviewType: '12',
      manuscriptId: 'html-project-1',
      reviewModel: 2,
    });
    expect(exportProjectAsAxureZip).not.toHaveBeenCalled();
  });
  it('supports H5 carrier and dimensions when uploading an HTML ZIP', async () => {
    let uploadBody: FormData | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/uploadManuscript')) throw new Error('Unexpected request');
      uploadBody = init?.body as FormData;
      return { ok: true, json: async () => ({
        ok: true, data: { manuscriptId: 'h5-1', reviewType: 12 },
      }) };
    }));
    render(<ReviewAddModal open onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('radio', { name: 'H5' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'H5尺寸' }), { target: { value: '412x915' } });
    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['ZIP'], 'h5.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => expect(screen.getByText('h5.zip')).toBeTruthy());
    const formData = uploadBody as FormData | null;
    expect(formData?.get('reviewType')).toBe('12');
    expect(formData?.get('carrierType')).toBe('h5');
    expect(formData?.get('h5Size')).toBe('412x915');
  });

  it('submits the selected HTML reviewType after an HTML manuscript upload', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      requests.push({
        url: path,
        body: path.endsWith('/reviewAddition') ? JSON.parse(String(init?.body)) : undefined,
      });
      if (path.endsWith('/uploadManuscript')) {
        return { ok: true, json: async () => ({ ok: true, data: { manuscriptId: 'html-1', reviewType: '12' } }) };
      }
      if (path.endsWith('/reviewAddition')) {
        return { ok: true, json: async () => ({ ok: true, data: 'review-1' }) };
      }
      throw new Error('Unexpected request: ' + path);
    }));

    render(<ReviewAddModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('请输入评审名称'), {
      target: { value: 'HTML 评审测试' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } });

    // HTML review supports both project-generated ZIPs and manual ZIP upload.
    expect((screen.getByRole('button', { name: '来自当前项目' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（评审组长）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（作者）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（核心评委）' }));

    const file = new File(['ZIP-contents'], 'page.zip', { type: 'application/zip' });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByText('page.zip')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => {
      const created = requests.find((r) => r.url.endsWith('/reviewAddition'));
      expect(created).toBeDefined();
      expect(created?.body).toMatchObject({
        reviewName: 'HTML 评审测试',
        reviewType: '12',
        manuscriptId: 'html-1',
        reviewModel: 2,
      });
    });
  });
});
