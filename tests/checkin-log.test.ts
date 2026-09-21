import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listRecentLogs, recordCheckin } from "../src/repository";

describe("daily check-in records", () => {
  it("keeps one row per account and Beijing date while preserving the first completion source", async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO accounts (id, uid, nickname, domain, credential_ciphertext, credential_iv, enabled, needs_relogin, created_at, updated_at) " +
        "VALUES (?, ?, 'Test account', 'www.codebuddy.cn', 'ciphertext', 'iv', 1, 0, ?, ?)",
    )
      .bind(id, `daily-log-${id}`, now, now)
      .run();

    await recordCheckin(env.DB, id, "2026-09-21", "error", "第一次失败", "manual");
    await recordCheckin(env.DB, id, "2026-09-21", "success", "自动任务签到成功", "automatic");
    await recordCheckin(env.DB, id, "2026-09-21", "already", "今天已经签到", "manual");

    const rows = (await listRecentLogs(env.DB)).filter((row) => row.account_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      local_date: "2026-09-21",
      status: "success",
      message: "自动任务签到成功",
      source: "automatic",
    });
  });
});
