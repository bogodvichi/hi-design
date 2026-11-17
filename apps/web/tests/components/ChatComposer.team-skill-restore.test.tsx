// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { ChatComposer } from '../../src/components/ChatComposer';
import { flushMounts } from '../helpers/lexical-composer';

const state = vi.hoisted(() => ({ workspace: null as WorkspaceCollabContext | null }));
vi.mock('../../src/collab/collab-context', async (original) => {
  const actual = await original<typeof import('../../src/collab/collab-context')>();
  return { ...actual, useProjectCollabContext: () => ({ ...actual.useProjectCollabContext(), workspaceContext: state.workspace }) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['team', 'personal'] as const)('applies the Skill history restore policy in a %s project', async (workspaceType) => {
  state.workspace = { workspaceId: 'workspace', workspaceMemberId: 'me', workspaceType,
    role: 'owner', lifecycleState: 'active', memberStatus: 'active', permissions: {},
  } as WorkspaceCollabContext;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/skills/missing')
    ? Response.json({ error: 'SKILL_NOT_FOUND' }, { status: 404 })
    : Response.json({ skills: [], servers: [], templates: [], plugins: [], installed: false }));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatComposer projectId="project" projectFiles={[]} streaming={false}
    onEnsureProject={async () => 'project'} onSend={vi.fn()} onStop={vi.fn()} skills={[]}
    projectMetadata={{ kind: 'prototype', usedSkillIds: ['missing'] }} />);
  await flushMounts();
  const restores = () => fetcher.mock.calls.filter(([input]) => String(input).startsWith('/api/skills/cloud-restore'));
  if (workspaceType === 'personal') await waitFor(() => expect(restores()).toHaveLength(1));
  else expect(restores()).toHaveLength(0);
});
