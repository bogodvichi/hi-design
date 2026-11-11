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
  resolveUedroLaunchUrl: vi.fn(async (targetUrl: string) => (
    targetUrl === 'https://uedro.hikvision.com.cn/uedro/html?id=html-project-1&projectid=null&projName=&projManager=null'
      ? `${targetUrl}&ticket=ST-123456`
      : null
  )),
}));

import { ReviewAddModal } from '../../src/components/ReviewAddModal';
import { openExternalUrl } from '../../src/providers/registry';
import { resolveUedroLaunchUrl } from '../../src/components/uedroLaunch';
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
      // Project review binding read (probe) and write (save manuscriptId).
      if (path.endsWith('/api/projects/project-7/uedro-review')) {
        if (String(init?.method ?? 'GET').toUpperCase() === 'PUT') {
          return {
            ok: true,
            json: async () => ({
              projectId: 'project-7',
              uedroReviewId: 'html-project-1',
              localSaved: true,
              remoteSaved: null,
            }),
          };
        }
        return { ok: true, json: async () => ({ projectId: 'project-7', uedroReviewId: null }) };
      }
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
      expect(
        requests
          .map((r) => r.url)
          .filter((u) => u.startsWith('/api/hik/uedro/')),
      ).toEqual([
        '/api/hik/uedro/uploadManuscript',
        '/api/hik/uedro/reviewAddition',
      ]);
    });
    const uploadIndex = requests.findIndex((r) => r.url.endsWith('/uploadManuscript'));
    const upload = requests[uploadIndex]!.init?.body as FormData;
    const file = upload.get('file') as File;
    expect(file.name).toBe('可视化页面.zip');
    expect(file.type).toBe('application/zip');
    expect(upload.get('excelJson')).toBe('');
    expect(upload.get('reviewType')).toBe('12');
    expect(upload.get('carrierType')).toBe('web');
    expect(upload.get('h5Size')).toBe('390x844');
    const createIndex = requests.findIndex((r) => r.url.endsWith('/reviewAddition'));
    expect(JSON.parse(String(requests[createIndex]!.init?.body))).toMatchObject({
      reviewType: '12',
      manuscriptId: 'html-project-1',
      reviewModel: 2,
    });
    // reviewAddition 成功后把**评审 id**（不是稿件 id）绑定到项目。
    const put = requests.find(
      (r) => r.url.endsWith('/api/projects/project-7/uedro-review')
        && String(r.init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    expect(put).toBeDefined();
    expect(JSON.parse(String(put!.init?.body))).toEqual({ uedroReviewId: 'review-project-1' });
    await waitFor(() => {
      expect(resolveUedroLaunchUrl).toHaveBeenCalledWith(
        'https://uedro.hikvision.com.cn/uedro/html?id=html-project-1&projectid=null&projName=&projManager=null',
      );
      expect(openExternalUrl).toHaveBeenCalledWith(
        'https://uedro.hikvision.com.cn/uedro/html?id=html-project-1&projectid=null&projName=&projManager=null&ticket=ST-123456',
      );
    });
    expect(exportProjectAsAxureZip).not.toHaveBeenCalled();
  });

  it('新建评审后云端同步失败（remoteSaved=false）时不关闭、不提示成功', async () => {
    vi.mocked(exportProjectAsHtmlReviewZip).mockResolvedValue({
      ok: true,
      blob: new Blob(['ZIP'], { type: 'application/zip' }),
      zipName: '可视化页面',
    });
    const onClose = vi.fn();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      requests.push({ url: path, init });
      if (path.endsWith('/api/projects/project-7/uedro-review')) {
        if (String(init?.method ?? 'GET').toUpperCase() === 'PUT') {
          return {
            ok: true,
            json: async () => ({
              projectId: 'project-7',
              uedroReviewId: 'review-project-1',
              localSaved: true,
              // 团队空间的 HDW 同步失败：本地写上了，云端没写上。
              remoteSaved: false,
            }),
          };
        }
        return { ok: true, json: async () => ({ projectId: 'project-7', uedroReviewId: null }) };
      }
      if (path.endsWith('/uploadManuscript')) {
        return { ok: true, json: async () => ({ ok: true, data: { manuscriptId: 'html-project-1', reviewType: '12' } }) };
      }
      if (path.endsWith('/reviewAddition')) {
        return { ok: true, json: async () => ({ ok: true, data: 'review-project-1' }) };
      }
      throw new Error('Unexpected request: ' + path);
    }));

    render(<ReviewAddModal open onClose={onClose} projectId="project-7" entryFile="screens/main.html" />);
    fireEvent.change(screen.getByPlaceholderText('请输入评审名称'), { target: { value: '云端同步失败的评审' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（评审组长）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（作者）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（核心评委）' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    // PUT 已经发出（本地 + 远端尝试都发生在这一个请求里）。
    await waitFor(() => {
      expect(
        requests.some(
          (r) => r.url.endsWith('/api/projects/project-7/uedro-review')
            && String(r.init?.method ?? 'GET').toUpperCase() === 'PUT',
        ),
      ).toBe(true);
    });
    // 云端同步失败时不能提示成功、不能关闭（让用户重试绑定）。
    expect(onClose).not.toHaveBeenCalled();
    expect(resolveUedroLaunchUrl).not.toHaveBeenCalled();
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
  it('reviewAddition 没返回评审 id 时不写绑定，也不退回稿件 id', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = String(init?.method ?? 'GET').toUpperCase();
      requests.push({ url: path, method, body: init?.body });
      if (path.endsWith('/api/projects/project-9/uedro-review')) {
        return { ok: true, json: async () => ({ projectId: 'project-9', uedroReviewId: null }) };
      }
      if (path.endsWith('/uploadManuscript')) {
        return { ok: true, json: async () => ({ ok: true, data: { manuscriptId: 'ms-only', reviewType: '1' } }) };
      }
      if (path.endsWith('/reviewAddition')) {
        return { ok: true, json: async () => ({ ok: true, data: null }) };
      }
      throw new Error('Unexpected request: ' + path);
    }));
    render(<ReviewAddModal open onClose={() => {}} projectId="project-9" />);
    fireEvent.change(screen.getByPlaceholderText('请输入评审名称'), { target: { value: '无 reviewId 的评审' } });
    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['ZIP'], 'page.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => expect(screen.getByText('page.zip')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（评审组长）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（作者）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（核心评委）' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/reviewAddition'))).toBe(true));
    expect(
      requests.some(
        (r) => r.url.endsWith('/api/projects/project-9/uedro-review') && r.method === 'PUT',
      ),
    ).toBe(false);
  });
});

describe('新建/更新评审模式', () => {
  function modeRadio(label: string): HTMLInputElement {
    return screen.getByLabelText(label) as HTMLInputElement;
  }

  const repeatData = {
    reviewName: '评审名称A',
    preReviewEndTime: '2026/12/01 23:59:00',
    manuscriptId: 'ms-1',
    // reviewers[0] 是组长，其余为团队评委；作者要从团队评委中剔除。
    reviewers: [
      { id: 'leader', name: '组长' },
      { id: 'judge-1', name: '评委一' },
      { id: 'author', name: '作者' },
    ],
    designers: [{ id: 'leader', name: '组长' }],
    coreReviewers: [{ id: 'core-1', name: '核心一' }],
    author: [{ id: 'author', name: '作者' }],
    copyPersons: [{ id: 'cc-1', name: '抄送一' }],
    content: '备注内容',
  };

  /** oneByReviewId 返回的评审主数据（决定"评审单是否存在"）。 */
  const reviewOneData = {
    reviewId: 'review-1',
    reviewName: '评审名称A',
    reviewType: 1,
    // 1 = 项目评审；projectId 是羽点项目号，用于更新模式只读展示项目名称。
    reviewModel: 1,
    projectId: 'PJ001',
    // 进行中的评审单（endStatus=3 表示已关闭/已完成，不能更新）。
    endStatus: 0,
    preReviewEndTimeDate: '2026-12-01T23:59:00+08:00',
  };

  function stubBindingFetch(options: {
    uedroReviewId: string | null;
    /** oneByReviewId 判定：默认取 reviewOneData，传 null 表示评审单不存在。 */
    one?: unknown;
    repeat?: { ok: boolean; data: unknown };
    reviewEdit?: { ok: boolean };
    reUpload?: { ok: boolean; data?: unknown };
    reUploadConfirm?: { ok: boolean };
    manuscripts?: Array<{ manuscriptId: string; version: number }>;
  }) {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = String(init?.method ?? 'GET').toUpperCase();
      let body: unknown = init?.body;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      requests.push({ url: path, method, body });
      if (path.endsWith('/uedro-review')) {
        return {
          ok: true,
          json: async () => ({ projectId: 'project-1', uedroReviewId: options.uedroReviewId }),
        };
      }
      if (path.includes('/api/hik/uedro/reviewOne')) {
        const one = options.one === undefined ? reviewOneData : options.one;
        return { ok: true, json: async () => (one == null ? { ok: false, data: null } : { ok: true, data: one }) };
      }
      if (path.endsWith('/api/hik/uedro/projectList')) {
        // 项目号反查项目名（更新模式只读展示项目名称用）。
        return {
          ok: true,
          json: async () => ({ ok: true, data: { list: [{ projNum: 'PJ001', projName: '示例项目' }] } }),
        };
      }
      if (path.includes('/api/hik/uedro/reviewRepeat')) {
        return { ok: true, json: async () => options.repeat ?? { ok: false } };
      }
      if (path.endsWith('/api/hik/uedro/subProcess')) {
        return { ok: true, json: async () => ({ ok: true, data: { list: options.manuscripts ?? [] } }) };
      }
      if (path.endsWith('/api/hik/uedro/reviewEdit')) {
        return { ok: true, json: async () => options.reviewEdit ?? { ok: true } };
      }
      if (path.endsWith('/api/hik/uedro/reUploadManuscript')) {
        return {
          ok: true,
          json: async () => options.reUpload ?? {
            ok: true,
            data: { manuscriptId: 'ms-1', middleManuscriptId: 'middle-1' },
          },
        };
      }
      if (path.endsWith('/api/hik/uedro/reUploadConfirm')) {
        return { ok: true, json: async () => options.reUploadConfirm ?? { ok: true } };
      }
      throw new Error('Unexpected request: ' + path);
    }));
    return requests;
  }

  it('没有评审单时默认新建，并禁用两个更新模式', async () => {
    stubBindingFetch({ uedroReviewId: null });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    expect(modeRadio('新建评审').checked).toBe(true);
    expect(modeRadio('更新评审稿').checked).toBe(false);
    expect(modeRadio('更新评审信息').checked).toBe(false);

    // 探测完成后仍只能选新建，并展示提示文案。
    await waitFor(() => expect(modeRadio('新建评审').disabled).toBe(false));
    expect(modeRadio('更新评审稿').disabled).toBe(true);
    expect(modeRadio('更新评审信息').disabled).toBe(true);
    expect(screen.getByText('当前项目还没有评审单，只能新建评审')).toBeTruthy();
    // 新建模式仍显示稿件区域。
    expect(screen.getByRole('button', { name: '来自当前项目' })).toBeTruthy();
  });

  it('项目名称聚焦即用空关键字查询项目列表', async () => {
    const requests = stubBindingFetch({ uedroReviewId: null });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    // 新建模式默认部门评审，先切到项目评审让 ProjectPicker 出现。
    fireEvent.click(screen.getByLabelText('项目评审'));
    fireEvent.focus(screen.getByPlaceholderText('请输入项目名称'));

    await waitFor(() => {
      const req = requests.find((r) => r.url.endsWith('/api/hik/uedro/projectList'));
      expect(req).toBeDefined();
      expect(req!.body).toEqual({ projNumOrName: '', processType: 1, pageNo: 1, pageSize: 10 });
    });
    // 空关键字结果以下拉形式展示，可直接点选。
    await waitFor(() => expect(screen.getByText('（PJ001）示例项目')).toBeTruthy());
  });

  it('oneByReviewId 返回 data !== null 时自动切"更新评审信息"并回填，仅 4 个字段可改', async () => {
    stubBindingFetch({
      uedroReviewId: 'review-1',
      repeat: { ok: true, data: repeatData },
    });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('更新评审信息').checked).toBe(true));
    expect(modeRadio('更新评审稿').disabled).toBe(false);
    expect(modeRadio('更新评审信息').disabled).toBe(false);

    // 回填的只读字段：评审类型（项目/部门单选）/ 项目名称 / 评审名称（含子类型）
    // / 预计结束日期 / 评审组长 / 作者。
    const projectRadio = screen.getByLabelText('项目评审') as HTMLInputElement;
    expect(projectRadio.checked).toBe(true);
    expect(projectRadio.disabled).toBe(true);
    expect((screen.getByLabelText('部门评审') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByDisplayValue('（PJ001）示例项目') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('评审名称A') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('交互评审') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('2026-12-01 23:59') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('组长') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('作者') as HTMLInputElement).disabled).toBe(true);

    // 可改字段：核心评委 / 团队评委 / 抄送人员 / 评审备注。
    expect(screen.getByRole('button', { name: '请输入名称（核心评委）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '请输入名称（团队评委）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '请输入名称（抄送人员）' })).toBeTruthy();
    expect((screen.getByPlaceholderText('请输入备注') as HTMLTextAreaElement).disabled).toBe(false);

    // 更新评审信息不动稿件：稿件上传区域隐藏。
    expect(screen.queryByRole('button', { name: '来自当前项目' })).toBeNull();
    expect(screen.queryByRole('button', { name: '上传' })).toBeNull();
  });

  it('更新评审信息提交 reviewEdit，body 只含可改字段', async () => {
    const requests = stubBindingFetch({
      uedroReviewId: 'review-1',
      repeat: { ok: true, data: repeatData },
    });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('更新评审信息').checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => {
      const edit = requests.find((r) => r.url.endsWith('/api/hik/uedro/reviewEdit'));
      expect(edit).toBeDefined();
    });
    const edit = requests.find((r) => r.url.endsWith('/api/hik/uedro/reviewEdit'))!;
    expect(edit.body).toEqual({
      reviewId: 'review-1',
      preReviewEndTime: '2026/12/01 23:59:00',
      designers: [{ id: 'leader', name: '组长' }],
      // 组长在首位，团队评委中已剔除作者。
      reviewers: [
        { id: 'leader', name: '组长' },
        { id: 'judge-1', name: '评委一' },
      ],
      coreReviewers: [{ id: 'core-1', name: '核心一' }],
      copyPersons: [{ id: 'cc-1', name: '抄送一' }],
      content: '备注内容',
    });
    // 更新评审信息绝不触发稿件上传/新建接口。
    expect(requests.some((r) => r.url.endsWith('/uploadManuscript'))).toBe(false);
    expect(requests.some((r) => r.url.endsWith('/reviewAddition'))).toBe(false);
    expect(requests.some((r) => r.url.endsWith('/reUploadManuscript'))).toBe(false);
    expect(requests.some((r) => r.url.endsWith('/reUploadConfirm'))).toBe(false);
  });

  it('oneByReviewId 判定不存在（data === null）时保持新建并禁用更新模式', async () => {
    stubBindingFetch({
      uedroReviewId: 'manuscript-id-wrongly-bound',
      // 稿件 id 当评审 id 时的真实表现：oneByReviewId 返回 ok:false / data:null。
      one: null,
    });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('新建评审').disabled).toBe(false));
    expect(modeRadio('新建评审').checked).toBe(true);
    expect(modeRadio('更新评审稿').disabled).toBe(true);
    expect(modeRadio('更新评审信息').disabled).toBe(true);
    // 新建模式仍显示稿件区域。
    expect(screen.getByRole('button', { name: '来自当前项目' })).toBeTruthy();
  });

  it('绑定的评审单已关闭/已完成（endStatus=3）时禁用更新模式并提示', async () => {
    stubBindingFetch({
      uedroReviewId: 'review-1',
      one: { ...reviewOneData, endStatus: 3 },
    });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('新建评审').disabled).toBe(false));
    expect(modeRadio('新建评审').checked).toBe(true);
    expect(modeRadio('更新评审稿').disabled).toBe(true);
    expect(modeRadio('更新评审信息').disabled).toBe(true);
    expect(screen.getByText('该评审单已关闭或已完成，只能新建评审')).toBeTruthy();
    // 新建模式仍显示稿件区域。
    expect(screen.getByRole('button', { name: '来自当前项目' })).toBeTruthy();
  });

  it('repeat 取不到人员时只放开"更新评审稿"，用 subProcess 的最新稿件 id', async () => {
    stubBindingFetch({
      uedroReviewId: 'review-1',
      repeat: { ok: false, data: null },
      manuscripts: [
        { manuscriptId: 'ms-old', version: 1 },
        { manuscriptId: 'ms-new', version: 3 },
      ],
    });
    render(<ReviewAddModal open onClose={() => {}} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('更新评审稿').checked).toBe(true));
    // 没有完整评委信息时不能进"更新评审信息"（否则会用空数组覆盖远端）。
    expect(modeRadio('更新评审信息').disabled).toBe(true);
    expect(screen.getByText('读取不到该评审的评委信息，暂时只能更新评审稿')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['ZIP'], 'page.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => expect(screen.getByText('page.zip')).toBeTruthy());
  });

  it('更新评审稿：显示稿件区域、隐藏人员区域，提交走 reUploadManuscript + reUploadConfirm', async () => {
    const onClose = vi.fn();
    const requests = stubBindingFetch({
      uedroReviewId: 'review-1',
      repeat: { ok: true, data: repeatData },
    });
    render(<ReviewAddModal open onClose={onClose} projectId="project-1" />);

    await waitFor(() => expect(modeRadio('更新评审信息').checked).toBe(true));
    fireEvent.click(modeRadio('更新评审稿'));
    await waitFor(() => expect(modeRadio('更新评审稿').checked).toBe(true));

    // 只换稿件：人员 / 抄送区域隐藏，稿件区域显示。
    expect(screen.queryByRole('button', { name: '请输入名称（核心评委）' })).toBeNull();
    expect(screen.queryByRole('button', { name: '请输入名称（团队评委）' })).toBeNull();
    expect(screen.queryByRole('button', { name: '请输入名称（抄送人员）' })).toBeNull();
    expect(screen.getByRole('button', { name: '来自当前项目' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上传' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['ZIP'], 'page.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => expect(screen.getByText('page.zip')).toBeTruthy());

    const reUpload = requests.find((r) => r.url.endsWith('/reUploadManuscript'));
    expect(reUpload).toBeDefined();
    const fd = reUpload!.body as FormData;
    expect(fd.get('manuscriptId')).toBe('ms-1');

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => {
      const confirm = requests.find((r) => r.url.endsWith('/reUploadConfirm'));
      expect(confirm).toBeDefined();
      expect(confirm!.body).toEqual({
        manuscriptId: 'ms-1',
        middleManuscriptId: 'middle-1',
        description: '备注内容',
      });
    });
    // 更新评审稿不走 reviewEdit / reviewAddition。
    expect(requests.some((r) => r.url.endsWith('/reviewEdit'))).toBe(false);
    expect(requests.some((r) => r.url.endsWith('/reviewAddition'))).toBe(false);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
