import { describe, expect, it } from 'vitest';
import {
  resolveHdwAddress,
  resolveHdwSharePublicBase,
} from '../../src/http/hdw-constants.js';

describe('HDW environment routing', () => {
  it('routes development to the local 7002 gateway', () => {
    expect(resolveHdwAddress({ NODE_ENV: 'development' })).toEqual({
      baseUrl: 'http://127.0.0.1:7002',
      pathPrefix: '/hdw',
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

describe('HDW share public base', () => {
  it('derives the local development share base from the HDW mount path', () => {
    expect(resolveHdwSharePublicBase({ NODE_ENV: 'development' })).toBe(
      'http://127.0.0.1:7002',
    );
  });

  it('derives the production share base from the HDW gateway mount path', () => {
    expect(resolveHdwSharePublicBase({ NODE_ENV: 'production' })).toBe(
      'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web',
    );
  });

  it('uses an explicit HDW path prefix override', () => {
    expect(resolveHdwSharePublicBase({
      NODE_ENV: 'production',
      OD_HDW_PATH_PREFIX: '/custom/hdw',
    })).toBe('https://pixso.hikvision.com.cn/custom');
  });

  it('normalizes trailing slashes in the path prefix', () => {
    expect(resolveHdwSharePublicBase({
      NODE_ENV: 'production',
      OD_HDW_PATH_PREFIX: ' /custom/hdw/// ',
    })).toBe('https://pixso.hikvision.com.cn/custom');
  });
});
