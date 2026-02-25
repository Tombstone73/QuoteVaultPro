/**
 * API/Object URL Configuration
 *
 * Environment-driven frontend routing:
 * - `VITE_API_BASE_URL` for `/api/*`
 * - `VITE_OBJECTS_BASE_URL` for `/objects/*`
 *
 * Missing env vars default to empty string, preserving same-origin/local-dev behavior.
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

const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const objectsBaseUrl = normalizeBaseUrl(import.meta.env.VITE_OBJECTS_BASE_URL);

export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function objectsUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return objectsBaseUrl ? `${objectsBaseUrl}${normalizedPath}` : normalizedPath;
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