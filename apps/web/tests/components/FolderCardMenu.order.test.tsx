// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FolderCardMenu } from '../../src/components/FolderCardMenu';
import styles from '../../src/components/TeamSpaceView.module.css';

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
  it('opens the same menu from a folder card context click', () => {
    const onDelete = vi.fn();
    render(
      <article role="button" data-testid="folder-card">
        <FolderCardMenu onDelete={onDelete} deleteLabel="删除" />
        <div className={styles.folderCardGrid} data-testid="folder-cover" />
        <div data-testid="folder-meta">文件夹名称</div>
      </article>,
    );

    fireEvent.contextMenu(screen.getByTestId('folder-meta'), { clientX: 96, clientY: 64 });

    expect(screen.getByRole('menu')).toHaveStyle({ left: '96px', top: '64px' });
    const deleteItem = screen.getByRole('menuitem', { name: '删除' });
    fireEvent.click(deleteItem);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

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
