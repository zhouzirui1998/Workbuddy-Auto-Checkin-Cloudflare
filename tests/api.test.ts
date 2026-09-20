import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://example.com";

describe("Worker API", () => {
  it("reports health without authentication", async () => {
    const response = await exports.default.fetch(new Request(`${ORIGIN}/api/health`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, service: "workbuddy-auto-checkin" });
  });

  it("rejects protected data without a session", async () => {
    const response = await exports.default.fetch(new Request(`${ORIGIN}/api/dashboard`));
    expect(response.status).toBe(401);
  });

  it("logs in and returns an empty dashboard", async () => {
    const login = await exports.default.fetch(
      new Request(`${ORIGIN}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ password: "local-development-password" }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const dashboard = await exports.default.fetch(
      new Request(`${ORIGIN}/api/dashboard`, { headers: { Cookie: cookie ?? "" } }),
    );
    expect(dashboard.status).toBe(200);
    await expect(dashboard.json()).resolves.toMatchObject({ ok: true, accounts: [], logs: [] });
  });

  it("rejects a cross-origin login request", async () => {
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ password: "local-development-password" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
