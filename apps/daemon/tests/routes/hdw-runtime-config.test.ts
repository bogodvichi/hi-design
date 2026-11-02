import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerHdwRoutes } from '../../src/routes/hik/_routes/hdw.js';

describe('GET /api/hdw/runtime-config', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  });

  it('returns the runtime-resolved HDW share base without caching', async () => {
    const app = express();
    registerHdwRoutes(app, {
      env: {
        NODE_ENV: 'production',
        OD_HDW_PATH_PREFIX: '/hik-plugin/hidesign-web/hdw',
      },
      sendApiError: (res: express.Response, status: number, code: string, message: string) => {
        res.status(status).json({ error: { code, message } });
      },
    });
    server = createServer(app);
    await listen(server);

    const response = await fetch(`${baseUrl(server)}/api/hdw/runtime-config`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      sharePublicBase: 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web',
    });
  });
});

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function baseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind to a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}
