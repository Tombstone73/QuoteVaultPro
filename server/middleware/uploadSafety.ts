/**
 * Upload Safety Middleware
 * 
 * Production-safety guards for file uploads:
 * - MIME type validation (primarily prevents accidental wrong uploads, not full adversarial security)
 * - Filename sanitization (path traversal, special chars)
 * - Concurrent upload limits per user
 * 
 * All enforcement can be disabled via FEATURE_UPLOAD_VALIDATION_ENABLED=false.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

/**
 * Check if upload validation is enabled
 */
export function isUploadValidationEnabled(): boolean {
  const enabled = process.env.FEATURE_UPLOAD_VALIDATION_ENABLED;
  if (enabled === undefined || enabled === '') return true; // Default: enabled
  return !['0', 'false', 'off', 'no'].includes(enabled.toLowerCase().trim());
}

/**
 * Parse max concurrent uploads from env
 */
function getMaxConcurrentUploads(): number {
  const max = parseInt(process.env.MAX_CONCURRENT_UPLOADS_PER_USER || '3', 10);
  return isNaN(max) || max <= 0 ? 3 : max;
}

/**
 * Parse max filename length from env
 */
function getMaxFilenameLength(): number {
  const max = parseInt(process.env.MAX_FILENAME_LENGTH || '255', 10);
  return isNaN(max) || max <= 0 ? 255 : max;
}

/**
 * Concurrent upload tracking
 * Maps userId -> { count: number, lastUpdate: number }
 * 
 * NOTE: In-memory tracking is best-effort in multi-instance deployments.
 * For horizontal scaling, consider Redis-backed tracking.
 */
const activeUploads = new Map<string, { count: number; lastUpdate: number }>();

/**
 * TTL for upload tracking (5 minutes)
 * Prevents users from being locked out if request crashes
 */
const UPLOAD_TRACKING_TTL_MS = 5 * 60 * 1000;

/**
 * Clean up stale upload tracking entries
 */
function cleanupStaleEntries(): void {
  const now = Date.now();
  const staleUsers: string[] = [];
  
  activeUploads.forEach((data, userId) => {
    if (now - data.lastUpdate > UPLOAD_TRACKING_TTL_MS) {
      staleUsers.push(userId);
    }
  });
  
  staleUsers.forEach(userId => {
    activeUploads.delete(userId);
  });
}

// Cleanup every 2 minutes
setInterval(cleanupStaleEntries, 2 * 60 * 1000);

/**
 * Increment concurrent upload count for user
 */
function incrementUploadCount(userId: string): boolean {
  const maxConcurrent = getMaxConcurrentUploads();
  const current = activeUploads.get(userId);
  
  if (current) {
    if (current.count >= maxConcurrent) {
      return false; // Already at max
    }
    current.count++;
    current.lastUpdate = Date.now();
  } else {
    activeUploads.set(userId, { count: 1, lastUpdate: Date.now() });
  }
  
  return true;
}

/**
 * Decrement concurrent upload count for user
 */
function decrementUploadCount(userId: string): void {
  const current = activeUploads.get(userId);
  if (current) {
    current.count = Math.max(0, current.count - 1);
    current.lastUpdate = Date.now();
    if (current.count === 0) {
      activeUploads.delete(userId);
    }
  }
}

/**
 * Middleware: Enforce concurrent upload limits
 * Apply to all file upload endpoints
 */
export function concurrentUploadLimiter(req: Request, res: Response, next: NextFunction): any {
  if (!isUploadValidationEnabled()) {
    return next();
  }
  
  const userId = (req.user as any)?.id;
  if (!userId) {
    // No user context - skip check (shouldn't happen on authenticated routes)
    return next();
  }
  
  const allowed = incrementUploadCount(userId);
  
  if (!allowed) {
    logger.warn('Concurrent upload limit exceeded', {
      requestId: req.requestId,
      userId,
      organizationId: req.organizationId,
      maxConcurrent: getMaxConcurrentUploads(),
    });
    
    return res.status(429).json({
      success: false,
      message: 'Maximum concurrent uploads reached. Please wait for current uploads to complete.',
      requestId: req.requestId,
    });
  }
  
  // Decrement in finally block to ensure cleanup even on errors
  const cleanup = () => decrementUploadCount(userId);
  
  // Register cleanup on response finish or error
  res.on('finish', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
  
  next();
}

/**
 * Validate MIME type against whitelist
 * 
 * NOTE: This validates the Content-Type header, which can be spoofed.
 * This is primarily to prevent accidental wrong file uploads, not full adversarial security.
 */
export function validateMimeType(allowedTypes: string[]): (req: Request, res: Response, next: NextFunction) => any {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!isUploadValidationEnabled()) {
      return next();
    }
    
    const contentType = req.headers['content-type'] || '';
    const mimeType = contentType.split(';')[0].trim().toLowerCase();
    
    if (!mimeType) {
      // No content type specified - let it through (will be caught by upload handler)
      return next();
    }
    
    // Check if MIME type matches any allowed pattern
    const isAllowed = allowedTypes.some(allowed => {
      if (allowed.endsWith('/*')) {
        // Wildcard match (e.g., "image/*")
        const prefix = allowed.slice(0, -2);
        return mimeType.startsWith(prefix);
      }
      return mimeType === allowed.toLowerCase();
    });
    
    if (!isAllowed) {
      logger.warn('Invalid MIME type rejected', {
        requestId: req.requestId,
        userId: (req.user as any)?.id,
        organizationId: req.organizationId,
        mimeType,
        allowedTypes,
        path: req.path,
      });
      
      return res.status(415).json({
        success: false,
        message: `Unsupported file type. Allowed types: ${allowedTypes.join(', ')}`,
        requestId: req.requestId,
      });
    }
    
    next();
  };
}

/**
 * Sanitize filename to prevent path traversal and special character issues
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'untitled';
  
  const maxLength = getMaxFilenameLength();
  
  // Remove path components
  let sanitized = filename.replace(/^.*[/\\]/, '');
  
  // Remove path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');
  
  // Replace special characters with underscores
  sanitized = sanitized.replace(/[<>:"|?*\x00-\x1f]/g, '_');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    const ext = sanitized.lastIndexOf('.');
    if (ext > 0) {
      const name = sanitized.substring(0, ext);
      const extension = sanitized.substring(ext);
      const maxNameLength = maxLength - extension.length;
      sanitized = name.substring(0, maxNameLength) + extension;
    } else {
      sanitized = sanitized.substring(0, maxLength);
    }
  }
  
  // Fallback if empty
  return sanitized || 'untitled';
}

/**
 * MIME type presets for common use cases
 */
export const MIME_PRESETS = {
  PREPRESS_PDF: ['application/pdf'],
  ATTACHMENTS: ['image/*', 'application/pdf', 'application/zip'],
  PROFILE_IMAGES: ['image/jpeg', 'image/png', 'image/webp'],
};
