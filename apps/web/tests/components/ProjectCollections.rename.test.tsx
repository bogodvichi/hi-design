// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalAllView } from '../../src/components/PersonalAllView';
import { PersonalFolderView } from '../../src/components/PersonalFolderView';
import { FolderView, TeamSpaceView } from '../../src/components/TeamSpaceView';
import type { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/components/AddSkillDialog', () => ({ AddSkillDialog: () => null }));
vi.mock('../../src/components/AddMcpDialog', () => ({ AddMcpDialog: () => null }));
vi.mock('../../src/components/CloudSkillList', () => ({ CloudSkillList: () => null }));
vi.mock('../../src/components/CloudMcpList', () => ({ CloudMcpList: () => null }));
vi.mock('../../src/components/RecentProjectsStrip', () => ({
  RecentProjectsStrip: ({ projects, onRename, onOpen }: ComponentProps<typeof RecentProjectsStrip>) => <div>
    {projects.map((project) => <button key={project.id} onClick={() => onOpen(project.id)}>{project.name}</button>)}
    <button onClick={() => onRename?.('p1', 'Requested name')}>rename</button>
  </div>,
}));

const project: Project = {
  id: 'p1', name: '你好 Copy', skillId: null, designSystemId: null,
  createdAt: 1, updatedAt: 1, workspaceId: 'ws',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/workspace/directory') return Response.json({ items: [{
      workspaceId: 'ws', workspaceMemberId: 'me', workspaceName: 'Workspace',
      workspaceType: 'team', isDefaultTeam: true, role: 'owner',
      memberStatus: 'active', lifecycleState: 'active',
    }] });
    if (url.includes('/projects')) return Response.json({ code: 0, data: { projects: [project] }, projects: [{
      projectId: project.id, name: project.name, ownerMemberId: 'me', sharedAt: '2026-01-01',
    }] });
    return Response.json({ code: 0, data: { folders: [], path: [], folder_id: 'folder', folder_name: 'Folder' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each(['personal', 'personal-folder', 'team', 'team-folder'] as const)('%s project rename', (view) => {
  it.each([false, true])('uses the persisted name after the request settles (success=%s)', async (success) => {
    let settle!: (value: Project | null) => void;
    const pending = new Promise<Project | null>((resolve) => { settle = resolve; });
    const rename = vi.fn(() => pending);
    const open = vi.fn();
    if (view === 'personal') render(<PersonalAllView onOpenProject={open} onDeleteProject={vi.fn()} onRenameProject={rename} />);
    if (view === 'personal-folder') render(<PersonalFolderView folderId="folder" onOpenProject={open} onRenameProject={rename} />);
    if (view === 'team') render(<TeamSpaceView teamId="ws" onOpenProject={open} onRenameProject={rename} />);
    if (view === 'team-folder') render(<FolderView teamId="ws" folderId="folder" onOpenProject={open} onRenameProject={rename} />);
    await screen.findByRole('button', { name: project.name });
    fireEvent.click(screen.getByRole('button', { name: 'rename' }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('p1', 'Requested name', expect.objectContaining({
      workspaceContext: expect.objectContaining({ workspaceId: 'ws', workspaceMemberId: 'me' }),
    })));
    // The collection must never advertise a name the daemon has not saved.
    expect(screen.queryByRole('button', { name: 'Requested name' })).toBeNull();
    await act(async () => { settle(success ? { ...project, name: 'Saved name' } : null); await pending; });
    const expected = success ? 'Saved name' : project.name;
    fireEvent.click(await screen.findByRole('button', { name: expected }));
    expect(open).toHaveBeenCalledWith('p1', undefined, expect.objectContaining({ name: expected }));
  });
});
