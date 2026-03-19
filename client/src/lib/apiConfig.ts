/**
 * API/Object URL Configuration
 *
 * Environment-driven frontend routing:
 * - `VITE_API_BASE_URL` optionally overrides `/api/*`
 * - `VITE_OBJECTS_BASE_URL` optionally overrides `/objects/*`
 *
 * Missing env vars preserve same-origin behavior.
 */

export function checkApiConfig(): { isValid: boolean; error?: string } {
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

export function apiUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) {
    return path;
  }

  const normalizedPath = normalizePath(path);
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
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

  if (apiBaseUrl && trimmed.startsWith(apiBaseUrl)) {
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
  if (!apiBaseUrl) return "local";

  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    if (
      hostname.includes("dev") ||
      hostname.includes("staging") ||
      hostname.includes("test")
    ) {
      return "dev";
    }
    if (hostname.includes("prod") || hostname.includes("production")) {
      return "prod";
    }
    return "custom";
  } catch {
    return "custom";
  }
}

export function getApiBaseUrlForDebug(): string {
  return apiBaseUrl;
}

export async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(`Expected JSON response, got ${contentType || "unknown"}`);
  }
  return response.json();
}