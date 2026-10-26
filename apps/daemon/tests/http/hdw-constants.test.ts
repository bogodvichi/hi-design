import { describe, expect, it } from 'vitest';
import { resolveHdwAddress } from '../../src/http/hdw-constants.js';

describe('HDW environment routing', () => {
  it('routes local Dev directly to the local Egg server at port 7002', () => {
    expect(resolveHdwAddress({ NODE_ENV: 'development' })).toEqual({
      baseUrl: 'http://127.0.0.1:7002',
      pathPrefix: '/hdw',
    });
  });

  it('routes production to the verified official gateway, never local or online Dev', () => {
    expect(resolveHdwAddress({ NODE_ENV: 'production' })).toEqual({
      baseUrl: 'https://pixso.hikvision.com.cn',
      pathPrefix: '/hik-plugin/hidesign-web-offical/hdw',
    });
  });

  it.each(['development', 'production'])('preserves an explicit packaged or acceptance override in %s', (mode) => {
    expect(resolveHdwAddress({ NODE_ENV: mode, OD_HDW_PATH_PREFIX: ' /custom/hdw ' }).pathPrefix)
      .toBe('/custom/hdw');
  });
});
