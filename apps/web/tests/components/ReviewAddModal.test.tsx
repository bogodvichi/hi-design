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
vi.mock('../../src/state/projects', () => ({ getProject: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../../src/components/uedroLaunch', () => ({
  resolveUedroLaunchUrl: vi.fn(async () => null),
}));

import { ReviewAddModal } from '../../src/components/ReviewAddModal';

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

    // Axure export cannot be submitted as an HTML manuscript.
    expect((screen.getByRole('button', { name: '来自当前项目' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（评审组长）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（作者）' }));
    fireEvent.click(screen.getByRole('button', { name: '请输入名称（核心评委）' }));

    const file = new File(['<!doctype html><title>Review</title>'], 'page.html', { type: 'text/html' });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByText('page.html')).toBeTruthy());
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
