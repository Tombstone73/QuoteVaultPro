/**
 * Rate Limiting Middleware
 * 
 * Production-safety rate limits to prevent abuse, runaway costs, and service degradation.
 * 
 * Layered approach:
 * 1. Global IP-based limit (anti-DDoS baseline)
 * 2. User-based limits (fair resource allocation)
 * 3. Endpoint-specific limits (protect expensive operations)
 * 
 * All limits are configurable via environment variables.
 * Rate limiting can be disabled via FEATURE_RATE_LIMITING_ENABLED=false.
 * 
 * NOTE: In-memory store is best-effort in multi-instance deployments.
 * For horizontal scaling, consider Redis-backed store.
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { logger } from '../logger';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Check if rate limiting is enabled
 */
export function isRateLimitingEnabled(): boolean {
  const enabled = process.env.FEATURE_RATE_LIMITING_ENABLED;
  if (enabled === undefined || enabled === '') return true; // Default: enabled
  return !['0', 'false', 'off', 'no'].includes(enabled.toLowerCase().trim());
}

/**
 * Parse rate limit from environment variable
 */
function parseRateLimit(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

/**
 * Parse time window in minutes from environment variable
 */
function parseWindowMinutes(envVar: string | undefined, defaultMinutes: number): number {
  if (!envVar) return defaultMinutes;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) || parsed <= 0 ? defaultMinutes : parsed;
}

/**
 * Custom handler for rate limit exceeded
 */
function rateLimitHandler(req: Request, res: Response) {
  const userId = (req.user as any)?.id;
  const orgId = req.organizationId;
  
  logger.warn('Rate limit exceeded', {
    requestId: req.requestId,
    userId,
    organizationId: orgId,
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
  
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
    requestId: req.requestId,
  });
}

/**
 * Skip rate limiting for certain routes
 */
function shouldSkipRateLimit(req: Request): boolean {
  // Always allow health checks
  if (req.path === '/health' || req.path === '/ready') {
    return true;
  }
  
  // Allow static assets (if any)
  if (req.path.startsWith('/assets/') || req.path.startsWith('/public/')) {
    return true;
  }
  
  return false;
}

/**
 * Global IP-based rate limit (anti-DDoS baseline)
 * Applies to ALL routes with exclusions
 */
export const globalIpRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_GLOBAL_WINDOW_MIN, 15) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_GLOBAL_PER_IP, 1000),
  message: 'Too many requests from this IP. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (!isRateLimitingEnabled()) return true;
    return shouldSkipRateLimit(req);
  },
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
});

/**
 * Auth endpoint rate limit (prevent brute force)
 * Per-IP to prevent credential stuffing
 */
export const authRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_AUTH_WINDOW_MIN, 15) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_AUTH_PER_IP, 5),
  message: 'Too many authentication attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitingEnabled(),
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
});

/**
 * Calculate endpoint rate limit (CPU-intensive)
 * Per-user to prevent resource exhaustion
 */
export const calculateRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_CALCULATE_WINDOW_MIN, 1) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_CALCULATE_PER_MIN, 10),
  message: 'Too many calculation requests. Please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitingEnabled(),
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const userId = (req.user as any)?.id;
    return userId ? `user:${userId}` : req.ip || 'unknown';
  },
});

/**
 * Email endpoint rate limit (prevent spam, protect quotas)
 * Per-user to prevent abuse
 */
export const emailRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_EMAIL_WINDOW_MIN, 60) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_EMAIL_PER_HOUR, 5),
  message: 'Too many email requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitingEnabled(),
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const userId = (req.user as any)?.id;
    return userId ? `user:${userId}` : req.ip || 'unknown';
  },
});

/**
 * Prepress job creation rate limit (limit concurrent PDF processing)
 * Per-user to prevent resource exhaustion
 */
export const prepressRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_PREPRESS_WINDOW_MIN, 5) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_PREPRESS_PER_5MIN, 3),
  message: 'Too many prepress jobs created. Please wait before creating more.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitingEnabled(),
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const userId = (req.user as any)?.id;
    return userId ? `user:${userId}` : req.ip || 'unknown';
  },
});

/**
 * General write operations rate limit
 * Per-user to prevent abuse of POST/PUT/PATCH/DELETE endpoints
 */
export const writeOperationsRateLimit = rateLimit({
  windowMs: parseWindowMinutes(process.env.RATE_LIMIT_WRITE_WINDOW_MIN, 15) * 60 * 1000,
  max: parseRateLimit(process.env.RATE_LIMIT_WRITE_PER_15MIN, 100),
  message: 'Too many write operations. Please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isRateLimitingEnabled(),
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const userId = (req.user as any)?.id;
    return userId ? `user:${userId}` : req.ip || 'unknown';
  },
});
