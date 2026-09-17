import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import { URL } from 'url';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 动态读取代理（支持 .env 由 config.ts 注入 process.env 后生效）
function getHttpsProxy() { return process.env.HTTPS_PROXY || process.env.https_proxy || ''; }
function getHttpProxy()  { return process.env.HTTP_PROXY  || process.env.http_proxy  || getHttpsProxy(); }

// 默认无需走代理的内网域名。海康 SSO（sso.hikvision.com / *.hikvision.com.cn）
// 解析到内网 IP，若强行走企业代理，其对内网 https 主机的 CONNECT 隧道会在 TLS
// 握手阶段被 RST（Mac 上表现为 ECONNRESET，最终 SSO 登录 500）。Windows 上通常
// 未设 HTTPS_PROXY 或已排除内网，所以直连正常。这里默认排除，等价于 Windows 行为。
const DEFAULT_NO_PROXY = ['hikvision.com', 'hikvision.com.cn'];

/**
 * 判断给定 host 是否应绕过代理（直连）。
 * 规则来源：环境变量 NO_PROXY / no_proxy（逗号分隔，支持前导点与通配符 *），
 * 叠加 DEFAULT_NO_PROXY，以及 localhost / 私网段 / 未限定内网主机名。
 * 语义遵循 curl/常见 http 客户端：条目为后缀匹配（`.foo.com` 与 `foo.com` 均匹配子域）。
 */
export function shouldBypassProxy(host: string): boolean {
  const h = host.toLowerCase();

  // localhost 与回环
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;

  // 明显的私网 IPv4 段（内网直连，代理无意义）
  if (
    /^10\./.test(h) ||
    /^127\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return true;
  }

  const rawList = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const entries = [...rawList, ...DEFAULT_NO_PROXY];

  for (const entryRaw of entries) {
    let entry = entryRaw.toLowerCase();
    if (entry === '*') return true;
    // 去掉前导点或通配符前缀，统一按后缀匹配
    entry = entry.replace(/^\*?\.?/, '');
    if (!entry) continue;
    if (h === entry || h.endsWith('.' + entry)) return true;
  }
  return false;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
}

export interface RawResult {
  finalUrl: string;
  body: string;
  status: number;
  headers?: any;
  cookies: Cookie[];
}

type RawRequestBody = string | Buffer;

export function parseCookieHeaders(headers: string[], baseUrl: string): Cookie[] {
  const result: Cookie[] = [];
  const urlObj = new URL(baseUrl);
  for (const h of headers) {
    const parts = h.split(';').map((p) => p.trim());
    const firstPart = parts[0];
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx < 0) continue;
    const name = firstPart.slice(0, eqIdx);
    const value = firstPart.slice(eqIdx + 1);
    let domain = urlObj.hostname;
    for (const p of parts.slice(1)) {
      if (p.toLowerCase().startsWith('domain=')) {
        let d = p.slice(7);
        if (d.startsWith('.')) d = d.slice(1);
        domain = d;
        break;
      }
    }
    result.push({ name, value, domain });
  }
  return result;
}

export function cookieHeader(cookies: Cookie[], url: string): string {
  const host = new URL(url).hostname;
  return cookies
    .filter((c) => host === c.domain || host.endsWith('.' + c.domain))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function mergeCookies(existing: Cookie[], incoming: Cookie[]): Cookie[] {
  const result = [...existing];
  for (const nc of incoming) {
    const idx = result.findIndex((c) => c.name === nc.name && c.domain === nc.domain);
    if (idx >= 0) result[idx] = nc;
    else result.push(nc);
  }
  return result;
}

// ── Decode chunked transfer-encoding ────────────────────────────
function decodeChunked(buf: Buffer): string {
  const out: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const crlf = buf.indexOf('\r\n', pos);
    if (crlf < 0) break;
    const size = parseInt(buf.slice(pos, crlf).toString().trim(), 16);
    if (isNaN(size) || size === 0) break;
    pos = crlf + 2;
    if (pos + size > buf.length) break;
    out.push(buf.slice(pos, pos + size));
    pos += size + 2;
  }
  return Buffer.concat(out).toString('utf8');
}

// ── Establish HTTPS CONNECT tunnel through HTTP proxy ───────────
function connectTunnel(
  proxyStr: string,
  targetHost: string,
  targetPort: number,
  callback: (err: Error | null, sock: tls.TLSSocket | null) => void,
): void {
  const p = new URL(proxyStr);
  const raw = net.createConnection(Number(p.port) || 80, p.hostname);
  let finished = false;
  const done = (err: Error | null, sock: tls.TLSSocket | null) => {
    if (finished) return;
    finished = true;
    callback(err, sock);
  };

  raw.setTimeout(15000, () => { raw.destroy(); done(new Error('Proxy CONNECT timeout'), null); });
  raw.once('error', (e) => done(e, null));
  raw.once('close', () => done(new Error('Proxy CONNECT connection closed'), null));

  raw.once('connect', () => {
    raw.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    let hdr = '';
    const onHdr = (chunk: Buffer) => {
      hdr += chunk.toString('latin1');
      if (!hdr.includes('\r\n\r\n')) return;
      raw.removeListener('data', onHdr);
      raw.removeAllListeners('close');
      if (!/^HTTP\/[\d.]+ 200/.test(hdr)) {
        raw.destroy();
        return done(new Error(`CONNECT refused: ${hdr.split('\r\n')[0]}`), null);
      }
      const tlsSock = tls.connect({ socket: raw, servername: targetHost, rejectUnauthorized: false });
      tlsSock.setTimeout(30000, () => { tlsSock.destroy(); done(new Error('TLS handshake timeout'), null); });
      tlsSock.once('secureConnect', () => done(null, tlsSock));
      tlsSock.once('error', (e) => done(e, null));
    };
    raw.on('data', onHdr);
  });
}

// ── Make one HTTP/1.1 request over a TLS socket (no redirect) ───
function rawTlsRequest(
  tlsSock: tls.TLSSocket,
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: RawRequestBody | undefined,
  callback: (err: Error | null, result: { status: number; location: string | undefined; setCookies: string[]; body: string } | null) => void,
): void {
  const port = url.port ? parseInt(url.port) : 443;
  const hostHeader = url.hostname + (port !== 443 ? `:${port}` : '');
  const allHeaders: Record<string, string> = { Host: hostHeader, Connection: 'close', ...headers };
  if (body) {
    allHeaders['Content-Type'] = allHeaders['Content-Type'] || 'application/x-www-form-urlencoded';
    allHeaders['Content-Length'] = String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body));
  }

  const reqLine = `${method} ${url.pathname + url.search} HTTP/1.1\r\n`;
  const hdrBlock = Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  tlsSock.write(reqLine + hdrBlock + '\r\n\r\n');
  if (body) tlsSock.write(body);

  const chunks: Buffer[] = [];
  let finished = false;
  const done = (err: Error | null, result: { status: number; location: string | undefined; setCookies: string[]; body: string } | null) => {
    if (finished) return;
    finished = true;
    tlsSock.destroy();
    callback(err, result);
  };

  const timer = setTimeout(() => done(new Error('TLS request timeout'), null), 30000);

  tlsSock.on('data', (c: Buffer) => chunks.push(c));
  tlsSock.once('end', () => {
    clearTimeout(timer);
    if (finished) return;
    const buf = Buffer.concat(chunks);
    const hdrEnd = buf.indexOf('\r\n\r\n');
    if (hdrEnd < 0) { return done(new Error('No HTTP header'), null); }

    const hdrPart = buf.slice(0, hdrEnd).toString();
    const bodyBuf = buf.slice(hdrEnd + 4);
    const lines = hdrPart.split('\r\n');
    const firstLine = lines[0];
    if (!firstLine) { return done(new Error('No HTTP header'), null); }
    const m:any = firstLine.match(/^HTTP\/[\d.]+ (\d+)/);
    const status = m ? parseInt(m[1]) : 0;

    const setCookies: string[] = [];
    let location: string | undefined;
    let isChunked = false;
    for (const line of lines.slice(1)) {
      const lower = line.toLowerCase();
      if (lower.startsWith('set-cookie:')) setCookies.push(line.slice(11).trim());
      else if (lower.startsWith('location:')) location = line.slice(9).trim();
      else if (lower === 'transfer-encoding: chunked') isChunked = true;
    }
    const bodyStr = isChunked ? decodeChunked(bodyBuf) : bodyBuf.toString('utf8');
    done(null, { status, location, setCookies, body: bodyStr });
  });
  tlsSock.once('error', (e) => { clearTimeout(timer); done(e, null); });
}

export function rawRequest(
  method: string,
  urlStr: string,
  cookies: Cookie[],
  opts: { body?: RawRequestBody; extraHeaders?: Record<string, string> } = {},
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const doReq = (m: string, u: string, jar: Cookie[], redirects = 0) => {
      if (redirects > 15) return reject(new Error('Too many redirects'));
      const url = new URL(u);
      const isHttps = url.protocol === 'https:';
      const cookieStr = cookieHeader(jar, u);
      const headers: Record<string, string> = {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...opts.extraHeaders,
      };
      if (cookieStr) headers['Cookie'] = cookieStr;
      const requestBody = redirects === 0 && opts.body !== undefined ? opts.body : undefined;
      if (requestBody !== undefined) {
        // Only set default Content-Type if not already provided via extraHeaders
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = String(Buffer.isBuffer(requestBody) ? requestBody.length : Buffer.byteLength(requestBody, 'utf8'));
      }

      const bypassProxy = shouldBypassProxy(url.hostname);

      // ── Direct request (shared by proxy fallback and no-proxy path) ──
      const doDirect = () => {
        const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
        const req = mod.request(
          {
            hostname: url.hostname,
            port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
            path: url.pathname + url.search,
            method: redirects === 0 ? m : 'GET',
            headers,
            rejectUnauthorized: false,
          },
          (res) => {
            const rawCookies = ([] as string[]).concat((res.headers['set-cookie'] as string[]) || []);
            const newCookies = parseCookieHeaders(rawCookies, u);
            jar = mergeCookies(jar, newCookies);

            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const next = new URL(res.headers.location as string, u).toString();
              res.resume();
              return doReq('GET', next, jar, redirects + 1);
            }

            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({
                finalUrl: u,
                body: Buffer.concat(chunks).toString('utf8'),
                status: res.statusCode || 0,
                headers: res.headers,
                cookies: jar,
              }),
            );
            res.on('error', reject);
          },
        );
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        if (requestBody !== undefined) req.write(requestBody);
        req.end();
      };

      // ── HTTPS via CONNECT proxy tunnel ──────────────────────────
      const httpsProxy = getHttpsProxy();
      if (isHttps && httpsProxy && !bypassProxy) {
        const targetPort = url.port ? parseInt(url.port) : 443;
        connectTunnel(httpsProxy, url.hostname, targetPort, (err, tlsSock) => {
          if (err || !tlsSock) {
            // 代理隧道失败时，如果目标在内网白名单，fallback 到直连
            if (bypassProxy) {
              return doDirect();
            }
            return reject(err || new Error('Tunnel failed'));
          }
          rawTlsRequest(tlsSock, redirects === 0 ? m : 'GET', url, headers, requestBody, (e2, res) => {
            if (e2 || !res) return reject(e2 || new Error('Request failed'));
            const newCookies = parseCookieHeaders(res.setCookies, u);
            const updatedJar = mergeCookies(jar, newCookies);
            if (res.status >= 300 && res.status < 400 && res.location) {
              doReq('GET', new URL(res.location, u).toString(), updatedJar, redirects + 1);
              return;
            }
            resolve({ finalUrl: u, body: res.body, status: res.status, cookies: updatedJar });
          });
        });
        return;
      }

      // ── HTTP via proxy (absolute-URI request) ───────────────────
      const httpProxy = getHttpProxy();
      if (!isHttps && httpProxy && !bypassProxy) {
        const p = new URL(httpProxy);
        const absPath = u; // absolute URL as request target
        const reqM = redirects === 0 ? m : 'GET';
        const req = http.request(
          {
            hostname: p.hostname,
            port: Number(p.port) || 80,
            path: absPath,
            method: reqM,
            headers: { ...headers, Host: url.hostname },
          },
          (res) => {
            const rawCookies = ([] as string[]).concat((res.headers['set-cookie'] as string[]) || []);
            const newCookies = parseCookieHeaders(rawCookies, u);
            jar = mergeCookies(jar, newCookies);
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const next = new URL(res.headers.location as string, u).toString();
              res.resume();
              return doReq('GET', next, jar, redirects + 1);
            }
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({ finalUrl: u, body: Buffer.concat(chunks).toString('utf8'), status: res.statusCode || 0, cookies: jar }),
            );
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        if (requestBody !== undefined) req.write(requestBody);
        req.end();
        return;
      }

      // ── Direct HTTP / HTTPS (no proxy) ───────────────────────────
      doDirect();
    };
    doReq(method, urlStr, [...cookies]);
  });
}
