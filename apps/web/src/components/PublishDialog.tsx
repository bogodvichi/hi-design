// Publish dialog for the Square (Hi广场) community surface.
//
// Opens from the "新建发布" button in SquareView. The dialog has four
// category tabs — 项目 / Skill / MCP / 工具 — but only the 项目 (Projects)
// tab is implemented in this pass. The other three render a placeholder
// panel so the tab structure is visible and ready for future work.
//
// The two panels stack vertically (top-bottom layout):
//   Top    — "选择文件": pick an internal project from a recent-projects
//           list, or switch to "外部文件" and choose a folder from disk.
//   Bottom — "公开信息": name + description shown on the community card.
//
// The confirm button is disabled until a file source is selected and a
// name is entered. On confirm the dialog calls onPublish with the
// resolved selection; the actual publish API call is owned by the caller
// (SquareView) so this component stays a pure presentation layer.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useI18n, useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { Project } from '../types';
import { listProjects } from '../state/projects';
import { openFolderDialog } from '../providers/registry';
import { McpConfigForm, type McpConfigSelection } from './McpConfigForm';
import styles from './PublishDialog.module.css';

import {
  uploadSkillToCloud,
  type SkillImportError,
} from '../providers/registry';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { Toast } from './Toast';
import { getOpenDesignHost } from '@open-design/host';
import {
  SKILL_CATEGORIES,
  type SkillCategory,
} from '@open-design/contracts';
import { isMacPlatform } from '../utils/platform';
import { findSkillMdInZip } from '../runtime/zip-reader';
import {
  skillCategoryLabel,
  skillCategorySelectHint,
  skillCategorySelectLabel,
} from '../utils/skill-category-labels';

type PublishCategory = 'projects' | 'skill' | 'mcp' | 'tool';

interface CategoryTabDef {
  id: PublishCategory;
  icon: IconName;
  labelKey: keyof Dict;
}

const CATEGORY_TABS: CategoryTabDef[] = [
  { id: 'projects', icon: 'grid', labelKey: 'squareScope.tabProjects' },
  { id: 'skill', icon: 'sparkles', labelKey: 'squareScope.tabSkill' },
  { id: 'mcp', icon: 'terminal', labelKey: 'squareScope.tabMcp' },
  { id: 'tool', icon: 'puzzle', labelKey: 'squareScope.tabTool' },
];

type FileSource = 'internal' | 'external';

/** What the caller receives when the user confirms a project publish. */
export interface PublishProjectSelection {
  /** Project id when source is internal, null when external. */
  projectId: string | null;
  /** External folder path when source is external, null when internal. */
  externalPath: string | null;
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
  displayName: string;
  config: string;
}

/** What the caller receives when the user confirms a skill publish. */
export interface PublishSkillSelection {
  name: string;
  description: string;
  body: string;
  category: SkillCategory;
}

interface Props {
  onClose: () => void;
  initialCategory?: PublishCategory;
  onPublish: (selection: PublishProjectSelection | PublishToolSelection | PublishMcpSelection | PublishSkillSelection) => void;
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
  const [source, setSource] = useState<FileSource>('internal');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<'recent' | 'directory'>('recent');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const folderPickerInFlight = useRef(false);

  // Load recent internal projects. listProjects returns all projects
  // sorted by updatedAt desc; we slice the first 5 to match the mockup's
  // "最近5个项目" listbox.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    listProjects()
      .then((all) => {
        if (cancelled) return;
        const recent = [...all]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 5);
        setProjects(recent);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePickFolder = useCallback(async () => {
    if (folderPickerInFlight.current) return;
    folderPickerInFlight.current = true;
    try {
      const picked = await openFolderDialog();
      if (picked) {
        setExternalPath(picked);
        // Pre-fill the name field from the folder basename if empty.
        if (!name) {
          const parts = picked.replace(/\\/g, '/').split('/').filter(Boolean);
          const last = parts[parts.length - 1];
          if (last) setName(last);
        }
      }
    } finally {
      folderPickerInFlight.current = false;
    }
  }, [name]);

 const hasSelection =
    Boolean(
      (source === 'internal' && selectedProjectId) ||
        (source === 'external' && externalPath),
    );
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
        projectId: source === 'internal' ? selectedProjectId : null,
        externalPath: source === 'external' ? externalPath : null,
        name: name.trim(),
        description: description.trim(),
      });
    },
  };

  function handleSelectProject(project: Project) {
    setSelectedProjectId(project.id);
    if (!name) setName(project.name);
  }

  return (
    <div className={styles.formGrid}>
      {/* --- Top panel: file selection --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="file" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.selectFile')}</h3>
            <p>{t('publishDialog.selectFileHint')}</p>
          </div>
        </div>

        <div className={styles.sourceSwitch} role="tablist" aria-label={t('publishDialog.sourceLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'internal'}
            className={source === 'internal' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('internal')}
          >
            {t('publishDialog.sourceInternal')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'external'}
            className={source === 'external' ? styles.sourceSwitchBtnActive : styles.sourceSwitchBtn}
            onClick={() => setSource('external')}
          >
            {t('publishDialog.sourceExternal')}
          </button>
        </div>

        {source === 'internal' ? (
          <div>
            <div className={styles.pickerTabs}>
              <span className={styles.pickerLabel}>{t('publishDialog.selectProject')}</span>
              <button
                type="button"
                className={pickerMode === 'recent' ? styles.pickerTabBtnActive : styles.pickerTabBtn}
                onClick={() => setPickerMode('recent')}
              >
                {t('publishDialog.recentProjects')}
              </button>
              <button
                type="button"
                className={pickerMode === 'directory' ? styles.pickerTabBtnActive : styles.pickerTabBtn}
                onClick={() => setPickerMode('directory')}
              >
                <Icon name="folder" size={13} />
                {t('publishDialog.browseDirectory')}
              </button>
            </div>

            {pickerMode === 'recent' ? (
              loading ? (
                <div className={styles.loading}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              ) : error ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyStateText}>{t('publishDialog.loadFailed')}</span>
                </div>
              ) : projects.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyStateText}>{t('publishDialog.noProjects')}</span>
                </div>
              ) : (
                <div className={styles.projectOptions} role="listbox" aria-label={t('publishDialog.recentProjectsAria')}>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={selectedProjectId === project.id}
                      className={selectedProjectId === project.id ? `${styles.projectOption} ${styles.projectOptionActive}` : styles.projectOption}
                      onClick={() => handleSelectProject(project)}
                    >
                      <span className={styles.projectOptionIcon} aria-hidden>
                        <Icon name="file" size={15} />
                      </span>
                      <span className={styles.projectOptionText}>
                        <strong>{project.name}</strong>
                        <small>{relativeTime(project.updatedAt, t)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className={styles.dropzone} onClick={() => void handlePickFolder()}>
                <span className={styles.dropzoneIcon} aria-hidden>
                  <Icon name="folder" size={28} />
                </span>
                <span className={styles.dropzoneText}>{t('publishDialog.browseDirectoryHint')}</span>
                <span className={styles.dropzoneHint}>{t('publishDialog.browseDirectoryHint2')}</span>
              </div>
            )}
          </div>
        ) : externalPath ? (
          <div className={styles.externalPath}>
            <Icon name="folder" size={15} />
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>{externalPath}</span>
            <button
              type="button"
              className={styles.externalPathClear}
              onClick={() => setExternalPath(null)}
              aria-label={t('common.cancel')}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <div className={styles.dropzone} onClick={() => void handlePickFolder()}>
            <span className={styles.dropzoneIcon} aria-hidden>
              <Icon name="folder" size={28} />
            </span>
            <span className={styles.dropzoneText}>{t('publishDialog.externalFileHint')}</span>
            <span className={styles.dropzoneHint}>{t('publishDialog.externalFileHint2')}</span>
          </div>
        )}
      </section>

      {/* --- Bottom panel: public info --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="grid" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.publicInfo')}</h3>
            <p>{t('publishDialog.publicInfoHint')}</p>
          </div>
        </div>

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
      {/* --- Top panel: access link --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="link" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.toolAccessLink')}</h3>
            <p>{t('publishDialog.toolAccessLinkHint')}</p>
          </div>
        </div>

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

      {/* --- Bottom panel: public info --- */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="grid" size={17} />
          </span>
          <div>
            <h3>{t('publishDialog.publicInfo')}</h3>
            <p>{t('publishDialog.publicInfoHint')}</p>
          </div>
        </div>

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
  return (
    <McpConfigForm
      confirmRef={confirmRef}
      onCanConfirmChange={onCanConfirmChange}
      onSubmit={(selection) => {
        onPublish(selection);
      }}
    />
  );
}

type CollectedFile = { file: File; path: string };
type UploadSource =
  | { kind: 'folder'; files: CollectedFile[] }
  | { kind: 'zip'; file: File }
  | { kind: 'file'; file: File };

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
  const [uploadSource, setUploadSource] = useState<UploadSource | null>(null);
  const [category, setCategory] = useState<SkillCategory | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const isMac = isMacPlatform();
  const canConfirm = uploadSource !== null && category !== null && !busy && !workspaceContextLoading;

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
        setUploadSource({ kind: 'folder', files });
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
        setUploadSource({ kind: 'folder', files: entries });
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
      return isMac
        ? t('personalScope.skillDropZoneHint')
        : t('personalScope.skillDropZoneHintFolder');
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
    return t('pluginsView.filesSelected', { count: uploadSource.files.length });
  }

  async function handleConfirm() {
    if (!uploadSource || busy || workspaceContextLoading) return;
    setBusy(true);
    try {
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
      const result = await uploadSkillToCloud(uploadInput, workspaceContext, 'public', category);
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
      onPublish({ name: result.title, description: '', body: '', category });
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
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="file" size={17} />
          </span>
          <div>
            <h3>{t('personalScope.skillTabUpload')}</h3>
            <p>{t('personalScope.skillDropZoneSubhint')}</p>
          </div>
        </div>

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
            const skillFile = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.webkitRelativePath || f.name));
            if (skillFile && files.length === 1) {
              setUploadSource({ kind: 'file', file: skillFile });
            } else {
              setUploadSource({
                kind: 'folder',
                files: files.map((f) => ({
                  file: f,
                  path: f.webkitRelativePath || f.name,
                })),
              });
            }
          }}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          disabled={busy}
          style={{ display: 'none' }}
          onChange={(event) => {
            const f = event.currentTarget.files?.[0] ?? null;
            if (f) setUploadSource({ kind: 'zip', file: f });
          }}
        />
        <button
          type="button"
          className={dragOver ? `${styles.uploadZone} ${styles.uploadZoneDragOver}` : styles.uploadZone}
          disabled={busy}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => {
            if (isMac) void handleMacClick();
            else folderInputRef.current?.click();
          }}
        >
          <span className={styles.uploadZoneIcon} aria-hidden>
            <Icon name="upload" size={23} />
          </span>
          <strong className={styles.uploadZoneStrong}>
            {renderUploadLabel()}
          </strong>
          <span>{t('personalScope.skillDropZoneSubhint')}</span>
        </button>
        {!isMac && (
          <button
            type="button"
            className={styles.selectZipBtn}
            disabled={busy}
            onClick={() => zipInputRef.current?.click()}
          >
            {t('personalScope.skillSelectZip')}
            <Icon name="file" size={14} aria-hidden />
          </button>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon} aria-hidden>
            <Icon name="grid" size={17} />
          </span>
          <div>
            <h3>{skillCategorySelectLabel(locale)}</h3>
            <p>{skillCategorySelectHint(locale)}</p>
          </div>
        </div>
        <div className={styles.skillCategoryOptions} role="radiogroup" aria-label={skillCategorySelectLabel(locale)}>
          {SKILL_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={category === item}
              className={category === item
                ? `${styles.skillCategoryOption} ${styles.skillCategoryOptionActive}`
                : styles.skillCategoryOption}
              onClick={() => setCategory(item)}
              disabled={busy}
            >
              {skillCategoryLabel(item, locale)}
            </button>
          ))}
        </div>
      </section>

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
  const [activeCategory, setActiveCategory] = useState<PublishCategory>(initialCategory ?? 'projects');
  const [canConfirm, setCanConfirm] = useState(false);
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
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeTab = CATEGORY_TABS.find((tab) => tab.id === activeCategory)!;

  function handleConfirm() {
    if (!confirmRef.current.canConfirm) return;
    confirmRef.current.onConfirm();
  }

  const dialog = (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
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
            <p>{t('publishDialog.subtitle')}</p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('common.cancel')}
            onClick={onClose}
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
             onPublish={(selection) => {
               onPublish(selection);
               onClose();
             }}
           />
         ) : activeCategory === 'tool' ? (
           <ToolTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => {
               onPublish(selection);
               onClose();
             }}
           />
         ) : activeCategory === 'mcp' ? (
           <McpTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => {
               onPublish(selection);
               onClose();
             }}
           />
         ) : activeCategory === 'skill' ? (
           <SkillTab
             confirmRef={confirmRef}
             onCanConfirmChange={setCanConfirm}
             onPublish={(selection) => {
               onPublish(selection);
               onClose();
             }}
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

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={
              (activeCategory !== 'projects' && activeCategory !== 'tool' && activeCategory !== 'mcp' && activeCategory !== 'skill')
              || !canConfirm
            }
            onClick={handleConfirm}
          >
            {t('publishDialog.confirm')}
          </button>
        </footer>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
