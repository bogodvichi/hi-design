import type { Express } from 'express';
import {
  IRDMS_BASE,
  IRDMS_CURRENT_USER_URL,
  IrdmsUnauthorizedError,
  irdmsGet,
  irdmsPost,
} from '../../../http/hik_logins/irdms.js';

/**
 * IRDMS 业务路由。
 *
 * 所有 IRDMS 上游请求统一走 `irdmsGet` / `irdmsPost`：会话守卫先复用
 * hicoo SSO 换到的 IRDMS cookies，失效时自动用 CAS 重建并重试一次。
 */

export interface RegisterHikIrdmsRoutesDeps {
  dataDir: string;
  sendApiError: (...args: any[]) => any;
}

/** 项目列表查询接口。 */
const IRDMS_PROJECT_LIST_URL = `${IRDMS_BASE}/webApi/irdms-view-pm/view/projectList/getProjectList`;

/** 项目列表查询默认参数，对齐 IRDMS 前端「项目列表」页请求体。 */
const IRDMS_PROJECT_LIST_DEFAULTS: Record<string, unknown> = {
  belongTo: 'pm_proList',
  radio: '',
  searchText: '',
  projTypeArr: [
    'PD', 'TD', 'PM', 'TM', 'PC', 'PI', 'PO', 'PR', 'PB', 'SD', 'SC',
    'BT_PROJECT', 'IT_PROJECT', 'PZ', 'BI_PROJECT', 'PJ', 'PL', 'MR', 'SP',
  ],
  labelList: [],
  projScope: '',
  statusArr: ['INP'],
  projManager: '',
  dev: '',
  ba: '',
  coreTeam: '',
  generalTeam: '',
  groupLeader: '',
  planStart: [], planStart1: '', planStart2: '',
  planEnd: [], planEnd1: '', planEnd2: '',
  realStart: [], realStart1: '', realStart2: '',
  realEnd: [], realEnd1: '', realEnd2: '',
  projStageCode: '',
  prodLineArr: [], prodLine: '', prodSeriesNum: '',
  departmentArr: [], department: '', depts: '', deptArr: [],
  sa: '',
  projectSubType: '', projectCategory: '', projectSource: '',
  updateTime1: '', updateTime2: '',
  sort: '', order: 'DESC',
  rows: 30, page: 1,
  projNums: '', allProject: '', memberDept: '', filterText: '',
  resourceSubCategorys: '',
  detailStatus: 'NORMAL,RISK,DELAY',
};

/** ISO 周数（周一为一周起点，含首个周四的周为第 1 周）。 */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * 合并调用方参数与上游默认查询条件，并补齐派生字段：
 * projType/status 由对应数组转逗号串，week/time 为缓存戳。
 * 调用方只需传需要覆盖的字段（如 depts / page / rows / searchText）。
 */
export function buildIrdmsProjectListPayload(body: unknown): Record<string, unknown> {
  const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...IRDMS_PROJECT_LIST_DEFAULTS, ...input };
  if (!payload.projType && Array.isArray(payload.projTypeArr)) {
    payload.projType = (payload.projTypeArr as unknown[]).join(',');
  }
  if (!payload.status && Array.isArray(payload.statusArr)) {
    payload.status = (payload.statusArr as unknown[]).join(',');
  }
  if (payload.week === undefined || payload.week === null || payload.week === '') {
    payload.week = Date.now();
  }
  if (!payload.time) {
    const now = new Date();
    payload.time = `${now.getFullYear()}-${isoWeekNumber(now)}`;
  }
  return payload;
}

export function registerHikIrdmsRoutes(app: Express, deps: RegisterHikIrdmsRoutesDeps): void {
  const { dataDir, sendApiError } = deps;

  /**
   * GET /api/hik/irdms/test — IRDMS 连通性测试。
   *
   * 请求上游 getCurrentUserInfo，返回网络层结果（状态码 / 耗时 / 响应体）。
   * 本地 hicoo SSO 未登录或 CASTGC 失效时 401。
   */
  app.get('/api/hik/irdms/test', async (_req, res) => {
    const url = `${IRDMS_CURRENT_USER_URL}?_t=${Math.floor(Date.now() / 1000)}`;
    try {
      const started = Date.now();
      const result = await irdmsGet(dataDir, url);
      const elapsedMs = Date.now() - started;
      let parsed: unknown = null;
      let isJson = false;
      try {
        parsed = JSON.parse(result.body);
        isJson = true;
      } catch {
        // 非 JSON（如网关 HTML 报错页）原样透传，便于排查。
      }
      return res.json({
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        elapsedMs,
        url: result.finalUrl,
        contentType: result.contentType,
        isJson,
        body: isJson ? parsed : result.body,
      });
    } catch (err: any) {
      if (err instanceof IrdmsUnauthorizedError) {
        return sendApiError(res, 401, 'UNAUTHORIZED', err.message);
      }
      return sendApiError(res, 502, 'BAD_GATEWAY', 'irdms probe failed: ' + (err?.message || String(err)));
    }
  });

  /**
   * POST /api/hik/irdms/projectList — IRDMS 项目列表查询。
   *
   * 透传上游 `POST /webApi/irdms-view-pm/view/projectList/getProjectList`，
   * 缺省参数自动补齐完整默认查询条件，返回上游 `{ ok, msg, data }`。
   */
  app.post('/api/hik/irdms/projectList', async (req, res) => {
    const payload = buildIrdmsProjectListPayload(req.body);
    try {
      const result = await irdmsPost(dataDir, IRDMS_PROJECT_LIST_URL, payload);
      let upstream: any;
      try {
        upstream = JSON.parse(result.body);
      } catch {
        return sendApiError(res, 502, 'BAD_GATEWAY', 'irdms projectList bad response');
      }
      return res.json({
        ok: upstream?.code === '0' || upstream?.success === true,
        msg: upstream?.msg,
        data: upstream?.data,
        status: result.status,
      });
    } catch (err: any) {
      if (err instanceof IrdmsUnauthorizedError) {
        return sendApiError(res, 401, 'UNAUTHORIZED', err.message);
      }
      return sendApiError(res, 502, 'BAD_GATEWAY', 'irdms projectList failed: ' + (err?.message || String(err)));
    }
  });
}
