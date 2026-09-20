import QRCode from "qrcode";
import {
  assertLoginAllowed,
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  recordLoginFailure,
  requireAuthentication,
  verifyPassword,
} from "./auth";
import { checkinAccount, checkinAllAccounts } from "./checkin";
import { apiError, applyAssetSecurityHeaders, HttpError, json, readJsonObject, requireSameOrigin } from "./http";
import { completeLoginRequest, createLoginRequest } from "./oauth";
import {
  cleanupExpiredData,
  deleteAccount,
  getOAuthSession,
  listAccounts,
  listRecentLogs,
  setAccountEnabled,
  toPublicAccount,
} from "./repository";

const VERSION = "1.0.0";

async function handleLogin(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request);
  const key = await assertLoginAllowed(request, env.DB);
  const body = await readJsonObject(request);
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyPassword(password, env.ADMIN_PASSWORD))) {
    await recordLoginFailure(env.DB, key);
    throw new HttpError(401, "管理密码不正确");
  }
  await clearLoginFailures(env.DB, key);
  return json({ ok: true }, 200, { "Set-Cookie": await createSessionCookie(env.SESSION_SECRET) });
}

async function handleDashboard(env: Env): Promise<Response> {
  const [accountRows, logs] = await Promise.all([listAccounts(env.DB), listRecentLogs(env.DB)]);
  return json({
    ok: true,
    scheduleLabel: env.SCHEDULE_LABEL,
    timeZone: env.APP_TIMEZONE,
    accounts: accountRows.map(toPublicAccount),
    logs: logs.map((log) => ({
      id: log.id,
      accountId: log.account_id,
      accountName: log.account_name,
      localDate: log.local_date,
      status: log.status,
      message: log.message,
      createdAt: log.created_at,
    })),
  });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "workbuddy-auto-checkin", version: VERSION });
  }
  if (pathname === "/api/auth/session" && request.method === "GET") {
    return json({ ok: true, authenticated: await isAuthenticated(request, env.SESSION_SECRET) });
  }
  if (pathname === "/api/auth/login" && request.method === "POST") return handleLogin(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    requireSameOrigin(request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  await requireAuthentication(request, env.SESSION_SECRET);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) requireSameOrigin(request);

  if (pathname === "/api/dashboard" && request.method === "GET") return handleDashboard(env);
  if (pathname === "/api/oauth/start" && request.method === "POST") {
    const result = await createLoginRequest(env);
    return json({ ok: true, sessionId: result.id, authUrl: result.authUrl, expiresAt: result.expiresAt });
  }

  const oauthQrMatch = /^\/api\/oauth\/([^/]+)\/qr$/u.exec(pathname);
  if (oauthQrMatch?.[1] && request.method === "GET") {
    const session = await getOAuthSession(env.DB, oauthQrMatch[1], env.TOKEN_ENCRYPTION_KEY);
    const svg = await QRCode.toString(session.authUrl, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
    return new Response(svg, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const oauthStatusMatch = /^\/api\/oauth\/([^/]+)\/status$/u.exec(pathname);
  if (oauthStatusMatch?.[1] && request.method === "GET") {
    const result = await completeLoginRequest(env, oauthStatusMatch[1]);
    return json({ ok: true, ...result });
  }

  const accountMatch = /^\/api\/accounts\/([^/]+)$/u.exec(pathname);
  if (accountMatch?.[1] && request.method === "PATCH") {
    const body = await readJsonObject(request);
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled 必须是布尔值");
    await setAccountEnabled(env.DB, accountMatch[1], body.enabled);
    return json({ ok: true });
  }
  if (accountMatch?.[1] && request.method === "DELETE") {
    await deleteAccount(env.DB, accountMatch[1]);
    return json({ ok: true });
  }

  const accountCheckinMatch = /^\/api\/accounts\/([^/]+)\/checkin$/u.exec(pathname);
  if (accountCheckinMatch?.[1] && request.method === "POST") {
    return json({ ok: true, result: await checkinAccount(env, accountCheckinMatch[1]) });
  }
  if (pathname === "/api/checkin/all" && request.method === "POST") {
    return json({ ok: true, results: await checkinAllAccounts(env) });
  }

  throw new HttpError(404, "接口不存在");
}

async function fetchHandler(request: Request, env: Env): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/")) return await handleApi(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(404, "页面不存在");
    return applyAssetSecurityHeaders(await env.ASSETS.fetch(request));
  } catch (error) {
    return apiError(error);
  }
}

async function scheduledHandler(env: Env): Promise<void> {
  console.log("scheduled_checkin_started", { schedule: env.SCHEDULE_LABEL });
  const results = await checkinAllAccounts(env);
  await cleanupExpiredData(env.DB);
  console.log("scheduled_checkin_finished", {
    total: results.length,
    success: results.filter((result) => result.status === "success" || result.status === "already").length,
  });
}

export default {
  fetch: fetchHandler,
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): void {
    context.waitUntil(scheduledHandler(env));
  },
} satisfies ExportedHandler<Env>;
