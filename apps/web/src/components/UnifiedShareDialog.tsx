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
import type { WorkspaceCollabContext } from '@open-design/contracts';

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
 * constructs the viewer URL via the daemon's `/api/hdw/share/:token`
 * proxy so the link is reachable from the user's browser.
 */
function extractShareUrl(data: unknown): string {
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
  if (typeof inner.token === 'string' && inner.token.trim()) {
    return `${window.location.origin}/api/hdw/share/${inner.token.trim()}`;
  }
  return '';
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
  const [activeTab, setActiveTab] = useState<ShareTab>(
    canPublishToCommunity ? 'community' : canShareFile ? 'file' : 'link',
  );

  // Community publish state
  const [communityTitle, setCommunityTitle] = useState(projectName);
  const [communityDesc, setCommunityDesc] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<CommunityPublishResult | null>(null);

  // Share link state
  const [shareLink, setShareLink] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);
  const [sharingToTeam, setSharingToTeam] = useState(false);
 const [linkError, setLinkError] = useState<string | null>(null);
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
    setLinkLoading(true);
    setLinkError(null);
    const params = new URLSearchParams();
    params.set('project_id', projectId);
    if (workspaceId) params.set('workspace_id', workspaceId);
    fetch(`/api/hdw/api/share-link?${params}`, {
      headers: workspaceContext ? workspaceProjectHeaders(workspaceContext) : {},
    })
      .then(async (resp) => {
        if (cancelled) return;
        // 404 = no share link yet; leave shareLink empty so the UI shows
        // the "generate" affordance.
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        if (cancelled) return;
        const url = extractShareUrl(data);
        if (url) setShareLink(url);
      })
      .catch(() => {
        // Network/parse failure — leave empty; user can still generate.
      })
      .finally(() => {
        if (!cancelled) setLinkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, projectId, workspaceId, workspaceContext]);

  const canPublish = useMemo(
    () => communityTitle.trim().length > 0 && !publishing && !publishResult,
    [communityTitle, publishing, publishResult],
  );

  async function handlePublish() {
    if (!canPublishToCommunity || !canPublish) return;
    setPublishing(true);
    setPublishError(null);
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
    } catch (err) {
      setPublishError(userFacingError(err, t, 'feedback.publishFailed', t('feedback.objectProject')));
    } finally {
      setPublishing(false);
    }
  }

  async function handleCopyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
   } catch {
     // ignore
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
       setShareError(t('sharedSpace.shareFailed'));
       return;
     }
      setShareSuccess(true);
      onShared?.();
      setTimeout(() => onClose(), 800);
   } catch {
     setShareError(t('sharedSpace.shareFailed'));
   } finally {
     setShareSubmitting(false);
   }
 }

 async function handleGenerateLink() {
   if (!canGenerateLink) return;
   setLinkError(null);
   setLinkGenerating(true);
   setSharingToTeam(false);
   try {
      // Generating a link is a sharing operation, not a workspace transfer.
      // In particular, another team member's read-only local mirror may not
      // have a workspace-scope record at all. Never silently promote/move
      // a project to a different visibility or workspace here; HDW verifies
      // that this exact project already belongs to the requested workspace.
     const resp = await fetch('/api/hdw/api/share-link/generate', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         ...(workspaceContext ? workspaceProjectHeaders(workspaceContext) : {}),
       },
       body: JSON.stringify({
         project_id: projectId,
         ...(workspaceId ? { workspace_id: workspaceId } : {}),
       }),
     });
     const data = await resp.json();
     if (!resp.ok) {
       throw Object.assign(new Error(data?.message || data?.msg || `HTTP ${resp.status}`), { code: data?.error?.code ?? data?.error });
     }
     const url = extractShareUrl(data);
     if (url) {
       setShareLink(url);
     } else {
       setLinkError(t('share.noLink'));
     }
   } catch (err) {
     setLinkError(userFacingError(err, t, 'feedback.linkFailed', t('feedback.objectProject')));
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
        ? linkGenerating || sharingToTeam
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
                {publishError && <p className={styles.error}>{publishError}</p>}
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
           {shareSuccess && <p className={styles.successHint}>{t('sharedSpace.shareSuccess')}</p>}
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
           {linkError && <p className={styles.error}>{linkError}</p>}
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
           {!shareLink && !linkLoading && !linkGenerating && !sharingToTeam && !linkError && (
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
