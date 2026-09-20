const $ = (selector) => document.querySelector(selector);

const state = {
  accounts: [],
  logs: [],
  checkinTime: "08:10",
  qrPollTimer: null,
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

function accountName(account) {
  return account.nickname || account.email || `账号 ${account.uid.slice(0, 8)}`;
}

function statusMeta(account) {
  if (account.needsRelogin) return { label: "需重新登录", className: "badge-danger", message: account.reloginReason || "登录状态已失效" };
  if (!account.enabled) return { label: "已暂停", className: "badge-muted", message: "自动签到已暂停" };
  if (account.lastCheckinStatus === "success") return { label: "签到成功", className: "badge-success", message: account.lastCheckinMessage || "签到成功" };
  if (account.lastCheckinStatus === "already") return { label: "今日已签", className: "badge-success", message: account.lastCheckinMessage || "今天已经签到" };
  if (account.lastCheckinStatus === "error") return { label: "签到失败", className: "badge-danger", message: account.lastCheckinMessage || "签到失败" };
  return { label: "等待签到", className: "badge-warning", message: "尚无签到记录" };
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
  const grid = $("#accounts-grid");
  grid.replaceChildren();
  $("#accounts-loading").hidden = true;
  $("#accounts-empty").hidden = state.accounts.length !== 0;
  const successful = state.accounts.filter((account) => ["success", "already"].includes(account.lastCheckinStatus)).length;
  const attention = state.accounts.filter((account) => account.needsRelogin || account.lastCheckinStatus === "error").length;
  $("#account-count").textContent = state.accounts.length;
  $("#success-count").textContent = successful;
  $("#attention-count").textContent = attention;

  for (const account of state.accounts) {
    const meta = statusMeta(account);
    const card = document.createElement("article");
    card.className = "account-card";
    const avatar = document.createElement("div");
    avatar.className = "account-avatar";
    avatar.textContent = accountName(account).slice(0, 1).toUpperCase();

    const main = document.createElement("div");
    main.className = "account-main";
    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";
    const title = document.createElement("h3");
    title.className = "account-title";
    title.textContent = accountName(account);
    const badge = document.createElement("span");
    badge.className = `badge ${meta.className}`;
    badge.textContent = meta.label;
    titleRow.append(title, badge);

    const subtitle = document.createElement("p");
    subtitle.className = "account-subtitle";
    subtitle.textContent = [account.email, account.enterpriseName].filter(Boolean).join(" · ") || `UID ${account.uid}`;
    const status = document.createElement("div");
    status.className = "account-status";
    status.textContent = `${meta.message}${account.lastCheckinAt ? ` · ${formatTime(account.lastCheckinAt)}` : ""}`;
    const actions = document.createElement("div");
    actions.className = "account-actions";
    const checkin = createButton("立即签到", "button-secondary", (button) => checkinOne(account.id, button));
    checkin.disabled = !account.enabled;
    actions.append(
      checkin,
      createButton(account.enabled ? "暂停" : "启用", "button-ghost", (button) => toggleAccount(account, button)),
      createButton("删除", "button-danger", (button) => removeAccount(account, button)),
    );
    main.append(titleRow, subtitle, status, actions);
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

async function pollQrStatus(sessionId) {
  if (!$("#qr-dialog").open) return;
  try {
    const data = await api(`/api/oauth/${sessionId}/status`);
    if (!data.pending) {
      stopQrPolling();
      $("#qr-status").lastElementChild.textContent = "登录成功，正在载入账号…";
      toast("账号绑定成功");
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
  state.qrPollTimer = setTimeout(() => pollQrStatus(sessionId), 2200);
}

async function openQrDialog() {
  const dialog = $("#qr-dialog");
  const image = $("#qr-image");
  stopQrPolling();
  image.hidden = true;
  image.removeAttribute("src");
  $("#qr-stage .spinner").hidden = false;
  $("#qr-status").lastElementChild.textContent = "正在生成安全登录二维码…";
  $("#qr-link").hidden = true;
  dialog.showModal();
  try {
    const data = await api("/api/oauth/start", { method: "POST", body: "{}" });
    image.onload = () => {
      $("#qr-stage .spinner").hidden = true;
      image.hidden = false;
      $("#qr-status").lastElementChild.textContent = "等待手机确认登录…";
    };
    image.src = `/api/oauth/${data.sessionId}/qr`;
    $("#qr-link").href = data.authUrl;
    $("#qr-link").hidden = false;
    state.qrPollTimer = setTimeout(() => pollQrStatus(data.sessionId), 1800);
  } catch (error) {
    $("#qr-stage .spinner").hidden = true;
    $("#qr-status").lastElementChild.textContent = error.message;
    toast(error.message, "error");
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
$("#settings-button").addEventListener("click", openSettingsDialog);
$("#schedule-form").addEventListener("submit", saveSchedule);
$("#password-form").addEventListener("submit", savePassword);
$("#add-account-button").addEventListener("click", openQrDialog);
$("#empty-add-button").addEventListener("click", openQrDialog);
$("#qr-dialog").addEventListener("close", stopQrPolling);

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
