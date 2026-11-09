// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryModelInline } from '../../src/components/MemoryModelInline';
import { I18nProvider } from '../../src/i18n';

const props = {
  mode: 'api' as const,
  apiProtocol: 'openai' as const,
  chatApiKey: 'test-key',
  chatBaseUrl: 'http://lanz.hikvision.com/v3/openai/model',
  chatApiVersion: '',
  chatModel: 'EB-DeepSeek-Flash',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ extraction: null })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('MemoryModelInline provider label', () => {
  it.each([
    ['en', 'http://lanz.hikvision.com/v3/openai/model', 'Same as chat (lanz-openai)'],
    ['zh-CN', 'http://lanz.hikvision.com/v3/openai/model/', '与聊天一致（lanz-openai）'],
    ['en', 'https://api.openai.com/v1', 'Same as chat (OpenAI)'],
    ['en', 'https://custom.example.test/v1', 'Same as chat (openai)'],
  ] as const)('labels %s memory inheritance for %s', (locale, chatBaseUrl, label) => {
    render(<I18nProvider initial={locale}><MemoryModelInline {...props} chatBaseUrl={chatBaseUrl} /></I18nProvider>);
    expect(screen.getByRole('combobox').textContent).toBe(label);
  });

  it('updates the label when the chat provider changes', () => {
    const view = render(<I18nProvider initial="en"><MemoryModelInline {...props} /></I18nProvider>);
    view.rerender(<I18nProvider initial="en"><MemoryModelInline {...props} chatBaseUrl="https://api.openai.com/v1" /></I18nProvider>);
    expect(screen.getByRole('combobox').textContent).toBe('Same as chat (OpenAI)');
  });

  it('keeps the selected Local CLI label', () => {
    render(<I18nProvider initial="en"><MemoryModelInline {...props} mode="daemon" cliAgentId="claude" /></I18nProvider>);
    expect(screen.getByRole('combobox').textContent).toBe('Same as chat (Claude Code)');
  });
});
