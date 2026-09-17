// Local "New team" creation form — calls the HDW create-team API.
//
// Replaces the old `teamConsoleUrl('create-team')` external link with an
// in-client modal so the user can create a team workspace without leaving
// the app. The form collects name, description, and invitees, then POSTs
// to the HDW backend via the daemon proxy at `/api/hdw/api/team/add`.
// The HDW API expects `workspace_name`, `owner_username`, `owner_displayname`,
// `owner_email`, and `members[]` (each `{ username, displayname, email }`).

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { modalOverlay, modalContent } from '../motion';
import { useT } from '../i18n';
import { getStoredUsername, getStoredUserInfo } from '../auth/auth';
import { Icon } from './Icon';
import { PersonPicker, type Person } from './PersonPicker';
import styles from './NewTeamModal.module.css';

export interface NewTeamFormValue {
  name: string;
  description: string;
  members: Person[];
}

export interface NewTeamCreatedResult {
  workspace_id: string;
  workspace_name: string;
  workspace_member_id: string;
  member_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after the team is successfully created on the HDW backend. */
  onCreated?: (result: NewTeamCreatedResult) => void;
}

export function NewTeamModal({ open, onClose, onCreated }: Props) {
  return (
    <AnimatePresence>
      {open ? <NewTeamModalBody onClose={onClose} onCreated={onCreated} /> : null}
    </AnimatePresence>
  );
}

function NewTeamModalBody({
  onClose,
  onCreated,
}: Omit<Props, 'open'>) {
  const t = useT();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  // Focus the name input on mount; lock body scroll; close on Esc.
  useEffect(() => {
    nameRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const ownerUsername = getStoredUsername();
    if (!ownerUsername) {
      setError(t('newTeam.createError'));
      return;
    }

    const userInfo = getStoredUserInfo();
    const ownerDisplayname = userInfo?.displayName || undefined;
    const ownerEmail = userInfo?.email || undefined;

    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch('/api/hdw/api/team/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_name: trimmedName,
          owner_username: ownerUsername,
          owner_displayname: ownerDisplayname,
          owner_email: ownerEmail,
          members: members
            .filter((p) => p.name !== ownerDisplayname)
            .map((p) => ({
              username: p.email ? p.email.split('@')[0] : p.name,
              displayname: p.name,
              email: p.email || null,
            })),
        }),
      });

      const data = await resp.json().catch(() => null);

      if (!resp.ok || data?.code !== 0) {
        const msg = data?.error || data?.msg || `HTTP ${resp.status}`;
        setError(msg);
        return;
      }

      setName('');
      setDescription('');
      setMembers([]);
      onCreated?.(data?.data ?? {});
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      className={styles.backdrop}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <motion.div
        className={styles.modal}
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-team-title"
      >
        <header className={styles.head}>
          <div className={styles.headLeft}>
            <Icon name="users" size={18} />
            <h2 id="new-team-title" className={styles.title}>
              {t('newTeam.title')}
            </h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={submitting}
            aria-label={t('newTeam.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>
              {t('newTeam.nameLabel')}
              <span className={styles.required}>*</span>
            </span>
            <input
              ref={nameRef}
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newTeam.namePlaceholder')}
              maxLength={64}
              autoComplete="off"
              disabled={submitting}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('newTeam.descriptionLabel')}</span>
            <textarea
              className={styles.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('newTeam.descriptionPlaceholder')}
              maxLength={280}
              rows={3}
              disabled={submitting}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>{t('newTeam.inviteLabel')}</span>
            <PersonPicker
              selected={members}
              onChange={setMembers}
              multiple
            />
            <p className={styles.hint}>{t('newTeam.inviteHint')}</p>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.foot}>
            <span className={styles.ownerHint}>{t('newTeam.ownerHint')}</span>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={submitting}>
                {t('newTeam.cancel')}
              </button>
              <button type="submit" className={styles.submit} disabled={!canSubmit}>
                {submitting ? t('newTeam.creating') : t('newTeam.create')}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
