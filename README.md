# WorkBuddy 自动签到

一个可自行部署到 Cloudflare 的 WorkBuddy 中国区多账号自动签到工具。部署后打开私有管理页，用手机扫码绑定账号；Cloudflare Cron Trigger 会每天定时检查并领取签到积分。

## 功能

- 扫码登录，不需要手工复制 Token
- 同一个管理页绑定多个账号
- 每日定时签到，也可手动单个或全部签到
- Access Token 过期前自动刷新
- 暂停、启用、删除账号
- 最近 30 天签到记录
- 响应式中文管理界面，支持深色模式
- 管理密码、登录限流、同源校验和安全响应头
- Token 使用 AES-256-GCM 加密后保存到 D1，密钥只存在 Cloudflare Secret 中

> 本项目调用的是 WorkBuddy 客户端使用的非公开接口，和腾讯/WorkBuddy 官方没有关联。接口随时可能调整；使用前请自行确认符合服务条款，并仅管理你有权使用的账号。

## 一键部署

准备条件：

1. 一个 Cloudflare 账号。
2. 本机安装 [Node.js 20.19 或更高版本](https://nodejs.org/)。

Windows 用户双击 `setup.bat`。macOS / Linux / Windows 终端用户运行：

```bash
npm install
npm run setup:cloudflare
```

安装向导会要求设置：

- 管理后台密码（至少 12 位）
- 每日签到时间（北京时间，默认 `08:10`）
- Worker 名称（默认 `workbuddy-auto-checkin`）

首次运行时会打开 Cloudflare 授权页，并自动完成 Worker、D1、数据表、定时任务和三个 Secret 的配置。完成后，打开终端显示的 `workers.dev` 地址即可使用。

### 添加账号

1. 用管理密码登录。
2. 点击“添加账号”。
3. 使用手机扫描页面中的二维码，并在 WorkBuddy 页面确认登录。
4. 账号出现后，可以点击“立即签到”验证。
5. 继续点击“添加账号”即可绑定更多账号。

## 更新已部署版本

保留项目目录中的 `.deploy` 文件夹，然后拉取或覆盖新版源码并运行：

```bash
npm install
npm run update:cloudflare
```

更新脚本会先执行新增数据库迁移，再发布 Worker。它不会重置加密密钥。**不要重新运行首次安装向导，也不要随意更换 `TOKEN_ENCRYPTION_KEY`，否则现有账号凭据将无法解密。**

## 本地开发

复制本地变量模板并填入仅用于开发的值：

```bash
cp .dev.vars.example .dev.vars
npm install
npm run dev:prepare
npm run dev
```

Windows PowerShell 可用：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm install
npm run dev:prepare
npm run dev
```

开发服务默认在 `http://localhost:8787`。模拟定时任务时，Wrangler 会显示对应的 `/__scheduled` 测试地址。

提交前执行完整检查：

```bash
npm run check
```

检查包括 Wrangler 类型同步、TypeScript、类型感知 ESLint、Workers Runtime 单元测试和部署 dry-run。

## 架构与工作原理

```text
浏览器管理页
  ├─ 管理密码 → 签名 HttpOnly Cookie
  └─ 扫码登录 → WorkBuddy OAuth 状态轮询
                    ↓
             加密 Token 写入 D1
                    ↓
Cloudflare Cron → 遍历已启用账号 → 刷新 Token → 查询签到状态 → daily-checkin
                    ↓
             D1 保存结果，管理页展示
```

二维码和 OAuth 临时状态同样加密保存在 D1，因此 Worker 即使切换实例也能继续轮询。每个账号签到前会获取一个短时数据库锁，防止“手动签到”和定时任务同时触发重复请求。

默认调用的中国区接口包括：

- `POST /v2/plugin/auth/state?platform=workbuddy`
- `GET /v2/plugin/auth/token?state=...`
- `GET /v2/plugin/login/account?state=...`
- `POST /v2/plugin/auth/token/refresh`
- `POST /v2/billing/meter/checkin-activity-status`
- `POST /v2/billing/meter/daily-checkin`

实现依据来自 [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch) 中的 WorkBuddy 客户端兼容逻辑。本项目只实现中国区签到，因为海外版目前没有相同的签到积分接口。

## 安全说明

- `ADMIN_PASSWORD`、`SESSION_SECRET`、`TOKEN_ENCRYPTION_KEY` 均通过 Cloudflare Secret 保存，不写入仓库。
- Access Token 与 Refresh Token 使用独立的 32 字节 AES-GCM 密钥加密。
- 管理会话使用 HMAC-SHA256 签名的 `HttpOnly + Secure + SameSite=Strict` Cookie。
- 登录失败按来源限流；修改操作要求同源请求。
- 日志不记录 Token、密码或完整凭据。
- 这是“每位使用者部署自己的一份”的自托管模板，不是多人共用的公共 SaaS。这样账号凭据天然隔离在各自的 Cloudflare 账户中。

如果怀疑管理密码泄露，可执行：

```bash
npx wrangler secret put ADMIN_PASSWORD --config .deploy/wrangler.jsonc
```

如果怀疑 Token 加密密钥泄露，建议先在管理页删除全部账号，再更新 `TOKEN_ENCRYPTION_KEY`，随后重新扫码绑定；直接更换密钥会让旧凭据无法解密。

## 常见问题

**二维码一直等待怎么办？** 先确认使用的是 WorkBuddy 中国区账号，二维码未过期，并在手机页面完成了确认。关闭弹窗重新生成不会影响已绑定账号。

**某个账号显示“需重新登录”怎么办？** 该账号的 Refresh Token 也已失效。点击“添加账号”，重新扫码同一账号会更新凭据，不会创建重复账号。

**如何修改签到时间？** 编辑 `.deploy/wrangler.jsonc` 中的 `triggers.crons`（UTC）与 `vars.SCHEDULE_LABEL`，然后运行 `npm run update:cloudflare`。也可以删除 `.deploy` 后重新安装，但重装前应先处理已有加密数据。

**为什么定时签到可能晚几分钟？** Cloudflare Cron Trigger 按 UTC 调度并采用至少一次投递语义；平台调度可能有轻微延迟。项目会先查询今日状态，并用账号级锁减少重复签到。

## License

[MIT](LICENSE)
