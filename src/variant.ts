export type AccountVariant = "cn" | "ai";

interface VariantConfig {
  apiBase: string;
  oauthPlatform: string;
  label: string;
  supportsCheckin: boolean;
}

const CONFIG: Record<AccountVariant, VariantConfig> = {
  cn: {
    apiBase: "https://www.codebuddy.cn",
    oauthPlatform: "workbuddy",
    label: "中国区",
    supportsCheckin: true,
  },
  ai: {
    apiBase: "https://www.workbuddy.ai",
    oauthPlatform: "workbuddy-ai",
    label: "国际版",
    supportsCheckin: false,
  },
};

export function parseAccountVariant(value: unknown): AccountVariant {
  return value === "ai" ? "ai" : "cn";
}

export function variantConfig(variant: AccountVariant): VariantConfig {
  return CONFIG[variant];
}

export function variantMatchesDomain(variant: AccountVariant, domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return true;
  const international = normalized === "workbuddy.ai" || normalized.endsWith(".workbuddy.ai");
  return variant === "ai" ? international : !international;
}

export function safeVariantAuthUrl(candidate: string | undefined, state: string, variant: AccountVariant): string {
  const config = variantConfig(variant);
  if (candidate) {
    try {
      const url = new URL(candidate);
      const expectedHost = new URL(config.apiBase).hostname;
      const baseDomain = expectedHost.replace(/^www\./u, "");
      const allowed = url.hostname === baseDomain || url.hostname.endsWith(`.${baseDomain}`);
      if (url.protocol === "https:" && allowed) return url.toString();
    } catch {
      // Fall through to the official login URL.
    }
  }
  return `${config.apiBase}/login?state=${encodeURIComponent(state)}`;
}

export function billingPaths(variant: AccountVariant, path: string): string[] {
  if (variant === "cn") return [path];
  const primary = path.startsWith("/v2/billing/meter/") ? path.slice(3) : path;
  const fallback = primary.startsWith("/billing/meter/") ? `/v2${primary}` : primary;
  return fallback === primary ? [primary] : [primary, fallback];
}
