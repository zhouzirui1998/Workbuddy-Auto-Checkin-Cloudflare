import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://example.com";
const INITIAL_PASSWORD = "local-development-password";
const NEW_PASSWORD = "new-local-password-2026";

async function login(password: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ password }),
    }),
  );
}

describe("administrator password settings", () => {
  it("changes the password, rotates the session version, and rejects the previous password", async () => {
    const initialLogin = await login(INITIAL_PASSWORD);
    expect(initialLogin.status).toBe(200);
    const oldCookie = initialLogin.headers.get("Set-Cookie")?.split(";")[0] ?? "";

    const change = await exports.default.fetch(
      new Request(`${ORIGIN}/api/settings/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: oldCookie, Origin: ORIGIN },
        body: JSON.stringify({ currentPassword: INITIAL_PASSWORD, newPassword: NEW_PASSWORD }),
      }),
    );
    expect(change.status).toBe(200);
    const newCookie = change.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    expect(newCookie).toBeTruthy();

    const oldSession = await exports.default.fetch(
      new Request(`${ORIGIN}/api/dashboard`, { headers: { Cookie: oldCookie } }),
    );
    expect(oldSession.status).toBe(401);

    const newSession = await exports.default.fetch(
      new Request(`${ORIGIN}/api/dashboard`, { headers: { Cookie: newCookie } }),
    );
    expect(newSession.status).toBe(200);

    expect((await login(INITIAL_PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });
});
