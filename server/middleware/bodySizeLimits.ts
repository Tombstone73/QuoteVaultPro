/**
 * Body Size Limit Middleware
 * 
 * Provides route-specific body size validation to prevent memory exhaustion
 * from extremely large payloads. Works in conjunction with express.json() limit.
 * 
 * Usage:
 * app.post('/api/large-calc', checkBodySize('500kb'), handler);
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

/**
 * Parse size string to bytes
 * Supports: '100kb', '2mb', '1gb' (case-insensitive)
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i);
  if (!match) {
    throw new Error(`Invalid size format: ${sizeStr}`);
  }
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  
  const multipliers: Record<string, number> = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  return value * multipliers[unit];
}

/**
 * Middleware: Check request body size against limit
 * 
 * NOTE: This checks req.rawBody (set by express.json's verify callback).
 * If rawBody is not available, falls back to Content-Length header.
 * 
 * @param limit - Size limit (e.g., '500kb', '2mb')
 * @returns Express middleware
 */
export function checkBodySize(limit: string) {
  const maxBytes = parseSize(limit);
  
  return (req: Request, res: Response, next: NextFunction) => {
    let bodySize = 0;
    
    // Try to get actual body size from rawBody (set in server/index.ts verify callback)
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      bodySize = req.rawBody.length;
    } else if (req.headers['content-length']) {
      // Fallback to Content-Length header
      bodySize = parseInt(req.headers['content-length'], 10);
    }
    
    if (bodySize > maxBytes) {
      logger.warn('Body size limit exceeded', {
        requestId: req.requestId,
        path: req.path,
        bodySize,
        limit: maxBytes,
        organizationId: req.organizationId,
        userId: (req.user as any)?.id
      });
      
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `Request body exceeds maximum allowed size of ${limit}`,
        limit: maxBytes,
        actual: bodySize
      });
    }
    
    next();
  };
}
