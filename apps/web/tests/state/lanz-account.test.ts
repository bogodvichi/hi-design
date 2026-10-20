import { describe, expect, it } from 'vitest';
import { LANZ_DEFAULT_MODEL, LANZ_OPENAI_BASE_URL, type LanzAccountCredentials } from '@open-design/contracts';
import { applyLanzAccountConfig, scopeLanzAccountConfig } from '../../src/state/lanz-account';
import { DEFAULT_CONFIG } from '../../src/state/config';

const account: LanzAccountCredentials = {
  ok: true, username: 'alice', apiKey: 'stable-account-key',
  baseUrl: LANZ_OPENAI_BASE_URL, defaultModel: LANZ_DEFAULT_MODEL,
};
const draftKey = 'openai:' + LANZ_OPENAI_BASE_URL;

describe('automatic Lanz account configuration', () => {
  it('fills the default provider while preserving Local CLI execution mode', () => {
    const result = applyLanzAccountConfig({ ...DEFAULT_CONFIG, model: '' }, account);
    expect(result).toMatchObject({
      mode: 'daemon', apiKey: account.apiKey, baseUrl: LANZ_OPENAI_BASE_URL,
      model: LANZ_DEFAULT_MODEL, lanzAccountUsername: 'alice',
    });
    expect(result.byokProviderConfigDrafts?.[draftKey]?.apiConfig.apiKey).toBe(account.apiKey);
  });

  it('reuses the account Key when the user changes the selected model', () => {
    const configured = applyLanzAccountConfig({ ...DEFAULT_CONFIG, mode: 'api', model: 'EB-G61' }, account);
    const switched = { ...configured, model: 'EB-DeepSeek-Flash' };
    const refreshed = applyLanzAccountConfig(switched, account);
    expect(configured.model).toBe('EB-G61');
    expect(switched.apiKey).toBe(configured.apiKey);
    expect(refreshed.model).toBe('EB-DeepSeek-Flash');
    expect(refreshed.apiKey).toBe(account.apiKey);
  });

  it('keeps an active third-party provider and saves Lanz for a later provider switch', () => {
    const other = { ...DEFAULT_CONFIG, mode: 'api' as const, apiKey: 'other-key',
      baseUrl: 'https://api.openai.com/v1', model: 'custom-model', apiProviderBaseUrl: null };
    const result = applyLanzAccountConfig(other, account);
    expect(result).toMatchObject({ apiKey: 'other-key', baseUrl: other.baseUrl, model: 'custom-model' });
    expect(result.byokProviderConfigDrafts?.[draftKey]?.apiConfig).toMatchObject({
      apiKey: account.apiKey, baseUrl: LANZ_OPENAI_BASE_URL, model: LANZ_DEFAULT_MODEL,
    });
  });

  it('clears the previous account Key from active, protocol and provider drafts before loading a new account', () => {
    const previous = applyLanzAccountConfig({ ...DEFAULT_CONFIG, model: 'EB-G61' }, account);
    const unrelated = { apiConfig: { apiKey: 'unrelated-key', baseUrl: 'https://example.test/v1', model: 'custom' } };
    previous.byokProviderConfigDrafts!['openai:other'] = unrelated;
    const cleared = scopeLanzAccountConfig(previous, 'bob');
    expect(cleared.apiKey).toBe('');
    expect(cleared.apiProtocolConfigs?.openai?.apiKey).toBe('');
    expect(cleared.byokProviderConfigDrafts?.[draftKey]?.apiConfig.apiKey).toBe('');
    expect(cleared.byokProviderConfigDrafts?.['openai:other']).toEqual(unrelated);
    const next = applyLanzAccountConfig(cleared, { ...account, username: 'bob', apiKey: 'bob-key' });
    expect(next.apiKey).toBe('bob-key');
    expect(next.model).toBe('EB-G61');
  });

  it('preserves manual credentials until an account has been linked', () => {
    const manual = { ...DEFAULT_CONFIG, apiKey: 'manual-key' };
    expect(scopeLanzAccountConfig(manual, 'bob')).toBe(manual);
  });
});
