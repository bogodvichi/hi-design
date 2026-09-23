// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FolderCardMenu } from '../../src/components/FolderCardMenu';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

afterEach(() => cleanup());

function openMenu(props: Partial<ComponentProps<typeof FolderCardMenu>> = {}) {
  render(
    <FolderCardMenu
      onShare={() => {}}
      shareLabel="分享文件夹"
      onRename={() => {}}
      renameLabel="重命名"
      onMove={() => {}}
      moveLabel="移动"
      onDelete={() => {}}
      deleteLabel="删除"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
  return screen.getByRole('menu');
}

describe('FolderCardMenu order', () => {
  it('groups share before management actions', () => {
    const menu = openMenu();
    const items = Array.from(menu.children).map((node) =>
      node.getAttribute('role') === 'separator' ? 'separator' : node.textContent,
    );
    expect(items).toEqual(['分享文件夹', 'separator', '重命名', '移动', '删除']);
  });

  it('does not render an orphan separator when share is unavailable', () => {
    const menu = openMenu({ onShare: undefined, shareLabel: undefined });
    expect(within(menu).queryByRole('separator')).toBeNull();
    expect(Array.from(menu.children).map((node) => node.textContent)).toEqual(['重命名', '移动', '删除']);
  });
});
