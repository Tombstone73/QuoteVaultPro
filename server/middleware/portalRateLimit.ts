import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

// Authenticated limits isolate tenants and users rather than sharing a shop's IP quota.
export function portalRateLimitKey(req: Request): string {
  const userId = (req.user as { id?: string } | undefined)?.id;
  return req.organizationId && userId
    ? JSON.stringify([req.organizationId, userId])
    : ipKeyGenerator(req.ip ?? 'unknown');
}

const options = { standardHeaders: true, legacyHeaders: false,
  keyGenerator: portalRateLimitKey,
  message: { success: false, message: 'Too many portal requests. Please wait before retrying.' } };
export const portalMutationLimiter = rateLimit({ ...options, windowMs: 60_000, max: 120 });
export const portalPricingLimiter = rateLimit({ ...options, windowMs: 60_000, max: 60 });
export const portalPaymentLimiter = rateLimit({ ...options, windowMs: 60_000, max: 30 });
