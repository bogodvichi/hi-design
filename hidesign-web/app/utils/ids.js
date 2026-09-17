'use strict';

const { randomBytes, createHash } = require('node:crypto');

// Lowercase alphanumeric alphabet, matching the Vela workspace ID format
// (e.g. "tljbioajfmjv52wm1h86ybow"). 36 symbols -> ~5.17 bits per character.
const LOWERCASE_ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Default length, matching Vela workspace/member IDs. */
const DEFAULT_SHORT_ID_LENGTH = 25;

/**
 * Generate a short, URL-safe, lowercase-alphanumeric random ID.
 * Uses crypto.randomBytes (not Math.random) for cryptographic strength.
 */
function generateShortId(length = DEFAULT_SHORT_ID_LENGTH) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`length must be a positive integer, got ${String(length)}`);
  }
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes.readUInt8(i) % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/**
 * Generate a short, lowercase-alphanumeric ID deterministically from a seed.
 * Same seed always produces the same ID; different seeds produce different
 * IDs (as much as SHA-256 distribution allows).
 */
function generateDeterministicId(seed, length = DEFAULT_SHORT_ID_LENGTH) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`length must be a positive integer, got ${String(length)}`);
  }
  const bytes = hashBytes(seed, length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes[i] % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/** Produce `length` deterministic bytes from `seed` via SHA-256 hash chaining. */
function hashBytes(seed, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  let input = seed;
  while (offset < length) {
    const digest = createHash('sha256').update(input).digest();
    const take = Math.min(digest.length, length - offset);
    out.set(digest.subarray(0, take), offset);
    offset += take;
    input = digest.toString('hex');
  }
  return out;
}

/**
 * Create a new team ID.
 * When `seed` is provided, generates a deterministic ID from it so the same
 * seed always yields the same team ID. When omitted, falls back to a random
 * value + timestamp as the seed.
 */
function createTeamId(seed) {
  return generateDeterministicId(seed ?? generateShortId() + Date.now().toString(36));
}

/**
 * Derive a team member ID from a team ID + username.
 * The member ID is deterministically derived from `${teamId}_${username}`.
 * Same team + username always yields the same member ID.
 */
function getTeamMemberId(teamId, username) {
  return generateDeterministicId(`${teamId}_${username}`);
}

/**
 * Create a new folder ID.
 * When `seed` is provided, generates a deterministic ID from it so the same
 * seed always yields the same folder ID. When omitted, falls back to a random
 * value + timestamp as the seed.
 */
function createFolderId(seed) {
  return generateDeterministicId(seed ?? generateShortId() + Date.now().toString(36));
}

/**
 * Get the global Shared Space team ID.
 *
 * A single constant team ID shared by ALL users -- every logged-in user is
 * automatically a `member` of this team. Derived from a fixed seed so it is
 * identical across devices and accounts.
 */
function getSharedSpaceTeamId() {
  return createTeamId('shared_space_team_global');
}

/**
 * Derive a user's member ID within the Shared Space team.
 *
 * Deterministic per account: the same user always gets the same Shared Space
 * member ID, derived from `shared_space_member_${username}`. This ID is
 * stable across devices and is used as `recipient_member_id` in the
 * `workspace_project_shares` table.
 */
function getSharedSpaceMemberId(username) {
  return generateDeterministicId(`shared_space_member_${username}`);
}

/**
 * Derive a cross-team collaborator member ID from a username.
 *
 * Used as `author_member_id` on comments when the commenter is NOT a member
 * of the project's home workspace (e.g. commenting via the Shared Space).
 * The ID is stable across teams and devices, and is namespaced separately
 * from `getSharedSpaceMemberId` (`collaborator_` prefix) so the two cannot
 * collide. Display layers can detect this ID pattern to show a
 * "协作者" (Collaborator) badge.
 */
function getCollaboratorMemberId(username) {
  return generateDeterministicId(`collaborator_${username}`);
}

module.exports = {
  DEFAULT_SHORT_ID_LENGTH,
  generateShortId,
  generateDeterministicId,
  createTeamId,
  getTeamMemberId,
  createFolderId,
  getSharedSpaceTeamId,
  getSharedSpaceMemberId,
  getCollaboratorMemberId,
};
