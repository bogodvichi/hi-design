import * as https from 'node:https';
import * as tls from 'node:tls';
import type { Cookie } from './http.js';

/** Delegates the existing directory session to the fixed DRW callback owner. */
export async function handoffAiResearchDirectory(launchUrl: string, cookies: Cookie[]): Promise<void> {
  const callback = new URL(launchUrl);
  const ticket = callback.searchParams.get('ticket');
  if (callback.origin !== 'https://drw.hikvision.com' || callback.pathname !== '/api/auth/platform'
    || callback.username || callback.password || callback.hash
    || !ticket || ticket.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(ticket)) {
    throw new Error('Invalid directory handoff target');
  }
  const body = JSON.stringify({ cookies: cookies.map(({ name, value }) => ({ name, value })) });
  // Node 24 provides this API; the workspace's older Node typings omit it.
  const { getCACertificates } = tls as typeof tls & {
    getCACertificates(type: 'default' | 'system'): string[];
  };
  const agent = new https.Agent({ rejectUnauthorized: true,
    ca: [...getCACertificates('default'), ...getCACertificates('system')] });
  try {
    await new Promise<void>((resolve, reject) => {
      const request = https.request('https://drw.hikvision.com/api/auth/platform/directory', {
        method: 'POST', agent, signal: AbortSignal.timeout(3_000),
        headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body) },
      }, response => {
        response.on('error', reject);
        response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error('Directory handoff rejected')));
        response.resume();
      });
      request.on('error', reject);
      request.end(body);
    });
  } finally { agent.destroy(); }
}
