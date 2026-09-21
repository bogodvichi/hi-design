// Shared HDW backend address constants.
//
// All HDW clients — the `http/hdw.ts` proxy client, the
// `integrations/hdw-cloud.ts` cloud client, and the `/api/hdw`
// reverse proxy — derive their upstream target from these values
// so the prod/dev entry points live in a single maintainable place.
//
// Override is still possible via `OD_HDW_API_URL` and
// `OD_HDW_API_PREFIX` env vars; see `resolveHdwBase` in `http/hdw.ts`
// and `readHdwCloudConfig` in `integrations/hdw-cloud.ts`.

/** Production HDW backend origin (Pixso). */
export const PROD_HDW_BASE_URL = 'https://pixso.hikvision.com.cn';

/** Local development uses the shared remote HDW backend. */
export const DEV_HDW_BASE_URL = 'http://127.0.0.1:7002';

/** Production path prefix appended after the base URL. */
export const PROD_HDW_PATH_PREFIX = '/hik-plugin/hidesign-web/hdw';

/** Local development uses the production reverse-proxy path. */
export const DEV_HDW_PATH_PREFIX = '/hdw';
