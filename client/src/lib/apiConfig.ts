/**
 * API/Object URL Configuration
 *
 * Environment-driven frontend routing:
 * - `VITE_API_BASE_URL` is deployment-bound for PrintersHero web deployments
 * - `VITE_OBJECTS_BASE_URL` optionally overrides `/objects/*`
 *
 * Production and DEV use separate API origins. A missing deployment variable
 * resolves to that deployment's canonical origin; a cross-environment value
 * fails closed instead of falling through a hosting rewrite.
 */

import {
  expectedApiOriginForWebHost,
  DEVELOPMENT_API_ORIGIN,
  isPrintersHeroApiOrigin,
  normalizeOrigin,
  PRODUCTION_API_ORIGIN,
  resolveApiOriginForWebHost,
  validateApiOriginForWebHost,
} from "./apiRouting";

export function checkApiConfig(): { isValid: boolean; error?: string } {
  if (typeof window === "undefined") return { isValid: true };

  const validation = validateApiOriginForWebHost(window.location.hostname, getEffectiveApiBaseUrl());
  if (!validation.isValid) {
    return {
      isValid: false,
      error: `API configuration for ${window.location.hostname} must use ${validation.expectedApiOrigin}.`,
    };
  }

  return { isValid: true };
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isObjectsPath(pathname: string): boolean {
  return pathname === "/objects" || pathname.startsWith("/objects/");
}

const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const objectsBaseUrl = normalizeBaseUrl(import.meta.env.VITE_OBJECTS_BASE_URL);

function getExpectedDeploymentApiOrigin(): string {
  if (typeof window === "undefined") return "";
  return expectedApiOriginForWebHost(window.location.hostname) ?? "";
}

function getEffectiveApiBaseUrl(): string {
  // The explicit build-time value is allowed only after checkApiConfig verifies
  // it matches this deployment. The fallback preserves the same invariant for
  // legacy Vercel environments whose variable was not configured yet.
  return resolveApiOriginForWebHost(
    typeof window === "undefined" ? "" : window.location.hostname,
    apiBaseUrl || getExpectedDeploymentApiOrigin(),
  );
}

export function apiUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) {
    return path;
  }

  const normalizedPath = normalizePath(path);
  const effectiveApiBaseUrl = getEffectiveApiBaseUrl();
  return effectiveApiBaseUrl ? `${effectiveApiBaseUrl}${normalizedPath}` : normalizedPath;
}

/** Resolve an application-backend request and reject a known cross-environment API URL. */
export function resolveCanonicalApiRequestUrl(path: string): string {
  if (!isAbsoluteHttpUrl(path)) return apiUrl(path);

  const configuredOrigin = normalizeOrigin(getEffectiveApiBaseUrl());
  if (isPrintersHeroApiOrigin(path) && configuredOrigin && normalizeOrigin(path) !== configuredOrigin) {
    throw new Error("Cross-environment PrintersHero API request blocked by client routing policy.");
  }

  return path;
}

export function objectsUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) {
    return path;
  }

  const normalizedPath = normalizePath(path);
  return objectsBaseUrl ? `${objectsBaseUrl}${normalizedPath}` : normalizedPath;
}

export function resolveAppRequestUrl(inputUrl: string, currentOrigin?: string): string {
  const trimmed = inputUrl.trim();
  if (!trimmed) return inputUrl;

  const effectiveApiBaseUrl = getEffectiveApiBaseUrl();
  if (effectiveApiBaseUrl && trimmed.startsWith(effectiveApiBaseUrl)) {
    return trimmed;
  }

  if (objectsBaseUrl && trimmed.startsWith(objectsBaseUrl)) {
    return trimmed;
  }

  if (isApiPath(trimmed)) {
    return apiUrl(trimmed);
  }

  if (isObjectsPath(trimmed)) {
    return objectsUrl(trimmed);
  }

  if (!isAbsoluteHttpUrl(trimmed)) {
    return inputUrl;
  }

  try {
    const parsed = new URL(trimmed);
    if (currentOrigin && parsed.origin === currentOrigin) {
      const pathnameWithQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (isApiPath(parsed.pathname)) {
        return apiUrl(pathnameWithQuery);
      }
      if (isObjectsPath(parsed.pathname)) {
        return objectsUrl(pathnameWithQuery);
      }
    }
  } catch {
    return inputUrl;
  }

  return inputUrl;
}

export function resolveObjectsPublicUrl(pathOrUrl: string | null | undefined): string | null {
  if (typeof pathOrUrl !== "string") return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  if (isAbsoluteHttpUrl(trimmed)) {
    return trimmed;
  }

  if (isObjectsPath(trimmed)) {
    return objectsUrl(trimmed);
  }

  if (trimmed.startsWith("objects/")) {
    return objectsUrl(`/${trimmed}`);
  }

  const relativeObjectsPrefixes = ["thumbs/", "thumbnails/", "uploads/"];
  if (relativeObjectsPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return objectsUrl(`/objects/${trimmed}`);
  }

  const slashRelativeObjectsPrefixes = ["/thumbs/", "/thumbnails/", "/uploads/"];
  if (slashRelativeObjectsPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return objectsUrl(`/objects${trimmed}`);
  }

  return null;
}

export function getApiUrl(path: string): string {
  return apiUrl(path);
}

export function getApiEnvironmentLabel(): "dev" | "prod" | "local" | "custom" {
  // Resolve the hostname to classify. When VITE_API_BASE_URL is not set the
  // app routes /api/* via Vercel rewrites or same-origin — "no explicit host"
  // does NOT mean local. Use the page's own hostname as the fallback so the
  // label reflects the real deployment environment.
  const hostname = (() => {
    const effectiveApiBaseUrl = getEffectiveApiBaseUrl();
    if (effectiveApiBaseUrl) {
      try { return new URL(effectiveApiBaseUrl).hostname.toLowerCase(); } catch { /* fall through */ }
    }
    return typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  })();

  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return "local";
  if (normalizeOrigin(getEffectiveApiBaseUrl()) === PRODUCTION_API_ORIGIN) return "prod";
  if (normalizeOrigin(getEffectiveApiBaseUrl()) === DEVELOPMENT_API_ORIGIN) return "dev";
  if (hostname.includes("dev") || hostname.includes("staging") || hostname.includes("test")) return "dev";
  if (hostname.includes("prod") || hostname.includes("production")) return "prod";
  return "custom";
}

export function getApiBaseUrlForDebug(): string {
  return getEffectiveApiBaseUrl();
}

export async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(`Expected JSON response, got ${contentType || "unknown"}`);
  }
  return response.json();
}
