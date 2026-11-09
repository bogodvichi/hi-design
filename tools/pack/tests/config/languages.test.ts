import { expect, it } from 'vitest';
import { MAC_ELECTRON_LANGUAGES } from '@/mac/constants.js';
import { NSIS_INSTALLER_LANGUAGE_BY_WEB_LOCALE, WIN_ELECTRON_LANGUAGES } from '@/win/constants.js';

it('ships only Chinese and English native resources and installer languages', () => {
  expect(MAC_ELECTRON_LANGUAGES).toEqual(['en', 'zh_CN']);
  expect(WIN_ELECTRON_LANGUAGES).toEqual(['en-US', 'zh-CN']);
  expect(NSIS_INSTALLER_LANGUAGE_BY_WEB_LOCALE).toEqual({ en: 'en_US', 'zh-CN': 'zh_CN' });
});
