import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import { useI18n } from '../i18n';
import { getProjectDetail, listProjects } from '../state/projects';
import type { WorkspaceCollabContext, WorkspaceDirectoryItem } from '@open-design/contracts';
import {
  workspaceContextFromDirectoryItem,
  workspaceDirectoryItemFromContext,
} from '../collab/useWorkspaceContext';
import { dirExists } from '../providers/registry';
import { relativeTimeLong } from '../utils/chatTime';
import { Icon } from './Icon';
import {
  fetchOwnedProjectsAtLocation,
  fetchProjectFolderIndex,
  type ProjectFolderNode,
} from './project-picker-data';
import styles from './ProjectReferenceModal.module.css';

export interface ProjectReferenceSelection {
  project: Project;
  resolvedDir: string;
}

interface Props {
  currentProjectId?: string | null;
  workspaceContext?: WorkspaceCollabContext | null;
  onClose: () => void;
  onSelect: (items: ProjectReferenceSelection[]) => void;
}

function projectSearchText(project: Project): string {
  return [
    project.id,
    project.name,
    project.metadata?.kind ?? '',
    project.metadata?.baseDir ?? '',
    project.metadata?.entryFile ?? '',
    ...(project.metadata?.linkedDirs ?? []),
  ].join(' ');
}

function projectCoverUrl(project: Project): string | null {
  const digest = project.coverDigest?.trim();
  if (!digest) return null;
  return project.workspaceVisibility === 'team'
    ? `/api/hdw/api/community/cover/${encodeURIComponent(digest)}`
    : `/api/projects/${encodeURIComponent(project.id)}/cover?digest=${encodeURIComponent(digest)}`;
}

function ProjectReferenceThumbnail({ project }: { project: Project }) {
  const coverUrl = projectCoverUrl(project);
  const initial = project.name.trim().slice(0, 1) || '?';
  return (
    <span className={styles.itemCover} aria-hidden>
      <span className={styles.itemCoverFallback}>{initial}</span>
      {coverUrl ? (
        <img
          className={styles.itemCoverImage}
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      ) : null}
    </span>
  );
}

export function ProjectReferenceModal({
  currentProjectId,
  workspaceContext = null,
  onClose,
  onSelect,
}: Props) {
  const { locale, t } = useI18n();
  const loadFailedMessage = t('chat.referenceProject.loadFailed');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceDirectoryItem[] | null>(null);
  const [projectFolders, setProjectFolders] = useState<Record<string, ProjectFolderNode[]>>({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [workspaceDirectoryAvailable, setWorkspaceDirectoryAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seededSelectionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setWorkspaces(null);
    setProjectFolders({});
    setWorkspaceDirectoryAvailable(false);
    void (async () => {
      try {
        const response = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!response.ok) throw new Error('workspace directory load failed');
        const body = await response.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const items = (body.items ?? []).filter((item) => (
          !item.isSharedSpace
          && item.memberStatus === 'active'
          && item.lifecycleState !== 'deleted'
          && (item.isDefaultTeam === true || item.workspaceType === 'team')
        ));
        const folderEntries = await Promise.all(items.map(async (item) => (
          [item.workspaceId, await fetchProjectFolderIndex(item).catch(() => [])] as const
        )));
        if (cancelled) return;
        const folderMap = Object.fromEntries(folderEntries);
        const initial = items.find((item) => item.workspaceId === workspaceContext?.workspaceId)
          ?? items.find((item) => item.isDefaultTeam === true)
          ?? items[0]
          ?? null;
        setWorkspaces(items);
        setProjectFolders(folderMap);
        setWorkspaceDirectoryAvailable(true);
        setExpandedWorkspaceIds(new Set(
          folderEntries
            .filter(([, folders]) => folders.some((folder) => folder.parentId == null))
            .map(([workspaceId]) => workspaceId),
        ));
        setActiveWorkspaceId(initial?.workspaceId ?? null);
        setActiveFolderId(null);
      } catch {
        if (cancelled) return;
        const fallback = workspaceContext ? [workspaceDirectoryItemFromContext(workspaceContext)] : [];
        setWorkspaces(fallback);
        setActiveWorkspaceId(fallback[0]?.workspaceId ?? null);
        setActiveFolderId(null);
        setWorkspaceDirectoryAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceContext]);

  useEffect(() => {
    if (workspaces === null) return;
    let cancelled = false;
    const activeWorkspace = workspaces.find((item) => item.workspaceId === activeWorkspaceId) ?? null;
    setProjects(null);
    setLoadError(null);
    const loadProjects = workspaceDirectoryAvailable && activeWorkspace
      ? fetchOwnedProjectsAtLocation(
          activeWorkspace,
          activeFolderId,
          projectFolders[activeWorkspace.workspaceId] ?? [],
        )
      : listProjects({ throwOnError: true, workspaceContext });
    void loadProjects
      .then(async (rows) => {
        if (cancelled) return;
        const candidates = rows.filter((project) => project.id !== currentProjectId);
        // Hide imported/external projects whose on-disk folder is gone — they
        // can't be referenced. Managed projects have no external baseDir and
        // are always materializable on demand, so they skip the probe (and a
        // daemon that can't answer leaves everything visible).
        const stillExists = await Promise.all(
          candidates.map(async (project) => {
            const baseDir = project.metadata?.baseDir?.trim();
            return baseDir ? dirExists(baseDir) : true;
          }),
        );
        if (cancelled) return;
        const filtered = candidates.filter((_, index) => stillExists[index]);
        setProjects(filtered);
        if (!seededSelectionRef.current && filtered[0]) {
          seededSelectionRef.current = true;
          setSelectedProjects([filtered[0]]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProjects([]);
        setLoadError(loadFailedMessage);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeFolderId,
    activeWorkspaceId,
    currentProjectId,
    loadFailedMessage,
    projectFolders,
    workspaceContext,
    workspaceDirectoryAvailable,
    workspaces,
  ]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => projectSearchText(project).toLowerCase().includes(needle));
  }, [projects, query]);

  const selectedIds = useMemo(
    () => new Set(selectedProjects.map((project) => project.id)),
    [selectedProjects],
  );

  async function confirm() {
    if (selectedProjects.length === 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      const selections: ProjectReferenceSelection[] = [];
      for (const project of selectedProjects) {
        // `ensureDir` materializes a managed project's folder before we read
        // its resolved dir, so an empty (never-generated) project references
        // to a real directory instead of a path that fails existence checks.
        const persistedProjectWorkspaceId = project.workspaceId?.trim() ?? '';
        const projectWorkspace = workspaces?.find(
          (item) => item.workspaceId === persistedProjectWorkspaceId,
        ) ?? null;
        const projectWorkspaceContext = persistedProjectWorkspaceId
          && workspaceContext?.workspaceId === persistedProjectWorkspaceId
            ? workspaceContext
            : projectWorkspace
              ? workspaceContextFromDirectoryItem(projectWorkspace)
              : null;
        const detail = await getProjectDetail(
          project.id,
          { ensureDir: true },
          projectWorkspaceContext,
        );
        const resolvedDir =
          detail?.resolvedDir?.trim() || detail?.project.metadata?.baseDir?.trim() || '';
        if (!detail || !resolvedDir) {
          setError(t('homeWorkingDir.applyFailed'));
          return;
        }
        selections.push({ project: detail.project, resolvedDir });
      }
      onSelect(selections);
    } finally {
      setPending(false);
    }
  }

  function toggleSelected(project: Project) {
    setSelectedProjects((current) => (
      current.some((item) => item.id === project.id)
        ? current.filter((item) => item.id !== project.id)
        : [...current, project]
    ));
  }

  function selectLocation(workspaceId: string, folderId: string | null) {
    setActiveWorkspaceId(workspaceId);
    setActiveFolderId(folderId);
    setQuery('');
  }

  function toggleWorkspace(workspaceId: string) {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="project-reference-title">
        <header className={styles.head}>
          <h2 id="project-reference-title" className={styles.title}>
            {t('chat.referenceProject.title')}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
            disabled={pending}
          >
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.browser}>
            <aside
              className={styles.workspaceTree}
              aria-label={locale.startsWith('zh') ? '项目位置' : 'Project locations'}
            >
              {workspaces === null ? (
                <div className={styles.treeState}>{t('common.loading')}</div>
              ) : workspaces.length === 0 ? (
                <button
                  type="button"
                  className={`${styles.treeRow} ${styles.treeRowActive}`}
                >
                  <span className={styles.treeDisclosure} aria-hidden />
                  <span className={styles.treeLabel}>
                    {locale.startsWith('zh') ? '个人所有' : 'Personal'}
                  </span>
                  <small className={styles.treeTag}>
                    {locale.startsWith('zh') ? '个人' : 'Personal'}
                  </small>
                </button>
              ) : workspaces.map((workspace) => {
                const folders = projectFolders[workspace.workspaceId] ?? [];
                const rootFolders = workspace.isDefaultTeam
                  ? []
                  : folders.filter((folder) => folder.parentId == null);
                const expanded = expandedWorkspaceIds.has(workspace.workspaceId);
                const rootSelected = activeWorkspaceId === workspace.workspaceId && activeFolderId == null;
                return (
                  <div key={workspace.workspaceId}>
                    <button
                      type="button"
                      className={`${styles.treeRow}${rootSelected ? ` ${styles.treeRowActive}` : ''}`}
                      aria-expanded={rootFolders.length > 0 ? expanded : undefined}
                      onClick={() => {
                        if (rootFolders.length > 0) toggleWorkspace(workspace.workspaceId);
                        selectLocation(workspace.workspaceId, null);
                      }}
                    >
                      <span className={styles.treeDisclosure} aria-hidden>
                        {rootFolders.length > 0 ? (
                          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
                        ) : null}
                      </span>
                      <span className={styles.treeLabel}>
                        {workspace.isDefaultTeam
                          ? (locale.startsWith('zh') ? '个人所有' : 'Personal')
                          : workspace.workspaceName}
                      </span>
                      <small className={styles.treeTag}>
                        {workspace.isDefaultTeam
                          ? (locale.startsWith('zh') ? '个人' : 'Personal')
                          : (locale.startsWith('zh') ? '团队' : 'Team')}
                      </small>
                    </button>
                    {expanded ? rootFolders.map((folder) => {
                      const selected = activeWorkspaceId === workspace.workspaceId
                        && activeFolderId === folder.id;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          className={`${styles.treeRow} ${styles.treeRowChild}${selected ? ` ${styles.treeRowActive}` : ''}`}
                          onClick={() => selectLocation(workspace.workspaceId, folder.id)}
                        >
                          <span className={styles.treeDisclosure} aria-hidden />
                          <span className={styles.treeLabel}>{folder.name}</span>
                        </button>
                      );
                    }) : null}
                  </div>
                );
              })}
            </aside>
            <div className={styles.browserMain}>
              <label className={styles.search}>
                <Icon name="search" size={14} />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('chat.referenceProject.search')}
                />
              </label>
              <div
                className={styles.list}
                role="listbox"
                aria-label={t('chat.referenceProject.title')}
                aria-multiselectable="true"
              >
                {projects === null ? (
                  <div className={styles.empty}>{t('common.loading')}</div>
                ) : loadError ? (
                  <div className={styles.error} role="alert">
                    {loadError}
                  </div>
                ) : visibleProjects.length === 0 ? (
                  <div className={styles.empty}>
                    {query.trim()
                      ? t('chat.referenceProject.empty', { query })
                      : t('chat.referenceProject.emptyAll')}
                  </div>
                ) : (
                  visibleProjects.map((project) => {
                    const selected = selectedIds.has(project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`${styles.item}${selected ? ` ${styles.itemSelected}` : ''}`}
                        onClick={() => toggleSelected(project)}
                        data-testid={`project-reference-option-${project.id}`}
                      >
                        <ProjectReferenceThumbnail project={project} />
                        <span className={styles.itemText}>
                          <span className={styles.itemTitle}>{project.name}</span>
                          <span className={styles.itemMeta}>{relativeTimeLong(project.updatedAt, t)}</span>
                        </span>
                        <span
                          className={`${styles.check}${selected ? ` ${styles.checkSelected}` : ''}`}
                          data-testid={`project-reference-check-${project.id}`}
                          aria-hidden
                        >
                          {selected ? <Icon name="check" size={13} /> : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.button} onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => void confirm()}
            disabled={selectedProjects.length === 0 || pending}
          >
            {pending ? t('common.loading') : t('chat.referenceProject.confirm')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
