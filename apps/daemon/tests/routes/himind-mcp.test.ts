import type { Express, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  registerAiResearchMcpRoutes,
  registerHiMindMcpRoutes,
} from '../../src/routes/himind-mcp.js';

describe('HiMind MCP token route', () => {
  it('derives the signing request run id from the tool grant', async () => {
    let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      post(path: string, next: (req: Request, res: Response) => Promise<void>) {
        expect(path).toBe('/api/tools/himind/mcp-token');
        handler = next;
      },
    } as unknown as Express;
    const authorizeToolRequest = vi.fn(() => ({
      token: 'opaque',
      runId: 'run-from-grant',
      projectId: 'project-1',
      allowedEndpoints: [],
      allowedOperations: [],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:15:00.000Z',
    }));
    const fetchToken = vi.fn(async () => ({
      accessToken: 'signed-jwt',
      expiresIn: 300,
    }));
    registerHiMindMcpRoutes(app, {
      auth: { authorizeToolRequest },
      fetchToken,
    });
    const json = vi.fn();
    const setHeader = vi.fn();
    const response = { json, setHeader } as unknown as Response;

    await handler?.({ body: { runId: 'attacker-controlled' } } as Request, response);

    expect(authorizeToolRequest).toHaveBeenCalledWith(
      expect.anything(),
      response,
      'himind:mcp-token',
    );
    expect(fetchToken).toHaveBeenCalledWith('run-from-grant');
    expect(setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(json).toHaveBeenCalledWith({ accessToken: 'signed-jwt', expiresIn: 300 });
  });
});

describe('AI research MCP token route', () => {
  it('authorizes on the ai-research operation and signs for the grant run id', async () => {
    let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      post(path: string, next: (req: Request, res: Response) => Promise<void>) {
        expect(path).toBe('/api/tools/ai-research/mcp-token');
        handler = next;
      },
    } as unknown as Express;
    const authorizeToolRequest = vi.fn(() => ({
      token: 'opaque',
      runId: 'run-from-grant',
      projectId: 'project-1',
      allowedEndpoints: [],
      allowedOperations: [],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:15:00.000Z',
    }));
    const fetchToken = vi.fn(async () => ({
      accessToken: 'signed-research-jwt',
      expiresIn: 300,
    }));
    registerAiResearchMcpRoutes(app, {
      auth: { authorizeToolRequest },
      fetchToken,
    });
    const json = vi.fn();
    const setHeader = vi.fn();
    const response = { json, setHeader } as unknown as Response;

    await handler?.({ body: { runId: 'attacker-controlled' } } as Request, response);

    // The ai-research route must NOT authorize under the himind operation —
    // a himind grant must not implicitly grant the research audience.
    expect(authorizeToolRequest).toHaveBeenCalledWith(
      expect.anything(),
      response,
      'ai-research:mcp-token',
    );
    expect(fetchToken).toHaveBeenCalledWith('run-from-grant');
    expect(setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(json).toHaveBeenCalledWith({
      accessToken: 'signed-research-jwt',
      expiresIn: 300,
    });
  });

  it('surfaces a distinct OA-session error code when no token is minted', async () => {
    let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      post(_path: string, next: (req: Request, res: Response) => Promise<void>) {
        handler = next;
      },
    } as unknown as Express;
    const authorizeToolRequest = vi.fn(() => ({
      token: 'opaque',
      runId: 'run-from-grant',
      projectId: 'project-1',
      allowedEndpoints: [],
      allowedOperations: [],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:15:00.000Z',
    }));
    const fetchToken = vi.fn(async () => null);
    registerAiResearchMcpRoutes(app, {
      auth: { authorizeToolRequest },
      fetchToken,
    });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const setHeader = vi.fn();
    const response = { json, status, setHeader } as unknown as Response;

    await handler?.({ body: {} } as Request, response);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'AI_RESEARCH_OA_SESSION_REQUIRED',
        message: 'AI research authorization requires a valid OA session',
      },
    });
  });
});
