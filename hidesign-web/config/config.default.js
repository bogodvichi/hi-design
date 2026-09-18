/* eslint valid-jsdoc: "off" */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function readOptionalPem(file) {
  if (!file) return { content: '', error: '' };
  try {
    return { content: fs.readFileSync(file, 'utf8'), error: '' };
  } catch (err) {
    return { content: '', error: err.message };
  }
}

// 默认 7002，被占用时依次尝试 7003-7010，绝不使用 7001。
// 全部被占则返回 0 让 OS 分配随机端口（仍排除 7001）。
function resolveListenPort() {
  const preferred = 7002;
  const forbidden = 7001;
  const fallbacks = [7003, 7004, 7005, 7006, 7007, 7008, 7009, 7010];
  const candidates = [preferred, ...fallbacks].filter(p => p !== forbidden);
  for (const port of candidates) {
    try {
      execSync(
        `"${process.execPath}" -e "const s=require('net').createServer();s.on('error',()=>process.exit(1));s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)})"`,
        { stdio: 'pipe', timeout: 2000 }
      );
    } catch {
      continue;
    }
    return port;
  }
  return 0;
}

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  const himindMcpCaFile = process.env.HIMIND_MCP_CA_FILE || '';
  const himindMcpCa = readOptionalPem(himindMcpCaFile);
  const himindMcpJwtPrivateKeyFile = process.env.HIMIND_MCP_JWT_PRIVATE_KEY_FILE || '';
  const himindMcpJwtPrivateKey = readOptionalPem(himindMcpJwtPrivateKeyFile);
  /**
   * built-in config
   * @type {Egg.EggAppConfig}
   **/
  const config = exports = {
    security: {
      csrf: {
        enable: false,
        // useSession: false, // 默认为 false，当设置为 true 时，将把 csrf token 保存到 Session 中
        // sessionName: 'csrfToken', // Session 中的字段名，默认为 csrfToken
        // cookieName: 'csrfToken', // Cookie 中的字段名，默认为 csrfToken
        // headerName: 'x-csrf-token'
      },
    },
    cors: {
      origin: '*',
      allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
      allowHeaders: 'Content-Type,Authorization,X-Requested-With',
      credentials: false,
    },
  };

  config.multipart = {
    // 只允许上传的图片格式
    whitelist: ['.png', '.jpg', '.jpeg'],
    // 文件允许大小
    fileSize: '50mb'
  }

  config.bodyParser = {
    jsonLimit: '50mb',
    formLimit: '50mb'
  }

  // 静态资源服务：关闭内存缓存与浏览器强缓存
  // 这样 public 目录下的文件更新后无需重启进程即可立即生效
  config.static = {
    prefix: '/public/',
    dir: path.join(appInfo.baseDir, 'app/public'),
    dynamic: true,     // 动态加载新增文件
    preload: false,    // 启动时不预加载
    buffer: false,     // 不把文件内容缓存进内存（否则需重启才刷新）
    cacheControl: 'no-cache, must-revalidate', // 浏览器每次必须回源验证，禁止直接用磁盘缓存
    maxAge: 0,
  };

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + '_1755242675950_7921';

  // 服务监听端口
  config.cluster = {
    listen: {
      port: resolveListenPort(),
    },
  };

  // add your middleware config here
  config.middleware = [];

  // jwt 配置
  config.jwt = {
    secret: 'ybvichi', // 自定义加密字符串，secret 是在服务端的，不要泄露
    enable: true, // 默认是关闭的，如果开启，这会对所有请求进行自动校验
    //match: /^\/webapi\/v1\//, // 需要进行 JWT 校验的请求路径
  ignore: [
    /^\/hdw\//,
    /^\/$/,
  ],
    sign: {
      expiresIn: '24h', // 令牌过期时间
    },
    /**
     * username=yebo;secret=yapovichi => 713C9C311144AF22E6236205F7C451A9 
     * username=wengwenxiu;secret=yapovichi => 7BB7DAF93274E5A742F3B071794316CF
     * // 数字化部账号
     * username=zhangzefeng;secret=yapovichi => 0FA6C5F960CB1CA093590CEAC1347430 [章泽锋]
     * username=haoyili;secret=yapovichi => 3EC38E560C684E6EEC4CBCF4EB819E6B [郝以利]
     * // 云眸账号
     * username=hujincheng;secret=yapovichi => E3B7692B2421198A801ECA73837810F4 [胡金成]
     */
    // adminKeys: [
    //   '713C9C311144AF22E6236205F7C451A9',
    //   '7BB7DAF93274E5A742F3B071794316CF'
    // ], // 从 token 中提取用户身份标识字段，默认从 payload 中提取
    // managerKeys: [
    //   '0FA6C5F960CB1CA093590CEAC1347430',
    //   '3EC38E560C684E6EEC4CBCF4EB819E6B',
    //   'E3B7692B2421198A801ECA73837810F4'
    // ]
  };

  // HiMind SSO tickets are minted only by this server after it validates the
  // caller's OA session. The shared secret must be injected at deployment;
  // never ship it in a desktop/client bundle.
  config.himind = {
    baseUrl: process.env.HIMIND_BASE_URL || 'http://himind.hikvision.com',
    ssoSecret: process.env.HIMIND_SSO_SECRET || '',
    ssoIssuer: process.env.HIMIND_SSO_ISSUER || 'hidesign-web',
    ssoAudience: process.env.HIMIND_SSO_AUDIENCE || 'himind',
    ticketTtlSeconds: 60,
    // RS256 private key stays on this central service. The local HiDesign
    // daemon only receives a short-lived user assertion and never sees the key.
    mcpJwtPrivateKey:
      (process.env.HIMIND_MCP_JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      || himindMcpJwtPrivateKey.content,
    mcpJwtPrivateKeyFile: himindMcpJwtPrivateKeyFile,
    mcpJwtPrivateKeyLoadError: himindMcpJwtPrivateKey.error,
    mcpJwtIssuer: process.env.HIMIND_MCP_JWT_ISSUER || 'hidesign',
    mcpJwtAudience: process.env.HIMIND_MCP_JWT_AUDIENCE || 'himind-mcp',
    mcpJwtKeyId: process.env.HIMIND_MCP_JWT_KEY_ID || 'hidesign-himind-01',
    mcpJwtTtlSeconds: 300,
    mcpJwtPublicKey: fs.readFileSync(
      path.join(appInfo.baseDir, 'config', 'himind-mcp-public.pem'),
      'utf8'
    ),
    // Fixed destination: this route is not a general-purpose forward proxy.
    mcpUpstreamUrl: 'https://himind.hikvision.com/gateway/mcp',
    mcpCaFile: himindMcpCaFile,
    mcpCaCertificate: himindMcpCa.content,
    mcpCaLoadError: himindMcpCa.error,
  };

  // AI research workbench uses the same short-lived, server-issued login
  // ticket pattern as HiMind, but keeps an independent audience and secret.
  config.aiResearch = {
    baseUrl: process.env.AI_RESEARCH_BASE_URL || 'http://drw.hikvision.com/',
    ssoSecret: process.env.AI_RESEARCH_SSO_SECRET || '',
    ssoIssuer: process.env.AI_RESEARCH_SSO_ISSUER || 'hidesign-web',
    ssoAudience: process.env.AI_RESEARCH_SSO_AUDIENCE || 'design-research-workbench',
    ticketTtlSeconds: 60,
  };

  // 数据库配置
  config.db = {
    host: '10.17.68.13',
    port: '5432',
    user: 'yapovichi',
    password: 'e6a22c32a1fb66309c8b9497952b4639',
    database: 'hidesign',
  };

  // ResourceHub blob 存储目录
  config.blobDir = path.join(appInfo.baseDir, 'data', 'blobs');

  // 社区插件市场公开 API 基地址（含反向代理路径前缀）。
  // 部署在 pixso.hikvision.com.cn/hik-plugin/hidesign-web 后面，
  // 因此 coverUrl / archiveUrl 需要带上 /hik-plugin/hidesign-web 前缀，
  // 否则前端直接访问 /hdw/api/... 会 404。
  config.community = {
    publicApiBase: 'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web',
  };

  // add your user config here
  const userConfig = {
    // myAppName: 'egg',
  };


  return {
    ...config,
    ...userConfig,
  };
};
