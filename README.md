# WorkBuddy 自动签到

一个可自行部署到 Cloudflare 的 WorkBuddy 中国区多账号自动签到工具。部署后打开私有管理页，用手机扫码绑定账号；Cloudflare Cron Trigger 会每天定时检查并领取签到积分。

## 功能

- 扫码登录，不需要手工复制 Token
- 同一个管理页绑定多个账号
- 每日定时签到，后台可直接修改北京时间，也可手动单个或全部签到
- Access Token 过期前自动刷新
- 暂停、启用、删除账号
- 最近 30 天签到记录
- 响应式中文管理界面，支持深色模式
- 后台修改管理密码，忘记密码可在部署机上重置
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

### 发给别人时，密码怎么设？

管理密码不是进入管理页后才首次创建的。接收者在自己电脑上双击 `setup.bat` 时，安装向导的第一步就会让他设置自己的管理密码；网站在部署完成前尚未建立，因此不会出现“必须先登录才能设密码”的死循环。

建议通过 GitHub 仓库或只含源码的压缩包分发。**不要把你自己的 `.deploy`、`.dev.vars` 或 `node_modules` 发给别人**；前两者是你的本地部署状态，而 `.deploy` 还会让安装向导认为项目已经部署。这些路径已写入 `.gitignore`，正常推送到 GitHub 时不会被包含。

### 添加账号

1. 用管理密码登录。
2. 点击“添加账号”。
3. 使用手机扫描页面中的二维码，并在 WorkBuddy 页面确认登录。
4. 账号出现后，可以点击“立即签到”验证。
5. 继续点击“添加账号”即可绑定更多账号。

### 修改签到时间或密码

登录管理后台后点击右上角“设置”：

- 签到时间以北京时间保存，无需重新部署。
- 修改管理密码时需输入当前密码；修改成功后，其他已登录设备的会话会失效。

如果已经忘记管理密码，Windows 上双击 `reset-password.bat`，或在保留了 `.deploy` 文件夹的项目目录中运行：

```bash
npm run reset-password
```

输入新密码后，脚本会更新 Cloudflare Secret、清除旧密码验证值，并使所有旧会话失效。

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
Cloudflare Cron（每 5 分钟唤醒）
              ↓
       D1 检查已设时间与今日执行锁
              ↓
  遍历已启用账号 → 刷新 Token → 查询签到状态 → daily-checkin
                    ↓
             D1 保存结果，管理页展示
```

二维码和 OAuth 临时状态同样加密保存在 D1，因此 Worker 即使切换实例也能继续轮询。Cron 每 5 分钟检查一次 D1 中的北京时间设置，到点后用日期锁保证当天只执行一轮。每个账号签到前还会获取一个短时数据库锁，防止“手动签到”和定时任务同时触发重复请求。

默认调用的中国区接口包括：

- `POST /v2/plugin/auth/state?platform=workbuddy`
- `GET /v2/plugin/auth/token?state=...`
- `GET /v2/plugin/login/account?state=...`
- `POST /v2/plugin/auth/token/refresh`
- `POST /v2/billing/meter/checkin-activity-status`
- `POST /v2/billing/meter/daily-checkin`

实现依据来自 [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch) 中的 WorkBuddy 客户端兼容逻辑。本项目只实现中国区签到，因为海外版目前没有相同的签到积分接口。

## 安全说明

- 首次管理密码通过 `ADMIN_PASSWORD` Cloudflare Secret 安全引导；第一次成功登录后，D1 只保存加随机盐的 PBKDF2-SHA256 验证值。
- `SESSION_SECRET`、`TOKEN_ENCRYPTION_KEY` 通过 Cloudflare Secret 保存，不写入仓库。
- Access Token 与 Refresh Token 使用独立的 32 字节 AES-GCM 密钥加密。
- 管理会话使用 HMAC-SHA256 签名的 `HttpOnly + Secure + SameSite=Strict` Cookie。
- 登录失败按来源限流；修改操作要求同源请求。
- 日志不记录 Token、密码或完整凭据。
- 这是“每位使用者部署自己的一份”的自托管模板，不是多人共用的公共 SaaS。这样账号凭据天然隔离在各自的 Cloudflare 账户中。

如果忘记管理密码或怀疑密码泄露，请使用专用脚本：

```bash
npm run reset-password
```

只手工修改 `ADMIN_PASSWORD` Secret 不会覆盖后台中已经设置的密码，因此不要用它代替重置脚本。

如果怀疑 Token 加密密钥泄露，建议先在管理页删除全部账号，再更新 `TOKEN_ENCRYPTION_KEY`，随后重新扫码绑定；直接更换密钥会让旧凭据无法解密。

## 常见问题

**二维码一直等待怎么办？** 先确认使用的是 WorkBuddy 中国区账号，二维码未过期，并在手机页面完成了确认。关闭弹窗重新生成不会影响已绑定账号。

**某个账号显示“需重新登录”怎么办？** 该账号的 Refresh Token 也已失效。点击“添加账号”，重新扫码同一账号会更新凭据，不会创建重复账号。

**如何修改签到时间？** 登录后点击右上角“设置”，直接选择新的北京时间并保存，不需要重新部署。

**为什么定时签到可能晚几分钟？** 基础 Cron 每 5 分钟唤醒一次，所以最差需等到下一个检查点；Cloudflare 平台调度也可能有轻微延迟。项目会用每日执行锁和账号级锁减少重复签到。

## License

[MIT](LICENSE)
