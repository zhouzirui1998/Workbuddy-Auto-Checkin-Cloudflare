import { accountSummary, beijingDate, statusMeta } from "./account-status.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  accounts: [],
  logs: [],
  checkinTime: "08:10",
  renderedBeijingDate: "",
  qrPollTimer: null,
  oauthSessionId: null,
  oauthAuthUrl: "",
  loginVariant: "cn",
  loginRequestSerial: 0,
  toastTimer: null,
};

const views = { login: $("#login-view"), app: $("#app-view") };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({ ok: false, error: "服务器返回了无法识别的内容" }));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") showLogin();
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  return data;
}

function setButtonLoading(button, loading, text) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = loading;
  button.textContent = loading ? text : button.dataset.label;
}

function toast(message, type = "success") {
  const node = $("#toast");
  clearTimeout(state.toastTimer);
  node.textContent = message;
  node.className = `toast${type === "error" ? " error" : ""}`;
  node.hidden = false;
  state.toastTimer = setTimeout(() => { node.hidden = true; }, 3600);
}

function showLogin() {
  stopQrPolling();
  if ($("#qr-dialog").open) $("#qr-dialog").close();
  if ($("#settings-dialog").open) $("#settings-dialog").close();
  views.app.hidden = true;
  views.login.hidden = false;
  requestAnimationFrame(() => $("#password").focus());
}

function showApp() {
  views.login.hidden = true;
  views.app.hidden = false;
}

function formatTime(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function formatCredits(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function accountName(account) {
  return account.nickname || account.email || `账号 ${account.uid.slice(0, 8)}`;
}

function createButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-small ${className}`;
  button.textContent = label;
  button.addEventListener("click", () => handler(button));
  return button;
}

function renderAccounts() {
  const now = Date.now();
  state.renderedBeijingDate = beijingDate(now);
  const grid = $("#accounts-grid");
  grid.replaceChildren();
  $("#accounts-loading").hidden = true;
  $("#accounts-empty").hidden = state.accounts.length !== 0;
  const { successful, attention } = accountSummary(state.accounts, now);
  $("#account-count").textContent = state.accounts.length;
  $("#success-count").textContent = successful;
  $("#attention-count").textContent = attention;
  const readableCredits = state.accounts
    .map((account) => account.credits?.totalRemaining)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  $("#credits-total").textContent = readableCredits.length
    ? formatCredits(readableCredits.reduce((sum, value) => sum + value, 0))
    : "—";

  for (const account of state.accounts) {
    const meta = statusMeta(account, now);
    const card = document.createElement("article");
    card.className = "account-card";
    const avatar = document.createElement("div");
    avatar.className = `account-avatar${account.variant === "ai" ? " account-avatar-international" : ""}`;
    avatar.textContent = accountName(account).slice(0, 1).toUpperCase();

    const main = document.createElement("div");
    main.className = "account-main";
    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";
    const title = document.createElement("h3");
    title.className = "account-title";
    title.textContent = accountName(account);
    const version = document.createElement("span");
    version.className = `account-version${account.variant === "ai" ? " account-version-international" : ""}`;
    version.textContent = account.variant === "ai" ? "INTL" : "CN";
    const titleGroup = document.createElement("div");
    titleGroup.className = "account-title-group";
    titleGroup.append(title, version);
    const badge = document.createElement("span");
    badge.className = `badge ${meta.className}`;
    badge.textContent = meta.label;
    titleRow.append(titleGroup, badge);

    const subtitle = document.createElement("p");
    subtitle.className = "account-subtitle";
    subtitle.textContent = [account.email, account.enterpriseName].filter(Boolean).join(" · ") || `UID ${account.uid}`;
    const status = document.createElement("div");
    status.className = "account-status";
    const timeLabel = meta.previousResult ? "上次签到：" : "";
    status.textContent = `${meta.message}${account.lastCheckinAt ? ` · ${timeLabel}${formatTime(account.lastCheckinAt)}` : ""}`;
    const credits = document.createElement("div");
    credits.className = `account-credits${account.credits?.error ? " account-credits-error" : ""}`;
    const creditsMain = document.createElement("div");
    creditsMain.className = "account-credits-main";
    const creditsLabel = document.createElement("span");
    creditsLabel.textContent = "剩余积分";
    const creditsValue = document.createElement("strong");
    creditsValue.textContent = formatCredits(account.credits?.totalRemaining);
    creditsMain.append(creditsLabel, creditsValue);
    const creditsMeta = document.createElement("small");
    if (account.credits?.updatedAt) {
      const total = formatCredits(account.credits.totalCapacity);
      const expiry = account.credits.soonestExpireAt
        ? ` · 最近到期 ${formatDate(account.credits.soonestExpireAt)}`
        : "";
      creditsMeta.textContent = `总计 ${total}${expiry} · 更新于 ${formatTime(account.credits.updatedAt)}`;
    } else {
      creditsMeta.textContent = "尚未读取，点击“刷新积分”获取";
    }
    if (account.credits?.error) {
      creditsMeta.textContent = `${creditsMeta.textContent} · 上次失败：${account.credits.error}`;
    }
    credits.append(creditsMain, creditsMeta);
    const actions = document.createElement("div");
    actions.className = "account-actions";
    if (account.supportsCheckin) {
      const checkin = createButton("立即签到", "button-secondary", (button) => checkinOne(account.id, button));
      checkin.disabled = !account.enabled;
      actions.append(checkin);
    }
    actions.append(createButton("刷新积分", "button-ghost", (button) => refreshCreditsOne(account.id, button)));
    if (account.supportsCheckin) {
      actions.append(
        createButton(account.enabled ? "暂停" : "启用", "button-ghost", (button) => toggleAccount(account, button)),
      );
    }
    actions.append(createButton("删除", "button-danger", (button) => removeAccount(account, button)));
    main.append(titleRow, subtitle, status, credits, actions);
    card.append(avatar, main);
    grid.append(card);
  }
}

function renderLogs() {
  const body = $("#logs-body");
  body.replaceChildren();
  $("#logs-empty").hidden = state.logs.length !== 0;
  for (const log of state.logs) {
    const row = document.createElement("tr");
    const statusLabel = { success: "成功", already: "已签到", error: "失败", busy: "处理中" }[log.status] || log.status;
    for (const value of [log.accountName || "已删除账号", log.localDate, statusLabel, log.message, formatTime(log.createdAt)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

async function loadDashboard({ quiet = false } = {}) {
  const refresh = $("#refresh-button");
  if (!quiet) setButtonLoading(refresh, true, "刷新中…");
  try {
    const data = await api("/api/dashboard");
    state.accounts = data.accounts;
    state.logs = data.logs;
    state.checkinTime = data.checkinTime;
    $("#schedule-chip").textContent = data.scheduleLabel;
    renderAccounts();
    renderLogs();
  } catch (error) {
    $("#accounts-loading").hidden = true;
    toast(error.message, "error");
  } finally {
    if (!quiet) setButtonLoading(refresh, false, "刷新中…");
  }
}

function openSettingsDialog() {
  $("#checkin-time").value = state.checkinTime;
  $("#password-form").reset();
  $("#password-error").hidden = true;
  $("#settings-dialog").showModal();
}

async function saveSchedule(event) {
  event.preventDefault();
  const button = $("#save-schedule-button");
  const checkinTime = $("#checkin-time").value;
  setButtonLoading(button, true, "保存中…");
  try {
    const data = await api("/api/settings/schedule", {
      method: "PATCH",
      body: JSON.stringify({ checkinTime }),
    });
    state.checkinTime = data.checkinTime;
    $("#schedule-chip").textContent = data.scheduleLabel;
    toast("自动签到时间已更新");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "保存中…");
  }
}

async function savePassword(event) {
  event.preventDefault();
  const button = $("#save-password-button");
  const errorNode = $("#password-error");
  const currentPassword = $("#current-password").value;
  const newPassword = $("#new-password").value;
  const confirmation = $("#confirm-password").value;
  errorNode.hidden = true;
  if (newPassword !== confirmation) {
    errorNode.textContent = "两次输入的新密码不一致";
    errorNode.hidden = false;
    return;
  }
  setButtonLoading(button, true, "修改中…");
  try {
    await api("/api/settings/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    $("#password-form").reset();
    toast("管理密码已修改，其他设备的登录已失效");
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    setButtonLoading(button, false, "修改中…");
  }
}

async function checkinOne(accountId, button) {
  setButtonLoading(button, true, "签到中…");
  try {
    const data = await api(`/api/accounts/${accountId}/checkin`, { method: "POST", body: "{}" });
    toast(data.result.message, data.result.status === "error" ? "error" : "success");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "签到中…");
  }
}

async function checkinAll() {
  const button = $("#checkin-all-button");
  setButtonLoading(button, true, "正在逐个签到…");
  try {
    const data = await api("/api/checkin/all", { method: "POST", body: "{}" });
    const ok = data.results.filter((result) => result.status === "success" || result.status === "already").length;
    const failed = data.results.filter((result) => result.status === "error").length;
    toast(`已完成：${ok} 个成功${failed ? `，${failed} 个失败` : ""}`, failed ? "error" : "success");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "正在逐个签到…");
  }
}

async function refreshCreditsOne(accountId, button) {
  setButtonLoading(button, true, "读取中…");
  try {
    const data = await api(`/api/accounts/${accountId}/credits`, { method: "POST", body: "{}" });
    toast(data.result.message, data.result.status === "error" ? "error" : "success");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "读取中…");
  }
}

async function refreshCreditsAll() {
  const button = $("#credits-all-button");
  setButtonLoading(button, true, "正在逐个读取…");
  try {
    const data = await api("/api/credits/all", { method: "POST", body: "{}" });
    const succeeded = data.results.filter((result) => result.status === "success").length;
    const failed = data.results.filter((result) => result.status === "error").length;
    toast(`积分已更新：${succeeded} 个成功${failed ? `，${failed} 个失败` : ""}`, failed ? "error" : "success");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "正在逐个读取…");
  }
}

async function toggleAccount(account, button) {
  setButtonLoading(button, true, "保存中…");
  try {
    await api(`/api/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !account.enabled }) });
    toast(account.enabled ? "已暂停自动签到" : "已启用自动签到");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setButtonLoading(button, false, "保存中…");
  }
}

async function removeAccount(account, button) {
  if (!confirm(`确定删除“${accountName(account)}”吗？该账号的签到记录也会删除。`)) return;
  setButtonLoading(button, true, "删除中…");
  try {
    await api(`/api/accounts/${account.id}`, { method: "DELETE" });
    toast("账号已删除");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, "error");
    setButtonLoading(button, false, "删除中…");
  }
}

function stopQrPolling() {
  if (state.qrPollTimer) clearTimeout(state.qrPollTimer);
  state.qrPollTimer = null;
}

function setLoginVariant(variant) {
  state.loginVariant = variant;
  const international = variant === "ai";
  $("#variant-cn-button").classList.toggle("active", !international);
  $("#variant-cn-button").setAttribute("aria-selected", String(!international));
  $("#variant-ai-button").classList.toggle("active", international);
  $("#variant-ai-button").setAttribute("aria-selected", String(international));
  $("#login-dialog-title").textContent = international ? "登录 WorkBuddy 国际版" : "扫码登录 WorkBuddy 中国区";
  $("#login-dialog-description").textContent = international
    ? "使用官方浏览器 OAuth，可选择 Google、GitHub、X、邮箱等方式。"
    : "请使用手机扫码并在页面中确认登录。二维码约 10 分钟后失效。";
  $("#qr-stage").hidden = international;
  $("#oauth-web-stage").hidden = !international;
  $("#copy-oauth-link").hidden = !international || !state.oauthAuthUrl;
  $("#oauth-note").hidden = !international;
}

async function pollQrStatus(sessionId, variant) {
  if (!$("#qr-dialog").open || sessionId !== state.oauthSessionId) return;
  try {
    const data = await api(`/api/oauth/${sessionId}/status`);
    if (!data.pending) {
      stopQrPolling();
      $("#qr-status").lastElementChild.textContent = "登录成功，正在载入账号…";
      toast(variant === "ai" ? "国际版账号绑定成功" : "中国区账号绑定成功");
      await loadDashboard({ quiet: true });
      setTimeout(() => $("#qr-dialog").close(), 600);
      return;
    }
  } catch (error) {
    stopQrPolling();
    $("#qr-status").lastElementChild.textContent = error.message;
    toast(error.message, "error");
    return;
  }
  state.qrPollTimer = setTimeout(() => pollQrStatus(sessionId, variant), 2200);
}

async function startOAuthLogin(variant) {
  const image = $("#qr-image");
  const serial = ++state.loginRequestSerial;
  stopQrPolling();
  state.oauthSessionId = null;
  state.oauthAuthUrl = "";
  setLoginVariant(variant);
  image.hidden = true;
  image.removeAttribute("src");
  $("#qr-stage .spinner").hidden = variant === "ai";
  $("#qr-status").lastElementChild.textContent = variant === "ai" ? "正在生成官方授权链接…" : "正在生成安全登录二维码…";
  $("#qr-link").hidden = true;
  $("#copy-oauth-link").hidden = true;
  try {
    const data = await api("/api/oauth/start", { method: "POST", body: JSON.stringify({ variant }) });
    if (serial !== state.loginRequestSerial || !$("#qr-dialog").open) return;
    state.oauthSessionId = data.sessionId;
    state.oauthAuthUrl = data.authUrl;
    const link = $("#qr-link");
    link.href = data.authUrl;
    link.hidden = false;
    if (variant === "ai") {
      link.className = "button button-primary button-small";
      link.textContent = "打开官方授权页";
      $("#copy-oauth-link").hidden = false;
      $("#qr-status").lastElementChild.textContent = "等待你在浏览器中完成授权…";
    } else {
      link.className = "text-link";
      link.textContent = "二维码无法识别？在新窗口打开";
      image.onload = () => {
        if (data.sessionId !== state.oauthSessionId) return;
        $("#qr-stage .spinner").hidden = true;
        image.hidden = false;
        $("#qr-status").lastElementChild.textContent = "等待手机确认登录…";
      };
      image.src = `/api/oauth/${data.sessionId}/qr`;
    }
    state.qrPollTimer = setTimeout(() => pollQrStatus(data.sessionId, variant), 1800);
  } catch (error) {
    if (serial !== state.loginRequestSerial) return;
    $("#qr-stage .spinner").hidden = true;
    $("#qr-status").lastElementChild.textContent = error.message;
    toast(error.message, "error");
  }
}

function openQrDialog() {
  const dialog = $("#qr-dialog");
  dialog.showModal();
  void startOAuthLogin(state.loginVariant);
}

async function copyOAuthLink() {
  if (!state.oauthAuthUrl) return;
  try {
    await navigator.clipboard.writeText(state.oauthAuthUrl);
    toast("授权链接已复制，请粘贴到浏览器无痕窗口");
  } catch {
    const field = document.createElement("textarea");
    field.value = state.oauthAuthUrl;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    toast(copied ? "授权链接已复制，请粘贴到浏览器无痕窗口" : "复制失败，请点击“打开官方授权页”", copied ? "success" : "error");
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-button");
  const errorNode = $("#login-error");
  errorNode.hidden = true;
  setButtonLoading(button, true, "正在验证…");
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    showApp();
    await loadDashboard();
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    setButtonLoading(button, false, "正在验证…");
  }
});

$("#toggle-password").addEventListener("click", () => {
  const input = $("#password");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("#toggle-password").textContent = visible ? "显示" : "隐藏";
  $("#toggle-password").setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* Cookie is cleared locally by expiry or next auth check. */ }
  showLogin();
});
$("#refresh-button").addEventListener("click", () => loadDashboard());
$("#checkin-all-button").addEventListener("click", checkinAll);
$("#credits-all-button").addEventListener("click", refreshCreditsAll);
$("#settings-button").addEventListener("click", openSettingsDialog);
$("#schedule-form").addEventListener("submit", saveSchedule);
$("#password-form").addEventListener("submit", savePassword);
$("#add-account-button").addEventListener("click", openQrDialog);
$("#empty-add-button").addEventListener("click", openQrDialog);
$("#variant-cn-button").addEventListener("click", () => {
  if (state.loginVariant !== "cn") void startOAuthLogin("cn");
});
$("#variant-ai-button").addEventListener("click", () => {
  if (state.loginVariant !== "ai") void startOAuthLogin("ai");
});
$("#copy-oauth-link").addEventListener("click", () => { void copyOAuthLink(); });
$("#qr-dialog").addEventListener("close", () => {
  stopQrPolling();
  state.oauthSessionId = null;
  state.oauthAuthUrl = "";
  state.loginRequestSerial += 1;
});

function refreshDateSensitiveStatus() {
  if (!views.app.hidden && state.renderedBeijingDate !== beijingDate(Date.now())) renderAccounts();
}

setInterval(refreshDateSensitiveStatus, 30_000);
document.addEventListener("visibilitychange", refreshDateSensitiveStatus);

(async function initialize() {
  try {
    const session = await api("/api/auth/session");
    if (session.authenticated) {
      showApp();
      await loadDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
