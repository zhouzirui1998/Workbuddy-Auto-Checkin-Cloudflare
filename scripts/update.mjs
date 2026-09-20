import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployConfig = resolve(root, ".deploy", "wrangler.jsonc");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(deployConfig)) {
  console.error("没有找到部署配置，请先运行 npm run setup:cloudflare。");
  process.exit(1);
}

function run(args) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("正在应用数据库迁移…");
run(["d1", "migrations", "apply", "DB", "--remote", "--config", deployConfig]);
console.log("正在发布更新…");
run(["deploy", "--config", deployConfig]);
console.log("更新完成。");
