import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Toast } from './Toast';
import { useT } from '../i18n';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import type { McpTransport } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { McpConfigForm, type McpConfigSelection } from './McpConfigForm';
import styles from './PersonalResourceView.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  scope?: string;
  /** Fires with the freshly created MCP template's id/label/transport so
   *  the caller can insert a MentionNode into the chat composer. */
  onAdded?: (mcp: { id: string; label: string; transport: McpTransport }) => void;
}

export function AddMcpDialog({ open, onClose, scope, onAdded, workspaceContext: overrideContext }: Props & { workspaceContext?: WorkspaceCollabContext | null }) {
  const t = useT();
  const { context: hookContext } = useWorkspaceContext();
  const workspaceContext = overrideContext ?? hookContext;

  const confirmRef = useRef<{ canConfirm: boolean; onConfirm: () => void }>({
    canConfirm: false,
    onConfirm: () => {},
  });
  const [canConfirm, setCanConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'community' | 'json'>('json');

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setToast(null);
      setCanConfirm(false);
      setActiveTab('json');
    }
  }, [open]);

  function closeDialog() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit(selection: McpConfigSelection) {
    if (busy) return;
    const trimmedLabel = selection.label.trim();
    if (!trimmedLabel) return;

    setBusy(true);
    try {
      let parsedConfig: Record<string, unknown> = {};
      try {
        parsedConfig = JSON.parse(selection.config) as Record<string, unknown>;
     } catch {
       setToast({ message: t('personalScope.mcpFormJsonInvalid'), tone: 'error' });
       setBusy(false);
        return;
      }

      const rawType = parsedConfig.type as string | undefined;
      const transport = rawType === 'sse' || rawType === 'http' ? rawType : 'stdio';

      // Check for duplicate label via dedicated cloud check endpoint.
      try {
        const headers = workspaceContext
          ? workspaceProjectHeaders(workspaceContext)
          : {};
        const checkRes = await fetch(
          `/api/workspace/mcp/cloud/check?label=${encodeURIComponent(trimmedLabel)}`,
          { cache: 'no-store', headers },
        );
        if (checkRes.ok) {
          const checkBody = await checkRes.json();
         if (checkBody.exists) {
           setToast({ message: t('personalScope.mcpDuplicateLabel'), tone: 'error' });
           setBusy(false);
            return;
          }
        }
      } catch {
        // If the check fails, proceed and let the server reject.
      }

      const template: Record<string, unknown> = {
        label: trimmedLabel,
        description: selection.displayName.trim(),
        transport,
        category: 'utilities',
      };

      if (transport === 'stdio') {
        template.command = (parsedConfig.command as string) ?? '';
        const argArr = Array.isArray(parsedConfig.args) ? parsedConfig.args as string[] : [];
        if (argArr.length > 0) template.args = argArr;
        const envFields = parsedConfig.env
          ? Object.entries(parsedConfig.env as Record<string, string>).map(([key, value]) => ({
              key,
              label: key,
              required: false,
              placeholder: value,
              secret: false,
            }))
          : [];
        if (envFields.length > 0) template.envFields = envFields;
      } else {
        template.url = (parsedConfig.url as string) ?? '';
        const headerFields = parsedConfig.headers
          ? Object.entries(parsedConfig.headers as Record<string, string>).map(([key, value]) => ({
              key,
              label: key,
              required: false,
              placeholder: value,
              secret: false,
            }))
          : [];
        if (headerFields.length > 0) template.headerFields = headerFields;
      }

      const submitHeaders = workspaceContext
        ? workspaceProjectHeaders(workspaceContext)
        : {};
      const res = await fetch('/api/workspace/mcp/cloud', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...submitHeaders,
        },
        body: JSON.stringify({ template, ...(scope ? { scope } : {}) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Create failed');
      }

      const data = await res.json().catch(() => null) as { template?: { id?: string; label?: string; transport?: string } } | null;
      const tpl = data?.template;
      if (tpl?.id) {
        onAdded?.({
          id: tpl.id,
          label: tpl.label ?? tpl.id,
          transport: (tpl.transport === 'sse' || tpl.transport === 'http' ? tpl.transport : 'stdio') as McpTransport,
        });
      }

     setToast({
       message: t('personalScope.mcpFormSuccess'),
       tone: 'success',
      });
      onClose();
      window.dispatchEvent(new CustomEvent('personal:mcp-refresh'));
    } catch (err: any) {
      setToast({
        message: err?.message ?? String(err),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const dialog = open ? createPortal(
    <div className={styles.backdrop} role="presentation" onClick={closeDialog}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('personalScope.addMcp')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.headerText}>
            <h2 className={styles.dialogTitle}>
              {t('personalScope.addMcp')}
            </h2>
            <p className={styles.dialogSubtitle}>
              {t('personalScope.addMcpSubtitle')}
            </p>
          </div>
          <button
            type="button"
           className={styles.closeBtn}
           aria-label={t('pluginsView.createClose')}
           onClick={closeDialog}
            disabled={busy}
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
              disabled={busy}
            >
              {t('personalScope.mcpTabCommunity')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'json'}
              className={activeTab === 'json' ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
              onClick={() => setActiveTab('json')}
              disabled={busy}
            >
              {t('personalScope.mcpTabJson')}
            </button>
          </div>

          {activeTab === 'community' ? (
            <div className={styles.section}>
              <p className={styles.sectionBody}>{t('squareScope.emptyNote')}</p>
            </div>
          ) : (
            <McpConfigForm
              confirmRef={confirmRef}
              onCanConfirmChange={setCanConfirm}
              onSubmit={(selection) => void handleSubmit(selection)}
            />
          )}
        </div>
        <footer className={styles.dialogFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={closeDialog}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy || !canConfirm}
            onClick={() => confirmRef.current.onConfirm()}
          >
            {busy ? t('personalScope.mcpFormSubmitting') : t('personalScope.mcpConfirmAdd')}
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
