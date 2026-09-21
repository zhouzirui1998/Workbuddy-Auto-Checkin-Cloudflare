import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = resolve(root, ".deploy");
const sourceConfig = resolve(root, "wrangler.jsonc");
const deployConfig = resolve(deployDir, "wrangler.jsonc");
const installMarker = resolve(deployDir, "install-complete");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

function runWrangler(args, options = {}) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
  });
  if (result.status !== 0) throw new Error(`命令执行失败：wrangler ${args.join(" ")}`);
}

function runWranglerCapture(args) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.status !== 0) throw new Error(`命令执行失败：wrangler ${args.join(" ")}`);
  return output;
}

function extractWorkersDevUrl(output) {
  return output.match(/https:\/\/[^\s]+\.workers\.dev/iu)?.[0]?.replace(/[),.]+$/u, "") ?? null;
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  return result.status === 0;
}

function normalizeBeijingTime(time) {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(time);
  if (!match) throw new Error("时间格式必须是 HH:MM，例如 08:10");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("请输入有效的北京时间");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

if (existsSync(installMarker)) {
  console.error("\n检测到已有部署配置。为避免覆盖加密密钥，安装已停止。\n如需更新代码，请运行 npm run update:cloudflare。\n");
  process.exit(1);
}

const rl = createInterface({ input, output });
try {
  console.log("\nWorkBuddy 自动签到 · Cloudflare 安装向导\n");
  const envPassword = process.env.SETUP_ADMIN_PASSWORD;
  const adminPassword = envPassword ?? (await rl.question("设置管理密码（至少 12 位，输入会显示）："));
  if (adminPassword.length < 12 || adminPassword.length > 256) throw new Error("管理密码需要 12 至 256 位");
  if (!existsSync(deployConfig)) {
    const timeInput = process.env.SETUP_BEIJING_TIME ?? (await rl.question("每天几点签到（北京时间，默认 08:10）："));
    const time = normalizeBeijingTime(timeInput || "08:10");
    const workerNameInput = process.env.SETUP_WORKER_NAME ?? (await rl.question("Worker 名称（默认 workbuddy-auto-checkin）："));
    const workerName = workerNameInput || "workbuddy-auto-checkin";
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(workerName)) {
      throw new Error("Worker 名称只能使用小写字母、数字和连字符，长度 3-63 位");
    }

    mkdirSync(deployDir, { recursive: true });
    copyFileSync(sourceConfig, deployConfig);
    const config = JSON.parse(readFileSync(deployConfig, "utf8"));
    config.name = workerName;
    config.d1_databases[0].database_name = `${workerName}-db`;
    config.vars.DEFAULT_CHECKIN_TIME = time;
    writeFileSync(deployConfig, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } else {
    console.log("检测到未完成的安装，将从现有部署配置继续。\n");
  }

  // Wrangler resolves paths relative to the copied config file in .deploy.
  const deploySettings = JSON.parse(readFileSync(deployConfig, "utf8"));
  deploySettings.$schema = "../node_modules/wrangler/config-schema.json";
  deploySettings.main = "../src/index.ts";
  deploySettings.d1_databases[0].migrations_dir = "../migrations";
  deploySettings.assets.directory = "../public";
  deploySettings.triggers.crons = ["* * * * *"];
  deploySettings.vars.DEFAULT_CHECKIN_TIME ??= "08:10";
  writeFileSync(deployConfig, `${JSON.stringify(deploySettings, null, 2)}\n`, "utf8");

  console.log("\n1/5 检查 Cloudflare 登录状态…");
  const auth = spawnSync(process.execPath, [wranglerCli, "whoami"], { cwd: root, stdio: "inherit" });
  if (auth.status !== 0) runWrangler(["login"]);

  console.log("\n2/5 创建 Worker 与 D1 数据库…");
  runWrangler(["deploy", "--config", deployConfig]);

  console.log("\n3/5 初始化数据库…");
  runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", deployConfig]);
  const initialTime = JSON.parse(readFileSync(deployConfig, "utf8")).vars.DEFAULT_CHECKIN_TIME;
  runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--config",
    deployConfig,
    "--command",
    `UPDATE app_settings SET checkin_time = '${initialTime}', updated_at = ${Date.now()} WHERE id = 1`,
  ]);

  console.log("\n4/5 写入加密密钥…");
  const sessionSecret = randomBytes(32).toString("base64");
  const encryptionKey = randomBytes(32).toString("base64");
  runWrangler(["secret", "put", "ADMIN_PASSWORD", "--config", deployConfig], { input: `${adminPassword}\n` });
  runWrangler(["secret", "put", "SESSION_SECRET", "--config", deployConfig], { input: `${sessionSecret}\n` });
  runWrangler(["secret", "put", "TOKEN_ENCRYPTION_KEY", "--config", deployConfig], { input: `${encryptionKey}\n` });
  // Secret uploads create a working deployment. Mark installation complete now
  // so a later publishing failure cannot cause a retry to rotate encryption keys.
  writeFileSync(installMarker, `${new Date().toISOString()}\n`, "utf8");

  console.log("\n5/5 发布完整版本…");
  const deployOutput = runWranglerCapture(["deploy", "--config", deployConfig]);
  const workerUrl = extractWorkersDevUrl(deployOutput);
  console.log("\n安装完成！");
  if (workerUrl) {
    console.log(`管理后台地址：${workerUrl}`);
    console.log("正在打开浏览器登录页面，请使用刚才设置的管理密码登录…");
    if (openBrowser(workerUrl)) {
      console.log("浏览器已打开。若页面未出现，请复制上面的地址手动打开。\n");
    } else {
      console.log("浏览器未能自动打开，请复制上面的地址，在浏览器中打开并登录。\n");
    }
  } else {
    console.log("没有自动识别到 workers.dev 地址，请复制上方 Wrangler 输出的网址，在浏览器中打开并使用刚才设置的管理密码登录。\n");
  }
} catch (error) {
  console.error(`\n安装失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
