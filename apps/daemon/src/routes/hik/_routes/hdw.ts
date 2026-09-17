import type { Express } from 'express';
import * as https from 'node:https';
import * as http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { UA, shouldBypassProxy } from '../../../http/http.js';
import { HDW_BASE } from '../../../http/hdw.js';
import { readSsoConfigFile } from '../../../http/hik_logins/hicoo.js';

/**
 * Hidesign-Web (HDW) API 反向代理路由。
 *
 * 把前端 `/api/hdw/*` 请求透传到上游 HDW 后端。上游地址按运行环境自动选择：
 * 支持 GET / POST / PUT / DELETE / PATCH，透传请求体（JSON / form /
 * multipart）与 query string，原样返回上游响应（状态码、headers、body）。
 * 二进制响应（文件流、图片）逐块 pipe，不缓存进内存。
 */

export interface RegisterHdwRoutesDeps {
  sendApiError: (...args: any[]) => any;
  /** Daemon data root — used to read SSO cookies for upstream auth. */
  dataDir?: string;
}

export function registerHdwRoutes(app: Express, deps: RegisterHdwRoutesDeps): void {
 const { sendApiError, dataDir } = deps;
 app.use('/api/hdw/api', createHdwProxyHandler(sendApiError, dataDir));
 // Public share-link viewer: /api/hdw/share/:token -> HDW /hdw/share/:token
 app.use('/api/hdw/share', createHdwProxyHandler(sendApiError, dataDir, '/share'));
}

/** 需要透传给上游的请求头白名单（小写匹配）。 */
const FORWARD_HEADERS = new Set([
  'content-type',
  'content-length',
  'authorization',
  'accept',
  'accept-language',
  'x-requested-with',
  'x-csrf-token',
  'origin',
  'referer',
]);

function createHdwProxyHandler(
  sendApiError: (...args: any[]) => any,
  dataDir?: string,
  pathSuffix?: string,
) {
 return (req: any, res: any) => {
   // Express app.use('/api/hdw/api', ...) 剥掉 mount 前缀后，req.url 形如
   // `/test?key=val`。拼到 HDW_BASE 的 pathname 后面即可。
   const base = new URL(HDW_BASE);
   const basePath = base.pathname.replace(/\/+$/, '');
    // Default pathSuffix is '' (HDW_BASE already ends with /api).
    // For share-link viewer, pathSuffix is '/share' so the target becomes
    // .../hdw/share/:token instead of .../hdw/api/:token.
    const suffix = pathSuffix || '';
    const targetPath = `${basePath}${suffix}${req.url}`;
   const targetUrl = new URL(targetPath, base.origin);
   proxyToUpstream(req, res, targetUrl, sendApiError, dataDir);
 };
}

function proxyToUpstream(
  req: any,
  res: any,
  targetUrl: URL,
  sendApiError: (...args: any[]) => any,
  dataDir?: string,
): void {
  const doReq = (u: URL, redirects: number) => {
    if (redirects > 15) {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', 'hdw proxy too many redirects');
      return;
    }

    const isHttps = u.protocol === 'https:';
    const method = req.method || 'GET';

    // 从前端请求头里挑白名单字段透传，其余用默认值。
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
    if (method !== 'GET') {
      headers['Accept'] = '*/*';
    } else {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
    for (const [key, val] of Object.entries(req.headers || {})) {
      if (FORWARD_HEADERS.has(key.toLowerCase())) {
        headers[key] = String(val);
      }
    }

    // 当前端请求未携带 authorization 时，注入本地 SSO cookie 进行认证，
    // 与 `http/hdw.ts` 和 `integrations/hdw-cloud.ts` 的 cookie 回退逻辑一致。
    if (!headers['authorization'] && !headers['Authorization'] && dataDir) {
      try {
        const sso = readSsoConfigFile(dataDir);
        if (sso?.cookies?.length) {
          headers['Cookie'] = sso.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
        }
      } catch { /* SSO not available — proceed without cookies */ }
    }

    const handleResponse = (resp: any) => {
      const status = resp.statusCode ?? 0;
      // 3xx 重定向：跟随 Location。
      if (status >= 300 && status < 400 && resp.headers.location) {
        const next = new URL(String(resp.headers.location), u);
        resp.resume();
        return doReq(next, redirects + 1);
      }

      const contentType = String(resp.headers['content-type'] || '').toLowerCase();
      const isText =
        contentType.includes('text/') ||
        contentType.includes('application/json') ||
        contentType.includes('application/javascript') ||
        contentType.includes('application/xml');

      // 文本类响应：缓存后整体返回（体量小，多为 JSON）。
      if (isText) {
        const chunks: Buffer[] = [];
        resp.on('data', (c: Buffer) => chunks.push(c));
        resp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!res.headersSent) {
            copyResponseHeaders(resp, res);
            res.status(status);
            res.send(body);
          }
        });
        resp.on('error', () => {
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', 'hdw proxy response error');
        });
        return;
      }

      // 二进制响应：逐块 pipe，不缓存。
      if (!res.headersSent) {
        copyResponseHeaders(resp, res);
        res.status(status);
      }
      resp.pipe(res);
      resp.on('error', () => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', 'hdw proxy stream error');
      });
    };

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);

    const sendUpstream = (body: Buffer | null) => {
      const opts: https.RequestOptions = {
        hostname: u.hostname,
        port: u.port ? parseInt(u.port) : isHttps ? 443 : 80,
        path: u.pathname + u.search,
        method,
        headers,
        rejectUnauthorized: false,
      };
      const upstream = mod.request(opts, handleResponse);
      upstream.setTimeout(30000, () => {
        upstream.destroy();
        if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', 'hdw proxy timeout');
      });
      upstream.on('error', (e: any) => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `hdw proxy failed: ${e?.message || String(e)}`);
      });
      if (body) {
        upstream.end(body);
      } else {
        upstream.end();
      }
    };

    // 收集请求体（非 GET/HEAD）。
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.body !== undefined && req.body !== null) {
        // express.json() / express.urlencoded() 已消费流，直接用 req.body。
        const bodyStr = typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body);
        const bodyBuf = Buffer.isBuffer(bodyStr) ? bodyStr : Buffer.from(bodyStr, 'utf8');
        // 确保 Content-Length 与实际体一致。
        headers['Content-Length'] = String(bodyBuf.length);
        sendUpstream(bodyBuf);
      } else {
        // 流未被消费（如 multipart），从 req 事件读取。
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          headers['Content-Length'] = String(body.length);
          sendUpstream(body);
        });
        req.on('error', (e: any) => {
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `hdw proxy request body error: ${e?.message || String(e)}`);
        });
      }
    } else {
      sendUpstream(null);
    }
  };

  doReq(targetUrl, 0);
}

/** 把上游响应头里需要透传的字段复制给客户端响应。 */
function copyResponseHeaders(upstreamResp: any, res: any): void {
  const passthrough = [
    'content-type',
    'content-disposition',
    'cache-control',
    'etag',
    'last-modified',
    'expires',
  ];
  for (const key of passthrough) {
    const val = upstreamResp.headers[key];
    if (val !== undefined) {
      res.setHeader(key, val);
    }
  }
}
