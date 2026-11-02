import { notifyToast } from './toast-context';
import { responseError, userFacingError } from '../utils/userFacingError';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from '@open-design/components';
import type {
  HdwRuntimeConfigResponse,
  WorkspaceCollabContext,
} from '@open-design/contracts';

import { useT } from '../i18n';
import { RemixIcon } from './RemixIcon';
import { PersonPicker, type Person } from './PersonPicker';
import { getStoredUserInfo } from '../auth/auth';
import { shareProjectToSharedSpace } from '../collab/shared-space-catalog';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import styles from './UnifiedShareDialog.module.css';

type ShareTab = 'community' | 'file' | 'link';

interface CommunityPublishResult {
  pluginId: string;
  versionId: string;
  name: string;
  version: string;
  url: string;
}

interface UnifiedShareDialogProps {
  projectId: string;
  workspaceId: string;
  projectName: string;
  entryFile?: string | null;
  workspaceContext: WorkspaceCollabContext | null;
  canPublishToCommunity?: boolean;
  canShareFile?: boolean;
  canGenerateLink?: boolean;
  onShared?: () => void;
  onClose: () => void;
}

/**
 * Extract the public share URL from an HDW share-link API response.
 * Handles both the envelope shape `{ code, msg, data: { token, url } }`
 * and a direct `{ token, url }` payload. When only a token is returned,
 * constructs the viewer URL from the runtime-resolved HDW share base.
 */
function extractShareUrl(data: unknown, publicBase: string): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  // Envelope: { code: 0, data: { token, url } }
  const inner =
    obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : obj;
  if (typeof inner.url === 'string' && inner.url.trim()) {
    return inner.url.trim();
  }
  const base = publicBase.trim().replace(/\/+$/, '');
  if (base && typeof inner.token === 'string' && inner.token.trim()) {
    return `${base}/hdw/share/${encodeURIComponent(inner.token.trim())}`;
  }
  return '';
}

async function fetchHdwSharePublicBase(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/hdw/runtime-config', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Partial<HdwRuntimeConfigResponse>;
  const publicBase = typeof data.sharePublicBase === 'string'
    ? data.sharePublicBase.trim().replace(/\/+$/, '')
    : '';
  if (!/^https?:\/\//i.test(publicBase)) {
    throw new Error('Invalid HDW share public base');
  }
  return publicBase;
}

export function UnifiedShareDialog({
  projectId,
  workspaceId,
  projectName,
  entryFile,
  workspaceContext,
  canPublishToCommunity = true,
  canShareFile = true,
  canGenerateLink = true,
  onShared,
  onClose,
}: UnifiedShareDialogProps) {
  const t = useT();
  const effectiveWorkspaceId =
    workspaceContext?.workspaceId.trim() || workspaceId.trim();
  const [activeTab, setActiveTab] = useState<ShareTab>(
    canPublishToCommunity ? 'community' : canShareFile ? 'file' : 'link',
  );

  // Community publish state
  const [communityTitle, setCommunityTitle] = useState(projectName);
  const [communityDesc, setCommunityDesc] = useState('');
  const [publishing, setPublishing] = useState(false);

  const [publishResult, setPublishResult] = useState<CommunityPublishResult | null>(null);

  // Share link state
  const [shareLink, setShareLink] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);
  const [sharingToTeam, setSharingToTeam] = useState(false);
  const [sharePublicBase, setSharePublicBase] = useState('');
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);

 const [copied, setCopied] = useState(false);

 // Share-to-person state (mirrors ShareToSharedSpaceDialog)
 const [shareRecipients, setShareRecipients] = useState<Person[]>([]);
 const [shareSubmitting, setShareSubmitting] = useState(false);
 const [shareError, setShareError] = useState<string | null>(null);
 const [shareSuccess, setShareSuccess] = useState(false);

 // Fetch share link when the link tab is activated
  useEffect(() => {
    if (activeTab !== 'link') return;
    let cancelled = false;
    const controller = new AbortController();
    setLinkLoading(true);
    setRuntimeConfigLoading(true);
    setSharePublicBase('');
    setShareLink('');

    void (async () => {
      try {
        const publicBase = await fetchHdwSharePublicBase(controller.signal);
        if (cancelled) return;
        setSharePublicBase(publicBase);

        const params = new URLSearchParams();
        params.set('project_id', projectId);
        if (effectiveWorkspaceId) params.set('workspace_id', effectiveWorkspaceId);
        params.set('public_base', publicBase);
        const resp = await fetch(`/api/hdw/api/share-link?${params}`, {
          headers: workspaceContext ? workspaceProjectHeaders(workspaceContext) : {},
          signal: controller.signal,
        });
        if (cancelled) return;
        // 404 and `{ code: 0, data: null }` both mean no share link yet.
        if (resp.status === 404) return;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled) setShareLink(extractShareUrl(data, publicBase));
      } catch {
        // Network/parse/config failure leaves the generate affordance visible.
      } finally {
        if (!cancelled) {
          setLinkLoading(false);
          setRuntimeConfigLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, effectiveWorkspaceId, projectId, workspaceContext]);

  const canPublish = useMemo(
    () => communityTitle.trim().length > 0 && !publishing && !publishResult,
    [communityTitle, publishing, publishResult],
  );

  async function handlePublish() {
    if (!canPublishToCommunity || !canPublish) return;
    setPublishing(true);

    try {
      const resp = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/publish-community`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(workspaceContext ? workspaceProjectHeaders(workspaceContext) : {}),
          },
          body: JSON.stringify({
            title: communityTitle.trim(),
            description: communityDesc.trim(),
            ...(entryFile ? { entryFile } : {}),
          }),
        },
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw await responseError(resp, data);
      }
      setPublishResult(data as CommunityPublishResult);
      notifyToast({ message: t('feedback.published'), tone: 'success' });
    } catch (err) {
      notifyToast({ message: userFacingError(err, t, 'feedback.publishFailed', t('feedback.objectProject')), tone: 'error' });
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      notifyToast({ message: t('feedback.copied'), tone: 'success' });
      setTimeout(() => setCopied(false), 2000);
   } catch {
     notifyToast({ message: t('feedback.copyFailed'), tone: 'error' });
   }
 }

 // Current user's email — used to exclude self from the recipient picker.
 const selfEmail = typeof getStoredUserInfo()?.email === 'string'
   ? getStoredUserInfo().email.trim().toLowerCase()
   : '';
 const excludeEmails = selfEmail ? [selfEmail] : [];

  async function handleShareSubmit() {
    if (!canShareFile || shareRecipients.length === 0 || shareSubmitting || shareSuccess) return;
   // Guard against self-share even if the picker somehow let one through.
   if (selfEmail && shareRecipients.some((p) => {
     const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
     return email === selfEmail;
   })) {
     setShareError(t('sharedSpace.cannotShareToSelf'));
     return;
   }
   setShareSubmitting(true);
   setShareError(null);
   try {
     const result = await shareProjectToSharedSpace({
       projectId,
       homeWorkspaceId: workspaceId,
       recipients: shareRecipients
         .filter((p) => {
           const email = typeof p.email === 'string' ? p.email.trim() : '';
           return Boolean(email && email.includes('@'));
         })
         .map((p) => {
           // SSO username = email local-part
           const email = typeof p.email === 'string' ? p.email.trim() : '';
           const username = email.split('@')[0] || '';
           return {
             username,
             displayname: p.name,
           };
         }),
     });
     if (!result) {
       notifyToast({ message: t('sharedSpace.shareFailed'), tone: 'error' });
       return;
     }
      setShareSuccess(true);
      notifyToast({ message: t('sharedSpace.shareSuccess'), tone: 'success' });
      onShared?.();
      onClose();
   } catch {
     notifyToast({ message: t('sharedSpace.shareFailed'), tone: 'error' });
   } finally {
     setShareSubmitting(false);
   }
 }

 async function handleGenerateLink() {
   if (!canGenerateLink) return;

   setLinkGenerating(!workspaceContext);
   setSharingToTeam(Boolean(workspaceContext));
   try {
      const publicBase = sharePublicBase || await fetchHdwSharePublicBase();
      setSharePublicBase(publicBase);

      if (workspaceContext) {
        const syncResp = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/collab/sync-intent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...workspaceProjectHeaders(workspaceContext),
            },
            body: JSON.stringify({ event: 'project_team_share_requested' }),
          },
        );
        if (!syncResp.ok) throw await responseError(syncResp);
        const syncData = await syncResp.json() as { syncState?: unknown };
        if (syncData.syncState !== 'synced') {
          throw Object.assign(new Error('Team project upload was not confirmed'), {
            code: 'TEAM_PROJECT_PUBLISH_UNAVAILABLE',
          });
        }
        setSharingToTeam(false);
      }

      setLinkGenerating(true);
     const resp = await fetch('/api/hdw/api/share-link/generate', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         ...(workspaceContext ? workspaceProjectHeaders(workspaceContext) : {}),
       },
       body: JSON.stringify({
         project_id: projectId,
         ...(effectiveWorkspaceId ? { workspace_id: effectiveWorkspaceId } : {}),
         public_base: publicBase,
       }),
     });
     const data = await resp.json();
     if (!resp.ok) {
       throw Object.assign(new Error(data?.message || data?.msg || `HTTP ${resp.status}`), { code: data?.error?.code ?? data?.error });
     }
     const url = extractShareUrl(data, publicBase);
     if (url) {
       setShareLink(url);
       notifyToast({ message: t('feedback.linkCreated'), tone: 'success' });
     } else {
       notifyToast({ message: t('share.noLink'), tone: 'error' });
     }
   } catch (err) {
     notifyToast({ message: userFacingError(err, t, 'feedback.linkFailed', t('feedback.objectProject')), tone: 'error' });
   } finally {
     setLinkGenerating(false);
     setSharingToTeam(false);
   }
 }

  const tabs: { id: ShareTab; label: string; icon: string }[] = [
    ...(canPublishToCommunity
      ? [{ id: 'community' as const, label: t('share.tabCommunity'), icon: 'global-line' }]
      : []),
    ...(canShareFile
      ? [{ id: 'file' as const, label: t('share.tabFile'), icon: 'group-line' }]
      : []),
    { id: 'link', label: t('share.tabLink'), icon: 'link' },
  ];

 const footerActionLabel =
   activeTab === 'community'
     ? publishResult
       ? t('share.confirm')
       : publishing
         ? t('share.publishing')
         : t('share.publish')
   : activeTab === 'file'
     ? shareSuccess
       ? t('sharedSpace.shareSuccess')
       : shareSubmitting
         ? t('share.publishing')
         : t('sharedSpace.shareDialogSubmit')
    : activeTab === 'link'
      ? linkGenerating
        ? t('share.generating')
        : sharingToTeam
          ? t('share.sharingToTeam')
          : shareLink
            ? t('share.regenerateLink')
            : t('share.generateLink')
      : t('share.close');

const footerActionDisabled =
  activeTab === 'community'
    ? !canPublish
    : activeTab === 'file'
      ? shareRecipients.length === 0 || shareSubmitting || shareSuccess
      : activeTab === 'link'
        ? linkLoading || runtimeConfigLoading || linkGenerating || sharingToTeam
        : false;

 function handleFooterAction() {
   if (activeTab === 'community' && !publishResult) {
     void handlePublish();
   } else if (activeTab === 'file' && !shareSuccess) {
     void handleShareSubmit();
   } else if (activeTab === 'link') {
     void handleGenerateLink();
   } else {
     onClose();
   }
 }

  return createPortal(
   <Dialog
     onClose={onClose}
     closeOnEscape
     closeOnBackdrop
     ariaLabel={t('share.dialogTitle', { name: projectName })}
     className={styles.dialog}
     backdropClassName={styles.backdrop}
   >
      <DialogHeader className={styles.header}>
        <DialogTitle className={styles.title}>
          {t('share.dialogTitle', { name: projectName })}
        </DialogTitle>
        <button
          type="button"
          className={styles.closeBtn}
          aria-label={t('share.close')}
          onClick={onClose}
        >
          <RemixIcon name="close-line" size={18} />
        </button>
      </DialogHeader>

      <DialogBody className={styles.body}>
        <div className={styles.tabs} role="tablist" aria-label={t('share.tabLabel')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <RemixIcon name={tab.icon} size={15} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {activeTab === 'community' && (
          <div className={styles.communityPanel}>
            {publishResult ? (
              <div className={styles.publishSuccess}>
                <div className={styles.successIcon}>
                  <RemixIcon name="check-line" size={32} />
                </div>
                <p className={styles.successHeading}>{t('share.published')}</p>
                <p className={styles.successHint}>
                  {t('share.publishSuccessHint', { name: communityTitle.trim() })}
                </p>
                <a
                  href="/square"
                  className={styles.openInCommunity}
                >
                  {t('share.openInCommunity')}
                  <RemixIcon name="external-link-line" size={14} />
                </a>
              </div>
            ) : (
              <>
                <p className={styles.communityHint}>{t('share.communityHint')}</p>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t('share.communityTitle')}</span>
                  <Input
                    value={communityTitle}
                    onChange={(e) => setCommunityTitle(e.target.value)}
                    placeholder={projectName}
                    className={styles.fieldInput}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t('share.communityDesc')}</span>
                  <Textarea
                    value={communityDesc}
                    onChange={(e) => setCommunityDesc(e.target.value)}
                    placeholder={t('share.communityDescPlaceholder')}
                    rows={3}
                    className={styles.fieldTextarea}
                  />
                </label>
              </>
            )}
          </div>
        )}

       {activeTab === 'file' && (
         <div className={styles.sharePanel}>
           <p className={styles.shareHint}>{t('sharedSpace.shareDialogDesc')}</p>
           <label className={styles.field}>
             <span className={styles.fieldLabel}>{t('sharedSpace.shareDialogRecipientLabel')}</span>
             <PersonPicker
               selected={shareRecipients}
               onChange={setShareRecipients}
               multiple
               placeholder={t('sharedSpace.shareDialogRecipientPlaceholder')}
               excludeEmails={excludeEmails}
             />
           </label>
           {shareError && <p className={styles.error}>{shareError}</p>}
         </div>
       )}

        {activeTab === 'link' && (
          <div className={styles.linkPanel}>
            <div className={styles.linkSymbol}>
              <RemixIcon name="link" size={24} />
            </div>
            <p className={styles.linkHeading}>{t('share.linkLabel')}</p>
            <p className={styles.linkHint}>{t('share.linkHint')}</p>
           {linkLoading && <p className={styles.linkHint}>{t('share.querying')}</p>}
           {sharingToTeam && <p className={styles.linkHint}>{t('share.sharingToTeam')}</p>}
           {linkGenerating && <p className={styles.linkHint}>{t('share.generating')}</p>}
           {shareLink && !linkLoading && !linkGenerating && !sharingToTeam && (
              <>
                <div className={styles.copyRow}>
                  <Input
                    readOnly
                    value={shareLink}
                    className={styles.linkInput}
                  />
                  <Button onClick={handleCopyLink} className={styles.copyBtn}>
                    {copied ? t('share.copied') : t('share.copyLink')}
                  </Button>
                </div>
                <a
                  href={shareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.openPreview}
                >
                  {t('share.openPreview')}
                  <RemixIcon name="external-link-line" size={14} />
                </a>
              </>
            )}
           {!shareLink && !linkLoading && !linkGenerating && !sharingToTeam && (
             <p className={styles.linkHint}>{canGenerateLink ? t('share.generateLinkHint') : '暂无分享链接，请联系团队成员生成'}</p>
           )}
          </div>
        )}
      </DialogBody>

      <DialogFooter className={styles.footer}>
        <Button onClick={onClose} className={styles.footerSecondary}>
          {t('share.close')}
        </Button>
        {(activeTab !== 'link' || canGenerateLink) ? (
          <Button
            onClick={handleFooterAction}
            disabled={footerActionDisabled}
            className={styles.footerAction}
          >
            {footerActionLabel}
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>,
    document.body,
  );
}
