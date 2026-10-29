// Shared HDW backend address constants.
//
// All HDW clients — the `http/hdw.ts` proxy client, the
// `integrations/hdw-cloud.ts` cloud client, and the `/api/hdw`
// reverse proxy — derive their upstream target from these values
// so the prod/dev entry points live in a single maintainable place.
//
// HDW address selection is constants-only for the base URL. The path
// prefix can be overridden at packaging time via `OD_HDW_PATH_PREFIX`
// (baked into `open-design-config.json` by tools/pack and forwarded to
// the daemon spawn env by the packaged launcher). Do not add
// `OD_HDW_API_URL` overrides.

/** Resolve the environment-specific HDW base URL and path prefix. */
export function resolveHdwAddress(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string;
  pathPrefix: string;
} {
  const isProduction = env.NODE_ENV === 'production';
  return {
    baseUrl: isProduction ? PROD_HDW_BASE_URL : DEV_HDW_BASE_URL,
    pathPrefix: resolveHdwPathPrefix(env, isProduction),
  };
}

/**
 * Resolve the HDW path prefix. When `OD_HDW_PATH_PREFIX` is set (by the
 * packaged launcher from the baked config), it overrides the hardcoded
 * constant. Otherwise the prod/dev constant is used.
 */
function resolveHdwPathPrefix(env: NodeJS.ProcessEnv, isProduction: boolean): string {
  const override = env.OD_HDW_PATH_PREFIX?.trim();
  if (override) return override;
  return isProduction ? PROD_HDW_PATH_PREFIX : DEV_HDW_PATH_PREFIX;
}

/** Production HDW backend origin (Pixso). */
export const PROD_HDW_BASE_URL = 'https://pixso.hikvision.com.cn';

/** Development and packaged clients share the remote HDW backend. */
export const DEV_HDW_BASE_URL = PROD_HDW_BASE_URL;

/** Remote HDW gateway backed by the server on port 7002. */
export const PROD_HDW_PATH_PREFIX = '/hik-plugin/hidesign-web/hdw';

/** Development reads and writes use the same remote catalog and file store. */
export const DEV_HDW_PATH_PREFIX = PROD_HDW_PATH_PREFIX;
