import { protocol } from "electron";

import { isHarmlessSocketOptionError } from "./logging.js";

const OD_SCHEME = "od";
const OD_ENTRY_URL = `${OD_SCHEME}://app/`;
type OdProtocolFetch = (request: Request) => Promise<Response>;

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: OD_SCHEME,
  },
]);

function toWebRuntimeUrl(webRuntimeUrl: string, requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const target = new URL(webRuntimeUrl);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  target.hash = incoming.hash;
  return target.toString();
}

const OD_PROXY_RETRYABLE_METHODS = new Set(["GET", "HEAD"]);
const OD_PROXY_RETRY_ATTEMPTS = 4;
const OD_PROXY_RETRY_BACKOFF_MS = 200; // 200ms, 400ms, 600ms — throw path only, ~1.2s worst-case added

type OdProxyRetryOptions = {
  attempts?: number;
  backoffMs?: number;
  delay?: (ms: number) => Promise<void>;
};

const defaultRetryDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a hostname resolves to this machine. The `od://` proxy only
 * ever targets the local web sidecar (127.0.0.1 / localhost / ::1), so
 * a loopback target can safely bypass any configured HTTP proxy — the
 * request never leaves the machine, and routing it through an external
 * proxy (corporate VPN, Clash, V2ray, …) is what breaks login on the
 * subset of clients that have a proxy set without a loopback bypass.
 */
export function isLoopbackHost(hostname: string): boolean {
  // Strip brackets from the IPv6 literal form ([::1]) before comparing.
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.startsWith("127.")
  );
}

/**
 * Whether a fetch error is a transient connection-level failure that
 * is safe to retry even for non-idempotent methods (POST, PUT, …).
 *
 * `socket hang up`, `ECONNRESET`, `ECONNREFUSED`, and undici's
 * `UND_ERR_SOCKET` all indicate the connection was dropped or refused
 * before the server processed the request — no request bytes reached
 * the application layer, so re-issuing the request cannot cause
 * duplicate side effects. This is the cold-start race: the web sidecar
 * has bound its TCP socket (IPC status reports a URL) but the first
 * HTTP request hits before the server is fully ready to handle it,
 * and on some Windows machines Defender / AV briefly intercepts the
 * loopback connection and drops it.
 *
 * Match strategy:
 *   1. `code` is authoritative when present: ECONNRESET, ECONNREFUSED,
 *      EPIPE, UND_ERR_SOCKET, or UND_ERR_CLOSED qualify.
 *   2. When `code` is absent, fall back to the message string for the
 *      undici-specific `socket hang up` and `other side closed` shapes
 *      that surface without a structured code on some Node builds.
 */
export function isTransientConnectionError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  const code = (value as NodeJS.ErrnoException).code;
  if (typeof code === "string" && code.length > 0) {
    return (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "EPIPE" ||
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CLOSED"
    );
  }
  const message = typeof value.message === "string" ? value.message : "";
  return (
    message.includes("socket hang up") ||
    message.includes("other side closed") ||
    message.includes("connect ECONNREFUSED")
  );
}

/**
 * Lazily create a single undici `Agent` with no proxy wiring. Used as the
 * `dispatcher` for loopback targets so the fetch ignores `HTTP_PROXY` /
 * `HTTPS_PROXY` / `ALL_PROXY` regardless of `NODE_USE_ENV_PROXY` or the
 * Electron session proxy. Dynamic-imported + defensive: if the bundled
 * undici is not resolvable in some Electron build, the bypass degrades
 * to plain `fetch` (no worse than today).
 */
let loopbackAgentPromise: Promise<unknown | null> | null = null;

function getLoopbackDirectAgent(): Promise<unknown | null> {
  if (loopbackAgentPromise) return loopbackAgentPromise;
  loopbackAgentPromise = (async () => {
    try {
      // `undici` ships with Node 24 but not as a typed package in this
      // workspace, so the specifier is kept non-literal: TypeScript
      // then types the dynamic import as untyped (no "Cannot find
      // module 'undici'"), and esbuild leaves it as a runtime import
      // under `packages: external`. Node resolves it from its bundle.
      const specifier = "undici";
      const mod = (await import(specifier)) as { Agent?: new () => unknown };
      return mod.Agent ? new mod.Agent() : null;
    } catch {
      return null;
    }
  })();
  return loopbackAgentPromise;
}

type OdFetchInit = RequestInit & { dispatcher?: unknown };

/**
 * Wrap a base `fetch` so loopback targets are issued with a direct
 * undici dispatcher, bypassing any proxy. Exported so unit tests can
 * pin that a loopback target receives a `dispatcher` and a non-loopback
 * target does not.
 */
export function createLoopbackBypassFetch(
  baseFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): OdProtocolFetch {
  return async (request: Request): Promise<Response> => {
    if (isLoopbackHost(new URL(request.url).hostname)) {
      const agent = await getLoopbackDirectAgent();
      const init: OdFetchInit = agent == null ? {} : { dispatcher: agent };
      return baseFetch(request, init as RequestInit);
    }
    return baseFetch(request);
  };
}

/**
 * Fetch the rewritten sidecar target, absorbing transient socket throws
 * for idempotent requests — and for non-idempotent requests when the
 * throw is a harmless pre-connect socket-option error.
 *
 * A single transient fetch failure must never become the document the
 * window renders: undici can throw mid-fetch from socket internals (the
 * `setTypeOfService EINVAL` family of issue #895) even while the web
 * sidecar is healthy, and when that happens on the top navigation
 * (`od://app/`) the synthetic 502 from `buildProxyErrorResponse` IS the
 * whole window — the React app never mounts and nothing reloads it.
 * GET/HEAD carry no body, so re-issuing the Request per attempt is safe;
 * non-idempotent methods stay single-attempt for arbitrary errors, but
 * a harmless `setTypeOfService EINVAL` is retried too because that
 * throw happens during socket setup — before any request bytes are
 * written — so re-issuing is side-effect-free even for
 * `POST /api/auth/login`, the exact flow that failed on VPN/macOS
 * clients. Responses that resolve — including upstream 5xx — are never
 * retried here: those are app-level answers the renderer owns.
 *
 * Each attempt clones the source request so a retried POST keeps a
 * re-sendable body stream: `new Request(target, request)` would null
 * the source body after the first attempt, so `request.clone()` tees a
 * fresh copy per attempt without disturbing the original.
 *
 * Deliberately not conditioned on `Sec-Fetch-Dest: document`: uniform
 * idempotent retry is simpler, and Sec-Fetch header presence on a custom
 * scheme is not a stable contract across Electron versions.
 */
async function fetchOdTargetWithTransientRetry(
  request: Request,
  target: string,
  fetchImpl: OdProtocolFetch,
  options: OdProxyRetryOptions,
): Promise<Response> {
  const isIdempotent = OD_PROXY_RETRYABLE_METHODS.has(request.method);
  const maxAttempts = options.attempts ?? OD_PROXY_RETRY_ATTEMPTS;
  const backoffMs = options.backoffMs ?? OD_PROXY_RETRY_BACKOFF_MS;
  const delay = options.delay ?? defaultRetryDelay;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchImpl(new Request(target, request.clone()));
    } catch (error) {
      lastError = error;
      const harmless = isHarmlessSocketOptionError(error);
      const transient = isTransientConnectionError(error);
      const retryable = isIdempotent || harmless || transient;
      if (!retryable || attempt === maxAttempts) break;
      const waitMs = backoffMs * attempt;
      // Main-process console output lands in the packaged desktop logs, so
      // real-world transient frequency stays diagnosable.
      console.warn("[open-design packaged] od:// proxy fetch failed; retrying", {
        attempt,
        maxAttempts,
        harmless,
        transient,
        message: error instanceof Error ? error.message : String(error),
        target,
        waitMs,
      });
     await delay(waitMs);
   }
  }
  throw lastError;
}

function buildProxyErrorResponse(error: unknown, target: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string"
      ? (error as NodeJS.ErrnoException).code
      : null;
  return new Response(
    JSON.stringify({
      error: "OD_PROTOCOL_PROXY_FAILED",
      message,
      ...(code === null ? {} : { code }),
      target,
    }),
    {
      status: 502,
      headers: { "content-type": "application/json" },
    },
  );
}

/**
 * Inner request handler for the `od://` Electron protocol — every
 * renderer fetch flows through here and gets proxied to the local web
 * sidecar via Node's global `fetch` (which is undici under the hood).
 *
 * The default `fetchImpl` is `createLoopbackBypassFetch()`, which routes
 * loopback targets through a direct undici `Agent` so a client-side
 * HTTP proxy (corporate VPN, Clash, V2ray, …) can never intercept the
 * renderer-to-sidecar hop. That is the root fix for
 * `OD_PROTOCOL_PROXY_FAILED` surfacing on the subset of clients that
 * have a proxy configured without a loopback bypass.
 *
 * Pulled out as a named export so unit tests can drive it with a stub
 * `fetchImpl` without spinning up Electron, and so the try/catch
 * stays auditable from one place.
 *
 * Why the try/catch matters: undici can throw `setTypeOfService
 * EINVAL` from socket internals on certain macOS / VPN configurations
 * (issue #895). Without the catch, the rejection bubbles all the way
 * up to the Electron main process and surfaces as a native
 * "JavaScript error in main process" dialog the next time the user
 * does anything that triggers a renderer-to-sidecar fetch (e.g.
 * Settings → Pets → Community). Returning a 502 instead lets the
 * renderer see a normal failure and keeps the process alive.
 *
 * Idempotent requests first pass through
 * `fetchOdTargetWithTransientRetry`, so a one-off transient throw on
 * the top navigation cannot end up as the 502 document covering the
 * window; the 502 remains the exhaustion fallback. Non-idempotent
 * requests are retried only when the throw is the harmless
 * `setTypeOfService EINVAL` shape (pre-connect, side-effect-free).
 */
export async function handleOdRequest(
  request: Request,
  webRuntimeUrl: string,
  fetchImpl: OdProtocolFetch = createLoopbackBypassFetch(),
  retryOptions: OdProxyRetryOptions = {},
): Promise<Response> {
  const target = toWebRuntimeUrl(webRuntimeUrl, request.url);
  try {
    return await fetchOdTargetWithTransientRetry(request, target, fetchImpl, retryOptions);
  } catch (error) {
    return buildProxyErrorResponse(error, target);
  }
}

export function packagedEntryUrl(): string {
  return OD_ENTRY_URL;
}

export function registerOdProtocol(webRuntimeUrl: string): void {
  protocol.handle(OD_SCHEME, async (request) => {
    return await handleOdRequest(request, webRuntimeUrl);
  });
}
