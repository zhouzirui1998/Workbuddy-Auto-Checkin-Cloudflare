export interface CredentialPayload {
  accessToken: string;
  refreshToken?: string;
  domain: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}

export interface OAuthPayload {
  state: string;
  authUrl: string;
}

export interface AccountProfile {
  uid: string;
  nickname: string | null;
  email: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
}

export interface AccountRow {
  id: string;
  uid: string;
  nickname: string | null;
  email: string | null;
  enterprise_id: string | null;
  enterprise_name: string | null;
  domain: string;
  credential_ciphertext: string;
  credential_iv: string;
  expires_at: number | null;
  refresh_expires_at: number | null;
  enabled: number;
  needs_relogin: number;
  relogin_reason: string | null;
  last_checkin_status: string | null;
  last_checkin_message: string | null;
  last_checkin_at: number | null;
  checkin_lock_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface PublicAccount {
  id: string;
  uid: string;
  nickname: string | null;
  email: string | null;
  enterpriseName: string | null;
  enabled: boolean;
  needsRelogin: boolean;
  reloginReason: string | null;
  lastCheckinStatus: string | null;
  lastCheckinMessage: string | null;
  lastCheckinAt: number | null;
  createdAt: number;
}

export interface CheckinLogRow {
  id: number;
  account_id: string;
  account_name: string | null;
  local_date: string;
  status: string;
  message: string;
  created_at: number;
}

export interface CheckinResult {
  accountId: string;
  status: "success" | "already" | "error" | "busy";
  message: string;
}

export interface AppSettingsRow {
  id: number;
  checkin_time: string;
  last_scheduled_date: string | null;
  scheduled_lock_until: number | null;
  updated_at: number;
}

export interface PublicSettings {
  checkinTime: string;
  timeZone: string;
  scheduleLabel: string;
}

export interface OAuthSessionRow {
  id: string;
  payload_ciphertext: string;
  payload_iv: string;
  expires_at: number;
  created_at: number;
}

export interface WorkBuddyResponse {
  code?: number | string;
  message?: string;
  msg?: string;
  data?: unknown;
  success?: boolean;
}
