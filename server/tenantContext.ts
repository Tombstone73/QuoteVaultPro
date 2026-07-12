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
import { userOrganizations, organizations, users } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import { getActivePortalContext, isPortalCustomerIdentity } from './services/customerPortalAccessService';
import {
  type StaffPortalPreviewSession,
  resolveActiveStaffPortalPreview,
} from './services/staffPortalPreviewService';

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
      portalCustomerId?: string;
      portalCustomer?: unknown;
      portalAccess?: unknown;
      staffPortalPreview?: StaffPortalPreviewSession;
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
 * Portal users are intentionally blocked here and must use portalContext.
 */
export const tenantContext: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user as any;
    
    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized - No user in session" });
    }

    if (isPortalCustomerIdentity(user)) {
      return res.status(403).json({
        success: false,
        code: "PORTAL_CUSTOMER_INTERNAL_ACCESS_DENIED",
        message: "Customer portal users cannot access internal TitanOS APIs.",
      });
    }

    // Check if org is specified in header (for org switching)
    const headerOrgId = req.headers['x-organization-id'] as string;
    
    if (headerOrgId) {
      // Verify user has access to this organization
      const membership = await db
        .select({
          role: userOrganizations.role,
          deleteState: organizations.deleteState,
          isArchived: organizations.isArchived,
        })
        .from(userOrganizations)
        .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
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

      // Block access to soft-deleted or pending-delete orgs
      if (membership[0].deleteState !== 'active' || membership[0].isArchived) {
        return res.status(403).json({ 
          code: 'ORG_DISABLED_OR_DELETED',
          message: "This organization is not accessible",
          deleteState: membership[0].deleteState,
          isArchived: membership[0].isArchived,
        });
      }
      
      req.organizationId = headerOrgId;
      req.orgRole = membership[0].role;
      return next();
    }

    // 2. Check users.last_active_org_id — persisted choice survives session restarts
    const [userRow] = await db
      .select({ lastActiveOrgId: users.lastActiveOrgId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (userRow?.lastActiveOrgId) {
      const [lastActiveMembership] = await db
        .select({
          organizationId: userOrganizations.organizationId,
          slug: organizations.slug,
          orgRole: userOrganizations.role,
          deleteState: organizations.deleteState,
          isArchived: organizations.isArchived,
        })
        .from(userOrganizations)
        .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
        .where(
          and(
            eq(userOrganizations.userId, user.id),
            eq(userOrganizations.organizationId, userRow.lastActiveOrgId)
          )
        )
        .limit(1);

      if (lastActiveMembership) {
        // Block access to soft-deleted or pending-delete orgs
        if (lastActiveMembership.deleteState !== 'active' || lastActiveMembership.isArchived) {
          return res.status(403).json({ 
            code: 'ORG_DISABLED_OR_DELETED',
            message: "This organization is not accessible",
            deleteState: lastActiveMembership.deleteState,
            isArchived: lastActiveMembership.isArchived,
          });
        }

        req.organizationId = lastActiveMembership.organizationId;
        req.organizationSlug = lastActiveMembership.slug;
        req.orgRole = lastActiveMembership.orgRole;
        return next();
      }
      // last_active_org_id is stale (org deleted / membership removed) — fall through
    }

    // 3. Get user's default organization (isDefault=true — backward compat)
    const defaultOrg = await db
      .select({
        organizationId: userOrganizations.organizationId,
        slug: organizations.slug,
        orgRole: userOrganizations.role,
        deleteState: organizations.deleteState,
        isArchived: organizations.isArchived,
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
      // Block access to soft-deleted or pending-delete orgs
      if (defaultOrg[0].deleteState !== 'active' || defaultOrg[0].isArchived) {
        return res.status(403).json({ 
          code: 'ORG_DISABLED_OR_DELETED',
          message: "This organization is not accessible",
          deleteState: defaultOrg[0].deleteState,
          isArchived: defaultOrg[0].isArchived,
        });
      }

      req.organizationId = defaultOrg[0].organizationId;
      req.organizationSlug = defaultOrg[0].slug;
      req.orgRole = defaultOrg[0].orgRole;
      return next();
    }

    // 4. If user has exactly one org membership, auto-select and persist it
    const allOrgs = await db
      .select({
        organizationId: userOrganizations.organizationId,
        slug: organizations.slug,
        orgRole: userOrganizations.role,
        deleteState: organizations.deleteState,
        isArchived: organizations.isArchived,
      })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(eq(userOrganizations.userId, user.id));

    // Filter out soft-deleted/pending orgs
    const activeOrgs = allOrgs.filter(o => o.deleteState === 'active' && !o.isArchived);

    if (activeOrgs.length === 1) {
      req.organizationId = activeOrgs[0].organizationId;
      req.organizationSlug = activeOrgs[0].slug;
      req.orgRole = activeOrgs[0].orgRole;
      // Persist so subsequent requests skip this logic
      await db
        .update(users)
        .set({ lastActiveOrgId: activeOrgs[0].organizationId })
        .where(eq(users.id, user.id))
        .catch((e) => console.error('[TenantContext] Failed to persist lastActiveOrgId:', e));
      return next();
    }

    if (activeOrgs.length > 1) {
      // Multiple orgs — user must pick one
      return res.status(409).json({
        success: false,
        code: 'ORG_SELECTION_REQUIRED',
        message: 'Please select an organization to continue.',
      });
    }

    // 5. Auto-provision: dev/test safety net — creates membership in default org
    // In production, this indicates a data integrity issue (user with 0 memberships);
    // return ORG_SELECTION_REQUIRED so the UI can guide them.
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[TenantContext] User ${user.id} has no org membership in production — returning ORG_SELECTION_REQUIRED`);
      return res.status(409).json({
        success: false,
        code: 'ORG_SELECTION_REQUIRED',
        message: 'Please select an organization to continue.',
      });
    }

    console.warn(`[TenantContext] User ${user.id} has no organization membership - auto-provisioning to default org (dev/test only)`);
    
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

    if (!isPortalCustomerIdentity(user)) {
      try {
        const previewContext = await resolveActiveStaffPortalPreview(req);

        if (!previewContext) {
          return res.status(403).json({
            success: false,
            code: "STAFF_PORTAL_PREVIEW_REQUIRED",
            message: "Staff portal preview is not active.",
          });
        }

        req.organizationId = previewContext.customer.organizationId;
        req.portalCustomerId = previewContext.customer.id;
        req.portalCustomer = previewContext.customer;
        req.portalAccess = null;
        req.staffPortalPreview = previewContext.preview;

        return next();
      } catch (previewError) {
        const status = typeof (previewError as any)?.status === "number" ? (previewError as any).status : 500;
        const code = typeof (previewError as any)?.code === "string" ? (previewError as any).code : undefined;
        const message = previewError instanceof Error ? previewError.message : "Staff portal preview failed";
        return res.status(status).json({
          success: false,
          code,
          message: status >= 500 ? "Failed to resolve staff portal preview context" : message,
        });
      }
    }

    const portalContextRecord = await getActivePortalContext(user.id);

    if (!portalContextRecord) {
      return res.status(403).json({ 
        message: "No active customer portal access found. Please contact support.",
        code: "NO_ACTIVE_PORTAL_ACCESS"
      });
    }

    const customer = portalContextRecord.customer;

    // Attach both organizationId and customerId to request
    req.organizationId = customer.organizationId;
    req.portalCustomerId = customer.id;
    req.portalCustomer = customer;
    req.portalAccess = portalContextRecord.access;

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
