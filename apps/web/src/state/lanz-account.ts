import { LANZ_DEFAULT_MODEL, LANZ_OPENAI_BASE_URL, type LanzAccountCredentials } from '@open-design/contracts';
import type { ApiProtocolConfig, AppConfig } from '../types';

export function isLanzBaseUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname === 'lanz.hikvision.com'
      && url.pathname.replace(/\/+$/, '') === '/v3/openai/model';
  } catch {
    return false;
  }
}

/** Remove only automatically linked Lanz credentials when another account signs in. */
export function scopeLanzAccountConfig(config: AppConfig, username: string | null): AppConfig {
  if (!username || !config.lanzAccountUsername
    || config.lanzAccountUsername.toLowerCase() === username.toLowerCase()) return config;
  const clear = (entry: ApiProtocolConfig): ApiProtocolConfig =>
    isLanzBaseUrl(entry.baseUrl) ? { ...entry, apiKey: '' } : entry;
  return {
    ...config,
    ...(isLanzBaseUrl(config.baseUrl) ? { apiKey: '' } : {}),
    apiProtocolConfigs: Object.fromEntries(
      Object.entries(config.apiProtocolConfigs ?? {}).map(([protocol, entry]) => [protocol, clear(entry)]),
    ),
    byokProviderConfigDrafts: Object.fromEntries(
      Object.entries(config.byokProviderConfigDrafts ?? {}).map(([key, draft]) =>
        [key, { ...draft, apiConfig: clear(draft.apiConfig) }]),
    ),
    lanzAccountUsername: undefined,
  };
}

/** Account Key is shared across models. Preserve every existing model selection. */
export function applyLanzAccountConfig(
  original: AppConfig,
  account: LanzAccountCredentials,
): AppConfig {
  const config = scopeLanzAccountConfig(original, account.username);
  const activeLanz = (config.apiProtocol ?? 'openai') === 'openai' && isLanzBaseUrl(config.baseUrl);
  const fill = (entry?: ApiProtocolConfig): ApiProtocolConfig => ({
    ...entry,
    apiKey: account.apiKey,
    baseUrl: entry?.baseUrl || LANZ_OPENAI_BASE_URL,
    model: entry?.model || LANZ_DEFAULT_MODEL,
    apiProviderBaseUrl: LANZ_OPENAI_BASE_URL,
  });
  const saved = config.apiProtocolConfigs?.openai;
  const draftKey = 'openai:' + LANZ_OPENAI_BASE_URL;
  const drafts = Object.fromEntries(
    Object.entries(config.byokProviderConfigDrafts ?? {}).map(([key, draft]) =>
      [key, isLanzBaseUrl(draft.apiConfig.baseUrl)
        ? { ...draft, apiConfig: fill(draft.apiConfig) }
        : draft]),
  );
  const source = drafts[draftKey]?.apiConfig
    ?? (activeLanz ? config : saved && isLanzBaseUrl(saved.baseUrl) ? saved : undefined);
  drafts[draftKey] = { ...drafts[draftKey], apiConfig: fill(source) };
  const active = activeLanz ? fill(config) : null;
  return {
    ...config,
    ...(active ? {
      apiKey: active.apiKey,
      baseUrl: active.baseUrl,
      model: active.model,
      apiProviderBaseUrl: active.apiProviderBaseUrl,
    } : {}),
    apiProtocolConfigs: {
      ...config.apiProtocolConfigs,
      ...(!saved || isLanzBaseUrl(saved.baseUrl) ? { openai: fill(active ?? source) } : {}),
    },
    byokProviderConfigDrafts: drafts,
    lanzAccountUsername: account.username,
  };
}
