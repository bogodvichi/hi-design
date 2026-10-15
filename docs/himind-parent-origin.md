# HiMind 动态父页面来源对接

## HiDesign / HDW 已实现的协议

HiDesign 每次打开内嵌 HiMind 时，将当前 `window.location.origin` 作为
`parent_origin` 发送给 `POST /api/auth/himind/launch`。包括开发版、正式版，
端口均取当前页面的实际值，不内置固定端口。

daemon 校验其为精确的 HTTP(S) origin，并与浏览器的 `Origin` 请求头一致。
来源必须符合当前 daemon / web 监听端口和 `OD_ALLOWED_ORIGINS` 的现有规则；
换端口后旧端口不再有效。CLI 可使用
`od auth himind --parent-origin <origin> --json` 调用同一接口。

daemon 在已有 OA 校验请求体中将 `parent_origin` 传给 HDW。
HDW 只允许精确的 `127.0.0.1`、`localhost`、`[::1]` 本机 origin，或
`HIMIND_PARENT_ORIGINS` 中显式允许的网页 origin，仍需通过 OA 身份校验才签发票据。
本机端口随每次启动变化，无需加入固定端口白名单。

网页部署需同时在 daemon 的 `OD_ALLOWED_ORIGINS` 和 HDW 的
`HIMIND_PARENT_ORIGINS` 中配置完整 origin；后者为逗号分隔列表，不支持通配符。
这些是允许嵌入的正式网页地址，不是每次构建 HiMind 时指定的父页面地址。

沿用现有 HS256 SSO 票据与回调，新增签名 claim `parent_origin`：

```json
{
  "iss": "hidesign-web",
  "aud": "himind",
  "sub": "alice",
  "parent_origin": "http://127.0.0.1:49152"
}
```

示例省略其他现有 claims，`49152` 仅为示意端口。实际票据仍包含 `jti`、
`iat`、`exp` 等字段；当前签发有效期为 60 秒。`parent_origin` 位于签名负载内，
不增加未签名的回调查询参数，不暴露 OA / 羽点 Cookie。

无 `parent_origin` 的旧客户端或独立 CLI 登录仍可签发身份票据，但不得据此启用目录桥接。

## HiMind 研发需要修改的内容

1. 在 `/api/v1/auth/hidesign/callback` 沿用现有签名、算法、issuer、audience、
   有效期和一次性票据校验，成功后读取 `parent_origin`。不得只解码 JWT 后使用该字段。
2. 将服务端已验证的 origin 通过本次回调的受控初始化数据交给当前 iframe，
   并按该窗口保存，例如前端的 `sessionStorage`。须与当前 HiMind 登录身份绑定，
   登出、换身份、重新执行回调时清除或替换。不要按用户名保存一个全局 origin，
   否则同一用户同时使用多个客户端或不同端口会互相覆盖。
3. 人员目录桥接改用该 origin：发送请求时
   `window.parent.postMessage(request, parentOrigin)`；接收回复时同时检查
   `event.origin === parentOrigin`、`event.source === window.parent`、
   同一 `requestId`，并保留现有字段和人员结果校验。
4. `himind:sso-ready` / `himind:auth-required` 消息也使用已验证的父页面 origin。
   `VITE_HIDESIGN_PARENT_ORIGIN` 不再作为运行时信任来源；不能改为 `*`，
   也不能从 URL 参数、`document.referrer` 或第一条收到的消息中建立来源信任。
5. 票据缺少该 claim 或初始化状态丢失时，不启用目录桥接，提示重新从 HiDesign 打开。
   保留 HiMind 原生 OA 登录及其目录查询；原生登录本身不授予父窗口桥接能力。
6. 保持人员搜索 v1 消息不变：`himind:directory-search:v1` →
   `hidesign:directory-search-result:v1`；仅当搜索接口返回
   `directory_delegation_required` 时委托宿主。成功结果必须有 `people` 数组，
   最多 30 人，失败只返回 `ok: false`，默认等待 5 秒。

## 发布和验收

需发布本仓库的 HiDesign 客户端和 `hidesign-web` HDW 服务，以及 HiMind 对应前后端。
仅发布客户端无法让旧版 HDW 签出新 claim，也无法让旧版 HiMind 发起目录桥接。

验收至少覆盖：两个不同的本机端口分别登录并搜索成功；同一用户同时打开两个客户端
互不影响；客户端换端口后重新打开 HiMind 即自动绑定新来源；错误来源、其他窗口、
篡改票据、旧 `requestId`、切换 OA 身份时不接受旧结果；旧身份票据不启用桥接。

本仓库回归命令：

```sh
corepack pnpm --filter @open-design/web test tests/components/FederatedWorkspaceFrame.test.tsx tests/components/HiMindDirectoryBridge.test.tsx
corepack pnpm --filter @open-design/daemon exec vitest run -c vitest.config.ts tests/routes/auth-himind.test.ts tests/http/hdw-himind-launch.test.ts
cd hidesign-web
node --experimental-strip-types --test test/app/controller/api/himind_sso.test.ts
```
