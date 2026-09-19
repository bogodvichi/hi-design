import { PageEmptyState } from './PageEmptyState';
import { ModuleBreadcrumb } from './ModuleBreadcrumb';
// Scope view for the "/share-me" route. Fetches projects shared to
// the current user via the Shared Space and renders them with
// RecentProjectsStrip. Shared-space projects are read + comment only.
//
// Also exports SharedFolderView for the "/share-me/folder/:folderId"
// route — subfolder navigation within the shared space, with folder
// cards and project lists identical to the team folder view.
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import type { SharedWithMeProject, WorkspaceDirectoryItem } from '@open-design/contracts';
import type { ProjectTitleHint } from './EntryShell';
import { Icon, type IconName } from './Icon';
import { RecentProjectsStrip } from './RecentProjectsStrip';
import { CloudSkillList } from './CloudSkillList';
import { CloudMcpList } from './CloudMcpList';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { Project } from '../types';
import { fetchSharedWithMeCatalog } from '../collab/shared-space-catalog';
import styles from './TeamSpaceView.module.css';

type ScopeTab = 'projects' | 'skill' | 'mcp';

interface TabDef {
  id: ScopeTab;
  icon: IconName;
  labelKey: keyof Dict;
}

const TABS: TabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'personalScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'personalScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'personalScope.tabMcp' },
];

function sharedRowToProject(row: SharedWithMeProject): Project {
  const sharedAtMs = Date.parse(row.sharedAt);
  const fallback = Number.isFinite(sharedAtMs) ? sharedAtMs : 0;
  return {
    id: row.projectId,
    name: row.displayName?.trim() || '',
    skillId: null,
    designSystemId: null,
    createdAt: fallback,
    updatedAt: fallback,
    workspaceId: row.homeWorkspaceId,
    createdByWorkspaceMemberId: row.ownerMemberId ?? null,
    ownerDisplayName: row.sharedByDisplayname ?? null,
    ...(row.metadata ? { metadata: row.metadata as unknown as Project['metadata'] } : {}),
    coverDigest: row.coverDigest ?? null,
  };
}

interface SharedFolderItem {
  folderId: string;
  folderName: string;
  projectCount: number;
  subfolderCount: number;
  subfolderPreview: Array<{ name: string; kind: 'folder' | 'project' }>;
  createdAt: string;
}

interface BreadcrumbItem {
  folderId: string;
  folderName: string;
}

function parseFolderList(list: any[], counts: Record<string, number>): SharedFolderItem[] {
  return list.map((f) => ({
    folderId: f.folder_id || f.id || '',
    folderName: f.folder_name || f.name || '',
    projectCount: counts[f.folder_id || f.id || ''] ?? Number(f.project_count) ?? 0,
    subfolderCount: Number(f.subfolder_count) || 0,
    subfolderPreview: Array.isArray(f.subfolder_preview)
      ? f.subfolder_preview.map((p: any) =>
          typeof p === 'string'
            ? { name: p, kind: 'folder' as const }
            : { name: p.name || '', kind: (p.kind === 'project' ? 'project' : 'folder') as 'folder' | 'project' })
      : [],
    createdAt: f.created_at || '',
  }));
}
function FolderCard({ folder, onClick }: { folder: SharedFolderItem; onClick: () => void }) {
  const t = useT();
  return (
    <article
      className={styles.folderCard}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title={folder.folderName}
    >
      <div className={styles.folderCardGrid}>
        {Array.from({ length: 4 }, (_, i) => {
          const item = folder.subfolderPreview[i];
          if (!item) {
            return <div key={i} className={styles.gridCellEmpty} />;
          }
          if (item.kind === 'project') {
            return (
              <div key={i} className={`${styles.gridCell} ${styles.gridCellProject}`} title={item.name} />
            );
          }
          return (
            <div key={i} className={styles.gridCell} title={item.name}>
              <svg viewBox="0 0 16 16" width="24" height="24" fill="none" className={styles.gridCellIcon} aria-hidden="true">
                <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
                <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
              </svg>
            </div>
          );
        })}
      </div>
      <div className={styles.folderCardInfo}>
        <div className={styles.folderCardTitle}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" className={styles.folderIcon} aria-hidden="true">
            <path d="M1.5 1L7.11362 1C7.75952 1 8.36567 1.31193 8.74109 1.83752L11 5L0 5L0 2.5C0 1.67157 0.671573 1 1.5 1Z" fill="rgb(253,153,52)" fillRule="evenodd" />
            <path d="M0 3L14 3C15.1046 3 16 3.89543 16 5L16 13C16 14.1046 15.1046 15 14 15L2 15C0.89543 15 0 14.1046 0 13L0 3Z" fill="rgb(255,197,15)" fillRule="evenodd" />
          </svg>
          <span className={styles.folderName}>{folder.folderName}</span>
        </div>
        <div className={styles.folderCardMeta}>
          <div className={styles.folderCounts}>
            <span className={styles.folderCount}>
              {t('teamSpace.subFolderCount', { n: folder.subfolderCount })}
            </span>
            <span className={styles.folderCountDot} aria-hidden="true" />
            <span className={styles.folderCount}>
              {t('teamSpace.projectGroupCount', { n: folder.projectCount })}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
export function SharedWithMeView({
  tab,
  onOpenProject,
}: {
  tab?: string;
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
}) {
  const t = useT();
  const [controlsEl, setControlsEl] = useState<HTMLDivElement | null>(null);
  const { context: workspaceContext } = useWorkspaceContext();
  const operator = workspaceContext?.workspaceMemberId
    ? {
        memberId: workspaceContext.workspaceMemberId,
        role: (workspaceContext.role ?? 'member') as 'owner' | 'admin' | 'member' | 'guest',
      }
    : null;
  const routeTab = tab === 'skill' || tab === 'mcp' ? tab : 'projects';
  const [activeTab, setActiveTab] = useState<ScopeTab>(routeTab);

  useEffect(() => {
    setActiveTab(routeTab);
  }, [routeTab]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<SharedFolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceMemberId, setWorkspaceMemberId] = useState<string | null>(null);
  const [workspaceType, setWorkspaceType] = useState<string | null>(null);

  const sharedRowsRef = useRef<SharedWithMeProject[]>([]);

  // Resolve the shared space workspace ID + member ID from the directory
  // (the item with isDefaultTeam === true is the shared space).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const shared = body.items?.find((item) => item.isDefaultTeam === true);
        setWorkspaceId(shared?.workspaceId ?? null);
        setWorkspaceMemberId(shared?.workspaceMemberId ?? null);
        setWorkspaceType(shared?.workspaceType ?? null);
      } catch {
        // leave workspaceId null
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch shared-with-me projects (all of them, to compute folder counts
  // and root-level project list).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const rows = await fetchSharedWithMeCatalog();
        if (cancelled) return;
        setProjects(rows.map((r) => sharedRowToProject(r)));
        if (!cancelled) sharedRowsRef.current = rows;
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    function onRefresh() {
      void load();
    }
    window.addEventListener('shared:projects-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('shared:projects-refresh', onRefresh);
    };
  }, []);

  // Fetch root folders from the shared space.
  // The daemon route filters by recipient_member_id internally.
  useEffect(() => {
    let cancelled = false;
    const loadFolders = async () => {
      setFoldersLoading(true);
      try {
        const res = await fetch(
          `/api/workspace/folders/shared-with-me`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.folders ?? [];
        // Compute project counts per folder from the shared-with-me list.
        const counts: Record<string, number> = {};
        for (const r of sharedRowsRef.current) {
          const fid = r.folderId ?? null;
          if (fid) counts[fid] = (counts[fid] ?? 0) + 1;
        }
        setFolders(parseFolderList(list, counts));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    };
    void loadFolders();
    function onFoldersUpdated() {
      void loadFolders();
    }
    window.addEventListener('shared:folders-updated', onFoldersUpdated);
    window.addEventListener('shared:projects-refresh', onFoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('shared:folders-updated', onFoldersUpdated);
      window.removeEventListener('shared:projects-refresh', onFoldersUpdated);
    };
  }, []);

  const title = t('sharedSpace.title');
  const subtitle = t('sharedSpace.subtitle');

  const handleOpen = useCallback(
    (id: string) => {
      const row = sharedRowsRef.current.find((r) => r.projectId === id);
      const hint: ProjectTitleHint | undefined = row
        ? {
            name: row.displayName?.trim() || '',
            workspaceId: workspaceContext?.workspaceId ?? null,
            workspaceMemberId: workspaceContext?.workspaceMemberId ?? null,
            authoritative: true,
            homeWorkspaceId: row.homeWorkspaceId,
          }
        : undefined;
      return onOpenProject(id, undefined, hint);
    },
    [onOpenProject, workspaceContext],
  );

  function handleFolderClick(folder: SharedFolderItem) {
    navigate({ kind: 'home', view: 'shared-folder', sharedFolderId: folder.folderId });
  }

  // Root-level projects: folderId is null.
  const rootProjects = projects.filter((p) => {
    const row = sharedRowsRef.current.find((r) => r.projectId === p.id);
    return !row?.folderId;
  });

  return (
    <section className={styles.view} aria-labelledby="shared-with-me-title">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 id="shared-with-me-title" className={styles.title}>{title}</h1>
          <span className={styles.subtitle}>
            <span className={styles.dot} aria-hidden />
            {subtitle}
          </span>
        </div>
      </header>

      <div ref={setControlsEl} className={styles.typeTabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
            onClick={() => {
              setActiveTab(tab.id);
              navigate(
                { kind: 'home', view: 'shared-with-me', tab: tab.id === 'projects' ? undefined : tab.id },
                { replace: true },
              );
            }}
          >
            <Icon name={tab.icon} size={16} aria-hidden />
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className={styles.content} role="tabpanel">
        {activeTab === 'projects' ? (
          <div className={styles.projectsWrap}>
            {/* Folder cards (shared to current user) */}
            <div className={styles.folderList}>
              {foldersLoading ? (
                <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
              ) : folders.length === 0 ? (
                null
              ) : folders.map((folder) => (
                <FolderCard
                  key={folder.folderId}
                  folder={folder}
                  onClick={() => handleFolderClick(folder)}
                />
              ))}
            </div>
            {/* Root-level shared projects */}
            <div className={styles.projectsSection}>
              <RecentProjectsStrip
                projects={rootProjects}
                loading={loading}
                emptyContent={folders.length === 0 && !foldersLoading ? (
                  <PageEmptyState />
                ) : null}
                heading=""
                space="team"
                operator={operator}
                onOpen={handleOpen}
                hideTitle
                controlsPortalTarget={controlsEl}
              />
            </div>
          </div>
        ) : activeTab === 'skill' ? (
          <CloudSkillList
            workspaceId={workspaceId}
            workspaceMemberId={workspaceMemberId}
            workspaceType={workspaceType}
            mode="shared"
          />
        ) : (
          <CloudMcpList
            workspaceId={workspaceId}
            workspaceMemberId={workspaceMemberId}
            workspaceType={workspaceType}
            mode="shared"
          />
        )}
      </div>
    </section>
  );
}
export function SharedFolderView({
  folderId,
  onOpenProject,
}: {
  folderId?: string;
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
}) {
  const t = useT();
  const [controlsEl, setControlsEl] = useState<HTMLDivElement | null>(null);
  const { context: workspaceContext } = useWorkspaceContext();
  const operator = workspaceContext?.workspaceMemberId
    ? {
        memberId: workspaceContext.workspaceMemberId,
        role: (workspaceContext.role ?? 'member') as 'owner' | 'admin' | 'member' | 'guest',
      }
    : null;

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [loading, setLoading] = useState(Boolean(folderId));
  const [folders, setFolders] = useState<SharedFolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const sharedRowsRef = useRef<SharedWithMeProject[]>([]);

  // Build breadcrumb path by walking up the folder_pid chain.
  useEffect(() => {
    if (!folderId) { setBreadcrumb([]); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const path: BreadcrumbItem[] = [];
        let currentId: string | null = folderId;
        for (let i = 0; i < 20 && currentId; i++) {
          const res = await fetch(
            `/api/hdw/api/folder/detail?folder_id=${encodeURIComponent(currentId)}`,
            { cache: 'no-store' },
          );
          if (!res.ok) break;
          const body: any = await res.json();
          if (cancelled) return;
          if (body?.code !== 0 || !body?.data) break;
          const folder: any = body.data;
          path.unshift({ folderId: folder.folder_id, folderName: folder.folder_name || '' });
          currentId = folder.folder_pid || null;
        }
        if (!cancelled) setBreadcrumb(path);
      } catch {
        // empty breadcrumb
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [folderId]);

  // Fetch subfolders whose folder_pid equals the current folderId,
  // The daemon route filters by recipient_member_id internally.
  useEffect(() => {
    if (!folderId) { setFolders([]); return; }
    let cancelled = false;
    const loadFolders = async () => {
      setFoldersLoading(true);
      try {
        const res = await fetch(
          `/api/workspace/folders/shared-with-me?folder_pid=${encodeURIComponent(folderId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setFolders([]); return; }
        const body = await res.json();
        if (cancelled) return;
        const list: any[] = body?.folders ?? [];
        const counts: Record<string, number> = {};
        for (const r of sharedRowsRef.current) {
          const fid = r.folderId ?? null;
          if (fid) counts[fid] = (counts[fid] ?? 0) + 1;
        }
        setFolders(parseFolderList(list, counts));
      } catch {
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    };
    void loadFolders();
    function onSubfoldersUpdated() {
      void loadFolders();
    }
    window.addEventListener('shared:subfolders-updated', onSubfoldersUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('shared:subfolders-updated', onSubfoldersUpdated);
    };
  }, [folderId]);

  // Fetch shared-with-me projects (all, to compute folder counts and
  // filter this folder's projects).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setProjectsLoading(true);
      try {
        const rows = await fetchSharedWithMeCatalog();
        if (cancelled) return;
        sharedRowsRef.current = rows;
        // Filter projects in this folder.
        const folderProjects = rows
          .filter((r) => r.folderId === folderId)
          .map(sharedRowToProject);
        setProjects(folderProjects);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    };
    void load();
    function onRefresh() {
      void load();
    }
    window.addEventListener('shared:projects-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('shared:projects-refresh', onRefresh);
    };
  }, [folderId]);

  const handleOpen = useCallback(
    (id: string) => {
      const row = sharedRowsRef.current.find((r) => r.projectId === id);
      const hint: ProjectTitleHint | undefined = row
        ? {
            name: row.displayName?.trim() || '',
            workspaceId: workspaceContext?.workspaceId ?? null,
            workspaceMemberId: workspaceContext?.workspaceMemberId ?? null,
            authoritative: true,
            homeWorkspaceId: row.homeWorkspaceId,
          }
        : undefined;
      return onOpenProject(id, undefined, hint);
    },
    [onOpenProject, workspaceContext],
  );

  function handleFolderClick(folder: SharedFolderItem) {
    navigate({ kind: 'home', view: 'shared-folder', sharedFolderId: folder.folderId });
  }

  const currentFolderName = breadcrumb.length > 0 ? (breadcrumb[breadcrumb.length - 1]?.folderName ?? '').trim() : '';

  if (loading) {
    return (
      <section className={styles.view}>
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.view} aria-labelledby="shared-folder-title">
      <ModuleBreadcrumb items={[
        { key: 'root', label: t('sharedSpace.title'), onNavigate: () => navigate({ kind: 'home', view: 'shared-with-me' }) },
        ...breadcrumb.slice(0, -1).map((item) => ({
          key: item.folderId,
          label: item.folderName,
          onNavigate: () => navigate({ kind: 'home', view: 'shared-folder', sharedFolderId: item.folderId }),
        })),
      ]} />
      <header className={`${styles.header} ${styles.secondaryHeader}`}>
        <div className={styles.titleBlock}>
          <h1 id="shared-folder-title" className={styles.title}>
            {currentFolderName || t('teamSpace.folderSubtitle')}
          </h1>
        </div>
      </header>

      <div className={styles.content} role="tabpanel">
        <div className={styles.projectsWrap}>
          <div ref={setControlsEl} className={styles.folderControls} />

          {/* Subfolder cards */}
          <div className={styles.folderList}>
            {foldersLoading ? (
              <div className={styles.folderEmpty}>{t('teamSpace.loading')}</div>
            ) : folders.length === 0 ? (
              null
            ) : folders.map((folder) => (
              <FolderCard
                key={folder.folderId}
                folder={folder}
                onClick={() => handleFolderClick(folder)}
              />
            ))}
          </div>

          {/* Projects directly inside this folder */}
          <div className={styles.projectsSection}>
            <RecentProjectsStrip
          loading={projectsLoading}
          emptyContent={folders.length > 0 || foldersLoading ? null : undefined}
                projects={projects}
                heading=""
                space="team"
                operator={operator}
                onOpen={handleOpen}
                hideTitle
                controlsPortalTarget={controlsEl}
              />
          </div>
        </div>
      </div>
    </section>
  );
}
