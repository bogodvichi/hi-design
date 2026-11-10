import { userFacingError } from '../utils/userFacingError';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { notifyToast } from './toast-context';
import { SkillUploadSummary } from './SkillUploadSummary';
import { skillUploadErrorMessage } from '../utils/skill-upload-error';
import uploadStyles from './AddSkillDialog.module.css';
import { useI18n, useT } from '../i18n';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { findSingleSkillEntry, SKILL_UPLOAD_MAX_BYTES, SKILL_UPLOAD_MAX_MB, workspaceContextHasTeamIdentity, type WorkspaceCollabContext } from '@open-design/contracts';
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

type SkillSource = 'upload' | 'url';

type CollectedFile = { file: File; path: string };
type UploadSource =
  | { kind: 'folder'; files: CollectedFile[]; folderName?: string }
  | { kind: 'zip'; file: File }
  | { kind: 'file'; file: File };

export function AddSkillDialog({ open, onClose, scope, onAdded, workspaceContext: overrideContext }: Props & { workspaceContext?: WorkspaceCollabContext | null }) {
  const t = useT();
  const { locale } = useI18n();
  const { context: hookContext, loading: hookLoading } = useWorkspaceContext();
  const workspaceContext = overrideContext ?? hookContext;
  const workspaceContextLoading = overrideContext ? false : hookLoading;

  const [activeTab, setActiveTab] = useState<SkillSource>('upload');
  const [url, setUrl] = useState('');
  const [uploadSource, setUploadSource] = useState<UploadSource | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [validatedSkillName, setValidatedSkillName] = useState<string | null>(null);
  const [validatingUpload, setValidatingUpload] = useState(false);
  const validationSeq = useRef(0);
  const [busy, setBusy] = useState<BusyState>(null);
  const isBusy = busy !== null;
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canConfirm =
    activeTab === 'upload'
      ? uploadSource !== null && !validatingUpload && !!validatedSkillName
      : url.trim().length > 0;

  useEffect(() => {
    if (open) {
      setUrl('');
      resetUpload();
      setBusy(null);
      setActiveTab('upload');
    }
    return () => { validationSeq.current++; };
  }, [open]);

  function closeDialog() {
    if (isBusy) return;
    onClose();
  }

  const hasTeam = workspaceContextHasTeamIdentity(workspaceContext);
  const isMac = isMacPlatform();
  const canPickFilesAndFolders = isMac && Boolean(getOpenDesignHost()?.project?.pickSkillSource);

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
        notifyToast({ message: userFacingError(result.error, t, 'feedback.saveFailed', t('feedback.objectSkill')), tone: 'error' });
        return;
      }
      if (await checkCloudSkillDuplicate(result.skill.name)) {
        await deleteSkill(result.skill.id, workspaceContext);
        notifyToast({ message: t('personalScope.skillDuplicateName' as any), tone: 'error' });
        return;
      }
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        notifyToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        onAdded?.(result.skill);
        onClose();
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      } else {
        notifyToast({
          message: t('personalScope.importSuccessShareFailed', { name: result.skill.name }),
          tone: 'error',
        });
      }
    } catch (err) {
      notifyToast({ message: userFacingError(err, t, 'feedback.importFailed', t('feedback.objectSkill')), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload() {
    if (!uploadSource || !validatedSkillName || validatingUpload || busy || workspaceContextLoading) return;
    setBusy('upload');
    setUploadError(null);
    try {
      const skillName = validatedSkillName;
      if (await checkCloudSkillDuplicate(skillName)) {
        notifyToast({ message: t('personalScope.skillDuplicateName' as any), tone: 'error' });
        return;
      }
      const uploadInput = await buildCloudUploadInput(uploadSource);
      const result = await uploadSkillToCloud(uploadInput, workspaceContext);
      if ('error' in result) {
        showUploadError(result.error);
        return;
      }
      // A Personal Skill must be usable immediately after being added.
      // Upload creates the owned cloud source; install materializes that source
      // locally under the authenticated Personal Workspace.
      if (!result.resourceId || !workspaceContext) {
        window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
        notifyToast({ message: t('feedback.skillSavedInstallFailed'), tone: 'error' });
        return;
      }
      const installRes = await fetch(
        `/api/workspace/skills/cloud/${encodeURIComponent(result.resourceId)}/install?home_workspace_id=${encodeURIComponent(workspaceContext.workspaceId)}`,
        { method: 'POST', headers: workspaceProjectHeaders(workspaceContext) },
      );
      const installBody = await installRes.json().catch(() => ({})) as { installed?: boolean; error?: string; message?: string };
      window.dispatchEvent(new CustomEvent('personal:skill-refresh'));
      if (!installRes.ok || installBody.installed !== true) {
        notifyToast({
          message: t('feedback.skillSavedInstallFailed'),
          tone: 'error',
        });
        return;
      }
      notifyToast({
        message: t('personalScope.importAndShareSuccess', { name: result.title }),
        tone: 'success',
      });
      onClose();
      setUploadSource(null);
    } catch (err) {
      showUploadError(err);
    } finally {
      setBusy(null);
    }
  }

  function showUploadError(error: unknown) {
    const message = skillUploadErrorMessage(error, locale)
      ?? userFacingError(error, t, 'feedback.importFailed', t('feedback.objectSkill'));
    setUploadError(message);
  }

  function resetUpload() {
    validationSeq.current++;
    setUploadSource(null);
    setUploadError(null);
    setValidatedSkillName(null);
    setValidatingUpload(false);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function stageUploadSource(source: UploadSource) {
    const seq = ++validationSeq.current;
    setUploadSource(source);
    setUploadError(null);
    setValidatedSkillName(null);
    setValidatingUpload(true);
    try {
      const size = source.kind === 'folder'
        ? source.files.reduce((total, entry) => total + entry.file.size, 0) : source.file.size;
      if (size > SKILL_UPLOAD_MAX_BYTES) throw new Error('SKILL_UPLOAD_TOO_LARGE');
      let text: string | null;
      if (source.kind === 'zip') {
        text = await findSkillMdInZip(source.file);
      } else if (source.kind === 'file') {
        if (!/\.md$/i.test(source.file.name)) throw new Error('SKILL_FILE_TYPE_UNSUPPORTED');
        text = await source.file.text();
      } else {
        const selection = await findSingleSkillEntry(source.files.map(file => file.path), index => source.files[index]!.file.text());
        if (!selection.ok) throw new Error(selection.error);
        text = await source.files[selection.index]!.file.text();
      }
      if (text === null) throw new Error('SKILL_MD_NOT_FOUND');
      if (!text.trim()) throw new Error('SKILL_CONTENT_EMPTY');
      const name = parseSkillNameFromMarkdown(text);
      if (!name) throw new Error('SKILL_NAME_MISSING');
      if (seq === validationSeq.current) setValidatedSkillName(name);
    } catch (error) {
      if (seq === validationSeq.current) showUploadError(error);
    } finally {
      if (seq === validationSeq.current) setValidatingUpload(false);
    }
  }

  async function buildCloudUploadInput(source: UploadSource) {
    if (source.kind === 'zip') return { zip: source.file };
    if (source.kind === 'file') return [{ file: source.file, path: 'SKILL.md' }];
    const selection = await findSingleSkillEntry(source.files.map(file => file.path), index => source.files[index]!.file.text());
    if (!selection.ok) throw new Error(selection.error);
    const skillPath = source.files[selection.index]!.path.replace(/\\/g, '/');
    const prefix = skillPath.slice(0, skillPath.lastIndexOf('/') + 1);
    return source.files
      .map(entry => ({ file: entry.file, path: entry.path.replace(/\\/g, '/') }))
      .filter(entry => entry.path.startsWith(prefix))
      .map(entry => ({ file: entry.file, path: entry.path === skillPath ? 'SKILL.md' : entry.path.slice(prefix.length) }));
  }

  function selectUploadFile(file: File) {
    if (/\.zip$/i.test(file.name)) {
      void stageUploadSource({ kind: 'zip', file });
    } else {
      void stageUploadSource({ kind: 'file', file });
    }
  }

  async function handleMacClick() {
    const host = getOpenDesignHost();
    if (!host?.project?.pickSkillSource) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const result = await host.project.pickSkillSource();
      if (!result.ok) {
        if (!result.canceled) showUploadError(new Error(result.reason));
        return;
      }
      if (result.kind === 'folder') {
        const files = result.files.map((f) => ({
          file: new File([f.data], f.path.split('/').pop() || f.path),
          path: f.path,
        }));
        await stageUploadSource({ kind: 'folder', files, folderName: result.folderName });
      } else if (result.kind === 'zip') {
        const file = new File([result.data], result.fileName, { type: 'application/zip' });
        await stageUploadSource({ kind: 'zip', file });
      } else if (result.files.length === 1) {
        const selected = result.files[0]!;
        const fileName = selected.path.split('/').pop() || selected.path;
        selectUploadFile(new File([selected.data], fileName, { type: 'text/markdown' }));
      } else {
        resetUpload();
        showUploadError(new Error('MULTIPLE_SKILLS'));
      }
    } catch (error) {
      showUploadError(error);
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

    try {
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const entries = await readDragEntries(items);
        if (entries && entries.length > 0) {
          if (entries.length === 1 && /\.(zip)$/i.test(entries[0]!.file.name)) {
            await stageUploadSource({ kind: 'zip', file: entries[0]!.file });
            return;
          }
          if (entries.length === 1 && !entries[0]!.path.includes('/')) {
            selectUploadFile(entries[0]!.file);
            return;
          }
          const root = entries[0]?.path.split('/')[0];
          const folderName = root && entries.every(entry => entry.path.startsWith(`${root}/`)) ? root : undefined;
          await stageUploadSource({ kind: 'folder', files: entries, folderName });
          return;
        }
      }

      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 1) {
        selectUploadFile(files[0]!);
      } else if (files.length > 0) {
        await stageUploadSource({
          kind: 'folder',
          files: files.map((f) => ({ file: f, path: f.name })),
        });
      }
    } catch (error) {
      showUploadError(error);
    }
  }, [busy, locale]);

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
            disabled={isBusy}
          >
            <Icon name="close" size={17} aria-hidden />
          </button>
        </header>
        <div className={styles.dialogBody}>
          <div className={styles.tabBar} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'upload'}
              className={activeTab === 'upload' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('upload')}
              disabled={isBusy}
            >
              {t('personalScope.skillTabUpload')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'url'}
              className={activeTab === 'url' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('url')}
              disabled={isBusy}
            >
              {t('personalScope.skillTabUrl')}
            </button>
          </div>

          {activeTab === 'upload' ? (
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
                  if (files.length === 1 && !files[0]!.webkitRelativePath) {
                    selectUploadFile(files[0]!);
                  } else {
                    void stageUploadSource({
                      kind: 'folder',
                      folderName: files[0]?.webkitRelativePath?.split('/')[0],
                      files: files.map((f) => ({
                        file: f,
                        path: f.webkitRelativePath || f.name,
                      })),
                    });
                  }
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.md"
                disabled={busy !== null}
                style={{ display: 'none' }}
                onChange={(event) => {
                  const f = event.currentTarget.files?.[0] ?? null;
                  if (f) selectUploadFile(f);
                }}
              />
              {uploadSource ? (
                <SkillUploadSummary source={uploadSource} locale={locale} disabled={isBusy} onRemove={resetUpload} />
              ) : (
                <button
                  type="button"
                  className={dragOver ? `${styles.uploadZone} ${styles.uploadZoneDragOver}` : styles.uploadZone}
                  disabled={busy !== null}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => {
                    if (canPickFilesAndFolders) void handleMacClick();
                    else folderInputRef.current?.click();
                  }}
                >
                  <span className={styles.uploadZoneIcon} aria-hidden>
                    <Icon name="upload" size={23} />
                  </span>
                  <strong className={styles.uploadZoneStrong}>
                    {canPickFilesAndFolders ? t('personalScope.skillDropZoneHint') : t('personalScope.skillDropZoneHintFolder')}
                  </strong>
                  <span>{locale.startsWith('zh') ? `支持文件夹/.zip包/.md文件，总大小不超过${SKILL_UPLOAD_MAX_MB}MB` : `Supports folders, .zip archives and .md files; total size up to ${SKILL_UPLOAD_MAX_MB} MB`}</span>
                </button>
              )}
              {uploadError && <p className={uploadStyles.error} role="alert">{uploadError}</p>}
              {!canPickFilesAndFolders && !uploadSource && (
                <button
                  type="button"
                  className={styles.selectZipBtn}
                  disabled={busy !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('publishDialog.selectFile')}
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
            disabled={isBusy}
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
              : validatingUpload ? (locale.startsWith('zh') ? '校验中...' : 'Validating...') : t('personalScope.skillConfirmAdd')}
          </button>
        </footer>
      </section>
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
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      fileEntry.file(
        (file) => {
          const path = relPath ? `${relPath}/${file.name}` : file.name;
          result.push({ file, path });
          resolve();
        },
        reject,
      );
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const dirName = entry.name;
      const basePath = relPath ? `${relPath}/${dirName}` : dirName;
      readAllEntries(reader, (childEntries) => {
        Promise.all(childEntries.map((child) => traverseEntry(child, basePath, result)))
          .then(() => resolve())
          .catch(reject);
      }, reject);
    } else {
      resolve();
    }
  });
}

function readAllEntries(
  reader: FileSystemDirectoryReader,
  onSuccess: (entries: FileSystemEntry[]) => void,
  onError: (error: DOMException) => void,
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
