import { describe, expect, it } from 'vitest';
import { resolveHdwAddress } from '../../src/http/hdw-constants.js';

describe('HDW environment routing', () => {
  it('routes development to the remote 7002 gateway', () => {
    expect(resolveHdwAddress({ NODE_ENV: 'development' })).toEqual({
      baseUrl: 'https://pixso.hikvision.com.cn',
      pathPrefix: '/hik-plugin/hidesign-web/hdw',
    });
  });

  it('routes production to the same remote 7002 gateway', () => {
    expect(resolveHdwAddress({ NODE_ENV: 'production' })).toEqual({
      baseUrl: 'https://pixso.hikvision.com.cn',
      pathPrefix: '/hik-plugin/hidesign-web/hdw',
    });
  });

  it.each(['development', 'production'])('preserves an explicit packaged or acceptance override in %s', (mode) => {
    expect(resolveHdwAddress({ NODE_ENV: mode, OD_HDW_PATH_PREFIX: ' /custom/hdw ' }).pathPrefix)
      .toBe('/custom/hdw');
  });
});
