/**
 * Tenant Context Middleware
 * 
 * This middleware resolves the user's active organization and attaches it to the request.
 * It runs after authentication middleware and before route handlers.
 * 
 * Usage:
 *   app.use('/api', isAuthenticated, tenantContext, router);
 * 
 * After middleware runs, req.organizationId is available for all subsequent handlers.
 */

import { RequestHandler, Request } from 'express';
import { db } from './db';
import { userOrganizations, organizations, customers } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

// Default organization ID - matches the seed in migration 0020
export const DEFAULT_ORGANIZATION_ID = 'org_titan_001';
export const DEFAULT_ORGANIZATION_SLUG = 'titan';

// Extend Express Request to include organizationId
declare global {
  namespace Express {
    interface Request {
      organizationId?: string;
      organizationSlug?: string;
      orgRole?: string; // User's role in the current organization
    }
  }
}

/**
 * Helper to get the organizationId from a request.
 * Throws an error if organizationId is not set (for routes that require it).
 */
export function getRequestOrganizationId(req: Request): string {
  if (!req.organizationId) {
    throw new Error('Organization context not available. Ensure tenantContext middleware is applied.');
  }
  return req.organizationId;
}

/**
 * Helper to get organizationId with fallback to default.
 * Use this for routes that can work with a default org.
 */
export function getRequestOrganizationIdOrDefault(req: Request): string {
  return req.organizationId || DEFAULT_ORGANIZATION_ID;
}

/**
 * Resolves the user's default organization and attaches it to the request.
 * For portal users (customers), derives org from linked customer record.
 */
export const tenantContext: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user as any;
    
    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized - No user in session" });
    }

    // Check if org is specified in header (for org switching)
    const headerOrgId = req.headers['x-organization-id'] as string;
    
    if (headerOrgId) {
      // Verify user has access to this organization
      const membership = await db
        .select()
        .from(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, user.id),
            eq(userOrganizations.organizationId, headerOrgId)
          )
        )
        .limit(1);
      
      if (membership.length === 0) {
        return res.status(403).json({ message: "Forbidden - No access to this organization" });
      }
      
      req.organizationId = headerOrgId;
      req.orgRole = membership[0].role;
      return next();
    }

    // Get user's default organization
    const defaultOrg = await db
      .select({
        organizationId: userOrganizations.organizationId,
        slug: organizations.slug,
        orgRole: userOrganizations.role,
      })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(userOrganizations.userId, user.id),
          eq(userOrganizations.isDefault, true)
        )
      )
      .limit(1);

    if (defaultOrg.length > 0) {
      req.organizationId = defaultOrg[0].organizationId;
      req.organizationSlug = defaultOrg[0].slug;
      req.orgRole = defaultOrg[0].orgRole;
      console.log('[TenantContext] Set org context:', {
        organizationId: req.organizationId,
        orgRole: req.orgRole,
        userId: user.id
      });
      return next();
    }

    // Fallback: Get any organization the user belongs to
    const anyOrg = await db
      .select({
        organizationId: userOrganizations.organizationId,
        slug: organizations.slug,
        orgRole: userOrganizations.role,
      })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(eq(userOrganizations.userId, user.id))
      .limit(1);

    if (anyOrg.length > 0) {
      req.organizationId = anyOrg[0].organizationId;
      req.organizationSlug = anyOrg[0].slug;
      req.orgRole = anyOrg[0].orgRole;
      console.log('[TenantContext] Set org context (fallback):', {
        organizationId: req.organizationId,
        orgRole: req.orgRole,
        userId: user.id
      });
      return next();
    }

    // If user is a portal user (customer), derive org from customer record
    const customerOrg = await db
      .select({
        organizationId: customers.organizationId,
      })
      .from(customers)
      .where(eq(customers.userId, user.id))
      .limit(1);

    if (customerOrg.length > 0) {
      req.organizationId = customerOrg[0].organizationId;
      return next();
    }

    // Auto-provision: Create membership for user in default org
    console.warn(`[TenantContext] User ${user.id} has no organization membership - auto-provisioning to default org`);
    
    try {
      await db
        .insert(userOrganizations)
        .values({
          userId: user.id,
          organizationId: DEFAULT_ORGANIZATION_ID,
          role: 'member',
          isDefault: true,
        })
        .onConflictDoNothing();
      
      req.organizationId = DEFAULT_ORGANIZATION_ID;
      req.organizationSlug = DEFAULT_ORGANIZATION_SLUG;
      req.orgRole = 'member';
      return next();
    } catch (provisionError) {
      console.error('[TenantContext] Failed to auto-provision user to default org:', provisionError);
      return res.status(403).json({ 
        message: "No organization access - please contact your administrator" 
      });
    }

  } catch (error) {
    console.error('[TenantContext] Error resolving organization:', error);
    return res.status(500).json({ message: "Failed to resolve organization context" });
  }
};

/**
 * Optional tenant context - sets organizationId if user is authenticated, 
 * but doesn't block the request if not.
 * Use this for routes that work differently for authenticated vs anonymous users.
 */
export const optionalTenantContext: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user as any;
    
    if (!user?.id) {
      // Not authenticated - continue without org context
      return next();
    }

    // Check if org is specified in header
    const headerOrgId = req.headers['x-organization-id'] as string;
    
    if (headerOrgId) {
      const membership = await db
        .select()
        .from(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, user.id),
            eq(userOrganizations.organizationId, headerOrgId)
          )
        )
        .limit(1);
      
      if (membership.length > 0) {
        req.organizationId = headerOrgId;
      }
      return next();
    }

    // Try to get user's default organization
    const defaultOrg = await db
      .select({
        organizationId: userOrganizations.organizationId,
        slug: organizations.slug,
      })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(
        and(
          eq(userOrganizations.userId, user.id),
          eq(userOrganizations.isDefault, true)
        )
      )
      .limit(1);

    if (defaultOrg.length > 0) {
      req.organizationId = defaultOrg[0].organizationId;
      req.organizationSlug = defaultOrg[0].slug;
    }

    return next();
  } catch (error) {
    console.error('[TenantContext] Error in optional tenant context:', error);
    // Don't block the request, just continue without org context
    return next();
  }
};

/**
 * Helper to get user's organizations list (for org switcher UI)
 */
export async function getUserOrganizations(userId: string) {
  return db
    .select({
      organizationId: userOrganizations.organizationId,
      role: userOrganizations.role,
      isDefault: userOrganizations.isDefault,
      name: organizations.name,
      slug: organizations.slug,
      type: organizations.type,
      status: organizations.status,
    })
    .from(userOrganizations)
    .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
    .where(eq(userOrganizations.userId, userId));
}

/**
 * Helper to set a user's default organization
 */
export async function setDefaultOrganization(userId: string, organizationId: string) {
  // First, unset current default
  await db
    .update(userOrganizations)
    .set({ isDefault: false })
    .where(eq(userOrganizations.userId, userId));
  
  // Then set the new default
  await db
    .update(userOrganizations)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(userOrganizations.userId, userId),
        eq(userOrganizations.organizationId, organizationId)
      )
    );
}

/**
 * Ensures a user has a membership in at least the default organization.
 * Call this after user creation/login to guarantee they have org access.
 */
export async function ensureUserOrganization(userId: string): Promise<string> {
  // Check if user already has any org membership
  const existing = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, userId))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0].organizationId;
  }
  
  // Create membership in default org
  await db
    .insert(userOrganizations)
    .values({
      userId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      role: 'member',
      isDefault: true,
    })
    .onConflictDoNothing();
  
  return DEFAULT_ORGANIZATION_ID;
}

/**
 * Portal Context Middleware
 * 
 * For customer portal requests, this middleware derives organizationId 
 * from the linked customer record instead of user_organizations.
 * 
 * Portal user flow:
 *   1. Authenticate user
 *   2. Look up customer by userId or email
 *   3. Use customer.organizationId as the tenant context
 *   4. Attach both organizationId and customerId to request
 */
export const portalContext: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user as any;
    
    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized - No user in session" });
    }

    // Look up customer by userId first (direct linkage)
    let customerRecord = await db
      .select()
      .from(customers)
      .where(eq(customers.userId, user.id))
      .limit(1);

    // Fallback: try by email if no direct linkage
    if (customerRecord.length === 0 && user.email) {
      customerRecord = await db
        .select()
        .from(customers)
        .where(eq(customers.email, user.email))
        .limit(1);
    }

    if (customerRecord.length === 0) {
      return res.status(403).json({ 
        message: "No customer account found. Please contact support.",
        code: "NO_CUSTOMER_ACCOUNT"
      });
    }

    const customer = customerRecord[0];

    // Attach both organizationId and customerId to request
    req.organizationId = customer.organizationId;
    (req as any).portalCustomerId = customer.id;
    (req as any).portalCustomer = customer;

    return next();
  } catch (error) {
    console.error('[PortalContext] Error resolving customer context:', error);
    return res.status(500).json({ message: "Failed to resolve customer context" });
  }
};

/**
 * Helper to get portal customer from request
 */
export function getPortalCustomer(req: Request): { id: string; organizationId: string } | null {
  const portalCustomerId = (req as any).portalCustomerId;
  const organizationId = req.organizationId;
  
  if (!portalCustomerId || !organizationId) {
    return null;
  }
  
  return { id: portalCustomerId, organizationId };
}
