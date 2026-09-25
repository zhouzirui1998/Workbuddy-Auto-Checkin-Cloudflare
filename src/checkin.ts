import {
  acquireCheckinLock,
  acquireCreditLock,
  getAccount,
  getCredentials,
  listAccounts,
  listScheduledCheckinAccounts,
  markNeedsRelogin,
  recordCheckin,
  releaseCheckinLock,
  saveCredentials,
  updateCheckinSnapshot,
} from "./repository";
import { refreshAccountCredits } from "./credits";
import type { AccountRow, CheckinResult, CheckinSource, CheckinStatusRefreshResult, CredentialPayload } from "./types";
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
    throw new Error("登录状态已过期，请重新登录");
  }
  const refreshed = await refreshCredentials(credentials, account);
  await saveCredentials(env.DB, account.id, refreshed, env.TOKEN_ENCRYPTION_KEY);
  return refreshed;
}

async function readCheckinStatus(
  env: Env,
  account: AccountRow,
): Promise<{ checked: boolean; credentials: CredentialPayload }> {
  let credentials = await getCredentials(account, env.TOKEN_ENCRYPTION_KEY);
  credentials = await ensureFreshCredentials(env, account, credentials);

  let statusResult = await fetchCheckinStatus(credentials, account);
  if (isUnauthorized(statusResult)) {
    credentials = await refreshCredentials(credentials, account);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    statusResult = await fetchCheckinStatus(credentials, account);
  }
  if (isUnauthorized(statusResult)) throw new Error("登录状态已失效，请重新登录");
  if (!isWorkBuddySuccess(statusResult.body)) throw new Error(workBuddyMessage(statusResult));

  return { checked: hasCheckedInToday(statusResult), credentials };
}

async function performCheckin(env: Env, account: AccountRow): Promise<CheckinResult> {
  const status = await readCheckinStatus(env, account);
  let credentials = status.credentials;

  if (status.checked) {
    return { accountId: account.id, status: "already", message: "今天已经签到" };
  }

  let submitResult = await submitDailyCheckin(credentials, account);
  if (isUnauthorized(submitResult)) {
    credentials = await refreshCredentials(credentials, account);
    await saveCredentials(env.DB, account.id, credentials, env.TOKEN_ENCRYPTION_KEY);
    submitResult = await submitDailyCheckin(credentials, account);
  }
  if (isUnauthorized(submitResult)) throw new Error("登录状态已失效，请重新登录");
  const message = workBuddyMessage(submitResult);
  if (isWorkBuddySuccess(submitResult.body)) {
    return { accountId: account.id, status: "success", message: message === "WorkBuddy 接口返回失败" ? "签到成功" : message };
  }
  if (/已签到|重复签到/u.test(message)) {
    return { accountId: account.id, status: "already", message: "今天已经签到" };
  }
  throw new Error(message);
}

async function runCheckinUnderLock(env: Env, account: AccountRow, source: CheckinSource): Promise<CheckinResult> {
  const date = localDate(env.APP_TIMEZONE);
  try {
    const result = await performCheckin(env, account);
    await recordCheckin(env.DB, account.id, date, result.status, result.message, source);
    console.log(JSON.stringify({ message: "checkin_completed", accountId: account.id, status: result.status }));
    return result;
  } catch (error) {
    const message = errorMessage(error);
    if (/登录|token|凭据|credential|unauthorized|decrypt/iu.test(message)) {
      await markNeedsRelogin(env.DB, account.id, "登录状态失效，请重新登录");
    }
    await recordCheckin(env.DB, account.id, date, "error", message, source);
    console.warn(JSON.stringify({ message: "checkin_failed", accountId: account.id, error: message }));
    return { accountId: account.id, status: "error", message };
  }
}

export async function checkinAccount(
  env: Env,
  accountId: string,
  source: CheckinSource = "manual",
): Promise<CheckinResult> {
  const account = await getAccount(env.DB, accountId);
  if (account.variant === "ai") {
    return { accountId: account.id, status: "unsupported", message: "国际版签到活动暂未开放" };
  }
  if (!(await acquireCheckinLock(env.DB, account.id))) {
    return { accountId: account.id, status: "busy", message: "该账号正在签到，请稍后刷新" };
  }
  let result: CheckinResult;
  try {
    result = await runCheckinUnderLock(env, account, source);
  } finally {
    await releaseCheckinLock(env.DB, account.id);
  }
  if (result.status !== "success" && result.status !== "already") return result;

  try {
    const creditRefresh = await refreshAccountCredits(env, account.id);
    return { ...result, creditRefresh };
  } catch (error) {
    const message = errorMessage(error);
    console.warn(JSON.stringify({ message: "checkin_credit_refresh_failed", accountId: account.id, error: message }));
    return {
      ...result,
      creditRefresh: { accountId: account.id, status: "error", message: "积分自动刷新失败，请稍后手动刷新" },
    };
  }
}

export async function checkinAllAccounts(env: Env, source: CheckinSource = "manual"): Promise<CheckinResult[]> {
  const accounts = (await listAccounts(env.DB)).filter((account) => account.enabled === 1 && account.variant === "cn");
  const results: CheckinResult[] = [];
  for (const account of accounts) {
    results.push(await checkinAccount(env, account.id, source));
  }
  return results;
}

export async function checkinPendingAccounts(
  env: Env,
  localDate: string,
): Promise<{ eligibleCount: number; results: CheckinResult[] }> {
  const { eligibleCount, pendingAccounts } = await listScheduledCheckinAccounts(env.DB, localDate);
  const results: CheckinResult[] = [];
  for (const account of pendingAccounts) {
    if (account.needsRelogin) {
      results.push({ accountId: account.id, status: "error", message: "登录状态失效，请重新登录" });
      continue;
    }
    try {
      results.push(await checkinAccount(env, account.id, "automatic"));
    } catch (error) {
      const message = errorMessage(error);
      console.error(JSON.stringify({ message: "scheduled_account_checkin_failed", accountId: account.id, error: message }));
      results.push({ accountId: account.id, status: "error", message });
    }
  }
  return { eligibleCount, results };
}

export async function refreshAccountCheckinStatus(
  env: Env,
  accountId: string,
): Promise<CheckinStatusRefreshResult> {
  const account = await getAccount(env.DB, accountId);
  if (account.variant === "ai") {
    return { accountId: account.id, status: "unsupported", message: "国际版签到活动暂未开放" };
  }
  if (!(await acquireCreditLock(env.DB, account.id))) {
    return { accountId: account.id, status: "busy", message: "该账号正在处理其他操作，请稍后重试" };
  }
  try {
    const { checked } = await readCheckinStatus(env, account);
    const status = checked ? "checked" : "not_checked";
    const message = checked ? "今天已经签到" : "今天没有签到";
    await updateCheckinSnapshot(env.DB, account.id, checked ? "already" : "not_checked", message);
    return { accountId: account.id, status, message };
  } catch (error) {
    const message = errorMessage(error);
    if (/登录|token|凭据|credential|unauthorized|decrypt/iu.test(message)) {
      await markNeedsRelogin(env.DB, account.id, "登录状态失效，请重新登录");
    }
    console.warn(JSON.stringify({ message: "checkin_status_refresh_failed", accountId: account.id, error: message }));
    return { accountId: account.id, status: "error", message };
  } finally {
    await releaseCheckinLock(env.DB, account.id);
  }
}

export async function refreshAllCheckinStatuses(env: Env): Promise<CheckinStatusRefreshResult[]> {
  const accounts = (await listAccounts(env.DB)).filter((account) => account.variant === "cn");
  const results: CheckinStatusRefreshResult[] = [];
  for (const account of accounts) results.push(await refreshAccountCheckinStatus(env, account.id));
  return results;
}
