import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getSsoUser } from '../sso-user.js';

/**
* Mock mirror of the Vela (AMR) integration routes under
 * `/api/integrations/vela/*` (and `/api/amr/models`).
 *
 * Every endpoint logs the incoming request (method, path, query + body
 * parameters) just like the real `/api/integrations/vela/*` routes do, but
 * returns canned mock data captured from the authenticated API analysis
 * document (`api-analysis.md`) instead of spawning the vela CLI or proxying
 * to the AMR API. This lets downstream consumers develop against a stable
 * surface while the real backend is unavailable.
 */

export interface RegisterVela2HideSignRoutesDeps {
  env?: NodeJS.ProcessEnv;
  /** Daemon data root — used to read the SSO session for user identity. */
  dataDir?: string;
}

const BASE = '/api/integrations/vela';

// --- Mock data (captured from api-analysis.md, authenticated session) -----

function buildMockStatus(dataDir?: string) {
  const sso = getSsoUser(dataDir);
  const username = sso?.username || 'ybvichi';
  const email = sso?.email || `${username}@hikvision.com.cn`;
  return {
    loggedIn: true,
    sessionState: 'authenticated',
    loginInFlight: false,
    profile: 'prod',
    user: {
      id: 'ahcneo83tesu0t0ntulp2n4f',
      email,
      name: username,
      image: 'https://avatars.githubusercontent.com/u/317187511?v=4',
    },
    account: {
      plan: 'team_max',
      balanceUsd: '999999.0000',
    },
    configPath: 'C:\\Users\\yebo\\.amr\\config.json',
    consoleOrigin: 'https://amr-api.open-design.ai',
  };
}

function buildMockWallet(dataDir?: string) {
  const sso = getSsoUser(dataDir);
  const username = sso?.username || 'ybvichi';
  const email = sso?.email || `${username}@hikvision.com.cn`;
  return {
    status: 'available',
    profile: 'prod',
    user: {
      id: 'ahcneo83tesu0t0ntulp2n4f',
      email,
      name: username,
    },
    codingPlanModels: [] as unknown[],
    updatedAt: null,
    fetchedAt: '2026-08-27T11:39:02.938Z',
    stale: false,
    source: 'vela_api',
    balanceUsd: '999999.0000',
  };
}

const MOCK_MESSAGES = {
  messages: [] as unknown[],
  unread: 0,
};

const MOCK_AMR_MODELS = {
  providers: [] as unknown[],
  models: [] as unknown[],
  source: 'mock',
};

// --- Helpers --------------------------------------------------------------

function logRequest(method: string, path: string, req: Request): void {
  const query = req.query as Record<string, unknown> | undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const params: Record<string, unknown> = {};
  if (query) Object.assign(params, query);
  if (body) Object.assign(params, body);
  console.log(`[vela-hidesign] ${method} ${path}`, params);
}

function bodyField(req: Request, field: string): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object' || !(field in body)) return undefined;
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

// --- Route registration ----------------------------------------------------

export function registerVela2HideSignRoutes(
  app: Express,
  deps: RegisterVela2HideSignRoutesDeps = {},
): void {
  const env = deps.env ?? process.env;
  void env; // reserved for future env-based mock behavior

  app.get(`${BASE}/status`, (req: Request, res: Response) => {
    logRequest('GET', '/status', req);
    res.json(buildMockStatus(deps.dataDir));
  });

  app.get(`${BASE}/wallet`, (req: Request, res: Response) => {
    logRequest('GET', '/wallet', req);
    res.json(buildMockWallet(deps.dataDir));
  });

  app.get(`${BASE}/message-center-public/messages`, (req: Request, res: Response) => {
    logRequest('GET', '/message-center-public/messages', req);
    res.json(MOCK_MESSAGES);
  });

  app.all(`${BASE}/message-center/*splat`, (req: Request, res: Response) => {
    const prefix = `${BASE}/message-center`;
    const afterPrefix = req.url.slice(prefix.length);
    const qIdx = afterPrefix.indexOf('?');
    const suffix = qIdx >= 0 ? afterPrefix.slice(0, qIdx) : afterPrefix;
    logRequest(req.method, `/message-center${suffix}`, req);
    if (req.method === 'GET' && suffix === '/messages') {
      res.json(MOCK_MESSAGES);
    } else if (req.method === 'POST' && suffix === '/read-all') {
      res.json({ ok: true, readAll: true });
    } else if (req.method === 'POST' && /^\/messages\/[^/]+\/read$/.test(suffix)) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'unknown_message_center_path' });
    }
  });

  app.get('/api/amr/models', (req: Request, res: Response) => {
    logRequest('GET', '/amr/models', req);
    res.json(MOCK_AMR_MODELS);
  });

  app.post(`${BASE}/login`, (req: Request, res: Response) => {
    logRequest('POST', '/login', req);
    const authAttemptId = bodyField(req, 'authAttemptId') ?? randomUUID();
    const now = new Date().toISOString();
    res.status(202).json({
      authAttemptId,
      status: 'started',
      loginInFlight: true,
      authStages: [
        {
          sequence: 1,
          stage: 'attempt_started',
          result: 'started',
          source: 'daemon',
          occurredAt: now,
          route: 'direct',
        },
        {
          sequence: 2,
          stage: 'spawn_result',
          result: 'success',
          source: 'daemon',
          occurredAt: now,
          route: 'direct',
        },
      ],
    });
  });

  app.post(`${BASE}/login/cancel`, (req: Request, res: Response) => {
    logRequest('POST', '/login/cancel', req);
    const authAttemptId = bodyField(req, 'authAttemptId') ?? randomUUID();
    res.json({ cancelled: true, authAttemptId });
  });

  app.post(`${BASE}/logout`, (req: Request, res: Response) => {
    logRequest('POST', '/logout', req);
    res.json({ ok: true });
  });

  app.post(`${BASE}/analytics-entry`, (req: Request, res: Response) => {
    logRequest('POST', '/analytics-entry', req);
    res.status(202).json({ mirrored: false });
  });

  app.post(`${BASE}/analytics-profile`, (req: Request, res: Response) => {
    logRequest('POST', '/analytics-profile', req);
    res.status(202).json({ mirrored: false });
  });
}
