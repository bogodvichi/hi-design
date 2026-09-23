// Publish dialog for the Square (Hi广场) community surface. Project, Skill,
// and MCP publishing start from resources already owned by the user, with a
// secondary local-import/manual-entry path when the resource is not installed.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useI18n, useT } from '../i18n';
import type { Dict, Locale } from '../i18n/types';
import type { Project } from '../types';
import type { McpServerConfig, WorkspaceDirectoryItem } from '@open-design/contracts';
import {
  getProject,
  importFolderProject,
  resolvedWorkspaceContextForWrite,
} from '../state/projects';
import { fetchProjectFiles, openFolderDialog } from '../providers/registry';
import { McpConfigForm, type McpConfigSelection } from './McpConfigForm';
import {
  MCP_LOGO_KEYS,
  MCP_LOGO_LABELS,
  McpLogo,
  type McpLogoKey,
} from './McpLogo';
import {
  SKILL_LOGO_KEYS,
  SKILL_LOGO_LABELS,
  SkillLogo,
  isSkillLogoKey,
  type SkillLogoKey,
} from './SkillLogo';
import styles from './PublishDialog.module.css';
import {
  HtmlProjectCoverFrame,
  projectCoverUrl,
  selectProjectFileCover,
  type ProjectCoverOverride,
} from './project-cover';

import { uploadSkillToCloud } from '../providers/registry';
import { useWorkspaceContext, workspaceContextFromDirectoryItem } from '../collab/useWorkspaceContext';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { Toast } from './Toast';
import {
  getOpenDesignHost,
  isOpenDesignHostAvailable,
  pickAndImportHostProject,
} from '@open-design/host';
import {
  SKILL_CATEGORIES,
  normalizeSkillCategory,
  type SkillCategory,
} from '@open-design/contracts';
import { findSkillMdInZip } from '../runtime/zip-reader';
import {
  skillCategoryLabel,
  skillCategorySelectLabel,
} from '../utils/skill-category-labels';

type PublishCategory = 'projects' | 'skill' | 'mcp' | 'tool';

interface CategoryTabDef {
  id: PublishCategory;
  icon: IconName;
  labelKey: keyof Dict;
}

const CATEGORY_TABS: CategoryTabDef[] = [
  { id: 'projects', icon: 'folder', labelKey: 'squareScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'squareScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'squareScope.tabMcp' },
  { id: 'tool', icon: 'puzzle', labelKey: 'squareScope.tabTool' },
];

type FileSource = 'internal' | 'external';

/** What the caller receives when the user confirms a project publish. */
export interface PublishProjectSelection {
  projectId: string;
  /** Display name for the community card. */
  name: string;
  /** Description for the community card. */
  description: string;
}

/** What the caller receives when the user confirms a tool publish. */
export interface PublishToolSelection {
  /** Access link / URL for the tool. */
  url: string;
  /** Display name for the community card. */
  name: string;
  /** Description for the community card. */
  description: string;
}

/** What the caller receives when the user confirms an MCP publish. */
export interface PublishMcpSelection {
  label: string;
  description: string;
  config: string;
  logoKey?: McpConfigSelection['logoKey'];
}

/** What the caller receives when the user confirms a skill publish. */
export interface PublishSkillSelection {
  name: string;
  description: string;
  body: string;
  category: SkillCategory;
  logoKey?: SkillLogoKey;
}

interface Props {
  onClose: () => void;
  initialCategory?: PublishCategory;
  onPublish: (selection: PublishProjectSelection | PublishToolSelection | PublishMcpSelection | PublishSkillSelection) => void | Promise<void>;
}

function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}

function DefaultLogoPicker({
  value,
  onChange,
  locale,
}: {
  value: McpLogoKey;
  onChange: (value: McpLogoKey) => void;
  locale: string;
}) {
  return (
    <fieldset className={styles.defaultLogoPicker}>
      <legend className={styles.defaultLogoPickerLegend}>
        {locale.startsWith('zh') ? '默认 Logo' : 'Default logo'}
      </legend>
      <div className={styles.defaultLogoGrid}>
        {MCP_LOGO_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={locale.startsWith('zh') ? MCP_LOGO_LABELS[key].zh : MCP_LOGO_LABELS[key].en}
            aria-pressed={value === key}
            className={value === key ? `${styles.defaultLogoBtn} ${styles.defaultLogoBtnActive}` : styles.defaultLogoBtn}
            onClick={() => onChange(key)}
          >
            <McpLogo logoKey={key} size={34} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SkillLogoPicker({
  value,
  onChange,
  locale,
}: {
  value: SkillLogoKey;
  onChange: (value: SkillLogoKey) => void;
  locale: string;
}) {
  return (
    <fieldset className={styles.defaultLogoPicker}>
      <legend className={styles.defaultLogoPickerLegend}>
        {locale.startsWith('zh') ? '默认 Logo' : 'Default logo'}
      </legend>
      <div className={styles.defaultLogoGrid}>
        {SKILL_LOGO_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={locale.startsWith('zh') ? SKILL_LOGO_LABELS[key].zh : SKILL_LOGO_LABELS[key].en}
            aria-pressed={value === key}
            className={value === key ? `${styles.defaultLogoBtn} ${styles.defaultLogoBtnActive}` : styles.defaultLogoBtn}
            onClick={() => onChange(key)}
          >
            <SkillLogo logoKey={key} size={34} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SkillCategoryPicker({
  value,
  onChange,
  locale,
  disabled,
}: {
  value: SkillCategory | null;
  onChange: (value: SkillCategory) => void;
  locale: Locale;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.choicePicker}>
      <legend className={styles.choicePickerLegend}>{skillCategorySelectLabel(locale)}</legend>
      <div className={styles.skillCategoryOptions} role="radiogroup" aria-label={skillCategorySelectLabel(locale)}>
        {SKILL_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={value === item}
            className={value === item ? `${styles.skillCategoryOption} ${styles.skillCategoryOptionActive}` : styles.skillCategoryOption}
            onClick={() => onChange(item)}
            disabled={disabled}
          >
            {skillCategoryLabel(item, locale)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

async function fetchOwnedWorkspaceProjects(workspace: WorkspaceDirectoryItem): Promise<Project[]> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspace.workspaceId)}/projects?view=all`,
    {
      cache: 'no-store',
      headers: {
        'x-od-workspace-id': workspace.workspaceId,
        'x-od-workspace-member-id': workspace.workspaceMemberId,
        'x-od-workspace-type': workspace.workspaceType,
      },
    },
  );
  if (!response.ok) throw new Error('workspace projects load failed');
  const body = await response.json() as { projects?: any[] };
  return (body.projects ?? []).flatMap((summary) => {
    const project = summary?.project ?? {};
    const ownerMemberId = summary?.createdByWorkspaceMemberId ?? project.createdByWorkspaceMemberId;
    const visibility = summary?.visibility ?? project.workspaceVisibility;
    if (ownerMemberId !== workspace.workspaceMemberId) return [];
    if (workspace.isDefaultTeam === true && visibility !== 'personal') return [];
    if (workspace.isDefaultTeam !== true && visibility !== 'team') return [];
    if (!project.id || !project.name) return [];
    return [{
      ...project,
      coverDigest: summary?.coverDigest ?? project.coverDigest ?? null,
      workspaceId: summary?.workspaceId ?? workspace.workspaceId,
      workspaceVisibility: visibility,
      createdByWorkspaceMemberId: ownerMemberId,
    } as Project];
  }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function projectPickerCoverUrl(project: Project): string | null {
  if (!project.coverDigest) return null;
  if (project.workspaceVisibility === 'personal') {
    return `/api/projects/${encodeURIComponent(project.id)}/cover?digest=${encodeURIComponent(project.coverDigest)}`;
  }
  return `/api/hdw/api/community/cover/${encodeURIComponent(project.coverDigest)}`;
}

function ProjectPickerThumbnail({
  project,
  workspace,
}: {
  project: Project;
  workspace: WorkspaceDirectoryItem | null;
}) {
  const [resolvedCover, setResolvedCover] = useState<ProjectCoverOverride | null | undefined>(
    project.coverDigest ? null : undefined,
  );
  const digestUrl = projectPickerCoverUrl(project);
  const initial = project.name.trim().slice(0, 1).toUpperCase() || '?';

  useEffect(() => {
    if (digestUrl) {
      setResolvedCover(null);
      return;
    }
    if (!workspace) {
      setResolvedCover(null);
      return;
    }

    const controller = new AbortController();
    const workspaceContext = workspaceContextFromDirectoryItem(workspace);
    setResolvedCover(undefined);
    void fetchProjectFiles(project.id, {
      signal: controller.signal,
      workspaceContext,
    })
      .then((files) => {
        if (!controller.signal.aborted) setResolvedCover(selectProjectFileCover(files));
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolvedCover(null);
      });

    return () => controller.abort();
  }, [
    digestUrl,
    project.id,
    project.updatedAt,
    workspace?.workspaceId,
    workspace?.workspaceMemberId,
  ]);

  if (digestUrl) {
    return (
      <span className={styles.projectOptionCover} aria-hidden>
        <span className={styles.projectOptionCoverFallback}>{initial}</span>
        <img
          src={digestUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      </span>
    );
  }

  if (!resolvedCover) {
    return (
      <span className={styles.projectOptionCover} aria-hidden>
        <span className={styles.projectOptionCoverFallback}>{initial}</span>
      </span>
    );
  }

  const workspaceContext = workspace ? workspaceContextFromDirectoryItem(workspace) : null;
  const src = projectCoverUrl(
    project.id,
    resolvedCover.name,
    resolvedCover.mtime,
    workspaceContext,
  );

  if (resolvedCover.kind === 'html') {
    return (
      <span className={styles.projectOptionCover} aria-hidden>
        <HtmlProjectCoverFrame
          src={src}
          initial={initial}
          iframeClassName={styles.projectOptionCoverFrame}
          glyphClassName={styles.projectOptionCoverFallback}
          diagnostic={`publish-project:${project.id}:${resolvedCover.name}`}
        />
      </span>
    );
  }

  if (resolvedCover.kind === 'video') {
    return (
      <span className={styles.projectOptionCover} aria-hidden>
        <span className={styles.projectOptionCoverFallback}>{initial}</span>
        <video
          className={styles.projectOptionCoverMedia}
          src={src}
          muted
          playsInline
          preload="metadata"
        />
      </span>
    );
  }

  return (
    <span className={styles.projectOptionCover} aria-hidden>
      <span className={styles.projectOptionCoverFallback}>{initial}</span>
      <img
        className={styles.projectOptionCoverMedia}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
    </span>
  );
}

function ProjectsTab({
  onPublish,
  confirmRef,
  onCanConfirmChange,
}: {
  onPublish: (selection: PublishProjectSelection) => void;
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onCanConfirmChange?: (canConfirm: boolean) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const workspaceContextState = useWorkspaceContext();
  const { context: workspaceContext } = workspaceContextState;
  const [source, setSource] = useState<FileSource>('internal');
  const [workspaces, setWorkspaces] = useState<WorkspaceDirectoryItem[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [importedPath, setImportedPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const folderPickerInFlight = useRef(false);
  const [importedKind, setImportedKind] = useState<'folder' | 'zip' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const directoryRes = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!directoryRes.ok) throw new Error('workspace directory load failed');
        const directory = await directoryRes.json() as { items?: WorkspaceDirectoryItem[] };
        if (cancelled) return;
        const items = (directory.items ?? []).filter((item) => (
          !item.isSharedSpace
          && item.memberStatus === 'active'
          && item.lifecycleState !== 'deleted'
          && (item.isDefaultTeam === true || item.workspaceType === 'team')
        ));
        setWorkspaces(items);
        const initial = items.find((item) => item.isDefaultTeam === true) ?? items[0] ?? null;
        setActiveWorkspaceId(initial?.workspaceId ?? null);
        if (!initial) {
          setProjects([]);
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        setWorkspaces([]);
        setProjects([]);
        setError(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const workspace = workspaces.find((item) => item.workspaceId === activeWorkspaceId);
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    void fetchOwnedWorkspaceProjects(workspace)
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, workspaces]);

  const handlePickFolder = useCallback(async () => {
    if (folderPickerInFlight.current) return;
    folderPickerInFlight.current = true;
    setImportError(null);
    setImporting(true);
    try {
      const targetContext = resolvedWorkspaceContextForWrite(workspaceContextState);
      if (isOpenDesignHostAvailable()) {
        const result = await pickAndImportHostProject({ workspaceContext: targetContext });
        if ('canceled' in result && result.canceled === true) return;
        if (result.ok !== true) throw new Error('reason' in result ? result.reason : 'Failed to import folder');

        let importedProject = await getProject(result.projectId, targetContext);
        for (let attempt = 0; importedProject == null && attempt < 3; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          importedProject = await getProject(result.projectId, targetContext);
        }
        const importedFrom = importedProject?.metadata?.importedFrom;
        const importKind = importedFrom === 'zip' ? 'zip' : 'folder';
        const importedLabel = importedProject?.name
          || (importKind === 'zip'
            ? (locale.startsWith('zh') ? '已选择 ZIP 包' : 'Selected ZIP')
            : (locale.startsWith('zh') ? '已选择文件夹' : 'Selected folder'));
        if (importedProject) {
          setProjects((current) => [importedProject!, ...current.filter((item) => item.id !== importedProject!.id)]);
        }
        setSelectedProjectId(result.projectId);
        setImportedPath(importedLabel);
        setImportedKind(importKind);
        setName(importedProject?.name || importedLabel);
        return;
      }

      const picked = await openFolderDialog();
      if (!picked) return;
      const parts = picked.replace(/\\/g, '/').split('/').filter(Boolean);
      const folderName = parts[parts.length - 1] || t('publishDialog.namePlaceholder');
      const result = await importFolderProject(
        { baseDir: picked, name: folderName },
        targetContext,
      );
      setProjects((current) => [result.project, ...current.filter((item) => item.id !== result.project.id)]);
      setSelectedProjectId(result.project.id);
      setImportedPath(result.project.name || folderName);
      setImportedKind('folder');
      setName(result.project.name || folderName);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      folderPickerInFlight.current = false;
    }
  }, [locale, t, workspaceContextState]);

 const hasSelection = Boolean(selectedProjectId);
 const canConfirm = hasSelection && name.trim().length > 0;

  // Lift canConfirm to the parent so the footer confirm button updates.
  useEffect(() => { onCanConfirmChange?.(canConfirm); }, [canConfirm, onCanConfirmChange]);

  // Lift canConfirm + onConfirm into the ref so the dialog footer's
  // confirm button (which lives outside the tab content) can reach them.
  confirmRef.current = {
    canConfirm,
    onConfirm: () => {
      if (!canConfirm) return;
      onPublish({
        projectId: selectedProjectId!,
        name: name.trim(),
        description: description.trim(),
      });
    },
  };

  function handleSelectProject(project: Project) {
    setSelectedProjectId(project.id);
    setName(project.name);
  }

  const filteredProjects = projectSearch.trim()
    ? projects.filter((project) => project.name.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase()))
    : projects;
  const activeWorkspace = workspaces.find((item) => item.workspaceId === activeWorkspaceId) ?? null;

  return (
    <div className={styles.formGrid}>
      <section className={styles.panel}>
        <div className={styles.sourceSwitch} role="tablist" aria-label={t('publishDialog.sourceLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'internal'}
            className={source === 'internal' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('internal')}
          >
            {locale.startsWith('zh') ? '我创建的' : 'Created by me'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'external'}
            className={source === 'external' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('external')}
          >
            {locale.startsWith('zh') ? '导入本地项目' : 'Import local project'}
          </button>
        </div>

        {source === 'internal' ? (
          <div className={styles.projectBrowser}>
            <aside className={styles.projectWorkspaceTree} aria-label={locale.startsWith('zh') ? '项目位置' : 'Project locations'}>
              {workspaces.map((workspace) => {
                const selectedWorkspace = workspace.workspaceId === activeWorkspaceId;
                return (
                  <button
                    key={workspace.workspaceId}
                    type="button"
                    className={selectedWorkspace ? `${styles.projectWorkspaceRow} ${styles.projectWorkspaceRowActive}` : styles.projectWorkspaceRow}
                    onClick={() => {
                      setActiveWorkspaceId(workspace.workspaceId);
                      setSelectedProjectId(null);
                      setName('');
                      setProjectSearch('');
                    }}
                  >
                    <span>{workspace.isDefaultTeam ? (locale.startsWith('zh') ? '个人所有' : 'Personal') : workspace.workspaceName}</span>
                    <small>{workspace.isDefaultTeam ? (locale.startsWith('zh') ? '个人' : 'Personal') : (locale.startsWith('zh') ? '团队' : 'Team')}</small>
                  </button>
                );
              })}
            </aside>
            <div className={styles.projectBrowserMain}>
              <div className={styles.projectSearchBox}>
                <Icon name="search" size={16} aria-hidden />
                <input
                  type="search"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder={locale.startsWith('zh') ? '搜索项目' : 'Search projects'}
                  aria-label={locale.startsWith('zh') ? '搜索项目' : 'Search projects'}
                />
                {projectSearch ? (
                  <button type="button" onClick={() => setProjectSearch('')} aria-label={locale.startsWith('zh') ? '清空搜索' : 'Clear search'}>
                    <Icon name="close" size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
              {loading ? (
                <div className={styles.projectBrowserState}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              ) : error ? (
                <div className={styles.projectBrowserState}>{t('publishDialog.loadFailed')}</div>
              ) : filteredProjects.length === 0 ? (
                <div className={styles.projectBrowserState}>
                  {projectSearch ? (locale.startsWith('zh') ? '没有匹配的项目' : 'No matching projects') : t('publishDialog.noProjects')}
                </div>
              ) : (
                <div className={styles.projectOptions} role="listbox" aria-label={t('publishDialog.selectProject')}>
                  {filteredProjects.map((project) => {
                    const selected = selectedProjectId === project.id;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? `${styles.projectOption} ${styles.projectOptionWithCover} ${styles.projectOptionActive}` : `${styles.projectOption} ${styles.projectOptionWithCover}`}
                        onClick={() => handleSelectProject(project)}
                      >
                        <ProjectPickerThumbnail project={project} workspace={activeWorkspace} />
                        <span className={styles.projectOptionText}>
                          <strong>{project.name}</strong>
                          <small>{relativeTime(project.updatedAt, t)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : importedPath && selectedProjectId ? (
          <div className={styles.externalPath}>
            <Icon name={importedKind === 'zip' ? 'file' : 'folder'} size={15} />
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>{importedPath}</span>
            <button
              type="button"
              className={styles.externalPathClear}
              onClick={() => {
                setImportedPath(null);
                setImportedKind(null);
                setSelectedProjectId(null);
                setName('');
              }}
              aria-label={locale.startsWith('zh') ? '删除已导入项目' : 'Remove imported project'}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dropzone}
            onClick={() => void handlePickFolder()}
            disabled={importing}
          >
            <span className={styles.dropzoneIcon} aria-hidden>
              <Icon name="upload" size={28} />
            </span>
            <span className={styles.dropzoneText}>
              {importing
                ? (locale.startsWith('zh') ? '请选择文件' : 'Choose a file')
                : (locale.startsWith('zh') ? '选择文件夹 / ZIP 包' : 'Choose folder / ZIP')}
            </span>
          </button>
        )}
        {importError ? <p className={styles.inlineError} role="alert">{importError}</p> : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-name">
            {t('publishDialog.nameLabel')}
          </label>
          <input
            id="publish-name"
            className={styles.fieldInput}
            placeholder={t('publishDialog.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-desc">
            {t('publishDialog.descriptionLabel')}
          </label>
          <textarea
            id="publish-desc"
            className={`${styles.fieldInput} ${styles.fieldTextarea}`}
            placeholder={t('publishDialog.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>
      </section>
    </div>
  );
}

function ToolTab({
  onPublish,
  confirmRef,
  onCanConfirmChange,
}: {
  onPublish: (selection: PublishToolSelection) => void;
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onCanConfirmChange?: (canConfirm: boolean) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const canConfirm = url.trim().length > 0 && name.trim().length > 0;

  useEffect(() => { onCanConfirmChange?.(canConfirm); }, [canConfirm, onCanConfirmChange]);

  confirmRef.current = {
    canConfirm,
    onConfirm: () => {
      if (!canConfirm) return;
      onPublish({
        url: url.trim(),
        name: name.trim(),
        description: description.trim(),
      });
    },
  };

  return (
    <div className={styles.formGrid}>
      <section className={styles.panel}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-tool-url">
            {t('publishDialog.toolAccessLink')}
          </label>
          <input
            id="publish-tool-url"
            className={styles.fieldInput}
            placeholder={t('publishDialog.toolAccessLinkPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </section>

      <div className={styles.sectionDivider} aria-hidden />

      <section className={styles.panel}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-tool-name">
            {t('publishDialog.nameLabel')}
          </label>
          <input
            id="publish-tool-name"
            className={styles.fieldInput}
            placeholder={t('publishDialog.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="publish-tool-desc">
            {t('publishDialog.descriptionLabel')}
          </label>
          <textarea
            id="publish-tool-desc"
            className={`${styles.fieldInput} ${styles.fieldTextarea}`}
            placeholder={t('publishDialog.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>
      </section>
    </div>
  );
}

function McpTab({
  confirmRef,
  onPublish,
  onCanConfirmChange,
}: {
  onPublish: (selection: PublishMcpSelection) => void;
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onCanConfirmChange?: (canConfirm: boolean) => void;
}) {
  const { locale } = useI18n();
  const [source, setSource] = useState<FileSource>('internal');
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [logoKey, setLogoKey] = useState<McpLogoKey>('orbit');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch('/api/mcp/servers', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ servers?: McpServerConfig[] }>;
      })
      .then((body) => {
        if (!cancelled) setServers(body.servers ?? []);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const canConfirm = source === 'internal' && selected !== null;
  useEffect(() => {
    if (source === 'internal') onCanConfirmChange?.(canConfirm);
  }, [canConfirm, onCanConfirmChange, source]);

  if (source === 'external') {
    return (
      <div className={styles.formGrid}>
        <div className={styles.sourceSwitch} role="tablist" aria-label={locale.startsWith('zh') ? 'MCP 来源' : 'MCP source'}>
          <button type="button" role="tab" aria-selected={false} className={styles.sourceSwitchBtn} onClick={() => setSource('internal')}>
            {locale.startsWith('zh') ? '我创建的' : 'Created by me'}
          </button>
          <button type="button" role="tab" aria-selected className={styles.sourceSwitchBtnActive}>
            {locale.startsWith('zh') ? '手动输入' : 'Enter manually'}
          </button>
        </div>
        <McpConfigForm
          confirmRef={confirmRef}
          onCanConfirmChange={onCanConfirmChange}
          onSubmit={onPublish}
          showLogoPicker
        />
      </div>
    );
  }

  confirmRef.current = {
    canConfirm,
    onConfirm: () => {
      if (!selected) return;
      const config = selected.transport === 'stdio'
        ? { type: 'stdio', command: selected.command ?? '', ...(selected.args?.length ? { args: selected.args } : {}) }
        : { type: selected.transport, url: selected.url ?? '' };
      onPublish({
        label: (selected.label || selected.id).trim(),
        description: description.trim(),
        config: JSON.stringify(config, null, 2),
        logoKey,
      });
    },
  };

  return (
    <div className={styles.formGrid}>
      <section className={styles.panel}>
        <div className={styles.sourceSwitch} role="tablist" aria-label={locale.startsWith('zh') ? 'MCP 来源' : 'MCP source'}>
          <button type="button" role="tab" aria-selected className={styles.sourceSwitchBtnActive}>
            {locale.startsWith('zh') ? '我创建的' : 'Created by me'}
          </button>
          <button type="button" role="tab" aria-selected={false} className={styles.sourceSwitchBtn} onClick={() => setSource('external')}>
            {locale.startsWith('zh') ? '手动输入' : 'Enter manually'}
          </button>
        </div>
        {loading ? (
          <div className={styles.loading}><span className={styles.loadingDot} /><span className={styles.loadingDot} /><span className={styles.loadingDot} /></div>
        ) : loadError ? (
          <p className={styles.inlineError} role="alert">{loadError}</p>
        ) : servers.length === 0 ? (
          <div className={styles.emptyState}><span className={styles.emptyStateText}>{locale.startsWith('zh') ? '个人所有中暂无 MCP，可切换为手动输入。' : 'No personal MCPs yet. You can enter one manually.'}</span></div>
        ) : (
          <div className={styles.projectOptions} role="listbox" aria-label={locale.startsWith('zh') ? '选择 MCP' : 'Choose an MCP'}>
            {servers.map((server) => {
              const selectedServer = selectedId === server.id;
              return (
                <button
                  key={server.id}
                  type="button"
                  role="option"
                  aria-selected={selectedServer}
                  className={selectedServer ? `${styles.projectOption} ${styles.projectOptionSingle} ${styles.projectOptionActive}` : `${styles.projectOption} ${styles.projectOptionSingle}`}
                  onClick={() => { setSelectedId(server.id); setDescription(''); }}
                >
                  <span className={styles.resourceLogo} aria-hidden><Icon name="terminal" size={17} /></span>
                  <span className={styles.projectOptionText}>
                    <strong>{server.label || server.id}</strong>
                    <small>{server.transport === 'stdio' ? server.command || 'stdio' : server.url || server.transport}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <DefaultLogoPicker value={logoKey} onChange={setLogoKey} locale={locale} />
      {selected ? (
        <>
          <section className={styles.panel}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="publish-mcp-description">{locale.startsWith('zh') ? '简介' : 'Description'}</label>
            <textarea id="publish-mcp-description" className={`${styles.fieldInput} ${styles.fieldTextarea}`} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder={locale.startsWith('zh') ? '简要说明这个 MCP 能做什么（选填）' : 'Briefly explain what this MCP does (optional)'} />
          </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

type CollectedFile = { file: File; path: string };
type UploadSource =
  | { kind: 'folder'; files: CollectedFile[]; folderName?: string }
  | { kind: 'zip'; file: File }
  | { kind: 'file'; file: File };

interface PersonalSkill {
  id: string;
  name: string;
  description?: string;
  category?: string;
  source?: string;
  resourceId?: string;
  logoKey?: string | null;
}

function readSkillFrontmatterString(block: string, key: string): string {
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(new RegExp(`^${key}:\s*(.*)$`));
    if (!match) continue;
    const raw = (match[1] ?? '').trim();
    if (raw === '|' || raw === '>') {
      const collected: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const child = lines[next] ?? '';
        if (child.trim().length > 0 && !/^\s/.test(child)) break;
        collected.push(child);
      }
      const nonEmpty = collected.filter((child) => child.trim().length > 0);
      const minIndent = nonEmpty.reduce((min, child) => {
        const indent = child.match(/^\s*/)?.[0].length ?? 0;
        return Math.min(min, indent);
      }, Number.POSITIVE_INFINITY);
      const normalized = collected
        .map((child) => child.slice(Number.isFinite(minIndent) ? minIndent : 0))
        .join('\n')
        .trim();
      return raw === '>' ? normalized.replace(/\s*\n\s*/g, ' ').trim() : normalized;
    }
    return raw.replace(/^["']|["']$/g, '').trim();
  }
  return '';
}

function parseSkillNameFromMarkdown(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return '';
  const block = match[1] ?? '';
  return readSkillFrontmatterString(block, 'name');
}

function SkillTab({
  onPublish,
  confirmRef,
  onCanConfirmChange,
}: {
  onPublish: (selection: PublishSkillSelection) => void;
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onCanConfirmChange?: (canConfirm: boolean) => void;
}) {
  const t = useT();
  const { context: workspaceContext, loading: workspaceContextLoading } = useWorkspaceContext();
  const { locale } = useI18n();
  const [source, setSource] = useState<FileSource>('internal');
  const [skillWorkspaces, setSkillWorkspaces] = useState<WorkspaceDirectoryItem[]>([]);
  const [activeSkillWorkspaceId, setActiveSkillWorkspaceId] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [skills, setSkills] = useState<PersonalSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [uploadSource, setUploadSource] = useState<UploadSource | null>(null);
  const [category, setCategory] = useState<SkillCategory | null>(null);
  const [logoKey, setLogoKey] = useState<SkillLogoKey>('craft');
  const [busy, setBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? null;
  const filteredSkills = skillSearch.trim()
    ? skills.filter((skill) => skill.name.toLocaleLowerCase().includes(skillSearch.trim().toLocaleLowerCase()))
    : skills;
  const selectedSkillWorkspace = skillWorkspaces.find((item) => item.workspaceId === activeSkillWorkspaceId) ?? null;
  const canConfirm = source === 'internal'
    ? selectedSkill !== null && category !== null && !busy && !workspaceContextLoading
    : uploadSource !== null && category !== null && !busy && !workspaceContextLoading;

  useEffect(() => {
    let cancelled = false;
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
        setSkillWorkspaces(items);
        const initial = items.find((item) => item.isDefaultTeam === true) ?? items[0] ?? null;
        setActiveSkillWorkspaceId(initial?.workspaceId ?? null);
        if (!initial) {
          setSkills([]);
          setSkillsLoading(false);
        }
      } catch (error) {
        if (cancelled) return;
        setSkillWorkspaces([]);
        setSkills([]);
        setSkillsError(error instanceof Error ? error.message : String(error));
        setSkillsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeSkillWorkspaceId) return;
    const workspace = skillWorkspaces.find((item) => item.workspaceId === activeSkillWorkspaceId);
    if (!workspace) return;
    let cancelled = false;
    setSkillsLoading(true);
    setSkillsError(null);
    const params = new URLSearchParams({ owner_member_id: workspace.workspaceMemberId });
    const headers = workspaceProjectHeaders(workspaceContextFromDirectoryItem(workspace));
    fetch('/api/workspace/skills/cloud?' + params, { cache: 'no-store', headers })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ skills?: Array<{
          resourceId?: string;
          localId?: string;
          title?: string;
          description?: string | null;
          category?: string;
          logoKey?: string | null;
        }> }>;
      })
      .then((body) => {
        if (cancelled) return;
        setSkills((body.skills ?? []).map((skill) => ({
          id: skill.localId || skill.resourceId || '',
          name: skill.title || skill.localId || skill.resourceId || '',
          description: skill.description ?? '',
          category: skill.category,
          source: 'user',
          resourceId: skill.resourceId,
          logoKey: skill.logoKey ?? null,
        })).filter((skill) => skill.id && skill.name));
      })
      .catch((error) => {
        if (!cancelled) {
          setSkills([]);
          setSkillsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeSkillWorkspaceId, skillWorkspaces]);

  useEffect(() => { onCanConfirmChange?.(canConfirm); }, [canConfirm, onCanConfirmChange]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);


  async function checkCloudSkillDuplicate(name: string): Promise<boolean> {
    try {
      const headers = workspaceContext ? workspaceProjectHeaders(workspaceContext) : {};
      const checkRes = await fetch(
        `/api/workspace/skills/cloud/check?title=${encodeURIComponent(name)}`,
        { cache: 'no-store', headers },
      );
      if (checkRes.ok) {
        const checkBody = await checkRes.json();
        return Boolean(checkBody.exists);
      }
    } catch {
      // network failure — let the server reject later
    }
    return false;
  }

  async function deriveSkillName(source: UploadSource): Promise<string | null> {
    try {
      let text: string | null = null;
      if (source.kind === 'zip') {
        text = await findSkillMdInZip(source.file);
      } else if (source.kind === 'file') {
        text = await source.file.text();
      } else {
        const skillFile = source.files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
        if (skillFile) text = await skillFile.file.text();
      }
      if (!text) return null;
      return parseSkillNameFromMarkdown(text);
    } catch {
      return null;
    }
  }

  function buildCloudUploadInput(source: UploadSource) {
    if (source.kind === 'zip') {
      return { zip: source.file };
    }
    if (source.kind === 'file') {
      return [{ file: source.file, path: 'SKILL.md' }];
    }
    return source.files.map((f) => ({ file: f.file, path: f.path }));
  }

  async function handleMacClick() {
    const host = getOpenDesignHost();
    if (!host?.project?.pickSkillSource) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const result = await host.project.pickSkillSource();
      if (!result.ok) return;
      if (result.kind === 'folder') {
        const files = result.files.map((f) => ({
          file: new File([f.data], f.path.split('/').pop() || f.path),
          path: f.path,
        }));
        setUploadSource({ kind: 'folder', files, folderName: result.folderName });
      } else {
        const file = new File([result.data], result.fileName);
        setUploadSource({ kind: 'zip', file });
      }
    } catch {
      // Fall back silently
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (busy) return;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries = await readDragEntries(items);
      if (entries && entries.length > 0) {
        const skillFile = entries.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
        if (entries.length === 1 && !skillFile && /\.(zip)$/i.test(entries[0]!.file.name)) {
          setUploadSource({ kind: 'zip', file: entries[0]!.file });
          return;
        }
        if (skillFile && entries.length === 1) {
          setUploadSource({ kind: 'file', file: skillFile.file });
          return;
        }
        const folderName = entries[0]?.path.split('/').filter(Boolean)[0];
        setUploadSource({
          kind: 'folder',
          files: entries,
          ...(folderName ? { folderName } : {}),
        });
        return;
      }
    }

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 1 && /\.(zip)$/i.test(files[0]!.name)) {
      setUploadSource({ kind: 'zip', file: files[0]! });
    } else if (files.length === 1 && /(^|\/)SKILL\.md$/i.test(files[0]!.name)) {
      setUploadSource({ kind: 'file', file: files[0]! });
    } else if (files.length > 0) {
      setUploadSource({
        kind: 'folder',
        files: files.map((f) => ({ file: f, path: f.name })),
      });
    }
  }, [busy]);

  function renderUploadLabel(): string {
    if (!uploadSource) {
      return locale.startsWith('zh') ? '选择文件夹 / ZIP 包' : 'Choose folder / ZIP';
    }
    if (uploadSource.kind === 'zip') {
      return uploadSource.file.name;
    }
    if (uploadSource.kind === 'file') {
      return uploadSource.file.name;
    }
    if (uploadSource.files.length === 1 && /(^|\/)SKILL\.md$/i.test(uploadSource.files[0]!.path)) {
      return uploadSource.files[0]!.file.name;
    }
    if (uploadSource.folderName) return uploadSource.folderName;
    return t('pluginsView.filesSelected', { count: uploadSource.files.length });
  }

  async function handleConfirm() {
    if (busy || workspaceContextLoading) return;
    setBusy(true);
    try {
      if (source === 'internal') {
        if (!selectedSkill) return;
        const shareContext = selectedSkillWorkspace
          ? workspaceContextFromDirectoryItem(selectedSkillWorkspace)
          : workspaceContext;
        const headers = shareContext ? workspaceProjectHeaders(shareContext) : {};
        const response = await fetch(
          `/api/workspace/skills/${encodeURIComponent(selectedSkill.id)}/share?scope=public`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ logoKey, category }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as { shared?: boolean; message?: string; error?: string };
        if (!response.ok || !body.shared) {
          throw new Error(body.message || body.error || t('pluginsView.shareFailed', { title: selectedSkill.name }));
        }
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
        onPublish({
          name: selectedSkill.name,
          description: selectedSkill.description ?? '',
          body: '',
          category: category!,
          logoKey,
        });
        return;
      }
      if (!uploadSource) return;
      const skillName = await deriveSkillName(uploadSource);
      if (!skillName) {
        setToast({ message: t('pluginsView.skillMissingFile'), tone: 'error' });
        return;
      }
      if (await checkCloudSkillDuplicate(skillName)) {
        setToast({ message: t('personalScope.skillDuplicateName' as any), tone: 'error' });
        return;
      }
      const uploadInput = buildCloudUploadInput(uploadSource);
      if (!category) return;
      const result = await uploadSkillToCloud(uploadInput, workspaceContext, 'public', category, logoKey);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      setToast({
        message: t('personalScope.importAndShareSuccess', { name: result.title }),
        tone: 'success',
      });
      setUploadSource(null);
      window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      onPublish({ name: result.title, description: '', body: '', category, logoKey });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  confirmRef.current = {
    canConfirm,
    onConfirm: () => { void handleConfirm(); },
  };

  return (
    <div className={styles.formGrid}>
      <section className={styles.panel}>
        <div className={styles.sourceSwitch} role="tablist" aria-label={locale.startsWith('zh') ? 'Skill 来源' : 'Skill source'}>
        <button type="button" role="tab" aria-selected={source === 'internal'} className={source === 'internal' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn} onClick={() => setSource('internal')}>
          {locale.startsWith('zh') ? '我创建的' : 'Created by me'}
        </button>
        <button type="button" role="tab" aria-selected={source === 'external'} className={source === 'external' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn} onClick={() => setSource('external')}>
          {locale.startsWith('zh') ? '导入本地 Skill' : 'Import local Skill'}
        </button>
      </div>

        {source === 'internal' ? (
          <div className={styles.projectBrowser}>
            <aside className={styles.projectWorkspaceTree} aria-label={locale.startsWith('zh') ? 'Skill 位置' : 'Skill locations'}>
              {skillWorkspaces.map((workspace) => {
                const selectedWorkspace = workspace.workspaceId === activeSkillWorkspaceId;
                return (
                  <button
                    key={workspace.workspaceId}
                    type="button"
                    className={selectedWorkspace ? `${styles.projectWorkspaceRow} ${styles.projectWorkspaceRowActive}` : styles.projectWorkspaceRow}
                    onClick={() => {
                      setActiveSkillWorkspaceId(workspace.workspaceId);
                      setSelectedSkillId(null);
                      setCategory(null);
                      setSkillSearch('');
                    }}
                  >
                    <span>{workspace.isDefaultTeam ? (locale.startsWith('zh') ? '个人所有' : 'Personal') : workspace.workspaceName}</span>
                    <small>{workspace.isDefaultTeam ? (locale.startsWith('zh') ? '个人' : 'Personal') : (locale.startsWith('zh') ? '团队' : 'Team')}</small>
                  </button>
                );
              })}
            </aside>
            <div className={styles.projectBrowserMain}>
              <div className={styles.projectSearchBox}>
                <Icon name="search" size={16} aria-hidden />
                <input
                  type="search"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  placeholder={locale.startsWith('zh') ? '搜索 Skill' : 'Search Skills'}
                  aria-label={locale.startsWith('zh') ? '搜索 Skill' : 'Search Skills'}
                />
                {skillSearch ? (
                  <button type="button" onClick={() => setSkillSearch('')} aria-label={locale.startsWith('zh') ? '清空搜索' : 'Clear search'}>
                    <Icon name="close" size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
              {skillsLoading ? (
                <div className={styles.projectBrowserState}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              ) : skillsError ? (
                <div className={styles.projectBrowserState}>{skillsError}</div>
              ) : filteredSkills.length === 0 ? (
                <div className={styles.projectBrowserState}>
                  {skillSearch
                    ? (locale.startsWith('zh') ? '没有匹配的 Skill' : 'No matching Skills')
                    : (locale.startsWith('zh') ? '当前位置暂无 Skill' : 'No Skills in this location')}
                </div>
              ) : (
                <div className={styles.projectOptions} role="listbox" aria-label={locale.startsWith('zh') ? '选择 Skill' : 'Choose a Skill'}>
                  {filteredSkills.map((skill) => {
                    const selectedSkillRow = selectedSkillId === skill.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        role="option"
                        aria-selected={selectedSkillRow}
                        className={selectedSkillRow ? `${styles.projectOption} ${styles.projectOptionSingle} ${styles.projectOptionActive}` : `${styles.projectOption} ${styles.projectOptionSingle}`}
                        onClick={() => {
                          setSelectedSkillId(skill.id);
                          setCategory(normalizeSkillCategory(skill.category));
                        }}
                      >
                        <SkillLogo
                          logoKey={isSkillLogoKey(skill.logoKey) ? skill.logoKey : 'craft'}
                          size={28}
                          className={styles.resourceLogo}
                        />
                        <span className={styles.projectOptionText}>
                          <strong>{skill.name}</strong>
                          <small>{skill.description || skillCategoryLabel(normalizeSkillCategory(skill.category), locale)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            disabled={busy}
            style={{ display: 'none' }}
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length === 0) return;
              const skillFile = files.find((file) => /(^|\/)SKILL\.md$/i.test(file.webkitRelativePath || file.name));
              if (skillFile && files.length === 1) {
                setUploadSource({ kind: 'file', file: skillFile });
              } else {
                const folderName = files[0]?.webkitRelativePath?.split('/').filter(Boolean)[0];
                setUploadSource({
                  kind: 'folder',
                  files: files.map((file) => ({ file, path: file.webkitRelativePath || file.name })),
                  ...(folderName ? { folderName } : {}),
                });
              }
            }}
          />
          {uploadSource ? (
            <div className={styles.externalPath}>
              <Icon name={uploadSource.kind === 'zip' ? 'file' : 'folder'} size={15} />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>{renderUploadLabel()}</span>
              <button
                type="button"
                className={styles.externalPathClear}
                onClick={() => setUploadSource(null)}
                aria-label={locale.startsWith('zh') ? '删除已导入 Skill' : 'Remove imported Skill'}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={dragOver ? `${styles.dropzone} ${styles.uploadZoneDragOver}` : styles.dropzone}
              disabled={busy}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => void handleMacClick()}
            >
              <span className={styles.dropzoneIcon} aria-hidden><Icon name="upload" size={28} /></span>
              <span className={styles.dropzoneText}>
                {locale.startsWith('zh') ? '选择文件夹 / ZIP 包' : 'Choose folder / ZIP'}
              </span>
            </button>
          )}
          </>
        )}
      </section>
      <SkillCategoryPicker value={category} onChange={setCategory} locale={locale} disabled={busy} />
      <SkillLogoPicker value={logoKey} onChange={setLogoKey} locale={locale} />

      {toast ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}

// --- Drag-and-drop directory traversal via the FileSystemEntry API ---

async function readDragEntries(items: DataTransferItemList): Promise<CollectedFile[] | null> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return null;
  const result: CollectedFile[] = [];
  for (const entry of entries) {
    await traverseEntry(entry, '', result);
  }
  return result;
}

function traverseEntry(
  entry: FileSystemEntry,
  relPath: string,
  result: CollectedFile[],
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      fileEntry.file(
        (file) => {
          const path = relPath ? `${relPath}/${file.name}` : file.name;
          result.push({ file, path });
          resolve();
        },
        () => resolve(),
      );
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const dirName = entry.name;
      const basePath = relPath ? `${relPath}/${dirName}` : dirName;
      readAllEntries(reader, (childEntries) => {
        Promise.all(childEntries.map((child) => traverseEntry(child, basePath, result)))
          .then(() => resolve())
          .catch(() => resolve());
      }, () => resolve());
    } else {
      resolve();
    }
  });
}

function readAllEntries(
  reader: FileSystemDirectoryReader,
  onSuccess: (entries: FileSystemEntry[]) => void,
  onError: () => void,
): void {
  const entries: FileSystemEntry[] = [];
  const readBatch = () => {
    reader.readEntries(
      (batch) => {
        if (batch.length === 0) {
          onSuccess(entries);
        } else {
          entries.push(...batch);
          readBatch();
        }
      },
      onError,
    );
  };
  readBatch();
}

export function PublishDialog({ onClose, onPublish, initialCategory }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [activeCategory, setActiveCategory] = useState<PublishCategory>(initialCategory ?? 'projects');
  const [canConfirm, setCanConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const dialogId = useId();
  const confirmRef = useRef<{ canConfirm: boolean; onConfirm: () => void }>({
    canConfirm: false,
    onConfirm: () => {},
  });

  // Reset canConfirm when switching tabs — the new tab's form will
  // re-establish it via the onCanConfirmChange callback.
  useEffect(() => { setCanConfirm(false); }, [activeCategory]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!publishing) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, publishing]);

  const activeTab = CATEGORY_TABS.find((tab) => tab.id === activeCategory)!;

  function handleConfirm() {
    if (!confirmRef.current.canConfirm || publishing) return;
    confirmRef.current.onConfirm();
  }

  async function handlePublishSelection(
    selection: PublishProjectSelection | PublishToolSelection | PublishMcpSelection | PublishSkillSelection,
  ) {
    setPublishing(true);
    setPublishError(null);
    try {
      await onPublish(selection);
      onClose();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(false);
    }
  }

  const dialog = (
    <div className={styles.backdrop} onClick={() => { if (!publishing) onClose(); }} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('publishDialog.title')}
        id={dialogId}
        data-testid="publish-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2>{t('publishDialog.title')}</h2>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('common.cancel')}
            onClick={onClose}
            disabled={publishing}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.categoryTabs} role="tablist" aria-label={t('publishDialog.categoryLabel')}>
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeCategory === tab.id}
                className={activeCategory === tab.id ? `${styles.categoryTab} ${styles.categoryTabActive}` : styles.categoryTab}
                onClick={() => setActiveCategory(tab.id)}
              >
                <Icon name={tab.icon} size={17} />
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

         {activeCategory === 'projects' ? (
           <ProjectsTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => { void handlePublishSelection(selection); }}
           />
         ) : activeCategory === 'tool' ? (
           <ToolTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => { void handlePublishSelection(selection); }}
           />
         ) : activeCategory === 'mcp' ? (
           <McpTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => { void handlePublishSelection(selection); }}
           />
         ) : activeCategory === 'skill' ? (
           <SkillTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => { void handlePublishSelection(selection); }}
           />
         ) : (
           <div className={styles.placeholder}>
             <span className={styles.placeholderIcon} aria-hidden>
               <Icon name={activeTab.icon} size={32} />
             </span>
             <span className={styles.placeholderText}>{t('publishDialog.comingSoon')}</span>
           </div>
         )}
        </div>

        {publishError ? <p className={styles.publishError} role="alert">{publishError}</p> : null}
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={publishing}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={
              (activeCategory !== 'projects' && activeCategory !== 'tool' && activeCategory !== 'mcp' && activeCategory !== 'skill')
              || !canConfirm
              || publishing
            }
            onClick={handleConfirm}
          >
            {publishing ? (locale.startsWith('zh') ? '发布中…' : 'Publishing…') : t('publishDialog.confirm')}
          </button>
        </footer>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
