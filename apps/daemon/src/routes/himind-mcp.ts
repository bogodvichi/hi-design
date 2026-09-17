import type { Express, Request, Response } from 'express';

import type { HiMindMcpToken } from '../http/hdw.js';
import type { ToolTokenGrant } from '../tool-tokens.js';

export type RegisterHiMindMcpRoutesDeps = {
  auth: {
    authorizeToolRequest: (
      req: Request,
      res: Response,
      operation: string,
    ) => ToolTokenGrant | null;
  };
  fetchToken: (runId: string) => Promise<HiMindMcpToken | null>;
};

export function registerHiMindMcpRoutes(
  app: Express,
  ctx: RegisterHiMindMcpRoutesDeps,
): void {
  app.post('/api/tools/himind/mcp-token', async (req, res) => {
    const grant = ctx.auth.authorizeToolRequest(req, res, 'himind:mcp-token');
    if (!grant) return;

    try {
      const token = await ctx.fetchToken(grant.runId);
      if (!token) {
        res.status(401).json({
          error: {
            code: 'HIMIND_OA_SESSION_REQUIRED',
            message: 'HiMind authorization requires a valid OA session',
          },
        });
        return;
      }
      res.setHeader('cache-control', 'no-store');
      res.json({
        accessToken: token.accessToken,
        expiresIn: token.expiresIn,
      });
    } catch (error) {
      res.status(502).json({
        error: {
          code: 'HIMIND_TOKEN_ISSUE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}
