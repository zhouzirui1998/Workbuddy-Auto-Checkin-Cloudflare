import { describe, expect, it } from "vitest";
import { billingPaths, safeVariantAuthUrl, variantConfig, variantMatchesDomain } from "../src/variant";

describe("WorkBuddy account variants", () => {
  it("uses independent OAuth platforms and API bases", () => {
    expect(variantConfig("cn")).toMatchObject({
      apiBase: "https://www.codebuddy.cn",
      oauthPlatform: "workbuddy",
      supportsCheckin: true,
    });
    expect(variantConfig("ai")).toMatchObject({
      apiBase: "https://www.workbuddy.ai",
      oauthPlatform: "workbuddy-ai",
      supportsCheckin: false,
    });
  });

  it("rejects a login domain from the other account variant", () => {
    expect(variantMatchesDomain("ai", "www.workbuddy.ai")).toBe(true);
    expect(variantMatchesDomain("ai", "www.codebuddy.cn")).toBe(false);
    expect(variantMatchesDomain("cn", "auth.workbuddy.ai")).toBe(false);
    expect(variantMatchesDomain("cn", "www.codebuddy.cn")).toBe(true);
  });

  it("only accepts official login URLs for the selected variant", () => {
    expect(safeVariantAuthUrl("https://auth.workbuddy.ai/login?id=1", "state", "ai")).toBe(
      "https://auth.workbuddy.ai/login?id=1",
    );
    expect(safeVariantAuthUrl("https://evil.example/login", "state", "ai")).toBe(
      "https://www.workbuddy.ai/login?state=state",
    );
  });

  it("falls back from the international billing path only on a caller-observed 404", () => {
    expect(billingPaths("cn", "/v2/billing/meter/get-user-resource")).toEqual([
      "/v2/billing/meter/get-user-resource",
    ]);
    expect(billingPaths("ai", "/v2/billing/meter/get-user-resource")).toEqual([
      "/billing/meter/get-user-resource",
      "/v2/billing/meter/get-user-resource",
    ]);
  });
});
