import type { Express } from 'express';
import multer from 'multer';
import * as https from 'node:https';
import * as http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  rawRequest,
  cookieHeader,
  shouldBypassProxy,
  type Cookie,
} from '../../../http/http.js';
import { readSsoConfigFile } from '../../../http/hik_logins/hicoo.js';
import { HIKKE_ORIGIN } from '../../../http/hik_logins/hikke.js';

/**
 * 海客（Hikke）需求业务路由。
 *
 * 这些接口复用 SSO 登录后写入本地的 session，从中取出 hikke 会话 token
 * 与 cookie 鉴权海客需求侧接口。session 由 `apps/daemon/src/routes/auth.ts`
 * 在登录时写入（SSO 登录成功后顺带登录海客）。
 *
 * 上游基址：`https://hikke.hikvision.com.cn/hikke-minder`
 * - 需求服务：`/minder-demand/v1/`
 * - 需求分类服务：`/minder-demand-class/v1/`
 */

export interface RegisterHikHikkeRoutesDeps {
  dataDir: string;
  sendApiError: (...args: any[]) => any;
}

const HIKKE_MINDER_BASE = `${HIKKE_ORIGIN}/hikke-minder`;

/** 创建/更新需求接口。 */
const HIKKE_DEMAND_URL = `${HIKKE_MINDER_BASE}/minder-demand/v1/demand`;
/** 查询单条需求接口。 */
const HIKKE_DEMAND_ONE_URL = `${HIKKE_MINDER_BASE}/minder-demand/v1/demand`;
/** 查询需求分类树接口。 */
const HIKKE_DEMAND_CLASS_URL = `${HIKKE_MINDER_BASE}/minder-demand-class/v1/demand-class`;

/**
 * 反馈需求默认落点。海客前端「反馈」对话框硬编码这两个值，把反馈需求
 * 挂到固定的反馈项目中心节点下。可通过环境变量覆盖。
 *
 * 默认项目 `81137` 即「Hi Design 需求聚集地」（用户当前打开的海客项目）。
 * parentId 默认指向该项目下的「未关联需求」根节点，让反馈落到
 * `requests/unrelate` 列表。两者均可通过环境变量覆盖。
 */
const HIKKE_FEEDBACK_PROJECT_ID = process.env.HIKKE_FEEDBACK_PROJECT_ID || '81137';
const HIKKE_FEEDBACK_PARENT_ID = process.env.HIKKE_FEEDBACK_PARENT_ID || '6ad06a12a44aa23d2923f2ca';

/**
 * 海客附件上传 / 下载基址。海客前端把附件落到 hikke-blue / hikke-red 两个
 * 网络类型站点，默认 BLUE。上传接口收 multipart `file` 字段，返回
 * `[{bizNo, originName, ...}]`；下载用 `/hikkeapi/download?bizNo=…&flag=…`。
 * 可通过环境变量切到 RED 站点。
 */
const HIKKE_UPLOAD_HOST = process.env.HIKKE_UPLOAD_HOST || 'https://hikke-blue.hikvision.com.cn';
const HIKKE_UPLOAD_PATH = '/hikkeapi/upload';
const HIKKE_DOWNLOAD_PATH = '/hikkeapi/download';
const HIKKE_NET_TYPE = process.env.HIKKE_NET_TYPE || 'BLUE';

/** multer 单例：memoryStorage 把上传的文件留在内存，便于重组 multipart 透传上游。 */
const hikkeUpload = multer({ storage: multer.memoryStorage() }).single('file');

/**
 * 透传一个 multipart/form-data POST 到海客附件上游。
 *
 * 不复用 `rawRequest`：它把整个 body `toString('utf8')` 缓存再返回，会破坏
 * 二进制流。这里手动拼 multipart boundary，用原生 https/http 模块把 Buffer
 * 写出去，上游响应整体缓存为字符串返回（上传响应是 JSON，体量小）。
 *
 * 边界、Content-Disposition、Content-Type 都按 RFC 2388 拼；文件名带非 ASCII
 * 字符时按 RFC 5987 编码，避免上游 Java/Tomcat 按 ISO-8859-1 解析成乱码。
 */
function forwardHikkeMultipart(
  urlStr: string,
  hikkeToken: string,
  cookies: Cookie[],
  file: { name: string; data: Buffer; contentType: string },
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const boundary = '----OpenDesignHikke' + Math.random().toString(16).slice(2);
    const fn = file.name;
    const asciiFn = fn.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
    const pctFn = encodeURIComponent(fn);
    const chunks: Buffer[] = [
      Buffer.from(`--${boundary}\r\n`, 'utf8'),
      Buffer.from(
        `Content-Disposition: form-data; name="file"; filename="${asciiFn}"; filename*=UTF-8''${pctFn}\r\n`,
        'utf8',
      ),
      Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`, 'utf8'),
      file.data,
      Buffer.from('\r\n', 'utf8'),
      Buffer.from(`--${boundary}--\r\n`, 'utf8'),
    ];
    const body = Buffer.concat(chunks);
    const headers: Record<string, string> = {
      ...hikkeHeaders(hikkeToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    };
    const cookieStr = cookieHeader(cookies, urlStr);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const opts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      rejectUnauthorized: false,
    };
    const handleResp = (resp: any) => {
      const data: Buffer[] = [];
      resp.on('data', (c: Buffer) => data.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(data);
        const ct = resp.headers?.['content-type'] || '';
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || 'utf-8';
        let responseBody: string;
        if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
          try { responseBody = new TextDecoder('gbk').decode(buf); }
          catch { responseBody = buf.toString('utf8'); }
        } else {
          responseBody = buf.toString('utf8');
        }
        resolve({ body: responseBody, status: resp.statusCode || 0 });
      });
      resp.on('error', (e: any) => reject(new Error('hikke upload response error: ' + (e?.message || String(e)))));
    };
    const bypass = shouldBypassProxy(url.hostname);
    const proxy = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || '');
    let req: http.ClientRequest;
    if (proxy && !bypass) {
      // 走代理时仍用 mod.request（CONNECT 隧道由上层代理处理）；这里与 uedro
      // 的 forwardMultipart 保持一致：上传场景体量小，直接走 mod.request 即可。
      req = mod.request(opts, handleResp);
    } else {
      req = mod.request(opts, handleResp);
    }
    req.setTimeout(120000, () => { req.destroy(new Error('hikke upload timeout')); });
    req.on('error', (e: any) => reject(new Error('hikke upload failed: ' + (e?.message || String(e)))));
    req.end(body);
  });
}

/**
 * 透传一个 GET 请求到海客附件上游，返回原始 Buffer + Content-Type。
 *
 * 用于图片下载代理：反馈对话框在 localhost 跨域请求海客图片不会带 cookie，
 * 浏览器直接请求会 401。这里由 daemon 带上 hikke token + cookie 转发，
 * 把上游响应原样返回给前端（包括 Content-Type / body）。
 */
function forwardHikkeDownload(
  urlStr: string,
  hikkeToken: string,
  cookies: Cookie[],
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const headers: Record<string, string> = {
      ...hikkeHeaders(hikkeToken),
      Accept: 'image/png,image/jpeg,image/gif,image/*,*/*;q=0.8',
    };
    const cookieStr = cookieHeader(cookies, urlStr);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const opts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
      path: url.pathname + url.search,
      method: 'GET',
      headers,
      rejectUnauthorized: false,
    };
    const req = mod.request(opts, (resp) => {
      const data: Buffer[] = [];
      resp.on('data', (c: Buffer) => data.push(c));
      resp.on('end', () => {
        resolve({ status: resp.statusCode || 0, headers: resp.headers, body: Buffer.concat(data) });
      });
      resp.on('error', (e: any) => reject(new Error('hikke download response error: ' + (e?.message || String(e)))));
    });
    req.setTimeout(60000, () => { req.destroy(new Error('hikke download timeout')); });
    req.on('error', (e: any) => reject(new Error('hikke download failed: ' + (e?.message || String(e)))));
    req.end();
  });
}

/**
 * 把反馈内容 HTML 中的 daemon 下载代理 URL 替换成海客原始下载 URL。
 *
 * TinyMCE 编辑器里图片 src 是 `/api/hik/hikke/download?bizNo=…&flag=BLUE`
 * （通过 daemon 代理才能在 localhost 跨域显示）。提交到海客后，海客页面
 * 同源访问 `hikke-blue.hikvision.com.cn` 会自带 cookie，所以要把代理 URL
 * 还原成海客原始 URL，否则海客页面访问不到 daemon。
 */
function rewriteImageUrls(html: string): string {
  // TinyMCE 的 convert_urls 默认会把相对路径 `/api/hik/hikke/download?…` 转成
  // 绝对路径 `http://127.0.0.1:PORT/api/hik/hikke/download?…`（基于 document base）。
  // 所以这里要匹配可选的 protocol://host 前缀，整段替换成海客原始下载 URL。
  // 同时处理 TinyMCE 输出 HTML 时把 `&` 编码成 `&amp;` 的情况。
  const proxyPattern = /(?:https?:\/\/[^/"'\s>]+)?\/api\/hik\/hikke\/download\?([^"'\s>]*)/g;
  return html.replace(proxyPattern, (_match, queryStr: string) => {
    const decoded = queryStr.replace(/&amp;/g, '&');
    const params = new URLSearchParams(decoded);
    const bizNo = params.get('bizNo') || '';
    const flag = params.get('flag') || HIKKE_NET_TYPE;
    const host = flag.toUpperCase() === 'RED' ? 'https://hikke-red.hikvision.com.cn' : HIKKE_UPLOAD_HOST;
    return `${host}${HIKKE_DOWNLOAD_PATH}?bizNo=${encodeURIComponent(bizNo)}&flag=${flag}`;
  });
}

/** 从本地 SSO session 取出海客会话 token + cookie；缺失时返回 null。 */
function readHikkeSession(
  dataDir: string,
): { hikkeToken: string; cookies: Cookie[]; userInfo: Record<string, unknown> } | null {
  const session = readSsoConfigFile(dataDir);
  const hikke = session?.hikke;
  if (!hikke?.hikkeToken) return null;
  const cookies = hikke.cookies?.length ? hikke.cookies : [];
  const userInfo = (hikke.userInfo ?? {}) as Record<string, unknown>;
  return { hikkeToken: hikke.hikkeToken, cookies, userInfo };
}

/** 构造海客上游请求头：Authorization + 浏览器同源头 + 语言。 */
function hikkeHeaders(hikkeToken: string): Record<string, string> {
  return {
    Authorization: hikkeToken,
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    Origin: HIKKE_ORIGIN,
    Referer: `${HIKKE_ORIGIN}/`,
    'X-Requested-With': 'XMLHttpRequest',
    lang: 'zh-CN',
  };
}

export function registerHikHikkeRoutes(app: Express, deps: RegisterHikHikkeRoutesDeps): void {
  const { dataDir, sendApiError } = deps;

  /**
   * GET /api/hik/hikke/session — 返回本地海客会话信息（用户资料 + 反馈落点）。
   *
   * 前端反馈对话框用它判断是否已登录海客，并取当前用户作为创建人展示。
   * 未登录时返回 401，前端引导用户重新登录。
   */
  app.get('/api/hik/hikke/session', async (_req, res) => {
    const hikke = readHikkeSession(dataDir);
    if (!hikke) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
    }
    return res.json({
      ok: true,
      data: {
        userInfo: hikke.userInfo,
        feedbackProjectId: HIKKE_FEEDBACK_PROJECT_ID,
        feedbackParentId: HIKKE_FEEDBACK_PARENT_ID,
      },
    });
  });

  /**
   * GET /api/hik/hikke/demand-class?projectId=… — 查询需求分类树。
   *
   * 透传上游 `GET /minder-demand-class/v1/demand-class?projectId=…`，
   * 上游 `data` 为分类节点数组（每项含 id / text / classCount / children）。
   * 前端反馈对话框用它填充「反馈类别」下拉。
   */
  app.get('/api/hik/hikke/demand-class', async (req, res) => {
    const hikke = readHikkeSession(dataDir);
    if (!hikke) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
    }
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    if (!projectId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    }

    const upstreamUrl = new URL(HIKKE_DEMAND_CLASS_URL);
    upstreamUrl.searchParams.set('projectId', projectId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), hikke.cookies, {
        extraHeaders: hikkeHeaders(hikke.hikkeToken),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'hikke demand-class bad response');
      }
      return res.json({ ok: upstream?.code === '0' || upstream?.success === true, msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'hikke demand-class failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * GET /api/hik/hikke/demand/:id — 查询单条需求详情。
   *
   * 透传上游 `GET /minder-demand/v1/demand/:id`。
   */
  app.get('/api/hik/hikke/demand/:id', async (req, res) => {
    const hikke = readHikkeSession(dataDir);
    if (!hikke) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
    }
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'id is required');
    }

    try {
      const result = await rawRequest('GET', `${HIKKE_DEMAND_ONE_URL}/${id}`, hikke.cookies, {
        extraHeaders: hikkeHeaders(hikke.hikkeToken),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'hikke demand detail bad response');
      }
      return res.json({ ok: upstream?.code === '0' || upstream?.success === true, msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'hikke demand detail failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/hikke/demand — 创建一条需求（createOrUpdate）。
   *
   * 透传上游 `POST /minder-demand/v1/demand`，请求体即海客前端创建需求表单
   * 提交的 demand 对象。调用方需提供：
   * - text：需求标题
   * - description：富文本内容（HTML）
   * - projectId：所属项目 ID
   * - demandClassId：需求分类 ID（可空）
   * - parentId：父需求 ID（反馈场景下为反馈中心节点）
   *
   * initialEditType / processors / priorityLevel 由本路由对齐海客前端默认值，
   * 调用方可覆盖。未登录或无 hikke token 时返回 401。
   */
  app.post('/api/hik/hikke/demand', async (req, res) => {
    const hikke = readHikkeSession(dataDir);
    if (!hikke) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
    }

    const body = (req.body ?? {}) as Record<string, any>;
    const text = typeof body.text === 'string' ? body.text : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    if (!text) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'text (title) is required');
    }
    if (!projectId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    }

    // 反馈内容里的图片 src 是 daemon 下载代理 URL（/api/hik/hikke/download?…），
    // 提交到海客前要还原成海客原始下载 URL，否则海客页面访问不到 daemon。
    const rewrittenDescription = rewriteImageUrls(description);

    // 对齐海客前端创建需求表单的默认 demand 对象结构。
    const upstreamBody = JSON.stringify({
      text,
      description: rewrittenDescription,
      initialEditType: typeof body.initialEditType === 'string' ? body.initialEditType : 'wysiwyg',
      processors: Array.isArray(body.processors) ? body.processors : [],
      priorityLevel: typeof body.priorityLevel === 'number' ? body.priorityLevel : 0,
      projectId,
      parentId: typeof body.parentId === 'string' ? body.parentId : '',
      demandClassId: typeof body.demandClassId === 'string' ? body.demandClassId : '',
      ...(body.extra ? body.extra : {}),
    });

    try {
      const result = await rawRequest('POST', HIKKE_DEMAND_URL, hikke.cookies, {
        body: upstreamBody,
        extraHeaders: hikkeHeaders(hikke.hikkeToken),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'hikke create demand bad response');
      }
      return res.json({ ok: upstream?.code === '0' || upstream?.success === true, msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'hikke create demand failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/hikke/upload — 上传附件（图片/文件）到海客附件服务。
   *
   * 透传上游 `POST {hikke-blue|hikke-red}/hikkeapi/upload?flag={BLUE|RED}`，
   * 前端发 multipart（含 `file` 字段），daemon 用 multer memoryStorage 接收，
   * 再以原生 https 模块把 multipart 重组成流透传上游——不能复用 `rawRequest`，
   * 因其把 body `toString('utf8')` 会破坏二进制流。
   *
   * 上游返回数组 `[{bizNo, originName, ...}]`，本路由归一成
   * `{url, name, bizNo, originName}`，其中 `url` 是相对下载路径
   * （`/hikkeapi/download?bizNo=…&flag=…`），前端展示时拼到对应 flag 站点。
   * 未登录或无 hikke token 时返回 401。
   */
  app.post('/api/hik/hikke/upload', (req, res) => {
    hikkeUpload(req, res, (err) => {
      if (err) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'hikke upload receive failed: ' + (err?.message || String(err)));
      }
      void (async () => {
        const hikke = readHikkeSession(dataDir);
        if (!hikke) {
          return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
        }
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file || !file.buffer?.length) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
        }

        const uploadUrl = `${HIKKE_UPLOAD_HOST}${HIKKE_UPLOAD_PATH}?flag=${HIKKE_NET_TYPE}`;
        try {
          const { body, status } = await forwardHikkeMultipart(
            uploadUrl,
            hikke.hikkeToken,
            hikke.cookies,
            { name: file.originalname, data: file.buffer, contentType: file.mimetype || 'application/octet-stream' },
          );
          let upstream: any;
          try {
            upstream = JSON.parse(body);
          } catch {
            return sendApiError(res, 502, 'BAD_GATEWAY', 'hikke upload bad response (status=' + status + ')');
          }
          const arr = Array.isArray(upstream?.data) ? upstream.data : (Array.isArray(upstream) ? upstream : null);
          const first = arr?.[0];
          if (!first?.bizNo) {
            return sendApiError(res, 502, 'BAD_GATEWAY', upstream?.msg || 'hikke upload empty bizNo');
          }
          const downloadUrl = `${HIKKE_DOWNLOAD_PATH}?bizNo=${encodeURIComponent(first.bizNo)}&flag=${HIKKE_NET_TYPE}`;
          return res.json({
            ok: true,
            data: {
              url: downloadUrl,
              absoluteUrl: `${HIKKE_UPLOAD_HOST}${downloadUrl}`,
              name: first.originName || file.originalname,
              bizNo: first.bizNo,
              originName: first.originName,
            },
          });
        } catch (err: any) {
          return sendApiError(res, 500, 'INTERNAL_ERROR', 'hikke upload failed: ' + (err?.message || String(err)));
        }
      })();
    });
  });

  /**
   * GET /api/hik/hikke/download?bizNo=…&flag=… — 附件下载代理。
   *
   * 透传上游 `GET {hikke-blue|hikke-red}/hikkeapi/download?bizNo=…&flag=…`，
   * 带上 hikke token + cookie。用于反馈对话框里 TinyMCE 编辑器显示图片：
   * 浏览器在 localhost 跨域请求海客图片不会带 cookie，直接请求会 401，
   * 这里由 daemon 代理转发。
   *
   * 响应原样返回上游的 Content-Type / body（二进制流）。
   */
  app.get('/api/hik/hikke/download', async (req, res) => {
    const hikke = readHikkeSession(dataDir);
    if (!hikke) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'hikke session not found, please login first');
    }
    const bizNo = typeof req.query.bizNo === 'string' ? req.query.bizNo : '';
    const flag = typeof req.query.flag === 'string' ? req.query.flag : HIKKE_NET_TYPE;
    if (!bizNo) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'bizNo is required');
    }
    const host = flag.toUpperCase() === 'RED' ? 'https://hikke-red.hikvision.com.cn' : HIKKE_UPLOAD_HOST;
    const downloadUrl = `${host}${HIKKE_DOWNLOAD_PATH}?bizNo=${encodeURIComponent(bizNo)}&flag=${encodeURIComponent(flag)}`;
    try {
      const result = await forwardHikkeDownload(downloadUrl, hikke.hikkeToken, hikke.cookies);
      if (result.status !== 200) {
        return sendApiError(res, 502, 'BAD_GATEWAY', `hikke download upstream status ${result.status}`);
      }
      const ct = result.headers['content-type'] || 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(result.body);
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'hikke download failed: ' + (err?.message || String(err)));
    }
  });
}
