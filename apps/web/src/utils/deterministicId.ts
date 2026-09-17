// Browser-compatible mirror of the daemon's generateDeterministicId (apps/daemon/src/ids.ts).
// Same SHA-256 hash-chaining algorithm so both sides produce identical IDs
// from the same seed. Used to derive team member IDs without an HTTP round-trip.

const LOWERCASE_ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_SHORT_ID_LENGTH = 25;

async function hashBytes(seed: string, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let offset = 0;
  let input = seed;
  const encoder = new TextEncoder();
  while (offset < length) {
    const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input));
    const digest = new Uint8Array(digestBuffer);
    const take = Math.min(digest.length, length - offset);
    out.set(digest.subarray(0, take), offset);
    offset += take;
    input = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return out;
}

export async function generateDeterministicId(
  seed: string,
  length: number = DEFAULT_SHORT_ID_LENGTH,
): Promise<string> {
  const bytes = await hashBytes(seed, length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes[i]! % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/**
 * Derive the current user's team member ID from a team ID + username,
 * matching the daemon's getTeamMemberId in apps/daemon/src/ids.ts.
 */
export async function getTeamMemberId(teamId: string, username: string): Promise<string> {
  return generateDeterministicId(`${teamId}_${username}`);
}
