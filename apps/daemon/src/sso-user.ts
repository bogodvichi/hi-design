import { readSsoConfigFile } from './http/hik_logins/hicoo.js';

export interface SsoUser {
  username: string;
  displayName: string;
  email: string;
}

/**
 * Read the signed-in user's identity from the SSO session.
 * Returns null when there is no session or no identity to surface.
 */
export function getSsoUser(dataDir?: string): SsoUser | null {
  if (!dataDir) return null;
  const session = readSsoConfigFile(dataDir);
  if (!session) return null;
  const username = typeof session.username === 'string' ? session.username.trim() : '';
  const displayName =
    typeof session.userInfo?.displayName === 'string'
      ? session.userInfo.displayName.trim()
      : '';
  const email =
    typeof session.userInfo?.email === 'string' ? session.userInfo.email.trim() : '';
  if (!username && !displayName) return null;
  return { username, displayName, email };
}
