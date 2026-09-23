import type { Express, RequestHandler } from 'express';
import type { FolderMoveCleanupRequest } from '@open-design/contracts';
import {
  createWorkspaceFolder,
  listSubFolders,
  deleteWorkspaceFolder,
  updateWorkspaceFolder,
  listFolderPreview,
  countProjectsInFolder,
  countProjectsInAllFolders,
  getWorkspaceFolder,
  getFolderTree,
  getFolderPath,
  listProjectsInFolder,
  normalizeProject,
  type WorkspaceFolderInput,
} from '../db.js';
import {
  createHdwFolders,
  fetchHdwFolderDetail,
  fetchHdwFolderShareRecipients,
} from '../http/hdw.js';

export interface RegisterFolderRoutesDeps {
  db: any;
  http: {
    requireLocalDaemonRequest: RequestHandler;
    sendApiError: (...args: any[]) => any;
  };
  dataDir?: string;
}

interface FolderRow {
  folderId: string;
  folderPid: string | null;
  workspaceId: string;
  folderName: string;
  createdAt: string;
  ownerMemberId: string | null;
}

/**
 * Local folder CRUD routes. Unlike the HDW proxy (`/api/hdw/api/folder/*`)
 * which forwards to the upstream backend, these routes operate directly on the
 * daemon's local SQLite `folders` table. They are used by the personal-all
 * scope view where folders belong to the user's personal workspace.
 */
export function registerFolderRoutes(app: Express, deps: RegisterFolderRoutesDeps): void {
  const { db, http } = deps;
  const { requireLocalDaemonRequest, sendApiError } = http;

  // Batch project counts for all folders in a workspace. Used by the team
  // space view to enrich the HDW folder list (which doesn't return
  // project_count) with local SQLite counts in a single request.
  // GET /api/folders/counts?workspace_id=<id>
  app.get('/api/folders/counts', async (req, res) => {
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    try {
      const counts = countProjectsInAllFolders(db, workspaceId);
      res.json({ code: 0, data: { counts } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  // List root-level or sub-level folders for a workspace.
  // GET /api/folders?workspace_id=<id>[&folder_pid=<pid>]
  // When folder_pid is omitted, returns root-level folders (folder_pid IS NULL).
 app.get('/api/folders', async (req, res) => {
   const workspaceId = String(req.query.workspace_id ?? '').trim();
   if (!workspaceId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
   }
   const folderPid =
     typeof req.query.folder_pid === 'string' && req.query.folder_pid.trim()
       ? String(req.query.folder_pid).trim()
       : null;
   // Extract the workspace member ID from the request context headers so
   // personal-scope folder lists are filtered by owner.
   const ownerMemberId = typeof req.get === 'function'
     ? (req.get('x-od-workspace-member-id') || '').trim() || null
     : null;
   try {
     const folders = listSubFolders(db, workspaceId, folderPid, ownerMemberId) as FolderRow[];
     const result = folders.map((f) => {
       const preview = listFolderPreview(db, workspaceId, f.folderId, 4, ownerMemberId);
       const projectCount = countProjectsInFolder(db, workspaceId, f.folderId);
       const subfolderCount = listSubFolders(db, workspaceId, f.folderId, ownerMemberId).length;
       return {
         folder_id: f.folderId,
         folder_pid: f.folderPid,
         folder_name: f.folderName,
         workspace_id: f.workspaceId,
         created_at: f.createdAt,
         owner_member_id: f.ownerMemberId,
         project_count: projectCount,
         subfolder_count: subfolderCount,
        subfolder_preview: preview,
       };
     });
      res.json({ code: 0, data: { folders: result } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

 // Create a folder under a workspace (root-level when folder_pid is null/omitted).
  // Get a single folder's detail (including folder_pid for breadcrumb walking).
  // GET /api/folders/:folderId?workspace_id=<id>
  app.get('/api/folders/:folderId', async (req, res) => {
    const folderId = String(req.params.folderId ?? '').trim();
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    if (!folderId || !workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId or workspace_id');
    }
    try {
      const folder = getWorkspaceFolder(db, workspaceId, folderId) as FolderRow | undefined;
      if (!folder) {
        return res.status(404).json({ code: 1, error: 'NOT_FOUND', message: 'Folder not found' });
      }
      const path = getFolderPath(db, workspaceId, folderId) as Array<{
        folderId: string; folderName: string; folderPid: string | null;
      }>;
      res.json({
        code: 0,
        data: {
          folder_id: folder.folderId,
          folder_pid: folder.folderPid,
          workspace_id: folder.workspaceId,
          folder_name: folder.folderName,
          created_at: folder.createdAt,
          path: path.map((p) => ({ folder_id: p.folderId, folder_name: p.folderName })),
        },
      });
   } catch (err) {
     sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
   }
 });

 // List projects directly inside a folder (or at the workspace root when
 // folderId is the special value "root"). GET /api/folders/:folderId/projects
 // ?workspace_id=<id>  — returns { projects: Project[] } shaped the same as
 // GET /api/projects so the web client can reuse the same card rendering.
app.get('/api/folders/:folderId/projects', async (req, res) => {
   const folderIdRaw = String(req.params.folderId ?? '').trim();
   const workspaceId = String(req.query.workspace_id ?? '').trim();
   if (!workspaceId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
   }
   // "root" is a sentinel for the workspace root (folder_id IS NULL).
   const folderId = folderIdRaw && folderIdRaw !== 'root' ? folderIdRaw : null;
try {
   // Extract the workspace member ID from the request context headers so
   // personal projects are filtered by creator, not just by workspace.
   // Without this, every member of a shared space sees every other
   // member's personal (visibility='personal') projects.
   const headerMemberId = typeof req.get === 'function'
     ? (req.get('x-od-workspace-member-id') || '').trim() || null
     : null;
 const rows = listProjectsInFolder(db, workspaceId, folderId, headerMemberId);
  const projects = rows.map((row) => ({
    ...normalizeProject(row),
    workspaceId: row.workspaceId ?? null,
    createdByWorkspaceMemberId: row.createdByWorkspaceMemberId ?? null,
    updatedByWorkspaceMemberId: row.updatedByWorkspaceMemberId ?? null,
    workspaceVisibility: row.workspaceVisibility ?? null,
  }));
    res.json({ code: 0, data: { projects } });
  } catch (err) {
    sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
  }
 });

// POST /api/folders  body: { workspace_id, folder_name, folder_pid? }
 app.post('/api/folders', requireLocalDaemonRequest, async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    const workspaceId = typeof body?.workspace_id === 'string' ? body.workspace_id.trim() : '';
    const folderName = typeof body?.folder_name === 'string' ? body.folder_name.trim() : '';
    const folderPid =
      typeof body?.folder_pid === 'string' && body.folder_pid.trim()
        ? String(body.folder_pid).trim()
        : null;
    if (!workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
    }
    if (!folderName) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folder_name');
    }
   try {
     // Stamp the folder with the requesting member's ID so personal-scope
     // views can filter folders by owner.
     const ownerMemberId = typeof req.get === 'function'
       ? (req.get('x-od-workspace-member-id') || '').trim() || null
       : null;
     const input: WorkspaceFolderInput = {
       workspaceId,
       folderPid,
       folderName,
       ownerMemberId,
     };
     const folderId = createWorkspaceFolder(db, input);

      // If this is a subfolder (folder_pid is set), check whether any
      // ancestor folder exists on the HDW cloud and has share recipients.
      // With the folder_shares approach, only the topmost shared folder
      // has a record — descendants' records are cleaned up when a parent
      // is shared. So we walk up the ancestor chain to find the nearest
      // shared ancestor, then push the new subfolder to the cloud so it
      // appears in the recipients' shared views. No folder_shares record
      // is created for the new subfolder — it's implicitly shared through
      // its ancestor, and the list() endpoint shows all subfolders of a
      // shared parent without requiring individual folder_shares records.
      if (folderPid && deps.dataDir) {
        try {
          // Walk up the ancestor chain to find the nearest shared ancestor.
          let currentId: string | null = folderPid;
          let recipients: string[] = [];
          for (let i = 0; i < 20 && currentId; i++) {
            const detail = await fetchHdwFolderDetail(deps.dataDir, currentId);
            if (!detail) break;
            const recs = await fetchHdwFolderShareRecipients(deps.dataDir, currentId);
            if (recs.length > 0) {
              recipients = recs;
              break;
            }
            currentId = detail.folder_pid ?? null;
          }
          if (recipients.length > 0) {
            await createHdwFolders(deps.dataDir, {
              workspaceId,
              folders: [{
                folder_id: folderId,
                folder_pid: folderPid,
                folder_name: folderName,
              }],
            });
          }
        } catch {
          // Best-effort: cloud sync of new subfolder must not block local creation.
        }
      }

     res.json({ code: 0, data: { folder_id: folderId } });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });

  // Internal completion step of the existing move workflow (not ordinary
  // deletion). An older daemon has no such route and therefore fails closed.
  app.post('/api/folders/:folderId/move-cleanup', requireLocalDaemonRequest, (req, res) => {
    const folderId = String(req.params.folderId ?? '').trim();
    const body = req.body as Partial<FolderMoveCleanupRequest> | null;
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
    const expected = body?.expectedEmptyTree;
    const memberId = (req.get('x-od-workspace-member-id') || '').trim();
    if (!folderId || !workspaceId || !Array.isArray(expected) || expected.length === 0 || expected.length > 10_000
      || expected.some((node) => !node || typeof node.folderId !== 'string' || !node.folderId
        || typeof node.folderName !== 'string' || !(node.folderPid === null || typeof node.folderPid === 'string'))
      || expected[0]?.folderId !== folderId || new Set(expected.map((node) => node.folderId)).size !== expected.length) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'A valid expected empty folder tree is required');
    }
    if (!memberId) return sendApiError(res, 403, 'FORBIDDEN', 'Folder owner identity is required');
    try {
      const outcome = db.transaction(() => {
        const root = getWorkspaceFolder(db, workspaceId, folderId) as FolderRow | undefined;
        if (!root) return 200; // A lost successful cleanup response is safe to retry.
        if (root.ownerMemberId && root.ownerMemberId !== memberId) return 403;
        // Deliberately include every descendant, not an owner-filtered subset.
        const actual = getFolderTree(db, workspaceId, folderId);
        const expectedById = new Map(expected.map((node) => [node.folderId, node]));
        if (actual.length !== expected.length || actual.some((node) => {
          const match = expectedById.get(node.folderId);
          return !match || match.folderPid !== node.folderPid || match.folderName !== node.folderName || node.projectIds.length > 0;
        })) return 409;
        if (actual.some((node) => {
          const row = getWorkspaceFolder(db, workspaceId, node.folderId) as FolderRow | undefined;
          return !row || (row.ownerMemberId && row.ownerMemberId !== memberId);
        })) return 403;
        deleteWorkspaceFolder(db, workspaceId, folderId);
        return 200;
      }).immediate();
      if (outcome === 403) return sendApiError(res, 403, 'FORBIDDEN', 'Folder mutation forbidden');
      if (outcome === 409) return sendApiError(res, 409, 'CONFLICT', 'Folder changed or still contains projects; original tree retained');
      return res.json({ code: 0, data: { folder_id: folderId } });
    } catch (error) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

 // Delete a folder. Cascades to child folders (FK ON DELETE CASCADE).
 // DELETE /api/folders/:folderId?workspace_id=<id>
 app.delete('/api/folders/:folderId', requireLocalDaemonRequest, async (req, res) => {
   const folderId = String(req.params.folderId ?? '').trim();
   const workspaceId = String(req.query.workspace_id ?? '').trim();
   if (!folderId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId');
   }
   if (!workspaceId) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'Missing workspace_id');
   }
   try {
     deleteWorkspaceFolder(db, workspaceId, folderId);
     res.json({ code: 0, data: { folder_id: folderId } });
   } catch (err) {
     sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
   }
 });

  // Rename or move a personal folder. `folder_pid: null` moves it to root.
  // PATCH /api/folders/:folderId?workspace_id=<id>
  // body: { folder_name?: string, folder_pid?: string | null }
  app.patch('/api/folders/:folderId', requireLocalDaemonRequest, async (req, res) => {
    const folderId = String(req.params.folderId ?? '').trim();
    const workspaceId = String(req.query.workspace_id ?? '').trim();
    const folderName = typeof req.body?.folder_name === 'string' ? req.body.folder_name.trim() : '';
    const ownerMemberId = typeof req.get === 'function'
      ? (req.get('x-od-workspace-member-id') || '').trim() || null
      : null;
    const hasFolderPid = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'folder_pid');
    const folderPid = hasFolderPid && typeof req.body?.folder_pid === 'string'
      ? req.body.folder_pid.trim() || null
      : null;
    if (!folderId || !workspaceId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folderId or workspace_id');
    }
    if (!folderName && !hasFolderPid) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Missing folder_name or folder_pid');
    }
    try {
      const folder = getWorkspaceFolder(db, workspaceId, folderId) as FolderRow | undefined;
      if (!folder) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Folder not found');
      }
      if (folder.ownerMemberId && folder.ownerMemberId !== ownerMemberId) {
        return sendApiError(res, 403, 'FORBIDDEN', 'Folder mutation forbidden');
      }
      if (hasFolderPid) {
        if (folderPid === folderId) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'A folder cannot be moved into itself');
        }
        if (folderPid) {
          const parent = getWorkspaceFolder(db, workspaceId, folderPid) as FolderRow | undefined;
          if (!parent) {
            return sendApiError(res, 404, 'NOT_FOUND', 'Target folder not found');
          }
          if (parent.ownerMemberId && parent.ownerMemberId !== ownerMemberId) {
            return sendApiError(res, 403, 'FORBIDDEN', 'Target folder mutation forbidden');
          }
        }
        const descendants = new Set(
          getFolderTree(db, workspaceId, folderId, folder.ownerMemberId).slice(1).map((item) => item.folderId),
        );
        if (folderPid && descendants.has(folderPid)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'A folder cannot be moved into its descendant');
        }
      }
      updateWorkspaceFolder(db, workspaceId, folderId, {
        ...(folderName ? { folderName } : {}),
        ...(hasFolderPid ? { folderPid } : {}),
      });
      res.json({
        code: 0,
        data: {
          folder_id: folderId,
          ...(folderName ? { folder_name: folderName } : {}),
          ...(hasFolderPid ? { folder_pid: folderPid } : {}),
        },
      });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  });
}
