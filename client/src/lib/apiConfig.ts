/**
 * API/Object URL Configuration
 *
 * Environment-driven frontend routing:
 * - `VITE_API_BASE_URL` for `/api/*`
 * - `VITE_OBJECTS_BASE_URL` for `/objects/*`
 *
 * Missing env vars default to empty string, preserving same-origin/local-dev behavior.
 */

/**
 * Check if API configuration is valid.
 * In production, we use same-origin /api/* paths (proxied by Vercel).
 * 
 * @returns Object with isValid flag and error message if invalid
 */
export function checkApiConfig(): { isValid: boolean; error?: string } {
  // Always valid: empty env vars intentionally fall back to same-origin paths.
  return { isValid: true };
}

/**
 * Remove trailing slashes from env-provided base URLs.
 */
function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.replace(/\/+$/, "");
}

/**
 * Ensure path starts with exactly one leading slash.
 */
function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const objectsBaseUrl = normalizeBaseUrl(import.meta.env.VITE_OBJECTS_BASE_URL);

/**
 * Build a full API URL from a path.
 */
export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

/**
 * Build a full objects URL from a path.
 */
export function objectsUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return objectsBaseUrl ? `${objectsBaseUrl}${normalizedPath}` : normalizedPath;
}

/**
 * Backward-compatible alias used across existing code.
 */
export function getApiUrl(path: string): string {
  return apiUrl(path);
}

/**
 * Infer API environment marker from VITE_API_BASE_URL hostname.
 */
export function getApiEnvironmentLabel(): "dev" | "prod" | "local" | "custom" {
  if (!apiBaseUrl) return "local";

  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    if (hostname.includes("dev") || hostname.includes("staging") || hostname.includes("test")) {
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

/**
 * Parse JSON response with validation.
 * 
 * @param response - Fetch response object
 * @returns Parsed JSON data
 * @throws Error if Content-Type is not JSON or parsing fails
 */
export async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(`Expected JSON response, got ${contentType || "unknown"}`);
  }
  return response.json();
}
