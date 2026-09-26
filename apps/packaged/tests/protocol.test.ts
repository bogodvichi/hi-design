/**
 * Regression coverage for the `od://` protocol proxy in
 * apps/packaged/src/protocol.ts.
 *
 * The packaged Electron entry registers `od://` as the loader for the
 * web runtime and forwards every renderer request to the local web
 * sidecar through Node's global `fetch` (which is undici under the
 * hood). Without a try/catch in the handler, undici throwing
 * `setTypeOfService EINVAL` from socket internals on certain macOS /
 * VPN configurations bubbled up to Electron's default uncaught
 * exception handler — surfacing as a native "JavaScript error in
 * main process" dialog the moment the user did anything that
 * triggered a fetch (e.g. Settings → Pets → Community).
 *
 * @see https://github.com/nexu-io/open-design/issues/895
 */

// `protocol.handle` from the `electron` module is invoked at import
// time inside `apps/packaged/src/protocol.ts`. Stub the module before
// importing so the test environment doesn't need a real Electron
// runtime.
import { vi } from 'vitest';

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

import { afterEach, describe, expect, it } from 'vitest';

import { createLoopbackBypassFetch, handleOdRequest, isLoopbackHost, isTransientConnectionError } from '../src/protocol.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('od:// protocol proxy', () => {
  it('proxies the request through fetchImpl with the rewritten target URL', async () => {
    const captured: Request[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captured.push(input as Request);
      return new Response('ok', { status: 200 });
    };

    const request = new Request('od://app/api/codex-pets/sync', { method: 'POST' });
    const response = await handleOdRequest(request, 'http://127.0.0.1:17579/', fetchImpl);

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('http://127.0.0.1:17579/api/codex-pets/sync');
    expect(captured[0]!.method).toBe('POST');
  });

  it('preserves the request path, search, and hash when rewriting to the web sidecar', async () => {
    const captured: Request[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      captured.push(input as Request);
      return new Response('', { status: 204 });
    };

    const request = new Request('od://app/api/projects?limit=5#section', { method: 'GET' });
    await handleOdRequest(request, 'http://127.0.0.1:42424/', fetchImpl);

    const target = new URL(captured[0]!.url);
    expect(target.host).toBe('127.0.0.1:42424');
    expect(target.pathname).toBe('/api/projects');
    expect(target.search).toBe('?limit=5');
    // `Request` strips the hash fragment per the Fetch spec, but the
    // pathname + search above are the values the proxy is responsible
    // for getting right. Pin those.
  });

  // The flagship #895 regression: undici can throw `setTypeOfService
  // EINVAL` mid-fetch from socket internals. Without the try/catch
  // wrapper around the handler's fetch call, that rejection propagates
  // up to Electron's default uncaught exception handler and surfaces
  // as a native "JavaScript error in main process" dialog. The
  // handler must instead return a 502 Response so the renderer sees
  // a normal failure and the process keeps running.
  it('returns a 502 Response when the underlying fetch rejects (issue #895)', async () => {
    const fetchImpl: typeof fetch = async () => {
      const error = new Error('setTypeOfService EINVAL') as NodeJS.ErrnoException;
      error.code = 'EINVAL';
      error.syscall = 'setTypeOfService';
      throw error;
    };

    const request = new Request('od://app/api/codex-pets/sync', { method: 'POST' });
    const response = await handleOdRequest(request, 'http://127.0.0.1:17579/', fetchImpl);

    expect(response.status).toBe(502);
    const body = (await response.json()) as {
      error: string;
      message: string;
      code?: string;
      target: string;
    };
    expect(body.error).toBe('OD_PROTOCOL_PROXY_FAILED');
    expect(body.message).toContain('setTypeOfService');
    expect(body.code).toBe('EINVAL');
    expect(body.target).toBe('http://127.0.0.1:17579/api/codex-pets/sync');
  });

  it('does not throw when fetch rejects (the actual #895 root-cause guard)', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('socket hang up');
    };

    // The promise must resolve with a Response, never reject.
    await expect(
      handleOdRequest(new Request('od://app/'), 'http://127.0.0.1:1/', fetchImpl),
    ).resolves.toBeInstanceOf(Response);
  });

  it('handles non-Error rejection values without throwing', async () => {
    const fetchImpl: typeof fetch = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'sync timeout';
    };

    const response = await handleOdRequest(
      new Request('od://app/api/probe'),
      'http://127.0.0.1:1/',
      fetchImpl,
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe('sync timeout');
  });
});

// On first launch the top navigation `od://app/` flows through the same
// handler. If undici throws its transient socket error (#895) on that
// single attempt, the synthetic 502 below IS the document the window
// renders — the React app never mounts and the splash reveals a raw 502
// after its ceiling. Idempotent requests must absorb a transient throw
// by retrying before surfacing the 502.
describe('od:// protocol transient retry', () => {
  const transientSocketError = (): Error => {
    const error = new Error('setTypeOfService EINVAL') as NodeJS.ErrnoException;
    error.code = 'EINVAL';
    error.syscall = 'setTypeOfService';
    return error;
  };
  const noDelay = { delay: async () => {} };

  it('retries a GET whose first attempt throws a transient socket error and returns the eventual success', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw transientSocketError();
      return new Response('ok', { status: 200 });
    };

    const response = await handleOdRequest(
      new Request('od://app/'),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('gives up after the bounded attempt budget and returns the 502 proxy-failure document', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw transientSocketError();
    };

    const response = await handleOdRequest(
      new Request('od://app/'),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; code?: string };
     expect(body.error).toBe('OD_PROTOCOL_PROXY_FAILED');
     expect(body.code).toBe('EINVAL');
      expect(calls).toBe(4);
   });

   it('does not retry non-idempotent methods', async () => {
     let calls = 0;
     const fetchImpl: typeof fetch = async () => {
       calls += 1;
       // A real transport error — not the harmless setTypeOfService
       // shape — must never be retried for a non-idempotent method.
        // Use a non-transient error: `socket hang up` is now retried
        // via isTransientConnectionError, so a generic internal error
        // is the correct non-retryable shape for this test.
        throw new Error('internal server error');
     };

    const response = await handleOdRequest(
      new Request('od://app/api/codex-pets/sync', { method: 'POST' }),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

     expect(response.status).toBe(502);
     expect(calls).toBe(1);
   });

    // The cold-start race: the web sidecar has bound its TCP socket
    // (IPC status reports a URL) but the first HTTP request is dropped
    // — especially on Windows where Defender / AV briefly intercepts
    // the loopback connection. `socket hang up` indicates the connection
    // was dropped before the server processed the request, so re-issuing
    // is side-effect-free even for POST /api/auth/login.
    it('retries a POST whose first attempt throws socket hang up and returns the eventual success', async () => {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error('socket hang up');
        return new Response('ok', { status: 200 });
      };

      const response = await handleOdRequest(
        new Request('od://app/api/auth/login', { method: 'POST' }),
        'http://127.0.0.1:17579/',
        fetchImpl,
        noDelay,
      );

      expect(response.status).toBe(200);
      expect(calls).toBe(2);
    });

    it('retries a POST up to the budget on socket hang up before returning 502', async () => {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        throw new Error('socket hang up');
      };

      const response = await handleOdRequest(
        new Request('od://app/api/auth/login', { method: 'POST' }),
        'http://127.0.0.1:17579/',
        fetchImpl,
        noDelay,
      );

      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe('OD_PROTOCOL_PROXY_FAILED');
      expect(body.message).toContain('socket hang up');
      expect(calls).toBe(4);
    });

    it('does not retry a POST on a non-transient error', async () => {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        throw new Error('timeout');
      };

      const response = await handleOdRequest(
        new Request('od://app/api/auth/login', { method: 'POST' }),
        'http://127.0.0.1:17579/',
        fetchImpl,
        noDelay,
      );

      expect(response.status).toBe(502);
      expect(calls).toBe(1);
    });

   // The #895 login regression on the non-idempotent path: a harmless
   // `setTypeOfService EINVAL` throws during socket setup, before any
   // request bytes are written, so retrying POST /api/auth/login is
  // side-effect-free. Without this, a single transient EINVAL on a
  // login POST surfaces as OD_PROTOCOL_PROXY_FAILED on VPN/macOS
  // clients while GET flows absorbed it via the idempotent retry.
  it('retries a non-idempotent POST whose first attempt throws a harmless EINVAL and returns the eventual success', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw transientSocketError();
      return new Response('ok', { status: 200 });
    };

    const response = await handleOdRequest(
      new Request('od://app/api/auth/login', { method: 'POST' }),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('retries a non-idempotent POST up to the budget on harmless EINVAL before returning 502', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw transientSocketError();
    };

    const response = await handleOdRequest(
      new Request('od://app/api/auth/login', { method: 'POST' }),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; code?: string };
     expect(body.error).toBe('OD_PROTOCOL_PROXY_FAILED');
     expect(body.code).toBe('EINVAL');
      expect(calls).toBe(4);
   });

   it('re-sends the buffered body when retrying a POST on harmless EINVAL', async () => {
    const sentBodies: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      if (calls === 1) throw transientSocketError();
      const req = input as Request;
      sentBodies.push(await req.clone().text());
      return new Response('ok', { status: 200 });
    };

    const response = await handleOdRequest(
      new Request('od://app/api/auth/login', {
        method: 'POST',
        body: '{"user":"a","pass":"b"}',
      }),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(sentBodies).toEqual(['{"user":"a","pass":"b"}']);
  });

  it('does not retry when the upstream resolves with an HTTP 5xx Response', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('upstream says no', { status: 502 });
    };

    const response = await handleOdRequest(
      new Request('od://app/api/projects'),
      'http://127.0.0.1:17579/',
      fetchImpl,
      noDelay,
    );

    // Resolved responses are app-level answers the renderer owns — the
    // web sidecar's own daemon-proxy 502s must reach the SPA untouched.
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('upstream says no');
    expect(calls).toBe(1);
  });

  it('waits the configured backoff between attempts', async () => {
    const waits: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      throw transientSocketError();
    };

    await handleOdRequest(new Request('od://app/'), 'http://127.0.0.1:17579/', fetchImpl, {
      delay: async (ms: number) => {
        waits.push(ms);
      },
    });

      expect(waits).toEqual([200, 400, 600]);
   });
 });

// The packaged `od://` proxy only ever targets the local web sidecar
// (127.0.0.1:9529). Clients with a system / env HTTP proxy that lacks a
// loopback bypass route the renderer-to-sidecar hop through an external
// proxy that cannot reach 127.0.0.1:9529 — the request throws and
// surfaces as OD_PROTOCOL_PROXY_FAILED on login. The default fetchImpl
// routes loopback targets through a direct undici Agent (no proxy) so
// the hop can never be intercepted, regardless of HTTP_PROXY /
// NODE_USE_ENV_PROXY / Electron session proxy settings.
describe('od:// protocol loopback proxy bypass', () => {
  it('identifies loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(true);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('passes a dispatcher for loopback targets and none for external hosts', async () => {
    const seen: { url: string; dispatcher: unknown }[] = [];
    const baseFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const req = input as Request;
      seen.push({
        url: req.url,
        dispatcher: (init as { dispatcher?: unknown } | undefined)?.dispatcher,
      });
      return new Response('ok', { status: 200 });
    };
    const odFetch = createLoopbackBypassFetch(baseFetch);

    await odFetch(new Request('http://127.0.0.1:9529/api/auth/login'));
    await odFetch(new Request('http://example.com/api/x'));

    // Loopback hop is issued with a direct undici dispatcher so no
    // client proxy can intercept it.
    expect(seen[0]!.dispatcher).toBeTruthy();
     // External hosts keep plain fetch semantics (no dispatcher override).
     expect(seen[1]!.dispatcher).toBeUndefined();
   });
 });

// Transient connection errors (socket hang up, ECONNRESET, ECONNREFUSED,
// EPIPE, UND_ERR_SOCKET, UND_ERR_CLOSED) indicate the connection was
// dropped or refused before the server processed the request — no request
// bytes reached the application layer, so re-issuing is safe even for
// non-idempotent methods. This is the cold-start race on Windows where
// Defender / AV briefly intercepts the loopback connection.
describe('isTransientConnectionError', () => {
  it('recognizes socket hang up by message', () => {
    expect(isTransientConnectionError(new Error('socket hang up'))).toBe(true);
  });

  it('recognizes other side closed by message', () => {
    expect(isTransientConnectionError(new Error('other side closed'))).toBe(true);
  });

  it('recognizes connect ECONNREFUSED by message', () => {
    expect(isTransientConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:9529'))).toBe(true);
  });

  it('recognizes ECONNRESET by code', () => {
    const err = new Error('read ECONNRESET') as NodeJS.ErrnoException;
    err.code = 'ECONNRESET';
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('recognizes ECONNREFUSED by code', () => {
    const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
    err.code = 'ECONNREFUSED';
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('recognizes EPIPE by code', () => {
    const err = new Error('write EPIPE') as NodeJS.ErrnoException;
    err.code = 'EPIPE';
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('recognizes UND_ERR_SOCKET by code', () => {
    const err = new Error('Socket closed') as NodeJS.ErrnoException;
    err.code = 'UND_ERR_SOCKET';
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('recognizes UND_ERR_CLOSED by code', () => {
    const err = new Error('closed') as NodeJS.ErrnoException;
    err.code = 'UND_ERR_CLOSED';
    expect(isTransientConnectionError(err)).toBe(true);
  });

  it('does not classify a generic error as transient', () => {
    expect(isTransientConnectionError(new Error('internal server error'))).toBe(false);
  });

  it('does not classify an EINVAL setTypeOfService error as transient', () => {
    // That is the harmless socket-option shape, handled separately by
    // isHarmlessSocketOptionError — it must not also match here, or the
    // retry path would double-count it.
    const err = new Error('setTypeOfService EINVAL') as NodeJS.ErrnoException;
    err.code = 'EINVAL';
    expect(isTransientConnectionError(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
    expect(isTransientConnectionError('socket hang up')).toBe(false);
    expect(isTransientConnectionError({ message: 'socket hang up' })).toBe(false);
  });
});
