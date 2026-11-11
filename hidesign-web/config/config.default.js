/* eslint valid-jsdoc: "off" */

'use strict';

const path = require('path');
const fs = require('fs');

const HIDE_SIGN_SSO_CREDENTIAL_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCXlgmDdTAVXYyt
9MO8rJ6Zv6+dop34w0P6M39WpVlUX7h4jV/M1jdefo76MCUOM0mZhsCWareNRV74
02XU7hK2jMjIJjCuUN2mCTnLQD2sYydVhmqXjncTc2x0mCahTbIBSViIcSUD/edg
GTy1+haBtrR2CohZQ2dB8idyM4ZTbxdJQNYvBOd3lij3xf+949k2sFtDQaFTUT9t
iKBSZKg1HylN1gbHXMfhaEK54o0cSzzvCWEtPtvAYibI0aup1xQxP3U2cyQ/bZG4
pZH9c7N/5h0mkvj59l65GAJlUY+hyWro12/DTpp3E4nIh4AQFB6vVBHH2zw97oYT
pMLw47IhAgMBAAECggEAASKRhjkv6Xu1rHTkHhd+WvhAhoyyx488hQNA7I/G8tie
o5nHZbEyC/DPb18leMYGwsckeJS/3zWKC3SXjBuPI8GQqqTGHjVbzUsxKzQM/p1J
AdX9b46GXZ5rW2vrH3ba24bUrgsV8+ykuWBRqsdiOMJQL/FqzWROFyC1ja6ih3ad
XWFo4JUKP2SYnotRcVY4n672nv7hIGB4fX0CNFHP65Z2eZ+b4OhYP7s+d0cFLiVV
RXhuv3kwcTkGFfOqq7qYg5cGsaiY9uihlhrcUbr+91RdANwh3+sU32dVGPEv18RT
xmBrmTn6t0Jox3qyE6DQ952ntkmBhEZaj18+UV+2WQKBgQDO8wbD01LA35ydDRmo
r1xubDt+07kXm3Vu1D2K40NrorSi8fToM0iQfaJmOOEYVbGe/BbUI6RYizzfu4sy
8QJCKNg5XHdeKHJxgJuW4o2L6+oN+kuMjslS/96GGBtauQbUjdcwYCMvNUWrcTp4
2N4pUMNS7s/hjZqXYeO+0vShNQKBgQC7g8J49aJ5JBkwUU2LyBMaYsyxNzEQWhRX
cg1PHIWXxfMV1XlVQmCl1IvhgbVe89WYbdAI/E303STxVc1R4eBB88aj2/niOm8s
Wu6pRQx0GGCguKCJk82K4FScw21E5wxiHC58uWFMS58v3kFZH9lW5qj6O8n8WZ9m
vKNME5m2vQKBgBs9HZzUycWdKQ361W/AdRgLouEUmP4kdhZ6VQdc1ljqd4Ai/Ks7
ZMev4Zo2zlnXnaNhZtfRQSZuXTrNgorX8gYnPh5+ry9zf2y1EsWPWDYcfRgN47fC
a3lDOFTKA3+zbtS3PqWdYcQq7Nqd8qZJVSR2/t6BlFcJvllChylstsopAoGBAIVk
ZMqhirP8rwKFQ9HlQVmq4QxMQ9XrDr9qPfeCRbLDOXrVwpuZPaGaQuvn1rs2YEMw
EybhPR+s1aPsssPGGD8yiKN2UBvUD9QQ1+iIWySXVt3emS1lfHmHvglKqIe0iUWd
4KAPTBz3SsXFqN0a4ASGz7w7HiQrKU7vcIclBltNAoGBAJvXlkhN7JiGtkWDdwRQ
sum4NMjFJqXVzBfpCSYUV4wy2CtURlcF9LXlKnTtG/0qLKcC2MxUFGdPoyi4Lt5P
MpR2hmRiMbnNrDQW+BUlie6RLhb/JJlzholmXHgu6ymXKjmWPlgx5Aqaj0th+XdR
g7jTIs/H5Flki4jHAxO/RKap
-----END PRIVATE KEY-----`;

function readOptionalPem(file) {
  if (!file) return { content: '', error: '' };
  try {
    return { content: fs.readFileSync(file, 'utf8'), error: '' };
  } catch (err) {
    return { content: '', error: err.message };
  }
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
      // Every worker in an Egg cluster must resolve the same listen port.
      port: 7002,
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
    baseUrl: process.env.AI_RESEARCH_BASE_URL || 'https://drw.hikvision.com/',
    ssoSecret: process.env.AI_RESEARCH_SSO_SECRET || '',
    ssoIssuer: process.env.AI_RESEARCH_SSO_ISSUER || 'hidesign-web',
    ssoAudience: process.env.AI_RESEARCH_SSO_AUDIENCE || 'design-research-workbench',
    ticketTtlSeconds: 60,
    // AI research MCP reuses the same RS256 key pair as HiMind (the research
    // side has registered `kid=hidesign-himind-01`'s public key), but mints a
    // token with a distinct typ/audience so a HiMind token cannot be replayed
    // against the research MCP and vice-versa. Unlike HiMind, the research MCP
    // verifies the JWT itself at `mcpUpstreamUrl`, so this central service does
    // not proxy MCP traffic or hold an internal CA for it.
    mcpJwtPrivateKey:
      (process.env.HIMIND_MCP_JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      || himindMcpJwtPrivateKey.content,
    mcpJwtIssuer: process.env.AI_RESEARCH_MCP_JWT_ISSUER || 'hidesign',
    mcpJwtAudience: process.env.AI_RESEARCH_MCP_JWT_AUDIENCE || 'fde-research-mcp',
    mcpJwtType: process.env.AI_RESEARCH_MCP_JWT_TYPE || 'fde-research-mcp+jwt',
    mcpJwtKeyId: process.env.AI_RESEARCH_MCP_JWT_KEY_ID || 'hidesign-himind-01',
    mcpJwtTtlSeconds: 300,
    mcpUpstreamUrl:
      process.env.AI_RESEARCH_MCP_UPSTREAM_URL
      || 'https://drw.hikvision.com/api/research-mcp',
  };

  // Deferred Hikke/UEDRO passwords are sealed by the desktop daemon with the
  // matching public key. This value is intentionally embedded in the central
  // service config; rotate the pair and key ID if it needs to be replaced.
  config.ssoCredential = {
    privateKey: HIDE_SIGN_SSO_CREDENTIAL_PRIVATE_KEY,
    keyId: 'hidesign-sso-01',
  };

  // 数据库配置
  config.db = {
    host: '10.15.68.102',
    port: '5432',
    user: 'yapovichi',
    password: 'e6a22c32a1fb66309c8b9497952b4639',
    database: 'hidesign-offical',
  };

  // ResourceHub blob 存储目录
  config.blobDir = path.join(appInfo.baseDir, 'data', 'blobs');

  // 社区插件市场公开 API 基地址（含反向代理路径前缀）。
  // 部署在 pixso.hikvision.com.cn/hik-plugin/hidesign-web 后面，
  // 因此 coverUrl / archiveUrl 需要带上 /hik-plugin/hidesign-web 前缀，
  // 否则前端直接访问 /hdw/api/... 会 404。
  config.community = {
    publicApiBase: 'http://127.0.0.1:7002'//'https://pixso.hikvision.com.cn/hik-plugin/hidesign-web',
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
