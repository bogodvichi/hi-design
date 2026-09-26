import type { Express } from 'express';
import multer from 'multer';
import * as https from 'node:https';
import * as http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  rawRequest,
  UA,
  cookieHeader,
  shouldBypassProxy,
  parseCookieHeaders,
  mergeCookies,
  type Cookie,
} from '../../http/http.js';
import { readSsoConfigFile } from '../../http/hik_logins/hicoo.js';
import { UEDRO_BASE, UEDRO_LOGIN_URL, uedroHeaders } from '../../http/hik_logins/uedro.js';

/**
 * 海康 / 羽点（uedro）业务路由。
 *
 * 这些接口复用 SSO 登录后写入本地的 session，从中取出 uedro 会话 cookie
 * 鉴权羽点应用侧接口。session 由 `apps/daemon/src/routes/auth.ts` 在登录时
 * 写入（SSO 登录成功后顺带登录羽点门户）。
 */

export interface RegisterHikUedroRoutesDeps {
  dataDir: string;
  sendApiError: (...args: any[]) => any;
}

/** 羽点评审列表查询接口。 */
const UEDRO_REVIEW_LIST_URL = UEDRO_BASE + '/uedro/web/review/v1/reviewList';

/** 羽点用户列表查询接口。 */
const UEDRO_USER_LIST_URL = UEDRO_BASE + '/uedro/web/user/v1/list';

/** 羽点项目列表查询接口。 */
const UEDRO_PROJECT_LIST_URL = UEDRO_BASE + '/uedro/web/project/v1/projectList';

/** 羽点稿件文件下载接口（GET，返回二进制文件流）。 */
const UEDRO_MANUSCRIPT_FILE_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/getManuscriptFile';

/** 羽点一键催办接口（POST，催促未评审的评委）。 */
const UEDRO_URGE_URL = UEDRO_BASE + '/uedro/web/mail/v1/urge';

/** 羽点评审订阅状态修改接口（GET，开启/关闭通知）。 */
const UEDRO_EDIT_SUBSCRIPTION_URL = UEDRO_BASE + '/uedro/web/review/v1/editSubscriptionStatus';

/** 羽点评审主数据接口（GET，按 reviewId 取评审对象；manuscriptDtos/repeat 为 null）。 */
const UEDRO_REVIEW_ONE_URL = UEDRO_BASE + '/uedro/web/review/v1/oneByReviewId';

/** 羽点评审稿件列表接口（POST，按 reviewId 分页取稿件）。 */
const UEDRO_SUB_PROCESS_URL = UEDRO_BASE + '/uedro/web/review/v1/subProcess';

/** 羽点评委评审进度接口（POST，按评委列出提交状态与缺陷/建议计数）。 */
const UEDRO_REVIEW_PROGRESS_URL = UEDRO_BASE + '/uedro/web/comment/v1/reviewProgress';

/** 羽点评审统计接口（POST，按 reviewId + version 汇总各状态计数）。 */
const UEDRO_PROGRESS_QUANTITY_URL = UEDRO_BASE + '/uedro/web/comment/v1/progressQuantity';

/** 羽点评审名称模板查询接口（GET，按 projectId 返回评审模板 JSON 串数组）。 */
const UEDRO_REVIEW_NAME_URL = UEDRO_BASE + '/uedro/web/review/v1/reviewName';

/** 羽点评审稿上传接口（POST multipart/form-data，返回 manuscriptId 等稿件信息）。 */
const UEDRO_MANUSCRIPT_UPLOAD_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/upload';

/** 羽点评审稿删除接口（GET，按 manuscriptId 删除已上传但未提交的稿件）。 */
const UEDRO_MANUSCRIPT_DELETE_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/deletion';

/** 羽点发起评审接口（POST，提交完整评审表单创建一条评审）。 */
const UEDRO_REVIEW_ADDITION_URL = UEDRO_BASE + '/uedro/web/review/v1/addition';
/** 羽点评审稿追加接口（POST，向已有评审追加一份评审稿）。 */
const UEDRO_MANUSCRIPT_ADDITION_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/addition';
/** 羽点关闭评审接口（POST，结束一条评审）。 */
const UEDRO_REVIEW_FINISH_URL = UEDRO_BASE + '/uedro/web/review/v1/finish';
const UEDRO_REVIEW_REPEAT_URL = UEDRO_BASE + '/uedro/web/review/v1/repeat';
const UEDRO_REVIEW_EDIT_URL = UEDRO_BASE + '/uedro/web/review/v1/edit';
const UEDRO_MANUSCRIPT_REUPLOAD_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/reUpload';
const UEDRO_MANUSCRIPT_REUPLOAD_CONFIRM_URL = UEDRO_BASE + '/uedro/web/manuscript/v1/reUploadConfirm';

/**
 * 反向代理需要重写的上游绝对 URL 前缀。
 *
 * 羽点前端 SPA 的 HTML / JS / CSS 里硬编码了 `https://uedro.hikvision.com.cn`
 * 绝对地址（资源、fetch、window.location 跳转等）。若不重写，浏览器直接访问
 * 原站会跨源，uedro 会话 cookie 带不上。把绝对地址改成同源根相对路径后，
 * 这些请求自然落回本代理，始终同源、cookie 始终随行。
 */
const UEDRO_ABS_ORIGIN = UEDRO_BASE; // https://uedro.hikvision.com.cn

/**
 * 需要做绝对 URL 重写的文本类 content-type 前缀。
 *
 * 二进制（图片、字体、xlsx/docx 文件流）不含可重写的 URL，原样透传。
 * 仅对 text/html、text/css、application/javascript 等文本类做字符串替换。
 */
const REWRITE_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/json',
  'application/x-javascript',
];

/**
 * 评审稿上传 multer 单例：memoryStorage 把文件留在内存，再以 multipart 透传上游。
 * 字段：file（单个文件）+ excelJson（可选文本字段，原站固定传空串）。
 */
const manuscriptUpload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'file', maxCount: 1 },
  { name: 'excelJson', maxCount: 1 },
  { name: 'manuscriptId', maxCount: 1 },
]);

/** 从本地 SSO session 取出羽点会话 cookie；缺失时返回 null 并由调用方回 401。 */
function readUedroCookies(dataDir: string): Cookie[] | null {
  const session = readSsoConfigFile(dataDir);
  const uedroCookies = session?.uedro?.cookies;
  return uedroCookies?.length ? uedroCookies : null;
}

export function registerHikUedroRoutes(app: Express, deps: RegisterHikUedroRoutesDeps): void {
  const { dataDir, sendApiError } = deps;

  /**
   * POST /api/hik/uedro/reviewList — 查询羽点评审列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点评审列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：reviewName / processType / reviewModel / reviewType /
   * pageSize / pageNo / total，缺省值对齐前端默认查询。
   */
  app.post('/api/hik/uedro/reviewList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        reviewName: typeof body.reviewName === 'string' ? body.reviewName : '',
        // processType=0 评审中; 1，我参与的; 2，我发起的; 3，全部;
        processType: typeof body.processType === 'number' ? body.processType : 0,
        reviewModel: typeof body.reviewModel === 'number' ? body.reviewModel : 0,
        /**
         *  reviewType=null 全部; "1" 交互评审; "2" 视觉评审; 
         *  "3" 文稿评审; "4" 表格评审; "5" 海客评审; "10" 插件评审; "11" Pixso Handoff;
        */
        reviewType: typeof body.reviewType === 'string' ? body.reviewType : null,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 9,
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        total: typeof body.total === 'number' ? body.total : 0,
      });

      const result = await rawRequest('POST', UEDRO_REVIEW_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro review list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data?.reviewList,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro review list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/userList — 查询羽点用户列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点用户列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：userName / pageNo / pageSize，缺省值对齐
   * 前端默认查询（pageNo=1, pageSize=30）。
   */
  app.post('/api/hik/uedro/userList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        userName: typeof body.userName === 'string' ? body.userName : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 30,
      });

      const result = await rawRequest('POST', UEDRO_USER_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro user list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro user list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/projectList — 查询羽点项目列表。
   *
   * 从本地 SSO session 取出 uedro 会话 cookie，POST 羽点项目列表接口，
   * 透传上游响应。未登录或无 uedro cookie 时返回 401。
   *
   * 请求体字段与上游一致：projNumOrName / processType / pageNo / pageSize，
   * 缺省值对齐前端默认查询（processType=1, pageNo=1, pageSize=10）。
   */
  app.post('/api/hik/uedro/projectList', async (req, res) => {
    try {
      const session = readSsoConfigFile(dataDir);
      const uedroCookies = session?.uedro?.cookies;
      if (!uedroCookies?.length) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
      }

      const body = (req.body ?? {}) as Record<string, any>;
      const upstreamBody = JSON.stringify({
        projNumOrName: typeof body.projNumOrName === 'string' ? body.projNumOrName : '',
        processType: typeof body.processType === 'number' ? body.processType : 1,
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 10,
      });

      const result = await rawRequest('POST', UEDRO_PROJECT_LIST_URL, uedroCookies, {
        body: upstreamBody,
        extraHeaders: uedroHeaders(uedroCookies),
      });

      // 透传上游响应：code==='0' 视为成功，否则原样返回错误体
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro project list bad response');
      }

      return res.json({
        ok: upstream?.code === '0',
        data: upstream?.data,
      });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro project list failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * GET /api/hik/uedro/downloadManuscript?manuscriptId=… — 下载羽点稿件文件。
   *
   * 透传上游 `GET /uedro/web/manuscript/v1/getManuscriptFile?manuscriptId=…`，
   * 上游返回二进制文件流（xlsx/docx 等）。`rawRequest` 会把 body 转 utf8
   * 破坏二进制，所以这里用原生 https/http 直接把响应流 pipe 给客户端，
   * 透传 content-type / content-disposition（文件名）。
   *
   * 上游若返回 JSON（鉴权失败 / 稿件不存在），content-type 是 application/json，
   * 此时按 JSON 错误体处理而不是当文件下载。3xx 跟随重定向并合并 cookie。
   */
  app.get('/api/hik/uedro/downloadManuscript', (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const manuscriptId = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : '';
    if (!manuscriptId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'manuscriptId is required');
    }

    const upstreamUrl = new URL(UEDRO_MANUSCRIPT_FILE_URL);
    upstreamUrl.searchParams.set('manuscriptId', manuscriptId);
    streamUpstreamGet(upstreamUrl.toString(), uedroCookies, res, sendApiError, 'download manuscript');
  });

  /**
   * POST /api/hik/uedro/urge — 一键催办未评审评委。
   *
   * 透传上游 `POST /uedro/web/mail/v1/urge`，请求体 `{ reviewId }`。
   * 上游响应 `{ code:'0', msg:'success', data:null }`，code !== '0' 视为失败。
   */
  app.post('/api/hik/uedro/urge', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    try {
      const result = await rawRequest('POST', UEDRO_URGE_URL, uedroCookies, {
        body: JSON.stringify({ reviewId }),
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro urge bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro urge failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/editSubscriptionStatus — 开启/关闭评审通知。
   *
   * 透传上游 `GET /uedro/web/review/v1/editSubscriptionStatus?reviewId=…&status=true|false`。
   * 用 POST 形式接受前端请求体 `{ reviewId, status }`，内部转成上游 GET。
   * status=true 开启通知，false 关闭。code !== '0' 视为失败。
   */
  app.post('/api/hik/uedro/editSubscriptionStatus', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
    const status = body.status === true || body.status === 'true';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    const upstreamUrl = new URL(UEDRO_EDIT_SUBSCRIPTION_URL);
    upstreamUrl.searchParams.set('reviewId', reviewId);
    upstreamUrl.searchParams.set('status', String(status));

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro editSubscriptionStatus bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro editSubscriptionStatus failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * GET /api/hik/uedro/reviewOne?reviewId=… — 查询评审主数据。
   *
   * 透传上游 `GET /uedro/web/review/v1/oneByReviewId?reviewId=…`，上游 `data` 即评审
   * 对象（reviewName / reviewType / creator / preReviewEndTimeDate / roles / flowNo 等）。
   * 注意 oneByReviewId 返回的 manuscriptDtos/repeat 为 null，稿件需另调 subProcess。
   * 用 GET 形式而非 postUedroJson，因上游是 GET（无请求体）。
   */
  app.get('/api/hik/uedro/reviewOne', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const reviewId = typeof req.query.reviewId === 'string' ? req.query.reviewId : '';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    const upstreamUrl = new URL(UEDRO_REVIEW_ONE_URL);
    upstreamUrl.searchParams.set('reviewId', reviewId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reviewOne bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro reviewOne failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/subProcess — 查询评审稿件列表。
   *
   * 透传上游 `POST /uedro/web/review/v1/subProcess`，请求体
   * `{ reviewId, pageNo, pageSize }`。上游 `data.list[]` 每项 = 一份稿件
   *（manuscriptId / fileName / url / version / defectNums / verifyNum / isReviewed）。
   */
  app.post('/api/hik/uedro/subProcess', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_SUB_PROCESS_URL,
      label: 'subProcess',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        pageNo: typeof body.pageNo === 'number' ? body.pageNo : 1,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : 10000,
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/reviewProgress — 查询评委评审进度。
   *
   * 透传上游 `POST /uedro/web/comment/v1/reviewProgress`，请求体 `{ reviewId }`。
   * 上游 `data[]` 每项 = `{ userName, defectNum, adviceNum, committedTime, status, manuscript }`。
   */
  app.post('/api/hik/uedro/reviewProgress', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_PROGRESS_URL,
      label: 'reviewProgress',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/progressQuantity — 查询评审统计（按 reviewId + version）。
   *
   * 透传上游 `POST /uedro/web/comment/v1/progressQuantity`，请求体
   * `{ reviewId, version }`。上游 `data = { all, toSolve, toSolveByMySelf, toVerify,
   * closed, adviceNUm, defectNum }`。version 默认取 1（评审首个版本）。
   */
  app.post('/api/hik/uedro/progressQuantity', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_PROGRESS_QUANTITY_URL,
      label: 'progressQuantity',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        version: typeof body.version === 'number' ? body.version : 1,
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * POST /api/hik/uedro/reviewName — 查询项目对应的评审名称模板。
   *
   * 透传上游 `GET /uedro/web/review/v1/reviewName?projectId=…`，上游 `data` 是
   * 评审模板 JSON 串（`"[{reviewname_cn,reviewname,reviewstyle,resultsmatter,…}]"`），
   * 由前端 JSON.parse 后填入评审名称下拉。`[null]` 表示该项目无可用模板。
   */
  app.post('/api/hik/uedro/reviewName', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!projectId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    }

    const upstreamUrl = new URL(UEDRO_REVIEW_NAME_URL);
    upstreamUrl.searchParams.set('projectId', projectId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reviewName bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro reviewName failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/uploadManuscript — 上传评审稿。
   *
   * 透传上游 `POST /uedro/web/manuscript/v1/upload`（multipart/form-data）。
   * 前端发 multipart（含 `file` + `excelJson`），daemon 用 multer memoryStorage 接收，
   * 再以原生 https 模块把 multipart 重组成流透传上游——不能复用 `rawRequest`，因其把
   * body `toString('utf8')` 缓存进内存会破坏二进制文件流。
   *
   * 上游响应 `{code:'0',data:{manuscriptId,url,compressUrl,staticTempFileDir,menInfo,reviewType}}`，
   * code !== '0' 视为失败（如 Pixso-Handoff 类型不匹配）。
   */
  app.post('/api/hik/uedro/uploadManuscript', (req, res, next) => {
    manuscriptUpload(req, res, (err: any) => {
      if (err) return sendApiError(res, 400, 'BAD_REQUEST', 'manuscript upload parse failed: ' + (err?.message || String(err)));
      next();
    });
  }, async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
   const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
   const fileArr = files['file'];
   const file = fileArr?.[0];
   if (!file) {
     return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
   }
   // excelJson 是文本字段，multer 放入 req.body 而非 req.files。
   const excelJson = typeof req.body?.excelJson === 'string' ? req.body.excelJson : '';

    try {
     const result = await forwardMultipart(
       UEDRO_MANUSCRIPT_UPLOAD_URL,
       uedroCookies,
       [
         { name: 'file', filename: Buffer.from(file.originalname, 'latin1').toString('utf8'), contentType: file.mimetype || 'application/octet-stream', data: file.buffer },
         { name: 'excelJson', data: excelJson },
       ],
       'upload manuscript',
     );
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro uploadManuscript bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
     return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro uploadManuscript failed: ' + (err?.message || String(err)));
   }
 });

  /**
   * POST /api/hik/uedro/reUploadManuscript — 重新上传评审稿（更新评审稿第一步）。
   *
   * 透传上游 `POST /uedro/web/manuscript/v1/reUpload`（multipart/form-data）。
   * 前端发 multipart（含 `file` + `manuscriptId` + `excelJson`），其中 manuscriptId
   * 是当前评审稿的已有稿件 ID。daemon 用 multer memoryStorage 接收，再以原生
   * https 模块把 multipart 重组透传上游。
   *
   * 上游响应 `{code:'0',data:{manuscriptId,middleManuscriptId,url,...,reviewType}}`，
   * 其中 middleManuscriptId 供后续 reUploadConfirm 使用。
   */
  app.post('/api/hik/uedro/reUploadManuscript', (req, res, next) => {
    manuscriptUpload(req, res, (err: any) => {
      if (err) return sendApiError(res, 400, 'BAD_REQUEST', 'manuscript reUpload parse failed: ' + (err?.message || String(err)));
      next();
    });
  }, async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const fileArr = files['file'];
  const file = fileArr?.[0];
  if (!file) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
  }
  // manuscriptId 是文本字段（FormData.append 字符串），multer 放入 req.body 而非 req.files。
  const manuscriptId = typeof req.body?.manuscriptId === 'string' ? req.body.manuscriptId : '';
  if (!manuscriptId) {
    return sendApiError(res, 400, 'BAD_REQUEST', 'manuscriptId is required');
  }
  const excelJson = typeof req.body?.excelJson === 'string' ? req.body.excelJson : '';

    try {
      const result = await forwardMultipart(
        UEDRO_MANUSCRIPT_REUPLOAD_URL,
        uedroCookies,
        [
          { name: 'file', filename: Buffer.from(file.originalname, 'latin1').toString('utf8'), contentType: file.mimetype || 'application/octet-stream', data: file.buffer },
          { name: 'manuscriptId', data: manuscriptId },
          { name: 'excelJson', data: excelJson },
        ],
        'reUpload manuscript',
      );
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reUploadManuscript bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reUploadManuscript failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/reUploadConfirm — 确认重新上传评审稿（更新评审稿第二步）。
   *
   * 透传上游 `POST /uedro/web/manuscript/v1/reUploadConfirm`，请求体：
   *   { manuscriptId, middleManuscriptId, description }
   * - manuscriptId：原稿件 ID（reUpload 时传入的）
   * - middleManuscriptId：reUpload 响应返回的中间稿件 ID
   * - description：备注，可空
   *
   * 上游响应 `{code:'0'}` 视为成功，data 为 null。
   */
  app.post('/api/hik/uedro/reUploadConfirm', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_MANUSCRIPT_REUPLOAD_CONFIRM_URL,
      label: 'reUploadConfirm',
      buildBody: (body) => ({
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
        middleManuscriptId: typeof body.middleManuscriptId === 'string' ? body.middleManuscriptId : '',
        description: typeof body.description === 'string' ? body.description : '',
      }),
      requireFields: ['manuscriptId', 'middleManuscriptId'],
    });
  });

  /**
   * POST /api/hik/uedro/reviewAddition — 发起评审。
   *
   * 透传上游 `POST /uedro/web/review/v1/addition`，请求体由前端按原站表单组装：
   *   reviewName / description / reviewType / preReviewEndTime / reviewerMain[] /
   *   author[] / reviewers[] / coreReviewers[] / copyPersons[] / manuscriptId /
   *   reviewModel / projectId / projManager / projName
   * 部门模式（reviewModel=2）前端不发 projectId/projManager/projName。
   *
   * 上游响应 `{code:'0'}` 视为成功，data 为新评审 id。
   */
  app.post('/api/hik/uedro/reviewAddition', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_ADDITION_URL,
      label: 'reviewAddition',
      buildBody: (body) => ({
        reviewName: typeof body.reviewName === 'string' ? body.reviewName : '',
        description: typeof body.description === 'string' ? body.description : '',
        reviewType: typeof body.reviewType === 'string' ? body.reviewType : '',
        preReviewEndTime: typeof body.preReviewEndTime === 'string' ? body.preReviewEndTime : '',
        reviewerMain: Array.isArray(body.reviewerMain) ? body.reviewerMain : [],
        author: Array.isArray(body.author) ? body.author : [],
        reviewers: Array.isArray(body.reviewers) ? body.reviewers : [],
        coreReviewers: Array.isArray(body.coreReviewers) ? body.coreReviewers : [],
        copyPersons: Array.isArray(body.copyPersons) ? body.copyPersons : [],
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
        reviewModel: typeof body.reviewModel === 'number' ? body.reviewModel : 1,
        // 项目模式才带这三个字段；部门模式前端不发，buildBody 也跳过。
        ...(body.reviewModel === 2
          ? {}
          : {
              projectId: typeof body.projectId === 'string' ? body.projectId : '',
              projManager: typeof body.projManager === 'string' ? body.projManager : '',
              projName: typeof body.projName === 'string' ? body.projName : '',
            }),
      }),
    requireFields: [
      'reviewName',
      'reviewType',
      'preReviewEndTime',
      'manuscriptId',
      'reviewModel',
    ],
  });
});

  /**
   * POST /api/hik/uedro/manuscriptAddition — 向已有评审追加评审稿。
   *
   * 透传上游 `POST /uedro/web/manuscript/v1/addition`，请求体：
   *   manuscriptId / reviewId / category / description
   * category 为稿件分类（1=交互/2=视觉/3=文稿/4=表格/11=Pixso-Handoff，
   * 与评审子类型取值一致）。description 为备注，可空。
   *
   * 上游响应 `{code:'0'}` 视为成功，data 为 null。
   */
  app.post('/api/hik/uedro/manuscriptAddition', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_MANUSCRIPT_ADDITION_URL,
      label: 'manuscriptAddition',
      buildBody: (body) => ({
        manuscriptId: typeof body.manuscriptId === 'string' ? body.manuscriptId : '',
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        category: typeof body.category === 'number' ? body.category : Number(body.category) || 0,
        description: typeof body.description === 'string' ? body.description : '',
      }),
     requireFields: ['manuscriptId', 'reviewId', 'category'],
   });
 });

  /**
   * POST /api/hik/uedro/reviewFinish — 关闭评审。
   *
   * 透传上游 `POST /uedro/web/review/v1/finish`，请求体仅 `{ reviewId }`。
   * 上游响应 `{code:'0'}` 视为成功，data 为 null。
   */
  app.post('/api/hik/uedro/reviewFinish', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_FINISH_URL,
      label: 'reviewFinish',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
      }),
      requireFields: ['reviewId'],
    });
  });

  /**
   * GET /api/hik/uedro/reviewRepeat — 读取评审编辑回显数据。
   *
   * 透传上游 `GET /uedro/web/review/v1/repeat?reviewId=…`，返回评审的完整
   * 可编辑字段：reviewName / preReviewEndTime / reviewType / designers（评审
   * 组长）/ coreReviewers / reviewers / author / copyPersons / content 等。
   * 上游响应 `{code:'0'}` 视为成功。
   */
  app.get('/api/hik/uedro/reviewRepeat', async (req, res) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    const reviewId = typeof req.query.reviewId === 'string' ? req.query.reviewId : '';
    if (!reviewId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'reviewId is required');
    }

    const upstreamUrl = new URL(UEDRO_REVIEW_REPEAT_URL);
    upstreamUrl.searchParams.set('reviewId', reviewId);

    try {
      const result = await rawRequest('GET', upstreamUrl.toString(), uedroCookies, {
        extraHeaders: uedroHeaders(uedroCookies),
      });
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'uedro reviewRepeat bad response');
      }
      return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data: upstream?.data });
    } catch (err: any) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'uedro reviewRepeat failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/uedro/reviewEdit — 编辑评审。
   *
   * 透传上游 `POST /uedro/web/review/v1/edit`，请求体：
   *   reviewId / preReviewEndTime / designers / coreReviewers / reviewers /
   *   copyPersons / content
   * 上游响应 `{code:'0'}` 视为成功。
   */
  app.post('/api/hik/uedro/reviewEdit', async (req, res) => {
    return postUedroJson(req, res, {
      dataDir,
      sendApiError,
      url: UEDRO_REVIEW_EDIT_URL,
      label: 'reviewEdit',
      buildBody: (body) => ({
        reviewId: typeof body.reviewId === 'string' ? body.reviewId : '',
        preReviewEndTime: typeof body.preReviewEndTime === 'string' ? body.preReviewEndTime : '',
        designers: Array.isArray(body.designers) ? body.designers : [],
        coreReviewers: Array.isArray(body.coreReviewers) ? body.coreReviewers : [],
        reviewers: Array.isArray(body.reviewers) ? body.reviewers : [],
        copyPersons: Array.isArray(body.copyPersons) ? body.copyPersons : [],
        content: typeof body.content === 'string' ? body.content : '',
      }),
      requireFields: ['reviewId'],
    });
  });

/**
 * 反向代理羽点前端页面：/uedro/* → https://uedro.hikvision.com.cn/uedro/*
   *
   * 前端 `buildManuscriptPreviewUrl` 生成 `/uedro/ux?id=…` 等根相对路径，
   * `next.config.ts` 把 `/uedro/:path*` rewrite 到 daemon。daemon 在此把请求
   * 透传到羽点上游，注入本地 SSO session 里的 uedro cookie，浏览器侧始终同源，
   * 原站 SPA 的根相对资源与 fetch 自然落回代理。
   *
   * 未登录或无 uedro cookie 时返回 401。HTML/JS/CSS 里的绝对 URL 会被重写为
   * 根相对路径，避免页面内资源链接跳回原站导致跨源 cookie 丢失。
   */
  app.use('/uedro', createUedroProxyHandler('/uedro', dataDir, sendApiError));

  /**
   * 反向代理羽点门户页面：/portal/* → https://uedro.hikvision.com.cn/portal/*
   *
   * 与 /uedro/* 同理，门户登录页、basicInfo 等门户前端资源也走同源代理。
   */
 app.use('/portal', createUedroProxyHandler('/portal', dataDir, sendApiError));
}

/**
 * 反向代理羽点前端页面（/uedro/ux、/uedro/ua、/uedro/pdf-js、/portal/ 等）。
 *
 * 前端 `buildManuscriptPreviewUrl` 生成 `/uedro/ux?id=…` 等根相对路径，
 * `next.config.ts` 把 `/uedro/:path*` / `/portal/:path*` rewrite 到 daemon。
 * daemon 在此把请求透传到 `https://uedro.hikvision.com.cn`，注入本地 SSO
 * session 里的 uedro cookie，浏览器侧始终同源，原站 SPA 的根相对资源与
 * fetch 自然落回代理。
 *
 * 与 `streamUpstreamGet` 的区别：那个专做文件下载（JSON 视为错误、不重写
 * URL）；这里要处理完整前端页面，需重写 HTML/JS/CSS 里的绝对 URL，并透传
 * set-cookie 让会话续期。
 *
 * @param mountPath 挂载前缀（`/uedro` 或 `/portal`），仅用于错误日志
 * @param dataDir   daemon 数据目录，用于读 SSO session
 * @param sendApiError 错误响应工具
 */
function createUedroProxyHandler(mountPath: string, dataDir: string, sendApiError: (...args: any[]) => any) {
  return (req: any, res: any) => {
    const uedroCookies = readUedroCookies(dataDir);
    if (!uedroCookies) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
    }
    // req.url 形如 `/uedro/ux?id=…`，直接拼到 UEDRO_BASE 即可。
    // Express 的 app.use('/uedro', ...) 会剥掉 mountPath 前缀，req.url 变成
    // `/ux?id=…`；req.originalUrl 才是完整的 `/uedro/ux?id=…`。拼到 UEDRO_BASE
    // 时必须用 originalUrl，否则上游路径少了 /uedro 前缀，nginx 回 404。
    const upstreamUrl = UEDRO_BASE + req.originalUrl;
    proxyUpstream(upstreamUrl, uedroCookies, res, sendApiError, `uedro proxy ${mountPath}`, req);
  };
}

/**
 * 通用上游反向代理：发起请求、跟随重定向、重写文本里的绝对 URL、透传响应。
 *
 * 与 `streamUpstreamGet` 结构相似（内网直连 / 外网走代理、跟随 3xx、合并 cookie），
 * 但不把 JSON 当错误——前端页面代理可能合法返回 JSON（如 SPA 的 config 接口）。
 * 对 text/html / text/css / application/javascript 等文本类做绝对 URL 重写，
 * 二进制（图片、字体、文件流）原样 pipe。
 */
function proxyUpstream(
  urlStr: string,
  cookies: Cookie[],
  res: any,
  sendApiError: (...args: any[]) => any,
  label: string,
  req?: any,
): void {
  const doReq = (u: string, jar: Cookie[], redirects: number) => {
    if (redirects > 15) {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} too many redirects`);
      return;
    }
    const url = new URL(u);
    const isHttps = url.protocol === 'https:';
    const method = req?.method || 'GET';
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
    // GET 请求（页面/静态资源）用浏览器风格 Accept；POST 等 API 请求
    // 用 */* 通用 Accept，并透传前端发来的 Content-Type。
    if (method === 'GET') {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    } else {
      headers['Accept'] = '*/*';
      const ct = req?.headers?.['content-type'];
      if (ct) headers['Content-Type'] = ct;
    }
    // 用 cookieHeader 按 domain 过滤，确保带上匹配的 uedro 应用域 cookie。
    const cookieStr = cookieHeader(jar, u);
    if (cookieStr) headers['Cookie'] = cookieStr;
    // Referer 设为上游同源根路径，让上游认为是从羽点站内跳转来的。
    headers['Referer'] = UEDRO_BASE + '/';

    const handleResponse = (resp: any) => {
      // 合并本轮 set-cookie 到 jar，供重定向复用，并透传给浏览器（同源 cookie）。
      const setCookies = ([] as string[]).concat((resp.headers['set-cookie'] as string[]) || []);
      jar = mergeCookies(jar, parseCookieHeaders(setCookies, u));

      const status = resp.statusCode ?? 0;
      // 3xx 重定向：跟随 location 并带上更新后的 cookie。
      // 重写 Location 为根相对路径，让浏览器走代理而非直连原站。
      if (status >= 300 && status < 400 && resp.headers.location) {
        const loc = String(resp.headers.location);
        const next = new URL(loc, u).toString();
        const rewrittenLoc = rewriteUrl(next);
        resp.resume();
        if (!res.headersSent) {
          res.setHeader('Location', rewrittenLoc);
          res.status(status).end();
        }
        return;
      }

      const contentType = String(resp.headers['content-type'] || '').toLowerCase();
      const shouldRewrite = REWRITE_CONTENT_TYPES.some((t) => contentType.includes(t));

      // 二进制或无需重写的文本：直接 pipe，透传 content-type / content-disposition。
      if (!shouldRewrite) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', resp.headers['content-type'] || 'application/octet-stream');
          if (resp.headers['content-length']) {
            res.setHeader('Content-Length', resp.headers['content-length']);
          }
          // 透传 set-cookie（同源，浏览器会存下）。
          if (setCookies.length) {
            res.setHeader('Set-Cookie', setCookies);
          }
          res.status(status);
        }
        resp.pipe(res);
        resp.on('error', () => {
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} stream error`);
        });
        return;
      }

     // 文本类：整体缓存后重写绝对 URL，再发给浏览器。
     const chunks: Buffer[] = [];
     resp.on('data', (c: Buffer) => chunks.push(c));
     resp.on('end', () => {
       if (res.headersSent) return;
       let body = Buffer.concat(chunks).toString('utf8');
       body = rewriteProxyText(body, contentType);
       // 重写后长度变了，删除 content-length，用 chunked 或不设。
        const outHeaders: Record<string, any> = {
          'Content-Type': resp.headers['content-type'] || 'text/html; charset=utf-8',
        };
        if (setCookies.length) outHeaders['Set-Cookie'] = setCookies;
        res.status(status);
        for (const [k, v] of Object.entries(outHeaders)) res.setHeader(k, v);
        res.send(body);
      });
      resp.on('error', () => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} response error`);
      });
    };

    // POST/PUT 等带 body 的请求：把前端发来的请求体写给上游。
    // express.json() 中间件在路由之前注册，已消费 req 流并把结果放
    // req.body。此时直接序列化 req.body 发给上游；流未被消费（如跳过
    // body parser 的路径）才走 data/end 事件读取。
    // 3xx 重定向后不应重发 body（上游已处理完毕，重发会报错）。
    let postBody: Buffer | null = null;
    let streamBody = false;
    if (method !== 'GET' && redirects === 0 && req) {
      if (req.body !== undefined && req.body !== null) {
        const bodyStr = typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body);
        postBody = Buffer.isBuffer(bodyStr) ? bodyStr : Buffer.from(bodyStr, 'utf8');
      } else {
        // 流未被消费，需要从 req 事件读取。
        streamBody = true;
      }
    }
    if (postBody) {
      headers['Content-Length'] = String(postBody.length);
    }

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);

    const sendUpstream = (finalBody: Buffer | null) => {
      const opts: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
        path: url.pathname + url.search,
        method,
        headers,
        rejectUnauthorized: false,
      };

      const upstream = mod.request(opts, handleResponse);
      upstream.setTimeout(30000, () => {
        upstream.destroy();
        if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', `${label} timeout`);
      });
      upstream.on('error', (e: any) => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} failed: ${e?.message || String(e)}`);
      });
      if (finalBody) {
        upstream.end(finalBody);
      } else {
        upstream.end();
      }
    };

    // 发送请求体（或结束无 body 请求）。
    // postBody / 无 body 路径：headers 已就绪（含 Content-Length），直接建连发送。
    // streamBody 路径：先累积完整 body 再补 Content-Length，否则 mod.request() 已固定
    // headers，后补的长度不会随请求发出，上游因缺少 Content-Length 而挂起 socket。
    if (streamBody) {
      const bodyChunks: Buffer[] = [];
      req.on('data', (c: Buffer) => bodyChunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(bodyChunks);
        headers['Content-Length'] = String(body.length);
        sendUpstream(body);
      });
      req.on('error', (e: any) => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} request body error: ${e?.message || String(e)}`);
      });
    } else {
      sendUpstream(postBody);
    }
  };
  doReq(urlStr, [...cookies], 0);
}

/**
 * 把文本里的羽点绝对 URL 重写为同源根相对路径。
 *
 * `https://uedro.hikvision.com.cn/uedro/ux?id=1` → `/uedro/ux?id=1`，
 * `https://uedro.hikvision.com.cn/portal/` → `/portal/`。
 * 仅替换 host 部分，path + search 原样保留。这样浏览器请求落回本代理，
 * 始终同源、cookie 始终随行。
 */
export function rewriteProxyText(body: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  // 1. 域名改写：https/http 绝对域名 → 根相对；协议相对 //域名 → 根相对。
  //    先替换 https:// 和 http:// 前缀的完整域名，再替换 //域名（协议相对）。
  //    顺序很重要：先替换带协议的，避免 // 被误匹配。
  let out = body
    .replace(/https:\/\/uedro\.hikvision\.com\.cn/g, '')
    .replace(/http:\/\/uedro\.hikvision\.com\.cn/g, '')
    .replace(/\/\/uedro\.hikvision\.com\.cn/g, '');
  // 2. HTML 专属：剥离 CSP meta 标签。
  //    原站 CSP 限制脚本/连接来源为 'self'（指原站域），代理后 'self' 变成
  //    本代理域，但 CSP 里的其它白名单仍指向原站，会阻止代理页加载资源。
  //    剥掉 CSP meta 让浏览器不施加额外限制，代理页资源自然同源加载。
  if (ct.includes('text/html')) {
    out = out.replace(/<meta\s+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  }
  return out;
}

/**
 * 重写一个完整 URL 字符串为同源根相对路径（用于 Location 头）。
 * `https://uedro.hikvision.com.cn/uedro/home?id=1` → `/uedro/home?id=1`。
 * 非羽点地址原样返回（如外网 CDN 重定向）。
 */
function rewriteUrl(u: string): string {
  if (u.startsWith(UEDRO_ABS_ORIGIN)) {
    return u.slice(UEDRO_ABS_ORIGIN.length);
  }
  return u;
}

/**
 * 统一封装「取 uedro cookie → POST 上游 → 解析 JSON → 回 `{ ok, data }`」。
 *
 * subProcess/reviewProgress/progressQuantity 三个详情路由结构完全
 * 一致，抽出公共逻辑避免每个路由各写一遍 try/catch + JSON.parse。与 `readUedroCookies`
 * 同属 uedro 路由的复用层。
 *
 * - `buildBody`：从请求体挑字段并施加类型校验/缺省，产出上游请求体。
 * - `requireFields`：buildBody 后逐个检查非空，缺失回 400。
 * - `mapData`：可选，从上游 data 里再取一层；默认原样透传上游 data。
 *
 * 响应形状与 urge/editSubscriptionStatus 对齐：`{ ok: code==='0', data }`，并附 `msg`
 * 以便前端在失败时展示上游错误信息。
 */
async function postUedroJson(
  req: any,
  res: any,
  opts: {
    dataDir: string;
    sendApiError: (...args: any[]) => any;
    url: string;
    label: string;
    buildBody: (body: Record<string, any>) => Record<string, any>;
    requireFields?: string[];
    mapData?: (upstream: any) => any;
  },
): Promise<void> {
  const uedroCookies = readUedroCookies(opts.dataDir);
  if (!uedroCookies) {
    return opts.sendApiError(res, 401, 'UNAUTHORIZED', 'uedro session not found, please login first');
  }
  const body = (req.body ?? {}) as Record<string, any>;
  const upstreamBody = opts.buildBody(body);
  if (opts.requireFields) {
    for (const f of opts.requireFields) {
      if (!upstreamBody[f]) {
        return opts.sendApiError(res, 400, 'BAD_REQUEST', `${f} is required`);
      }
    }
  }
  try {
    const result = await rawRequest('POST', opts.url, uedroCookies, {
      body: JSON.stringify(upstreamBody),
      extraHeaders: uedroHeaders(uedroCookies),
    });
    let upstream: any;
    try {
      upstream = JSON.parse(result.body);
    } catch {
      return opts.sendApiError(res, 502, 'BAD_GATEWAY', `uedro ${opts.label} bad response`);
    }
    const data = opts.mapData ? opts.mapData(upstream) : upstream?.data;
    return res.json({ ok: upstream?.code === '0', msg: upstream?.msg, data });
  } catch (err: any) {
    return opts.sendApiError(res, 500, 'INTERNAL_ERROR', `uedro ${opts.label} failed: ` + (err?.message || String(err)));
  }
}

/**
 * 流式透传一个上游 GET 请求（用于下载稿件二进制文件）。
 *
 * 为什么不复用 `rawRequest`：它把整个 body `toString('utf8')` 缓存进内存
 * 再返回，会破坏 xlsx/docx 这类二进制流。这里用原生 http(s) 模块，把上游
 * 响应逐块 pipe 给客户端，文件再大也不占内存。
 *
 * 行为：
 * - 跟随 3xx 重定向并合并 cookie（下载链接常见 302 到 CDN）。
 * - content-type 为 JSON 时按错误体处理，回 502 + 上游信息（鉴权失效 /
 *   稿件不存在时上游不会给文件，而是 JSON 错误）。
 * - 否则透传 content-type / content-disposition（含文件名）给浏览器，
 *   触发原生下载。
 *
 * @param urlStr 上游完整 URL
 * @param cookies 本地 uedro cookie
 * @param res Express 响应
 * @param label 错误信息前缀（用于日志 / 502 body）
 */
function streamUpstreamGet(
  urlStr: string,
  cookies: Cookie[],
  res: any,
  sendApiError: (...args: any[]) => any,
  label: string,
): void {
  const doReq = (u: string, jar: Cookie[], redirects: number) => {
    if (redirects > 15) {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} too many redirects`);
      return;
    }
    const url = new URL(u);
    const isHttps = url.protocol === 'https:';
    const headers: Record<string, string> = {
      ...uedroHeaders(jar),
    };
    const cookieStr = cookieHeader(jar, u);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const handleResponse = (resp: any) => {
      // 合并本轮 set-cookie 到 jar，供可能的重定向复用。
      const setCookies = ([] as string[]).concat((resp.headers['set-cookie'] as string[]) || []);
      jar = mergeCookies(jar, parseCookieHeaders(setCookies, u));

      const status = resp.statusCode ?? 0;
      // 3xx 重定向：跟随 location 并带上更新后的 cookie。
      if (status >= 300 && status < 400 && resp.headers.location) {
        const next = new URL(resp.headers.location as string, u).toString();
        resp.resume();
        return doReq(next, jar, redirects + 1);
      }

      const contentType = String(resp.headers['content-type'] || '').toLowerCase();
      // 上游返回 JSON：多半是鉴权失效 / 稿件不存在，不是真正的文件。
      if (contentType.includes('application/json')) {
        const chunks: Buffer[] = [];
        resp.on('data', (c: Buffer) => chunks.push(c));
        resp.on('end', () => {
          let msg = `${label} upstream error`;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed?.msg) msg = String(parsed.msg);
          } catch {
            /* 保持默认 msg */
          }
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', msg);
        });
        resp.on('error', () => {
          if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} response error`);
        });
        return;
      }

      // 真正的文件流：透传 content-type / content-disposition，逐块 pipe。
      // content-disposition 先过 normalizeContentDisposition：羽点 filename= 段
      // 常带 GBK/UTF-8 字节，Node 头按 latin1 解码会让浏览器拿到乱码文件名，
      // 这里规整成 RFC 5987 `filename*=UTF-8''…` 形式。
      if (!res.headersSent) {
        res.setHeader('Content-Type', resp.headers['content-type'] || 'application/octet-stream');
        const cd = resp.headers['content-disposition'];
        if (cd) {
          res.setHeader('Content-Disposition', normalizeContentDisposition(String(cd)) ?? cd);
        }
        if (resp.headers['content-length']) {
          res.setHeader('Content-Length', resp.headers['content-length']);
        }
      }
      resp.pipe(res);
      resp.on('error', () => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} stream error`);
      });
    };

    // 羽点稿件下载落在 *.hikvision.com.cn 内网域名，rawRequest 对这些域名
    // 走直连（DEFAULT_NO_PROXY）。这里同样直连：用 shouldBypassProxy 复用
    // 同一套内网判定，未绕过时才回退代理（极少数外网出口）。
    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const bypass = shouldBypassProxy(url.hostname);
    const proxy = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || '');
    if (proxy && !bypass) {
      // 外网代理出口：交给 Node 默认代理行为，保持与 rawRequest 一致的语义。
      const upstream = mod.request(
        {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
          path: url.pathname + url.search,
          method: 'GET',
          headers,
          rejectUnauthorized: false,
        },
        handleResponse,
      );
      upstream.setTimeout(30000, () => {
        upstream.destroy();
        if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', `${label} timeout`);
      });
      upstream.on('error', (e: any) => {
        if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} failed: ${e?.message || String(e)}`);
      });
      upstream.end();
      return;
    }
    const upstream = mod.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : isHttps ? 443 : 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        rejectUnauthorized: false,
      },
      handleResponse,
    );
    upstream.setTimeout(30000, () => {
      upstream.destroy();
      if (!res.headersSent) sendApiError(res, 504, 'INTERNAL_ERROR', `${label} timeout`);
    });
    upstream.on('error', (e: any) => {
      if (!res.headersSent) sendApiError(res, 502, 'BAD_GATEWAY', `${label} failed: ${e?.message || String(e)}`);
    });
    upstream.end();
  };
  doReq(urlStr, [...cookies], 0);
}

/**
 * 把上游 `Content-Disposition` 头规整成浏览器能正确解析的 RFC 5987 形式。
 *
 * 为什么需要它：羽点稿件下载的 `filename=` 段常带非 ASCII 字节（中文文件名）。
 * HTTP 头字段值在 Node 里按 latin1 解码，于是 GBK/UTF-8 字节被错误展成 latin1
 * 字符串透传给浏览器，下载下来就是 `ç¨¿ä»¶.xlsx` 这类乱码。这里把那段字节
 * 当作 latin1 还原成 Buffer，先试 UTF-8 再退到 GBK 解码，重写为
 * `filename="<ascii>"; filename*=UTF-8''<pct>` —— 现代浏览器优先解析 `filename*`，
 * 拿到正确文件名；`filename=` 留一个 ASCII 兜底给旧客户端。
 *
 * 已自带 `filename*=…` 扩展段时原样放行（上游或浏览器已能用，不重复改写）；
 * 无任何 filename 段时也原样返回（不凭空造名）。
 */
export function normalizeContentDisposition(cd: string): string {
  if (!cd) return cd;
  // 已是 RFC 5987 扩展形式，浏览器能正确解析，不动。
  if (/filename\s*\*=/i.test(cd)) return cd;

  // 匹配 filename="..." 或 filename=token（不含分号/引号）。
  const m = cd.match(/filename\s*=\s*("[^"]*"|[^";]+)/i);
  if (!m) return cd;
  const start = m.index ?? 0;
  const before = cd.slice(0, start);
  const after = cd.slice(start + m[0].length);

  const rawName = (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!rawName) return cd;

  // Node 头按 latin1 解码：非 ASCII 字符其实是 GBK/UTF-8 字节被拆成了 latin1 字符。
  // 按 latin1 还原回字节，再尝试 UTF-8 → GBK 解码。
  const buf = Buffer.from(rawName, 'latin1');
  let decoded: string;
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('�')) {
    // UTF-8 解码无替换符，判定为 UTF-8（含纯 ASCII 这条捷径）。
    decoded = asUtf8;
  } else {
    // UTF-8 失败 → 退 GBK（海康内网遗留编码）。
    try {
      decoded = new TextDecoder('gbk').decode(buf);
    } catch {
      decoded = asUtf8;
    }
  }

  const ascii = decoded.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  const pct = encodeURIComponent(decoded);
  return `${before}filename="${ascii}"; filename*=UTF-8''${pct}${after}`;
}

/**
 * 透传一个 multipart/form-data POST 请求到羽点上游。
 *
 * 为什么不复用 `rawRequest`：它把整个 body `toString('utf8')` 缓存进内存再返回，
 * 会破坏文件这类二进制流。这里手动拼 multipart boundary，用原生 https/http 模块
 * 把 Buffer 写出去，再把上游响应整体缓存为字符串返回（上传接口的响应是 JSON，
 * 体量小，可整体缓存）。
 *
 * 边界、Content-Disposition、Content-Type 都按 RFC 2388 拼；文本字段不带 filename，
 * 文件字段带 filename + contentType。cookie / Referer / X-Requested-With 由
 * `uedroHeaders` 注入，与其它 uedro 路由一致。复用 `streamUpstreamGet` 同款的
 * 代理判定（内网直连，外网走 HTTPS_PROXY）。
 *
 * @param urlStr 上游完整 URL
 * @param cookies 本地 uedro cookie
 * @param parts multipart 各段：`{name, data, filename?, contentType?}`
 * @param label 错误信息前缀
 * @returns 上游响应体（字符串），由调用方按 JSON 解析
 */
function forwardMultipart(
  urlStr: string,
  cookies: Cookie[],
  parts: { name: string; data: string | Buffer; filename?: string; contentType?: string }[],
  label: string,
): Promise<{ body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const boundary = '----OpenDesignUedro' + Math.random().toString(16).slice(2);
    const chunks: Buffer[] = [];
    for (const part of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
     if (part.filename) {
      // 含非 ASCII 字符的文件名需 RFC 5987 编码，否则上游 Java/Tomcat 按 ISO-8859-1 解析
       // 会导致中文文件名变成乱码，进而返回的 url/staticFileDir 也是乱码。
       const fn = part.filename;
       const asciiFn = fn.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
       const pctFn = encodeURIComponent(fn);
       const disp = `Content-Disposition: form-data; name="${part.name}"; filename="${asciiFn}"; filename*=UTF-8''${pctFn}\r\n`;
       chunks.push(Buffer.from(disp, 'utf8'));
       chunks.push(Buffer.from(`Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`));
     } else {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      }
      chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8'));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const headers: Record<string, string> = {
      ...uedroHeaders(cookies),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    };
    const cookieStr = cookieHeader(cookies, urlStr);
    if (cookieStr) headers['Cookie'] = cookieStr;

    const mod: typeof https = isHttps ? https : (http as unknown as typeof https);
    const bypass = shouldBypassProxy(url.hostname);
    const proxy = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || '');

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
       // 上游可能返回 UTF-8 或 GBK，按 Content-Type charset 判断。
       const ct = resp.headers?.['content-type'] || '';
       const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || 'utf-8';
       let body: string;
       if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
         try { body = new TextDecoder('gbk').decode(buf); }
         catch { body = buf.toString('utf8'); }
       } else {
         body = buf.toString('utf8');
       }
       resolve({ body });
     });
     resp.on('error', (e: any) => reject(new Error(`${label} response error: ${e?.message || String(e)}`)));
   };

    let req: http.ClientRequest;
    if (proxy && !bypass) {
      req = mod.request(opts, handleResp);
    } else {
      req = mod.request(opts, handleResp);
    }
    req.setTimeout(120000, () => {
      req.destroy(new Error(`${label} timeout`));
    });
    req.on('error', (e: any) => reject(new Error(`${label} failed: ${e?.message || String(e)}`)));
    req.end(body);
  });
}
