import { createHash } from 'node:crypto';
import type { Cookie } from './http.js';

export interface HdwSession {
  username?: string;
  cookies?: Pick<Cookie, 'name' | 'value'>[];
}
let readSession: () => HdwSession | null = () => null;

/** The daemon supplies its resolved data-root reader; read fresh on each call
 * so signing out or switching accounts cannot reuse a startup cookie jar. */
export function configureHdwSession(reader: () => HdwSession | null): void {
  readSession = reader;
}

export function hdwSessionHeaders(session: HdwSession | null = readSession()): Record<string, string> {
  if (!session?.username || !session.cookies?.length) return {};
  return {
    'x-hdw-username': session.username,
    // The upstream gateway strips Cookie. This server-to-server header is
    // still verified against OA; the username itself grants no authority.
    'x-hdw-oa-session': Buffer.from(JSON.stringify(session.cookies.map(({ name, value }) => ({ name, value })))).toString('base64'),
  };
}

export function hdwSessionIdentity(session: HdwSession | null): string {
  if (!session?.username || !session.cookies?.length) return 'hdw:signed-out';
  return `hdw:${createHash('sha256').update(JSON.stringify([session.username, session.cookies.map(({ name, value }) => [name, value])])).digest('hex')}`;
}
