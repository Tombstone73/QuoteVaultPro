export const PUBLIC_FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
]);

export function normalizeInboundEmailDomain(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isPublicFreeEmailDomain(value: string | null | undefined): boolean {
  const domain = normalizeInboundEmailDomain(value);
  return Boolean(domain && PUBLIC_FREE_EMAIL_DOMAINS.has(domain));
}

