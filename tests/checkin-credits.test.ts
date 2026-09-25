import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkinAccount } from "../src/checkin";
import { encryptJson } from "../src/crypto";
import { getAccount } from "../src/repository";

async function addAccount(): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const encrypted = await encryptJson(
    { accessToken: "test-token", domain: "www.codebuddy.cn" },
    env.TOKEN_ENCRYPTION_KEY,
  );
  await env.DB.prepare(
    "INSERT INTO accounts (id, uid, variant, domain, credential_ciphertext, credential_iv, enabled, needs_relogin, created_at, updated_at) " +
      "VALUES (?, ?, 'cn', 'www.codebuddy.cn', ?, ?, 1, 0, ?, ?)",
  )
    .bind(id, `checkin-credit-${id}`, encrypted.ciphertext, encrypted.iv, now, now)
    .run();
  return id;
}

function requestPath(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).pathname;
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(Response.json(body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("credit refresh after check-in", () => {
  it("reads and stores the new balance after a successful check-in", async () => {
    const accountId = await addAccount();
    const calls: string[] = [];
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const path = requestPath(input);
      calls.push(path);
      if (path.endsWith("/checkin-activity-status")) {
        return jsonResponse({ code: 0, data: { today_checked_in: false } });
      }
      if (path.endsWith("/daily-checkin")) return jsonResponse({ code: 0, message: "签到成功" });
      if (path.endsWith("/get-user-resource-summary")) {
        return jsonResponse({
          code: 0,
          data: { Packages: [{ PackageCode: "reward", CycleTotalCapacity: 100, CycleRemainCapacity: 25, CycleEndTime: expiresAt }] },
        });
      }
      if (path.endsWith("/get-user-resource-paid-packages") || path.endsWith("/get-user-resource-free-packages")) {
        return jsonResponse({ code: 0, data: { Accounts: [] } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await checkinAccount(env, accountId, "automatic");
    expect(result).toMatchObject({
      status: "success",
      creditRefresh: { status: "success", credits: { totalRemaining: 25, soonestExpireAt: expiresAt } },
    });
    expect(calls.indexOf("/v2/billing/meter/daily-checkin")).toBeLessThan(
      calls.indexOf("/billing/meter/get-user-resource-summary"),
    );
    const account = await getAccount(env.DB, accountId);
    expect(account.credits_total_remaining).toBe(25);
    expect(account.credits_soonest_expire_at).toBe(expiresAt);
    const log = await env.DB.prepare("SELECT status, source FROM checkin_logs WHERE account_id = ?").bind(accountId).first<{
      status: string;
      source: string;
    }>();
    expect(log).toEqual({ status: "success", source: "automatic" });
  });

  it("keeps the check-in successful when the credit API fails", async () => {
    const accountId = await addAccount();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path.endsWith("/checkin-activity-status")) {
        return jsonResponse({ code: 0, data: { today_checked_in: false } });
      }
      if (path.endsWith("/daily-checkin")) return jsonResponse({ code: 0, message: "签到成功" });
      return jsonResponse({ code: 500, message: "积分接口暂不可用" });
    });

    const result = await checkinAccount(env, accountId);
    expect(result).toMatchObject({ status: "success", creditRefresh: { status: "error" } });
    const account = await getAccount(env.DB, accountId);
    expect(account.last_checkin_status).toBe("success");
    expect(account.credits_error).toBe("积分接口暂不可用");
  });

  it("does not read credits when check-in itself fails", async () => {
    const accountId = await addAccount();
    const calls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const path = requestPath(input);
      calls.push(path);
      if (path.endsWith("/checkin-activity-status")) {
        return jsonResponse({ code: 0, data: { today_checked_in: false } });
      }
      return jsonResponse({ code: 500, message: "签到接口暂不可用" });
    });

    const result = await checkinAccount(env, accountId);
    expect(result).toMatchObject({ status: "error" });
    expect(result.creditRefresh).toBeUndefined();
    expect(calls.some((path) => path.includes("get-user-resource"))).toBe(false);
  });
});
