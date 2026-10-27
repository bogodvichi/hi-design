import { describe, expect, it } from 'vitest';
import {
  buildManuscriptPreviewUrl,
  buildUedroWebUrl,
  parseAllowedUedroPageUrl,
  UEDRO_HOME_URL,
  reviewTypeLabel,
  reviewTypeMeta,
} from '../../src/components/reviewMeta';

describe('buildManuscriptPreviewUrl', () => {
  it.each([
    ['1', '/uedro/ux?id=manuscript-1'],
    ['2', '/uedro/ua?id=manuscript-1'],
    ['3', '/uedro/pdf-js?id=manuscript-1&projectid=null&projName=&projManager=null'],
    ['4', '/uedro/xlsx?id=manuscript-1&projectid=null&projName=&projManager=null'],
  ])('uses the official UEDRO site for review type %s', (reviewType, path) => {
    expect(buildManuscriptPreviewUrl(reviewType, 'manuscript-1')).toBe(
      `https://uedro.hikvision.com.cn${path}`,
    );
  });

  it('encodes the manuscript id in the preview URL', () => {
    expect(buildManuscriptPreviewUrl('1', 'manuscript 1/2')).toBe(
      'https://uedro.hikvision.com.cn/uedro/ux?id=manuscript%201%2F2',
    );
  });

  it('returns null when the manuscript id is missing', () => {
    expect(buildManuscriptPreviewUrl('1', '')).toBeNull();
  });

  it('returns null when the review type has no preview', () => {
    expect(buildManuscriptPreviewUrl('5', 'manuscript-1')).toBeNull();
  });
});

describe('HTML review metadata', () => {
  it('shows the official label and an HTML avatar, without inventing a preview path', () => {
    expect(reviewTypeLabel({ reviewType: '12' })).toBe('html评审');
    expect(reviewTypeMeta({ reviewType: '12' })?.char).toBe('H');
    expect(buildManuscriptPreviewUrl('12', 'manuscript-1')).toBeNull();
  });
});

describe('official UEDRO URLs', () => {
  it('builds the historical review home URL', () => {
    expect(buildUedroWebUrl('/uedro/home')).toBe(UEDRO_HOME_URL);
  });

  it('accepts only allowlisted UEDRO pages', () => {
    expect(parseAllowedUedroPageUrl(UEDRO_HOME_URL)?.hostname).toBe('uedro.hikvision.com.cn');
    expect(parseAllowedUedroPageUrl('https://uedro.hikvision.com.cn:443/uedro/ux?id=1')?.pathname).toBe('/uedro/ux');
    expect(parseAllowedUedroPageUrl('https://uedro.hikvision.com.cn/uedro/admin')).toBeNull();
  });

  it('rejects non-official origins and unsafe URL parts', () => {
    expect(buildUedroWebUrl('/uedro/home?next=https://example.com')).toBeNull();
    expect(parseAllowedUedroPageUrl('https://uedro.hikvision.com.cn.evil.example/uedro/home')).toBeNull();
    expect(parseAllowedUedroPageUrl('http://uedro.hikvision.com.cn/uedro/home')).toBeNull();
    expect(parseAllowedUedroPageUrl('https://user:pass@uedro.hikvision.com.cn/uedro/home')).toBeNull();
    expect(parseAllowedUedroPageUrl('https://uedro.hikvision.com.cn/uedro/home#fragment')).toBeNull();
  });
});
