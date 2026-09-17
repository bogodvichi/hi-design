import type { Express, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { registerHiMindMcpRoutes } from '../../src/routes/himind-mcp.js';

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
