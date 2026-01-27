/**
 * API Configuration
 * 
 * Centralizes API base URL configuration for all frontend API calls.
 * 
 * In development: Uses same-origin "/api" (proxied by Vite to localhost:5000)
 * In production: Can use Vercel rewrite OR direct Railway URL via env var
 * 
 * Environment Variables:
 * - VITE_API_BASE_URL: Optional. If set, all API calls use this base URL.
 *   Example: https://quotevaultpro-production.up.railway.app
 *   Default: "" (same-origin, relies on Vercel rewrite)
 */

/**
 * Get the base URL for API calls
 * @returns Base URL string (empty for same-origin, or full URL for cross-origin)
 */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "";
}

/**
 * Build a full API URL from a path
 * @param path - API path (should start with /api/)
 * @returns Full URL for fetch
 * 
 * @example
 * // Development (same-origin)
 * getApiUrl("/api/auth/login") // => "/api/auth/login"
 * 
 * // Production with VITE_API_BASE_URL set
 * getApiUrl("/api/auth/login") // => "https://railway-backend.com/api/auth/login"
 */
export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  
  if (!base) {
    // Same-origin: return path as-is
    return path;
  }
  
  // Cross-origin: combine base + path
  // Remove trailing slash from base, ensure path starts with /
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  
  return `${cleanBase}${cleanPath}`;
}

/**
 * Validate that a response is JSON
 * Throws helpful error if HTML is returned (common with Vercel SPA fallback)
 */
export async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type");
  
  if (!contentType?.includes("application/json")) {
    // Got HTML or other non-JSON response
    const text = await response.text();
    const preview = text.slice(0, 200);
    
    throw new Error(
      `Expected JSON from API, got ${contentType || "unknown content type"}. ` +
      `This usually means the API endpoint wasn't reached. ` +
      `Preview: ${preview}...`
    );
  }
  
  return response.json();
}
