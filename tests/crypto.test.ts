import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/crypto";

const KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const OTHER_KEY = "YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";

describe("credential encryption", () => {
  it("round-trips JSON without storing plaintext", async () => {
    const original = { accessToken: "sensitive-token", domain: "" };
    const encrypted = await encryptJson(original, KEY);

    expect(encrypted.ciphertext).not.toContain(original.accessToken);
    await expect(decryptJson(encrypted.ciphertext, encrypted.iv, KEY)).resolves.toEqual(original);
  });

  it("rejects the wrong encryption key", async () => {
    const encrypted = await encryptJson({ token: "secret" }, KEY);
    await expect(decryptJson(encrypted.ciphertext, encrypted.iv, OTHER_KEY)).rejects.toThrow();
  });
});
