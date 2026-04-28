import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { promises as fsPromises } from "fs";
import { randomUUID } from "crypto";
import { evaluate } from "mathjs";
import { storage } from "./storage";
import { db, hasQuoteAttachmentPagesTable } from "./db";
import { orders, invoices, invoiceLineItems, insertMaterialSchema, updateMaterialSchema, insertInventoryAdjustmentSchema, materials, inventoryAdjustments, orderMaterialUsage, inventoryReservations, organizations, userOrganizations, customerVisibleProducts, productVariants, quoteAttachments, quoteAttachmentPages, orderAttachments, customerContacts, quoteLineItems, orderLineItems, globalVariables, auditLogs, orderStatusPills, jobs, productionJobs, productionEvents, quoteListNotes, bugReports, lineItemFiles } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, asc, inArray, notInArray, or, sql } from "drizzle-orm";
import * as localAuth from "./localAuth";
import * as replitAuth from "./replitAuth";
import { ensureCustomerForUser } from "./db/syncUsersToCustomers";
import { tenantContext, getRequestOrganizationId } from "./tenantContext";
import { registerQuoteRoutes } from "./routes/quotes.routes";
import { registerProductRoutes } from "./routes/products.routes";
import { registerAttachmentRoutes } from "./routes/attachments.routes";
import { registerOrderRoutes } from "./routes/orders.routes";
import { registerPrepressRoutes } from "./prepress/routes";
import { registerPlatformRoutes } from "./routes/platform";
import { registerInviteRoutes } from "./routes/invites";
import { registerMeRoutes } from "./routes/me";
import { registerBugReportRoutes } from "./routes/bugReports";
import { registerProofingRoutes } from "./routes/proofing.routes";
import { registerPortalProofRoutes } from "./routes/portalProof.routes";
import { registerProductionConfigRoutes } from "./routes/productionConfig.routes";
import { registerProductionJobsRoutes } from "./routes/productionJobs.routes";
import { registerDesignRoutes } from "./routes/design.routes";
import { registerPrepressQueueRoutes } from "./routes/prepress.routes";
import { registerPrepressFileRoutes } from "./routes/prepressFiles.routes";
import { canonicalFileReadResolver } from "./services/storage/CanonicalFileReadResolver";
import { deleteStoredObjectKeys } from "./services/storage/deleteStoredObjectKeys";
import { stationResolver } from "./services/stations/stationResolver";
import { routeLineItemToProduction } from "./services/productionRoutingService";
import { fileDerivativeRepository } from "./storage/fileDerivative.repo";

// Auth provider selection logic
// Priority: AUTH_PROVIDER env var > detection logic
// In production (Railway), default to standard/password auth (localAuth)
// replitAuth only used when explicitly on Replit platform (REPL_ID present)
const nodeEnv = (process.env.NODE_ENV || '').trim();
const authProviderEnv = (process.env.AUTH_PROVIDER || '').trim().toLowerCase();
const isReplit = !!process.env.REPL_ID;
const isProduction = nodeEnv === 'production';

let authProvider: string;
let auth: typeof localAuth | typeof replitAuth;


if (authProviderEnv) {
  // Explicit AUTH_PROVIDER env var takes precedence
  if (authProviderEnv === 'replit' && !isProduction && isReplit) {
    authProvider = 'replit';
    auth = replitAuth;
  } else if (authProviderEnv === 'standard' || authProviderEnv === 'password') {
    authProvider = 'standard';
    auth = localAuth;
  } else if (authProviderEnv === 'dev') {
    authProvider = 'dev';
    auth = localAuth;
  } else {
    // Invalid AUTH_PROVIDER, fallback to safe default
    authProvider = isProduction ? 'standard' : 'dev';
    auth = localAuth;
    console.warn(`[Auth] Invalid AUTH_PROVIDER="${authProviderEnv}", using ${authProvider}`);
  }
} else {
  // Auto-detection logic
  if (isProduction) {
    // Production: never use replitAuth on Railway
    // Use standard password auth
    authProvider = 'standard';
    auth = localAuth;
  } else if (isReplit) {
    // Development on Replit platform
    authProvider = 'replit';
    auth = replitAuth;
  } else {
    // Local development
    authProvider = 'dev';
    auth = localAuth;
  }
}

console.log(`[Auth] Selected provider: ${authProvider} (NODE_ENV=${nodeEnv}, REPL_ID=${isReplit ? 'present' : 'absent'})`);

// hasLoggedPrepressStorageAuthMode moved to ./routes/prepressFiles.routes.ts

const { setupAuth, isAuthenticated, isAdmin } = auth;

// Role-based access control middleware
const isOwner = (req: any, res: any, next: any) => {
  if (req.user?.role === 'owner') {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Owner role required." });
};

const isAdminOrOwner = (req: any, res: any, next: any) => {
  if (req.user?.role === 'owner' || req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admin or Owner role required." });
};

// Org-scoped permission helpers.
// NOTE: user_organizations.role is the authoritative org-scoped role.
// users.role / users.is_admin are global identity fields only.
import { canInviteOrgUsers } from './lib/orgPermissions';

// Org-scoped owner/admin check - requires tenantContext middleware.
// Attaches req.actorOrgRole for use in downstream route handlers.
const requireOrgOwnerAdmin = async (req: any, res: any, next: any) => {
  try {
    const userId = getUserId(req.user);
    const organizationId = getRequestOrganizationId(req);

    if (!userId || !organizationId) {
      return res.status(403).json({ message: "Missing authentication or organization context" });
    }

    const [membership] = await db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ message: "Access denied. Organization Owner or Admin role required." });
    }

    // Attach org-scoped role for use in handlers without a second DB lookup
    req.actorOrgRole = membership.role;
    next();
  } catch (error) {
    console.error('Error in requireOrgOwnerAdmin middleware:', error);
    return res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Org-scoped invite check: owner, admin, and manager may invite users.
// member cannot. Fails closed for unknown roles.
// Attaches req.actorOrgRole for downstream role-assignment guardrails.
const requireOrgCanInvite = async (req: any, res: any, next: any) => {
  try {
    const userId = getUserId(req.user);
    const organizationId = getRequestOrganizationId(req);

    if (!userId || !organizationId) {
      return res.status(403).json({ message: "Missing authentication or organization context" });
    }

    const [membership] = await db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!membership || !canInviteOrgUsers(membership.role)) {
      return res.status(403).json({ message: "Access denied. Organization Owner, Admin, or Manager role required." });
    }

    // Attach org-scoped role for role-assignment guardrails in the invite handler
    req.actorOrgRole = membership.role;
    next();
  } catch (error) {
    console.error('Error in requireOrgCanInvite middleware:', error);
    return res.status(500).json({ message: "Failed to verify permissions" });
  }
};

import {
  insertOrderSchema,
  updateOrderSchema,
  insertOrderLineItemSchema,
  updateOrderLineItemSchema,
  type InsertOrder,
  type InsertOrderLineItem,
  insertInvoiceSchema,
  updateInvoiceSchema,
  insertInvoiceLineItemSchema,
  updateInvoiceLineItemSchema,
  insertPaymentSchema,
  updatePaymentSchema,
} from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { SupabaseStorageService, isSupabaseConfigured } from "./supabaseStorage";
import { storageApplicationService } from "./services/storage/StorageApplicationService";
import { registerMvpInvoicingRoutes } from './routes/mvpInvoicing.routes';
import { registerFulfillmentRoutes } from './routes/fulfillment.routes';
import { registerOrderLineItemFileRoutes } from './routes/orderLineItemFiles.routes';
import { registerQuoteLineItemFileRoutes } from './routes/quoteLineItemFiles.routes';
import { registerQuickBooksRoutes } from './routes/quickbooks.routes';
import { registerProcurementRoutes } from './routes/procurement.routes';
import { registerStripeRoutes } from './routes/stripe.routes';
import { registerCatalogSettingsRoutes } from './routes/catalogSettings.routes';
import { registerAdminStorageRoutes } from './routes/adminStorage.routes';
import { registerPricingRoutes } from './routes/pricing.routes';
import { registerEmailRoutes } from './routes/email.routes';
import { registerJobsRoutes } from './routes/jobs.routes';
import { registerTimelineRoutes } from './routes/timeline.routes';
import { registerOrganizationRoutes } from './routes/organization.routes';
import { registerUsersRoutes } from './routes/users.routes';
import { registerCompanySettingsRoutes } from './routes/companySettings.routes';
import { registerCustomerRelationsRoutes } from './routes/customerRelations.routes';
import { registerCustomerRoutes } from './routes/customers.routes';
import { registerImportJobRoutes } from './routes/importJobs.routes';
import { registerSystemRoutes } from './routes/system.routes';
import { registerAuthRoutes } from './routes/auth.routes';
import { registerSearchRoutes } from './routes/search.routes';
import { registerDebugRoutes } from './routes/debug.routes';

// Helper function to get userId from request user object
// Handles both Replit auth (claims.sub) and local auth (id) formats
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

// Local JSON typing helpers (BannerOptionKind, PriceMode, OptionConfig, etc.) moved to ./routes/products.routes.ts

// snapshotCustomerData moved to ./routes/quotes.routes.ts

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);

  // Dev-only debug: verify status pills exist per org/state
  if (nodeEnv === 'development') {
    try {
      const rows = await db
        .select({
          organizationId: orderStatusPills.organizationId,
          stateScope: orderStatusPills.stateScope,
          count: sql<number>`count(*)::int`,
        })
        .from(orderStatusPills)
        .groupBy(orderStatusPills.organizationId, orderStatusPills.stateScope)
        .orderBy(orderStatusPills.organizationId, orderStatusPills.stateScope);

      const summary = rows
        .map((r) => `${r.organizationId}:${r.stateScope}=${r.count}`)
        .join(' | ');
      console.log(`[StatusPills:DEV] counts ${summary || '(none)'}`);
    } catch (err) {
      console.warn('[StatusPills:DEV] failed to count pills:', err);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Quote Workflow (enterprise rule): Formal state machine enforcement
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  // Auth routes extracted to ./routes/auth.routes.ts (do NOT re-add here)
  registerAuthRoutes(app, { isAuthenticated });

  // Public invite routes (no auth required — new-user accept-invite flow)
  registerInviteRoutes(app);

  // Platform-admin routes (step-up auth; org creation + bootstrap)
  registerPlatformRoutes(app);

  // Me routes (authenticated, not org-scoped — org list + active-org selection)
  registerMeRoutes(app);

  // Attachment routes extracted to ./routes/attachments.routes.ts (do NOT re-add here)
  await registerAttachmentRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Order routes extracted to ./routes/orders.routes.ts (do NOT re-add here)
  await registerOrderRoutes(app, { isAuthenticated, tenantContext, isAdmin, isAdminOrOwner });

  // MVP Invoicing + Payments routes extracted to ./routes/mvpInvoicing.routes.ts (do NOT re-add here)
  await registerMvpInvoicingRoutes(app, { isAuthenticated, tenantContext });

  // Bug report routes extracted to ./routes/bugReports.ts (do NOT re-add here)
  registerBugReportRoutes(app, { isAuthenticated, tenantContext });

  // Admin Storage Settings routes extracted to ./routes/adminStorage.routes.ts (do NOT re-add here)

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Object storage routes moved to ./routes/attachments.routes.ts
  // (GET /objects/:objectPath, POST /api/objects/upload, POST /api/objects/acl)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Product Types routes extracted to ./routes/catalogSettings.routes.ts (do NOT re-add here)

  // Product routes extracted to ./routes/products.routes.ts (do NOT re-add here)
  // PBV2 pricing-preview routes restored and extracted to ./routes/products.routes.ts
  registerProductRoutes(app, { isAuthenticated, isAdmin, isAdminOrOwner, requireOrgOwnerAdmin, tenantContext });


  // Global Variables routes extracted to ./routes/catalogSettings.routes.ts (do NOT re-add here)

  // Pricing Formulas routes extracted to ./routes/pricing.routes.ts (do NOT re-add here)

  // Quote routes extracted to ./routes/quotes.routes.ts (do NOT re-add here)
  registerQuoteRoutes(app, { isAuthenticated, isAdmin, tenantContext });


  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Quote Files / Attachments
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Helper: Enrich attachment records with signed URLs for display
   * 
   * IMPORTANT: fileUrl, thumbKey, previewKey are STORAGE KEYS (not URLs).
   * The client must NEVER use these fields directly in <img src> or <a href>.
   * This function generates time-limited signed URLs from storage keys.
   * 
   * Returns originalUrl, thumbUrl (if thumbKey exists), previewUrl (if previewKey exists)
   * For PDFs, also fetches and enriches page data with signed URLs
   */


  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Quote file/attachment routes moved to ./routes/attachments.routes.ts
  // (GET/POST/DELETE /api/quotes/:id/files, chunked uploads, /api/quotes/:quoteId/attachments)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Quote line item file routes extracted to ./routes/quoteLineItemFiles.routes.ts (do NOT re-add here)
  registerQuoteLineItemFileRoutes(app, { isAuthenticated, tenantContext });

  // Admin quote routes extracted to ./routes/quotes.routes.ts (do NOT re-add here)

  // Pricing Rules + Formula Templates routes extracted to ./routes/pricing.routes.ts (do NOT re-add here)

  // Email Settings + Email Sending routes extracted to ./routes/email.routes.ts (do NOT re-add here)

  // Timeline + Audit Logs routes extracted to ./routes/timeline.routes.ts (do NOT re-add here)

  // Customer Contacts, Notes, and Credit Transactions routes extracted to ./routes/customerRelations.routes.ts (do NOT re-add here)

  // Global Search route extracted to ./routes/search.routes.ts (do NOT re-add here)
  registerSearchRoutes(app, { isAuthenticated, tenantContext });

  // Debug routes extracted to ./routes/debug.routes.ts (do NOT re-add here)
  registerDebugRoutes(app, { isAuthenticated });

  const assertInternalUser = (req: any, res: any) => {
    const role = req.user?.role || "";
    if (role === "customer") {
      res.status(403).json({ error: "Access denied" });
      return false;
    }
    return true;
  };

  // Proofing routes extracted to ./routes/proofing.routes.ts (do NOT re-add here)
  registerProofingRoutes(app, { isAuthenticated, tenantContext, isAdmin, assertInternalUser });
  // Portal proof routes extracted to ./routes/portalProof.routes.ts (do NOT re-add here)
  registerPortalProofRoutes(app);
  // Production config routes extracted to ./routes/productionConfig.routes.ts (do NOT re-add here)
  registerProductionConfigRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser });
  // Production jobs routes extracted to ./routes/productionJobs.routes.ts (do NOT re-add here)
  registerProductionJobsRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser });
  // Design queue routes extracted to ./routes/design.routes.ts (do NOT re-add here)
  registerDesignRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser });
  // Prepress queue routes extracted to ./routes/prepress.routes.ts (do NOT re-add here)
  registerPrepressQueueRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser });
  // Prepress file transport routes extracted to ./routes/prepressFiles.routes.ts (do NOT re-add here)
  registerPrepressFileRoutes(app, { isAuthenticated, tenantContext, assertInternalUser });

  // Job Status Config + Line Item Workflow Transition + Jobs routes extracted to ./routes/jobs.routes.ts (do NOT re-add here)

  // Prepress file transport routes extracted to ./routes/prepressFiles.routes.ts (do NOT re-add here)

  // Payment routes extracted to ./routes/mvpInvoicing.routes.ts (do NOT re-add here)

  // Fulfillment/shipment routes extracted to ./routes/fulfillment.routes.ts (do NOT re-add here)
  registerFulfillmentRoutes(app, { isAuthenticated, tenantContext });

  // Order line item file routes extracted to ./routes/orderLineItemFiles.routes.ts (do NOT re-add here)
  registerOrderLineItemFileRoutes(app, { isAuthenticated, tenantContext });

  // Vendor and purchase order routes extracted to ./routes/procurement.routes.ts (do NOT re-add here)
  registerProcurementRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner });

  // QuickBooks integration routes extracted to ./routes/quickbooks.routes.ts (do NOT re-add here)
  registerQuickBooksRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner });

  // Stripe Connect integration routes extracted to ./routes/stripe.routes.ts (do NOT re-add here)
  registerStripeRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner });

  // Product Types + Global Variables routes extracted to ./routes/catalogSettings.routes.ts (do NOT re-add here)
  registerCatalogSettingsRoutes(app, { isAuthenticated, tenantContext, isAdmin, requireOrgOwnerAdmin });

  // Admin Storage Settings routes extracted to ./routes/adminStorage.routes.ts (do NOT re-add here)
  registerAdminStorageRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Pricing Formulas, Pricing Rules, Formula Templates routes extracted to ./routes/pricing.routes.ts (do NOT re-add here)
  registerPricingRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Email Settings + Email Sending routes extracted to ./routes/email.routes.ts (do NOT re-add here)
  registerEmailRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Job Status Config + Line Item Workflow Transition + Jobs routes extracted to ./routes/jobs.routes.ts (do NOT re-add here)
  registerJobsRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin, assertInternalUser });

  // Timeline + Audit Logs routes extracted to ./routes/timeline.routes.ts (do NOT re-add here)
  registerTimelineRoutes(app, { isAuthenticated, tenantContext, isOwner });

  // Organization, List Settings, Org Danger Zone routes extracted to ./routes/organization.routes.ts (do NOT re-add here)
  registerOrganizationRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });

  // Users + Admin Users routes extracted to ./routes/users.routes.ts (do NOT re-add here)
  registerUsersRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin, requireOrgCanInvite, isAdminOrOwner });

  // Company Settings routes extracted to ./routes/companySettings.routes.ts (do NOT re-add here)
  registerCompanySettingsRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });
  registerCustomerRelationsRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Customers + Enterprise Import Jobs routes extracted to ./routes/customers.routes.ts and ./routes/importJobs.routes.ts (do NOT re-add here)
  registerCustomerRoutes(app, { isAuthenticated, tenantContext, isAdmin });
  registerImportJobRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Health, Dashboard, Media, and System Status routes extracted to ./routes/system.routes.ts (do NOT re-add here)
  registerSystemRoutes(app, { isAuthenticated, tenantContext, isAdmin });


  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // API catch-all: Prevent HTML fallback for unknown API routes
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  const httpServer = createServer(app);

  return httpServer;
}
