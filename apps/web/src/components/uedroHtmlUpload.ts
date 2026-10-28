import { HTML_REVIEW_TYPE } from './reviewMeta';

/** UEDRO's original HTML review upload parameters and H5 display sizes. */
export type HtmlReviewCarrierType = 'web' | 'h5';
export const HTML_REVIEW_H5_SIZES = [
  { value: '390x844', label: '390×844' },
  { value: '375x667', label: '375×667' },
  { value: '430x932', label: '430×932' },
  { value: '360x740', label: '360×740' },
  { value: '412x915', label: '412×915' },
] as const;

export const DEFAULT_HTML_REVIEW_H5_SIZE = '390x844';

/** Match UEDRO uploadDrag without changing other manuscript types. */
export function appendHtmlReviewUploadFields(
  formData: FormData,
  reviewType: string,
  carrierType: HtmlReviewCarrierType,
  h5Size: string,
): void {
  if (reviewType !== HTML_REVIEW_TYPE) return;
  formData.append('reviewType', HTML_REVIEW_TYPE);
  formData.append('carrierType', carrierType);
  formData.append('h5Size', h5Size);
}
