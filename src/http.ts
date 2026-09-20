export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const API_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
} as const;

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(API_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function apiError(error: unknown): Response {
  if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status);
  console.error("api_error", error instanceof Error ? error.message : "unknown_error");
  return json({ ok: false, error: "服务暂时不可用，请稍后重试" }, 500);
}

export async function readJsonObject(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) throw new HttpError(413, "请求内容过大");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "请求内容过大");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON 格式不正确");
  }
}

export function applyAssetSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return secured;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "请求来源校验失败");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new HttpError(403, "拒绝跨站请求");
}
