import { describe, expect, it } from 'vitest';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { en } from '../../src/i18n/locales/en';
import type { Dict } from '../../src/i18n/types';
import { responseError, userFacingError } from '../../src/utils/userFacingError';

const translate = (dict: Dict) => (key: keyof Dict, vars?: Record<string, string | number>) =>
  dict[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
const t = translate(zhCN);

describe('user-facing feedback', () => {
  it('explains denied access without repeating the failed operation', () => {
    expect(userFacingError({ code: 'RESOURCE_ACCESS_DENIED' }, t, 'feedback.loadSkillsFailed', 'Skill'))
      .toBe('没有 Skill 的访问权限，请联系所有者或团队管理员。');
  });

  it.each(['AUTHENTICATION_REQUIRED', 'INVALID_SESSION'])('maps %s to an actionable sign-in message', (code) => {
    expect(userFacingError({ error: { code } }, t, 'feedback.saveFailed')).toMatch(/登录/);
  });

  it.each(['HTTP 500: <html>failure</html>', 'missing_principal', 'FOLDER_OWNER_UNRESOLVED',
    'SQLITE_ERROR: no such table: projects', '上传失败 HTTP 503: /api/private',
    'request failed: Bearer secret-value', '[object Object]'])('keeps diagnostics out of the primary message: %s', (message) => {
    expect(userFacingError(new Error(message), t, 'feedback.saveFailed')).toBe('保存失败，请稍后重试。');
  });

  it('distinguishes a verified network failure from an unidentified error', () => {
    expect(userFacingError(new TypeError('Failed to fetch'), t, 'feedback.saveFailed'))
      .toBe('网络连接失败，请检查网络后重试。');
    expect(userFacingError(new Error('Something failed'), t, 'feedback.saveFailed'))
      .toBe('保存失败，请稍后重试。');
  });

  it('preserves a concise Chinese validation message', () => {
    expect(userFacingError('名称最多支持 50 个字符。', t, 'feedback.saveFailed')).toBe('名称最多支持 50 个字符。');
  });

  it('preserves structured server codes and does not treat every 403 as a login failure', async () => {
    const error = await responseError(Response.json({ error: { code: 'RESOURCE_ACCESS_DENIED', message: 'forbidden' } }, { status: 403 }));
    expect(userFacingError(error, t, 'feedback.saveFailed', '项目'))
      .toBe('没有项目的访问权限，请联系所有者或团队管理员。');
    const unknown = await responseError(new Response('gateway failure', { status: 403 }));
    expect(userFacingError(unknown, t, 'feedback.saveFailed')).toBe('保存失败，请稍后重试。');
  });

  it('recognizes the HDW numeric envelope without losing its authentication error', async () => {
    const error = await responseError(Response.json({ code: -1, error: 'INVALID_SESSION' }, { status: 401 }));
    expect(userFacingError(error, t, 'feedback.saveFailed')).toBe('登录已失效，请重新登录 HiDesign。');
  });

  it('keeps English feedback in an English UI', () => {
    expect(userFacingError({ code: 'INVALID_SESSION' }, translate(en), 'feedback.saveFailed'))
      .toBe('Your session has expired. Sign in to HiDesign again.');
  });
});
