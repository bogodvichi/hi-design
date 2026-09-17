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
import { fetchProjectDeployments } from '../providers/registry';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import type { WebDeploymentInfo } from '../providers/registry';
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
  workspaceContext: WorkspaceCollabContext | null;
  onClose: () => void;
}

function shareUrlForDeployment(deployment: WebDeploymentInfo): string {
  return deployment.url?.trim() || '';
}

function pickLatestShareUrl(deployments: WebDeploymentInfo[]): string {
  const valid = deployments.filter(
    (d) => shareUrlForDeployment(d) && d.status !== 'failed',
  );
  if (valid.length === 0) return '';
  valid.sort((a, b) => b.createdAt - a.createdAt);
  const latest = valid[0];
  return latest ? shareUrlForDeployment(latest) : '';
}

export function UnifiedShareDialog({
  projectId,
  projectName,
  workspaceContext,
  onClose,
}: UnifiedShareDialogProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<ShareTab>('community');

  // Community publish state
  const [communityTitle, setCommunityTitle] = useState(projectName);
  const [communityDesc, setCommunityDesc] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<CommunityPublishResult | null>(null);

  // Share link state
  const [shareLink, setShareLink] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch share link when the link tab is activated
  useEffect(() => {
    if (activeTab !== 'link') return;
    let cancelled = false;
    setLinkLoading(true);
    setLinkError(null);
    fetchProjectDeployments(projectId, workspaceContext)
      .then((deployments) => {
        if (cancelled) return;
        const url = pickLatestShareUrl(deployments);
        if (url) {
          setShareLink(url);
        } else {
          setLinkError(t('share.noLink'));
        }
      })
      .catch(() => {
        if (!cancelled) setLinkError(t('share.noLink'));
      })
      .finally(() => {
        if (!cancelled) setLinkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, projectId, workspaceContext, t]);

  const canPublish = useMemo(
    () => communityTitle.trim().length > 0 && !publishing && !publishResult,
    [communityTitle, publishing, publishResult],
  );

  async function handlePublish() {
    if (!canPublish) return;
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
          }),
        },
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      setPublishResult(data as CommunityPublishResult);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
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

  const tabs: { id: ShareTab; label: string; icon: string }[] = [
    { id: 'community', label: t('share.tabCommunity'), icon: 'global-line' },
    { id: 'file', label: t('share.tabFile'), icon: 'group-line' },
    { id: 'link', label: t('share.tabLink'), icon: 'link' },
  ];

  const footerActionLabel =
    activeTab === 'community'
      ? publishResult
        ? t('share.confirm')
        : publishing
          ? t('share.publishing')
          : t('share.publish')
      : t('share.close');

  const footerActionDisabled =
    activeTab === 'community' ? !canPublish : false;

  function handleFooterAction() {
    if (activeTab === 'community' && !publishResult) {
      void handlePublish();
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
                  {t('share.publishSuccessHint', { name: publishResult.name })}
                </p>
                <a
                  href={publishResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
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
          <div className={styles.placeholder}>
            {t('share.fileTabPlaceholder')}
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
            {linkError && <p className={styles.error}>{linkError}</p>}
            {shareLink && !linkLoading && (
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
            {!shareLink && !linkLoading && !linkError && (
              <p className={styles.linkHint}>{t('share.generateLinkHint')}</p>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter className={styles.footer}>
        <Button onClick={onClose} className={styles.footerSecondary}>
          {t('share.close')}
        </Button>
        <Button
          onClick={handleFooterAction}
          disabled={footerActionDisabled}
          className={styles.footerAction}
        >
          {footerActionLabel}
        </Button>
      </DialogFooter>
    </Dialog>,
    document.body,
  );
}
