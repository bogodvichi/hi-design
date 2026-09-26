// Template detail inspector — mirrors PluginDetailsModal but for
// IUX template records (gallery cards with `files`).
//
// Shows a sandboxed iframe preview of the template's home file
// alongside a lightweight info sidebar (name, id, source project,
// creation time, file list). Intentionally omits "example query"
// and "developer details" sections that exist in plugin detail
// surfaces — those are plugin-specific concepts that do not apply
// to templates.

import { useCallback, useEffect, useState } from 'react';
import { PreviewModal } from './PreviewModal';
import { Icon } from './Icon';
import { AI_BUILDER_WEB_PREX } from './workspace-context';
import { useAuth } from '../auth/LoginGate';

export interface TemplateFile {
  name: string;
  home: boolean;
  path: string;
}

export interface TemplateRecord {
  id: string;
  time: string;
  name: string;
  files: TemplateFile[];
  sourceProjectId: string;
  createdAt: string;
}

interface Props {
  record: TemplateRecord | any;
  onClose: () => void;
  onUse: () => Promise<void>;
  onCancelShare?: () => Promise<void>;
}

export function TemplateDetailsModal({ record, onClose, onUse, onCancelShare }: Props) {
  const { username: currentUsername } = useAuth();
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [cancelToast, setCancelToast] = useState<string | null>(null);
  const [cancelToastTone, setCancelToastTone] = useState<'success' | 'error'>('success');

  const homeFile = record.files.find((f: any) => f.home) ?? record.files[0];
  const fileCount = record.files.length;

  const load = useCallback(async () => {
    if (!homeFile) {
      setHtml(undefined);
      return;
    }
    setHtml(null);
    setError(null);
    try {
      const url = AI_BUILDER_WEB_PREX + homeFile.path;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load preview: ${res.status}`);
      }
      const text = await res.text();
      setHtml(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
      setHtml(undefined);
    }
  }, [homeFile]);

  useEffect(() => {
    void load();
  }, [load]);

  const onView = useCallback(() => {
    void load();
  }, [load]);

  async function handleCancelShare() {
    if (!onCancelShare) return;
    setIsCanceling(true);
    try {
      await onCancelShare();
      setCancelToast('取消分享成功!');
      setCancelToastTone('success');
    } catch (err) {
      console.warn('[TemplateDetailsModal] cancel share failed:', err);
      setCancelToast('取消分享失败!');
      setCancelToastTone('error');
    } finally {
      setIsCanceling(false);
    }
  }

  const isOwner = record.username && currentUsername && record.username === currentUsername;

  // Sidebar — template metadata + file list only.
  // No "example query" or "developer details" — those are plugin-only.
  const sidebarContent = (
    <div className="plugin-meta-sections is-compact" 
      style={{padding:"22px 28px 28px 32px"}}
      >
      <section className="plugin-details-modal__section">
        <div className="plugin-details-modal__section-head">
          <h3 className="plugin-details-modal__section-title">Info</h3>
        </div>
        <div className="plugin-details-modal__section-body">
          <dl className="plugin-details-modal__source">
            <div>
              <dt>Name</dt>
              <dd>{record.name}</dd>
            </div>
            {/* <div>
              <dt>ID</dt>
              <dd>
                <code>{record.id}</code>
              </dd>
            </div>
            <div>
              <dt>Source Project</dt>
              <dd>
                <code>{record.sourceProjectId}</code>
              </dd>
            </div> */}
            <div>
              <dt>Created</dt>
              <dd>{record.time}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="plugin-details-modal__section"
        >
        <div className="plugin-details-modal__section-head">
          <h3 className="plugin-details-modal__section-title">Files</h3>
        </div>
        <div className="plugin-details-modal__section-body">
          <div className="plugin-details-modal__chips">
            {record.files.map((file: any) => (
              <span
                key={file.path}
                className={`plugin-details-modal__chip${file.home ? ' is-home' : ''}`}
              >
                <Icon name="file" size={12} />
                {file.name}
                {/* {file.home ? (
                  <span className="plugin-details-modal__badge">Home</span>
                ) : null} */}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
  return (
    <PreviewModal
      title={record.name}
      views={[
        {
          id: 'preview',
          label: 'Preview',
          html,
          error,
        },
      ]}
      onView={onView}
      exportTitleFor={() => record.name}
      onClose={onClose}
      sidebar={{
        label: 'Info',
        defaultOpen: true,
        contentKey: record.id,
        content: sidebarContent,
      }}
      primaryAction={
        {
          label: isLoading ? '正在创建...' : '立刻使用',
          disabled: isLoading || isCanceling,
          onClick: async () => {
            if (isLoading) return;
            setIsLoading(true);
            try {
              await onUse?.();
            } finally {
              setIsLoading(false);
            }
          },
          testId: `template-details-use-${record.id}`,
          menu: isOwner && onCancelShare
            ? [
                {
                  label: '取消分享',
                  onClick: async () => {
                    if (isCanceling) return;
                    setIsCanceling(true);
                    try {
                      await onCancelShare();
                      setCancelToast('取消分享成功!');
                      setCancelToastTone('success');
                    } catch (err) {
                      console.warn('[TemplateDetailsModal] cancel share failed:', err);
                      setCancelToast('取消分享失败!');
                      setCancelToastTone('error');
                    } finally {
                      setIsCanceling(false);
                    }
                  },
                },
              ]
            : undefined,
        }
      }
    />
  );
}
