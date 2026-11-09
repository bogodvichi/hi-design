import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readTeamResourceMaterialization, teamResourceWorkspaceRoot } from '../collab/team-resource-materialization.js';
import { getWorkspaceResourceByResourceId, listTeamWorkspaceResourceWorkspaceIds } from '../db.js';
import { workspaceTeamSkillBindingAllowsRead, workspaceTeamSkillBindingResourceId } from './workspace-team-binding.js';

type SkillEntry = { id: string; dir?: string } & Record<string, unknown>;

export function createSkillServerServices({ getDb, roots, skills }: {
  getDb?: () => Database.Database;
  roots: { SKILL_ROOTS: string[]; DESIGN_TEMPLATE_ROOTS: string[]; ALL_SKILL_LIKE_ROOTS: string[] };
  skills: {
    listSkills: (roots: string[], options?: { db?: Database.Database; workspaceId?: string | null; workspaceMemberId?: string | null }) => Promise<SkillEntry[]>;
    findSkillById: (skills: SkillEntry[], id: string) => SkillEntry | undefined;
  };
}) {
  async function listSkillsForWorkspace(options: {
    db: Database.Database;
    workspaceId?: string | null;
    workspaceMemberId?: string | null;
  }) {
    const { db } = options;
    const personalAndBuiltIn = await skills.listSkills(roots.SKILL_ROOTS, {
      db,
      workspaceId: options.workspaceId ?? null,
      workspaceMemberId: options.workspaceMemberId ?? null,
    });
    const workspaceId = options.workspaceId?.trim();
    const userSkillsRoot = roots.SKILL_ROOTS[0];
    if (!workspaceId || !userSkillsRoot) return personalAndBuiltIn;
    const workspaceRoot = teamResourceWorkspaceRoot(userSkillsRoot, workspaceId);
    let directories: fs.Dirent[] = [];
    try {
      directories = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
    } catch {
      return personalAndBuiltIn;
    }
    const markerByDirectory = new Map<string, string>();
    await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          // Skill hub ids may use either the plain local id or the historical
          // `user:` prefix. Both materialize into the same safe storage name;
          // the marker is authoritative about which logical id was pulled.
          const candidates = [entry.name, `user:${entry.name}`];
          let marker = null;
          for (const candidate of candidates) {
            marker = await readTeamResourceMaterialization(
              userSkillsRoot,
              workspaceId,
              candidate,
              entry.name,
            );
            if (marker) break;
          }
          if (
            marker?.kind !== 'skill'
            || !workspaceTeamSkillBindingAllowsRead(db, workspaceId, marker.resourceId)
          ) return;
          markerByDirectory.set(path.join(workspaceRoot, entry.name), marker.resourceId);
        }),
    );
    if (markerByDirectory.size === 0) return personalAndBuiltIn;
    const discoveredTeam = await skills.listSkills([workspaceRoot]);
    // Re-check the exact binding after filesystem parsing. Reconciliation can
    // tombstone a Team Skill while SKILL.md and its attachments are being
    // read; that newer negative verdict must win over the stale directory.
    const team = discoveredTeam.filter((entry) => {
      const logicalId = typeof entry.dir === 'string'
        ? markerByDirectory.get(entry.dir)
        : undefined;
      return Boolean(
        logicalId
        && (entry.id === logicalId || entry.id.startsWith(`${logicalId}:`))
        && workspaceTeamSkillBindingAllowsRead(db, workspaceId, logicalId),
      );
    });
    const teamIds = new Set(team.map((entry) => entry.id));
    return [
      ...team.map((entry) => {
        const logicalId = markerByDirectory.get(entry.dir ?? '');
        const binding = logicalId
          ? getWorkspaceResourceByResourceId(
              db,
              'skill',
              workspaceTeamSkillBindingResourceId(workspaceId, logicalId),
            )
          : undefined;
        return {
          ...entry,
          teamSynced: true,
          ...(binding?.createdByWorkspaceMemberId
            ? { ownerMemberId: binding.createdByWorkspaceMemberId }
            : {}),
          ...(binding?.workspaceId
            ? { workspaceId: binding.workspaceId }
            : {}),
        };
      }),
      ...personalAndBuiltIn.filter((entry) => !teamIds.has(entry.id)),
    ];
  }

  async function listAllSkills(options: {
    workspaceId?: string | null;
    workspaceMemberId?: string | null;
    aggregateAllWorkspaces?: boolean;
  } = {}) {
    const db = getDb?.();
    if (!db || options.workspaceId === undefined) {
      return skills.listSkills(roots.SKILL_ROOTS);
    }
    if (options.aggregateAllWorkspaces) {
      const workspaceIds = Array.from(new Set([
        options.workspaceId?.trim(),
        ...listTeamWorkspaceResourceWorkspaceIds(db),
      ].filter((workspaceId): workspaceId is string => Boolean(workspaceId?.trim()))));
      const catalogs = await Promise.all(workspaceIds.map((workspaceId) => (
        listSkillsForWorkspace({
          db,
          workspaceId,
          workspaceMemberId: options.workspaceMemberId ?? null,
        })
      )));
      const seen = new Set<string>();
      const merged: Array<SkillEntry> = [];
      for (const catalog of catalogs) {
        for (const entry of catalog) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          merged.push(entry);
        }
      }
      return merged;
    }
    return listSkillsForWorkspace({
      db,
      workspaceId: options.workspaceId,
      workspaceMemberId: options.workspaceMemberId ?? null,
    });
  }

  async function listAllDesignTemplates() {
    return skills.listSkills(roots.DESIGN_TEMPLATE_ROOTS);
  }

  async function listAllSkillLikeEntries(
    options: {
      workspaceId?: string | null;
      workspaceMemberId?: string | null;
      aggregateAllWorkspaces?: boolean;
    } = {},
  ) {
    if (options.workspaceId === undefined) {
      return skills.listSkills(roots.ALL_SKILL_LIKE_ROOTS);
    }
    const [functional, templates] = await Promise.all([
      listAllSkills(options),
      listAllDesignTemplates(),
    ]);
    const functionalIds = new Set(functional.map((entry) => entry.id));
    return [
      ...functional,
      ...templates.filter((entry) => !functionalIds.has(entry.id)),
    ];
  }

  async function validateProjectSkillId(
    id: unknown,
    options: { workspaceId?: string | null; workspaceMemberId?: string | null } = {},
  ) {
    // Same invariant as exact-source plugins: project
    // creation follows locally reconciled content. Team membership is checked
    // by remote install/pull/sync/share operations, not by Send. Eventual
    // consistency is intentional: a stale local copy remains usable until
    // reconciliation records the retraction in the local catalog.
    if (id === undefined || id === null || id === '') {
      return { ok: true, id: null };
    }
    if (typeof id !== 'string') {
      return {
        ok: false,
        code: 'INVALID_SKILL_ID',
        message: 'skillId must be a string or null',
      };
    }
    const allSkills = await listAllSkillLikeEntries(options);
    const resolved = skills.findSkillById(allSkills, id);
    if (!resolved) {
      return {
        ok: false,
        code: 'SKILL_NOT_FOUND',
        message: 'skill not found',
      };
    }
    return { ok: true, id: resolved.id };
  }
  return { listAllSkills, listAllDesignTemplates, listAllSkillLikeEntries, validateProjectSkillId };
}
