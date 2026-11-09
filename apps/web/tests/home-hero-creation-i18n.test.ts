import { describe, expect, it } from 'vitest';
import type { Dict } from '../src/i18n/types';
import { en } from '../src/i18n/locales/en';
import { zhCN } from '../src/i18n/locales/zh-CN';

const dictionaries: Dict[] = [
  en,
  zhCN,
];

describe('Home creation hierarchy i18n', () => {
  it('localizes Prototype in every supported locale and keeps WebGL as the product label', () => {
    expect(dictionaries).toHaveLength(2);
    for (const dict of dictionaries) {
      expect(dict['homeHero.chip.prototype'].trim()).not.toBe('');
      expect(dict['homeHero.chip.prototype']).not.toBe('UI Mockup');
      expect(dict['homeHero.chip.webgl']).toBe('WebGL');
    }
  });

  it('uses the requested Simplified Chinese hierarchy labels', () => {
    expect(zhCN['homeHero.chip.prototype']).toBe('原型');
    expect(zhCN['homeHero.chip.liveArtifact']).toBe('实时产物');
  });
});
