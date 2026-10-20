import type { Express } from 'express';
import type { ServerContext } from '../server-context.js';
import { LanzAccountService } from '../integrations/lanz-account.js';

export interface RegisterLanzAccountRoutesDeps {
  paths: Pick<ServerContext['paths'], 'RUNTIME_DATA_DIR'>;
  http: Pick<ServerContext['http'], 'requireLocalDaemonRequest'>;
  lanzAccountService?: Pick<LanzAccountService, 'load'>;
}

/** Internal login bootstrap; no separate CLI action or credential printing. */
export function registerLanzAccountRoutes(app: Express, deps: RegisterLanzAccountRoutesDeps): void {
  const service = deps.lanzAccountService ?? new LanzAccountService(deps.paths.RUNTIME_DATA_DIR);
  app.post('/api/auth/lanz', deps.http.requireLocalDaemonRequest, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const expected = typeof req.body?.expectedUsername === 'string'
      ? req.body.expectedUsername
      : undefined;
    const result = await service.load(expected);
    const status = result.ok ? 200
      : result.kind === 'not_signed_in' || result.kind === 'session_expired' ? 401
      : result.kind === 'account_mismatch' ? 409 : 502;
    return res.status(status).json(result);
  });
}
