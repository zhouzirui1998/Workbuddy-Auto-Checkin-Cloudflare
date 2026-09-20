import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkinAccount } from "../src/checkin";
import { encryptJson } from "../src/crypto";
import { getAccount, toPublicAccount } from "../src/repository";

describe("WorkBuddy international accounts", () => {
  it("stores the variant capability and skips every check-in request", async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const encrypted = await encryptJson(
      { accessToken: "international-token", refreshToken: "refresh-token", domain: "www.workbuddy.ai" },
      env.TOKEN_ENCRYPTION_KEY,
    );
    await env.DB.prepare(
      "INSERT INTO accounts (id, uid, nickname, variant, domain, credential_ciphertext, credential_iv, enabled, needs_relogin, created_at, updated_at) " +
        "VALUES (?, ?, ?, 'ai', 'www.workbuddy.ai', ?, ?, 1, 0, ?, ?)",
    )
      .bind(id, `international-${id}`, "International User", encrypted.ciphertext, encrypted.iv, now, now)
      .run();

    const account = toPublicAccount(await getAccount(env.DB, id));
    expect(account).toMatchObject({ variant: "ai", supportsCheckin: false });
    await expect(checkinAccount(env, id)).resolves.toEqual({
      accountId: id,
      status: "unsupported",
      message: "国际版签到活动暂未开放",
    });
  });
});
