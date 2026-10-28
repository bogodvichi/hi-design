# DRW 免密登录的通讯录会话交接

Hi Design 已有的羽点会话保留在 daemon 中。AI 用研入口取得现有 HDW 签名登录票据后，通过 HTTPS 直接向固定 DRW `/api/auth/platform/directory` 交接通讯录 Cookie。登录票据仅作为服务端请求的 Bearer 授权；不向网页返回 Cookie，不传密码，不变更 HDW 签发协议。

DRW 校验票据签名、issuer、audience、身份、期限及一次性标识，拒绝已消费票据和重复交接。交接只保存在内存；正常登录回调消费票据后，再验证通讯录本人及 OA 绑定，把连接绑定到本次 DRW 会话。全员搜索、邀请签名与资源权限仍走 DRW 原有实现。

TLS 使用 Node 默认及系统信任证书，不跟随重定向；仅允许固定 DRW 回调地址。交接故障不阻断工作台登录，搜索会提示重新打开或重新登录 Hi Design。

需要同时更新 daemon 和 DRW preview.130。已安装的旧版 Hi Design 不会自动带上交接能力；使用更新后的开发客户端验收后，正式包仍需纳入该 daemon 修改。
