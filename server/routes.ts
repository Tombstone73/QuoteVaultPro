import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { promises as fsPromises } from "fs";
import { randomUUID } from "crypto";
import { evaluate } from "mathjs";
import Papa from "papaparse";
import { storage } from "./storage";
import { db, hasQuoteAttachmentPagesTable } from "./db";
import { customers, users, quotes, orders, invoices, invoiceLineItems, insertMaterialSchema, updateMaterialSchema, insertInventoryAdjustmentSchema, materials, inventoryAdjustments, orderMaterialUsage, inventoryReservations, organizations, userOrganizations, customerVisibleProducts, products, pbv2TreeVersions, productVariants, productTypes, quoteAttachments, quoteAttachmentPages, orderAttachments, customerContacts, quoteLineItems, orderLineItems, globalVariables, auditLogs, orderStatusPills, jobs, productionJobs, productionEvents, quoteListNotes, assets, assetLinks, assetVariants, bugReports, lineItemFiles, insertProductDesignConfigSchema } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, asc, inArray, notInArray, or, sql } from "drizzle-orm";
import * as localAuth from "./localAuth";
import * as replitAuth from "./replitAuth";
import { ensureCustomerForUser } from "./db/syncUsersToCustomers";
import { tenantContext, getRequestOrganizationId } from "./tenantContext";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput } from "./quoteOrderPricing";
import {
  getEffectiveWorkflowState,
  isValidTransition,
  getTransitionBlockReason,
  workflowStateToDb,
  isQuoteLocked,
  DB_TO_WORKFLOW,
  WORKFLOW_TO_DB,
  type QuoteStatusDB,
  type QuoteWorkflowState,
  type TransitionRequest,
  transitionRequestSchema,
  APPROVED_LOCK_MESSAGE,
  CONVERTED_LOCK_MESSAGE,
} from "@shared/quoteWorkflow";
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
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { readPbv2OverrideConfig, writePbv2OverrideConfig } from "./lib/pbv2OverrideConfig";
import { createLineItemFileRecord } from "./services/lineItemFileRecordService";
import { canonicalFileReadResolver } from "./services/storage/CanonicalFileReadResolver";
import { deleteStoredObjectKeys } from "./services/storage/deleteStoredObjectKeys";
import { stationResolver } from "./services/stations/stationResolver";
import { routeLineItemToProduction } from "./services/productionRoutingService";
import { fileDerivativeRepository } from "./storage/fileDerivative.repo";
import { fileRecordRepository } from "./storage/fileRecord.repo";
import { productDesignConfigRepository } from "./storage/productDesignConfig.repo";

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

function toLegacyStorageProvider(provider: string | null | undefined): "local" | "s3" | "gcs" | "supabase" | null {
  if (provider === "local" || provider === "s3" || provider === "gcs" || provider === "supabase") {
    return provider;
  }
  return null;
}

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

// Org-scoped owner/admin check - requires tenantContext middleware
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
    
    next();
  } catch (error) {
    console.error('Error in requireOrgOwnerAdmin middleware:', error);
    return res.status(500).json({ message: "Failed to verify permissions" });
  }
};

import {
  insertProductSchema,
  updateProductSchema,
  insertQuoteSchema,
  insertProductOptionSchema,
  updateProductOptionSchema,
  insertProductVariantSchema,
  updateProductVariantSchema,
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
  type InsertProduct,
  type UpdateProduct
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
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
  scheduleSupabaseObjectSelfCheck,
  tryExtractSupabaseObjectKeyFromUrl
} from "./lib/supabaseObjectHelpers";
import type { FileRole, FileSide } from "./lib/supabaseObjectHelpers";
import { registerMvpInvoicingRoutes } from './routes/mvpInvoicing.routes';
import { registerFulfillmentRoutes } from './routes/fulfillment.routes';
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

// Helper function to get userId from request user object
// Handles both Replit auth (claims.sub) and local auth (id) formats
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

// ---------------------------------------------------------------------------
// Local JSON typing helpers (do NOT touch shared/schema.ts)
// ---------------------------------------------------------------------------



type BannerOptionKind =
  | "grommets"
  | "sides"
  | "generic"
  | "hems"
  | "pole_pockets"
  | "thickness";

type PriceMode =
  | "flat"
  | "per_qty"
  | "per_sqft"
  | "flat_per_item"
  | "percent_of_base";

type PercentBase = "media" | "line";

interface BaseOptionConfig {
  locations?: Array<"custom" | "all_corners" | "top_corners" | "top_even">;
  defaultLocation?: "custom" | "all_corners" | "top_corners" | "top_even";
  defaultSpacingCount?: number;
  customNotes?: string;
  singleLabel?: string;
  doubleLabel?: string;
  doublePriceMultiplier?: number;
}

type NoKindConfig = BaseOptionConfig & { kind?: undefined };

interface GrommetsConfig extends BaseOptionConfig {
  kind: "grommets";
}

interface GenericConfig extends BaseOptionConfig {
  kind: "generic";
}

interface HemsConfig extends BaseOptionConfig {
  kind: "hems";
  defaultHems?: string;
}

interface PolePocketsConfig extends BaseOptionConfig {
  kind: "pole_pockets";
  defaultPolePocket?: string;
}

interface ThicknessConfig extends BaseOptionConfig {
  kind: "thickness";
  pricingMode?: "multiplier" | "volume";
  thicknessVariants?: Array<{
    key: string;
    label?: string;
    materialId?: string;
    pricingMode?: "multiplier" | "volume";
    priceMultiplier?: number;
    volumeTiers?: Array<{
      minSheets: number;
      maxSheets?: number | null;
      pricePerSheet: string | number;
    }>;
  }>;
}

interface SidesConfig extends BaseOptionConfig {
  kind: "sides";
  pricingMode?: "multiplier" | "volume";
  volumeTiers?: Array<{
    minSheets: number;
    maxSheets?: number | null;
    singlePricePerSheet: string | number;
    doublePricePerSheet: string | number;
  }>;
}

type OptionConfig =
  | NoKindConfig
  | GenericConfig
  | GrommetsConfig
  | HemsConfig
  | PolePocketsConfig
  | ThicknessConfig
  | SidesConfig;

interface MaterialAddonConfig {
  materialId: string;
  unitType: "sheet" | "sqft" | "linear_ft";
  usageBasis: "same_area" | "same_sheets";
  wasteFactor?: number;
  percentBase?: PercentBase;
}

interface PricingOptionJson {
  id: string;
  label: string;
  type: "select" | "quantity" | "checkbox" | "toggle";
  priceMode: PriceMode;
  amount?: number;
  defaultSelected?: boolean;
  config?: OptionConfig;
  materialAddonConfig?: MaterialAddonConfig;
  percentBase?: PercentBase;
}

/**
 * Snapshot customer data for quotes and orders
 * Fetches customer (and optional contact) and builds billTo and shipTo snapshot fields
 * 
 * @param organizationId - Organization ID for multi-tenant filtering
 * @param customerId - Customer ID to fetch
 * @param contactId - Optional contact ID to use for billTo name
 * @param shippingMethod - 'pickup' | 'ship' | 'deliver' (defaults to 'ship')
 * @param shippingMode - 'single_shipment' | 'multi_shipment' (defaults to 'single_shipment')
 * @returns Snapshot object with billTo and shipTo fields, shippingMethod, shippingMode
 */
async function snapshotCustomerData(
  organizationId: string,
  customerId: string,
  contactId?: string | null,
  shippingMethod?: string | null,
  shippingMode?: string | null
): Promise<Record<string, any>> {
  // Fetch customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(
      eq(customers.id, customerId),
      eq(customers.organizationId, organizationId)
    ))
    .limit(1);

  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  // Optionally fetch contact
  let contact = null;
  if (contactId) {
    const [foundContact] = await db
      .select()
      .from(customerContacts as any)
      .where(eq((customerContacts as any).id, contactId))
      .limit(1);
    contact = foundContact;
  }

  // Build billTo snapshot
  const billToName = contact
    ? `${contact.firstName} ${contact.lastName}`.trim()
    : customer.companyName;

  const billToSnapshot = {
    billToName,
    billToCompany: customer.companyName,
    billToAddress1: customer.billingStreet1 || customer.billingAddress || null,
    billToAddress2: customer.billingStreet2 || null,
    billToCity: customer.billingCity || null,
    billToState: customer.billingState || null,
    billToPostalCode: customer.billingPostalCode || null,
    billToCountry: customer.billingCountry || 'US',
    billToPhone: customer.phone || null,
    billToEmail: customer.email || null,
  };

  // Determine shipping method
  const finalShippingMethod = shippingMethod || 'ship';
  const finalShippingMode = shippingMode || 'single_shipment';

  // Build shipTo snapshot
  let shipToSnapshot: Record<string, any>;

  if (finalShippingMethod === 'pickup') {
    // For pickup, mirror billTo address
    shipToSnapshot = {
      shipToName: billToName,
      shipToCompany: customer.companyName,
      shipToAddress1: customer.billingStreet1 || customer.billingAddress || null,
      shipToAddress2: customer.billingStreet2 || null,
      shipToCity: customer.billingCity || null,
      shipToState: customer.billingState || null,
      shipToPostalCode: customer.billingPostalCode || null,
      shipToCountry: customer.billingCountry || 'US',
      shipToPhone: customer.phone || null,
      shipToEmail: customer.email || null,
    };
  } else {
    // For ship/deliver, use shipping address if available, fall back to billing
    const hasShippingAddress = !!customer.shippingStreet1 || !!customer.shippingAddress;

    shipToSnapshot = {
      shipToName: billToName,
      shipToCompany: customer.companyName,
      shipToAddress1: hasShippingAddress
        ? (customer.shippingStreet1 || customer.shippingAddress || null)
        : (customer.billingStreet1 || customer.billingAddress || null),
      shipToAddress2: hasShippingAddress
        ? (customer.shippingStreet2 || null)
        : (customer.billingStreet2 || null),
      shipToCity: hasShippingAddress
        ? (customer.shippingCity || null)
        : (customer.billingCity || null),
      shipToState: hasShippingAddress
        ? (customer.shippingState || null)
        : (customer.billingState || null),
      shipToPostalCode: hasShippingAddress
        ? (customer.shippingPostalCode || null)
        : (customer.billingPostalCode || null),
      shipToCountry: hasShippingAddress
        ? (customer.shippingCountry || 'US')
        : (customer.billingCountry || 'US'),
      shipToPhone: customer.phone || null,
      shipToEmail: customer.email || null,
    };
  }

  return {
    ...billToSnapshot,
    ...shipToSnapshot,
    shippingMethod: finalShippingMethod,
    shippingMode: finalShippingMode,
  };
}

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

  /**
   * Get effective workflow state for a quote
   */
  const getQuoteWorkflowState = (quote: any): QuoteWorkflowState => {
    const dbStatus = quote.status as QuoteStatusDB;
    const validUntil = quote.validUntil;
    const hasOrder = !!quote.convertedToOrderId;
    return getEffectiveWorkflowState(dbStatus, validUntil, hasOrder);
  };

  /**
   * Check if quote is locked (immutable)
   */
  const isQuoteLockedFn = (quote: any): boolean => {
    const state = getQuoteWorkflowState(quote);
    return isQuoteLocked(state);
  };

  /**
   * Assert quote is editable, return false and send error response if locked
   */
  const assertQuoteEditable = (res: any, quote: any): boolean => {
    const state = getQuoteWorkflowState(quote);
    if (isQuoteLocked(state)) {
      const message = state === 'approved' ? APPROVED_LOCK_MESSAGE : CONVERTED_LOCK_MESSAGE;
      res.status(409).json({ error: message });
      return false;
    }
    return true;
  };

  /**
   * Validate status transition, return false and send error if invalid
   */
  const assertValidTransition = (res: any, quote: any, newDbStatus: QuoteStatusDB): boolean => {
    const currentState = getQuoteWorkflowState(quote);
    const targetState = DB_TO_WORKFLOW[newDbStatus];

    if (!isValidTransition(currentState, targetState)) {
      const reason = getTransitionBlockReason(currentState, targetState);
      res.status(403).json({ error: reason });
      return false;
    }
    return true;
  };

  // Auth routes extracted to ./routes/auth.routes.ts (do NOT re-add here)
  registerAuthRoutes(app, { isAuthenticated });

  // Admin Storage Settings routes extracted to ./routes/adminStorage.routes.ts (do NOT re-add here)

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Object storage routes moved to ./routes/attachments.routes.ts
  // (GET /objects/:objectPath, POST /api/objects/upload, POST /api/objects/acl)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Product Types routes extracted to ./routes/catalogSettings.routes.ts (do NOT re-add here)

  app.get("/api/products", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const activeOnly = String(req.query.activeOnly ?? "").trim().toLowerCase();
      const products = await storage.getAllProducts(organizationId);
      res.json(
        activeOnly === "true" || activeOnly === "1"
          ? products.filter((product) => product.isActive)
          : products,
      );
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/csv-template", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const templateData = [
        { Type: 'PRODUCT', 'Product Name': 'Business Cards', 'Product Description': 'High-quality business cards', 'Pricing Formula': 'basePrice * quantity', 'Variant Label': 'Media Type', Category: 'Cards', 'Store URL': 'https://example.com/business-cards', 'Show Store Link': 'true', 'Thumbnail URLs': '', 'Is Active': 'true', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '13oz Vinyl', 'Variant Description': 'Durable vinyl material', 'Base Price Per Sqft': '0.0250', 'Is Default Variant': 'true', 'Variant Display Order': '1', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': 'Mesh', 'Variant Description': 'Windflow mesh material', 'Base Price Per Sqft': '0.0300', 'Is Default Variant': 'false', 'Variant Display Order': '2', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Lamination', 'Option Description': 'Add protective lamination', 'Option Type': 'toggle', 'Default Value': '', 'Default Selection': 'No Lamination', 'Is Default Enabled': 'false', 'Setup Cost': '25.00', 'Price Formula': 'quantity > 100 ? setupCost : setupCost * 1.5', 'Parent Option Name': '', 'Option Display Order': '1' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Grommets', 'Option Description': 'Add metal grommets', 'Option Type': 'select', 'Default Value': '', 'Default Selection': '4 Corners', 'Is Default Enabled': 'false', 'Setup Cost': '0', 'Price Formula': "setupCost + (selection === '4 Corners' ? 10 : selection === '8 Grommets' ? 20 : 0)", 'Parent Option Name': '', 'Option Display Order': '2' },
        { Type: 'OPTION', 'Product Name': 'Business Cards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': 'Rush Production', 'Option Description': 'Expedited production', 'Option Type': 'toggle', 'Default Value': '', 'Default Selection': 'No Rush', 'Is Default Enabled': 'false', 'Setup Cost': '50.00', 'Price Formula': 'setupCost', 'Parent Option Name': '', 'Option Display Order': '3' },
        { Type: 'PRODUCT', 'Product Name': 'Postcards', 'Product Description': 'Premium postcards', 'Pricing Formula': 'basePrice * quantity * 1.2', 'Variant Label': 'Paper Stock', Category: 'Cards', 'Store URL': 'https://example.com/postcards', 'Show Store Link': 'true', 'Thumbnail URLs': '', 'Is Active': 'true', 'Variant Name': '', 'Variant Description': '', 'Base Price Per Sqft': '', 'Is Default Variant': '', 'Variant Display Order': '', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Postcards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Thumbnail URLs': '', 'Is Active': '', 'Variant Name': 'Glossy', 'Variant Description': 'High gloss finish', 'Base Price Per Sqft': '0.0150', 'Is Default Variant': 'true', 'Variant Display Order': '1', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
        { Type: 'VARIANT', 'Product Name': 'Postcards', 'Product Description': '', 'Pricing Formula': '', 'Variant Label': '', Category: '', 'Store URL': '', 'Show Store Link': '', 'Is Active': '', 'Variant Name': 'Matte', 'Variant Description': 'Matte finish', 'Base Price Per Sqft': '0.0140', 'Is Default Variant': 'false', 'Variant Display Order': '2', 'Option Name': '', 'Option Description': '', 'Option Type': '', 'Default Value': '', 'Default Selection': '', 'Is Default Enabled': '', 'Setup Cost': '', 'Price Formula': '', 'Parent Option Name': '', 'Option Display Order': '' },
      ];

      const csv = Papa.unparse(templateData);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Error generating CSV template:", error);
      res.status(500).json({ message: "Failed to generate CSV template" });
    }
  });

  app.post("/api/products/import", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const { csvData } = req.body;
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: "CSV data is required" });
      }

      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        console.error("CSV parsing errors:", parseResult.errors);
        return res.status(400).json({
          message: "CSV parsing failed",
          errors: parseResult.errors.map(e => e.message)
        });
      }

      const rows = parseResult.data as Record<string, string>[];
      if (rows.length === 0) {
        return res.status(400).json({ message: "CSV must contain at least one data row" });
      }

      const productMap: Record<string, string> = {};
      const optionMap: Record<string, Record<string, string>> = {};

      let importedProducts = 0;
      let importedVariants = 0;
      let importedOptions = 0;

      for (const row of rows) {
        const type = row['Type']?.trim();
        const productName = row['Product Name']?.trim();

        if (!type || !productName) continue;

        if (type === 'PRODUCT') {
          const thumbnailUrlsRaw = row['Thumbnail URLs']?.trim() || '';
          const thumbnailUrls = thumbnailUrlsRaw
            ? thumbnailUrlsRaw.split('|').map(url => url.trim()).filter(url => url.length > 0)
            : [];

          type InsertProductWithoutOrgId = Omit<InsertProduct, "organizationId">;
          const insertPayload: InsertProductWithoutOrgId = {
            name: productName,
            description: row['Product Description']?.trim() || '',
            pricingProfileKey: "default",
            pricingMode: "area",
            isService: false,
            artworkPolicy: "not_required",
            requiresProductionJob: true,
            pricingFormula: row['Pricing Formula']?.trim() || 'basePrice * quantity',
            variantLabel: row['Variant Label']?.trim(),
            category: row['Category']?.trim(),
            storeUrl: row['Store URL']?.trim(),
            showStoreLink: row['Show Store Link']?.trim().toLowerCase() === 'true',
            thumbnailUrls,
            isActive: row['Is Active']?.trim().toLowerCase() !== 'false',
          };

          const newProduct = await storage.createProduct(organizationId, insertPayload);
          productMap[productName] = newProduct.id;
          importedProducts++;
        } else if (type === 'VARIANT') {
          const productId = productMap[productName];
          if (!productId) {
            console.warn(`Variant references unknown product: ${productName}`);
            continue;
          }

          await storage.createProductVariant({
            productId,
            name: row['Variant Name']?.trim() || '',
            description: row['Variant Description']?.trim() || null,
            basePricePerSqft: parseFloat(row['Base Price Per Sqft']?.trim() || '0'),
            isDefault: row['Is Default Variant']?.trim().toLowerCase() === 'true',
            displayOrder: parseInt(row['Variant Display Order']?.trim() || '0'),
          });
          importedVariants++;
        } else if (type === 'OPTION') {
          const productId = productMap[productName];
          if (!productId) {
            console.warn(`Option references unknown product: ${productName}`);
            continue;
          }

          if (!optionMap[productName]) {
            optionMap[productName] = {};
          }

          const optionName = row['Option Name']?.trim();
          const parentOptionName = row['Parent Option Name']?.trim();
          let parentOptionId = null;

          if (parentOptionName && optionMap[productName][parentOptionName]) {
            parentOptionId = optionMap[productName][parentOptionName];
          }

          const newOption = await storage.createProductOption({
            productId,
            name: optionName || '',
            description: row['Option Description']?.trim() || null,
            type: row['Option Type']?.trim() as 'toggle' | 'number' | 'select' || 'toggle',
            defaultValue: row['Default Value']?.trim() || null,
            defaultSelection: row['Default Selection']?.trim() || null,
            isDefaultEnabled: row['Is Default Enabled']?.trim().toLowerCase() === 'true',
            setupCost: parseFloat(row['Setup Cost']?.trim() || '0'),
            priceFormula: row['Price Formula']?.trim() || null,
            parentOptionId,
            displayOrder: parseInt(row['Option Display Order']?.trim() || '0'),
          });

          if (optionName) {
            optionMap[productName][optionName] = newOption.id;
          }
          importedOptions++;
        }
      }

      res.json({
        message: "Products imported successfully",
        imported: {
          products: importedProducts,
          variants: importedVariants,
          options: importedOptions,
        }
      });
    } catch (error) {
      console.error("Error importing products:", error);
      res.status(500).json({ message: "Failed to import products" });
    }
  });

  // ============================================================================
  // PBV2-Aware Product Import/Export (v2)
  // ============================================================================

  /**
   * GET /api/admin/products/export
   * Export all products with full PBV2 tree definitions
   * Org-scoped, admin-only
   */
  app.get("/api/admin/products/export", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const { exportProducts } = await import("./services/pbv2ExportMapper");

      // Fetch all products for org
      const allProducts = await db
        .select()
        .from(products)
        .where(eq(products.organizationId, organizationId))
        .orderBy(asc(products.name));

      // Fetch all PBV2 trees for these products
      const productIds = allProducts.map(p => p.id);
      const pbv2Trees = new Map<string, { active?: any; draft?: any }>();

      if (productIds.length > 0) {
        const allTreeVersions = await db
          .select()
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              inArray(pbv2TreeVersions.productId, productIds)
            )
          );

        for (const tree of allTreeVersions) {
          if (!pbv2Trees.has(tree.productId)) {
            pbv2Trees.set(tree.productId, {});
          }
          const entry = pbv2Trees.get(tree.productId)!;
          if (tree.status === "ACTIVE") entry.active = tree;
          if (tree.status === "DRAFT") entry.draft = tree;
        }
      }

      // Fetch reference data
      const [allProductTypes, allMaterials, org] = await Promise.all([
        db.select().from(productTypes).where(eq(productTypes.organizationId, organizationId)),
        db.select().from(materials).where(eq(materials.organizationId, organizationId)),
        db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
      ]);

      const exportData = await exportProducts(
        {
          db,
          organizationId,
          orgName: org[0]?.name,
        },
        allProducts,
        pbv2Trees,
        allProductTypes,
        allMaterials
      );

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId: userId || null,
        actionType: "EXPORT",
        entityType: "product",
        entityId: null,
        description: `Exported ${exportData.products.length} products`,
        newValues: { count: exportData.products.length },
      });

      res.json(exportData);
    } catch (error: any) {
      console.error("[Product Export] Error:", error);
      res.status(500).json({ error: error.message || "Failed to export products" });
    }
  });

  /**
   * POST /api/admin/products/import?dryRun=1|0
   * Import products with PBV2 trees
   * Org-scoped, admin-only
   */
  app.post("/api/admin/products/import", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
      const mode = (req.body.mode || "upsertBySlug") as any;

      const { productImportV2RequestSchema } = await import("@shared/importExportSchemas");
      const { buildImportPlan, applyImport } = await import("./services/pbv2ImportMapper");

      // Validate request body
      const validation = productImportV2RequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid import request",
          details: validation.error.errors,
        });
      }

      const importRequest = validation.data;

      if (!userId) {
        return res.status(403).json({ error: "User ID required" });
      }

      const ctx = {
        db,
        organizationId,
        userId,
        mode,
      };

      if (dryRun) {
        // Dry-run: validate and return plan
        const plan = await buildImportPlan(ctx, importRequest);

        // Audit log
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          actionType: "VALIDATE",
          entityType: "product",
          entityId: null,
          description: `Dry-run validation: ${plan.counts.total} products, ${plan.errors.length} errors`,
          newValues: {
            total: plan.counts.total,
            create: plan.counts.create,
            update: plan.counts.update,
            skip: plan.counts.skip,
            errorCount: plan.errors.length,
          },
        });

        res.json(plan);
      } else {
        // Apply import
        const result = await applyImport(ctx, importRequest);

        // Audit log
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          actionType: "IMPORT",
          entityType: "product",
          entityId: null,
          description: `Imported products: ${result.counts.created} created, ${result.counts.updated} updated, ${result.counts.failed} failed`,
          newValues: {
            total: result.counts.total,
            created: result.counts.created,
            updated: result.counts.updated,
            skipped: result.counts.skipped,
            failed: result.counts.failed,
          },
        });

        res.json(result);
      }
    } catch (error: any) {
      console.error("[Product Import] Error:", error);
      res.status(500).json({ error: error.message || "Failed to import products" });
    }
  });


  // ============================================================================
  // PBV2 (Product Builder v2) - Versioned Tree Lifecycle
  // ============================================================================

  app.get("/api/products/:productId/pbv2/tree", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      // Verify product exists
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      // Read DRAFT from pbv2_tree_versions table
      const [draft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      // Read ACTIVE tree using products.pbv2ActiveTreeVersionId
      let active = null;
      const [productWithActiveId] = await db
        .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (productWithActiveId?.pbv2ActiveTreeVersionId) {
        const [activeVersion] = await db
          .select()
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              eq(pbv2TreeVersions.id, productWithActiveId.pbv2ActiveTreeVersionId)
            )
          )
          .limit(1);
        active = activeVersion || null;
      }

      // LOG: What we found
      console.log('[PBV2_TREE_GET] rows found', { 
        orgId: organizationId,
        productId,
        draftFound: !!draft,
        draftId: draft?.id || null,
        activeFound: !!active,
        activeId: active?.id || null,
      });

      // DEV-ONLY: Log details
      if (process.env.NODE_ENV !== 'production') {
        if (draft) {
          const nodeCount = typeof draft.treeJson === 'object' && draft.treeJson ? Object.keys((draft.treeJson as any).nodes || {}).length : 0;
          const rootCount = Array.isArray((draft.treeJson as any).rootNodeIds) ? (draft.treeJson as any).rootNodeIds.length : 0;
          console.log(`[GET /api/products/${productId}/pbv2/tree] DRAFT:`, {
            draftId: draft.id,
            nodeCount,
            rootCount,
            schemaVersion: (draft.treeJson as any)?.schemaVersion,
          });
        } else {
          console.log(`[GET /api/products/${productId}/pbv2/tree] No DRAFT found`);
        }
        if (active) {
          const nodeCount = typeof active.treeJson === 'object' && active.treeJson ? Object.keys((active.treeJson as any).nodes || {}).length : 0;
          const rootCount = Array.isArray((active.treeJson as any).rootNodeIds) ? (active.treeJson as any).rootNodeIds.length : 0;
          console.log(`[GET /api/products/${productId}/pbv2/tree] ACTIVE:`, {
            activeId: active.id,
            nodeCount,
            rootCount,
            schemaVersion: (active.treeJson as any)?.schemaVersion,
            hasPricingV2: !!(active.treeJson as any)?.meta?.pricingV2,
          });
        } else {
          console.log(`[GET /api/products/${productId}/pbv2/tree] No ACTIVE found`);
        }
      }

      return res.json({ success: true, data: { draft: draft || null, active: active || null } });
    } catch (error: any) {
      console.error("Error fetching PBV2 tree:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch PBV2 tree" });
    }
  });

  app.put("/api/products/:productId/pbv2/draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      const { productId } = req.params;
      
      // LOG 1: Handler hit
      console.log('[PBV2_DRAFT_PUT] hit', { 
        productId, 
        orgId: organizationId, 
        userId,
        timestamp: new Date().toISOString()
      });
      
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const treeJson = (req.body as any)?.treeJson;

      if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) {
        console.log('[PBV2_DRAFT_PUT] validation failed: treeJson invalid');
        return res.status(400).json({ success: false, message: "treeJson must be an object" });
      }

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        console.log('[PBV2_DRAFT_PUT] product not found');
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      // LOG 2: Tree stats (client should have set rootNodeIds via ensureRootNodeIds)
      const nodes = (treeJson as any).nodes || {};
      const nodeCount = Object.keys(nodes).length;
      const edgeCount = Array.isArray((treeJson as any).edges) ? (treeJson as any).edges.length : 0;
      const rootCountBefore = Array.isArray((treeJson as any).rootNodeIds) ? (treeJson as any).rootNodeIds.length : 0;
      const schemaVersion = (treeJson as any).schemaVersion ?? 2;
      
      // DEFENSIVE: Warn if rootNodeIds is empty but nodes exist (should be fixed client-side)
      if (nodeCount > 0 && rootCountBefore === 0) {
        console.warn('[PBV2_DRAFT_PUT] âš ï¸ rootNodeIds is empty but tree has nodes - client should call ensureRootNodeIds', {
          nodeCount,
          edgeCount,
          schemaVersion,
        });
      } else {
        console.log('[PBV2_DRAFT_PUT] incoming tree stats', {
          schemaVersion,
          nodeCount,
          edgeCount,
          rootCount: rootCountBefore,
          rootNodeIds: (treeJson as any).rootNodeIds,
        });
      }

      // Count nodes by type to detect missing options/pricing
      const nodesByType: Record<string, number> = {};
      const nodesByKind: Record<string, number> = {};
      for (const node of Object.values(nodes) as any[]) {
        const nodeType = (node?.type || 'UNKNOWN').toUpperCase();
        const nodeKind = node?.kind || 'unknown';
        nodesByType[nodeType] = (nodesByType[nodeType] || 0) + 1;
        nodesByKind[nodeKind] = (nodesByKind[nodeKind] || 0) + 1;
      }
      const firstFiveNodeKeys = Object.keys(nodes).slice(0, 5);
      console.log('[PBV2_DRAFT_PUT] node breakdown', {
        nodesByType,
        nodesByKind,
        firstFiveNodeKeys,
      });

      // Upsert: update if exists, insert if not
      // CRITICAL: Order by updated_at DESC to get most recent draft deterministically
      // This prevents repeated INSERTs when activation is blocked (draft stays DRAFT)
      const [existingDraft] = await db
        .select({ id: pbv2TreeVersions.id, updatedAt: pbv2TreeVersions.updatedAt })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      console.log('[PBV2_DRAFT_PUT] existing draft check', { 
        existingDraftId: existingDraft?.id || null,
        action: existingDraft ? 'UPDATE' : 'INSERT'
      });

      let draft;
      try {
        const schemaVersion = (treeJson as any).schemaVersion ?? 2;
        if (existingDraft) {
          [draft] = await db
            .update(pbv2TreeVersions)
            .set({
              treeJson: treeJson,
              schemaVersion: schemaVersion,
              updatedByUserId: userId ?? null,
              updatedAt: new Date(),
            })
            .where(eq(pbv2TreeVersions.id, existingDraft.id))
            .returning();
          console.log('[PBV2_DRAFT_PUT] UPDATE succeeded', { draftId: draft.id });
        } else {
          [draft] = await db
            .insert(pbv2TreeVersions)
            .values({
              organizationId,
              productId,
              status: "DRAFT",
              schemaVersion: schemaVersion,
              treeJson: treeJson,
              createdByUserId: userId ?? null,
              updatedByUserId: userId ?? null,
            })
            .returning();
          console.log('[PBV2_DRAFT_PUT] INSERT succeeded', { draftId: draft.id });
        }
      } catch (dbError: any) {
        console.error('[PBV2_DRAFT_PUT] DB write failed:', dbError);
        console.error('[PBV2_DRAFT_PUT] DB error stack:', dbError.stack);
        throw dbError;
      }

      // LOG 3: Verify row exists with SELECT COUNT
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        );
      
      console.log('[PBV2_DRAFT_PUT] after write count', { 
        count: countResult.count,
        draftId: draft.id,
        productId,
        orgId: organizationId
      });

      // HARD FAIL: If no row exists after write, return 500
      if (countResult.count < 1) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: no row after write', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({ 
          success: false, 
          message: "PBV2 draft write failed: no row after write" 
        });
      }

      // Additional verification: SELECT the actual row
      const [verifiedDraft] = await db
        .select({ id: pbv2TreeVersions.id })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      if (!verifiedDraft) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: verification SELECT returned no row', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({ 
          success: false, 
          message: "PBV2 draft write failed: verification SELECT returned no row" 
        });
      }

      console.log('[PBV2_DRAFT_PUT] verification SELECT succeeded', { verifiedId: verifiedDraft.id });

      // ============================================================
      // AUTO-ACTIVATION: If org mode is 'auto_on_save', attempt activation
      // ============================================================
      let activationAttempted = false;
      let activationResult: {
        success: boolean;
        activated?: boolean;
        findings?: any[];
        errorCode?: string;
        message?: string;
      } = { success: false };

      // Load org to check activation mode
      const [org] = await db
        .select({ pbv2ActivationMode: organizations.pbv2ActivationMode })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (org?.pbv2ActivationMode === 'auto_on_save') {
        activationAttempted = true;
        console.log('[PBV2_AUTO_ACTIVATE] attempting auto-activation', { draftId: draft.id, productId, orgId: organizationId });

        try {
          // GUARDRAIL 1: Check schemaVersion = 2
          const treeJson = (draft as any).treeJson as any;
          const schemaVersion = treeJson?.schemaVersion ?? 1;
          if (schemaVersion !== 2) {
            activationResult = {
              success: false,
              activated: false,
              errorCode: 'PBV2_E_SCHEMA_VERSION_UNSUPPORTED',
              message: 'Draft saved but not activated: tree must be upgraded to PBV2 v2',
              findings: [{
                severity: "error",
                message: "Tree schemaVersion must be 2 for activation",
                path: "schemaVersion",
                actual: schemaVersion,
                expected: 2,
              }],
            };
            console.log('[PBV2_AUTO_ACTIVATE] blocked by schemaVersion', { draftId: draft.id, schemaVersion });
          } else {
          // GUARDRAIL 2: Run same validations as publish
          const { validateTreeHasBasePrice } = await import("../shared/pbv2/validator/validateBasePrice");
          const basePriceValidation = validateTreeHasBasePrice(treeJson);
          
          if (basePriceValidation.errors.length > 0) {
            activationResult = {
              success: false,
              activated: false,
              errorCode: 'BASE_PRICE_MISSING',
              message: 'Draft saved but not activated: base pricing required',
              findings: basePriceValidation.findings,
            };
            console.log('[PBV2_AUTO_ACTIVATE] blocked by base pricing validation', { draftId: draft.id });
          } else {
            const { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } = await import("../shared/pbv2/validator");
            const publishValidation = validateTreeForPublish((draft as any).treeJson as any, DEFAULT_VALIDATE_OPTS);
            
            if (publishValidation.errors.length > 0) {
              activationResult = {
                success: false,
                activated: false,
                errorCode: 'VALIDATION_ERRORS',
                message: 'Draft saved but not activated: validation errors present',
                findings: publishValidation.findings,
              };
              console.log('[PBV2_AUTO_ACTIVATE] blocked by publish validation', { draftId: draft.id, errorCount: publishValidation.errors.length });
            } else {
              // Validation passed, activate the tree
              const publishedAt = new Date();
              
              await db.transaction(async (tx) => {
                // Check for previous active version
                const [productRecord] = await tx
                  .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
                  .from(products)
                  .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
                  .limit(1);

                const previousActiveId = productRecord?.pbv2ActiveTreeVersionId;
                
                // Deprecate previous active if different
                if (previousActiveId && previousActiveId !== draft.id) {
                  await tx
                    .update(pbv2TreeVersions)
                    .set({ status: "DEPRECATED", updatedAt: publishedAt, updatedByUserId: userId ?? null })
                    .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, previousActiveId)));
                }

                // Activate this version
                const nextTreeJson = {
                  ...(draft as any).treeJson,
                  schemaVersion: 2, // Preserve v2 schema
                  status: "ACTIVE",
                };

                await tx
                  .update(pbv2TreeVersions)
                  .set({
                    status: "ACTIVE",
                    publishedAt,
                    updatedAt: publishedAt,
                    updatedByUserId: userId ?? null,
                    treeJson: nextTreeJson,
                  })
                  .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, draft.id)));

                // Update product pointer
                await tx
                  .update(products)
                  .set({ pbv2ActiveTreeVersionId: draft.id, updatedAt: publishedAt })
                  .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)));
              });

              activationResult = {
                success: true,
                activated: true,
                message: 'Draft saved and activated successfully',
                findings: publishValidation.warnings.length > 0 ? publishValidation.findings : undefined,
              };
              console.log('[PBV2_AUTO_ACTIVATE] activation succeeded', { draftId: draft.id, productId, pbv2ActiveTreeVersionId: draft.id });
            }
          }
          }
        } catch (activationError: any) {
          // Don't fail the save if activation fails
          activationResult = {
            success: false,
            activated: false,
            errorCode: 'ACTIVATION_FAILED',
            message: 'Draft saved but activation failed: ' + (activationError.message || 'Unknown error'),
          };
          console.error('[PBV2_AUTO_ACTIVATE] activation failed', { draftId: draft.id, error: activationError });
        }
      }

      return res.json({ 
        success: true, 
        data: draft,
        activationAttempted,
        activationResult: activationAttempted ? activationResult : undefined,
      });
    } catch (error: any) {
      console.error('[PBV2_DRAFT_PUT] FATAL ERROR:', error);
      console.error('[PBV2_DRAFT_PUT] error stack:', error.stack);
      return res.status(500).json({ success: false, message: "Failed to upsert PBV2 draft", error: error.message });
    }
  });



  app.post("/api/pbv2/tree-versions/:id/publish", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = req.params;
      const confirmWarnings = String((req.query as any)?.confirmWarnings ?? "").toLowerCase() === "true";
      const userId = getUserId(req.user);

      const [draft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, id)))
        .limit(1);

      if (!draft) return res.status(404).json({ success: false, message: "Tree version not found" });
      
      // Idempotency: If already ACTIVE, check if product points to it
      if (draft.status === "ACTIVE") {
        const [product] = await db
          .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
          .from(products)
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)))
          .limit(1);
        
        if (product && product.pbv2ActiveTreeVersionId === id) {
          // Already published and active - idempotent success
          console.log(`[PBV2_PUBLISH_IDEMPOTENT] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} status=already_active`);
          return res.json({
            success: true,
            data: draft,
            productId: draft.productId,
            pbv2ActiveTreeVersionId: id,
            message: "Tree version already published and active"
          });
        }
      }
      
      if (draft.status !== "DRAFT") {
        return res.status(409).json({ success: false, message: "Only DRAFT tree versions can be published" });
      }

      // GUARDRAIL 1: Validate schemaVersion = 2
      const treeJson = (draft as any).treeJson as any;
      const schemaVersion = treeJson?.schemaVersion ?? 1;
      if (schemaVersion !== 2) {
        console.warn(`[PBV2_ACTIVATION_BLOCKED] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} reason=schema_version_unsupported schemaVersion=${schemaVersion}`);
        return res.status(400).json({
          success: false,
          code: "PBV2_E_SCHEMA_VERSION_UNSUPPORTED",
          message: "Cannot activate this PBV2 tree: schema version outdated",
          error: "This tree uses PBV2 schema v" + schemaVersion + ". Only v2 trees can be activated. Open the product in the PBV2 builder and re-save to upgrade, then try publishing again.",
          findings: [{
            severity: "error",
            message: "Tree must be PBV2 schema version 2",
            path: "schemaVersion",
            actual: schemaVersion,
            expected: 2,
          }],
        });
      }

      // GUARDRAIL 2: Validate base pricing is configured
      const { validateTreeHasBasePrice } = await import("../shared/pbv2/validator/validateBasePrice");
      const basePriceValidation = validateTreeHasBasePrice(treeJson);
      if (basePriceValidation.errors.length > 0) {
        console.warn(`[PBV2_ACTIVATION_BLOCKED] orgId=${organizationId} productId=${draft.productId} treeVersionId=${id} reason=missing_base_price`);
        return res.status(400).json({
          success: false,
          message: "PBV2 tree requires base pricing configuration before activation",
          error: "Base pricing must be configured in the Base Pricing section. Set at least one of: $/sqft, $/piece, or minimum charge.",
          findings: basePriceValidation.findings,
        });
      }

      // Validate publish gate (Appendix 5)
      const validation = validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS);
      if (validation.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "PBV2 publish blocked by validation errors",
          findings: validation.findings,
        });
      }

      if (validation.warnings.length > 0 && !confirmWarnings) {
        return res.json({
          success: true,
          requiresWarningsConfirm: true,
          findings: validation.findings,
        });
      }

      const publishedAt = new Date();

      const result = await db.transaction(async (tx) => {
        const [product] = await tx
          .select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
          .from(products)
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)))
          .limit(1);

        if (!product) {
          throw Object.assign(new Error("Product not found"), { statusCode: 404 });
        }

        const previousActiveId = product.pbv2ActiveTreeVersionId;
        if (previousActiveId && previousActiveId !== draft.id) {
          await tx
            .update(pbv2TreeVersions)
            .set({ status: "DEPRECATED", updatedAt: publishedAt, updatedByUserId: userId ?? null })
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, previousActiveId)));
        }

        const nextTreeJson: Record<string, any> = {
          ...(draft as any).treeJson,
          schemaVersion: 2, // Preserve v2 schema
          status: "ACTIVE",
        };

        const [updatedVersion] = await tx
          .update(pbv2TreeVersions)
          .set({
            status: "ACTIVE",
            publishedAt,
            updatedAt: publishedAt,
            updatedByUserId: userId ?? null,
            treeJson: nextTreeJson,
          })
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, draft.id)))
          .returning();

        await tx
          .update(products)
          .set({ pbv2ActiveTreeVersionId: draft.id, updatedAt: publishedAt })
          .where(and(eq(products.id, draft.productId), eq(products.organizationId, organizationId)));

        console.log(`[PBV2_PUBLISH_SUCCESS] orgId=${organizationId} productId=${draft.productId} treeVersionId=${draft.id} previousActiveId=${previousActiveId || 'none'}`);

        return { 
          updatedVersion, 
          productId: draft.productId, 
          pbv2ActiveTreeVersionId: draft.id 
        };
      });

      return res.json({ 
        success: true, 
        data: result.updatedVersion, 
        productId: result.productId,
        pbv2ActiveTreeVersionId: result.pbv2ActiveTreeVersionId,
        findings: validation.findings 
      });
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      console.error("Error publishing PBV2 tree version:", error);
      return res.status(500).json({ success: false, message: "Failed to publish PBV2 tree version" });
    }
  });

  // ============================================================================
  // PBV2 Advanced Override (Admin-only, temporary)
  // - Stores pointer in products.pricingProfileConfig.pbv2Override
  // - Stores override tree JSON in pbv2_tree_versions (status=ARCHIVED)
  // - Evaluation uses override when enabled (see orders.routes.ts)
  // ============================================================================

  app.get("/api/products/:productId/pbv2/override", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);

      let treeJson: any = null;
      if (cfg.treeVersionId) {
        const [tv] = await db
          .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
          .from(pbv2TreeVersions)
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, cfg.treeVersionId)))
          .limit(1);
        treeJson = tv?.treeJson ?? null;
      }

      return res.json({
        success: true,
        data: {
          enabled: cfg.enabled,
          treeVersionId: cfg.treeVersionId,
          treeJsonText: treeJson ? JSON.stringify(treeJson, null, 2) : "",
        },
      });
    } catch (error: any) {
      console.error("Error fetching PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/validate", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const treeJsonText = String((req.body as any)?.treeJsonText ?? "");
      let parsed: any;
      try {
        parsed = JSON.parse(treeJsonText);
      } catch (e: any) {
        return res.status(400).json({
          success: false,
          message: `Override JSON invalid: ${e?.message ?? "Invalid JSON"}`,
          findings: [
            {
              severity: "ERROR",
              code: "PBV2_E_OVERRIDE_JSON_PARSE",
              message: `Invalid JSON: ${e?.message ?? "parse error"}`,
              path: "override.treeJsonText",
            },
          ],
        });
      }

      const validation = validateTreeForPublish(parsed as any, DEFAULT_VALIDATE_OPTS);
      const ok = validation.errors.length === 0;

      return res.json({
        success: ok,
        message: ok ? "Override JSON is publish-valid" : "Override JSON blocked by validation errors",
        findings: validation.findings,
      });
    } catch (error: any) {
      console.error("Error validating PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to validate PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/save", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const userId = getUserId(req.user);

      const treeJsonText = String((req.body as any)?.treeJsonText ?? "");
      const enable = Boolean((req.body as any)?.enable);

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      let parsed: any;
      try {
        parsed = JSON.parse(treeJsonText);
      } catch (e: any) {
        return res.status(400).json({
          success: false,
          message: `Override JSON invalid: ${e?.message ?? "Invalid JSON"}`,
          findings: [
            {
              severity: "ERROR",
              code: "PBV2_E_OVERRIDE_JSON_PARSE",
              message: `Invalid JSON: ${e?.message ?? "parse error"}`,
              path: "override.treeJsonText",
            },
          ],
        });
      }

      const validation = validateTreeForPublish(parsed as any, DEFAULT_VALIDATE_OPTS);
      if (validation.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Override JSON blocked by validation errors",
          findings: validation.findings,
        });
      }

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);

      const saved = await db.transaction(async (tx) => {
        let treeVersionId = cfg.treeVersionId;

        if (treeVersionId) {
          const [existingTv] = await tx
            .select({ id: pbv2TreeVersions.id })
            .from(pbv2TreeVersions)
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionId)))
            .limit(1);
          if (!existingTv) treeVersionId = null;
        }

        if (treeVersionId) {
          await tx
            .update(pbv2TreeVersions)
            .set({
              status: "ARCHIVED",
              treeJson: parsed,
              updatedAt: new Date(),
              updatedByUserId: userId ?? null,
            })
            .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionId)));
        } else {
          const [inserted] = await tx
            .insert(pbv2TreeVersions)
            .values({
              organizationId,
              productId,
              status: "ARCHIVED",
              schemaVersion: 1,
              treeJson: parsed,
              createdByUserId: userId ?? null,
              updatedByUserId: userId ?? null,
            })
            .returning({ id: pbv2TreeVersions.id });
          treeVersionId = inserted?.id ? String(inserted.id) : null;
        }

        const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, {
          treeVersionId,
          enabled: enable,
        });

        await tx
          .update(products)
          .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
          .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

        return { treeVersionId, enabled: enable };
      });

      return res.json({
        success: true,
        message: saved.enabled ? "PBV2 override saved and enabled" : "PBV2 override saved",
        data: saved,
        findings: validation.findings,
      });
    } catch (error: any) {
      console.error("Error saving PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to save PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/toggle", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const enabled = Boolean((req.body as any)?.enabled);

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const cfg = readPbv2OverrideConfig((product as any).pricingProfileConfig);
      if (enabled) {
        if (!cfg.treeVersionId) {
          return res.status(409).json({ success: false, message: "Cannot enable override: no override JSON has been saved yet" });
        }

        const [tv] = await db
          .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
          .from(pbv2TreeVersions)
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, cfg.treeVersionId)))
          .limit(1);

        if (!tv) {
          return res.status(409).json({ success: false, message: "Cannot enable override: override tree version not found" });
        }

        const validation = validateTreeForPublish((tv as any).treeJson as any, DEFAULT_VALIDATE_OPTS);
        if (validation.errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: "Cannot enable override: stored override JSON is not publish-valid",
            findings: validation.findings,
          });
        }
      }

      const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, { enabled });
      await db
        .update(products)
        .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

      return res.json({ success: true, message: enabled ? "PBV2 override enabled" : "PBV2 override disabled", data: { enabled } });
    } catch (error: any) {
      console.error("Error toggling PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to toggle PBV2 override" });
    }
  });

  app.post("/api/products/:productId/pbv2/override/disable", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      const [product] = await db
        .select({ id: products.id, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const nextConfig = writePbv2OverrideConfig((product as any).pricingProfileConfig, { enabled: false });
      await db
        .update(products)
        .set({ pricingProfileConfig: nextConfig, updatedAt: new Date() })
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

      return res.json({ success: true, message: "PBV2 override disabled (JSON kept)", data: { enabled: false } });
    } catch (error: any) {
      console.error("Error disabling PBV2 override:", error);
      return res.status(500).json({ success: false, message: "Failed to disable PBV2 override" });
    }
  });

  app.get("/api/products/export", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const products = await storage.getAllProducts(organizationId);

      const exportData: Array<Record<string, string>> = [];

      for (const product of products) {
        exportData.push({
          Type: 'PRODUCT',
          'Product Name': product.name,
          'Product Description': product.description || '',
          'Pricing Formula': product.pricingFormula || '',
          'Variant Label': product.variantLabel || '',
          Category: product.category || '',
          'Store URL': product.storeUrl || '',
          'Show Store Link': product.showStoreLink ? 'true' : 'false',
          'Thumbnail URLs': (product.thumbnailUrls || []).join('|'),
          'Is Active': product.isActive ? 'true' : 'false',
          'Variant Name': '',
          'Variant Description': '',
          'Base Price Per Sqft': '',
          'Is Default Variant': '',
          'Variant Display Order': '',
          'Option Name': '',
          'Option Description': '',
          'Option Type': '',
          'Default Value': '',
          'Default Selection': '',
          'Is Default Enabled': '',
          'Setup Cost': '',
          'Price Formula': '',
          'Parent Option Name': '',
          'Option Display Order': '',
        });

        const variants = await storage.getProductVariants(product.id);
        for (const variant of variants) {
          exportData.push({
            Type: 'VARIANT',
            'Product Name': product.name,
            'Product Description': '',
            'Pricing Formula': '',
            'Variant Label': '',
            Category: '',
            'Store URL': '',
            'Show Store Link': '',
            'Thumbnail URLs': '',
            'Is Active': '',
            'Variant Name': variant.name,
            'Variant Description': variant.description || '',
            'Base Price Per Sqft': variant.basePricePerSqft.toString(),
            'Is Default Variant': variant.isDefault ? 'true' : 'false',
            'Variant Display Order': variant.displayOrder.toString(),
            'Option Name': '',
            'Option Description': '',
            'Option Type': '',
            'Default Value': '',
            'Default Selection': '',
            'Is Default Enabled': '',
            'Setup Cost': '',
            'Price Formula': '',
            'Parent Option Name': '',
            'Option Display Order': '',
          });
        }

        const options = await storage.getProductOptions(product.id);
        const optionIdToNameMap: Record<string, string> = {};
        for (const option of options) {
          optionIdToNameMap[option.id] = option.name;
        }

        for (const option of options) {
          exportData.push({
            Type: 'OPTION',
            'Product Name': product.name,
            'Product Description': '',
            'Pricing Formula': '',
            'Variant Label': '',
            Category: '',
            'Store URL': '',
            'Show Store Link': '',
            'Thumbnail URLs': '',
            'Is Active': '',
            'Variant Name': '',
            'Variant Description': '',
            'Base Price Per Sqft': '',
            'Is Default Variant': '',
            'Variant Display Order': '',
            'Option Name': option.name,
            'Option Description': option.description || '',
            'Option Type': option.type,
            'Default Value': option.defaultValue || '',
            'Default Selection': option.defaultSelection || '',
            'Is Default Enabled': option.isDefaultEnabled ? 'true' : 'false',
            'Setup Cost': option.setupCost.toString(),
            'Price Formula': option.priceFormula || '',
            'Parent Option Name': option.parentOptionId ? (optionIdToNameMap[option.parentOptionId] || '') : '',
            'Option Display Order': option.displayOrder.toString(),
          });
        }
      }

      const csv = Papa.unparse(exportData);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="products-export-${timestamp}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting products:", error);
      res.status(500).json({ message: "Failed to export products" });
    }
  });

  app.get("/api/products/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const product = await storage.getProductById(organizationId, req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // DEV-ONLY: Log what's being returned
      if (process.env.NODE_ENV !== 'production' && product.optionTreeJson) {
        const nodeCount = typeof product.optionTreeJson === 'object' 
          ? Object.keys((product.optionTreeJson as any).nodes || {}).length 
          : 0;
        console.log('[GET /api/products/:id] RETURNING optionTreeJson:', {
          type: typeof product.optionTreeJson,
          nodeCount,
          isString: typeof product.optionTreeJson === 'string',
          preview: typeof product.optionTreeJson === 'string' ? (product.optionTreeJson as string).slice(0, 100) : null,
        });
      }
      
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.get("/api/products/:id/design-config", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const productId = String(req.params.id);
      const product = await storage.getProductById(organizationId, productId);
      if (!product) {
        return res.status(404).json({ success: false, data: null, message: "Product not found" });
      }

      const config = await productDesignConfigRepository.getByProductId(organizationId, productId);

      return res.json({
        success: true,
        data: config,
        message: config ? "Product design config loaded" : "Product design config not configured",
      });
    } catch (error) {
      console.error("[GET /api/products/:id/design-config] Failed to fetch product design config:", error);
      return res.status(500).json({ success: false, data: null, message: "Failed to fetch product design config" });
    }
  });

  app.put("/api/products/:id/design-config", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      }

      const productId = String(req.params.id);
      const product = await storage.getProductById(organizationId, productId);
      if (!product) {
        return res.status(404).json({ success: false, data: null, message: "Product not found" });
      }

      const parsedData = insertProductDesignConfigSchema.parse(req.body);
      const configInput = Object.fromEntries(
        Object.entries(parsedData).map(([key, value]) => [key, typeof value === "string" && value.length === 0 ? null : value]),
      );

      const config = await productDesignConfigRepository.upsertForProduct(
        organizationId,
        productId,
        configInput as any,
      );

      return res.json({ success: true, data: config, message: "Product design config saved" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          data: null,
          message: fromZodError(error).message,
          errors: error.errors,
        });
      }

      console.error("[PUT /api/products/:id/design-config] Failed to save product design config:", error);
      return res.status(500).json({ success: false, data: null, message: "Failed to save product design config" });
    }
  });

  app.post("/api/products", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log("[POST /api/products] Raw request body:", JSON.stringify(req.body, null, 2));

      const parsedData = insertProductSchema.parse(req.body);
      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null for optional fields, but preserve strings for required fields like description
        if (k === 'description' || k === 'name') {
          productData[k] = v ?? '';
        } else {
          productData[k] = v === '' ? null : v;
        }
      });

      console.log("[POST /api/products] Parsed & cleaned data:", JSON.stringify(productData, null, 2));

      const product = await storage.createProduct(organizationId, productData as InsertProduct);
      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[POST /api/products] Zod validation error:", error.errors);
        return res.status(400).json({
          message: fromZodError(error).message,
          errors: error.errors
        });
      }
      console.error("[POST /api/products] Error creating product:", error);
      console.error("Stack trace:", (error as Error).stack);
      res.status(500).json({
        message: "Failed to create product",
        error: (error as Error).message
      });
    }
  });

  app.patch("/api/products/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const productId = String(req.params.id);

      const parsedData = updateProductSchema.parse(req.body);

      const productData: any = {};
      Object.entries(parsedData).forEach(([k, v]) => {
        // Convert empty strings to null for optional fields, but preserve strings for required fields like description
        if (k === "description" || k === "name") {
          productData[k] = v ?? "";
        } else {
          productData[k] = v === "" ? null : v;
        }
      });

      // Guard: do not attempt an update with no fields.
      if (Object.keys(productData).length === 0) {
        return res.status(400).json({ success: false, message: "No fields to update" });
      }

      // DEV-ONLY: Log productData before storage.updateProduct
      if (process.env.NODE_ENV !== "production") {
        console.log("[PATCH /api/products/:id] productData keys:", Object.keys(productData));
        console.log("[PATCH /api/products/:id] optionTreeJson:", {
          hasField: 'optionTreeJson' in productData,
          type: typeof productData.optionTreeJson,
          length: productData.optionTreeJson ? JSON.stringify(productData.optionTreeJson).length : 0,
        });
      }

      // Validate optionsJson is JSON-safe + enforce a reasonable size limit.
      if (Object.prototype.hasOwnProperty.call(productData, "optionsJson")) {
        const optionsJson = productData.optionsJson;
        if (optionsJson != null) {
          let jsonText: string;
          try {
            jsonText = JSON.stringify(optionsJson);
          } catch {
            return res.status(400).json({ success: false, message: "optionsJson must be valid JSON" });
          }

          // Size guard (prevents accidentally storing transient UI state).
          if (jsonText.length > 250_000) {
            return res.status(400).json({ success: false, message: "optionsJson is too large" });
          }

          // Round-trip to ensure it can be serialized safely.
          try {
            productData.optionsJson = JSON.parse(jsonText);
          } catch {
            return res.status(400).json({ success: false, message: "optionsJson must be valid JSON" });
          }
        }
      }

      // Validate optionTreeJson is JSON-safe (Option Tree v2 payload).
      if (Object.prototype.hasOwnProperty.call(productData, "optionTreeJson")) {
        const optionTreeJson = productData.optionTreeJson;
        if (optionTreeJson != null) {
          let jsonText: string;
          try {
            jsonText = JSON.stringify(optionTreeJson);
          } catch {
            return res.status(400).json({ success: false, message: "optionTreeJson must be valid JSON" });
          }

          // Round-trip to ensure it can be serialized safely.
          try {
            productData.optionTreeJson = JSON.parse(jsonText);
          } catch {
            return res.status(400).json({ success: false, message: "optionTreeJson must be valid JSON" });
          }
        }
      }

      const product = await storage.updateProduct(organizationId, productId, productData as UpdateProduct);
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
      
      // DEV-ONLY: Verify what was actually written to DB
      if (process.env.NODE_ENV !== 'production' && 'optionTreeJson' in productData) {
        const dbNodeCount = product.optionTreeJson && typeof product.optionTreeJson === 'object' 
          ? Object.keys((product.optionTreeJson as any).nodes || {}).length 
          : 0;
        console.log('[PATCH /api/products/:id] DB WRITE VERIFIED:', {
          returnedType: typeof product.optionTreeJson,
          dbNodeCount,
          schemaVersion: (product.optionTreeJson as any)?.schemaVersion,
        });
      }

      // ============================================================
      // PBV2 BASE PRICING PROPAGATION
      // ============================================================
      // After product save, propagate DRAFT base pricing to ACTIVE tree
      // This ensures /calculate uses current pricing without manual publish
      const userId = getUserId(req.user);
      
      if (product.pbv2ActiveTreeVersionId) {
        try {
          // Load DRAFT tree version
          const [draftTreeVersion] = await db
            .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
            .from(pbv2TreeVersions)
            .where(
              and(
                eq(pbv2TreeVersions.organizationId, organizationId),
                eq(pbv2TreeVersions.productId, productId),
                eq(pbv2TreeVersions.status, "DRAFT")
              )
            )
            .limit(1);
          
          if (draftTreeVersion) {
            // Load current ACTIVE tree version
            const [activeTreeVersion] = await db
              .select({ id: pbv2TreeVersions.id, treeJson: pbv2TreeVersions.treeJson })
              .from(pbv2TreeVersions)
              .where(
                and(
                  eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId),
                  eq(pbv2TreeVersions.organizationId, organizationId),
                  eq(pbv2TreeVersions.status, "ACTIVE")
                )
              )
              .limit(1);
            
            if (activeTreeVersion) {
              // Extract base pricing from DRAFT and ACTIVE
              const draftTree = draftTreeVersion.treeJson as any;
              const activeTree = activeTreeVersion.treeJson as any;
              const draftBasePricing = draftTree?.meta?.pricingV2?.base;
              const activeBasePricing = activeTree?.meta?.pricingV2?.base;
              
              // Compare base pricing - only propagate if changed
              const basePricingChanged = JSON.stringify(draftBasePricing) !== JSON.stringify(activeBasePricing);
              
              if (basePricingChanged && draftBasePricing) {
                console.log('[PBV2_BASE_PRICING_PROPAGATION] detected change', {
                  productId,
                  activeTreeVersionId: activeTreeVersion.id,
                  draftBasePricing,
                  activeBasePricing,
                });
                
                // Deep clone ACTIVE tree and update only meta.pricingV2.base
                const updatedActiveTree = JSON.parse(JSON.stringify(activeTree));
                if (!updatedActiveTree.meta) updatedActiveTree.meta = {};
                if (!updatedActiveTree.meta.pricingV2) updatedActiveTree.meta.pricingV2 = {};
                updatedActiveTree.meta.pricingV2.base = draftBasePricing;
                
                // Use transaction to ensure atomic state transition: DEPRECATE old → INSERT new → UPDATE pointer
                const newActiveVersion = await db.transaction(async (tx) => {
                  // STEP 1: Deprecate old ACTIVE version FIRST (removes unique constraint conflict)
                  await tx
                    .update(pbv2TreeVersions)
                    .set({ 
                      status: "DEPRECATED", 
                      updatedAt: new Date(),
                      updatedByUserId: userId ?? null 
                    })
                    .where(
                      and(
                        eq(pbv2TreeVersions.id, activeTreeVersion.id),
                        eq(pbv2TreeVersions.organizationId, organizationId)
                      )
                    );
                  
                  // STEP 2: Create NEW ACTIVE tree version (immutability preserved)
                  const [newVersion] = await tx
                    .insert(pbv2TreeVersions)
                    .values({
                      organizationId,
                      productId,
                      status: "ACTIVE",
                      schemaVersion: updatedActiveTree.schemaVersion ?? 2,
                      treeJson: updatedActiveTree,
                      publishedAt: new Date(),
                      createdByUserId: userId ?? null,
                      updatedByUserId: userId ?? null,
                    })
                    .returning();
                  
                  // STEP 3: Update product pointer to new ACTIVE version
                  await tx
                    .update(products)
                    .set({ 
                      pbv2ActiveTreeVersionId: newVersion.id,
                      updatedAt: new Date()
                    })
                    .where(
                      and(
                        eq(products.id, productId),
                        eq(products.organizationId, organizationId)
                      )
                    );
                  
                  return newVersion;
                });
                
                console.log('[PBV2_BASE_PRICING_PROPAGATION] success - status transitions completed', {
                  productId,
                  oldActiveId: activeTreeVersion.id,
                  oldStatus: 'ACTIVE → DEPRECATED',
                  newActiveId: newActiveVersion.id,
                  newStatus: 'ACTIVE',
                  basePricing: draftBasePricing,
                });
                
                // Update product object for response
                product.pbv2ActiveTreeVersionId = newActiveVersion.id;
              } else {
                console.log('[PBV2_BASE_PRICING_PROPAGATION] skipped - no change', {
                  productId,
                  activeTreeVersionId: activeTreeVersion.id,
                });
              }
            }
          }
        } catch (propagationError: any) {
          // Don't fail product save if propagation fails
          console.error('[PBV2_BASE_PRICING_PROPAGATION] failed', {
            productId,
            error: propagationError.message,
            stack: propagationError.stack,
          });
        }
      }
      
      res.json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: fromZodError(error).message, errors: error.errors });
      }

      const errorId = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyCrypto: any = globalThis.crypto;
          if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
        } catch {
          // ignore
        }
        return `err_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      })();

      const productId = String(req.params.id);
      const bodyKeys = req?.body && typeof req.body === "object" ? Object.keys(req.body) : [];

      let optionsPreview: { length: number; preview: string } | null = null;
      try {
        if (req?.body && typeof req.body === "object" && "optionsJson" in req.body) {
          const text = JSON.stringify((req.body as any).optionsJson);
          optionsPreview = { length: text?.length ?? 0, preview: String(text || "").slice(0, 500) };
        }
      } catch {
        optionsPreview = { length: -1, preview: "<unstringifiable>" };
      }

      const anyErr: any = error as any;
      console.error("[PATCH /api/products/:id] Failed to update product", {
        errorId,
        productId,
        organizationId: getRequestOrganizationId(req) ?? undefined,
        bodyKeys,
        optionsPreview,
        errorMessage: anyErr?.message,
        errorCode: anyErr?.code,
        errorDetail: anyErr?.detail,
        errorConstraint: anyErr?.constraint,
      });

      res.status(500).json({ success: false, message: "Failed to update product", errorId });
    }
  });

  app.put("/api/products/:id/thumbnails", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { thumbnailUrls } = req.body;
      if (!Array.isArray(thumbnailUrls)) {
        return res.status(400).json({ message: "thumbnailUrls must be an array" });
      }

      const userId = getUserId(req.user);
      const objectStorageService = new ObjectStorageService();
      const normalizedPaths: string[] = [];

      for (const rawPath of thumbnailUrls) {
        if (typeof rawPath !== 'string' || !rawPath) continue;

        const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
          rawPath,
          {
            owner: userId || 'system',
            visibility: "public",
          }
        );
        normalizedPaths.push(normalizedPath);
      }

      const product = await storage.updateProduct(organizationId, req.params.id, {
        thumbnailUrls: normalizedPaths
      } as UpdateProduct);

      res.json(product);
    } catch (error) {
      console.error("Error updating product thumbnails:", error);
      res.status(500).json({ message: "Failed to update product thumbnails" });
    }
  });

  app.delete("/api/products/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteProduct(organizationId, req.params.id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/:id/clone", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const clonedProduct = await storage.cloneProduct(organizationId, req.params.id);
      res.json(clonedProduct);
    } catch (error) {
      console.error("Error cloning product:", error);
      res.status(500).json({ message: "Failed to clone product" });
    }
  });

  app.post("/api/products/:productId/duplicate", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userId = getUserId(req.user);
      const duplicated = await storage.duplicateProduct(organizationId, req.params.productId, userId ?? null);
      return res.json(duplicated);
    } catch (error) {
      console.error("Error duplicating product:", error);
      return res.status(500).json({ message: "Failed to duplicate product" });
    }
  });

  // Product Options routes
  app.get("/api/products/:id/options", isAuthenticated, async (req, res) => {
    try {
      const options = await storage.getProductOptions(req.params.id);
      res.json(options);
    } catch (error) {
      console.error("Error fetching product options:", error);
      res.status(500).json({ message: "Failed to fetch product options" });
    }
  });

  app.post("/api/products/:id/options", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const optionData = insertProductOptionSchema.parse({
        ...req.body,
        productId: req.params.id,
      });
      const option = await storage.createProductOption(optionData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating product option:", error);
      res.status(500).json({ message: "Failed to create product option" });
    }
  });

  app.patch("/api/products/:productId/options/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const optionData = updateProductOptionSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const option = await storage.updateProductOption(req.params.id, optionData);
      res.json(option);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating product option:", error);
      res.status(500).json({ message: "Failed to update product option" });
    }
  });

  app.delete("/api/products/:productId/options/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProductOption(req.params.id);
      res.json({ message: "Product option deleted successfully" });
    } catch (error) {
      console.error("Error deleting product option:", error);
      res.status(500).json({ message: "Failed to delete product option" });
    }
  });

  // Product Variants routes
  app.get("/api/products/:id/variants", isAuthenticated, async (req, res) => {
    try {
      const variants = await storage.getProductVariants(req.params.id);
      res.json(variants);
    } catch (error) {
      console.error("Error fetching product variants:", error);
      res.status(500).json({ message: "Failed to fetch product variants" });
    }
  });

  app.post("/api/products/:id/variants", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const variantData = insertProductVariantSchema.parse({
        ...req.body,
        productId: req.params.id,
      });
      const variant = await storage.createProductVariant(variantData);
      res.json(variant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating product variant:", error);
      res.status(500).json({ message: "Failed to create product variant" });
    }
  });

  app.patch("/api/products/:productId/variants/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const variantData = updateProductVariantSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const variant = await storage.updateProductVariant(req.params.id, variantData);
      res.json(variant);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating product variant:", error);
      res.status(500).json({ message: "Failed to update product variant" });
    }
  });

  app.delete("/api/products/:productId/variants/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProductVariant(req.params.id);
      res.json({ message: "Product variant deleted successfully" });
    } catch (error) {
      console.error("Error deleting product variant:", error);
      res.status(500).json({ message: "Failed to delete product variant" });
    }
  });

  // Global Variables routes extracted to ./routes/catalogSettings.routes.ts (do NOT re-add here)

  // Pricing Formulas routes extracted to ./routes/pricing.routes.ts (do NOT re-add here)

  app.post("/api/quotes/calculate", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      
      // Import PricingService for PBV2-only pricing
      const { priceLineItem } = await import("./services/pricing/PricingService");
      
      // Extract request fields
      const {
        productId,
        variantId,
        width,
        height,
        quantity,
        optionSelectionsJson, // PBV2 selections
        pbv2TreeVersionIdOverride, // Optional: specific tree version to use
      } = req.body;

      // PBV2_DEBUG: Log calculation entry point
      if (process.env.PBV2_DEBUG === "1") {
        console.log("[PBV2_CALC_ENTRY] " + JSON.stringify({ 
          productId, 
          organizationId, 
          hasOptionSelectionsJson: !!optionSelectionsJson, 
          selectionKeys: Object.keys(optionSelectionsJson || {}) 
        }));
      }

      // Validation: required fields
      if (!productId) {
        return res.status(400).json({ message: "productId is required" });
      }
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: "quantity must be a positive number" });
      }

      // Validation: dimensions (required for most products)
      if (width == null || height == null) {
        return res.status(400).json({ message: "width and height are required" });
      }
      if (width <= 0 || height <= 0) {
        return res.status(400).json({ message: "width and height must be positive" });
      }

      // Parse PBV2 selections from JSON string or use directly
      let pbv2ExplicitSelections: Record<string, any> = {};
      if (optionSelectionsJson) {
        try {
          pbv2ExplicitSelections = typeof optionSelectionsJson === 'string' 
            ? JSON.parse(optionSelectionsJson) 
            : optionSelectionsJson;
        } catch (parseError) {
          return res.status(400).json({ 
            message: "Invalid optionSelectionsJson format",
            error: (parseError as Error).message 
          });
        }
      }

      // Validate selections structure (must be Record<string, any>)
      if (typeof pbv2ExplicitSelections !== 'object' || Array.isArray(pbv2ExplicitSelections)) {
        return res.status(400).json({ 
          message: "optionSelectionsJson must be an object mapping optionId -> selection" 
        });
      }

      // Load product to validate PBV2-ready
      const [product] = await db
        .select({
          id: products.id,
          name: products.name,
          pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
        })
        .from(products)
        .where(
          and(
            eq(products.id, productId),
            eq(products.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      // Debug: Log what we actually fetched
      console.log(`[CALCULATE_DEBUG] productId=${productId} pbv2ActiveTreeVersionId=${product.pbv2ActiveTreeVersionId} hasOverride=${!!pbv2TreeVersionIdOverride}`);

      if (!product.pbv2ActiveTreeVersionId && !pbv2TreeVersionIdOverride) {
        console.warn(`[CALCULATE_PBV2_MISSING] productId=${productId} organizationId=${organizationId} - Product loaded but pbv2ActiveTreeVersionId is ${product.pbv2ActiveTreeVersionId}`);
        return res.status(400).json({ 
          message: "Product does not have PBV2 pricing configured (missing pbv2ActiveTreeVersionId)" 
        });
      }

      // Call unified PricingService with error handling
      let pricingResult;
      try {
        pricingResult = await priceLineItem({
          organizationId,
          productId,
          quantity,
          widthIn: width,
          heightIn: height,
          pbv2ExplicitSelections,
          pbv2TreeVersionIdOverride,
        });
      } catch (pricingError: any) {
        // Convert PBV2 schema version errors to 400 with friendly message
        if (pricingError.code === 'PBV2_E_SCHEMA_VERSION_MISMATCH') {
          console.warn(`[CALCULATE_PBV2_SCHEMA_MISMATCH] productId=${productId} schemaVersion=${pricingError.schemaVersion}`);
          return res.status(400).json({
            message: "This product's active PBV2 configuration is outdated (schema v" + (pricingError.schemaVersion || 1) + "). Open the product and re-save to upgrade, then activate.",
            code: "PBV2_E_SCHEMA_VERSION_MISMATCH",
            schemaVersion: pricingError.schemaVersion,
            details: pricingError.message,
          });
        }

        // Convert Zod validation errors to 400 with stable error code
        if (pricingError.name === 'ZodError') {
          console.warn(`[CALCULATE_PBV2_VALIDATION_ERROR] productId=${productId} zodErrors=${JSON.stringify(pricingError.issues)}`);
          return res.status(400).json({
            message: "Invalid PBV2 tree or selections format",
            code: "PBV2_E_INVALID_SELECTIONS",
            details: pricingError.issues ? pricingError.issues.map((issue: any) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : pricingError.message,
          });
        }
        
        // Re-throw other pricing errors (will be caught by outer handler)
        throw pricingError;
      }

      // Load variant info (display-only, not used for pricing)
      let variant = null;
      if (variantId) {
        const variants = await storage.getProductVariants(productId);
        variant = variants.find(v => v.id === variantId) ?? null;
      }

      // Format response (convert cents to dollars for legacy compatibility)
      res.json({
        success: true,
        linePrice: pricingResult.lineTotalCents / 100,
        priceBreakdown: {
          basePriceCents: pricingResult.breakdown.baseCents,
          optionsPriceCents: pricingResult.breakdown.optionsCents,
          lineTotalCents: pricingResult.lineTotalCents,
          basePrice: pricingResult.breakdown.baseCents / 100,
          optionsPrice: pricingResult.breakdown.optionsCents / 100,
          total: pricingResult.lineTotalCents / 100,
          pricingMethod: pricingResult.breakdown.pricingMethod,
        },
        // PBV2 snapshot fields (for storage in quote/order line items)
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        product: {
          id: product.id,
          name: product.name,
          pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId,
        },
        variant: variant ? {
          id: variant.id,
          name: variant.name,
        } : null,
      });
    } catch (error) {
      console.error("Error calculating price:", error);
      console.error("Request body:", JSON.stringify(req.body, null, 2));
      console.error("Stack:", (error as Error).stack);
      res.status(500).json({ message: "Failed to calculate price", error: (error as Error).message });
    }
  });

  app.get("/api/pbv2/pricing-preview/variables", isAuthenticated, tenantContext, async (_req: any, res) => {
    try {
      const { getPbv2PricingVariableDefinitions } = await import("./services/pricing/PricingService");
      return res.json({
        success: true,
        data: getPbv2PricingVariableDefinitions(),
      });
    } catch {
      return res.status(500).json({ message: "Failed to load pricing variables" });
    }
  });

  app.get("/api/pbv2/pricing-preview/reference", isAuthenticated, tenantContext, async (_req: any, res) => {
    try {
      const { getPbv2PricingVariableDefinitions } = await import("./services/pricing/PricingService");
      const { PBV2_PRICING_FUNCTIONS } = await import("../shared/pbv2/pricingFunctionCatalog");
      return res.json({
        success: true,
        data: {
          supportedVariables: getPbv2PricingVariableDefinitions(),
          supportedFunctions: PBV2_PRICING_FUNCTIONS,
        },
      });
    } catch {
      return res.status(500).json({ message: "Failed to load formula reference" });
    }
  });

  app.get("/api/pbv2/pricing-preview", isAuthenticated, tenantContext, async (_req: any, res) => {
    return res.status(405).json({
      message: "Method Not Allowed",
      allowedMethods: ["POST"],
    });
  });

  app.post("/api/pbv2/pricing-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const {
        treeJson,
        width,
        height,
        quantity,
        optionSelectionsJson,
        pricingFormulaOverride,
        pricingProfileKey,
        pricingProfileConfig,
        debug,
      } = req.body ?? {};

      if (!treeJson || typeof treeJson !== "object") {
        return res.status(400).json({ message: "treeJson is required" });
      }

      const widthNum = Number(width);
      const heightNum = Number(height);
      const quantityNum = Number(quantity);

      if (!Number.isFinite(widthNum) || widthNum <= 0) {
        return res.status(400).json({ message: "width must be a positive number" });
      }
      if (!Number.isFinite(heightNum) || heightNum <= 0) {
        return res.status(400).json({ message: "height must be a positive number" });
      }
      if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
        return res.status(400).json({ message: "quantity must be a positive number" });
      }

      let pbv2ExplicitSelections: Record<string, any> = {};
      if (optionSelectionsJson != null) {
        pbv2ExplicitSelections = typeof optionSelectionsJson === "string"
          ? JSON.parse(optionSelectionsJson)
          : optionSelectionsJson;
      }

      const { evaluatePricingPreviewFromTree } = await import("./services/pricing/PricingService");
      const result = evaluatePricingPreviewFromTree({
        treeJson,
        widthIn: widthNum,
        heightIn: heightNum,
        quantity: quantityNum,
        pbv2ExplicitSelections,
        pricingFormulaOverride: typeof pricingFormulaOverride === "string" ? pricingFormulaOverride : undefined,
        pricingProfileKey: typeof pricingProfileKey === "string" ? pricingProfileKey : undefined,
        pricingProfileConfig: pricingProfileConfig ?? undefined,
        debug: Boolean(debug),
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid preview payload" });
      }
      if (error?.code === "PBV2_FORMULA_ERROR" && Array.isArray(error?.details)) {
        return res.json({
          success: false,
          message: "Formula evaluation failed",
          errors: error.details,
          debug: error?.debug,
        });
      }
      const message = typeof error?.message === "string" ? error.message : "Failed to evaluate pricing preview";
      return res.status(400).json({ message });
    }
  });

  app.post("/api/quotes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      console.log(`[QUOTE_CREATE] Starting quote creation for org ${organizationId}, user ${userId}`);

      const {
        hasLineItems,
        hasCustomerId,
        status: _statusFromClient,
        ...quotePayload
      } = req.body as any;

      const finalStatus: "draft" = "draft";

      if (!hasCustomerId) {
        console.error("[QUOTE CREATE] missing customerId", { body: req.body });
        return res.status(400).json({ message: "Customer is required to save a quote" });
      }

      if (!hasLineItems) {
        console.error("[QUOTE CREATE] missing line items", { body: req.body });
        return res.status(400).json({ message: "At least one line item is required" });
      }

      const { customerId, contactId, customerName, source, lineItems } = quotePayload;

      // Basic validation: require customerId (or quick quote fallback) and at least one line item
      if (source !== "customer_quick_quote" && !customerId) {
        return res.status(400).json({
          success: false,
          message: "Customer is required to create a quote.",
        });
      }

      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one line item is required to create a quote.",
        });
      }

      // Determine final customerId based on source
      let finalCustomerId = customerId;

      if (source === 'customer_quick_quote') {
        // For customer quick quotes, ALWAYS ensure we have a customerId linked to the user
        try {
          finalCustomerId = await ensureCustomerForUser(userId);
          console.log(`[QuoteCreation] Customer quick quote - ensured customerId ${finalCustomerId} for user ${userId}`);
        } catch (error) {
          console.error('[QuoteCreation] Failed to ensure customer for user:', error);
          return res.status(500).json({
            message: "Failed to create customer record for quote. Please contact support."
          });
        }
      }

      // Load organization for tax settings
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(500).json({ message: "Organization not found" });
      }

      const orgTaxSettings = getOrganizationTaxSettings(org);

      // Load customer for tax calculation (if applicable)
      let customer = null;
      if (finalCustomerId) {
        [customer] = await db
          .select()
          .from(customers)
          .where(and(
            eq(customers.id, finalCustomerId),
            eq(customers.organizationId, organizationId)
          ))
          .limit(1);
      }

      // Load products for each line item to get isTaxable flag
      const rawLineItems = Array.isArray(lineItems) ? lineItems : [];
      const productIds = Array.from(new Set(rawLineItems.map((item: any) => item.productId)));
      const loadedProducts = productIds.length > 0
        ? await db
          .select()
          .from(products)
          .where(eq(products.id, productIds[0])) // Load all products we need
        : [];

      const productMap = new Map<string, typeof products.$inferSelect>();
      for (const productId of productIds) {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        if (product) {
          productMap.set(productId, product);
        }
      }

      // Prepare line items with tax info (including tax category for SaaS tax)
      const lineItemsForTaxCalc: LineItemInput[] = rawLineItems.map((item: any) => {
        const product = productMap.get(item.productId);
        return {
          productId: item.productId,
          variantId: item.variantId || null,
          linePrice: parseFloat(item.linePrice),
          isTaxable: product?.isTaxable ?? true,
          taxCategoryId: (item as any).taxCategoryId || null,
        };
      });

      // Get ship-to address from customer if available (for SaaS tax zones)
      const shipTo = customer
        ? {
          country: (customer as any).country || "US",
          state: (customer as any).state || org.settings?.timezone?.split("/")[0] || "CA",
          city: (customer as any).city,
          postalCode: (customer as any).postalCode,
        }
        : null;

      // Calculate totals with tax (async for SaaS tax zone lookup)
      const totalsResult = await calculateQuoteOrderTotals(
        lineItemsForTaxCalc,
        orgTaxSettings,
        customer,
        null, // shipFrom - use org address if needed later
        shipTo
      );

      // Validate each line item and merge tax data
      const validatedLineItems = rawLineItems.map((item: any, index: number) => {
        if (!item.productId || !item.productName || item.width == null || item.height == null || item.quantity == null || item.linePrice == null) {
          throw new Error("Missing required fields in line item");
        }

        const taxData = totalsResult.lineItemsWithTax[index];

        return {
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId || null,
          variantName: item.variantName || null,
          productType: item.productType || 'wide_roll',
          width: parseFloat(item.width),
          height: parseFloat(item.height),
          quantity: parseInt(item.quantity),
          specsJson: item.specsJson || null,
          selectedOptions: item.selectedOptions || [],
          linePrice: parseFloat(item.linePrice),
          priceBreakdown: item.priceBreakdown || {
            basePrice: parseFloat(item.linePrice),
            optionsPrice: 0,
            total: parseFloat(item.linePrice),
            formula: "",
          },
          materialUsages: item.priceBreakdown?.materialUsages || [],
          displayOrder: item.displayOrder || 0,
          // Line item enhancements (migration 0039, 0040)
          description: item.description || null,
          productionNotes: item.productionNotes || null,
          // Canonical routing intent (migration 0015)
          requiresDesign: item.requiresDesign === true,
          requiresPrepress: typeof item.requiresPrepress === 'boolean' ? item.requiresPrepress : null,
          // Tax fields (convert to string for storage)
          taxAmount: taxData.taxAmount.toString(),
          isTaxableSnapshot: taxData.isTaxableSnapshot,
        };
      });

      // Generate customer/shipping snapshot if customerId is provided
      let snapshotData: Record<string, any> = {};
      if (finalCustomerId) {
        try {
          snapshotData = await snapshotCustomerData(
            organizationId,
            finalCustomerId,
            contactId || null,
            quotePayload.shippingMethod || null,
            quotePayload.shippingMode || null
          );
        } catch (error) {
          console.error('[QuoteCreation] Snapshot failed:', error);
          // Continue without snapshot - fields will be null
        }
      }

      const quote = await storage.createQuote(organizationId, {
        ...quotePayload,
        userId,
        customerId: finalCustomerId,
        contactId: contactId || undefined,
        customerName: customerName || undefined,
        source: source || 'internal',
        status: finalStatus,
        label: quotePayload.label || undefined,
        lineItems: validatedLineItems,
        // Tax totals
        taxRate: totalsResult.taxRate,
        taxAmount: totalsResult.taxAmount,
        taxableSubtotal: totalsResult.taxableSubtotal,
        // Snapshot fields
        ...snapshotData,
        requestedDueDate: quotePayload.requestedDueDate || undefined,
        validUntil: quotePayload.validUntil || undefined,
        carrier: quotePayload.carrier || undefined,
        carrierAccountNumber: quotePayload.carrierAccountNumber || undefined,
        shippingInstructions: quotePayload.shippingInstructions || undefined,
      });

      // Upsert flags/tags into quote_list_notes if provided (same as UPDATE path)
      const { tags: rawTags, listLabel } = quotePayload;
      // Sanitize tags: trim and remove empty strings
      const tags = Array.isArray(rawTags) ? rawTags.map((s: any) => String(s).trim()).filter(Boolean) : rawTags;
      let normalizedListLabel: string | null | undefined = undefined;
      if (Array.isArray(tags)) {
        normalizedListLabel = tags.length > 0 
          ? tags.join(", ") || null
          : null;
      } else if (listLabel !== undefined) {
        normalizedListLabel = listLabel;
      }

      if (normalizedListLabel !== undefined) {
        try {
          await db
            .insert(quoteListNotes)
            .values({
              organizationId,
              quoteId: quote.id,
              listLabel: normalizedListLabel,
              updatedByUserId: userId || null,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [quoteListNotes.organizationId, quoteListNotes.quoteId],
              set: {
                listLabel: normalizedListLabel,
                updatedByUserId: userId || null,
                updatedAt: new Date(),
              },
            });
        } catch (listNoteError) {
          console.error('[QuoteCreation] Failed to upsert quote_list_notes:', listNoteError);
          // Don't fail the whole request if list note update fails
        }
      }

      res.json({
        success: true,
        data: {
          ...quote,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("[QUOTE CREATE] failed to create quote", {
        error,
        body: {
          status: req.body?.status,
          hasLineItems: Array.isArray(req.body?.lineItems),
          hasCustomerId: !!req.body?.customerId,
        },
      });
      res.status(500).json({ message: "Failed to create quote" });
    }
  });

  // Pending approvals endpoint - for approvers only
  app.get("/api/quotes/pending-approvals", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userRole = (req.user.role || '').toLowerCase();
      const isApprover = ['owner', 'admin', 'manager', 'employee'].includes(userRole);

      if (!isApprover) {
        return res.status(403).json({ error: "Only internal users can view pending approvals" });
      }

      // Query quotes with status='pending_approval' for this organization
      const pendingQuotes = await db
        .select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          customerName: quotes.customerName,
          customerId: quotes.customerId,
          contactId: quotes.contactId,
          totalPrice: quotes.totalPrice,
          createdAt: quotes.createdAt,
          userId: quotes.userId,
          status: quotes.status,
          // Customer details
          customerCompanyName: customers.companyName,
          // Contact details
          contactFirstName: customerContacts.firstName,
          contactLastName: customerContacts.lastName,
          contactEmail: customerContacts.email,
        })
        .from(quotes)
        .leftJoin(customers, eq(quotes.customerId, customers.id))
        .leftJoin(customerContacts, eq(quotes.contactId, customerContacts.id))
        .where(
          and(
            eq(quotes.organizationId, organizationId),
            eq(quotes.status, 'pending_approval')
          )
        )
        .orderBy(desc(quotes.createdAt));

      // Get quote IDs for audit log lookup
      const quoteIds = pendingQuotes.map(q => q.id);

      // Query audit logs to find who requested approval (most recent transition to pending_approval)
      const approvalRequestLogs = quoteIds.length > 0
        ? await db
          .select({
            entityId: auditLogs.entityId,
            userId: auditLogs.userId,
            userName: auditLogs.userName,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, organizationId),
              eq(auditLogs.entityType, 'quote'),
              inArray(auditLogs.entityId, quoteIds),
              sql`${auditLogs.description} LIKE '%to pending_approval%'`
            )
          )
          .orderBy(desc(auditLogs.createdAt))
        : [];

      // Create map of quoteId -> requester info (use most recent transition)
      const requestersMap = new Map<string, { userId: string | null; userName: string | null; requestedAt: Date }>();
      for (const log of approvalRequestLogs) {
        if (log.entityId && !requestersMap.has(log.entityId)) {
          requestersMap.set(log.entityId, {
            userId: log.userId,
            userName: log.userName,
            requestedAt: log.createdAt,
          });
        }
      }

      // Format response
      const formattedQuotes = pendingQuotes.map(q => {
        const requester = requestersMap.get(q.id);
        return {
          id: q.id,
          quoteNumber: q.quoteNumber,
          customerName: q.customerName || q.customerCompanyName || 'Unknown',
          customerId: q.customerId,
          contactName: q.contactFirstName && q.contactLastName
            ? `${q.contactFirstName} ${q.contactLastName}`.trim()
            : null,
          contactEmail: q.contactEmail,
          totalPrice: q.totalPrice,
          createdAt: q.createdAt,
          updatedAt: requester?.requestedAt || q.createdAt,
          requestedBy: requester?.userName || requester?.userId || 'Unknown',
          requestedAt: requester?.requestedAt || q.createdAt,
          status: q.status,
        };
      });

      res.json({
        success: true,
        data: formattedQuotes,
        count: formattedQuotes.length,
      });
    } catch (error) {
      console.error("Error fetching pending approvals:", error);
      res.status(500).json({ error: "Failed to fetch pending approvals" });
    }
  });

  app.get("/api/quotes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const userRole = req.user.role || 'employee';

      const pageRaw = req.query.page as string | undefined;
      const pageSizeRaw = req.query.pageSize as string | undefined;
      const includeThumbnailsRaw = req.query.includeThumbnails as string | undefined;
      const status = req.query.status as any;
      const sortBy = req.query.sortBy as string | undefined;
      const sortDir = (req.query.sortDir as string | undefined) === 'asc' ? 'asc' : 'desc';

      const filters = {
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minPrice: req.query.minPrice as string | undefined,
        maxPrice: req.query.maxPrice as string | undefined,
        userRole,
        source: req.query.source as string | undefined,
        status: status as any,
      };

      const hasPaging = pageRaw !== undefined || pageSizeRaw !== undefined;
      if (hasPaging) {
        const page = Math.max(1, parseInt(pageRaw || '1', 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw || '25', 10) || 25));
        const includeThumbnails = includeThumbnailsRaw === 'true' || includeThumbnailsRaw === '1';

        const result = await storage.getUserQuotesPaginated(organizationId, userId, {
          ...filters,
          sortBy,
          sortDir,
          page,
          pageSize,
          includeThumbnails,
        });

        return res.json(result);
      }

      const quotes = await storage.getUserQuotes(organizationId, userId, filters);
      return res.json(quotes);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  // CSV export for quotes list (all matching; ignores pagination)
  app.get("/api/quotes/export.csv", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const userRole = req.user.role || 'employee';

      const includeHeadersRaw = req.query.includeHeaders as string | undefined;
      const includeHeaders = includeHeadersRaw !== 'false' && includeHeadersRaw !== '0';
      const columnsRaw = (req.query.columns as string | undefined) || '';
      const columnKeys = columnsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const sortBy = req.query.sortBy as string | undefined;
      const sortDir = (req.query.sortDir as string | undefined) === 'asc' ? 'asc' : 'desc';
      const status = req.query.status as any;

      const filters = {
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minPrice: req.query.minPrice as string | undefined,
        maxPrice: req.query.maxPrice as string | undefined,
        userRole,
        source: req.query.source as string | undefined,
        status: status as any,
      };

      // Hard clamp for safety: this endpoint exports all matching.
      const pageSize = 200;
      let page = 1;
      let allItems: any[] = [];
      let totalPages = 1;

      // Page through results to avoid loading an unbounded array at once.
      do {
        const result = await storage.getUserQuotesPaginated(organizationId, userId, {
          ...filters,
          sortBy,
          sortDir,
          page,
          pageSize,
          includeThumbnails: false,
        });

        totalPages = result.totalPages;
        allItems = allItems.concat(result.items);
        page += 1;
      } while (page <= totalPages);

      const { buildCsv } = await import("@shared/csv");

      const defaultColumns: Array<{ key: string; label: string }> = [
        { key: 'quoteNumber', label: 'Quote #' },
        { key: 'label', label: 'Label' },
        { key: 'status', label: 'Status' },
        { key: 'date', label: 'Date' },
        { key: 'customer', label: 'Customer' },
        { key: 'items', label: 'Items' },
        { key: 'source', label: 'Source' },
        { key: 'createdBy', label: 'Created By' },
        { key: 'total', label: 'Total' },
      ];

      const selected = (columnKeys.length ? columnKeys : defaultColumns.map((c) => c.key))
        .map((key) => defaultColumns.find((c) => c.key === key) || { key, label: key });

      const headerRow = selected.map((c) => c.label);
      const rows = allItems.map((q) => {
        const workflowState = (q.workflowState || '') as string;
        const createdBy = q.user
          ? `${q.user.firstName || ''} ${q.user.lastName || ''}`.trim() || (q.user.email ?? '')
          : '';
        const date = q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : '';
        const itemsCount = (q.lineItemsCount ?? (q.lineItems?.length ?? 0)) as number;
        const total = q.totalPrice != null ? Number(q.totalPrice).toFixed(2) : '';

        const valueFor = (key: string) => {
          switch (key) {
            case 'quoteNumber':
              return q.quoteNumber ?? '';
            case 'label':
              return q.label ?? '';
            case 'status':
              return workflowState;
            case 'date':
              return date;
            case 'customer':
              return q.customerName ?? '';
            case 'items':
              return itemsCount;
            case 'source':
              return q.source ?? '';
            case 'createdBy':
              return createdBy;
            case 'total':
              return total;
            case 'thumbnails':
              return '';
            default:
              return '';
          }
        };

        return selected.map((c) => valueFor(c.key));
      });

      const csv = buildCsv([headerRow, ...rows], { includeHeaders });
      const timestamp = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="quotes-export-${timestamp}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Error exporting quotes CSV:", error);
      return res.status(500).json({ message: "Failed to export quotes" });
    }
  });

  app.get("/api/quotes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;

      // Internal users can access any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);

      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      res.json(quote);
    } catch (error) {
      console.error("Error fetching quote:", error);
      res.status(500).json({ message: "Failed to fetch quote" });
    }
  });

  app.patch("/api/quotes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;
      const {
        customerName,
        subtotal,
        taxRate,
        taxAmount,
        marginPercentage,
        discountAmount,
        totalPrice,
        customerId,
        contactId,
        shippingMethod,
        shippingMode,
        shippingCents,
        status,
        requestedDueDate,
        validUntil,
        carrier,
        carrierAccountNumber,
        shippingInstructions,
        shipToCompany,
        shipToName,
        shipToEmail,
        shipToPhone,
        shipToAddress1,
        shipToAddress2,
        shipToCity,
        shipToState,
        shipToPostalCode,
        shipToCountry,
        label,
        tags: rawTags,
        listLabel,
      } = req.body;

      // Sanitize tags: trim and remove empty strings
      const tags = Array.isArray(rawTags) ? rawTags.map((s: any) => String(s).trim()).filter(Boolean) : rawTags;

      // Normalize tags (array) or listLabel (string) for quote_list_notes storage
      let normalizedListLabel: string | null | undefined = undefined;
      if (Array.isArray(tags)) {
        // Frontend sends tags as array - convert to comma-separated string
        // Empty array means clear flags (set to null)
        normalizedListLabel = tags.length > 0 
          ? tags.join(", ") || null
          : null;
      } else if (listLabel !== undefined) {
        // Or use listLabel directly if provided
        normalizedListLabel = listLabel;
      }

      console.log(`[PATCH /api/quotes/${id}] Received update data:`, {
        customerName,
        subtotal,
        taxRate,
        marginPercentage,
        discountAmount,
        totalPrice,
        customerId,
        contactId,
        shippingMethod,
        shippingMode,
        status,
        taxAmount,
      });

      // Internal users can update any quote, customers only their own
      const existing = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, existing)) return;

      // If status is being changed, validate the transition
      if (status !== undefined && status !== existing.status) {
        if (!assertValidTransition(res, existing, status)) return;
      }

      // Determine if this is a partial metadata update (shipping, notes, labels, dates)
      // vs a full quote save (customer, line items, pricing)
      const isPartialUpdate = (
        // Only these fields are being updated (all optional/metadata fields)
        customerId === undefined &&
        customerName === undefined &&
        subtotal === undefined &&
        taxRate === undefined &&
        taxAmount === undefined &&
        totalPrice === undefined &&
        marginPercentage === undefined &&
        status === undefined
      );

      // Customer validation: only enforce for full quote saves, not partial metadata updates
      if (!isPartialUpdate) {
        if (customerId === null || customerId === undefined && !existing.customerId) {
          return res.status(400).json({ message: "Customer is required to save a quote." });
        }
      }

      // Check existing line items to ensure the quote has at least one
      const existingLineItems = await db
        .select()
        .from(quoteLineItems as any)
        .where(eq((quoteLineItems as any).quoteId, id));
      if (!existingLineItems || existingLineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required to save a quote." });
      }

      console.log(`[PATCH /api/quotes/${id}] Existing customerName:`, existing.customerName);

      // Determine if we need to refresh snapshots
      const customerChanged = customerId && customerId !== existing.customerId;
      const shippingMethodChanged = shippingMethod && shippingMethod !== existing.shippingMethod;
      const shippingModeChanged = shippingMode && shippingMode !== existing.shippingMode;
      const shouldRefreshSnapshot = customerChanged || shippingMethodChanged || shippingModeChanged;

      let snapshotData: Record<string, any> = {};
      if (shouldRefreshSnapshot) {
        const finalCustomerId = customerId || existing.customerId;
        const finalContactId = contactId !== undefined ? contactId : existing.contactId;
        const finalShippingMethod = shippingMethod || existing.shippingMethod;
        const finalShippingMode = shippingMode || existing.shippingMode;

        if (finalCustomerId) {
          try {
            snapshotData = await snapshotCustomerData(
              organizationId,
              finalCustomerId,
              finalContactId,
              finalShippingMethod,
              finalShippingMode
            );
            console.log(`[PATCH /api/quotes/${id}] Refreshed snapshot due to changes`);
          } catch (error) {
            console.error('[QuoteUpdate] Snapshot refresh failed:', error);
            // Continue without snapshot refresh
          }
        }
      }

      const updateData: Record<string, any> = {};
      
      // Only include fields that are explicitly provided (not undefined)
      // This prevents partial updates from clearing existing data
      if (customerId !== undefined) updateData.customerId = customerId ?? null;
      if (contactId !== undefined) updateData.contactId = contactId ?? null;
      if (customerName !== undefined) updateData.customerName = customerName;
      if (status !== undefined) updateData.status = status;
      if (subtotal !== undefined) updateData.subtotal = subtotal;
      if (taxRate !== undefined) updateData.taxRate = taxRate;
      if (taxAmount !== undefined) updateData.taxAmount = taxAmount;
      if (totalPrice !== undefined) updateData.totalPrice = totalPrice;
      if (marginPercentage !== undefined) updateData.marginPercentage = marginPercentage;
      if (discountAmount !== undefined) updateData.discountAmount = discountAmount;
      if (requestedDueDate !== undefined) updateData.requestedDueDate = requestedDueDate;
      if (validUntil !== undefined) updateData.validUntil = validUntil;
      if (carrier !== undefined) updateData.carrier = carrier;
      if (carrierAccountNumber !== undefined) updateData.carrierAccountNumber = carrierAccountNumber;
      if (shippingInstructions !== undefined) updateData.shippingInstructions = shippingInstructions;
      if (shippingCents !== undefined) updateData.shippingCents = shippingCents ?? null;
      if (shipToCompany !== undefined) updateData.shipToCompany = shipToCompany ?? null;
      if (shipToName !== undefined) updateData.shipToName = shipToName ?? null;
      if (shipToEmail !== undefined) updateData.shipToEmail = shipToEmail ?? null;
      if (shipToPhone !== undefined) updateData.shipToPhone = shipToPhone ?? null;
      if (shipToAddress1 !== undefined) updateData.shipToAddress1 = shipToAddress1 ?? null;
      if (shipToAddress2 !== undefined) updateData.shipToAddress2 = shipToAddress2 ?? null;
      if (shipToCity !== undefined) updateData.shipToCity = shipToCity ?? null;
      if (shipToState !== undefined) updateData.shipToState = shipToState ?? null;
      if (shipToPostalCode !== undefined) updateData.shipToPostalCode = shipToPostalCode ?? null;
      if (shipToCountry !== undefined) updateData.shipToCountry = shipToCountry ?? null;
      if (label !== undefined) updateData.label = label; // jobLabel
      if (shippingMethod !== undefined) updateData.shippingMethod = shippingMethod;
      if (shippingMode !== undefined) updateData.shippingMode = shippingMode;
      
      // Add snapshot data if customer/shipping changed
      Object.assign(updateData, snapshotData);

      if (process.env.NODE_ENV === 'development') {
        console.log(`[PATCH /api/quotes/${id}] updateData keys:`, Object.keys(updateData));
        console.log(`[PATCH /api/quotes/${id}] label value:`, updateData.label);
      }

      const updatedQuote = await storage.updateQuote(organizationId, id, updateData);

      // Upsert flags/tags into quote_list_notes if provided
      if (normalizedListLabel !== undefined) {
        try {
          await db
            .insert(quoteListNotes)
            .values({
              organizationId,
              quoteId: id,
              listLabel: normalizedListLabel,
              updatedByUserId: userId || null,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [quoteListNotes.organizationId, quoteListNotes.quoteId],
              set: {
                listLabel: normalizedListLabel,
                updatedByUserId: userId || null,
                updatedAt: new Date(),
              },
            });

          if (process.env.NODE_ENV === 'development') {
            console.log(`[PATCH /api/quotes/${id}] Upserted listLabel to quote_list_notes:`, {
              organizationId,
              quoteId: id,
              listLabel: normalizedListLabel,
            });
          }
        } catch (listNoteError) {
          console.error(`[PATCH /api/quotes/${id}] Failed to upsert quote_list_notes:`, listNoteError);
          // Don't fail the whole request if list note update fails
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.log(`[PATCH /api/quotes/${id}] No listLabel/tags to upsert (undefined)`);
      }

      console.log(`[PATCH /api/quotes/${id}] Updated customerName:`, updatedQuote.customerName);

      res.json(updatedQuote);
    } catch (error) {
      console.error("Error updating quote:", error);
      res.status(500).json({ message: "Failed to update quote" });
    }
  });

  // Quote List Notes (list-only annotations - always editable, not affected by quote lock)
  app.get("/api/quotes/:id/list-note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id: quoteId } = req.params;

      const [note] = await db
        .select()
        .from(quoteListNotes)
        .where(
          and(
            eq(quoteListNotes.organizationId, organizationId),
            eq(quoteListNotes.quoteId, quoteId)
          )
        )
        .limit(1);

      res.json({ listLabel: note?.listLabel || null });
    } catch (error) {
      console.error("Error fetching list note:", error);
      res.status(500).json({ message: "Failed to fetch list note" });
    }
  });

  app.put("/api/quotes/:id/list-note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const { id: quoteId } = req.params;
      const { listLabel } = req.body;

      // Verify quote exists and belongs to org
      const quote = await storage.getQuoteById(organizationId, quoteId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      // Upsert list note (always allowed, not affected by quote lock)
      const [updated] = await db
        .insert(quoteListNotes)
        .values({
          organizationId,
          quoteId,
          listLabel: listLabel || null,
          updatedByUserId: userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [quoteListNotes.organizationId, quoteListNotes.quoteId],
          set: {
            listLabel: listLabel || null,
            updatedByUserId: userId,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json({ success: true, listLabel: updated.listLabel });
    } catch (error) {
      console.error("Error updating list note:", error);
      res.status(500).json({ message: "Failed to update list note" });
    }
  });


  // Helper: Get organization preferences
  async function getOrgPreferences(organizationId: string): Promise<any> {
    try {
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) return {};
      return (org.settings as any)?.preferences || {};
    } catch (error) {
      console.error('[getOrgPreferences] Error:', error);
      return {};
    }
  }

  // Explicit status transition endpoint (POST /api/quotes/:id/transition)
  // Used for workflow actions like "Send", "Approve", "Reject", etc.
  app.post("/api/quotes/:id/transition", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "User not authenticated" });

      const userRole = req.user?.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);

      const { id: quoteId } = req.params;

      // Validate request body
      const validationResult = transitionRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid transition request",
          details: validationResult.error.errors
        });
      }

      const { toState, reason, overrideExpired } = validationResult.data;

      // Get organization preferences
      const preferences = await getOrgPreferences(organizationId);
      const requireApproval = preferences?.quotes?.requireApproval || false;

      // Permission gate: Only internal users can approve quotes
      if (toState === 'approved' && !isInternalUser) {
        return res.status(403).json({
          error: 'You do not have permission to approve quotes.'
        });
      }

      // Get existing quote
      const quote = await storage.getQuoteById(organizationId, quoteId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      // Get current workflow state
      const currentState = getQuoteWorkflowState(quote);

      // Enforce requireApproval preference: Block draft â†’ sent if approval is required
      if (requireApproval && currentState === 'draft' && toState === 'sent') {
        return res.status(403).json({
          error: 'Quote approval is required before sending. Ask an authorized user to approve, or use Approve & Send.'
        });
      }

      // Validate transition
      if (!isValidTransition(currentState, toState)) {
        const reason = getTransitionBlockReason(currentState, toState);
        return res.status(403).json({ error: reason });
      }

      // Convert workflow state to DB enum
      let newDbStatus: QuoteStatusDB;
      try {
        newDbStatus = workflowStateToDb(toState);
      } catch (error) {
        return res.status(400).json({
          error: `Cannot transition to derived state "${toState}"`
        });
      }

      // Special handling for expiration override
      if (currentState === 'expired' && !overrideExpired) {
        return res.status(403).json({
          error: "This quote has expired. Set overrideExpired=true to proceed."
        });
      }

      // Update quote status
      const updatedQuote = await storage.updateQuote(organizationId, quoteId, {
        status: newDbStatus as any
      });

      // Create timeline event
      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
          actionType: 'UPDATE',
          entityType: 'quote',
          entityId: quoteId,
          entityName: quote.quoteNumber?.toString() || quoteId,
          description: `Changed status from ${DB_TO_WORKFLOW[quote.status as QuoteStatusDB]} to ${toState}${reason ? ': ' + reason : ''}`,
          oldValues: { status: quote.status },
          newValues: { status: newDbStatus },
        });
      } catch (timelineError) {
        console.error('[TRANSITION] Failed to create timeline event:', timelineError);
        // Continue - don't fail the transition if timeline creation fails
      }

      res.json({
        success: true,
        data: {
          quote: updatedQuote,
          previousState: currentState,
          newState: toState,
          newDbStatus: newDbStatus,
        }
      });
    } catch (error) {
      console.error("Error transitioning quote status:", error);
      res.status(500).json({ message: "Failed to transition quote status" });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;

      // Internal users can delete any quote, customers only their own
      const existing = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, existing)) return;

      await storage.deleteQuote(organizationId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quote:", error);
      res.status(500).json({ message: "Failed to delete quote" });
    }
  });

  // =============================
  // Quote Workflow / Approval API
  // =============================

  // Get current workflow state for a quote
  app.get("/api/quotes/:id/workflow", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const quote = await storage.getQuoteById(organizationId, id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });
      const state = await storage.getQuoteWorkflowState(id);
      res.json({ success: true, data: state || null });
    } catch (error) {
      console.error('Error fetching quote workflow state:', error);
      res.status(500).json({ message: 'Failed to fetch workflow state' });
    }
  });

  // Staff request changes
  app.post("/api/quotes/:id/request-changes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userRole = req.user.role || 'customer';
      if (!['owner', 'admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can request changes.' });
      }
      const { id } = req.params;
      const { notes } = req.body;
      const quote = await storage.getQuoteById(organizationId, id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'change_requested', staffNotes: notes || null });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'change_requested', staffNotes: notes || null });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error requesting quote changes:', error);
      res.status(500).json({ message: 'Failed to request changes' });
    }
  });

  // Staff approve quote
  app.post("/api/quotes/:id/approve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userRole = req.user.role || 'customer';
      if (!['owner', 'admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can approve.' });
      }
      const { id } = req.params;
      const quote = await storage.getQuoteById(organizationId, id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'staff_approved', approvedByStaffUserId: getUserId(req.user) });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'staff_approved', approvedByStaffUserId: getUserId(req.user) });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error approving quote:', error);
      res.status(500).json({ message: 'Failed to approve quote' });
    }
  });

  // Staff reject quote
  app.post("/api/quotes/:id/reject", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userRole = req.user.role || 'customer';
      if (!['owner', 'admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: 'Only staff can reject.' });
      }
      const { id } = req.params;
      const { reason } = req.body;
      const quote = await storage.getQuoteById(organizationId, id);
      if (!quote) return res.status(404).json({ message: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;
      let state = await storage.getQuoteWorkflowState(id);
      if (!state) {
        state = await storage.createQuoteWorkflowState({ quoteId: id, status: 'rejected', rejectionReason: reason || null, rejectedByUserId: getUserId(req.user) });
      } else {
        state = await storage.updateQuoteWorkflowState(id, { status: 'rejected', rejectionReason: reason || null, rejectedByUserId: getUserId(req.user) });
      }
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error rejecting quote:', error);
      res.status(500).json({ message: 'Failed to reject quote' });
    }
  });

  const cloneQuoteToDraft = async (args: {
    tx: any;
    organizationId: string;
    userId: string;
    userName: string;
    sourceQuoteId: string;
    isInternalUser: boolean;
    operation: 'duplicate' | 'revise';
    includeArtwork: boolean;
  }) => {
    const {
      tx,
      organizationId,
      userId,
      userName,
      sourceQuoteId,
      isInternalUser,
      operation,
      includeArtwork,
    } = args;

    const whereParts = [
      eq(quotes.id, sourceQuoteId),
      eq(quotes.organizationId, organizationId),
    ];

    if (!isInternalUser) {
      whereParts.push(eq(quotes.userId, userId));
    }

    const sourceQuote = await tx
      .select()
      .from(quotes)
      .where(and(...whereParts))
      .limit(1)
      .then((rows: any[]) => rows[0]);

    if (!sourceQuote) {
      throw Object.assign(new Error('Quote not found'), { statusCode: 404 });
    }

    if (operation === 'revise') {
      const isApproved = String((sourceQuote as any).status) === 'active';
      const isConverted = !!(sourceQuote as any).convertedToOrderId;

      if (!isApproved && !isConverted) {
        throw Object.assign(new Error('Only approved or converted quotes can be revised.'), { statusCode: 409 });
      }
    }

    let quoteNumberVar = await tx
      .select()
      .from(globalVariables)
      .where(and(
        eq(globalVariables.name, 'next_quote_number'),
        eq(globalVariables.organizationId, organizationId)
      ))
      .limit(1)
      .then((rows: any[]) => rows[0]);

    if (!quoteNumberVar) {
      const [createdVar] = await tx
        .insert(globalVariables)
        .values({
          organizationId,
          name: 'next_quote_number',
          value: '1000',
          description: 'Next quote number sequence (auto-initialized)',
          category: 'numbering',
          isActive: true,
        })
        .returning();
      quoteNumberVar = createdVar;
    }

    const parsed = parseInt(String(quoteNumberVar.value), 10);
    const nextQuoteNumber = Number.isFinite(parsed) ? parsed : 1000;

    const [newQuote] = await tx
      .insert(quotes)
      .values({
        organizationId,
        quoteNumber: nextQuoteNumber,
        label: operation === 'duplicate' ? null : sourceQuote.label,
        userId: sourceQuote.userId,
        status: 'draft' as any,
        customerId: sourceQuote.customerId,
        contactId: sourceQuote.contactId,
        customerName: sourceQuote.customerName,
        source: sourceQuote.source,
        subtotal: sourceQuote.subtotal,
        taxRate: sourceQuote.taxRate,
        taxAmount: sourceQuote.taxAmount,
        taxableSubtotal: sourceQuote.taxableSubtotal,
        marginPercentage: sourceQuote.marginPercentage,
        discountAmount: sourceQuote.discountAmount,
        totalPrice: sourceQuote.totalPrice,

        billToName: sourceQuote.billToName,
        billToCompany: sourceQuote.billToCompany,
        billToAddress1: sourceQuote.billToAddress1,
        billToAddress2: sourceQuote.billToAddress2,
        billToCity: sourceQuote.billToCity,
        billToState: sourceQuote.billToState,
        billToPostalCode: sourceQuote.billToPostalCode,
        billToCountry: sourceQuote.billToCountry,
        billToPhone: sourceQuote.billToPhone,
        billToEmail: sourceQuote.billToEmail,

        shippingMethod: sourceQuote.shippingMethod,
        shippingMode: sourceQuote.shippingMode,
        shipToName: sourceQuote.shipToName,
        shipToCompany: sourceQuote.shipToCompany,
        shipToAddress1: sourceQuote.shipToAddress1,
        shipToAddress2: sourceQuote.shipToAddress2,
        shipToCity: sourceQuote.shipToCity,
        shipToState: sourceQuote.shipToState,
        shipToPostalCode: sourceQuote.shipToPostalCode,
        shipToCountry: sourceQuote.shipToCountry,
        shipToPhone: sourceQuote.shipToPhone,
        shipToEmail: sourceQuote.shipToEmail,
        carrier: sourceQuote.carrier,
        carrierAccountNumber: sourceQuote.carrierAccountNumber,
        shippingInstructions: sourceQuote.shippingInstructions,

        requestedDueDate: sourceQuote.requestedDueDate,
        validUntil: sourceQuote.validUntil,

        convertedToOrderId: null,
      } as any)
      .returning();

    await tx
      .update(globalVariables)
      .set({
        value: String(nextQuoteNumber + 1),
        updatedAt: new Date(),
      })
      .where(eq(globalVariables.id, quoteNumberVar.id));

    const sourceLineItems = await tx
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, sourceQuoteId))
      .orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.createdAt));

    const lineItemIdMap = new Map<string, string>();

    for (const li of sourceLineItems) {
      const [createdLi] = await tx
        .insert(quoteLineItems)
        .values({
          quoteId: newQuote.id,
          status: (li.status as any) ?? 'active',
          productId: li.productId,
          productName: li.productName,
          variantId: li.variantId,
          variantName: li.variantName,
          productType: li.productType,
          width: li.width,
          height: li.height,
          quantity: li.quantity,
          specsJson: li.specsJson,
          selectedOptions: li.selectedOptions as any,
          linePrice: li.linePrice,
          formulaLinePrice: (li as any).formulaLinePrice ?? null,
          priceOverride: (li as any).priceOverride ?? null,
          priceBreakdown: li.priceBreakdown as any,
          materialUsages: (li as any).materialUsages ?? [],
          taxAmount: (li as any).taxAmount ?? '0',
          isTaxableSnapshot: (li as any).isTaxableSnapshot ?? true,
          displayOrder: li.displayOrder,
          isTemporary: false,
          createdByUserId: li.createdByUserId ?? null,
          // Canonical routing intent (migration 0015) — preserved through clone/revise
          requiresDesign: (li as any).requiresDesign ?? false,
          requiresPrepress: (li as any).requiresPrepress ?? null,
        } as any)
        .returning();

      lineItemIdMap.set(li.id, createdLi.id);
    }

    if (includeArtwork) {
      const sourceAttachments = await tx
        .select()
        .from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.quoteId, sourceQuoteId),
          eq(quoteAttachments.organizationId, organizationId),
        ))
        .orderBy(asc(quoteAttachments.createdAt));

      for (const att of sourceAttachments) {
        const mappedLineItemId = att.quoteLineItemId
          ? (lineItemIdMap.get(att.quoteLineItemId) ?? null)
          : null;

        if (att.quoteLineItemId && !mappedLineItemId) {
          throw Object.assign(new Error('Attachment references a line item that could not be mapped.'), { statusCode: 500 });
        }

        const [createdAtt] = await tx
          .insert(quoteAttachments)
          .values({
            quoteId: newQuote.id,
            quoteLineItemId: mappedLineItemId,
            organizationId,
            fileRecordId: att.fileRecordId,
            uploadedByUserId: att.uploadedByUserId,
            uploadedByName: att.uploadedByName,

            fileName: att.fileName,
            fileUrl: att.fileUrl ?? null,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            description: att.description,

            originalFilename: att.originalFilename,
            storedFilename: att.storedFilename,
            relativePath: att.relativePath,
            storageProvider: att.storageProvider,
            extension: att.extension,
            sizeBytes: att.sizeBytes,
            checksum: att.checksum,

            thumbnailRelativePath: att.thumbnailRelativePath,
            thumbnailGeneratedAt: att.thumbnailGeneratedAt,
            thumbStatus: att.thumbStatus,
            thumbKey: att.thumbKey,
            previewKey: att.previewKey,
            thumbError: att.thumbError,

            pageCount: att.pageCount,
            pageCountStatus: att.pageCountStatus,
            pageCountError: att.pageCountError,
            pageCountUpdatedAt: att.pageCountUpdatedAt,

            bucket: att.bucket,
            updatedAt: new Date(),
          } as any)
          .returning();

        const { hasQuoteAttachmentPagesTable } = await import('./db');
        const pagesTableExists = hasQuoteAttachmentPagesTable();

        if (pagesTableExists === true) {
          try {
            const sourcePages = await tx
              .select()
              .from(quoteAttachmentPages)
              .where(and(
                eq(quoteAttachmentPages.attachmentId, att.id),
                eq(quoteAttachmentPages.organizationId, organizationId),
              ))
              .orderBy(asc(quoteAttachmentPages.pageIndex));

            for (const p of sourcePages) {
              await tx
                .insert(quoteAttachmentPages)
                .values({
                  organizationId,
                  attachmentId: createdAtt.id,
                  pageIndex: p.pageIndex,
                  thumbStatus: p.thumbStatus,
                  thumbFileRecordId: p.thumbFileRecordId,
                  thumbKey: null,
                  previewFileRecordId: p.previewFileRecordId,
                  previewKey: null,
                  thumbError: p.thumbError,
                  updatedAt: new Date(),
                } as any);
            }
          } catch (error: any) {
            const pgCode = error?.code;
            const logPrefix = operation === 'revise' ? '[ReviseQuote]' : '[DuplicateQuote]';
            if (pgCode === '42P01') {
              console.warn(`${logPrefix} Skipping attachment page copy: quote_attachment_pages missing (42P01)`);
            } else {
              console.error(`${logPrefix} Error copying attachment pages (non-fatal):`, error);
            }
          }
        } else {
          const logPrefix = operation === 'revise' ? '[ReviseQuote]' : '[DuplicateQuote]';
          console.log(`${logPrefix} Skipping attachment page copy: quote_attachment_pages table not available`);
        }
      }
    }

    const actionSuffix = operation === 'revise'
      ? ''
      : includeArtwork
        ? ' with artwork'
        : '';

    await tx.insert(auditLogs).values({
      organizationId,
      userId,
      userName,
      actionType: 'CREATE',
      entityType: 'quote',
      entityId: newQuote.id,
      entityName: newQuote.quoteNumber != null ? String(newQuote.quoteNumber) : undefined,
      description: operation === 'revise'
        ? `Created as revision of quote ${sourceQuote.quoteNumber ?? ''}`.trim()
        : `Created as duplicate of quote ${sourceQuote.quoteNumber ?? ''}${actionSuffix}`.trim(),
      newValues: operation === 'revise'
        ? { sourceQuoteId: sourceQuote.id, sourceQuoteNumber: sourceQuote.quoteNumber }
        : { sourceQuoteId: sourceQuote.id, sourceQuoteNumber: sourceQuote.quoteNumber, includeArtwork },
    } as any);

    await tx.insert(auditLogs).values({
      organizationId,
      userId,
      userName,
      actionType: 'UPDATE',
      entityType: 'quote',
      entityId: sourceQuote.id,
      entityName: sourceQuote.quoteNumber != null ? String(sourceQuote.quoteNumber) : undefined,
      description: operation === 'revise'
        ? `Revised to quote ${newQuote.quoteNumber ?? ''}`.trim()
        : `Duplicated to quote ${newQuote.quoteNumber ?? ''}${actionSuffix}`.trim(),
      newValues: operation === 'revise'
        ? { revisedQuoteId: newQuote.id, revisedQuoteNumber: newQuote.quoteNumber }
        : { duplicatedQuoteId: newQuote.id, duplicatedQuoteNumber: newQuote.quoteNumber, includeArtwork },
    } as any);

    return {
      id: newQuote.id,
      quoteNumber: newQuote.quoteNumber,
      includeArtwork,
    };
  };

  app.post("/api/quotes/:id/duplicate", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const userRole = req.user?.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const sourceQuoteId = req.params.id;
      const mode = req.body?.mode;

      if (mode !== 'quote_only' && mode !== 'quote_with_artwork') {
        return res.status(400).json({ message: 'Invalid duplicate mode. Expected quote_only or quote_with_artwork.' });
      }

      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || 'Unknown';

      const result = await db.transaction(async (tx) => cloneQuoteToDraft({
        tx,
        organizationId,
        userId,
        userName,
        sourceQuoteId,
        isInternalUser,
        operation: 'duplicate',
        includeArtwork: mode === 'quote_with_artwork',
      }));

      return res.json(result);
    } catch (error: any) {
      const status = error?.statusCode || 500;
      const message = error?.message || 'Failed to duplicate quote';
      console.error('[Quote:Duplicate] Error:', error);
      return res.status(status).json({ message });
    }
  });

  // Revise an approved quote: clone into a new editable draft
  app.post("/api/quotes/:id/revise", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const userRole = req.user?.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const sourceQuoteId = req.params.id;

      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || 'Unknown';

      const result = await db.transaction(async (tx) => cloneQuoteToDraft({
        tx,
        organizationId,
        userId,
        userName,
        sourceQuoteId,
        isInternalUser,
        operation: 'revise',
        includeArtwork: true,
      }));

      return res.json(result);
    } catch (error: any) {
      const status = error?.statusCode || 500;
      const message = error?.message || 'Failed to revise quote';
      console.error('[Quote:Revise] Error:', error);
      return res.status(status).json({ message });
    }
  });

  // Create a line item for an EXISTING quote (id in route)
  app.post("/api/quotes/:id/line-items", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;
      const lineItem = req.body;

      // Internal users can add line items to any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, quote)) return;

      // Validate required fields for pricing
      if (!lineItem.productId || lineItem.width == null || lineItem.height == null || lineItem.quantity == null) {
        return res.status(400).json({ message: "Missing required fields: productId, width, height, quantity" });
      }

      // Server-authoritative PBV2 pricing - call PricingService directly
      const { priceLineItem } = await import("./services/pricing/PricingService");
      
      const pricingResult = await priceLineItem({
        organizationId,
        productId: lineItem.productId,
        quantity: parseInt(lineItem.quantity),
        widthIn: parseFloat(lineItem.width),
        heightIn: parseFloat(lineItem.height),
        pbv2ExplicitSelections: lineItem.optionSelectionsJson?.selected || {},
        pbv2TreeVersionIdOverride: undefined, // Always use active tree for new line items
      });

      // Structured logging for PBV2 pricing persistence
      console.log(`[PBV2_PRICE_PERSIST] quoteId=${id} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

      const allowedStatus = ["draft", "active", "canceled"];
      const incomingStatus = allowedStatus.includes(lineItem.status) ? lineItem.status : "active";

      const validatedLineItem = {
        productId: lineItem.productId,
        productName: lineItem.productName || "New Item",
        variantId: lineItem.variantId || null,
        variantName: lineItem.variantName || null,
        productType: lineItem.productType || 'wide_roll',
        status: incomingStatus,
        width: parseFloat(lineItem.width),
        height: parseFloat(lineItem.height),
        quantity: parseInt(lineItem.quantity),
        specsJson: lineItem.specsJson || null,
        optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
        // PBV2 snapshot fields (server-authoritative from PricingService)
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        pricedAt: new Date(),
        selectedOptions: lineItem.selectedOptions || [],
        linePrice: pricingResult.lineTotalCents / 100, // Convert cents to dollars
        formulaLinePrice: null,
        priceOverride: null,
        priceBreakdown: {
          basePrice: pricingResult.breakdown.baseCents / 100,
          optionsPrice: pricingResult.breakdown.optionsCents / 100,
          total: pricingResult.lineTotalCents / 100,
          formula: "",
          nestingDetails: pricingResult.breakdown.nestingDetails ?? null,
          pricingMethod: pricingResult.breakdown.pricingMethod,
        },
        displayOrder: lineItem.displayOrder || 0,
        isTemporary: false,
        // Canonical routing intent (migration 0015)
        requiresDesign: lineItem.requiresDesign === true,
        requiresPrepress: typeof lineItem.requiresPrepress === 'boolean' ? lineItem.requiresPrepress : null,
      };

      const createdLineItem = await storage.addLineItem(id, validatedLineItem);
      res.json(createdLineItem);
    } catch (error) {
      console.error("Error adding line item:", error);
      res.status(500).json({ message: "Failed to add line item", error: (error as Error).message });
    }
  });

  // Create a TEMPORARY line item not yet tied to a saved quote
  // Used by the quote editor when working on a new quote or when
  // we want a lineItemId immediately for artwork uploads.
  app.post("/api/line-items/temp", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const {
        productId,
        productName,
        variantId,
        variantName,
        productType,
        width,
        height,
        quantity,
        specsJson,
        optionSelectionsJson,
        selectedOptions,
        displayOrder,
      } = req.body;

      if (!productId || typeof productId !== "string") {
        return res.status(400).json({ message: "productId is required for temporary line items" });
      }

      const widthNum = width != null ? Number(width) : 1;
      const heightNum = height != null ? Number(height) : 1;
      const quantityNum = quantity != null ? Number(quantity) : 1;

      if (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0) {
        return res.status(400).json({ message: "Invalid dimensions for pricing" });
      }

      // Server-authoritative PBV2 pricing - call PricingService directly
      const { priceLineItem } = await import("./services/pricing/PricingService");
      
      const pricingResult = await priceLineItem({
        organizationId,
        productId,
        quantity: quantityNum,
        widthIn: widthNum,
        heightIn: heightNum,
        pbv2ExplicitSelections: optionSelectionsJson?.selected || {},
        pbv2TreeVersionIdOverride: undefined, // Always use active tree
      });

      // Structured logging for PBV2 pricing persistence
      console.log(`[PBV2_PRICE_PERSIST] tempLineItem treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

      const validatedLineItem = {
        productId,
        productName: productName || "New Item (Select Product)",
        variantId: variantId || null,
        variantName: variantName || null,
        productType: productType || "wide_roll",
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        specsJson: specsJson || null,
        optionSelectionsJson: optionSelectionsJson ?? null,
        // PBV2 snapshot fields (server-authoritative from PricingService)
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        pricedAt: new Date(),
        selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
        linePrice: pricingResult.lineTotalCents / 100, // Convert cents to dollars
        formulaLinePrice: null,
        priceOverride: null,
        priceBreakdown: {
          basePrice: pricingResult.breakdown.baseCents / 100,
          optionsPrice: pricingResult.breakdown.optionsCents / 100,
          total: pricingResult.lineTotalCents / 100,
          formula: "",
          nestingDetails: pricingResult.breakdown.nestingDetails ?? null,
          pricingMethod: pricingResult.breakdown.pricingMethod,
        },
        displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      };

      const createdLineItem = await storage.createTemporaryLineItem(
        organizationId,
        userId,
        validatedLineItem
      );

      res.json({ success: true, data: createdLineItem });
    } catch (error) {
      console.error("Error creating temporary line item:", error);
      res.status(500).json({ message: "Failed to create temporary line item", error: (error as Error).message });
    }
  });

  app.patch("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id, lineItemId } = req.params;
      const lineItem = req.body;

      // Internal users can update line items in any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, quote)) return;

      const updateData: any = {};
      const allowedStatus = ["draft", "active", "canceled"];
      
      // Check if pricing-relevant fields changed (require repricing)
      const pricingFieldsChanged = 
        lineItem.productId !== undefined ||
        lineItem.width !== undefined ||
        lineItem.height !== undefined ||
        lineItem.quantity !== undefined ||
        lineItem.optionSelectionsJson !== undefined;

      if (pricingFieldsChanged) {
        // Server-authoritative repricing when pricing inputs change
        const { priceLineItem } = await import("./services/pricing/PricingService");
        
        // Get current line item to fill in missing fields
        const currentLineItem = quote.lineItems?.find((li: any) => li.id === lineItemId);
        if (!currentLineItem) {
          return res.status(404).json({ message: "Line item not found" });
        }

        const pricingResult = await priceLineItem({
          organizationId,
          productId: lineItem.productId ?? currentLineItem.productId,
          quantity: lineItem.quantity !== undefined ? parseInt(lineItem.quantity) : currentLineItem.quantity,
          widthIn: lineItem.width !== undefined ? parseFloat(lineItem.width) : parseFloat(currentLineItem.width),
          heightIn: lineItem.height !== undefined ? parseFloat(lineItem.height) : parseFloat(currentLineItem.height),
          pbv2ExplicitSelections: lineItem.optionSelectionsJson?.selected || currentLineItem.optionSelectionsJson?.selected || {},
          pbv2TreeVersionIdOverride: undefined, // Always reprice with active tree
        });

        // Structured logging for PBV2 pricing persistence
        console.log(`[PBV2_PRICE_PERSIST] quoteId=${id} lineItemId=${lineItemId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

        // Set server-authoritative PBV2 fields
        updateData.pbv2TreeVersionId = pricingResult.pbv2TreeVersionId;
        updateData.pbv2SnapshotJson = pricingResult.pbv2SnapshotJson;
        updateData.pricedAt = new Date();
        updateData.linePrice = pricingResult.lineTotalCents / 100;
        updateData.priceBreakdown = {
          basePrice: pricingResult.breakdown.baseCents / 100,
          optionsPrice: pricingResult.breakdown.optionsCents / 100,
          total: pricingResult.lineTotalCents / 100,
          formula: "",
          nestingDetails: pricingResult.breakdown.nestingDetails ?? null,
          pricingMethod: pricingResult.breakdown.pricingMethod,
        };
        updateData.formulaLinePrice = null;
        updateData.priceOverride = null;
      }

      // Apply other field updates
      if (lineItem.productId !== undefined) updateData.productId = lineItem.productId;
      if (lineItem.productName) updateData.productName = lineItem.productName;
      if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
      if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
      if (lineItem.productType !== undefined) updateData.productType = lineItem.productType;
      if (lineItem.status !== undefined && allowedStatus.includes(lineItem.status)) updateData.status = lineItem.status;
      if (lineItem.width !== undefined) updateData.width = parseFloat(lineItem.width);
      if (lineItem.height !== undefined) updateData.height = parseFloat(lineItem.height);
      if (lineItem.quantity !== undefined) updateData.quantity = parseInt(lineItem.quantity);
      if (lineItem.optionSelectionsJson !== undefined) updateData.optionSelectionsJson = lineItem.optionSelectionsJson;
      if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
      if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;
      if (lineItem.isTemporary !== undefined) updateData.isTemporary = lineItem.isTemporary;
      if (lineItem.quoteId !== undefined) updateData.quoteId = lineItem.quoteId;
      if (lineItem.isTemporary !== undefined) updateData.isTemporary = lineItem.isTemporary;
      if (lineItem.quoteId !== undefined) updateData.quoteId = lineItem.quoteId;
      // Line item enhancements (migrations 0039, 0040)
      if (lineItem.description !== undefined) updateData.description = lineItem.description;
      if (lineItem.productionNotes !== undefined) updateData.productionNotes = lineItem.productionNotes;
      // Canonical routing intent (migration 0015)
      if (lineItem.requiresDesign !== undefined) updateData.requiresDesign = lineItem.requiresDesign === true;
      if (lineItem.requiresPrepress !== undefined) updateData.requiresPrepress = typeof lineItem.requiresPrepress === 'boolean' ? lineItem.requiresPrepress : null;

      const updatedLineItem = await storage.updateLineItem(lineItemId, updateData);
      res.json(updatedLineItem);
    } catch (error) {
      console.error("Error updating line item:", error);
      res.status(500).json({ message: "Failed to update line item" });
    }
  });

  app.delete("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id, lineItemId } = req.params;

      // Internal users can delete line items from any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, quote)) return;

      await storage.deleteLineItem(lineItemId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting line item:", error);
      res.status(500).json({ message: "Failed to delete line item" });
    }
  });

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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Quote Line Item Attachments (per-line-item artwork)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Get attachments for a specific quote line item
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GET] quoteId=${quoteId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the line item exists and belongs to this quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:GET] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Query attachments by lineItemId only (not by quoteId) to ensure files uploaded
      // before quote persistence remain visible. Access control is via the line item validation above.
      const files = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .orderBy(desc(quoteAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      // PHASE 2: Include linked assets with enriched URLs
      const { assetRepository } = await import('./services/assets/AssetRepository');
      const { enrichAssetsWithRoles } = await import('./services/assets/enrichAssetWithUrls');
      const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'quote_line_item', lineItemId);
      const enrichedAssets = await enrichAssetsWithRoles(linkedAssets);

      console.log(`[LineItemFiles:GET] Found ${files.length} files + ${linkedAssets.length} assets for line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles, assets: enrichedAssets });
    } catch (error) {
      console.error("[LineItemFiles:GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Get attachments for a TEMPORARY line item (no quote yet)
  app.get("/api/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GET:Temp] lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Fetch files safely; empty result is acceptable
      const files = await db
        .select()
        .from(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.quoteLineItemId, lineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        )
        .orderBy(desc(quoteAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      console.log(`[LineItemFiles:GET:Temp] Found ${files.length} files for temp line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles });
    } catch (error) {
      console.error("[LineItemFiles:GET:Temp] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Attach file to a quote line item
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);

      // Validate quote belongs to org and enforce lock before any attachment writes
      const [quote] = await db.select({ id: quotes.id, status: quotes.status }).from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;

      const { uploadId, fileName, fileUrl, fileSize, mimeType, description, fileBuffer, originalFilename, storageTarget, requestedStorageTarget } = req.body;

      console.log(`[LineItemFiles:POST] quoteId=${quoteId}, lineItemId=${lineItemId}, fileName=${fileName}`);

      const requestedTarget =
        (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
        (typeof storageTarget === 'string' ? storageTarget : null);

      if (!uploadId && !fileName && !originalFilename) {
        return res.status(400).json({ error: "fileName or originalFilename is required" });
      }

      // Legacy flow requires fileUrl.
      if (!uploadId && !fileBuffer && !fileUrl) {
        return res.status(400).json({ error: "fileUrl is required for legacy uploads" });
      }

      // Validate the line item exists and belongs to this quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:POST] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Detect if this is a PDF (by mimeType or filename) - will be recalculated after attachment creation
      const resolvedUploadName = (originalFilename || fileName || "") as string;
      const isPdfEarly = (mimeType && mimeType.toLowerCase().includes('pdf')) ||
        (resolvedUploadName && resolvedUploadName.toLowerCase().endsWith('.pdf'));

      // Check if PDF processing columns exist (from startup probe)
      const { hasPageCountStatusColumn } = await import('./db');
      const pdfColumnsExist = hasPageCountStatusColumn() === true;

      if (isPdfEarly && !pdfColumnsExist) {
        console.warn(`[LineItemFiles:POST] PDF detected but page_count_status column missing; PDF processing disabled for ${fileName}`);
      }

      const baseAttachmentData = {
        quoteId,
        quoteLineItemId: lineItemId,
        organizationId,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        description: description || null,
        bucket: 'titan-private',
      } as const;

      const defaultThumbStatus = isPdfEarly ? ('thumb_pending' as const) : ('uploaded' as const);
      const defaultPageCountStatus = pdfColumnsExist ? (isPdfEarly ? ('detecting' as const) : ('unknown' as const)) : null;
      const isExternalUrl = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'));

      let canonicalUpload: Awaited<ReturnType<typeof storageApplicationService.finalizeUpload<any>>> | null = null;

      if (uploadId && typeof uploadId === 'string') {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'upload-session',
            uploadId,
            expectedPurpose: 'quote-attachment',
            expectedParentId: quoteId,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      } else if (fileBuffer && resolvedUploadName) {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'buffer',
            buffer: Buffer.from(fileBuffer, 'base64'),
            originalFilename: resolvedUploadName,
            mimeType: (mimeType || 'application/octet-stream') as string,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      } else if (fileUrl && !isExternalUrl) {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'existing-key',
            fileUrl: normalizeObjectKeyForDb(fileUrl),
            originalFilename: resolvedUploadName,
            mimeType: mimeType || null,
            fileSize: fileSize || null,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      }

      console.log(`[LineItemFiles:POST] Inserting attachment with quoteLineItemId=${lineItemId}`);
      const attachment = canonicalUpload
        ? canonicalUpload.linkedRecord
        : (await db.insert(quoteAttachments).values({
            ...baseAttachmentData,
            fileRecordId: null,
            fileName: resolvedUploadName,
            originalFilename: resolvedUploadName,
            fileUrl,
            relativePath: null,
            fileSize: fileSize || null,
            mimeType: mimeType || null,
            storageProvider: undefined,
            thumbStatus: defaultThumbStatus,
            pageCountStatus: defaultPageCountStatus,
          }).returning())[0];

      const canonicalOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const canonicalStorageKey = canonicalOriginal?.objectKey ?? canonicalOriginal?.localPathRef ?? null;
      const canonicalStorageProvider = canonicalOriginal?.providerType
        ?? (canonicalOriginal?.localPathRef ? 'local_filesystem' : canonicalOriginal?.objectKey ? 'supabase' : null);

      // Best-effort self-check for Supabase-backed keys (non-blocking)
      if (canonicalStorageProvider === 'supabase' && canonicalStorageKey) {
        res.on('finish', () => {
          scheduleSupabaseObjectSelfCheck({
            bucket: 'titan-private',
            path: canonicalStorageKey,
            context: { attachmentType: 'quote', quoteId, lineItemId, attachmentId: attachment.id },
          });
        });
      }

      console.log(`[LineItemFiles:POST] Saved attachment storageProvider=${attachment.storageProvider || 'none'} storageKey=${attachment.fileUrl || 'null'}`);
      console.log(`[LineItemFiles:POST] Created attachment id=${attachment.id}, quoteLineItemId=${attachment.quoteLineItemId}`);

      // PHASE 2: Create asset + link (fail-soft: errors logged but don't block response)
      try {
        const { assetRepository } = await import('./services/assets/AssetRepository');
        const { assetPreviewGenerator } = await import('./services/assets/AssetPreviewGenerator');
        const asset = await assetRepository.createAsset(organizationId, {
          fileRecordId: attachment.fileRecordId ?? null,
          fileKey: attachment.fileRecordId ? null : attachment.fileUrl,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType || undefined,
          sizeBytes: attachment.fileSize || undefined,
        });
        await assetRepository.linkAsset(organizationId, asset.id, 'quote_line_item', lineItemId, 'primary');
        console.log(`[LineItemFiles:POST] Created asset ${asset.id} + linked to quote_line_item ${lineItemId}`);

        setImmediate(() => {
          assetPreviewGenerator.generatePreviews(asset).catch((err) => {
            console.error('[AssetPreviewGenerator] async generatePreviews failed', err);
          });
        });
      } catch (assetError) {
        console.error(`[LineItemFiles:POST] Asset creation failed (non-blocking):`, assetError);
      }

      // Robust PDF detection using both mimeType and filename
      const attachmentFileName =
        (attachment.originalFilename ?? attachment.fileName ?? '').toString();

      const isPdfByMime = (attachment.mimeType ?? '').toLowerCase().includes('pdf');
      const isPdfByName = attachmentFileName.toLowerCase().endsWith('.pdf');
      const isPdf = isPdfByMime || isPdfByName;

      // Best-effort AI detection for PDF-compatible .ai files.
      // IMPORTANT: Do not treat all postscript as AI (avoid .eps); require .ai extension unless mime is explicitly illustrator.
      const lowerMimeType = (attachment.mimeType ?? '').toLowerCase();
      const isAiByName = attachmentFileName.toLowerCase().endsWith('.ai');
      const isAiByMime = /illustrator/i.test(lowerMimeType) || (/postscript/i.test(lowerMimeType) && isAiByName);
      const isAi = isAiByName || isAiByMime;

      const hasStorageProvider = !!canonicalStorageProvider;
      const isNotHttpUrl = !!canonicalStorageKey;

      console.log('[LineItemFiles:POST][Detect]', {
        attachmentId: attachment.id,
        fileName: attachmentFileName,
        mimeType: attachment.mimeType ?? null,
        storageProvider: canonicalStorageProvider ?? attachment.storageProvider ?? null,
        fileUrl: canonicalStorageKey ?? attachment.fileUrl ?? null,
        isPdfByMime,
        isPdfByName,
        isPdf,
        isAiByName,
        isAiByMime,
        isAi,
        hasStorageProvider,
        isNotHttpUrl,
        pdfColumnsExist,
      });

      // Fire-and-forget thumbnail generation for images (non-blocking)
      // Use isSupportedImageType helper which supports both mimeType and fileName-based detection
      const { isSupportedImageType } = await import('./services/thumbnailGenerator');
      const attachmentFileNameForThumb = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, attachmentFileNameForThumb);

      if (isSupportedImage && hasStorageProvider && isNotHttpUrl && canonicalStorageKey && canonicalStorageProvider) {
        const { generateImageDerivatives, isThumbnailGenerationEnabled } = await import('./services/thumbnailGenerator');
        if (isThumbnailGenerationEnabled()) {
          void generateImageDerivatives(
            attachment.id,
            'quote',
            canonicalStorageKey,
            attachment.mimeType || null,
            canonicalStorageProvider,
            organizationId,
            attachmentFileNameForThumb
          ).catch((error) => {
            // Errors are already logged inside generateImageDerivatives
            // This catch prevents unhandled promise rejection
            console.error(`[LineItemFiles:POST] Thumbnail generation failed for ${attachment.id}:`, error);
          });
        } else {
          console.log(`[LineItemFiles:POST] Thumbnail generation disabled, skipping for ${attachment.id}`);
        }
      } else if (isSupportedImage && (!hasStorageProvider || !isNotHttpUrl)) {
        console.log(`[LineItemFiles:POST] Skipping thumbnail generation for ${attachment.id}: canonicalStorageProvider=${canonicalStorageProvider}, canonicalStorageKey=${canonicalStorageKey}`);
      }

      // Fire-and-forget PDF processing for PDFs (non-blocking)
      // Trigger AFTER response finishes to ensure upload completes successfully first
      // Normalize storageProvider: if missing but Supabase is configured and fileUrl starts with "uploads/", treat as supabase
      const normalizedStorageProvider = canonicalStorageProvider;

      if (isPdf || isAi) {
        if (!pdfColumnsExist) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but pdf columns missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!normalizedStorageProvider) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but storageProvider missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!isNotHttpUrl) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl is http(s); skipping processing for attachmentId=${attachment.id}`);
        } else if (!canonicalStorageKey) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl missing; skipping processing for attachmentId=${attachment.id}`);
        } else {
          console.log(`[LineItemFiles:POST] PDF/AI detected; queued processing for attachmentId=${attachment.id}, fileName=${attachmentFileName}`);
          const attachmentStorageKey = canonicalStorageKey;

          res.on("finish", () => {
            setImmediate(() => {
              void (async () => {
                try {
                  console.log(`[LineItemFiles:POST] Starting PDF processing for attachmentId=${attachment.id}`);
                  const { processPdfAttachmentDerivedData } = await import('./services/pdfProcessing');
                  await processPdfAttachmentDerivedData({
                    orgId: organizationId,
                    attachmentId: attachment.id,
                    storageKey: attachmentStorageKey,
                    storageProvider: normalizedStorageProvider,
                    mimeType: attachment.mimeType || null,
                  });
                } catch (error: any) {
                  // Errors are already logged inside processPdfAttachmentDerivedData
                  // This catch prevents unhandled promise rejection and server crashes
                  console.error(`[LineItemFiles:POST] PDF kickoff failed for ${attachment.id}:`, error);
                }
              })();
            });
          });
        }
      }

      const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
      res.json({ success: true, data: enrichedAttachment });
    } catch (error: any) {
      console.error("[LineItemFiles:POST] Error:", error);
      // Provide useful error message without leaking sensitive details
      const errorDetail = error.message?.substring(0, 200) || 'Unknown error';
      res.status(500).json({
        success: false,
        message: "Failed to attach file to line item",
        detail: errorDetail
      });
    }
  });

  // Delete attachment from a quote line item
  // Download a line item attachment (quote-scoped) - returns signed URL
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:DOWNLOAD] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate the line item belongs to this quote (access control)
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:DOWNLOAD] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get the attachment by fileId and lineItemId only (not quoteId) to support files
      // uploaded before quote persistence. Access control is via line item validation above.
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:DOWNLOAD] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ success: false, error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      const signedUrl = resolved.downloadUrl;
      const fileName = resolved.displayFilename;

      console.log(`[LineItemFiles:DOWNLOAD] Generated signed URL for file ${fileId}, fileName: ${fileName}`);

      return res.json({ success: true, data: { signedUrl, fileName } });
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD] Error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to generate download URL" });
    }
  });

  // Proxy download endpoint - streams file with correct filename in Content-Disposition header
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download/proxy", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      return res.redirect(resolved.downloadUrl);
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD:PROXY] Error:", error);
      return res.status(500).json({ error: error.message || "Failed to download file" });
    }
  });

  // Get derived assets (thumbnails/previews) for an attachment - returns signed URLs
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/assets", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:ASSETS] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:ASSETS] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:ASSETS] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const derivativeLogOnce = createRequestLogOnce();
      const [thumbAccess, previewAccess] = await Promise.all([
        resolveDerivativeFileAccess(attachment, "thumbnail", { logOnce: derivativeLogOnce }),
        resolveDerivativeFileAccess(attachment, "preview", { logOnce: derivativeLogOnce }),
      ]);

      console.log(`[LineItemFiles:ASSETS] Returning assets for file ${fileId}, thumbStatus=${attachment.thumbStatus}`);

      return res.json({
        success: true,
        data: {
          thumbUrl: thumbAccess.url,
          previewUrl: previewAccess.url,
          thumbStatus: attachment.thumbStatus || 'uploaded',
        },
      });
    } catch (error: any) {
      console.error("[LineItemFiles:ASSETS] Error:", error);
      return res.status(500).json({ error: error.message || "Failed to get attachment assets" });
    }
  });

  // Generate thumbnails for an attachment (explicit user action, images only)
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-thumbnails", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GENERATE_THUMBS] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ success: false, message: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Attachment not found or access denied`);
        return res.status(404).json({ success: false, message: "Attachment not found" });
      }

      // Import thumbnail generator utilities
      const thumbnailModule = await import('./services/thumbnailGenerator');
      const { generateImageDerivatives, isThumbnailGenerationEnabled, isSupportedImageType } = thumbnailModule;

      // Check feature flag
      if (!isThumbnailGenerationEnabled()) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Thumbnail generation disabled via THUMBNAILS_ENABLED env var`);
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation is currently disabled",
          message: "Thumbnail generation is disabled. Please enable it via THUMBNAILS_ENABLED environment variable."
        });
      }

      // Check sharp availability at runtime (same as thumbnailGenerator uses)
      const sharpAvailable = await thumbnailModule.ensureSharp();
      if (!sharpAvailable) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] sharp not available - returning 503`);
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation temporarily unavailable",
          message: "Thumbnail generation requires sharp package to be installed"
        });
      }

      // Handle PDFs - disabled (no pdfjs/canvas deps)
      if (attachment.mimeType === 'application/pdf') {
        console.log(`[LineItemFiles:GENERATE_THUMBS] PDF thumbnail generation disabled (no pdf deps)`);
        return res.status(501).json({
          success: false,
          message: "PDF thumbnails are disabled (no pdf deps installed yet)"
        });
      }

      // Check if it's a supported image type (uses mimeType and fileName fallback)
      const fileName = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, fileName);

      if (!isSupportedImage) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Unsupported file type: mimeType=${attachment.mimeType}, fileName=${fileName}`);
        return res.status(400).json({
          success: false,
          message: "Unsupported file type for thumbnail generation"
        });
      }

      console.log(`[LineItemFiles:GENERATE_THUMBS] Supported image type detected: mimeType=${attachment.mimeType}, fileName=${fileName}`);

      const resolvedOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const attachmentStorageKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? attachment.fileUrl ?? null;
      const attachmentStorageProvider = resolvedOriginal?.providerType === 'local_filesystem'
        ? 'local'
        : resolvedOriginal?.providerType === 's3'
          ? 's3'
          : resolvedOriginal?.providerType === 'gcs'
            ? 'gcs'
            : resolvedOriginal?.providerType === 'azure_blob'
              ? 'azure_blob'
              : resolvedOriginal?.providerType === 'titan_managed'
                ? 'titan_managed'
                : resolvedOriginal?.providerType === 'supabase'
                  ? 'supabase'
                  : attachment.storageProvider ?? null;

      // Validate required fields for image generation
      if (!attachmentStorageKey || !attachmentStorageProvider) {
        return res.status(400).json({
          success: false,
          message: "Attachment missing required storage information"
        });
      }

      // Set status to pending
      await db.update(quoteAttachments)
        .set({
          thumbStatus: 'thumb_pending',
          thumbError: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteAttachments.id, fileId));

      const attachmentFileName = attachment.originalFilename || attachment.fileName || null;
      console.log(`[LineItemFiles:GENERATE_THUMBS] Queuing thumbnail generation for ${fileId} (sharp available: ${sharpAvailable})`);

      // Trigger async thumbnail generation (fire-and-forget)
      void generateImageDerivatives(
        fileId,
        'quote',
        attachmentStorageKey,
        attachment.mimeType,
        attachmentStorageProvider,
        organizationId,
        attachmentFileName
      ).catch((error) => {
        // Errors are already logged inside generateImageDerivatives
        console.error(`[LineItemFiles:GENERATE_THUMBS] Thumbnail generation failed for ${fileId}:`, error);
      });

      // Return 202 immediately (processing queued)
      return res.status(202).json({
        success: true,
        message: "Thumbnail generation queued"
      });
    } catch (error: any) {
      console.error("[LineItemFiles:GENERATE_THUMBS] Error:", error);

      // Only update DB with failure if this was a real processing error (not unavailable/disabled)
      // For 503/unavailable errors, don't mark as failed since the feature is not available
      const isUnavailableError = error.code === 'THUMBNAILS_UNAVAILABLE' ||
        error.message?.includes('disabled') ||
        error.message?.includes('unavailable') ||
        error.statusCode === 503;

      if (!isUnavailableError) {
        try {
          const { fileId } = req.params;
          await db.update(quoteAttachments)
            .set({
              thumbStatus: 'thumb_failed',
              thumbError: error.message?.substring(0, 500) || 'Thumbnail generation failed',
              updatedAt: new Date(),
            })
            .where(eq(quoteAttachments.id, fileId));
        } catch (dbError) {
          console.error("[LineItemFiles:GENERATE_THUMBS] Failed to update error status:", dbError);
        }
      }

      // Return appropriate status code and format based on error type
      if (isUnavailableError) {
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation temporarily unavailable",
          message: error.message || "Thumbnail generation temporarily unavailable - dependencies not installed"
        });
      }

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to generate thumbnails"
      });
    }
  });

  // Generate PDF page thumbnails - TEMPORARILY DISABLED
  // Dependencies (pdfjs-dist, canvas) not yet installed
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-pdf-thumbnails", isAuthenticated, tenantContext, async (req: any, res) => {
    return res.status(501).json({
      error: "PDF thumbnail generation temporarily unavailable",
      message: "Feature requires additional dependencies to be installed"
    });
  });

  // Download a line item attachment (temp line items) - returns signed URL
  app.get("/api/line-items/:lineItemId/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      const userId = req.user.id;
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:DOWNLOAD:TEMP] lineItemId=${lineItemId}, fileId=${fileId}`);

      // Get the attachment and verify it belongs to a temp line item owned by this user
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId),
          eq(quoteAttachments.uploadedByUserId, userId),
          isNull(quoteAttachments.quoteId) // Temp items have null quoteId
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:DOWNLOAD:TEMP] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ success: false, error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      const signedUrl = resolved.downloadUrl;

      console.log(`[LineItemFiles:DOWNLOAD:TEMP] Generated signed URL for file ${fileId}`);

      return res.json({ success: true, data: { signedUrl, fileName: resolved.displayFilename, availabilityStatus: resolved.availabilityStatus } });
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD:TEMP] Error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to generate download URL" });
    }
  });

  app.delete("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate quote belongs to org and enforce lock before any attachment deletes
      const [quote] = await db.select({ id: quotes.id, status: quotes.status }).from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;

      console.log(`[LineItemFiles:DELETE] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate the line item belongs to this quote (access control)
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:DELETE] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get the attachment by fileId and lineItemId only (not quoteId) to support files
      // uploaded before quote persistence. Access control is via line item validation above.
      const [existingAttachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!existingAttachment) {
        console.log(`[LineItemFiles:DELETE] Attachment not found or doesn't match params`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const pagePagesTableState = hasQuoteAttachmentPagesTable();
      const pageDerivativeRows = pagePagesTableState === true
        ? await db
            .select({
              thumbFileRecordId: quoteAttachmentPages.thumbFileRecordId,
              thumbKey: quoteAttachmentPages.thumbKey,
              previewFileRecordId: quoteAttachmentPages.previewFileRecordId,
              previewKey: quoteAttachmentPages.previewKey,
            })
            .from(quoteAttachmentPages)
            .where(and(
              eq(quoteAttachmentPages.attachmentId, existingAttachment.id),
              eq(quoteAttachmentPages.organizationId, organizationId),
            ))
        : [];

      console.log('[LineItemFiles:DELETE] page derivative preload', {
        quoteId,
        lineItemId,
        attachmentId: existingAttachment.id,
        fileRecordId: existingAttachment.fileRecordId ?? null,
        pagesTableState: pagePagesTableState,
        pageDerivativeRowCount: pageDerivativeRows.length,
        pageDerivativeRows: pageDerivativeRows.map((row) => ({
          thumbFileRecordId: row.thumbFileRecordId ?? null,
          thumbKey: row.thumbKey ?? null,
          previewFileRecordId: row.previewFileRecordId ?? null,
          previewKey: row.previewKey ?? null,
        })),
      });

      // Delete from database (and validate it actually deleted)
      const deleted = await db.delete(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .returning({ id: quoteAttachments.id });

      if (!deleted.length) {
        console.log(`[LineItemFiles:DELETE] Delete affected 0 rows`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      console.log(`[LineItemFiles:DELETE] Deleted attachment id=${fileId}`);

      // Best-effort cleanup of stored objects and linked assets (do not fail request if cleanup fails)
      try {
        const resolvedOriginal = existingAttachment.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(existingAttachment.fileRecordId))
          : null;
        const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? existingAttachment.fileUrl ?? '');
        const storageProvider = resolvedOriginal?.providerType === 'local_filesystem'
          ? 'local'
          : resolvedOriginal?.providerType === 's3'
            ? 's3'
            : resolvedOriginal?.providerType === 'gcs'
              ? 'gcs'
              : resolvedOriginal?.providerType === 'azure_blob'
                ? 'azure_blob'
                : resolvedOriginal?.providerType === 'titan_managed'
                  ? 'titan_managed'
                  : resolvedOriginal?.providerType === 'supabase'
                    ? 'supabase'
                    : ((existingAttachment.storageProvider as 'local' | 's3' | 'gcs' | 'supabase' | 'azure_blob' | 'titan_managed' | null | undefined) ?? null);

        if (storageKey) {
          const [{ quoteRefs = 0 } = {}] = existingAttachment.fileRecordId
            ? await db
                .select({ quoteRefs: sql<number>`count(*)` })
                .from(quoteAttachments)
                .where(
                  and(
                    eq(quoteAttachments.organizationId, organizationId),
                    eq(quoteAttachments.fileRecordId, String(existingAttachment.fileRecordId))
                  )
                )
            : !storageProvider
              ? [{ quoteRefs: 0 }]
              : await db
                  .select({ quoteRefs: sql<number>`count(*)` })
                  .from(quoteAttachments)
                  .where(
                    and(
                      eq(quoteAttachments.organizationId, organizationId),
                      eq(quoteAttachments.fileUrl, storageKey),
                      eq(quoteAttachments.storageProvider, toLegacyStorageProvider(storageProvider) ?? 'supabase')
                    )
                  );

          const [{ orderRefs = 0 } = {}] = existingAttachment.fileRecordId
            ? await db
                .select({ orderRefs: sql<number>`count(*)` })
                .from(orderAttachments)
                .where(eq(orderAttachments.fileRecordId, String(existingAttachment.fileRecordId)))
            : !storageProvider
              ? [{ orderRefs: 0 }]
              : await db
                  .select({ orderRefs: sql<number>`count(*)` })
                  .from(orderAttachments)
                  .where(
                    and(
                      eq(orderAttachments.fileUrl, storageKey),
                      eq(orderAttachments.storageProvider, toLegacyStorageProvider(storageProvider) ?? 'supabase')
                    )
                  );

          let hasRemainingAssetLinksForFile = false;
          const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

          try {
            const matchingAssets = existingAttachment.fileRecordId
              ? await db
                  .select({ id: assets.id })
                  .from(assets)
                  .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(existingAttachment.fileRecordId))))
              : await db
                  .select({ id: assets.id })
                  .from(assets)
                  .where(and(eq(assets.organizationId, organizationId), eq(assets.fileKey, normalizedFileKey)));

            if (matchingAssets.length > 0) {
              await Promise.all(
                matchingAssets.map((asset) =>
                  db
                    .delete(assetLinks)
                    .where(
                      and(
                        eq(assetLinks.organizationId, organizationId),
                        eq(assetLinks.assetId, asset.id),
                        eq(assetLinks.parentType, 'quote_line_item'),
                        eq(assetLinks.parentId, lineItemId)
                      )
                    )
                )
              );

          console.log('[LineItemFiles:DELETE] final cleanup gate', {
            quoteId,
            lineItemId,
            attachmentId: existingAttachment.id,
            fileRecordId: existingAttachment.fileRecordId ?? null,
            storageKey,
            storageProvider,
            quoteRefs: Number(quoteRefs),
            orderRefs: Number(orderRefs),
          });

              const linkCounts = await Promise.all(
                matchingAssets.map(async (asset) => {
                  const [{ cnt = 0 } = {}] = await db
                    .select({ cnt: sql<number>`count(*)` })
                    .from(assetLinks)
                    .where(and(eq(assetLinks.organizationId, organizationId), eq(assetLinks.assetId, asset.id)));
                  return Number(cnt);
                })
              );

              hasRemainingAssetLinksForFile = linkCounts.some((count) => count > 0);

              if (!hasRemainingAssetLinksForFile && Number(quoteRefs) + Number(orderRefs) === 0) {
                for (const asset of matchingAssets) {
                  const variants = await db
                    .select({ key: assetVariants.key })
                    .from(assetVariants)
                    .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, asset.id)));

                  await deleteStoredObjectKeys({
                    fileRecordId: existingAttachment.fileRecordId ? String(existingAttachment.fileRecordId) : null,
                    legacyStorageProvider: toLegacyStorageProvider(storageProvider),
                    keys: [...variants.map((variant) => variant.key || ''), normalizedFileKey],
                  });

                  await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                }
              }
            }
          } catch (assetCleanupError) {
            console.error('[LineItemFiles:DELETE] Asset cleanup failed (non-blocking):', assetCleanupError);
          }

          if (Number(quoteRefs) + Number(orderRefs) === 0 && !hasRemainingAssetLinksForFile && storageProvider) {
            const derivativeRows = existingAttachment.fileRecordId
              ? await fileDerivativeRepository.listByFileRecordId(String(existingAttachment.fileRecordId))
              : [];
            const derivativeKeys = existingAttachment.fileRecordId
              ? derivativeRows.map((row) => row.objectKey ?? null)
              : [existingAttachment.thumbnailRelativePath ?? existingAttachment.thumbKey ?? null, existingAttachment.previewKey ?? null];

            const derivativeDeletion = await deleteStoredObjectKeys({
              fileRecordId: existingAttachment.fileRecordId ? String(existingAttachment.fileRecordId) : null,
              legacyStorageProvider: toLegacyStorageProvider(storageProvider),
              keys: [storageKey, ...derivativeKeys],
            });

            console.log('[LineItemFiles:DELETE] top-level derivative cleanup result', {
              quoteId,
              lineItemId,
              attachmentId: existingAttachment.id,
              keys: [storageKey, ...derivativeKeys],
              deletedKeys: derivativeDeletion.deletedKeys,
              failedKeys: derivativeDeletion.failedKeys,
            });

            for (const pageDerivativeRow of pageDerivativeRows) {
              const pageDerivativeCandidates = [
                {
                  fileRecordId: pageDerivativeRow.thumbFileRecordId,
                  fallbackKey: pageDerivativeRow.thumbKey,
                },
                {
                  fileRecordId: pageDerivativeRow.previewFileRecordId,
                  fallbackKey: pageDerivativeRow.previewKey,
                },
              ];

              for (const candidate of pageDerivativeCandidates) {
                const fileRecordId = candidate.fileRecordId ? String(candidate.fileRecordId) : null;
                const resolvedPageOriginal = fileRecordId
                  ? await canonicalFileReadResolver.resolveOriginal(fileRecordId)
                  : null;
                const pageStorageKey = resolvedPageOriginal?.objectKey ?? resolvedPageOriginal?.localPathRef ?? candidate.fallbackKey ?? null;
                console.log('[LineItemFiles:DELETE] page derivative candidate', {
                  quoteId,
                  lineItemId,
                  attachmentId: existingAttachment.id,
                  fileRecordId,
                  fallbackKey: candidate.fallbackKey ?? null,
                  resolvedPageStorageKey: pageStorageKey,
                  resolvedProviderType: resolvedPageOriginal?.providerType ?? null,
                  resolvedStatus: resolvedPageOriginal?.status ?? null,
                });
                if (!pageStorageKey) {
                  console.warn('[LineItemFiles:DELETE] page derivative key missing; skipping physical delete', {
                    quoteId,
                    lineItemId,
                    attachmentId: existingAttachment.id,
                    fileRecordId,
                    fallbackKey: candidate.fallbackKey ?? null,
                  });
                  continue;
                }

                const pageDeletion = await deleteStoredObjectKeys({
                  fileRecordId,
                  legacyStorageProvider: toLegacyStorageProvider(storageProvider),
                  keys: [pageStorageKey],
                });

                console.log('[LineItemFiles:DELETE] page derivative delete result', {
                  quoteId,
                  lineItemId,
                  attachmentId: existingAttachment.id,
                  fileRecordId,
                  pageStorageKey,
                  deletedKeys: pageDeletion.deletedKeys,
                  failedKeys: pageDeletion.failedKeys,
                });

                if (fileRecordId && pageDeletion.failedKeys.length === 0) {
                  await fileRecordRepository.deleteById(fileRecordId);
                } else if (fileRecordId && pageDeletion.failedKeys.length > 0) {
                  console.warn('[LineItemFiles:DELETE] Skipped page derivative fileRecord cleanup due to storage delete failures', {
                    fileRecordId,
                    failedKeys: pageDeletion.failedKeys,
                  });
                }
              }
            }

            if (existingAttachment.fileRecordId && derivativeDeletion.failedKeys.length === 0) {
              await fileDerivativeRepository.deleteByFileRecordId(String(existingAttachment.fileRecordId));
            } else if (existingAttachment.fileRecordId && derivativeDeletion.failedKeys.length > 0) {
              console.warn('[LineItemFiles:DELETE] Skipped derivative row cleanup due to storage delete failures', {
                fileRecordId: String(existingAttachment.fileRecordId),
                failedKeys: derivativeDeletion.failedKeys,
              });
            }
          }
        }
      } catch {
        // ignore
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[LineItemFiles:DELETE] Error:", error);
      res.status(500).json({ error: "Failed to delete line item file" });
    }
  });

  app.get("/api/admin/quotes", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const filters = {
        searchUser: req.query.searchUser as string | undefined,
        searchCustomer: req.query.searchCustomer as string | undefined,
        searchProduct: req.query.searchProduct as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        minQuantity: req.query.minQuantity as string | undefined,
        maxQuantity: req.query.maxQuantity as string | undefined,
      };

      const quotes = await storage.getAllQuotes(organizationId, filters);
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching all quotes:", error);
      res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  app.get("/api/admin/quotes/export", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const quotes = await storage.getAllQuotes(organizationId);

      const csvHeader = "Quote Date,Quote ID,User Email,Customer Name,Product,Variant,Width,Height,Quantity,Selected Options,Options Cost,Line Price,Quote Total\n";
      const csvRows: string[] = [];

      quotes.forEach(quote => {
        const date = new Date(quote.createdAt).toISOString().split('T')[0];
        const userEmail = quote.user.email || "N/A";
        const customerName = quote.customerName || "N/A";
        const quoteId = quote.id;
        const quoteTotal = parseFloat(quote.totalPrice).toFixed(2);

        // Each line item gets its own row
        quote.lineItems.forEach(lineItem => {
          const product = lineItem.productName;
          const variant = lineItem.variantName || "N/A";
          const width = lineItem.width;
          const height = lineItem.height;
          const quantity = lineItem.quantity;
          const linePrice = parseFloat(lineItem.linePrice).toFixed(2);

          // Format selected options for CSV
          let optionsText = "None";
          let optionsCost = "0.00";
          if (lineItem.selectedOptions && Array.isArray(lineItem.selectedOptions) && lineItem.selectedOptions.length > 0) {
            optionsText = lineItem.selectedOptions.map((opt: any) => {
              const value = typeof opt.value === 'boolean' ? (opt.value ? 'Yes' : 'No') : opt.value;
              const cost = opt.calculatedCost ?? 0;
              return `${opt.optionName}: ${value} (+$${cost.toFixed(2)})`;
            }).join('; ');

            const totalOptionsCost = lineItem.selectedOptions.reduce((sum: number, opt: any) => {
              return sum + (opt.calculatedCost ?? 0);
            }, 0);
            optionsCost = totalOptionsCost.toFixed(2);
          }

          csvRows.push(`${date},"${quoteId}","${userEmail}","${customerName}","${product}","${variant}",${width},${height},${quantity},"${optionsText}",${optionsCost},${linePrice},${quoteTotal}`);
        });
      });

      const csv = csvHeader + csvRows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=quotes-export.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting quotes:", error);
      res.status(500).json({ message: "Failed to export quotes" });
    }
  });

  // Pricing Rules + Formula Templates routes extracted to ./routes/pricing.routes.ts (do NOT re-add here)

  // Email Settings + Email Sending routes extracted to ./routes/email.routes.ts (do NOT re-add here)

  // Timeline + Audit Logs routes extracted to ./routes/timeline.routes.ts (do NOT re-add here)

  // Customer Contacts, Notes, and Credit Transactions routes extracted to ./routes/customerRelations.routes.ts (do NOT re-add here)

  // Global Search route extracted to ./routes/search.routes.ts (do NOT re-add here)
  registerSearchRoutes(app, { isAuthenticated, tenantContext });

  // Diagnostic route to check user-customer linkage (dev only)
  app.get("/api/debug/user-customer-linkage", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      const allUsers = await db.select().from(users);
      const allCustomers = await db.select().from(customers);
      const sampleQuotes = await db.select().from(quotes).limit(10);

      const userLinkage = allUsers.map(user => {
        const linkedCustomer = allCustomers.find(c => c.userId === user.id);
        const customerByEmail = allCustomers.find(c => c.email?.toLowerCase() === user.email?.toLowerCase());
        return {
          userId: user.id,
          email: user.email,
          role: user.role,
          linkedCustomerId: linkedCustomer?.id || null,
          linkedCustomerName: linkedCustomer?.companyName || null,
          customerByEmailId: customerByEmail?.id || null,
          customerByEmailName: customerByEmail?.companyName || null,
          needsLink: !linkedCustomer && !!customerByEmail,
        };
      });

      const quoteInfo = sampleQuotes.map(q => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        source: q.source,
        customerId: q.customerId,
        userId: q.userId,
        customerName: q.customerName,
      }));

      res.json({
        summary: {
          totalUsers: allUsers.length,
          totalCustomers: allCustomers.length,
          usersWithLinkedCustomer: userLinkage.filter(u => u.linkedCustomerId).length,
          usersNeedingLink: userLinkage.filter(u => u.needsLink).length,
        },
        userLinkage,
        sampleQuotes: quoteInfo,
      });
    } catch (error) {
      console.error("Error checking linkage:", error);
      res.status(500).json({ message: "Failed to check linkage" });
    }
  });

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

  // ===== ORDER LINE ITEM FILE ROUTES =====

  // Get files for an order line item (mirroring quote line item pattern)
  app.get("/api/orders/:orderId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[OrderLineItemFiles:GET] orderId=${orderId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the order belongs to the organization
      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) {
        console.log(`[OrderLineItemFiles:GET] Order not found or doesn't belong to organization`);
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate the line item exists and belongs to this order
      const [lineItem] = await db.select().from(orderLineItems)
        .where(and(
          eq(orderLineItems.id, lineItemId),
          eq(orderLineItems.orderId, orderId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[OrderLineItemFiles:GET] Line item not found or doesn't belong to order`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Query attachments by orderLineItemId (no direct organizationId column, validated via order)
      const files = await db.select().from(orderAttachments)
        .where(eq(orderAttachments.orderLineItemId, lineItemId))
        .orderBy(desc(orderAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      // PHASE 2: Include linked assets with enriched URLs
      const { assetRepository } = await import('./services/assets/AssetRepository');
      const { enrichAssetsWithRoles } = await import('./services/assets/enrichAssetWithUrls');
      const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'order_line_item', lineItemId);
      const enrichedAssets = await enrichAssetsWithRoles(linkedAssets);

      console.log(`[OrderLineItemFiles:GET] Found ${files.length} files + ${linkedAssets.length} assets for line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles, assets: enrichedAssets });
    } catch (error) {
      console.error("[OrderLineItemFiles:GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Upload file to an order line item (asset pipeline, multipart upload)
  app.post("/api/orders/:orderId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[OrderLineItemFiles:POST] orderId=${orderId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the order belongs to the organization
      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate the line item exists and belongs to this order
      const [lineItem] = await db.select({ id: orderLineItems.id }).from(orderLineItems)
        .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        console.log(`[OrderLineItemFiles:POST] mode=unsupported contentType=${contentType}`);
        return res.status(415).json({
          success: false,
          error: 'Unsupported content type',
          message: 'This endpoint only supports application/json',
        });
      }

      console.log('[OrderLineItemFiles:POST] mode=json');

      const normalizeRole = (raw: any): string => {
        const val = String(raw || '').toLowerCase();
        return ['primary', 'attachment', 'proof', 'reference', 'other'].includes(val) ? val : 'primary';
      };

      const guessFileNameFromKey = (key: string): string => {
        const last = key.split('/').filter(Boolean).pop();
        return last || 'upload';
      };

      const normalizeStorageKeyFromAny = (raw: any): string | null => {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;

        // Accept either raw object key (uploads/...) or /objects/{key}
        const keyFromObjectsPrefix = trimmed.startsWith('/objects/')
          ? trimmed.replace(/^\/objects\//, '')
          : trimmed;

        // Assets expect storage keys (uploads/...), not http(s) URLs.
        if (keyFromObjectsPrefix.startsWith('http://') || keyFromObjectsPrefix.startsWith('https://')) return null;

        return normalizeObjectKeyForDb(keyFromObjectsPrefix);
      };

      type AttachCandidate =
        | {
            kind: 'existing-file-record';
            dedupeKey: string;
            fileKey: string;
            fileRecordId: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          }
        | {
            kind: 'existing-key';
            dedupeKey: string;
            fileKey: string;
            fileRecordId?: null;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          }
        | {
            kind: 'upload-session';
            dedupeKey: string;
            uploadId: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          };

      const body = req.body ?? {};
      const requestedTarget =
        (typeof body.requestedStorageTarget === 'string' ? body.requestedStorageTarget : null) ||
        (typeof body.storageTarget === 'string' ? body.storageTarget : null);
      const candidates: AttachCandidate[] = [];

      // 1) Preferred (current UI): fileName + fileUrl + optional metadata
      const singleKey = normalizeStorageKeyFromAny(body.fileUrl ?? body.fileKey ?? body.path ?? body.objectId);
      if (singleKey) {
        const singleFileRecordId = typeof body.fileRecordId === 'string' ? body.fileRecordId : null;
        candidates.push({
          kind: singleFileRecordId ? 'existing-file-record' : 'existing-key',
          dedupeKey: singleFileRecordId ? `file-record:${singleFileRecordId}` : `key:${singleKey}`,
          fileKey: singleKey,
          fileRecordId: singleFileRecordId,
          fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
          mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
          sizeBytes: body.fileSize != null ? Number(body.fileSize) : (body.sizeBytes != null ? Number(body.sizeBytes) : undefined),
          role: normalizeRole(body.role),
        });
      }

      // 2) Array form: files: [{ fileName, fileUrl/path/objectId, ... }]
      if (Array.isArray(body.files)) {
        for (const f of body.files) {
          const k = normalizeStorageKeyFromAny(f?.fileUrl ?? f?.fileKey ?? f?.path ?? f?.objectId);
          if (!k) continue;
          const candidateFileRecordId = typeof f?.fileRecordId === 'string' ? f.fileRecordId : null;
          candidates.push({
            kind: candidateFileRecordId ? 'existing-file-record' : 'existing-key',
            dedupeKey: candidateFileRecordId ? `file-record:${candidateFileRecordId}` : `key:${k}`,
            fileKey: k,
            fileRecordId: candidateFileRecordId,
            fileName: typeof f?.fileName === 'string' ? f.fileName : (typeof f?.originalFilename === 'string' ? f.originalFilename : undefined),
            mimeType: typeof f?.mimeType === 'string' ? f.mimeType : undefined,
            sizeBytes: f?.fileSize != null ? Number(f.fileSize) : (f?.sizeBytes != null ? Number(f.sizeBytes) : undefined),
            role: normalizeRole(f?.role ?? body.role),
          });
        }
      }

      // 3) Key list forms: objectIds/objectKeys/paths/keys (string[])
      const keyLists: any[] = [body.objectIds, body.objectKeys, body.paths, body.keys];
      for (const list of keyLists) {
        if (!Array.isArray(list)) continue;
        for (const rawKey of list) {
          const k = normalizeStorageKeyFromAny(rawKey);
          if (!k) continue;
          candidates.push({
            kind: 'existing-key',
            dedupeKey: `key:${k}`,
            fileKey: k,
            role: normalizeRole(body.role),
          });
        }
      }

      // 4) Chunked upload ids (if provided): uploadId/uploadIds
      const uploadIds: string[] = [];
      if (typeof body.uploadId === 'string' && body.uploadId.trim()) uploadIds.push(body.uploadId.trim());
      if (Array.isArray(body.uploadIds)) {
        for (const id of body.uploadIds) {
          if (typeof id === 'string' && id.trim()) uploadIds.push(id.trim());
        }
      }
      if (uploadIds.length > 0) {
        for (const uploadId of uploadIds) {
          candidates.push({
            kind: 'upload-session',
            dedupeKey: `upload:${uploadId}`,
            uploadId,
            role: normalizeRole(body.role),
          });
        }
      }

      // De-dupe by fileKey
      const uniqueCandidates = Array.from(
        new Map(candidates.map((c) => [c.dedupeKey, c])).values()
      );

      if (uniqueCandidates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing file identifiers',
          message: 'Provide fileUrl/path/objectId, files[], objectIds[], or uploadId/uploadIds.',
        });
      }

      const { assetRepository } = await import('./services/assets/AssetRepository');
      const { assetPreviewGenerator } = await import('./services/assets/AssetPreviewGenerator');
      const { enrichAssetWithUrls } = await import('./services/assets/enrichAssetWithUrls');

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;

      console.log(`[OrderLineItemFiles:POST] Attaching ${uniqueCandidates.length} object(s) to order_line_item ${lineItemId}`);

      const createdAssets: any[] = [];
      for (const c of uniqueCandidates) {
        const finalized: Awaited<ReturnType<typeof storageApplicationService.finalizeUpload<any>>> | null = c.kind === 'upload-session'
          ? await storageApplicationService.finalizeUpload({
              organizationId,
              createdByUserId: userId ?? null,
              requestedTarget,
              resource: {
                organizationId,
                resourceType: 'order',
                resourceId: orderId,
                lineItemId,
              },
              source: {
                kind: 'upload-session',
                uploadId: c.uploadId,
                expectedPurpose: 'order-attachment',
                expectedParentId: orderId,
              },
              persistLink: async (tx, stored) => {
                const [created] = await tx.insert(assets).values({
                  organizationId,
                  fileRecordId: stored.fileRecord.id,
                  fileKey: null,
                  fileName: stored.storedObject.originalFilename,
                  mimeType: stored.storedObject.mimeType,
                  sizeBytes: stored.storedObject.sizeBytes,
                }).returning();
                if (!created) throw new Error('Failed to create order line item asset');
                return created;
              },
            })
          : c.kind === 'existing-key'
            ? await storageApplicationService.finalizeUpload({
                organizationId,
              createdByUserId: userId ?? null,
                requestedTarget,
                resource: {
                  organizationId,
                  resourceType: 'order',
                  resourceId: orderId,
                  lineItemId,
                },
                source: {
                  kind: 'existing-key',
                  fileUrl: c.fileKey,
                  originalFilename: c.fileName || guessFileNameFromKey(c.fileKey),
                  mimeType: c.mimeType || null,
                  fileSize: c.sizeBytes || null,
                },
                persistLink: async (tx, stored) => {
                  const [created] = await tx.insert(assets).values({
                    organizationId,
                    fileRecordId: stored.fileRecord.id,
                    fileKey: null,
                    fileName: stored.storedObject.originalFilename,
                    mimeType: stored.storedObject.mimeType,
                    sizeBytes: stored.storedObject.sizeBytes,
                  }).returning();
                  if (!created) throw new Error('Failed to create order line item asset');
                  return created;
                },
              })
            : null;

          const candidateFileRecordId = c.kind === 'existing-file-record' ? c.fileRecordId : null;
          const candidateFileKey = c.kind === 'upload-session' ? null : c.fileKey;
          const candidateFileName = c.kind === 'upload-session'
            ? (c.fileName || 'upload')
            : (c.fileName || guessFileNameFromKey(c.fileKey));

          const asset: any = finalized?.linkedRecord ?? await assetRepository.createAsset(organizationId, {
            fileRecordId: candidateFileRecordId,
            fileKey: c.kind === 'existing-file-record' ? null : candidateFileKey,
            fileName: candidateFileName,
            mimeType: c.mimeType,
            sizeBytes: c.sizeBytes,
          } as any);

        await assetRepository.linkAsset(organizationId, asset.id, 'order_line_item', lineItemId, normalizeRole(c.role) as any);

        const resolvedOriginal = asset.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(asset.fileRecordId))
          : null;
        const storagePath = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? candidateFileKey;

        if (userId && storagePath) {
          await createLineItemFileRecord({
            organizationId,
            orderId,
            lineItemId,
            role: 'original',
            storagePath,
            storageKey: storagePath,
            storageBucket: null,
            originalFilename: asset.fileName || candidateFileName,
            mimeType: asset.mimeType || c.mimeType || null,
            sizeBytes: asset.sizeBytes ?? c.sizeBytes ?? null,
            fileRecordId: asset.fileRecordId ?? candidateFileRecordId,
            uploadedByUserId: userId,
          });
        }

        setImmediate(() => {
          assetPreviewGenerator.generatePreviews(asset).catch((err) => {
            console.error('[AssetPreviewGenerator] async generatePreviews failed', err);
          });
        });
        createdAssets.push({ ...(await enrichAssetWithUrls(asset)), role: normalizeRole(c.role) });

        try {
          await storage.createOrderAuditLog({
            orderId,
            userId,
            userName,
            actionType: 'file_attached',
            fromStatus: null,
            toStatus: null,
            note: null,
            metadata: {
              structuredEvent: {
                eventType: 'file.attached',
                entityType: 'line_item',
                entityId: String(lineItemId),
                displayLabel: `Line item ${lineItemId}`,
                fieldKey: 'file',
                fromValue: null,
                toValue: asset.fileName,
                actorUserId: userId ?? null,
                createdAt: new Date().toISOString(),
                metadata: {
                  orderId,
                  lineItemId,
                  assetId: asset.id,
                  fileName: asset.fileName,
                  fileSizeBytes: asset.sizeBytes ?? c.sizeBytes ?? null,
                  mimeType: asset.mimeType ?? c.mimeType ?? null,
                  storageProvider: requestedTarget ?? null,
                  fileKey: resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? asset.fileKey ?? null,
                  role: normalizeRole(c.role),
                },
              },
            },
          });
        } catch (err) {
          console.warn('[OrderLineItemFiles:POST] audit log failed', err);
        }
      }
      return res.json({
        success: true,
        data: [],
        assets: createdAssets,
        message: 'File attached',
      });
    } catch (error: any) {
      console.error("[OrderLineItemFiles:POST] Error:", error);
      res.status(500).json({ error: "Failed to upload line item file" });
    }
  });

  // Delete (unlink) a line item file (asset) from an order line item
  app.delete("/api/orders/:orderId/line-items/:lineItemId/files/:fileId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) return res.status(404).json({ error: 'Order not found' });

      const [li] = await db.select({ id: orderLineItems.id }).from(orderLineItems)
        .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
        .limit(1);

      if (!li) return res.status(404).json({ error: 'Line item not found' });

      // First try: DB-backed order attachments (some legacy/alternate UIs store these here)
      const deletedAttachment = await db.delete(orderAttachments)
        .where(and(
          eq(orderAttachments.id, fileId),
          eq(orderAttachments.orderId, orderId),
          eq(orderAttachments.orderLineItemId, lineItemId)
        ))
        .returning({
          id: orderAttachments.id,
          fileRecordId: orderAttachments.fileRecordId,
          storageProvider: orderAttachments.storageProvider,
          fileUrl: orderAttachments.fileUrl,
          relativePath: orderAttachments.relativePath,
          thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
        });

      if (deletedAttachment.length) {
        const record = deletedAttachment[0];
        try {
          const resolvedOriginal = record.fileRecordId
            ? await canonicalFileReadResolver.resolveOriginal(String(record.fileRecordId))
            : null;
          const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? record.relativePath ?? record.fileUrl ?? '');
          const effectiveStorageProvider = resolvedOriginal?.localPathRef
            ? 'local'
            : resolvedOriginal?.objectKey
              ? 'supabase'
              : record.storageProvider;

          if (storageKey) {
            const [{ orderRefs = 0 } = {}] = record.fileRecordId
              ? await db
                  .select({ orderRefs: sql<number>`count(*)` })
                  .from(orderAttachments)
                  .where(eq(orderAttachments.fileRecordId, String(record.fileRecordId)))
              : !effectiveStorageProvider
                ? [{ orderRefs: 0 }]
                : await db
                    .select({ orderRefs: sql<number>`count(*)` })
                    .from(orderAttachments)
                    .where(
                      and(
                        eq(orderAttachments.fileUrl, storageKey),
                        eq(orderAttachments.storageProvider, toLegacyStorageProvider(effectiveStorageProvider) ?? 'supabase')
                      )
                    );

            const [{ quoteRefs = 0 } = {}] = record.fileRecordId
              ? await db
                  .select({ quoteRefs: sql<number>`count(*)` })
                  .from(quoteAttachments)
                  .where(
                    and(
                      eq(quoteAttachments.organizationId, organizationId),
                      eq(quoteAttachments.fileRecordId, String(record.fileRecordId))
                    )
                  )
              : !effectiveStorageProvider
                ? [{ quoteRefs: 0 }]
                : await db
                    .select({ quoteRefs: sql<number>`count(*)` })
                    .from(quoteAttachments)
                    .where(
                      and(
                        eq(quoteAttachments.organizationId, organizationId),
                        eq(quoteAttachments.fileUrl, storageKey),
                        eq(quoteAttachments.storageProvider, toLegacyStorageProvider(effectiveStorageProvider) ?? 'supabase')
                      )
                    );

            let hasRemainingAssetLinksForFile = false;
            const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

            try {
              const matchingAssets = record.fileRecordId
                ? await db
                    .select({ id: assets.id })
                    .from(assets)
                    .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(record.fileRecordId))))
                : await db
                    .select({ id: assets.id })
                    .from(assets)
                    .where(and(eq(assets.organizationId, organizationId), eq(assets.fileKey, normalizedFileKey)));

              if (matchingAssets.length > 0) {
                await Promise.all(
                  matchingAssets.map((asset) =>
                    db
                      .delete(assetLinks)
                      .where(
                        and(
                          eq(assetLinks.organizationId, organizationId),
                          eq(assetLinks.assetId, asset.id),
                          eq(assetLinks.parentType, 'order_line_item'),
                          eq(assetLinks.parentId, String(lineItemId))
                        )
                      )
                  )
                );

                const linkCounts = await Promise.all(
                  matchingAssets.map(async (asset) => {
                    const [{ cnt = 0 } = {}] = await db
                      .select({ cnt: sql<number>`count(*)` })
                      .from(assetLinks)
                      .where(and(eq(assetLinks.organizationId, organizationId), eq(assetLinks.assetId, asset.id)));
                    return Number(cnt);
                  })
                );

                hasRemainingAssetLinksForFile = linkCounts.some((count) => count > 0);

                if (!hasRemainingAssetLinksForFile && Number(orderRefs) + Number(quoteRefs) === 0) {
                  for (const asset of matchingAssets) {
                    const variants = await db
                      .select({ key: assetVariants.key })
                      .from(assetVariants)
                      .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, asset.id)));

                    await deleteStoredObjectKeys({
                      fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                      legacyStorageProvider: toLegacyStorageProvider(effectiveStorageProvider),
                      keys: [...variants.map((variant) => variant.key || ''), normalizedFileKey],
                    });

                    await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                  }
                }
              }
            } catch (assetCleanupError) {
              console.error('[OrderLineItemFiles:DELETE] Asset cleanup failed (non-blocking):', assetCleanupError);
            }

            if (record.fileRecordId || storageKey) {
              await db
                .update(lineItemFiles)
                .set({ status: 'superseded' })
                .where(
                  and(
                    eq(lineItemFiles.organizationId, organizationId),
                    eq(lineItemFiles.orderId, orderId),
                    eq(lineItemFiles.lineItemId, lineItemId),
                    eq(lineItemFiles.status, 'active'),
                    record.fileRecordId
                      ? eq(lineItemFiles.fileRecordId, String(record.fileRecordId))
                      : or(eq(lineItemFiles.storagePath, storageKey), eq(lineItemFiles.storageKey, storageKey))!
                  )
                );
            }

            if (Number(orderRefs) + Number(quoteRefs) === 0 && !hasRemainingAssetLinksForFile && effectiveStorageProvider) {
              const derivativeRows = record.fileRecordId
                ? await fileDerivativeRepository.listByFileRecordId(String(record.fileRecordId))
                : [];
              const derivativeKeys = record.fileRecordId
                ? derivativeRows.map((row) => row.objectKey ?? null)
                : [record.thumbnailRelativePath ?? record.thumbKey ?? null, record.previewKey ?? null];

              const derivativeDeletion = await deleteStoredObjectKeys({
                fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                legacyStorageProvider: effectiveStorageProvider,
                keys: [storageKey, ...derivativeKeys],
              });

              if (record.fileRecordId && derivativeDeletion.failedKeys.length === 0) {
                await fileDerivativeRepository.deleteByFileRecordId(String(record.fileRecordId));
              } else if (record.fileRecordId && derivativeDeletion.failedKeys.length > 0) {
                console.warn('[OrderLineItemFiles:DELETE] Skipped derivative row cleanup due to storage delete failures', {
                  fileRecordId: String(record.fileRecordId),
                  failedKeys: derivativeDeletion.failedKeys,
                });
              }
            }
          }
        } catch {
          // ignore
        }

        try {
          const userId = getUserId(req.user);
          const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;
          await storage.createOrderAuditLog({
            orderId,
            userId,
            userName,
            actionType: 'file_removed',
            fromStatus: null,
            toStatus: null,
            note: null,
            metadata: {
              structuredEvent: {
                eventType: 'file.removed',
                entityType: 'line_item',
                entityId: String(lineItemId),
                displayLabel: `Line item ${lineItemId}`,
                fieldKey: 'file',
                fromValue: record.fileUrl || record.relativePath || null,
                toValue: null,
                actorUserId: userId ?? null,
                createdAt: new Date().toISOString(),
                metadata: {
                  orderId,
                  lineItemId,
                  attachmentId: record.id,
                  storageProvider: record.storageProvider || null,
                  fileKey:
                    record.relativePath || record.fileUrl || null,
                },
              },
            },
          });
        } catch (err) {
          console.warn('[OrderLineItemFiles:DELETE] audit log failed', err);
        }

        return res.json({ success: true });
      }

      // Second try: asset pipeline link unlink (validate link existed first)
      const { assetLinks: importedAssetLinks, assets: importedAssets } = await import('@shared/schema');
      const existingLink = await db.select({ id: importedAssetLinks.id }).from(importedAssetLinks)
        .where(and(
          eq(importedAssetLinks.organizationId, organizationId),
          eq(importedAssetLinks.assetId, fileId),
          eq(importedAssetLinks.parentType, 'order_line_item'),
          eq(importedAssetLinks.parentId, String(lineItemId))
        ))
        .limit(1);

      if (!existingLink.length) {
        return res.status(404).json({ error: 'File not found' });
      }

      const { assetRepository } = await import('./services/assets/AssetRepository');

      let removedAsset: any = null;
      try {
        removedAsset = await db
          .select({
            id: importedAssets.id,
            fileRecordId: importedAssets.fileRecordId,
            fileName: importedAssets.fileName,
            fileKey: importedAssets.fileKey,
            mimeType: importedAssets.mimeType,
            sizeBytes: importedAssets.sizeBytes,
          })
          .from(importedAssets)
          .where(and(eq(importedAssets.organizationId, organizationId), eq(importedAssets.id, fileId)))
          .limit(1)
          .then((rows) => rows[0]);
      } catch {
        removedAsset = null;
      }

      await assetRepository.unlinkAsset(organizationId, fileId, 'order_line_item', lineItemId);

      try {
        const resolvedOriginal = removedAsset?.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(removedAsset.fileRecordId))
          : null;
        const storageKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? removedAsset?.fileKey ?? null;

        if (removedAsset?.fileRecordId || storageKey) {
          await db
            .update(lineItemFiles)
            .set({ status: 'superseded' })
            .where(
              and(
                eq(lineItemFiles.organizationId, organizationId),
                eq(lineItemFiles.orderId, orderId),
                eq(lineItemFiles.lineItemId, lineItemId),
                eq(lineItemFiles.status, 'active'),
                removedAsset?.fileRecordId
                  ? eq(lineItemFiles.fileRecordId, String(removedAsset.fileRecordId))
                  : or(eq(lineItemFiles.storagePath, String(storageKey)), eq(lineItemFiles.storageKey, String(storageKey)))!
              )
            );
        }
      } catch (lineItemFileCleanupError) {
        console.warn('[OrderLineItemFiles:DELETE] line_item_files cleanup failed', lineItemFileCleanupError);
      }

      try {
        const userId = getUserId(req.user);
        const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;
        await storage.createOrderAuditLog({
          orderId,
          userId,
          userName,
          actionType: 'file_removed',
          fromStatus: null,
          toStatus: null,
          note: null,
          metadata: {
            structuredEvent: {
              eventType: 'file.removed',
              entityType: 'line_item',
              entityId: String(lineItemId),
              displayLabel: `Line item ${lineItemId}`,
              fieldKey: 'file',
              fromValue: removedAsset?.fileName || fileId,
              toValue: null,
              actorUserId: userId ?? null,
              createdAt: new Date().toISOString(),
              metadata: {
                orderId,
                lineItemId,
                assetId: fileId,
                fileName: removedAsset?.fileName || null,
                fileSizeBytes: removedAsset?.sizeBytes ?? null,
                mimeType: removedAsset?.mimeType ?? null,
                storageProvider: null,
                fileKey: removedAsset?.fileKey ?? null,
              },
            },
          },
        });
      } catch (err) {
        console.warn('[OrderLineItemFiles:DELETE] audit log failed', err);
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('[OrderLineItemFiles:DELETE] Error:', error);
      return res.status(500).json({ error: 'Failed to remove line item file' });
    }
  });

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
  registerUsersRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin, isAdminOrOwner });

  // Company Settings routes extracted to ./routes/companySettings.routes.ts (do NOT re-add here)
  registerCompanySettingsRoutes(app, { isAuthenticated, tenantContext, isAdmin });
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
