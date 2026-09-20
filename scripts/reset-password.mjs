import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployConfig = resolve(root, ".deploy", "wrangler.jsonc");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(deployConfig)) {
  console.error("没有找到部署配置，请先运行首次安装向导。");
  process.exit(1);
}

function runWrangler(args, value) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    stdio: value ? ["pipe", "inherit", "inherit"] : "inherit",
    input: value ? `${value}\n` : undefined,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`命令执行失败：wrangler ${args.join(" ")}`);
}

const rl = createInterface({ input, output });
try {
  const configured = process.env.RESET_ADMIN_PASSWORD;
  const password = configured ?? (await rl.question("设置新的管理密码（12 至 256 位，输入会显示）："));
  if (password.length < 12 || password.length > 256) throw new Error("管理密码需要 12 至 256 位");

  console.log("正在更新管理密码并使旧会话失效…");
  runWrangler(["secret", "put", "ADMIN_PASSWORD", "--config", deployConfig], password);
  runWrangler(
    ["secret", "put", "SESSION_SECRET", "--config", deployConfig],
    randomBytes(32).toString("base64"),
  );
  runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--config",
    deployConfig,
    "--command",
    "DELETE FROM admin_credentials WHERE id = 1",
  ]);
  console.log("密码已重置。现在可以使用新密码登录，所有旧会话均已失效。");
} catch (error) {
  console.error(`密码重置失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
