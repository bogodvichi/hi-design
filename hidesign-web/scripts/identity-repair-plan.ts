import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getTeamMemberId, getSharedSpaceTeamId, getSharedSpaceMemberId, createTeamId } = require('../app/utils/ids.js');

type Row = Record<string, any>;
export interface IdentitySnapshot {
  workspace_members: Row[];
  resources: Row[];
  resource_versions: Row[];
  team_projects: Row[];
  workspace_project_shares: Row[];
  folder_shares: Row[];
  folders: Row[];
}
export interface Repair {
  table: 'resources' | 'team_projects' | 'workspace_project_shares' | 'folders' | 'workspace_members';
  key: { id: string } | { folder_id: string } | { workspace_id: string; workspace_member_id: string };
  before: Row;
  after: Row;
  evidence: string;
}
export function planIdentityRepairs(snapshot: IdentitySnapshot, confirmedPersonalOwners: string[] = []) {
  const repairs: Repair[] = [];
  const unresolved: { table: string; id: string; reason: string }[] = [];
  if (!Array.isArray(confirmedPersonalOwners) || confirmedPersonalOwners.some(name => typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(name) || name === 'system')) throw new Error('Invalid confirmed personal owners');
  const members = snapshot.workspace_members.map(row => ({ ...row }));
  const personal = getSharedSpaceTeamId();
  for (const username of new Set(confirmedPersonalOwners)) {
    const memberId = getSharedSpaceMemberId(username);
    const row = members.find(m => m.workspace_id === personal && m.workspace_member_id === memberId);
    if (row?.username === username) continue;
    const legacy = getTeamMemberId(personal, username);
    const evidence = snapshot.workspace_project_shares.some(share => share.home_workspace_id === personal
      && share.created_by_username === username && share.created_by_member_id === memberId
      && snapshot.team_projects.some(project => project.project_id === share.project_id && project.workspace_id === personal
        && project.owner_member_id === legacy && snapshot.resources.some(resource => resource.id === project.resource_id
          && resource.workspace_id === personal && resource.owner_member_id === legacy && !resource.deleted_at)));
    // Only repair an explicitly reviewed system placeholder. Never relabel
    // another real account, invent a member, or claim resources for a viewer.
    if (row?.username !== 'system' || row.role !== 'member' || !evidence
      || members.some(m => m.workspace_id === personal && m.username === username)) {
      unresolved.push({ table: 'workspace_members', id: memberId, reason: 'Confirmed account lacks an unambiguous system placeholder and historical ownership evidence' });
      continue;
    }
    repairs.push({ table: 'workspace_members', key: { workspace_id: personal, workspace_member_id: memberId },
      before: { username: 'system' }, after: { username }, evidence: 'Operator-confirmed account; canonical member ID, historical share issuer and exact legacy project/resource owners agree' });
    row.username = username;
  }
  const memberExists = (ws: string, id: string) => members.some(m => m.workspace_id === ws && m.workspace_member_id === id);
  const normalizedOwner = (ws: string, owner: string): string | null => {
    if (memberExists(ws, owner)) return owner;
    // Only the exact historic team-hash/shared-member mismatch is automatic.
    // A missing/null/valid-but-wrong owner is never inferred from a viewer.
    const candidates = members.filter(m => m.workspace_id === ws && [getTeamMemberId(ws, m.username), getTeamMemberId(createTeamId(`default_team_${m.username}`), m.username), getSharedSpaceMemberId(m.username)].includes(owner));
    return candidates.length === 1 ? candidates[0].workspace_member_id : null;
  };
  function change(table: Repair['table'], row: Row, after: Row, evidence: string) {
    const before = Object.fromEntries(Object.keys(after).map(key => [key, row[key] ?? null]));
    if (Object.keys(after).every(key => before[key] === after[key])) return;
    repairs.push({ table, key: table === 'folders' ? { folder_id: row.folder_id } : { id: row.id }, before, after, evidence });
  }
  const resources = new Map(snapshot.resources.map(r => [r.id, r]));
  const versions = new Map(snapshot.resource_versions.map(v => [v.id, v]));
  for (const table of ['resources', 'team_projects'] as const) {
    for (const row of snapshot[table]) {
      const owner = normalizedOwner(row.workspace_id, row.owner_member_id);
      if (owner) change(table, row, { owner_member_id: owner }, 'Exact legacy member hash matches one directory member in this workspace');
      else unresolved.push({ table, id: row.id, reason: 'Owner has no unique verified directory mapping' });
    }
  }
  for (const row of snapshot.team_projects) {
    const version = versions.get(row.last_synced_version_id);
    const resource = version && resources.get(version.resource_id);
    const owner = normalizedOwner(row.workspace_id, row.owner_member_id);
    if (resource && !resource.deleted_at && resource.workspace_id === row.workspace_id && owner
      && normalizedOwner(resource.workspace_id, resource.owner_member_id) === owner) {
      change('team_projects', row, { resource_id: resource.id }, 'Persisted version and resource agree on workspace and canonical owner');
    } else if (!resources.has(row.resource_id) || (resource && resource.id !== row.resource_id)) {
      unresolved.push({ table: 'team_projects', id: row.id, reason: 'Resource/version/owner disagree; manual evidence required' });
    }
  }
  for (const share of snapshot.workspace_project_shares) {
    const homes = snapshot.team_projects.filter(p => {
      if (p.project_id !== share.project_id) return false;
      const resource = resources.get(p.resource_id);
      const owner = normalizedOwner(p.workspace_id, p.owner_member_id);
      const creator = members.find(m => m.workspace_id === p.workspace_id && m.workspace_member_id === owner);
      return resource && !resource.deleted_at && resource.workspace_id === p.workspace_id && owner
        && normalizedOwner(resource.workspace_id, resource.owner_member_id) === owner
        && creator?.username === share.created_by_username;
    });
    // A persisted, owner-verified grant home remains authoritative even if an
    // unrelated workspace contains the same project ID. Never merge copies.
    if (homes.some(home => home.workspace_id === share.home_workspace_id)) continue;
    if (homes.length === 1) {
      change('workspace_project_shares', share, { home_workspace_id: homes[0].workspace_id }, 'Unique active home whose project and resource owners match the grant issuer');
      continue;
    }
    unresolved.push({ table: 'workspace_project_shares', id: share.id, reason: 'No unique active home with matching owner and grant issuer' });
  }
  // Folder ownership did not exist in the old cloud schema. Require both a
  // unanimous project-owner witness and matching historical share issuers.
  for (const folder of snapshot.folders.filter(f => f.workspace_id === getSharedSpaceTeamId() && !f.owner_member_id)) {
    const projects = snapshot.team_projects.filter(p => p.workspace_id === folder.workspace_id && p.folder_id === folder.folder_id);
    const owners = new Set(projects.map(p => normalizedOwner(p.workspace_id, p.owner_member_id)));
    const owner = owners.size === 1 ? [...owners][0] : null;
    const actor = owner && members.find(m => m.workspace_id === folder.workspace_id && m.workspace_member_id === owner);
    const issuers = snapshot.folder_shares.filter(s => s.folder_id === folder.folder_id);
    if (actor && issuers.length && issuers.every(s => s.shared_by_username === actor.username)) {
      change('folders', folder, { owner_member_id: owner }, 'All contained projects and all historical folder share issuers agree');
    } else unresolved.push({ table: 'folders', id: folder.folder_id, reason: 'Historical folder owner requires review; no automatic claim' });
  }
  return { repairs, unresolved };
}
