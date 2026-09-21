import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { claimScheduledRun, finishScheduledRun, updateCheckinTime } from "../src/repository";

describe("configurable automatic check-in schedule", () => {
  beforeEach(async () => {
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
});
