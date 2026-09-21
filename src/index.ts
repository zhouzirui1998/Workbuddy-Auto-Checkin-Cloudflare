import QRCode from "qrcode";
import {
  authenticateAdminPassword,
  assertLoginAllowed,
  changeAdminPassword,
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  recordLoginFailure,
  requireAuthentication,
} from "./auth";
import { checkinAccount, checkinAllAccounts, refreshAllCheckinStatuses } from "./checkin";
import { refreshAccountCredits, refreshAllCredits } from "./credits";
import { apiError, applyAssetSecurityHeaders, HttpError, json, readJsonObject, requireSameOrigin } from "./http";
import { completeLoginRequest, createLoginRequest } from "./oauth";
import {
  cleanupExpiredData,
  claimScheduledRun,
  deleteAccount,
  finishScheduledRun,
  getAppSettings,
  getOAuthSession,
  listAccounts,
  listRecentLogs,
  setAccountEnabled,
  toPublicAccount,
  updateCheckinTime,
} from "./repository";
import type { AccountVariant } from "./variant";

const VERSION = "1.3.4";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

async function handleLogin(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request);
  const key = await assertLoginAllowed(request, env.DB);
  const body = await readJsonObject(request);
  const password = typeof body.password === "string" ? body.password : "";
  const authentication = await authenticateAdminPassword(env.DB, password, env.ADMIN_PASSWORD);
  if (!authentication.valid) {
    await recordLoginFailure(env.DB, key);
    throw new HttpError(401, "管理密码不正确");
  }
  await clearLoginFailures(env.DB, key);
  return json(
    { ok: true },
    200,
    { "Set-Cookie": await createSessionCookie(env.SESSION_SECRET, authentication.sessionVersion) },
  );
}

async function handleDashboard(env: Env): Promise<Response> {
  const [accountRows, logs, settings] = await Promise.all([
    listAccounts(env.DB),
    listRecentLogs(env.DB),
    getAppSettings(env.DB, env.APP_TIMEZONE, env.DEFAULT_CHECKIN_TIME),
  ]);
  return json({
    ok: true,
    ...settings,
    accounts: accountRows.map(toPublicAccount),
    logs: logs.map((log) => ({
      id: log.id,
      accountId: log.account_id,
      accountName: log.account_name,
      localDate: log.local_date,
      status: log.status,
      message: log.message,
      source: log.source,
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
    return json({ ok: true, authenticated: await isAuthenticated(request, env.SESSION_SECRET, env.DB) });
  }
  if (pathname === "/api/auth/login" && request.method === "POST") return handleLogin(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    requireSameOrigin(request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  await requireAuthentication(request, env.SESSION_SECRET, env.DB);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) requireSameOrigin(request);

  if (pathname === "/api/dashboard" && request.method === "GET") return handleDashboard(env);
  if (pathname === "/api/settings/schedule" && request.method === "PATCH") {
    const body = await readJsonObject(request);
    const checkinTime = typeof body.checkinTime === "string" ? body.checkinTime : "";
    if (!TIME_PATTERN.test(checkinTime)) throw new HttpError(400, "请输入有效的签到时间");
    await updateCheckinTime(env.DB, checkinTime, env.APP_TIMEZONE);
    return json({ ok: true, checkinTime, scheduleLabel: `每天 ${checkinTime}（北京时间）` });
  }
  if (pathname === "/api/settings/password" && request.method === "PATCH") {
    const body = await readJsonObject(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 12 || newPassword.length > 256) {
      throw new HttpError(400, "新密码需要 12 至 256 位");
    }
    if (currentPassword === newPassword) throw new HttpError(400, "新密码不能与当前密码相同");
    const result = await changeAdminPassword(env.DB, currentPassword, newPassword, env.ADMIN_PASSWORD);
    if (!result.changed) throw new HttpError(400, "当前密码不正确");
    return json(
      { ok: true },
      200,
      { "Set-Cookie": await createSessionCookie(env.SESSION_SECRET, result.sessionVersion) },
    );
  }
  if (pathname === "/api/oauth/start" && request.method === "POST") {
    const body = await readJsonObject(request);
    if (body.variant !== "cn" && body.variant !== "ai") throw new HttpError(400, "请选择中国区或国际版账号");
    const variant: AccountVariant = body.variant;
    const result = await createLoginRequest(env, variant);
    return json({
      ok: true,
      sessionId: result.id,
      authUrl: result.authUrl,
      expiresAt: result.expiresAt,
      variant: result.variant,
    });
  }

  const oauthQrMatch = /^\/api\/oauth\/([^/]+)\/qr$/u.exec(pathname);
  if (oauthQrMatch?.[1] && request.method === "GET") {
    const session = await getOAuthSession(env.DB, oauthQrMatch[1], env.TOKEN_ENCRYPTION_KEY);
    if (session.variant === "ai") throw new HttpError(400, "国际版请使用浏览器 OAuth 登录");
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

  const accountCreditsMatch = /^\/api\/accounts\/([^/]+)\/credits$/u.exec(pathname);
  if (accountCreditsMatch?.[1] && request.method === "POST") {
    return json({ ok: true, result: await refreshAccountCredits(env, accountCreditsMatch[1]) });
  }
  if (pathname === "/api/credits/all" && request.method === "POST") {
    return json({ ok: true, results: await refreshAllCredits(env) });
  }
  if (pathname === "/api/refresh/all" && request.method === "POST") {
    const credits = await refreshAllCredits(env);
    const checkins = await refreshAllCheckinStatuses(env);
    return json({ ok: true, credits, checkins });
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

async function scheduledHandler(env: Env, scheduledTime: number): Promise<void> {
  const claim = await claimScheduledRun(env.DB, env.APP_TIMEZONE, env.DEFAULT_CHECKIN_TIME, scheduledTime);
  if (!claim.claimed) return;
  console.log(
    JSON.stringify({ message: "scheduled_checkin_started", checkinTime: claim.checkinTime, localDate: claim.localDate }),
  );
  try {
    const results = await checkinAllAccounts(env, "automatic");
    await cleanupExpiredData(env.DB);
    if (results.length === 0) {
      await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, false);
      console.log(
        JSON.stringify({
          message: "scheduled_checkin_deferred",
          checkinTime: claim.checkinTime,
          localDate: claim.localDate,
          reason: "no_eligible_accounts",
        }),
      );
      return;
    }
    await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, true);
    console.log(
      JSON.stringify({
        message: "scheduled_checkin_finished",
        total: results.length,
        success: results.filter((result) => result.status === "success" || result.status === "already").length,
      }),
    );
  } catch (error) {
    await finishScheduledRun(env.DB, claim.localDate, claim.checkinTime, false);
    throw error;
  }
}

export default {
  fetch: fetchHandler,
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): void {
    context.waitUntil(scheduledHandler(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
