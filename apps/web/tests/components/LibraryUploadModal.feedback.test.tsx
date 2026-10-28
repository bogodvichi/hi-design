// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_UPLOAD_MAX_BYTES } from '@open-design/contracts';
import { LibraryUploadModal } from '../../src/components/LibraryUploadModal';
import { I18nProvider } from '../../src/i18n';

const upload = vi.hoisted(() => vi.fn());
vi.mock('../../src/providers/registry', () => ({ uploadLibraryFile: upload, uploadLibraryText: upload }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Library upload feedback', () => {
  it('explains the actual size limit in Chinese', async () => {
    upload.mockResolvedValue({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Too large — max 50 MB' });
    render(<I18nProvider initial="zh-CN"><LibraryUploadModal seedFiles={null} onClose={vi.fn()} onUploaded={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('dialog', { name: '上传到素材库' })).toBeTruthy();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'large.png')] } });
    const max = Math.round(LIBRARY_UPLOAD_MAX_BYTES / 1_000_000);
    expect(await screen.findByText(`文件大小超过 ${max} MB，请选择不超过 ${max} MB 的文件。`)).toBeTruthy();
    expect(screen.queryByText(/Too large/)).toBeNull();
  });

  it('keeps an unrecognized server exception out of the row feedback', async () => {
    upload.mockResolvedValue({ ok: false, error: 'SQLITE_ERROR: database path /private/data' });
    render(<I18nProvider initial="zh-CN"><LibraryUploadModal seedFiles={[new File(['x'], 'note.txt')]} onClose={vi.fn()} onUploaded={vi.fn()} /></I18nProvider>);
    expect(await screen.findByText('上传文件失败，请重试。')).toBeTruthy();
    expect(screen.queryByText(/SQLITE_ERROR/)).toBeNull();
    expect(screen.getByText('上传完成，0 个成功，1 个失败。')).toBeTruthy();
  });
});
