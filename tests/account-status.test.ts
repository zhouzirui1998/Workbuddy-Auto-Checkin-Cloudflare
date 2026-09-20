import { describe, expect, it } from "vitest";
import { accountSummary, hasCheckinResultToday, statusMeta } from "../public/account-status.js";

const now = Date.parse("2026-09-20T17:35:00.000Z"); // 2026-09-21 01:35 in Beijing.

function account(overrides: Partial<Parameters<typeof statusMeta>[0]> = {}): Parameters<typeof statusMeta>[0] {
  return {
    enabled: true,
    variant: "cn",
    supportsCheckin: true,
    needsRelogin: false,
    reloginReason: null,
    lastCheckinStatus: "already",
    lastCheckinMessage: "今天已经签到",
    lastCheckinAt: Date.parse("2026-09-20T13:55:20.000Z"), // 2026-09-20 21:55 in Beijing.
    ...overrides,
  };
}

describe("date-aware account status", () => {
  it("shows yesterday's result as not checked in today", () => {
    const staleAccount = account();
    expect(hasCheckinResultToday(staleAccount, now)).toBe(false);
    expect(statusMeta(staleAccount, now)).toMatchObject({
      label: "今天未签",
      message: "今天没有签到",
      previousResult: true,
    });
    expect(accountSummary([staleAccount], now)).toEqual({ successful: 0, attention: 0 });
  });

  it("counts a successful result recorded today in Beijing", () => {
    const todayAccount = account({ lastCheckinAt: Date.parse("2026-09-20T16:20:00.000Z") });
    expect(hasCheckinResultToday(todayAccount, now)).toBe(true);
    expect(statusMeta(todayAccount, now).label).toBe("今日已签");
    expect(accountSummary([todayAccount], now)).toEqual({ successful: 1, attention: 0 });
  });

  it("only treats today's failure or a relogin requirement as needing attention", () => {
    const yesterdayFailure = account({ lastCheckinStatus: "error" });
    const todayFailure = account({
      lastCheckinStatus: "error",
      lastCheckinAt: Date.parse("2026-09-20T16:20:00.000Z"),
    });
    const relogin = account({ needsRelogin: true });
    expect(accountSummary([yesterdayFailure, todayFailure, relogin], now)).toEqual({ successful: 0, attention: 2 });
  });

  it("shows international accounts as unsupported without counting them as failed or unsigned", () => {
    const international = account({
      variant: "ai",
      supportsCheckin: false,
      lastCheckinStatus: null,
      lastCheckinMessage: null,
      lastCheckinAt: null,
    });
    expect(statusMeta(international, now)).toMatchObject({
      label: "签到未开放",
      message: "国际版目前支持登录和积分查询，签到活动暂未开放",
    });
    expect(accountSummary([international], now)).toEqual({ successful: 0, attention: 0 });
  });
});
