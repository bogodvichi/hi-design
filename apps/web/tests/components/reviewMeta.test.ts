import { describe, expect, it } from 'vitest';
import {
  buildManuscriptPreviewUrl,
  buildReviewWebUrl,
  reviewWebPortFromBaseUrl,
} from '../../src/components/reviewMeta';

describe('buildManuscriptPreviewUrl', () => {
  it.each([
    ['1', '/uedro/ux?id=manuscript-1'],
    ['2', '/uedro/ua?id=manuscript-1'],
    ['3', '/uedro/pdf-js?id=manuscript-1&projectid=null&projName=&projManager=null'],
    ['4', '/uedro/xlsx?id=manuscript-1&projectid=null&projName=&projManager=null'],
  ])('uses the loopback web port for review type %s', (reviewType, path) => {
    expect(buildManuscriptPreviewUrl(reviewType, 'manuscript-1', '38127')).toBe(
      `http://127.0.0.1:38127${path}`,
    );
  });

  it('encodes the manuscript id in the preview URL', () => {
    expect(buildManuscriptPreviewUrl('1', 'manuscript 1/2', 26001)).toBe(
      'http://127.0.0.1:26001/uedro/ux?id=manuscript%201%2F2',
    );
  });

  it('returns null when the manuscript id or web port is missing', () => {
    expect(buildManuscriptPreviewUrl('1', '', '26001')).toBeNull();
    expect(buildManuscriptPreviewUrl('1', 'manuscript-1', '')).toBeNull();
  });

  it('returns null when the review type has no preview', () => {
    expect(buildManuscriptPreviewUrl('5', 'manuscript-1', '26001')).toBeNull();
  });
});

describe('review web URLs', () => {
  it('builds every review page under the fixed loopback host', () => {
    expect(buildReviewWebUrl('/uedro/home', '53836')).toBe('http://127.0.0.1:53836/uedro/home');
  });

  it('extracts the dynamic port from the daemon webBaseUrl', () => {
    expect(reviewWebPortFromBaseUrl('http://127.0.0.1:64248')).toBe('64248');
    expect(reviewWebPortFromBaseUrl('http://localhost:53421/studio')).toBe('53421');
  });

  it('rejects invalid ports and base URLs', () => {
    expect(buildReviewWebUrl('/uedro/home', '0')).toBeNull();
    expect(buildReviewWebUrl('/uedro/home', '70000')).toBeNull();
    expect(reviewWebPortFromBaseUrl('od://app/')).toBeNull();
    expect(reviewWebPortFromBaseUrl('not a URL')).toBeNull();
  });
});
