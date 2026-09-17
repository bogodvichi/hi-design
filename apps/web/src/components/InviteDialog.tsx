// Reusable "invite teammates" dialog for the team workspace.
//
// Each row pairs a single-select PersonPicker with its own role dropdown
// (admin/member). When a person is picked we check for cross-row duplicates
// ("已添加") and call the HDW checkMember endpoint to see if they're already
// on the team ("已是团队成员"). On "确认并邀请" all valid rows are POSTed
// to the HDW invite API.

import { useEffect, useRef, useState } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { getStoredUsername } from '../auth/auth';
import { getTeamMemberId } from '../utils/deterministicId';
import { Icon } from './Icon';
import { PersonPicker, type Person } from './PersonPicker';
import { useI18n } from '../i18n';

const ROLE_OPTIONS = ['admin', 'member', 'guest'] as const;

function roleLabel(role: string, t: ReturnType<typeof useI18n>['t']) {
  if (role === 'admin') return t('invite.role.admin');
  if (role === 'guest') return t('invite.role.guest');
  return t('invite.role.member');
}

const DEFAULT_ROLE = 'member';

/** Extract the username (email prefix before @) from a person's email. */
function emailToUsername(email?: string): string {
  return email?.split('@')[0]?.trim() || '';
}

interface InviteRow {
  id: string;
  person: Person | null;
  role: string;
  status: 'idle' | 'checking' | 'ok' | 'duplicate' | 'existing';
  statusMsg: string | null;
}

function makeRow(): InviteRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    person: null,
    role: DEFAULT_ROLE,
    status: 'idle',
    statusMsg: null,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceContext: WorkspaceCollabContext | null;
  /** Team ID from the route — takes priority over workspaceContext.workspaceId. */
  teamId?: string;
  /** Team name resolved from the route's teamId via the workspace directory. */
  teamName?: string;
  canAssignRoles?: boolean;
  onSubmit?: () => void;
}

const PERMISSION_TABS = [
  { id: 'admin', label: '管理员', desc: '可以邀请成员、管理成员角色、移除成员；拥有成员的所有权限。' },
  { id: 'member', label: '成员', desc: '可以查看团队项目、发表评论、使用团队 Skills；不能邀请成员、管理成员或修改团队权限。' },
  { id: 'guest', label: '访客', desc: '可以查看团队项目、发表评论；不能邀请成员、管理成员或修改团队权限。' },
] as const;

function PermissionSummary() {
  const [active, setActive] = useState(0);
  const tab = PERMISSION_TABS[active];
  return (
    <div className="entry-invite__perm-summary">
      <div className="entry-invite__perm-tabs" role="tablist">
        {PERMISSION_TABS.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={i === active ? 'entry-invite__perm-tab is-active' : 'entry-invite__perm-tab'}
            onClick={() => setActive(i)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="entry-invite__perm-desc">{tab?.desc}</p>
    </div>
  );
}

export function InviteDialog({
  open,
  onClose,
  workspaceContext,
  teamId,
  teamName,
  canAssignRoles = true,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<InviteRow[]>(() => [makeRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [operatorMemberId, setOperatorMemberId] = useState<string | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows([makeRow()]);
    setSubmitting(false);
    setSuccess(false);
    setError(null);
    setToast(null);
  }, [open]);

  // Derive the current user's member ID for this team deterministically
  // from teamId + username, matching the daemon's getTeamMemberId.
  // No HTTP request needed — same algorithm, same result.
  useEffect(() => {
    const resolvedTeamId = teamId || workspaceContext?.workspaceId;
    if (!open || !resolvedTeamId) { setOperatorMemberId(null); return; }
    let cancelled = false;
    void (async () => {
      const username = getStoredUsername();
      if (!username) { if (!cancelled) setOperatorMemberId(null); return; }
      const id = await getTeamMemberId(resolvedTeamId, username);
      if (!cancelled) setOperatorMemberId(id);
    })();
    return () => { cancelled = true; };
  }, [open, teamId, workspaceContext?.workspaceId]);

  useEffect(() => () => {
    if (autoCloseTimerRef.current === null) return;
    window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = null;
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2500);
  }

  function closeDialog() {
    onClose();
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function updateRow(id: string, patch: Partial<InviteRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handlePersonChange(id: string, people: Person[]) {
    const person = people[0] ?? null;
    if (!person) {
      updateRow(id, { person: null, status: 'idle', statusMsg: null });
      return;
    }
    const dup = rows.some((r) => r.id !== id && r.person?.id === person.id);
    if (dup) {
      showToast(t('workspaceInvite.duplicateMember'));
      updateRow(id, { person: null, status: 'idle', statusMsg: null });
      return;
    }
    const resolvedTeamId = teamId || workspaceContext?.workspaceId;
    updateRow(id, { person, status: 'checking', statusMsg: null });
    try {
      const res = await fetch(
        `/api/hdw/api/team/${resolvedTeamId}/member/check?username=${encodeURIComponent(emailToUsername(person.email))}`,
        { cache: 'no-store' },
      );
      const body = await res.json().catch(() => null);
      if (body?.code === 0 && body?.data?.is_member) {
        showToast(t('workspaceInvite.errorAlreadyMember'));
        updateRow(id, { person: null, status: 'idle', statusMsg: null });
      } else {
        updateRow(id, { status: 'ok', statusMsg: null });
      }
    } catch {
      updateRow(id, { status: 'ok', statusMsg: null });
    }
  }

  async function handleConfirm() {
    const validRows = rows.filter((r) => r.person && r.status === 'ok');
    if (validRows.length === 0 || submitting || success) return;
    const resolvedTeamId = teamId || workspaceContext?.workspaceId;
    if (!resolvedTeamId || !operatorMemberId) {
      setError(t('workspaceInvite.errorNoWorkspace'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/hdw/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: resolvedTeamId,
          operator_member_id: operatorMemberId,
          members: validRows.map((r) => ({
            username: emailToUsername(r.person!.email),
            displayname: r.person!.name,
            email: r.person!.email || null,
            role: canAssignRoles ? r.role : DEFAULT_ROLE,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.code !== 0) {
        showToast(body?.error || body?.msg || t('workspaceInvite.submitFailed'));
        setSubmitting(false);
        return;
      }
      showToast(t('workspaceInvite.sent'));
      window.dispatchEvent(new CustomEvent('hdw:members-updated', { detail: { teamId: resolvedTeamId } }));
      setSuccess(true);
      onSubmit?.();
      autoCloseTimerRef.current = window.setTimeout(() => {
        autoCloseTimerRef.current = null;
        onClose();
        setRows([makeRow()]);
        setSuccess(false);
        setSubmitting(false);
      }, 1000);
    } catch (caught) {
      showToast(t('workspaceInvite.submitFailed'));
      setSubmitting(false);
    }
  }

  const validCount = rows.filter((r) => r.person && r.status === 'ok').length;

  return (
    <div className="entry-invite" role="dialog" aria-modal="true" aria-label={t('workspaceInvite.dialogAria')}>
      <div className="entry-invite__backdrop" onClick={closeDialog} />
      <div className="entry-invite__panel entry-invite__panel--split">
        <button
          type="button"
          className="entry-invite__close"
          onClick={closeDialog}
          aria-label={t('common.close')}
        >
          <Icon name="close" size={16} />
        </button>

        <div className="entry-invite__form">
          <h2 className="entry-invite__title">{t('workspaceInvite.title')}</h2>
          <p className="entry-invite__teamsize">
            受邀成员将获得「{teamName || workspaceContext?.teamName || workspaceContext?.workspaceName || ''}」下项目与 Skills 的访问权限。
          </p>

          <label className="entry-invite__label">{t('workspaceInvite.personLabel')}</label>
          {toast ? (
            <div className="entry-invite__toast" role="alert">
              {toast}
            </div>
          ) : null}
          <div className="entry-invite__rows">
            {rows.map((row) => (
              <div key={row.id} className="entry-invite__row">
                <div className="entry-invite__row-picker">
                  <PersonPicker
                    selected={row.person ? [row.person] : []}
                    onChange={(people) => handlePersonChange(row.id, people)}
                  />
                </div>
                <select
                  className="entry-invite__row-role"
                  value={canAssignRoles ? row.role : DEFAULT_ROLE}
                  onChange={(e) => updateRow(row.id, { role: e.target.value })}
                  disabled={!canAssignRoles}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>{roleLabel(role, t)}</option>
                  ))}
                </select>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    className="entry-invite__row-remove"
                    onClick={() => removeRow(row.id)}
                    aria-label={t('workspaceInvite.removeRow')}
                  >
                    <Icon name="close" size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" className="entry-invite__add-row" onClick={addRow}>
            <Icon name="plus" size={14} />
            <span>{t('workspaceInvite.addMember')}</span>
          </button>

          <PermissionSummary />

          <button
            type="button"
            className="entry-invite__submit"
            onClick={handleConfirm}
            disabled={validCount === 0 || submitting || success}
          >
            {success
              ? t('workspaceInvite.sent')
              : submitting
                ? t('workspaceInvite.sending')
                : t('workspaceInvite.confirm')}
          </button>
        </div>

        <div className="entry-invite__art" aria-hidden>
          <span className="entry-invite__art-glow" />
          <div className="entry-invite__art-cluster">
            <span className="entry-invite__art-avatar">
              <img src="/team-avatars/a2.png" alt="" />
            </span>
            <span className="entry-invite__art-avatar">
              <img src="/team-avatars/a1.png" alt="" />
            </span>
            <span className="entry-invite__art-avatar">
              <img src="/team-avatars/a4.png" alt="" />
            </span>
            <span className="entry-invite__art-avatar">
              <img src="/team-avatars/a6.png" alt="" />
            </span>
            <span className="entry-invite__art-avatar entry-invite__art-avatar--invite">
              <Icon name="plus" size={26} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
