// Shared HDW backend address constants.
//
// All HDW clients — the `http/hdw.ts` proxy client, the
// `integrations/hdw-cloud.ts` cloud client, and the `/api/hdw`
// reverse proxy — derive their upstream target from these values
// so the prod/dev entry points live in a single maintainable place.
//
// HDW address selection is intentionally constants-only. Do not add
// `OD_HDW_API_URL` or `OD_HDW_API_PREFIX` overrides.

/** Resolve the environment-specific HDW base URL and path prefix. */
export function resolveHdwAddress(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string;
  pathPrefix: string;
} {
  const isProduction = env.NODE_ENV === 'production';
  return {
    baseUrl: isProduction ? PROD_HDW_BASE_URL : DEV_HDW_BASE_URL,
    pathPrefix: isProduction ? PROD_HDW_PATH_PREFIX : DEV_HDW_PATH_PREFIX,
  };
}

/** Production HDW backend origin (Pixso). */
export const PROD_HDW_BASE_URL = 'https://pixso.hikvision.com.cn';

/** Local development uses the local HDW backend. */
export const DEV_HDW_BASE_URL = 'http://127.0.0.1:7002';

/** Production path prefix appended after the base URL. */
export const PROD_HDW_PATH_PREFIX = '/hik-plugin/hidesign-web/hdw';

/** Local development uses the local HDW path. */
export const DEV_HDW_PATH_PREFIX = '/hdw';
