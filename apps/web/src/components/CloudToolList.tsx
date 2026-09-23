import { PageEmptyState } from './PageEmptyState';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { Icon } from './Icon';
import { useI18n, useT } from '../i18n';
import { activateWorkspaceResource, openWorkspaceTab } from './WorkspaceTabsBar';
import { AI_RESEARCH_RESOURCE_KEY } from './AiResearchWorkspaceFrame';
import styles from './CloudSkillList.module.css';
import { CommunityResourceStats } from './CommunityResourceStats';
import { communityTextMatchesQuery } from '../utils/community-search';
import { recordCommunityStat } from '../utils/community-stats';

interface CloudToolItem {
  resourceId: string;
  ownerMemberId: string;
  url: string;
  name: string;
  label: string;
  description: string;
  scope?: string;
  createdAt: string;
  updatedAt: string;
  publisherName?: string | null;
  peopleCount?: number | null;
  actionCount?: number | null;
}

const HIMIND_DESCRIPTION = '汇聚产品知识与设计经验，支持智能检索、图文问答与来源追溯。';
const AI_RESEARCH_TITLE = 'AI用研工作台';
const AI_RESEARCH_DESCRIPTION = '提供AI可用性测试、真人可用性测试、AI启发式评估、体验度量等功能。';
const AI_RESEARCH_URL = 'https://drw.hikvision.com/';
const HIMIND_COMMUNITY_TOOL: CloudToolItem = {
  resourceId: 'himind-tool',
  ownerMemberId: '',
  url: 'http://himind.hikvision.com/login',
  name: 'HiMind',
  label: 'HiMind',
  description: HIMIND_DESCRIPTION,
  scope: 'public',
  createdAt: '',
  updatedAt: '',
  publisherName: 'HiDesign',
};
const AI_RESEARCH_COMMUNITY_TOOL: CloudToolItem = {
  resourceId: 'ai-research-workbench-tool',
  ownerMemberId: '',
  url: AI_RESEARCH_URL,
  name: AI_RESEARCH_TITLE,
  label: AI_RESEARCH_TITLE,
  description: AI_RESEARCH_DESCRIPTION,
  scope: 'public',
  createdAt: '',
  updatedAt: '',
  publisherName: 'HiDesign',
};

function isHiMindTool(tool: CloudToolItem): boolean {
  const title = (tool.name || tool.label).trim().toLowerCase();
  return tool.resourceId === 'himind-tool' || title === 'himind';
}

function isAiResearchTool(tool: CloudToolItem): boolean {
  if (tool.resourceId === 'ai-research-workbench-tool') return true;
  return [tool.name, tool.label]
    .map((title) => title.trim())
    .some((title) => title === '海康威视' || title === AI_RESEARCH_TITLE);
}

function withOfficialCommunityTools(tools: CloudToolItem[]): CloudToolItem[] {
  const merged = [...tools];
  if (!merged.some(isHiMindTool)) merged.push(HIMIND_COMMUNITY_TOOL);
  if (!merged.some(isAiResearchTool)) merged.push(AI_RESEARCH_COMMUNITY_TOOL);
  return merged;
}

function workspaceHeaders(
  workspaceId: string | null,
  workspaceMemberId: string | null,
  workspaceType: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (workspaceId) headers['x-od-workspace-id'] = workspaceId;
  if (workspaceMemberId) headers['x-od-workspace-member-id'] = workspaceMemberId;
  if (workspaceType) headers['x-od-workspace-type'] = workspaceType;
  return headers;
}

function formatRelativeDate(
  iso: string,
  t: (key: any, vars?: Record<string, string | number>) => string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return t('personalScope.cloudSkillUpdatedToday' as any);
  if (days === 1) return t('personalScope.cloudSkillUpdatedYesterday' as any);
  return t('personalScope.cloudSkillUpdatedDaysAgo' as any, { n: days });
}

export function CloudToolList({
  workspaceId,
  workspaceMemberId,
  workspaceType,
  ownerMemberId,
  mode = 'personal',
  scope,
  searchQuery = '',
}: {
  workspaceId: string | null;
  workspaceMemberId: string | null;
  workspaceType: string | null;
  ownerMemberId?: string | null;
  mode?: 'personal' | 'shared' | 'square';
  scope?: string;
  searchQuery?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const titleId = useId();
  const [tools, setTools] = useState<CloudToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CloudToolItem | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const includesOfficialCommunityTools = mode === 'square' && scope === 'public';

  useEffect(() => {
    if (!menuOpenId) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node
        && (menuRef.current?.contains(event.target) || menuTriggerRef.current?.contains(event.target))) {
        return;
      }
      setMenuOpenId(null);
    };
    document.addEventListener('pointerdown', closeOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', closeOutside, { capture: true });
  }, [menuOpenId]);

  const loadTools = useCallback(async () => {
    if (!workspaceId) {
      setTools(includesOfficialCommunityTools ? withOfficialCommunityTools([]) : []);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const ownerFilter =
        ownerMemberId ?? (mode === 'personal' ? workspaceMemberId : null);
      if (ownerFilter) params.set('owner_member_id', ownerFilter);
      if (scope) params.set('scope', scope);
      const headers = workspaceHeaders(workspaceId, workspaceMemberId, workspaceType);
      const res = await fetch('/api/workspace/tool/cloud?' + params, {
        cache: 'no-store',
        headers,
      });
      if (!res.ok) throw new Error('Failed to load cloud tools');
      const body = await res.json();
      const loadedTools = body.tools ?? [];
      setTools(includesOfficialCommunityTools
        ? withOfficialCommunityTools(loadedTools)
        : loadedTools);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      if (includesOfficialCommunityTools) setTools(withOfficialCommunityTools([]));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workspaceMemberId, workspaceType, mode, scope, ownerMemberId, includesOfficialCommunityTools]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    const handler = () => { void loadTools(); };
    window.addEventListener('personal:tool-refresh', handler);
    return () => window.removeEventListener('personal:tool-refresh', handler);
  }, [loadTools]);

  async function handleDelete(tool: CloudToolItem) {
    setDeletingId(tool.resourceId);
    try {
      const res = await fetch(
        '/api/workspace/tool/cloud/' + encodeURIComponent(tool.resourceId),
        {
          method: 'DELETE',
          headers: workspaceHeaders(workspaceId, workspaceMemberId, workspaceType),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Delete failed');
      }
      await loadTools();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
      setMenuOpenId(null);
    }
  }

  async function handleOpenTool(tool: CloudToolItem) {
    const title = isAiResearchTool(tool) ? AI_RESEARCH_TITLE : tool.name || tool.label;
    const isHiMind = isHiMindTool(tool);
    const isAiResearch = isAiResearchTool(tool);
    const url = isAiResearch ? AI_RESEARCH_URL : tool.url;
    const recordUse = async () => {
      if (!(mode === 'square' && scope === 'public' && !ownerMemberId)) return;
      const stats = await recordCommunityStat({
        resourceType: 'tool',
        resourceId: tool.resourceId,
        metric: 'action',
        workspaceId,
        workspaceMemberId,
        workspaceType,
      });
      if (stats) {
        setTools((current) => current.map((item) => (
          item.resourceId === tool.resourceId
            ? { ...item, peopleCount: stats.actionUserCount, actionCount: stats.actionCount }
            : item
        )));
      }
    };
    if (!isHiMind && !isAiResearch) {
      openWorkspaceTab({ kind: 'external', url, title });
      await recordUse();
      return;
    }
    const resourceKey = isHiMind ? 'himind' : AI_RESEARCH_RESOURCE_KEY;
    const launchEndpoint = isHiMind
      ? '/api/auth/himind/launch'
      : '/api/auth/ai-research/launch';
    const activatedExistingHiMind = isHiMind && activateWorkspaceResource(resourceKey);
    if (openingId) return;
    if (isHiMind && !activatedExistingHiMind) {
      openWorkspaceTab({
        kind: 'external',
        url,
        resourceKey,
        title,
      });
    }
    setOpeningId(tool.resourceId);
    setError(null);
    try {
      const res = await fetch(launchEndpoint, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.launchUrl !== 'string') {
        throw new Error(
          body?.error?.message
          ?? (isHiMind ? 'HiMind login failed' : 'AI research login failed'),
        );
      }
      openWorkspaceTab({
        kind: 'external',
        url,
        bootstrapUrl: body.launchUrl,
        resourceKey,
        title,
      });
      await recordUse();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setOpeningId(null);
    }
  }

  const visibleTools = searchQuery.trim()
    ? tools.filter((tool) => {
        const isHiMind = isHiMindTool(tool);
        const isAiResearch = isAiResearchTool(tool);
        const title = isAiResearch ? AI_RESEARCH_TITLE : tool.name || tool.label || tool.url;
        const description = isHiMind
          ? HIMIND_DESCRIPTION
          : isAiResearch
            ? AI_RESEARCH_DESCRIPTION
            : tool.description;
        return communityTextMatchesQuery([
          title,
          tool.name,
          tool.label,
          description,
          tool.url,
          tool.publisherName,
        ], searchQuery);
      })
    : tools;

  if (loading) {
    return <div className={styles.cloudSkillLoading}>{t('personalScope.cloudToolLoading' as any)}</div>;
  }

  if (error && tools.length === 0) {
    return (
      <div className={styles.cloudSkillEmpty}>
        <span>{error}</span>
      </div>
    );
  }

  if (visibleTools.length === 0) {
    return <PageEmptyState />;
  }

  const dialog = confirmDelete ? (
    <Dialog
      className="modal-confirm"
      role="alertdialog"
      onClose={() => setConfirmDelete(null)}
      closeOnEscape
      ariaLabelledBy={titleId}
    >
      <DialogTitle id={titleId}>
        {t('personalScope.cloudToolDeleteConfirmTitle' as any)}
      </DialogTitle>
      <DialogDescription>
        {t('personalScope.cloudToolDeleteConfirmDesc' as any)}
      </DialogDescription>
      <DialogFooter className="row">
        <button
          type="button"
          onClick={() => setConfirmDelete(null)}
          disabled={!!deletingId}
        >
          {t('common.cancel' as any)}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!deletingId}
          onClick={() => void handleDelete(confirmDelete)}
        >
          {deletingId ? <Icon name="spinner" size={14} /> : null}
          {t('personalScope.cloudToolDelete' as any)}
        </button>
      </DialogFooter>
    </Dialog>
  ) : null;

  return (
    <>
      {error ? (
        <div className={styles.cloudSkillError} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.cloudSkillGrid}>
        {visibleTools.map((tool) => {
          const isDeleting = deletingId === tool.resourceId;
          const canDelete = mode === 'personal';
          const isHiMind = isHiMindTool(tool);
          const isAiResearch = isAiResearchTool(tool);
          const title = isAiResearch ? AI_RESEARCH_TITLE : tool.name || tool.label || tool.url;
          const description = isHiMind
            ? HIMIND_DESCRIPTION
            : isAiResearch
              ? AI_RESEARCH_DESCRIPTION
              : tool.description;
          return (
            <article
              key={tool.resourceId}
              className={`${styles.teamAssetCard}${isHiMind ? ` ${styles.himindCard}` : ''}${isAiResearch ? ` ${styles.aiResearchCard}` : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => void handleOpenTool(tool)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleOpenTool(tool);
                }
              }}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon} aria-hidden>
                  {isHiMind ? (
                    <img
                      className={styles.himindIcon}
                      src="/himind/himind-icon.svg"
                      alt=""
                    />
                  ) : isAiResearch ? (
                    <img
                      className={styles.aiResearchIcon}
                      src="/ai-research-workbench/logo.svg"
                      alt=""
                    />
                  ) : (
                    <img
                      className={styles.cardCover}
                      src="/community/default-tool-logo.svg"
                      alt=""
                    />
                  )}
                </span>
                <div className={styles.cardHeaderInfo}>
                  <strong className={styles.cardTitle}>{title}</strong>
                  {mode === 'square' ? (
                    <small className={`${styles.cardMeta} ${styles.cardAuthorLine}`}>
                      {tool.publisherName?.trim() || (locale.startsWith('zh') ? 'HiDesign 官方' : 'HiDesign Official')}
                      {tool.updatedAt ? ' · ' + formatRelativeDate(tool.updatedAt, t) : ''}
                    </small>
                  ) : (
                    <small className={styles.cardMeta}>
                      {t('personalScope.cloudSkillSource' as any)}
                      {tool.updatedAt ? ' · ' + formatRelativeDate(tool.updatedAt, t) : ''}
                    </small>
                  )}
                </div>
                {canDelete ? (
                  <>
                    <button
                      type="button"
                      className={styles.cardMenuBtn}
                      ref={menuOpenId === tool.resourceId ? menuTriggerRef : undefined}
                      title=""
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === tool.resourceId ? null : tool.resourceId);
                      }}
                    >
                      <Icon name="more-horizontal" size={16} />
                    </button>
                    {menuOpenId === tool.resourceId ? (
                        <div className={styles.cardMenu} ref={menuRef}>
                          <button
                            type="button"
                            className={styles.cardMenuItemDanger}
                            disabled={isDeleting}
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(tool); }}
                          >
                            <Icon name="trash" size={14} />
                            {t('personalScope.cloudToolDelete' as any)}
                          </button>
                        </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              {description
                ? <p className={`${styles.cardDesc}${mode === 'square' ? ` ${styles.squareCardDesc}` : ''}`}>{description}</p>
                : null}
              <footer className={mode === 'shared' ? undefined : `community-template-card__foot ${styles.resourceCardFooter}`}>
              {mode === 'square' ? (
                <CommunityResourceStats
                  primaryCount={tool.peopleCount}
                  secondaryCount={tool.actionCount}
                  primaryIcon="users"
                  secondaryIcon="external-link"
                  primaryLabel={locale.startsWith('zh') ? '使用人数' : 'Users'}
                  secondaryLabel={locale.startsWith('zh') ? '使用次数' : 'Uses'}
                />
              ) : null}
              <button
                type="button"
                className={mode === 'shared' ? styles.capabilityAdd : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenTool(tool);
                }}
              >
                <Icon name="external-link" size={14} />
                {t('personalScope.cloudToolOpen' as any)}
              </button>
              </footer>
            </article>
          );
        })}
      </div>
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : dialog}
    </>
  );
}
