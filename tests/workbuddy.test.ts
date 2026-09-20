import { describe, expect, it } from "vitest";
import { isUnauthorized, isWorkBuddySuccess, normalizeTimestamp } from "../src/workbuddy";

describe("WorkBuddy response normalization", () => {
  it("recognizes supported success codes", () => {
    expect(isWorkBuddySuccess({ code: 0 })).toBe(true);
    expect(isWorkBuddySuccess({ code: "200" })).toBe(true);
    expect(isWorkBuddySuccess({ code: 500 })).toBe(false);
  });

  it("normalizes seconds and milliseconds", () => {
    expect(normalizeTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("recognizes expired authentication", () => {
    expect(isUnauthorized({ httpStatus: 401, body: {} })).toBe(true);
    expect(isUnauthorized({ httpStatus: 200, body: { message: "登录过期，请重新登录" } })).toBe(true);
    expect(isUnauthorized({ httpStatus: 200, body: { code: 0 } })).toBe(false);
    expect(isUnauthorized({ httpStatus: 200, body: { code: 10085, message: "token request blocked" } })).toBe(false);
  });
});
