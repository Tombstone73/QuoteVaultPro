/**
 * Tenant Boundary Guard
 * 
 * Production-safety guards for multi-tenant data isolation.
 * Ensures organizationId is present and enforced at all data access points.
 * 
 * Key behaviors:
 * - requireOrganizationId: Fails with 500 if org context missing (server bug)
 * - enforceOrgScope: Fails with 404 if resource belongs to different org (fail-closed, no info leak)
 * - requireUserId: Fails with 500 if user context missing (server bug)
 * 
 * These guards are defensive assertions - they should NEVER fail in correct code.
 * When they do fail, they indicate a security-critical bug that must be fixed immediately.
 */

import type { Request } from 'express';

/**
 * Custom error for tenant boundary violations
 * Signals that a security-critical invariant has been violated
 */
export class TenantBoundaryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly safeMessage: string = 'Internal Server Error'
  ) {
    super(message);
    this.name = 'TenantBoundaryError';
  }
}

/**
 * Ensure organizationId is present in request context.
 * This is a REQUIRED invariant for all tenant-scoped operations.
 * 
 * @param req Express request (must have organizationId from tenantContext middleware)
 * @throws TenantBoundaryError with 500 if organizationId missing (indicates server bug)
 * @returns organizationId string (guaranteed non-empty)
 * 
 * Usage:
 *   const orgId = requireOrganizationId(req);
 *   // orgId is now guaranteed to be a valid string
 */
export function requireOrganizationId(req: Request): string {
  const orgId = req.organizationId;
  
  if (!orgId || typeof orgId !== 'string' || orgId.trim() === '') {
    // This is a server bug - tenant context should always be set for protected routes
    // Log with full context for debugging
    console.error('[TenantGuard] CRITICAL: organizationId missing from request context', {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      userId: (req.user as any)?.id,
      hasUser: !!req.user,
      orgIdValue: orgId,
      orgIdType: typeof orgId,
    });
    
    throw new TenantBoundaryError(
      'Organization context not available - tenant middleware not applied',
      500,
      'Internal Server Error'
    );
  }
  
  return orgId;
}

/**
 * Enforce that a resource belongs to the actor's organization.
 * Fail-closed: if organizations don't match, return 404 (not 403) to avoid leaking existence.
 * 
 * @param resourceOrgId Organization ID that owns the resource
 * @param actorOrgId Organization ID of the authenticated user
 * @param resourceType Human-readable resource type for error messages (e.g., "customer", "order")
 * @throws TenantBoundaryError with 404 if org mismatch (fail-closed, no info leak)
 * 
 * Usage:
 *   const customer = await db.select()...;
 *   enforceOrgScope(customer.organizationId, actorOrgId, 'customer');
 */
export function enforceOrgScope(
  resourceOrgId: string | null | undefined,
  actorOrgId: string,
  resourceType: string = 'resource'
): void {
  if (!resourceOrgId || resourceOrgId !== actorOrgId) {
    // Fail closed: return 404 (not 403) to avoid confirming resource existence to wrong tenant
    // Production-safe message: no details about which org or resource
    throw new TenantBoundaryError(
      `Cross-tenant access attempted: ${resourceType} belongs to org ${resourceOrgId}, actor is org ${actorOrgId}`,
      404,
      `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} not found`
    );
  }
}

/**
 * Ensure userId is present in request context.
 * Used for audit-critical operations where user identity is required.
 * 
 * @param req Express request (must have user from isAuthenticated middleware)
 * @throws TenantBoundaryError with 500 if userId missing (indicates server bug)
 * @returns userId string (guaranteed non-empty)
 * 
 * Usage:
 *   const userId = requireUserId(req);
 *   // userId is now guaranteed to be a valid string
 */
export function requireUserId(req: Request): string {
  const user = req.user as any;
  const userId = user?.id || user?.claims?.sub;
  
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    // This is a server bug - user should always be set for protected routes
    console.error('[TenantGuard] CRITICAL: userId missing from request context', {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
      hasUser: !!req.user,
      userKeys: user ? Object.keys(user) : [],
    });
    
    throw new TenantBoundaryError(
      'User context not available - authentication middleware not applied',
      500,
      'Internal Server Error'
    );
  }
  
  return userId;
}

/**
 * Validate that an organizationId parameter is safe and non-empty.
 * Use this when accepting org IDs from path params or query strings (rare - prefer session context).
 * 
 * @param orgId Organization ID from untrusted input
 * @param paramName Parameter name for error messages
 * @throws TenantBoundaryError with 400 if invalid
 * @returns sanitized orgId string
 */
export function validateOrgIdParam(orgId: unknown, paramName: string = 'organizationId'): string {
  if (!orgId || typeof orgId !== 'string' || orgId.trim() === '') {
    throw new TenantBoundaryError(
      `Invalid ${paramName} parameter: empty or non-string`,
      400,
      `Invalid ${paramName} parameter`
    );
  }
  
  const sanitized = orgId.trim();
  
  // Basic validation: org IDs should be alphanumeric with underscores/hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new TenantBoundaryError(
      `Invalid ${paramName} format: contains illegal characters`,
      400,
      `Invalid ${paramName} format`
    );
  }
  
  return sanitized;
}
