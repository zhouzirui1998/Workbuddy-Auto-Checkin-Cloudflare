# Workbuddy-Auto-Checkin-Cloudflare

一个可自行部署到 Cloudflare 的 WorkBuddy 多账号管理工具。中国区账号支持扫码登录、每日自动签到和积分查询；WorkBuddy 国际版支持浏览器 OAuth 登录和积分查询。

本项目采用“每人部署自己的一份”的方式：你自己的账号数据保存在你自己的 Cloudflare D1 中。下载发行包不会取得别人的账号，也不会自动替你完成 Cloudflare 或 WorkBuddy 授权。

## 先确认你要做什么

- **从未部署过：** 下载最新发行包，解压后运行 `setup.bat`。
- **已经部署过，想保留账号和记录：** 找到上次运行 `setup.bat` 的原文件夹，保留其中的 `.deploy`，用新包文件覆盖源码后运行 `update.bat`。不要从新解压的空文件夹重新安装。
- **只是修改签到时间：** 登录管理后台，在“设置”中修改，无需下载或重新部署。

如果已经部署过却找不到含 `.deploy` 的原文件夹，请先停止操作；不要用 `setup.bat` 直接覆盖现有 Worker，否则新生成的加密密钥可能让原账号凭据无法读取。

## 功能

- 中国区扫码登录，国际版通过官方浏览器 OAuth 登录，不需要手工复制 Token
- 同一个管理页绑定多个中国区与国际版账号，并清楚标记账号版本
- 中国区每日定时签到，后台可直接修改北京时间，也可手动单个或全部签到
- 中国区账号签到成功后自动刷新该账号积分；若积分接口读取失败，保留签到成功记录并提示可手动重试
- 管理页保持打开时，每分钟只读同步一次后台数据；切回页面时也会更新展示，无需手动点“刷新”查看自动签到后的积分
- 定时任务按账号核对当天签到结果：已签到账号不重复请求；失败账号每分钟自动重试，直至所有已启用中国区账号完成。登录失效的账号需重新授权，恢复后会继续尝试
- 账号区“刷新”会同时更新所有账号积分与中国区签到状态，不会代替用户执行签到
- 最近记录区分“人工签到”和“自动签到”，同一账号每天最多保留一条签到记录
- 当天改到尚未到达的新时间会重新安排任务；没有可签到账号时不会误标记为当天已完成
- 读取单个或全部账号的剩余积分、总积分和最近到期时间
- 账号卡单独显示最近一批可用积分的到期时间（北京时间）；官方未返回时明确标注，不把未知日期当成永久有效
- 国际版签到接口未开放时明确显示“签到未开放”，不会伪造成成功或失败
- Access Token 过期前自动刷新
- 暂停、启用、删除账号
- 最近 30 天签到记录
- 响应式中文管理界面，支持深色模式
- 后台修改管理密码，忘记密码可在部署机上重置
- Token 使用 AES-256-GCM 加密后保存到 D1，密钥只存在 Cloudflare Secret 中

> 本项目调用的是 WorkBuddy 客户端使用的非公开接口，和腾讯/WorkBuddy 官方没有关联。接口随时可能调整；使用前请自行确认符合服务条款，并仅管理你有权使用的账号。国际版目前没有可用的签到接口，本项目不会尝试伪造签到结果。

## 一键部署

### 从 GitHub Releases 下载（推荐）

普通用户进入 [最新发行版](https://github.com/zhouzirui1998/Workbuddy-Auto-Checkin-Cloudflare/releases/latest)，下载 `workbuddy-auto-checkin-v*.zip`。解压到一个普通文件夹，不要在压缩包内直接运行 BAT 文件。发行页同时提供 `.sha256.txt` 校验值；下载后可用 `Get-FileHash 文件名 -Algorithm SHA256` 核对。

Releases 中的发行包已经排除 `.git`、`.deploy`、`.dev.vars`、`node_modules`、缓存和日志，仅包含部署所需源码、MIT `LICENSE`、中文使用说明与安装脚本。GitHub 自动提供的 “Source code” 压缩包也能使用，但面向普通用户时优先下载项目额外上传的发行包。

准备条件：

1. 一个 Cloudflare 账号。
2. Windows 10/11 自带或已安装 Windows Package Manager（`winget`）。如已安装 Node.js 20.19 或更高版本，则不需要 `winget`。

Windows 首次部署步骤：

1. 下载并解压发行包，双击解压目录中的 `setup.bat`。
2. 脚本检查 Node.js；未安装或版本低于 20.19 时，会通过 `winget` 安装当前 Node.js LTS。安装器可能弹出 Windows 管理员确认。
3. 按终端提示设置管理密码、北京时间签到时间和 Worker 名称。管理密码至少 12 位，输入时会显示，请避免旁人看到。
4. 如果这台电脑尚未登录 Cloudflare，浏览器会打开授权页面，请登录你自己的 Cloudflare 账号并授权 Wrangler。已经登录过时会跳过网页授权，这是正常的。
5. 等待 Worker、D1 数据库、数据表、定时触发器和密钥配置完成。看到“安装完成”后，脚本会尝试打开管理后台；若未自动打开，复制终端中的 `workers.dev` 网址手动打开。
6. 使用第 3 步设置的管理密码登录，再按下文添加账号。

部署完成后请保留整个解压目录，尤其是其中自动生成的 `.deploy` 文件夹；以后更新或重置管理密码需要它。`.deploy` 不应分享给其他人。

少数没有 `winget` 的旧版 Windows 需要先安装 Microsoft Store 中的“应用安装程序”，或手动安装 [Node.js 20.19 或更高版本](https://nodejs.org/)。macOS / Linux 用户仍需先安装 Node.js，再运行：

```bash
npm install
npm run setup:cloudflare
```

管理后台会提示：首次部署或更新定时触发器后，Cloudflare 的自动签到定时任务可能需要约 15 分钟生效。后台页面可立即使用；首次测试建议把签到时间设在 20 分钟以后。如果超过这个时间仍未自动签到，应检查定时触发器和账号状态，不要一直等待。

### 发给别人时，密码怎么设？

管理密码不是进入管理页后才首次创建的。接收者在自己电脑上双击 `setup.bat` 时，安装向导的第一步就会让他设置自己的管理密码；网站在部署完成前尚未建立，因此不会出现“必须先登录才能设密码”的死循环。

建议通过 GitHub 仓库或只含源码的压缩包分发。**不要把你自己的 `.deploy`、`.dev.vars` 或 `node_modules` 发给别人**；前两者是你的本地部署状态，而 `.deploy` 还会让安装向导认为项目已经部署。这些路径已写入 `.gitignore`，正常推送到 GitHub 时不会被包含。

### 添加账号

1. 用管理密码登录。
2. 点击“添加账号”。
3. 选择账号版本：
   - 中国区：使用手机扫描二维码，并在 WorkBuddy 页面确认登录。
   - 国际版：打开官方授权页，使用 Google、GitHub、X、邮箱等方式完成 OAuth 登录。
4. 中国区账号出现后，可以点击“立即签到”验证；国际版账号可以点击“刷新积分”验证登录状态。
5. 继续点击“添加账号”即可绑定更多账号。

国际版没有原生扫码登录。如果浏览器已经登录过 `workbuddy.ai`，官方授权页有可能只显示“登录成功”却没有完成绑定；此时请点击“复制授权链接”，粘贴到浏览器无痕窗口完成登录。本项目只保存 WorkBuddy 签发的 Token，不接收也不保存 Google、GitHub 等第三方账号密码。

账号卡片中的“刷新积分”只读取当前账号；页面上方的“刷新全部积分”会逐个读取所有账号。账号区右上角的“刷新”会读取所有账号积分和中国区签到状态，**不会执行签到**。要主动签到，请使用中国区账号上的“立即签到”或页面上方的“中国区全部签到”。积分结果会缓存到 D1，读取失败时仍保留上次成功值，并显示本次错误，不会把失败误显示为 0。

“最近记录”中的“人工签到”和“自动签到”表示触发方式。一个账号在同一个北京时间日期最多显示一条记录；当天已签到后再次点击，不会新增一条重复记录。

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

如果已经部署过并希望保留账号、积分和签到记录，**不要在新解压的空目录里运行 `setup.bat`**。Windows 更新步骤：

1. 找到上次部署使用的原文件夹，确认里面有 `.deploy/wrangler.jsonc`；记下原来的管理后台网址。
2. 先把原文件夹复制一份，妥善保管。注意这只备份本地配置，不等于备份云端 D1 数据。
3. 把新发行包解压到另一个临时文件夹，将解压出的文件复制到原文件夹，提示同名文件时选择“替换”。新包不包含 `.deploy`，原文件夹中的 `.deploy` 必须保留。
4. 在原文件夹双击 `update.bat`。脚本会检查 Node.js、安装依赖、运行必要的数据库迁移并更新 Worker；不会重设管理密码或 Token 加密密钥。
5. 看到 `Update completed` 后，打开原来的管理后台网址并刷新。访问网址后加 `/api/health`，可查看云端 `version` 是否为发行包版本。

若第 1 步找不到 `.deploy`，`update.bat` 会停止，不会尝试创建新部署。不要为绕过检查而改运行 `setup.bat`。

macOS / Linux 用户在保留 `.deploy` 的原部署目录中运行：

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
  └─ 中国区扫码 / 国际版浏览器 OAuth → WorkBuddy 状态轮询
                    ↓
             加密 Token 写入 D1
                    ↓
Cloudflare Cron（每分钟唤醒）
              ↓
        D1 检查已设时间与今日执行锁
              ↓
  遍历已启用中国区账号 → 刷新 Token → 查询签到状态 → daily-checkin
                    ↓
             D1 保存结果，管理页展示

中国区刷新积分 → summary / paid / free 资源接口
国际版刷新积分 → get-user-resource 资源接口
                    ↓
       归一化并去重套餐 → D1 缓存积分摘要
```

OAuth 临时状态同样加密保存在 D1，因此 Worker 即使切换实例也能继续轮询。Cron 每分钟检查一次 D1 中的北京时间设置，到点后用日期锁保证当天只执行一轮。每个中国区账号签到前还会获取一个短时数据库锁，防止“手动签到”和定时任务同时触发重复请求。国际版在任何签到请求发出前就会被跳过。

最近记录按账号和北京时间日期去重：当天失败后重试成功会更新原记录；当天已有成功或已签到结果时，后续重复点击不会新增记录，也不会覆盖最初的人工/自动来源与完成时间。

默认调用的中国区接口包括：

- `POST /v2/plugin/auth/state?platform=workbuddy`
- `GET /v2/plugin/auth/token?state=...`
- `GET /v2/plugin/login/account?state=...`
- `POST /v2/plugin/auth/token/refresh`
- `POST /v2/billing/meter/checkin-activity-status`
- `POST /v2/billing/meter/daily-checkin`
- `POST /billing/meter/get-user-resource-summary`
- `POST /billing/meter/get-user-resource-paid-packages`
- `POST /billing/meter/get-user-resource-free-packages`
- `POST /v2/billing/meter/get-user-resource`（兼容回退）

国际版使用独立域名 `https://www.workbuddy.ai`，OAuth 参数为 `platform=workbuddy-ai`；积分读取优先调用 `/billing/meter/get-user-resource`，仅 HTTP 404 时回退 `/v2/billing/meter/get-user-resource`。账号版本、域名和 Token 会做一致性校验，避免把国际版凭据发送到中国区域名。

实现依据来自 [changexbc/workbuddy-switch](https://github.com/changexbc/workbuddy-switch) 中的 WorkBuddy 客户端兼容逻辑。国际版签到能力集中在版本配置中；官方未来开放接口后可以通过软件更新启用，现有国际版账号无需重新添加。

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

如果怀疑 Token 加密密钥泄露，建议先在管理页删除全部账号，再更新 `TOKEN_ENCRYPTION_KEY`，随后重新登录绑定；直接更换密钥会让旧凭据无法解密。

## 常见问题

**二维码一直等待怎么办？** 先确认使用的是 WorkBuddy 中国区账号，二维码未过期，并在手机页面完成了确认。关闭弹窗重新生成不会影响已绑定账号。

**国际版授权后一直等待怎么办？** 复制授权链接并粘贴到浏览器无痕窗口，再选择 Google、GitHub、X 或邮箱完成登录。不要把第三方账号密码输入本项目页面。

**某个账号显示“需重新登录”怎么办？** 该账号的 Refresh Token 也已失效。点击“添加账号”，选择相同版本并重新登录同一账号，会更新凭据而不是创建重复账号。

**为什么国际版显示“签到未开放”？** 当前国际版没有可用的签到接口。系统仍可管理账号和读取积分，但不会把未开放状态显示成“已签到”，也不会让定时任务反复请求失败接口。

**如何修改签到时间？** 登录后点击右上角“设置”，直接选择新的北京时间并保存，不需要重新部署。

如果今天的旧时间已经执行过，将时间改到今天尚未到达的时刻后，新时间仍会触发；改到已经过去的时刻不会重复执行。定时任务运行时如果还没有已启用的中国区账号，也不会把今天标记为完成，添加账号后会在后续检查中继续尝试。

**为什么定时签到可能略有延迟？** 基础 Cron 每分钟唤醒一次，通常会在设定分钟内开始；Cloudflare 平台调度仍可能有轻微延迟。项目会用每日执行锁和账号级锁减少重复签到。

**刚部署后为什么没有自动签到？** 新建或修改 Cloudflare 定时触发器后，配置可能需要约 15 分钟传播；后台网页能打开，不代表 Cron 已经开始运行。首次测试建议把签到时间设在部署完成 20 分钟以后。超过这个时间仍没有自动签到时，按下面顺序排查，不要一直等待：

1. 登录后台“设置”，确认签到时间是北京时间；确认中国区账号已启用且没有“需重新登录”。国际版目前不参与签到。
2. 查看“最近记录”，区分“自动签到”“人工签到”及失败说明。账号区“刷新”只更新状态，不会发起签到。
3. 在 Cloudflare 控制台打开 **Workers & Pages → 当前 Worker → Settings → Trigger Events**，确认存在 `* * * * *`，并在 “View events” 中查看定时调用记录。[Cloudflare Cron 官方说明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
4. 如果没有触发记录，检查部署是否成功以及是否使用了正确的 Cloudflare 账号和 Worker；如果有触发记录但签到失败，再根据 Worker 日志和后台错误信息排查。不要通过反复重装来“修复”，以免影响原账号凭据。

**为什么双击 BAT 后没有跳转 Cloudflare 授权页？** 如果 Wrangler 已经在本机登录，安装向导会直接复用该登录状态。请先确认终端显示的是你打算使用的 Cloudflare 账号。

**为什么 `update.bat` 提示缺少 `.deploy`？** 你运行它的不是原部署目录，或原目录中的本地部署配置已经丢失。把新版文件复制到保留 `.deploy` 的原目录后再运行；不要直接在新解压目录运行 `setup.bat` 覆盖旧部署。

## License

[MIT](LICENSE)
