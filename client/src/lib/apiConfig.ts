/**
 * API Configuration
 * 
 * Centralized API URL management for frontend requests.
 * 
 * STRATEGY:
 * - Production (Vercel): Use same-origin /api/* paths which proxy to Railway backend via vercel.json.
 *   This enables session cookies to work correctly (same-origin = no cross-site cookie issues).
 * - Development: Use relative /api/* paths which hit local dev server.
 * 
 * ENVIRONMENT VARIABLES:
 * - VITE_API_BASE_URL: (Optional) Override base URL for direct Railway calls. 
 *   Default behavior is to use same-origin /api/* which proxies through Vercel.
 * 
 * SESSION COOKIE REQUIREMENTS:
 * - Backend must set: cookie.secure=true, cookie.sameSite='none', cookie.httpOnly=true in production
 * - Backend must set: trust proxy = 1 (Railway runs behind proxy)
 * - CORS must allow origin: https://www.printershero.com with credentials: true
 * - Frontend must use: credentials: 'include' in fetch calls
 */

/**
 * Check if API configuration is valid.
 * In production, we use same-origin /api/* paths (proxied by Vercel).
 * 
 * @returns Object with isValid flag and error message if invalid
 */
export function checkApiConfig(): { isValid: boolean; error?: string } {
  // Always valid - we use same-origin paths in production
  return { isValid: true };
}

/**
 * Get the API base URL.
 * 
 * STRATEGY: Use same-origin /api/* paths which are proxied by Vercel to Railway backend.
 * This ensures session cookies work correctly (no cross-site issues).
 * 
 * VITE_API_BASE_URL can optionally override this for direct Railway calls,
 * but this is NOT recommended as it requires complex cross-site cookie setup.
 * 
 * @returns Base URL for API (empty string = same-origin)
 */
function getApiBaseUrl(): string {
  // Prefer same-origin /api/* paths (proxied by Vercel in production)
  // Only use VITE_API_BASE_URL if explicitly set (for testing/debugging)
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  
  if (baseUrl) {
    console.log("[API CONFIG] Using explicit VITE_API_BASE_URL:", baseUrl);
    return baseUrl.replace(/\/$/, "");
  }
  
  // Default: empty string = same-origin paths (recommended)
  return "";
}

/**
 * Get the full API URL for a given path.
 * 
 * @param path - API path (e.g., "/api/users" or "/api/auth/login")
 * @returns Full URL for the API endpoint
 * 
 * In production: /api/auth/login (same-origin, proxied by Vercel to Railway)
 * In development: /api/auth/login (same-origin, hits local backend)
 */
export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  
  const fullUrl = baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
  
  return fullUrl;
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
