import {
  acquireCheckinLock,
  getAccount,
  getCredentials,
  listAccounts,
  markNeedsRelogin,
  recordCheckin,
  releaseCheckinLock,
  saveCredentials,
} from "./repository";
import type { AccountRow, CheckinResult, CredentialPayload } from "./types";
import {
  fetchCheckinStatus,
  hasCheckedInToday,
  isUnauthorized,
  isWorkBuddySuccess,
  refreshCredentials,
  submitDailyCheckin,
  workBuddyMessage,
} from "./workbuddy";

function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "未知错误";
}

async function ensureFreshCredentials(
  env: Env,
  account: AccountRow,
  credentials: CredentialPayload,
): Promise<CredentialPayload> {
  if (!credentials.expiresAt || credentials.expiresAt > Date.now() + 5 * 60 * 1000) return credentials;
  if (credentials.refreshExpiresAt && credentials.refreshExpiresAt <= Date.now()) {
    throw new Error("登录状态已过期，请重新扫码登录");
  }
  const refreshed = await refreshCredentials(credentials);
  await saveCredentials(env.DB, account.id, refreshed, env.TOKEN_ENCRYPTION_KEY);
  return refreshed;
}

async function performCheckin(env: Env, account: AccountRow): Promise<CheckinResult> {
  let credentials = await getCredentials(account, env.TOKEN_ENCRYPTION_KEY);
  credentials = await ensureFreshCredentials(env, account, credentials);

  let statusResult = await fetchCheckinStatus(credentials, account);
  if (isUnauthorized(statusResult)) {
    credentials = await refreshCredentials(credentials);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    statusResult = await fetchCheckinStatus(credentials, account);
  }
  if (isUnauthorized(statusResult)) throw new Error("登录状态已失效，请重新扫码登录");
  if (!isWorkBuddySuccess(statusResult.body)) throw new Error(workBuddyMessage(statusResult));

  if (hasCheckedInToday(statusResult)) {
    return { accountId: account.id, status: "already", message: "今天已经签到" };
  }

  let submitResult = await submitDailyCheckin(credentials, account);
  if (isUnauthorized(submitResult)) {
    credentials = await refreshCredentials(credentials);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    submitResult = await submitDailyCheckin(credentials, account);
  }
  if (isUnauthorized(submitResult)) throw new Error("登录状态已失效，请重新扫码登录");
  const message = workBuddyMessage(submitResult);
  if (isWorkBuddySuccess(submitResult.body)) {
    return { accountId: account.id, status: "success", message: message === "WorkBuddy 接口返回失败" ? "签到成功" : message };
  }
  if (/已签到|重复签到/u.test(message)) {
    return { accountId: account.id, status: "already", message: "今天已经签到" };
  }
  throw new Error(message);
}

export async function checkinAccount(env: Env, accountId: string): Promise<CheckinResult> {
  const account = await getAccount(env.DB, accountId);
  const date = localDate(env.APP_TIMEZONE);
  if (!(await acquireCheckinLock(env.DB, account.id))) {
    return { accountId: account.id, status: "busy", message: "该账号正在签到，请稍后刷新" };
  }
  try {
    const result = await performCheckin(env, account);
    await recordCheckin(env.DB, account.id, date, result.status, result.message);
    console.log("checkin_completed", { accountId: account.id, status: result.status });
    return result;
  } catch (error) {
    const message = errorMessage(error);
    if (/登录|token|凭据|credential|unauthorized|decrypt/iu.test(message)) {
      await markNeedsRelogin(env.DB, account.id, "登录状态失效，请重新扫码登录");
    }
    await recordCheckin(env.DB, account.id, date, "error", message);
    console.warn("checkin_failed", { accountId: account.id, message });
    return { accountId: account.id, status: "error", message };
  } finally {
    await releaseCheckinLock(env.DB, account.id);
  }
}

export async function checkinAllAccounts(env: Env): Promise<CheckinResult[]> {
  const accounts = (await listAccounts(env.DB)).filter((account) => account.enabled === 1);
  const results: CheckinResult[] = [];
  for (const account of accounts) {
    results.push(await checkinAccount(env, account.id));
  }
  return results;
}
