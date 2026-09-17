import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Toast } from './Toast';
import { useT } from '../i18n';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { workspaceContextHasTeamIdentity, type WorkspaceCollabContext } from '@open-design/contracts';
import type { SkillSummary } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import {
  installSkill,
  deleteSkill,
  uploadSkillToCloud,
} from '../providers/registry';
import styles from './PersonalResourceView.module.css';
import { getOpenDesignHost } from '@open-design/host';
import { isMacPlatform } from '../utils/platform';
import { findSkillMdInZip } from '../runtime/zip-reader';

interface Props {
  open: boolean;
  onClose: () => void;
  scope?: string;
  /** Fires with the freshly installed skill so the caller can insert a
   *  MentionNode into the chat composer. Only called for the URL-install
   *  path (which returns a full SkillSummary); the upload-to-cloud path
   *  does not produce a locally-installed skill. */
  onAdded?: (skill: SkillSummary) => void;
}

type BusyState = 'import' | 'upload' | 'sharing' | null;

type SkillSource = 'community' | 'upload' | 'url';

type CollectedFile = { file: File; path: string };
type UploadSource =
  | { kind: 'folder'; files: CollectedFile[] }
  | { kind: 'zip'; file: File }
  | { kind: 'file'; file: File };

export function AddSkillDialog({ open, onClose, scope, onAdded, workspaceContext: overrideContext }: Props & { workspaceContext?: WorkspaceCollabContext | null }) {
  const t = useT();
  const { context: hookContext, loading: hookLoading } = useWorkspaceContext();
  const workspaceContext = overrideContext ?? hookContext;
  const workspaceContextLoading = overrideContext ? false : hookLoading;

  const [activeTab, setActiveTab] = useState<SkillSource>('upload');
  const [url, setUrl] = useState('');
  const [uploadSource, setUploadSource] = useState<UploadSource | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const canConfirm =
    activeTab === 'upload'
      ? uploadSource !== null
      : activeTab === 'url'
        ? url.trim().length > 0
        : false;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (open) {
      setUrl('');
      setUploadSource(null);
      setBusy(null);
      setActiveTab('upload');
    }
  }, [open]);

  function closeDialog() {
    if (busy) return;
    onClose();
  }

  const hasTeam = workspaceContextHasTeamIdentity(workspaceContext);
  const isMac = isMacPlatform();

  async function checkCloudSkillDuplicate(name: string): Promise<boolean> {
    try {
      const headers = workspaceContext
        ? workspaceProjectHeaders(workspaceContext)
        : {};
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

  async function shareSkillToTeam(
    skillId: string,
    skillName: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!workspaceContext || !hasTeam) {
      return { ok: false, error: t('personalScope.noTeamWorkspace') };
    }
    try {
      const res = await fetch(
        `/api/workspace/skills/${encodeURIComponent(skillId)}/share${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`,
        { method: 'POST', headers: workspaceProjectHeaders(workspaceContext) },
      );
      const body = (await res.json().catch(() => ({}))) as { shared?: boolean };
      if (res.ok && body.shared) return { ok: true };
      return { ok: false, error: t('pluginsView.shareFailed', { title: skillName }) };
    } catch {
      return { ok: false, error: t('pluginsView.shareFailed', { title: skillName }) };
    }
  }

  async function handleImportUrl() {
    const trimmed = url.trim();
    if (!trimmed || busy || workspaceContextLoading) return;
    setBusy('import');
    try {
      const result = await installSkill({ source: trimmed }, workspaceContext);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      if (await checkCloudSkillDuplicate(result.skill.name)) {
        await deleteSkill(result.skill.id, workspaceContext);
        setToast({ message: t('personalScope.skillDuplicateName' as any), tone: 'error' });
        return;
      }
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        setToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        onAdded?.(result.skill);
        onClose();
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      } else {
        setToast({
          message: t('personalScope.importSuccessShareFailed', { name: result.skill.name }),
          tone: 'error',
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload() {
    if (!uploadSource || busy || workspaceContextLoading) return;
    setBusy('upload');
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
      const result = await uploadSkillToCloud(uploadInput, workspaceContext);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      setToast({
        message: t('personalScope.importAndShareSuccess', { name: result.title }),
        tone: 'success',
      });
      onClose();
      setUploadSource(null);
      window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
    } finally {
      setBusy(null);
    }
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

  const dialog = open ? createPortal(
    <div className={styles.backdrop} role="presentation" onClick={closeDialog}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('personalScope.addSkill')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.headerText}>
            <h2 className={styles.dialogTitle}>
              {t('personalScope.addSkill')}
            </h2>
            <p className={styles.dialogSubtitle}>
              {t('personalScope.addSkillSubtitle')}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('pluginsView.createClose')}
            onClick={closeDialog}
            disabled={busy !== null}
          >
            <Icon name="close" size={17} aria-hidden />
          </button>
        </header>
        <div className={styles.dialogBody}>
          <div className={styles.tabBar} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'community'}
              className={activeTab === 'community' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('community')}
              disabled={busy !== null}
            >
              {t('personalScope.skillTabCommunity')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'upload'}
              className={activeTab === 'upload' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('upload')}
              disabled={busy !== null}
            >
              {t('personalScope.skillTabUpload')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'url'}
              className={activeTab === 'url' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('url')}
              disabled={busy !== null}
            >
              {t('personalScope.skillTabUrl')}
            </button>
          </div>

          {activeTab === 'community' ? (
            <div className={styles.section}>
              <p className={styles.sectionBody}>{t('squareScope.emptyNote')}</p>
            </div>
          ) : activeTab === 'upload' ? (
            <div className={styles.section}>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                disabled={busy !== null}
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
                disabled={busy !== null}
                style={{ display: 'none' }}
                onChange={(event) => {
                  const f = event.currentTarget.files?.[0] ?? null;
                  if (f) setUploadSource({ kind: 'zip', file: f });
                }}
              />
              <button
                type="button"
                className={dragOver ? `${styles.uploadZone} ${styles.uploadZoneDragOver}` : styles.uploadZone}
                disabled={busy !== null}
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
                  disabled={busy !== null}
                  onClick={() => zipInputRef.current?.click()}
                >
                  {t('personalScope.skillSelectZip')}
                  <Icon name="file" size={14} aria-hidden />
                </button>
              )}
            </div>
          ) : (
            <div className={styles.section}>
              <div className={styles.urlRow}>
                <input
                  className={styles.urlInput}
                  aria-label={t('pluginsView.importFromUrl')}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={busy !== null}
                  placeholder="https://github.com/owner/skill-repo"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleImportUrl();
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <footer className={styles.dialogFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={closeDialog}
            disabled={busy !== null}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy !== null || workspaceContextLoading || !canConfirm}
            onClick={() => {
              if (activeTab === 'upload') void handleUpload();
              else if (activeTab === 'url') void handleImportUrl();
            }}
          >
            {busy !== null
              ? t('pluginsView.importing')
              : t('personalScope.skillConfirmAdd')}
          </button>
        </footer>
      </section>
      {toast ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>,
    document.body,
  ) : null;

  return <>{dialog}</>;
}

function parseSkillNameFromMarkdown(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return '';
  const block = match[1] ?? '';
  return readSkillFrontmatterString(block, 'name');
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
