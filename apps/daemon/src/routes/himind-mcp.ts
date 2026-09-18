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

interface McpTokenRouteConfig {
  // Daemon route the bridge subprocess calls to mint its upstream JWT.
  path: string;
  // Tool-grant operation the run must be authorized for.
  operation: string;
  // Error codes surfaced to the bridge, kept distinct per service so logs and
  // the bridge's retry logic can tell HiMind from AI research failures.
  oaSessionRequiredCode: string;
  oaSessionRequiredMessage: string;
  tokenIssueFailedCode: string;
}

function registerMcpTokenRoute(
  app: Express,
  ctx: RegisterHiMindMcpRoutesDeps,
  config: McpTokenRouteConfig,
): void {
  app.post(config.path, async (req, res) => {
    const grant = ctx.auth.authorizeToolRequest(req, res, config.operation);
    if (!grant) return;

    try {
      const token = await ctx.fetchToken(grant.runId);
      if (!token) {
        res.status(401).json({
          error: {
            code: config.oaSessionRequiredCode,
            message: config.oaSessionRequiredMessage,
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
          code: config.tokenIssueFailedCode,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

export function registerHiMindMcpRoutes(
  app: Express,
  ctx: RegisterHiMindMcpRoutesDeps,
): void {
  registerMcpTokenRoute(app, ctx, {
    path: '/api/tools/himind/mcp-token',
    operation: 'himind:mcp-token',
    oaSessionRequiredCode: 'HIMIND_OA_SESSION_REQUIRED',
    oaSessionRequiredMessage: 'HiMind authorization requires a valid OA session',
    tokenIssueFailedCode: 'HIMIND_TOKEN_ISSUE_FAILED',
  });
}

export function registerAiResearchMcpRoutes(
  app: Express,
  ctx: RegisterHiMindMcpRoutesDeps,
): void {
  registerMcpTokenRoute(app, ctx, {
    path: '/api/tools/ai-research/mcp-token',
    operation: 'ai-research:mcp-token',
    oaSessionRequiredCode: 'AI_RESEARCH_OA_SESSION_REQUIRED',
    oaSessionRequiredMessage: 'AI research authorization requires a valid OA session',
    tokenIssueFailedCode: 'AI_RESEARCH_TOKEN_ISSUE_FAILED',
  });
}
