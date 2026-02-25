import type { CookieOptions } from "express-session";

type AppEnv = "production" | "development";
type CookieSameSite = "lax" | "strict" | "none";

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getHostnameFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getAppEnv(): AppEnv {
  const appEnv = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv === "production" || appEnv === "development") {
    return appEnv;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function getPublicWebOrigin(): string | null {
  return normalizeOrigin(process.env.APP_PUBLIC_WEB_ORIGIN);
}

function inferCookieDomainFromOrigin(origin: string | null): string | undefined {
  const hostname = getHostnameFromOrigin(origin);
  if (!hostname) return undefined;

  if (hostname === "printershero.com" || hostname.endsWith(".printershero.com")) {
    return ".printershero.com";
  }

  return undefined;
}

export function getCookieDomain(): string | undefined {
  const explicitCookieDomain = (process.env.APP_COOKIE_DOMAIN ?? "").trim();
  if (explicitCookieDomain) {
    return explicitCookieDomain;
  }

  return inferCookieDomainFromOrigin(getPublicWebOrigin());
}

export function getCookieSameSite(): CookieSameSite {
  const configured = (process.env.APP_COOKIE_SAMESITE ?? "lax").trim().toLowerCase();
  if (configured === "strict" || configured === "none") {
    return configured;
  }
  return "lax";
}

export function shouldUseSecureCookies(): boolean {
  const explicit = (process.env.APP_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;

  const publicWebOrigin = getPublicWebOrigin();
  if (publicWebOrigin) {
    return publicWebOrigin.startsWith("https://");
  }

  return getAppEnv() === "production";
}

export function getAllowedCorsOrigins(): string[] {
  const allowed = new Set<string>();
  const publicWebOrigin = getPublicWebOrigin();
  if (publicWebOrigin) {
    allowed.add(publicWebOrigin);
  }

  if (getAppEnv() !== "production") {
    allowed.add("http://localhost:5173");
    allowed.add("http://127.0.0.1:5173");
    allowed.add("http://localhost:4173");
    allowed.add("http://127.0.0.1:4173");
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  return Array.from(allowed);
}

export function getSessionCookieConfig(sessionTtl: number): CookieOptions {
  const cookieDomain = getCookieDomain();

  return {
    path: "/",
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    maxAge: sessionTtl,
    sameSite: getCookieSameSite(),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

export function getRuntimeConfigLogLine(): string {
  const appEnv = getAppEnv();
  const publicWebOrigin = getPublicWebOrigin() ?? "(unset)";
  const cookieDomain = getCookieDomain() ?? "(host-only)";
  const sameSite = getCookieSameSite();
  const secure = shouldUseSecureCookies();
  const corsOrigins = getAllowedCorsOrigins();
  const corsSummary = corsOrigins.length > 0 ? corsOrigins.join(",") : "(none)";
  return `[RuntimeConfig] env=${appEnv} webOrigin=${publicWebOrigin} cookieDomain=${cookieDomain} sameSite=${sameSite} secure=${secure} corsAllowed=${corsSummary}`;
}
