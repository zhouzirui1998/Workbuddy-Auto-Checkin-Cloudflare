import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  claimScheduledRun,
  finishScheduledRun,
  listScheduledCheckinAccounts,
  recordCheckin,
  updateCheckinTime,
} from "../src/repository";

async function addAccount(variant: "cn" | "ai" = "cn", enabled = true): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO accounts (id, uid, domain, variant, credential_ciphertext, credential_iv, enabled, needs_relogin, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, 'ciphertext', 'iv', ?, 0, ?, ?)",
  )
    .bind(id, `schedule-${id}`, variant === "cn" ? "www.codebuddy.cn" : "www.workbuddy.ai", variant, enabled ? 1 : 0, now, now)
    .run();
  return id;
}

describe("configurable automatic check-in schedule", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM checkin_logs WHERE account_id IN (SELECT id FROM accounts WHERE uid LIKE 'schedule-%')").run();
    await env.DB.prepare("DELETE FROM accounts WHERE uid LIKE 'schedule-%'").run();
    await env.DB.prepare(
      "UPDATE app_settings SET checkin_time = '08:10', last_scheduled_date = NULL, scheduled_lock_until = NULL, updated_at = ? WHERE id = 1",
    )
      .bind(Date.now())
      .run();
  });

  it("claims no more than one run per Beijing calendar day after the configured time", async () => {
    await updateCheckinTime(env.DB, "08:10", "Asia/Shanghai", Date.parse("2026-09-20T07:00:00+08:00"));

    const beforeTime = Date.UTC(2026, 8, 20, 0, 9);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", beforeTime)).resolves.toMatchObject({
      claimed: false,
      localDate: "2026-09-20",
      checkinTime: "08:10",
    });

    const scheduledTime = Date.UTC(2026, 8, 20, 0, 10);
    const claim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime);
    expect(claim).toMatchObject({ claimed: true, localDate: "2026-09-20", checkinTime: "08:10" });
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime)).resolves.toMatchObject({
      claimed: false,
    });

    await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, true);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 60_000)).resolves.toMatchObject({
      claimed: false,
    });

    const nextDay = Date.UTC(2026, 8, 21, 0, 10);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", nextDay)).resolves.toMatchObject({
      claimed: true,
      localDate: "2026-09-21",
    });
  });

  it("allows a later same-day time to run after the earlier schedule already completed", async () => {
    const morning = Date.parse("2026-09-20T08:10:00+08:00");
    const morningClaim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", morning);
    expect(morningClaim.claimed).toBe(true);
    await finishScheduledRun(env.DB, morningClaim.localDate, morningClaim.checkinTime, true);

    await updateCheckinTime(
      env.DB,
      "20:10",
      "Asia/Shanghai",
      Date.parse("2026-09-20T20:03:00+08:00"),
    );

    await expect(
      claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", Date.parse("2026-09-20T20:10:00+08:00")),
    ).resolves.toMatchObject({ claimed: true, localDate: "2026-09-20", checkinTime: "20:10" });
  });

  it("does not complete the day when no eligible account was available", async () => {
    const scheduledTime = Date.parse("2026-09-20T08:10:00+08:00");
    const claim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime);
    expect(claim.claimed).toBe(true);

    await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, false);

    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 5 * 60_000)).resolves.toMatchObject({
      claimed: true,
      localDate: "2026-09-20",
    });
  });

  it("keeps the completed marker when the new same-day time has already passed", async () => {
    const morning = Date.parse("2026-09-20T08:10:00+08:00");
    const claim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", morning);
    await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, true);

    await updateCheckinTime(
      env.DB,
      "07:35",
      "Asia/Shanghai",
      Date.parse("2026-09-20T20:03:00+08:00"),
    );

    await expect(
      claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", Date.parse("2026-09-20T20:05:00+08:00")),
    ).resolves.toMatchObject({ claimed: false, localDate: "2026-09-20", checkinTime: "07:35" });
  });

  it("reopens a completed day for a failed account and skips accounts already signed in", async () => {
    const date = "2026-09-20";
    const first = await addAccount();
    const second = await addAccount();
    await addAccount("ai");
    await addAccount("cn", false);
    const scheduledTime = Date.parse("2026-09-20T08:10:00+08:00");
    const claim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime);
    expect(claim.claimed).toBe(true);

    await recordCheckin(env.DB, first, date, "success", "OK", "automatic");
    await recordCheckin(env.DB, second, date, "error", "请求超时", "automatic");
    // An older deployment could have marked the whole day complete despite this failure.
    await finishScheduledRun(env.DB, date, "08:10", true);

    await expect(listScheduledCheckinAccounts(env.DB, date)).resolves.toEqual({
      eligibleCount: 2,
      pendingAccounts: [{ id: second, needsRelogin: false }],
    });
    const retry = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 60_000);
    expect(retry.claimed).toBe(true);
    await finishScheduledRun(env.DB, date, "08:10", false);
    const afterFailure = await env.DB.prepare("SELECT last_scheduled_date FROM app_settings WHERE id = 1").first<{
      last_scheduled_date: string | null;
    }>();
    expect(afterFailure?.last_scheduled_date).toBeNull();

    await recordCheckin(env.DB, second, date, "success", "OK", "automatic");
    await expect(listScheduledCheckinAccounts(env.DB, date)).resolves.toEqual({
      eligibleCount: 2,
      pendingAccounts: [],
    });
    await finishScheduledRun(env.DB, date, "08:10", true);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 120_000)).resolves.toMatchObject({
      claimed: false,
    });
  });

  it("picks up an account added after the earlier accounts completed", async () => {
    const date = "2026-09-20";
    const first = await addAccount();
    await recordCheckin(env.DB, first, date, "success", "OK", "automatic");
    const scheduledTime = Date.parse("2026-09-20T08:10:00+08:00");
    const claim = await claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime);
    expect(claim.claimed).toBe(true);
    await finishScheduledRun(env.DB, date, "08:10", true);

    const later = await addAccount();
    await expect(listScheduledCheckinAccounts(env.DB, date)).resolves.toEqual({
      eligibleCount: 2,
      pendingAccounts: [{ id: later, needsRelogin: false }],
    });
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 60_000)).resolves.toMatchObject({
      claimed: true,
    });
  });

  it("keeps the scheduled day incomplete while one account still needs attention", async () => {
    const timestamp = Date.now();
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
    const signedIn = await addAccount();
    const needsRelogin = await addAccount();
    await recordCheckin(env.DB, signedIn, date, "success", "OK", "automatic");
    await recordCheckin(env.DB, needsRelogin, date, "error", "登录状态失效", "automatic");
    await env.DB.prepare("UPDATE accounts SET needs_relogin = 1 WHERE id = ?").bind(needsRelogin).run();
    await updateCheckinTime(env.DB, "00:00", "Asia/Shanghai", timestamp);

    const context = createExecutionContext();
    worker.scheduled(createScheduledController({ scheduledTime: timestamp }), env, context);
    await waitOnExecutionContext(context);
    const incomplete = await env.DB.prepare("SELECT last_scheduled_date FROM app_settings WHERE id = 1").first<{
      last_scheduled_date: string | null;
    }>();
    expect(incomplete?.last_scheduled_date).toBeNull();

    await recordCheckin(env.DB, needsRelogin, date, "already", "今天已经签到", "automatic");
    const retryContext = createExecutionContext();
    worker.scheduled(createScheduledController({ scheduledTime: timestamp + 60_000 }), env, retryContext);
    await waitOnExecutionContext(retryContext);
    const completed = await env.DB.prepare("SELECT last_scheduled_date FROM app_settings WHERE id = 1").first<{
      last_scheduled_date: string | null;
    }>();
    expect(completed?.last_scheduled_date).toBe(date);
  });
});
