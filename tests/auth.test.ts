import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createSessionCookie, isAuthenticated, verifyPassword } from "../src/auth";

const SECRET = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("admin authentication", () => {
  it("accepts a valid signed session and rejects tampering", async () => {
    const cookie = await createSessionCookie(SECRET, 1);
    const cookieValue = cookie.split(";")[0] ?? "";
    const request = new Request("https://example.com/api/dashboard", { headers: { Cookie: cookieValue } });
    expect(await isAuthenticated(request, SECRET, env.DB)).toBe(true);

    const [cookieName, signedValue = ""] = cookieValue.split("=");
    const [payload, signature = ""] = signedValue.split(".");
    const alteredSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    const tampered = `${cookieName}=${payload}.${alteredSignature}`;
    const invalid = new Request("https://example.com/api/dashboard", { headers: { Cookie: tampered } });
    expect(await isAuthenticated(invalid, SECRET, env.DB)).toBe(false);
  });

  it("compares the configured password", async () => {
    expect(await verifyPassword("correct horse battery staple", "correct horse battery staple")).toBe(true);
    expect(await verifyPassword("wrong", "correct horse battery staple")).toBe(false);
  });
});
