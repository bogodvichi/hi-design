// Shared view for the "/personal-skill" and "/personal-mcp" routes.
// Renders a header with an "Add" button (top-right) and a placeholder
// content panel. For skills, the Add button opens a dialog with two
// import modes (link + folder); after local import the skill is
// automatically shared to the team hub via POST /api/workspace/skills/:id/share.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { Toast } from './Toast';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import { workspaceContextHasTeamIdentity, type WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import {
  importSkill,
  installSkill,
  type SkillImportInput,
  type SkillImportError,
} from '../providers/registry';
import sharedStyles from './TeamSpaceView.module.css';
import styles from './PersonalResourceView.module.css';

type ResourceKind = 'skill' | 'mcp';

interface ResourceConfig {
  icon: IconName;
  titleKey: keyof Dict;
  subtitleKey: keyof Dict;
  addKey: keyof Dict;
}

const CONFIG: Record<ResourceKind, ResourceConfig> = {
  skill: {
    icon: 'sparkles',
    titleKey: 'personalFunc.skill',
    subtitleKey: 'personalScope.subtitleSkill',
    addKey: 'personalScope.addSkill',
  },
  mcp: {
    icon: 'terminal',
    titleKey: 'personalFunc.mcp',
    subtitleKey: 'personalScope.subtitleMcp',
    addKey: 'personalScope.addMcp',
  },
};

type BusyState = 'import' | 'upload' | 'sharing' | null;

export function PersonalResourceView({ kind }: { kind: ResourceKind }) {
  const t = useT();
  const config = CONFIG[kind];
  const { context: workspaceContext, loading: workspaceContextLoading } = useWorkspaceContext();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  function openDialog() {
    setUrl('');
    setFolderFiles([]);
    setBusy(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setDialogOpen(false);
  }

  const hasTeam = workspaceContextHasTeamIdentity(workspaceContext);

  // After a skill is imported locally, push it to the team hub.
  async function shareSkillToTeam(
    skillId: string,
    skillName: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!workspaceContext || !hasTeam) {
      return { ok: false, error: t('personalScope.noTeamWorkspace') };
    }
    try {
      const res = await fetch(
        `/api/workspace/skills/${encodeURIComponent(skillId)}/share`,
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
      // Import succeeded — now push to team hub.
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        setToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        setDialogOpen(false);
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

  async function handleUploadFolder() {
    if (folderFiles.length === 0 || busy || workspaceContextLoading) return;
    setBusy('upload');
    try {
      const input = await readSkillImportInputFromFolder(folderFiles, t);
      if ('error' in input) {
        setToast({ message: input.error.message, tone: 'error' });
        return;
      }
      const result = await importSkill(input, workspaceContext);
      if ('error' in result) {
        setToast({ message: result.error.message || t('pluginsView.importFailed'), tone: 'error' });
        return;
      }
      // Import succeeded — now push to team hub.
      setBusy('sharing');
      const shareResult = await shareSkillToTeam(result.skill.id, result.skill.name);
      if (shareResult.ok) {
        setToast({
          message: t('personalScope.importAndShareSuccess', { name: result.skill.name }),
          tone: 'success',
        });
        setDialogOpen(false);
        setFolderFiles([]);
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

  const dialog = dialogOpen ? createPortal(
    <div className={styles.backdrop} role="presentation" onClick={closeDialog}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-skill-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <h2 id="personal-skill-dialog-title" className={styles.dialogTitle}>
            {t(config.addKey)}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('pluginsView.createClose')}
            onClick={closeDialog}
            disabled={busy !== null}
          >
            <Icon name="close" size={15} aria-hidden />
          </button>
        </header>
        <div className={styles.dialogBody}>
          {/* Import from link */}
          <article className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('pluginsView.importFromUrl')}</h3>
            <p className={styles.sectionBody}>
              {t('pluginsView.importUrlBody', { kind: 'Skill' })}
            </p>
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
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={workspaceContextLoading || busy !== null || url.trim().length === 0}
                onClick={() => void handleImportUrl()}
              >
                {busy === 'import' || busy === 'sharing'
                  ? t('pluginsView.importing')
                  : t('pluginsView.importAndUpload')}
              </button>
            </div>
          </article>

          {/* Upload local folder */}
          <article className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('pluginsView.uploadFolder')}</h3>
            <p className={styles.sectionBody}>
              {t('pluginsView.uploadFolderBody', { kind: 'Skill', manifest: 'SKILL.md' })}
            </p>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              disabled={busy !== null}
              style={{ display: 'none' }}
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(event) =>
                setFolderFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
            <div className={styles.folderRow}>
              <button
                type="button"
                className={styles.folderPickBtn}
                disabled={busy !== null}
                onClick={() => folderInputRef.current?.click()}
              >
                <Icon name="folder" size={15} aria-hidden />
                {folderFiles.length > 0
                  ? t('pluginsView.filesSelected', { count: folderFiles.length })
                  : t('pluginsView.chooseFolder')}
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={workspaceContextLoading || busy !== null || folderFiles.length === 0}
                onClick={() => void handleUploadFolder()}
              >
                {busy === 'upload' || busy === 'sharing'
                  ? t('pluginsView.uploading')
                  : t('pluginsView.uploadKind', { kind: 'Skill' })}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <section className={sharedStyles.view} aria-labelledby={`personal-${kind}-title`}>
      <header className={sharedStyles.header}>
        <div className={sharedStyles.titleBlock}>
          <h1 id={`personal-${kind}-title`} className={sharedStyles.title}>{t(config.titleKey)}</h1>
          <span className={sharedStyles.subtitle}>
            <span className={sharedStyles.dot} aria-hidden />
            {t(config.subtitleKey)}
          </span>
        </div>
        <div className={sharedStyles.headerActions}>
          <button
            type="button"
            className={sharedStyles.inviteBtn}
            onClick={kind === 'skill' ? openDialog : undefined}
          >
            <Icon name="plus" size={15} aria-hidden />
            <span>{t(config.addKey)}</span>
          </button>

        </div>
      </header>

      <div className={sharedStyles.content} role="tabpanel">
        <div className={sharedStyles.panel}>
          <span className={sharedStyles.panelIcon} aria-hidden>
            <Icon name={config.icon} size={32} />
          </span>
          <h2 className={sharedStyles.panelTitle}>{t(config.titleKey)}</h2>
          <p className={sharedStyles.panelNote}>{t('personalScope.emptyNotePersonal')}</p>
        </div>
      </div>

      {dialog}
      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      ) : null}
    </section>
  );
}

// Reads a SKILL.md out of a webkitdirectory folder selection and shapes it
// into the /api/skills/import body. Mirrors the same logic in PluginsView.
async function readSkillImportInputFromFolder(
  files: File[],
  t: ReturnType<typeof useT>,
): Promise<SkillImportInput | { error: SkillImportError }> {
  const skillFile = files.find((file) =>
    /(^|\/)SKILL\.md$/i.test(file.webkitRelativePath || file.name),
  );
  if (!skillFile) {
    return { error: { message: t('pluginsView.skillMissingFile') } };
  }
  let text: string;
  try {
    text = await skillFile.text();
  } catch {
    return { error: { message: t('pluginsView.skillReadFailed') } };
  }
  const fallbackName = deriveSkillFolderName(skillFile);
  const { name, description, body } = parseSkillMarkdown(text, fallbackName);
  if (!name) {
    return { error: { message: t('pluginsView.skillMissingName') } };
  }
  if (!body.trim()) {
    return { error: { message: t('pluginsView.skillEmptyBody') } };
  }
  return { name, description, body, triggers: [] };
}

function deriveSkillFolderName(file: File): string {
  const rel = file.webkitRelativePath;
  if (rel && rel.includes('/')) return rel.split('/')[0] ?? '';
  return file.name.replace(/\.md$/i, '');
}

function parseSkillMarkdown(
  content: string,
  fallbackName: string,
): { name: string; description: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { name: fallbackName, description: '', body: content.trim() };
  }
  const block = match[1] ?? '';
  const body = content.slice(match[0].length).trim();
  const name = readSkillFrontmatterString(block, 'name') || fallbackName;
  const description = readSkillFrontmatterString(block, 'description');
  return { name, description, body };
}

function readSkillFrontmatterString(block: string, key: string): string {
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
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
