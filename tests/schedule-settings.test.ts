import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { claimScheduledRun, finishScheduledRun, updateCheckinTime } from "../src/repository";

describe("configurable automatic check-in schedule", () => {
  it("claims no more than one run per Beijing calendar day after the configured time", async () => {
    await updateCheckinTime(env.DB, "08:10");

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

    await finishScheduledRun(env.DB, claim.localDate, true);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", scheduledTime + 60_000)).resolves.toMatchObject({
      claimed: false,
    });

    const nextDay = Date.UTC(2026, 8, 21, 0, 10);
    await expect(claimScheduledRun(env.DB, "Asia/Shanghai", "08:10", nextDay)).resolves.toMatchObject({
      claimed: true,
      localDate: "2026-09-21",
    });
  });
});
