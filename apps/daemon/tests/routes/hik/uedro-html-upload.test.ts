import { describe, expect, it } from 'vitest';
import { htmlReviewMultipartParts } from '../../../src/routes/hik/_routes/uedro.js';

describe('UEDRO html-review multipart protocol', () => {
  it('does not add HTML fields for ordinary reviews', () => {
    expect(htmlReviewMultipartParts({ reviewType: '1' })).toEqual([]);
    expect(htmlReviewMultipartParts({})).toEqual([]);
  });

  it('forwards all three HTML fields and defaults to the Web carrier', () => {
    expect(htmlReviewMultipartParts({ reviewType: '12' })).toEqual([
      { name: 'reviewType', data: '12' },
      { name: 'carrierType', data: 'web' },
      { name: 'h5Size', data: '390x844' },
    ]);
  });

  it('preserves supported H5 size and normalizes untrusted carrier metadata', () => {
    expect(htmlReviewMultipartParts({ reviewType: 12, carrierType: 'h5', h5Size: '412x915' }))
      .toEqual([
        { name: 'reviewType', data: '12' },
        { name: 'carrierType', data: 'h5' },
        { name: 'h5Size', data: '412x915' },
      ]);
    expect(htmlReviewMultipartParts({ reviewType: '12', carrierType: 'unknown', h5Size: '../outside' }))
      .toEqual([
        { name: 'reviewType', data: '12' },
        { name: 'carrierType', data: 'web' },
        { name: 'h5Size', data: '390x844' },
      ]);
  });
});
