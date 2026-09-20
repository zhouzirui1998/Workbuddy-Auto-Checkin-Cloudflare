const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export function encodeBase64Url(value: Uint8Array): string {
  return encodeBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): Uint8Array {
  return decodeBase64(value);
}

export function randomBase64(byteLength: number): string {
  return encodeBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const bytes = decodeBase64(secret);
  if (bytes.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY 必须是 32 字节 Base64 值");
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const bytes = decodeBase64(secret);
  if (bytes.byteLength < 32) throw new Error("SESSION_SECRET 至少需要 32 字节");
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function encryptJson(value: unknown, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), iv: encodeBase64(iv) };
}

export async function decryptJson(ciphertext: string, iv: string, secret: string): Promise<unknown> {
  const key = await importAesKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(decodeBase64(iv)) },
    key,
    toArrayBuffer(decodeBase64(ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}

export async function signText(value: string, secret: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(encoder.encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(decodeBase64(salt)), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function bytesToBase64(value: Uint8Array): string {
  return encodeBase64(value);
}

export function base64ToBytes(value: string): Uint8Array {
  return decodeBase64(value);
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const workerSubtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  };
  return workerSubtle.timingSafeEqual(left, right);
}

export function utf8Encode(value: string): Uint8Array {
  return encoder.encode(value);
}

export function utf8Decode(value: Uint8Array): string {
  return decoder.decode(value);
}
