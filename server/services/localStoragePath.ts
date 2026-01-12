import path from 'path';
import { normalizeTenantObjectKey } from '../utils/orgKeys';

/**
 * Resolve local storage key to absolute filesystem path
 * 
 * Handles multiple storage key formats:
 * - "uploads/<uuid>" -> resolves relative to storage root
 * - "org-{orgId}/quotes/..." -> resolves relative to storage root (new format)
 * - Absolute paths -> returns as-is (after normalization)
 * 
 * Security: Prevents path traversal by ensuring resolved path is under storage root
 * 
 * @param storageKey Storage key from database (fileUrl field)
 * @returns Absolute filesystem path
 * @throws Error if path traversal detected or storage root cannot be determined
 */
export function resolveLocalStoragePath(storageKey: string): string {
  // Get storage root (same as fileStorage.ts uses)
  const storageRoot = process.env.FILE_STORAGE_ROOT || path.join(process.cwd(), 'uploads');
  const storageRootAbs = path.resolve(storageRoot);
  
  // If storageKey is already an absolute path, normalize it
  if (path.isAbsolute(storageKey)) {
    const normalized = path.normalize(storageKey);
    // Verify it's under storage root (security check)
    if (!normalized.startsWith(storageRootAbs + path.sep) && normalized !== storageRootAbs) {
      throw new Error(`Path traversal detected: resolved path ${normalized} is outside storage root ${storageRootAbs}`);
    }
    return normalized;
  }
  
  // Normalize separators (handle both / and \)
  const normalizedKey = normalizeTenantObjectKey(storageKey.replace(/\\/g, '/'));
  
  // Handle org-prefixed keys (e.g., "org_titan_001/orders/file.pdf")
  // These are already relative to storage root, no special handling needed
  let relativePath = normalizedKey;
  
  // Handle "uploads/" prefix - if storage root already ends with "uploads", 
  // strip the prefix to avoid double "uploads/uploads"
  if (normalizedKey.startsWith('uploads/') || normalizedKey.startsWith('uploads\\')) {
    // Check if storage root already includes "uploads"
    const rootBasename = path.basename(storageRootAbs);
    if (rootBasename.toLowerCase() === 'uploads') {
      // Strip "uploads/" prefix
      relativePath = normalizedKey.replace(/^uploads[/\\]/, '');
    } else {
      // Keep the prefix, it will be joined to storage root
      relativePath = normalizedKey;
    }
  }
  
  // Resolve to absolute path
  const resolvedPath = path.resolve(storageRootAbs, relativePath);
  
  // Security: Ensure resolved path is under storage root (prevent path traversal)
  if (!resolvedPath.startsWith(storageRootAbs + path.sep) && resolvedPath !== storageRootAbs) {
    throw new Error(`Path traversal detected: resolved path ${resolvedPath} is outside storage root ${storageRootAbs}`);
  }
  
  return resolvedPath;
}

