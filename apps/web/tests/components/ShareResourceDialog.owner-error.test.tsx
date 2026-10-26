// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { ShareResourceDialog } from '../../src/components/ShareResourceDialog';

vi.mock('../../src/components/PersonPicker', () => ({
  PersonPicker: ({ onChange }: { onChange: (people: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ id: 'recipient', name: 'Recipient', email: 'recipient@example.test' }])}>
      Choose recipient
    </button>
  ),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('resource sharing authorization feedback', () => {
  const view = () => render(
    <I18nProvider initial="zh-CN">
      <ShareResourceDialog resourceId="fake-resource" kind="mcp" resourceName="Example MCP"
        homeWorkspaceId="owner-workspace" onClose={vi.fn()} />
    </I18nProvider>,
  );
  it('shows owner mismatch instead of a misleading retry message after HTTP 403', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'NOT_RESOURCE_OWNER' }, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }));
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('当前账号与云端登记的资源所有者不一致');
    expect(alert.textContent).toContain('联系管理员');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/resource-share/share', expect.objectContaining({ method: 'POST' }));
  });

  it('continues to display retry messaging for an unrelated outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'UPSTREAM_UNAVAILABLE' }, { status: 503 })));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Choose recipient' }));
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    expect((await screen.findByRole('alert')).textContent).toContain('分享失败');
  });
});
