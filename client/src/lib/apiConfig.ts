/**
 * API Configuration
 * 
 * Centralized API URL management for frontend requests.
 * 
 * ENVIRONMENT REQUIREMENTS:
 * - Vercel (production): MUST set VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
 * - Railway backend: MUST enable CORS for https://www.printershero.com origin
 * - Railway backend: MUST set SESSION_COOKIE_DOMAIN and CORS_ORIGIN appropriately
 * 
 * Auth flow MUST use explicit Railway backend URL to establish session cookies
 * under the Railway domain, not the Vercel domain.
 */

/**
 * Check if API configuration is valid.
 * In production, VITE_API_BASE_URL MUST be set.
 * 
 * @returns Object with isValid flag and error message if invalid
 */
export function checkApiConfig(): { isValid: boolean; error?: string } {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  
  if (import.meta.env.PROD && !baseUrl) {
    return {
      isValid: false,
      error: "VITE_API_BASE_URL is not configured. This environment variable must be set in Vercel production environment."
    };
  }
  
  return { isValid: true };
}

/**
 * Get the API base URL.
 * 
 * In production (Vercel), uses VITE_API_BASE_URL to point to Railway backend.
 * In development, uses empty string (relative URLs hit local dev server).
 * 
 * @returns Base URL for API (empty string for dev, Railway URL for production)
 */
function getApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  
  // In production, VITE_API_BASE_URL MUST be set
  // Instead of throwing, we log error and return empty string
  // The app will show a config error page (checked in main.tsx)
  if (import.meta.env.PROD && !baseUrl) {
    console.error("[API CONFIG] VITE_API_BASE_URL is required in production");
    return "";
  }
  
  // Normalize: remove trailing slash
  return baseUrl.replace(/\/$/, "");
}

/**
 * Get the full API URL for a given path.
 * 
 * @param path - API path (e.g., "/api/users" or "/api/auth/login")
 * @returns Full URL for the API endpoint
 * 
 * In production: https://quotevaultpro-production.up.railway.app/api/auth/login
 * In development: /api/auth/login (relative, hits local backend)
 */
export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  
  const fullUrl = baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
  
  // Runtime guardrail: warn if constructed URL accidentally uses current page origin
  // (This would indicate misconfiguration where auth hits Vercel instead of Railway)
  if (typeof window !== "undefined" && fullUrl.startsWith(window.location.origin)) {
    console.warn(
      `[API CONFIG] Potential misconfiguration: API URL starts with current page origin.`,
      `URL: ${fullUrl}`,
      `Expected Railway backend URL in production.`,
      `Check VITE_API_BASE_URL environment variable.`
    );
  }
  
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
