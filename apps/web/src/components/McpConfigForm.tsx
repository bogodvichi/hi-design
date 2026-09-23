import { useEffect, useState, type MutableRefObject } from 'react';
import { Icon } from './Icon';
import { useI18n, useT } from '../i18n';
import type { Dict } from '../i18n/types';
import {
  MCP_LOGO_KEYS,
  MCP_LOGO_LABELS,
  McpLogo,
  type McpLogoKey,
} from './McpLogo';
import styles from './McpConfigForm.module.css';

export type McpType = 'custom' | 'fetch' | 'time' | 'memory' | 'sequential-thinking' | 'context7';

export interface McpConfigSelection {
  label: string;
  description: string;
  config: string;
  logoKey?: McpLogoKey;
}

interface PresetDef {
 id: McpType;
  labelKey: keyof Dict;
  config: string;
}

function json(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

const PLACEHOLDER_CONFIG = json({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] });

const PRESETS: PresetDef[] = [
  { id: 'custom', labelKey: 'publishDialog.mcpTypeCustom', config: '' },
  {
    id: 'fetch',
    labelKey: 'publishDialog.mcpTypeFetch',
    config: json({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] }),
  },
  {
    id: 'time',
    labelKey: 'publishDialog.mcpTypeTime',
    config: json({ type: 'stdio', command: 'uvx', args: ['mcp-server-time'] }),
  },
  {
    id: 'memory',
    labelKey: 'publishDialog.mcpTypeMemory',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }),
  },
  {
    id: 'sequential-thinking',
    labelKey: 'publishDialog.mcpTypeSequentialThinking',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }),
  },
  {
    id: 'context7',
    labelKey: 'publishDialog.mcpTypeContext7',
    config: json({ type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }),
  },
];

function validateMcpConfig(
  text: string,
  t: ReturnType<typeof useT>,
): string | null {
  if (!text.trim()) return null;
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return t('personalScope.mcpFormJsonInvalid');
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return t('personalScope.mcpFormJsonInvalid');
  }

  const rawType = typeof parsed.type === 'string' ? parsed.type : 'stdio';
  if (rawType === 'http' || rawType === 'sse') {
    if (typeof parsed.url !== 'string' || !parsed.url.trim()) {
      return t('personalScope.mcpFormUrlRequired');
    }
    return null;
  }

  if (typeof parsed.command !== 'string' || !parsed.command.trim()) {
    return t('personalScope.mcpFormCommandRequired');
  }
  return null;
}

export function McpConfigForm({
  confirmRef,
  onSubmit,
  onCanConfirmChange,
  showLogoPicker = false,
}: {
  confirmRef: MutableRefObject<{ canConfirm: boolean; onConfirm: () => void }>;
  onSubmit: (selection: McpConfigSelection) => void;
  onCanConfirmChange?: (canConfirm: boolean) => void;
  showLogoPicker?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [type, setType] = useState<McpType>('custom');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState('');
  const [logoKey, setLogoKey] = useState<McpLogoKey>('orbit');

  const configError = validateMcpConfig(config, t);
  const configValid = config.trim().length > 0 && configError === null;
  const canConfirm = label.trim().length > 0 && configValid;

  useEffect(() => { onCanConfirmChange?.(canConfirm); }, [canConfirm, onCanConfirmChange]);

  function applyPreset(preset: PresetDef) {
    setType(preset.id);
    if (preset.id === 'custom') return;
    setLabel(preset.id);
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
        description: description.trim(),
        config,
        ...(showLogoPicker ? { logoKey } : {}),
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

      {showLogoPicker ? (
        <fieldset className={styles.logoPicker}>
          <legend className={styles.typePickerLegend}>
            {locale.startsWith('zh') ? '默认 Logo' : 'Default logo'}
          </legend>
          <div className={styles.logoPickerGrid}>
            {MCP_LOGO_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={locale.startsWith('zh') ? MCP_LOGO_LABELS[key].zh : MCP_LOGO_LABELS[key].en}
                aria-pressed={logoKey === key}
                className={logoKey === key ? `${styles.logoBtn} ${styles.logoBtnActive}` : styles.logoBtn}
                onClick={() => setLogoKey(key)}
              >
                <McpLogo logoKey={key} size={36} />
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className={styles.field}>
          <span className={styles.fieldLabel}>{locale.startsWith('zh') ? 'MCP 名称' : 'MCP name'}</span>
        <input
          className={styles.fieldInput}
          required
          placeholder={locale.startsWith('zh') ? '例如：网页内容抓取' : 'e.g. Web content fetcher'}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label={locale.startsWith('zh') ? 'MCP 名称' : 'MCP name'}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{locale.startsWith('zh') ? '简介' : 'Description'}</span>
        <input
          className={styles.fieldInput}
          placeholder={locale.startsWith('zh') ? '介绍 MCP 的用途与适用场景（选填）' : 'Describe what this MCP is useful for (optional)'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
        {config.trim() && configError ? (
          <p className={styles.validationError} role="alert">{configError}</p>
        ) : null}
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
