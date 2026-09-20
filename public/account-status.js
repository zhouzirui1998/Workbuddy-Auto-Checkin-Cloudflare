const BEIJING_TIME_ZONE = "Asia/Shanghai";
const beijingDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * @typedef {object} AccountStatusInput
 * @property {boolean} enabled
 * @property {boolean} needsRelogin
 * @property {string | null} reloginReason
 * @property {string | null} lastCheckinStatus
 * @property {string | null} lastCheckinMessage
 * @property {number | null} lastCheckinAt
 */

/**
 * @typedef {object} StatusMeta
 * @property {string} label
 * @property {string} className
 * @property {string} message
 * @property {boolean} previousResult
 */

/** @param {number} timestamp */
export function beijingDate(timestamp) {
  const parts = beijingDateFormatter.formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year") ?? ""}-${values.get("month") ?? ""}-${values.get("day") ?? ""}`;
}

/**
 * @param {AccountStatusInput} account
 * @param {number} [now]
 */
export function hasCheckinResultToday(account, now = Date.now()) {
  return account.lastCheckinAt !== null && beijingDate(account.lastCheckinAt) === beijingDate(now);
}

/**
 * @param {AccountStatusInput} account
 * @param {number} [now]
 * @returns {StatusMeta}
 */
export function statusMeta(account, now = Date.now()) {
  if (account.needsRelogin) {
    return {
      label: "需重新登录",
      className: "badge-danger",
      message: account.reloginReason || "登录状态已失效",
      previousResult: false,
    };
  }
  if (!account.enabled) {
    return { label: "已暂停", className: "badge-muted", message: "自动签到已暂停", previousResult: false };
  }
  if (!hasCheckinResultToday(account, now)) {
    return {
      label: "今天未签",
      className: "badge-warning",
      message: "今天没有签到",
      previousResult: account.lastCheckinAt !== null,
    };
  }
  if (account.lastCheckinStatus === "success") {
    return {
      label: "签到成功",
      className: "badge-success",
      message: account.lastCheckinMessage || "签到成功",
      previousResult: false,
    };
  }
  if (account.lastCheckinStatus === "already") {
    return {
      label: "今日已签",
      className: "badge-success",
      message: account.lastCheckinMessage || "今天已经签到",
      previousResult: false,
    };
  }
  if (account.lastCheckinStatus === "error") {
    return {
      label: "签到失败",
      className: "badge-danger",
      message: account.lastCheckinMessage || "签到失败",
      previousResult: false,
    };
  }
  return { label: "今天未签", className: "badge-warning", message: "今天没有签到", previousResult: false };
}

/**
 * @param {AccountStatusInput[]} accounts
 * @param {number} [now]
 */
export function accountSummary(accounts, now = Date.now()) {
  const successful = accounts.filter(
    (account) =>
      hasCheckinResultToday(account, now) && ["success", "already"].includes(account.lastCheckinStatus ?? ""),
  ).length;
  const attention = accounts.filter(
    (account) =>
      account.needsRelogin ||
      (hasCheckinResultToday(account, now) && account.lastCheckinStatus === "error"),
  ).length;
  return { successful, attention };
}
