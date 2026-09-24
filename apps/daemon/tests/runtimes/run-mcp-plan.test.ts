import { describe, expect, it } from 'vitest';

import { buildRunMcpPlan } from '../../src/runtimes/run-mcp-plan.js';

describe('run MCP plan', () => {
  it('keeps project bindings available without turning them into turn selections', () => {
    expect(buildRunMcpPlan({
      projectBindingIds: ['project-mcp'],
      context: { mcpServerIds: ['turn-mcp'] },
    })).toEqual({
      projectBindingIds: ['project-mcp'],
      explicitTurnSelectionIds: ['turn-mcp'],
      requiredServerIds: [],
      runScopedServerIds: [],
      mentionedServerIds: [],
      runtimeServerIds: ['project-mcp', 'turn-mcp'],
    });
  });

  it('keeps required MCPs distinct while mounting all runtime MCP sources once', () => {
    expect(buildRunMcpPlan({
      projectBindingIds: ['project-mcp', 'shared'],
      context: {
        mcpServerIds: ['selected', 'shared'],
        requiredMcpServerIds: ['required', 'selected'],
      },
      runScopedServerIds: ['run-scoped', 'shared'],
      mentionedServerIds: ['mentioned', 'required'],
    })).toEqual({
      projectBindingIds: ['project-mcp', 'shared'],
      explicitTurnSelectionIds: ['selected', 'shared'],
      requiredServerIds: ['required', 'selected'],
      runScopedServerIds: ['run-scoped', 'shared'],
      mentionedServerIds: ['mentioned', 'required'],
      runtimeServerIds: [
        'project-mcp',
        'shared',
        'selected',
        'required',
        'run-scoped',
        'mentioned',
      ],
    });
  });
});
