/**
 * API Configuration
 * 
 * Centralized API URL management for frontend requests.
 * In production (Vercel), uses relative paths that get proxied to Railway backend.
 * In development, uses relative paths that hit the local dev server.
 */

/**
 * Get the full API URL for a given path.
 * 
 * @param path - API path (e.g., "/api/users")
 * @returns Full URL for the API endpoint
 * 
 * In production (Vercel deployment), returns relative path that Vercel rewrites to Railway.
 * In development, returns relative path that hits local backend.
 */
export function getApiUrl(path: string): string {
  // Always use relative URLs - Vercel rewrites /api/* to Railway, dev server handles locally
  return path;
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
