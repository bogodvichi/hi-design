import { useEffect, useState, type MutableRefObject } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import styles from './McpConfigForm.module.css';

export type McpType = 'custom' | 'fetch' | 'time' | 'memory' | 'sequential-thinking' | 'context7';

export interface McpConfigSelection {
  label: string;
  displayName: string;
  config: string;
}

interface PresetDef {
 id: McpType;
  labelKey: keyof Dict;
 displayName: string;
  config: string;
}

function json(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

const PLACEHOLDER_CONFIG = json({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] });

const PRESETS: PresetDef[] = [
  { id: 'custom', labelKey: 'publishDialog.mcpTypeCustom', displayName: '', config: '' },
  {
    id: 'fetch',
    labelKey: 'publishDialog.mcpTypeFetch',
    displayName: '@modelcontextprotocol/server-fetch',
    config: json({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] }),
  },
  {
    id: 'time',
    labelKey: 'publishDialog.mcpTypeTime',
    displayName: '@modelcontextprotocol/server-time',
    config: json({ type: 'stdio', command: 'uvx', args: ['mcp-server-time'] }),
  },
  {
    id: 'memory',
    labelKey: 'publishDialog.mcpTypeMemory',
    displayName: '@modelcontextprotocol/server-memory',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }),
  },
  {
    id: 'sequential-thinking',
    labelKey: 'publishDialog.mcpTypeSequentialThinking',
    displayName: '@modelcontextprotocol/server-sequential-thinking',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }),
  },
  {
    id: 'context7',
    labelKey: 'publishDialog.mcpTypeContext7',
    displayName: '@upstash/context7-mcp',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }),
  },
];

function isValidJson(text: string): boolean {
  if (!text.trim()) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function McpConfigForm({
  confirmRef,
  onSubmit,
  onCanConfirmChange,
}: {
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onSubmit: (selection: McpConfigSelection) => void;
  onCanConfirmChange?: (canConfirm: boolean) => void;
}) {
  const t = useT();
  const [type, setType] = useState<McpType>('custom');
  const [label, setLabel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [config, setConfig] = useState('');

  const configValid = isValidJson(config);
  const canConfirm = label.trim().length > 0 && configValid;

  useEffect(() => { onCanConfirmChange?.(canConfirm); }, [canConfirm, onCanConfirmChange]);

  function applyPreset(preset: PresetDef) {
    setType(preset.id);
    if (preset.id === 'custom') return;
    setLabel(preset.id);
    setDisplayName(preset.displayName);
    setConfig(preset.config);
  }

  function handleFormat() {
    if (!config.trim()) return;
    try {
      const parsed = JSON.parse(config);
      setConfig(JSON.stringify(parsed, null, 2));
    } catch {
      // leave as-is if invalid
    }
  }

  confirmRef.current = {
    canConfirm,
    onConfirm: () => {
      if (!canConfirm) return;
      onSubmit({
        label: label.trim(),
        displayName: displayName.trim(),
        config,
      });
    },
  };

  return (
    <div className={styles.formGrid}>
      <fieldset className={styles.typePicker}>
        <legend className={styles.typePickerLegend}>
          {t('publishDialog.mcpTypeLegend')}
        </legend>
        <div className={styles.typePickerButtons}>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={type === preset.id}
              className={type === preset.id ? `${styles.typeBtn} ${styles.typeBtnActive}` : styles.typeBtn}
              onClick={() => applyPreset(preset)}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('publishDialog.mcpTitle')}</span>
        <input
          className={styles.fieldInput}
          required
          placeholder="my-mcp-server"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label={t('publishDialog.mcpTitle')}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('publishDialog.mcpDisplayName')}</span>
        <input
          className={styles.fieldInput}
          placeholder={t('publishDialog.mcpDisplayNamePlaceholder')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>

      <div className={styles.jsonSection}>
        <label className={styles.field} htmlFor="mcp-json-config">
          <span className={styles.fieldLabel}>{t('publishDialog.mcpJsonConfig')}</span>
        </label>
        <textarea
          id="mcp-json-config"
          className={`${styles.jsonTextarea}${config && !configValid ? ` ${styles.jsonTextareaInvalid}` : ''}`}
          spellCheck={false}
          placeholder={PLACEHOLDER_CONFIG}
          value={config}
          onChange={(e) => setConfig(e.target.value)}
        />
        <div className={styles.jsonActions}>
          <button
            type="button"
            className={styles.formatBtn}
            disabled={!configValid}
            onClick={handleFormat}
          >
            <Icon name="sparkles" size={14} aria-hidden />
            {t('publishDialog.mcpFormat')}
          </button>
        </div>
      </div>
    </div>
  );
}
