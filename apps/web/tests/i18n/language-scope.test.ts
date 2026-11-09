import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_LABEL, resolveSystemLocale, tForLanguageTag } from '../../src/i18n';

describe('Chinese and English product language scope', () => {
  it('ships exactly the two selectable language dictionaries', () => {
    expect(LOCALES).toEqual(['en', 'zh-CN']);
    expect(Object.keys(LOCALE_LABEL)).toEqual(['en', 'zh-CN']);
    expect(readdirSync(new URL('../../src/i18n/locales/', import.meta.url)).sort()).toEqual(['en.ts', 'zh-CN.ts']);
  });

  it('maps Chinese system variants to Simplified Chinese and ignores removed languages', () => {
    expect(resolveSystemLocale(['zh-Hant-TW'])).toBe('zh-CN');
    expect(resolveSystemLocale(['fr-FR', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['fr-FR'])).toBeNull();
    expect(tForLanguageTag('fr')).toBeNull();
  });
});
