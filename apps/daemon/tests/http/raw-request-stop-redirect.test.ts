import type { Server } from 'node:http';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { rawRequest } from '../../src/http/http.js';

describe('rawRequest stopRedirect', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  });

  it('returns the redirect URL without requesting its destination', async () => {
    let destinationHits = 0;
    server = createServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/callback?ticket=ST-123456' });
        res.end();
        return;
      }
      destinationHits += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('consumed');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await rawRequest('GET', `${baseUrl}/start`, [], {
      stopRedirect: (nextUrl) => nextUrl.endsWith('/callback?ticket=ST-123456'),
    });

    expect(result.status).toBe(302);
    expect(result.finalUrl).toBe(`${baseUrl}/callback?ticket=ST-123456`);
    expect(destinationHits).toBe(0);
  });
});
