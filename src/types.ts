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
  credits_total_capacity: number | null;
  credits_total_remaining: number | null;
  credits_soonest_expire_at: number | null;
  credits_updated_at: number | null;
  credits_error: string | null;
  credits_error_at: number | null;
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
  credits: PublicCredits;
  createdAt: number;
}

export interface PublicCredits {
  totalCapacity: number | null;
  totalRemaining: number | null;
  soonestExpireAt: number | null;
  updatedAt: number | null;
  error: string | null;
  errorAt: number | null;
}

export interface CreditSummary {
  totalCapacity: number;
  totalRemaining: number;
  soonestExpireAt: number | null;
}

export interface CreditRefreshResult {
  accountId: string;
  status: "success" | "error" | "busy";
  message: string;
  credits?: PublicCredits;
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
