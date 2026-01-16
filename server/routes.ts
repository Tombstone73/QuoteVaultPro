import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { promises as fsPromises } from "fs";
import { randomUUID } from "crypto";
import { evaluate } from "mathjs";
import Papa from "papaparse";
import { storage } from "./storage";
import { db } from "./db";
import { customers, users, quotes, orders, invoices, invoiceLineItems, payments, insertMaterialSchema, updateMaterialSchema, insertInventoryAdjustmentSchema, materials, inventoryAdjustments, orderMaterialUsage, accountingSyncJobs, organizations, userOrganizations, customerVisibleProducts, products, pbv2TreeVersions, productVariants, quoteAttachments, quoteAttachmentPages, orderAttachments, customerContacts, quoteLineItems, orderLineItems, globalVariables, auditLogs, orderAuditLog, orderStatusPills, shipments, jobs, jobStatusLog, jobStatuses, quoteWorkflowStates, quoteListNotes, listSettings, integrationConnections } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, asc, inArray, or, sql } from "drizzle-orm";
import * as localAuth from "./localAuth";
import * as replitAuth from "./replitAuth";
// @ts-ignore - NestingCalculator.js is a plain JS file without types
import NestingCalculator from "./NestingCalculator.js";
import { emailService } from "./emailService";
import { ensureCustomerForUser } from "./db/syncUsersToCustomers";
import * as quickbooksService from "./quickbooksService";
import { assertStripeServerConfig, getStripeClient } from "./lib/stripe";
import * as syncWorker from "./workers/syncProcessor";
import { tenantContext, getUserOrganizations, setDefaultOrganization, getRequestOrganizationId, optionalTenantContext, ensureUserOrganization, DEFAULT_ORGANIZATION_ID, portalContext, getPortalCustomer } from "./tenantContext";
import { getProfile, profileRequiresDimensions, type FlatGoodsConfig, type RollMaterialConfig, flatGoodsCalculator, buildFlatGoodsInput } from "@shared/pricingProfiles";
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
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { resolveInventoryPolicyFromOrgPreferences } from "@shared/inventoryPolicy";
import { mergeInventoryPolicyIntoPreferences, normalizeInventoryPolicyPatch } from "@shared/inventoryPolicyPreferences";
import { readPbv2OverrideConfig, writePbv2OverrideConfig } from "./lib/pbv2OverrideConfig";

// Use local auth for development, Replit auth for production
const nodeEnv = (process.env.NODE_ENV || '').trim();
console.log('NODE_ENV in routes.ts:', JSON.stringify(nodeEnv));
console.log('Using auth:', nodeEnv === "development" ? 'localAuth' : 'replitAuth');
const auth = nodeEnv === "development" ? localAuth : replitAuth;
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

// =============================
// Import Job Helpers
// =============================
type ImportApplyMode = "MERGE_RESPECT_OVERRIDES" | "MERGE_AND_SET_OVERRIDES";

const parseCsvOrThrow = (csvData: unknown) => {
  if (!csvData || typeof csvData !== "string") {
    throw Object.assign(new Error("CSV data is required"), { statusCode: 400 });
  }

  const parseResult = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (parseResult.errors.length > 0) {
    const err = Object.assign(new Error("CSV parsing failed"), { statusCode: 400, errors: parseResult.errors });
    throw err;
  }

  const rows = parseResult.data as Record<string, string>[];
  if (!rows || rows.length === 0) {
    throw Object.assign(new Error("CSV must contain at least one data row"), { statusCode: 400 });
  }

  return rows;
};

const parseBool = (v: unknown) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "") return undefined;
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
};

const parseNum = (v: unknown) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const parseTaxRateOverride = (v: unknown) => {
  const n = parseNum(v);
  if (n == null) return undefined;
  // Allow 8.25 to mean 8.25%
  if (n > 1) return n / 100;
  return n;
};

const pickOverrideFiltered = (existing: any, patch: any) => {
  const overrides: Record<string, boolean> = (existing?.qbFieldOverrides as any) || {};
  const result: any = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (overrides[k]) continue;
    result[k] = v;
  }
  return result;
};

const buildOverridePatch = (incoming: any) => {
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === undefined || v === null) continue;
    // If caller sent empty strings for text fields, treat as not provided.
    if (typeof v === "string" && v.trim() === "") continue;
    next[k] = true;
  }
  return next;
};
import {
  insertProductSchema,
  updateProductSchema,
  insertQuoteSchema,
  insertProductOptionSchema,
  updateProductOptionSchema,
  insertProductVariantSchema,
  updateProductVariantSchema,
  insertGlobalVariableSchema,
  updateGlobalVariableSchema,
  insertPricingFormulaSchema,
  updatePricingFormulaSchema,
  insertEmailSettingsSchema,
  updateEmailSettingsSchema,
  insertCompanySettingsSchema,
  updateCompanySettingsSchema,
  insertCustomerSchema,
  insertCustomerSchemaRefined,
  updateCustomerSchema,
  insertCustomerContactSchema,
  updateCustomerContactSchema,
  insertCustomerNoteSchema,
  updateCustomerNoteSchema,
  insertCustomerCreditTransactionSchema,
  updateCustomerCreditTransactionSchema,
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
  insertShipmentSchema,
  updateShipmentSchema,
  insertVendorSchema,
  updateVendorSchema,
  insertPurchaseOrderSchema,
  updatePurchaseOrderSchema,
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
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
  scheduleSupabaseObjectSelfCheck,
  tryExtractSupabaseObjectKeyFromUrl
} from "./lib/supabaseObjectHelpers";
import type { FileRole, FileSide } from "./lib/supabaseObjectHelpers";
import { getInvoiceWithRelations, applyPayment, refreshInvoiceStatus } from './invoicesService';
import { generatePackingSlipHTML, sendShipmentEmail, updateOrderFulfillmentStatus } from './fulfillmentService';
import { registerMvpInvoicingRoutes } from './routes/mvpInvoicing.routes';

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

  // Attachment routes extracted to ./routes/attachments.routes.ts (do NOT re-add here)
  await registerAttachmentRoutes(app, { isAuthenticated, tenantContext, isAdmin });

  // Order routes extracted to ./routes/orders.routes.ts (do NOT re-add here)
  await registerOrderRoutes(app, { isAuthenticated, tenantContext, isAdmin, isAdminOrOwner });

  // MVP Invoicing + Payments + Billing Ready (mounted, minimal changes in routes.ts)
  await registerMvpInvoicingRoutes(app, { isAuthenticated, tenantContext });

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

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Workflow (enterprise rule): Formal state machine enforcement
  // ────────────────────────────────────────────────────────────────────────────

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

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const user = await storage.getUser(userId!);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // User management routes (admin only)
  app.get("/api/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Prevent users from removing their own admin status
      const currentUserId = getUserId(req.user);
      if (id === currentUserId && updates.isAdmin === false) {
        return res.status(400).json({ message: "You cannot remove your own admin status" });
      }

      const user = await storage.updateUser(id, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const currentUserId = getUserId(req.user);

      // Prevent users from deleting themselves
      if (id === currentUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }

      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ============================================================
  // ORGANIZATION MANAGEMENT ROUTES (Multi-Tenant)
  // ============================================================

  // Get current user's organizations
  app.get('/api/organizations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const orgs = await getUserOrganizations(userId);
      res.json(orgs);
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  // Set default organization
  app.post('/api/organizations/:id/set-default', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      await setDefaultOrganization(userId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error setting default organization:", error);
      res.status(500).json({ message: "Failed to set default organization" });
    }
  });

  // Get current organization context (for debugging/verification)
  app.get('/api/organization/current', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!req.organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, req.organizationId))
        .limit(1);

      res.json(org);
    } catch (error) {
      console.error("Error fetching current organization:", error);
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  // Get organization preferences (from settings.preferences)
  app.get('/api/organization/preferences', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      // Only allow owners/admins to read preferences
      const userRole = req.user?.role || 'customer';
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: "Only owners and admins can view preferences" });
      }

      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Extract preferences from settings.preferences, default to empty object
      const rawPreferences = (org.settings as any)?.preferences;
      const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};

      // Ensure stable defaults for inventory policy toggles
      const inventoryPolicy = resolveInventoryPolicyFromOrgPreferences(preferences);

      res.json({
        ...(preferences as any),
        inventoryPolicy,
      });
    } catch (error) {
      console.error("Error fetching organization preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Update organization preferences (merge into settings.preferences)
  app.put('/api/organization/preferences', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      // Only allow owners/admins to update preferences
      const userRole = req.user?.role || 'customer';
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: "Only owners and admins can update preferences" });
      }

      const newPreferences = req.body;

      // Get current settings
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      // Merge new preferences into existing settings
      const currentSettings = (org.settings || {}) as any;
      const updatedSettings = {
        ...currentSettings,
        preferences: newPreferences,
      };

      // Update organization settings
      await db
        .update(organizations)
        .set({
          settings: updatedSettings as any,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      res.json({ success: true, preferences: newPreferences });
    } catch (error) {
      console.error("Error updating organization preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Safely patch ONLY the inventory policy preferences (does not overwrite other keys)
  app.patch('/api/organization/preferences/inventory-policy', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ success: false, message: "No organization context" });
      }

      // Only allow owners/admins to update preferences
      const userRole = req.user?.role || 'customer';
      if (!['owner', 'admin'].includes(userRole)) {
        return res.status(403).json({ success: false, message: "Only owners and admins can update preferences" });
      }

      const patchSchema = z
        .object({
          enabled: z.boolean().optional(),
          reservationsEnabled: z.boolean().optional(),
          mode: z.enum(["off", "advisory", "enforced"]).optional(),
          enforcementMode: z.enum(["off", "warn_only", "block_on_shortage"]).optional(),
          autoReserveOnApplyPbV2: z.boolean().optional(),
          autoReserveOnOrderConfirm: z.boolean().optional(),
          allowNegative: z.boolean().optional(),
        })
        .strict()
        .refine((obj) => Object.keys(obj).length > 0, {
          message: "At least one inventory policy field is required",
        })
        .superRefine((obj, ctx) => {
          if (
            typeof obj.enabled === "boolean" &&
            typeof obj.reservationsEnabled === "boolean" &&
            obj.enabled !== obj.reservationsEnabled
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "enabled and reservationsEnabled must match when both are provided",
              path: ["reservationsEnabled"],
            });
          }
        });

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        const message = fromZodError(parsed.error).toString();
        return res.status(400).json({ success: false, message });
      }

      // Load current settings
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      const currentSettings = (org.settings || {}) as any;
      const currentPreferences = (currentSettings as any)?.preferences || {};

      const normalized = normalizeInventoryPolicyPatch(parsed.data);
      const updatedPreferences = mergeInventoryPolicyIntoPreferences(currentPreferences, normalized.patch);

      // Update organization settings without clobbering unrelated settings keys
      const updatedSettings = {
        ...currentSettings,
        preferences: updatedPreferences,
      };

      await db
        .update(organizations)
        .set({
          settings: updatedSettings as any,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      // TODO(org-preferences-audit): add audit log event for org preference patches

      // Return canonical preferences payload (same shape as GET)
      const canonicalPreferences = {
        ...(updatedPreferences as any),
        inventoryPolicy: resolveInventoryPolicyFromOrgPreferences(updatedPreferences),
      };

      return res.json({
        success: true,
        data: canonicalPreferences,
        message: "Inventory policy updated",
        ...(normalized.warnings.length > 0 ? { meta: { warnings: normalized.warnings } } : {}),
      });
    } catch (error) {
      console.error("Error patching inventory policy:", error);
      return res.status(500).json({ success: false, message: "Failed to update inventory policy" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Object storage routes moved to ./routes/attachments.routes.ts
  // (GET /objects/:objectPath, POST /api/objects/upload, POST /api/objects/acl)
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/media", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const assets = await storage.getAllMediaAssets(organizationId);
      res.json(assets);
    } catch (error) {
      console.error("Error fetching media assets:", error);
      res.status(500).json({ message: "Failed to fetch media assets" });
    }
  });

  app.post("/api/media", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { filename, url, fileSize, mimeType } = req.body;

      if (!filename || !url || fileSize === undefined || !mimeType) {
        return res.status(400).json({ message: "filename, url, fileSize, and mimeType are required" });
      }

      const userId = getUserId(req.user);
      const asset = await storage.createMediaAsset(organizationId, {
        filename,
        url,
        uploadedBy: userId!,
        fileSize,
        mimeType,
      });

      res.json(asset);
    } catch (error) {
      console.error("Error creating media asset:", error);
      res.status(500).json({ message: "Failed to create media asset" });
    }
  });

  app.delete("/api/media/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteMediaAsset(organizationId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting media asset:", error);
      res.status(500).json({ message: "Failed to delete media asset" });
    }
  });

  // Product Types routes
  app.get("/api/product-types", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const types = await storage.getAllProductTypes(organizationId);
      res.json(types);
    } catch (error) {
      console.error("Error fetching product types:", error);
      res.status(500).json({ message: "Failed to fetch product types" });
    }
  });

  app.post("/api/product-types", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const newType = await storage.createProductType(organizationId, req.body);
      res.json(newType);
    } catch (error) {
      console.error("Error creating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create product type" });
    }
  });

  app.patch("/api/product-types/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const updated = await storage.updateProductType(organizationId, id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating product type:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to update product type" });
    }
  });

  app.delete("/api/product-types/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteProductType(organizationId, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting product type:", error);
      if (error.code === '23503') {
        return res.status(400).json({ message: "Cannot delete product type that is in use by products" });
      }
      res.status(500).json({ message: "Failed to delete product type" });
    }
  });

  app.get("/api/products", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const products = await storage.getAllProducts(organizationId);
      res.json(products);
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
  // PBV2 (Product Builder v2) - Versioned Tree Lifecycle
  // ============================================================================

  app.get("/api/products/:productId/pbv2/tree", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;

      const [product] = await db
        .select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const [draft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT")))
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      const activeId = product.pbv2ActiveTreeVersionId;
      const active = activeId
        ? (
            await db
              .select()
              .from(pbv2TreeVersions)
              .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, activeId)))
              .limit(1)
          )[0]
        : undefined;

      return res.json({ success: true, data: { draft: draft ?? null, active: active ?? null } });
    } catch (error: any) {
      console.error("Error fetching PBV2 tree versions:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch PBV2 tree versions" });
    }
  });

  app.post("/api/products/:productId/pbv2/tree/draft", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { productId } = req.params;
      const userId = getUserId(req.user);

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) return res.status(404).json({ success: false, message: "Product not found" });

      const [existingDraft] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.productId, productId), eq(pbv2TreeVersions.status, "DRAFT")))
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      if (existingDraft) return res.json({ success: true, data: existingDraft });

      const initialTreeJson: Record<string, any> = {
        schemaVersion: 1,
        status: "DRAFT",
        roots: [],
        nodes: {},
        edges: {},
      };

      const [draft] = await db
        .insert(pbv2TreeVersions)
        .values({
          organizationId,
          productId,
          status: "DRAFT",
          schemaVersion: 1,
          treeJson: initialTreeJson,
          createdByUserId: userId ?? null,
          updatedByUserId: userId ?? null,
        })
        .returning();

      return res.json({ success: true, data: draft });
    } catch (error: any) {
      console.error("Error creating PBV2 draft:", error);
      return res.status(500).json({ success: false, message: "Failed to create PBV2 draft" });
    }
  });

  app.patch("/api/pbv2/tree-versions/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const { id } = req.params;
      const userId = getUserId(req.user);

      const [existing] = await db
        .select()
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, id)))
        .limit(1);

      if (!existing) return res.status(404).json({ success: false, message: "Tree version not found" });
      if (existing.status !== "DRAFT") {
        return res.status(409).json({ success: false, message: "Only DRAFT tree versions can be edited" });
      }

      const treeJson = (req.body as any)?.treeJson;
      if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) {
        return res.status(400).json({ success: false, message: "treeJson must be an object" });
      }

      // Ensure JSON-serializable payload.
      try {
        JSON.stringify(treeJson);
      } catch {
        return res.status(400).json({ success: false, message: "treeJson must be valid JSON" });
      }

      // Enforce PBV2 metadata invariants server-side.
      const normalizedTreeJson: Record<string, any> = {
        ...treeJson,
        schemaVersion: 1,
        status: "DRAFT",
      };

      const [updated] = await db
        .update(pbv2TreeVersions)
        .set({
          treeJson: normalizedTreeJson,
          updatedAt: new Date(),
          updatedByUserId: userId ?? null,
        })
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, id)))
        .returning();

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error("Error updating PBV2 tree version:", error);
      return res.status(500).json({ success: false, message: "Failed to update PBV2 tree version" });
    }
  });

  app.post("/api/pbv2/tree-versions/:id/publish", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
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
      if (draft.status !== "DRAFT") {
        return res.status(409).json({ success: false, message: "Only DRAFT tree versions can be published" });
      }

      // Validate publish gate (Appendix 5)
      const validation = validateTreeForPublish((draft as any).treeJson as any, DEFAULT_VALIDATE_OPTS);
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
          schemaVersion: 1,
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

        return updatedVersion;
      });

      return res.json({ success: true, data: result, findings: validation.findings });
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
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
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

  // Global Variables routes
  app.get("/api/global-variables", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variables = await storage.getAllGlobalVariables(organizationId);
      res.json(variables);
    } catch (error) {
      console.error("Error fetching global variables:", error);
      res.status(500).json({ message: "Failed to fetch global variables" });
    }
  });

  app.post("/api/global-variables", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variableData = insertGlobalVariableSchema.parse(req.body);
      const variable = await storage.createGlobalVariable(organizationId, variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating global variable:", error);
      res.status(500).json({ message: "Failed to create global variable" });
    }
  });

  app.patch("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const variableData = updateGlobalVariableSchema.parse({
        ...req.body,
        id: req.params.id,
      });

      // Special validation for next_quote_number to prevent duplicate quote numbers
      const currentVariable = await storage.getGlobalVariableById(organizationId, req.params.id);
      if (currentVariable?.name === 'next_quote_number' && variableData.value !== undefined) {
        const newValue = Math.floor(Number(variableData.value));

        // Get the maximum existing quote number
        const maxQuoteNumber = await storage.getMaxQuoteNumber(organizationId);

        if (maxQuoteNumber !== null && newValue <= maxQuoteNumber) {
          return res.status(400).json({
            message: `Cannot set next quote number to ${newValue}. The highest existing quote number is ${maxQuoteNumber}. Please set a value greater than ${maxQuoteNumber}.`
          });
        }
      }

      const variable = await storage.updateGlobalVariable(organizationId, req.params.id, variableData);
      res.json(variable);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating global variable:", error);
      res.status(500).json({ message: "Failed to update global variable" });
    }
  });

  app.delete("/api/global-variables/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteGlobalVariable(organizationId, req.params.id);
      res.json({ message: "Global variable deleted successfully" });
    } catch (error) {
      console.error("Error deleting global variable:", error);
      res.status(500).json({ message: "Failed to delete global variable" });
    }
  });

  // Pricing Formulas routes
  app.get("/api/pricing-formulas", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulas = await storage.getPricingFormulas(organizationId);
      res.json(formulas);
    } catch (error) {
      console.error("Error fetching pricing formulas:", error);
      res.status(500).json({ message: "Failed to fetch pricing formulas" });
    }
  });

  app.get("/api/pricing-formulas/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formula = await storage.getPricingFormulaById(organizationId, req.params.id);
      if (!formula) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(formula);
    } catch (error) {
      console.error("Error fetching pricing formula:", error);
      res.status(500).json({ message: "Failed to fetch pricing formula" });
    }
  });

  app.get("/api/pricing-formulas/:id/products", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const result = await storage.getPricingFormulaWithProducts(organizationId, req.params.id);
      if (!result) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching pricing formula with products:", error);
      res.status(500).json({ message: "Failed to fetch pricing formula with products" });
    }
  });

  app.post("/api/pricing-formulas", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulaData = insertPricingFormulaSchema.parse(req.body);
      const formula = await storage.createPricingFormula(organizationId, formulaData);
      res.json(formula);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating pricing formula:", error);
      res.status(500).json({ message: "Failed to create pricing formula" });
    }
  });

  app.patch("/api/pricing-formulas/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const formulaData = updatePricingFormulaSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const formula = await storage.updatePricingFormula(organizationId, req.params.id, formulaData);
      if (!formula) {
        return res.status(404).json({ message: "Pricing formula not found" });
      }
      res.json(formula);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating pricing formula:", error);
      res.status(500).json({ message: "Failed to update pricing formula" });
    }
  });

  app.delete("/api/pricing-formulas/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deletePricingFormula(organizationId, req.params.id);
      res.json({ message: "Pricing formula deleted successfully" });
    } catch (error) {
      console.error("Error deleting pricing formula:", error);
      res.status(500).json({ message: "Failed to delete pricing formula" });
    }
  });

  app.post("/api/quotes/calculate", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { evaluateOptionTreeV2, isZodError } = await import("./services/optionTreeV2Evaluator");
      const { validateOptionTreeV2 } = await import("../shared/optionTreeV2");
      const {
        productId,
        variantId,
        width,
        height,
        quantity,
        selectedOptions: selectedOptionsRaw = {},
        optionSelectionsJson,
        productDraft,
        customerTier,
        customerId: customerIdRaw,
        quoteId,
      } = req.body;

      type PricingTier = "default" | "wholesale" | "retail";
      const parseOptionalNumber = (value: any): number | null => {
        if (value === null || value === undefined) return null;
        const num = typeof value === "number" ? value : parseFloat(String(value));
        return Number.isFinite(num) ? num : null;
      };

      const normalizeSelectedOptions = (input: any): Record<string, any> => {
        if (!input) return {};
        if (Array.isArray(input)) {
          const out: Record<string, any> = {};
          for (const opt of input) {
            if (!opt || typeof opt !== "object") continue;
            const optionId = String((opt as any).optionId ?? "");
            if (!optionId) continue;
            const value = (opt as any).value;
            const selection: any = typeof value === "object" && value !== null ? value : { value };
            if (typeof (opt as any).note === "string") selection.note = (opt as any).note;
            if (typeof (opt as any).grommetsLocation === "string") selection.grommetsLocation = (opt as any).grommetsLocation;
            if (typeof (opt as any).customPlacementNote === "string") selection.customPlacementNote = (opt as any).customPlacementNote;
            if (typeof (opt as any).hemsType === "string") selection.hemsType = (opt as any).hemsType;
            if (typeof (opt as any).polePocket === "string") selection.polePocket = (opt as any).polePocket;
            if (typeof (opt as any).grommetsSpacingCount === "number") selection.grommetsSpacingCount = (opt as any).grommetsSpacingCount;
            if (typeof (opt as any).grommetsPerSign === "number") selection.grommetsPerSign = (opt as any).grommetsPerSign;
            if (typeof (opt as any).grommetsSpacingInches === "number") selection.grommetsSpacingInches = (opt as any).grommetsSpacingInches;
            out[optionId] = selection;
          }
          return out;
        }
        if (typeof input === "object") return input as Record<string, any>;
        return {};
      };

      const selectedOptions = normalizeSelectedOptions(selectedOptionsRaw);

      const resolveMaterialPricePerSqft = (material: any, tier: PricingTier): number | null => {
        if (!material) return null;
        const unit = String(material.unitOfMeasure || "").toLowerCase();
        if (unit !== "sqft") return null;

        const retail = parseOptionalNumber(material.retailBaseRate);
        const wholesale = parseOptionalNumber(material.wholesaleBaseRate);
        const base = parseOptionalNumber(material.costPerUnit);

        let chosen: number | null = null;
        if (tier === "wholesale") chosen = wholesale ?? retail ?? base;
        else if (tier === "retail") chosen = retail ?? wholesale ?? base;
        else chosen = retail ?? wholesale ?? base;

        if (!chosen || !Number.isFinite(chosen) || chosen <= 0) return null;
        return chosen;
      };

      const hasInlineDraft = !!productDraft && typeof productDraft === "object";
      if ((!productId && !hasInlineDraft) || width == null || height == null || quantity == null) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const mergeDefined = <T extends Record<string, any>>(base: T, patch: any): T => {
        if (!patch || typeof patch !== "object") return base;
        const out: any = { ...base };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          out[k] = v;
        }
        return out as T;
      };

      let product: any = null;
      if (productId) {
        product = await storage.getProductById(organizationId, productId);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        // If caller provides a draft overlay (Product Builder), simulate against draft values.
        if (productDraft && typeof productDraft === "object") {
          product = mergeDefined(product, productDraft);
        }
      } else {
        // Draft-only simulation (new/unsaved product in Product Builder)
        product = mergeDefined(
          {
            id: "draft",
            name: "Draft Product",
            pricingProfileKey: "default",
            pricingProfileConfig: null,
            pricingFormulaId: null,
            pricingFormula: "",
            primaryMaterialId: null,
            useNestingCalculator: false,
            sheetWidth: null,
            sheetHeight: null,
            materialType: "sheet",
            minPricePerItem: null,
            optionsJson: [],
          } as any,
          productDraft
        );
      }

      // Optional customer tier support (for wholesale/retail pricing overrides)
      // Server-authoritative tier resolution priority:
      // 1) customerId (from request)
      // 2) quoteId -> quote.customerId
      // 3) customerTier (legacy client hint; lowest priority)
      let effectiveTier: PricingTier = "default";
      let tierSource: "customerId" | "quoteId" | "customerTier" | "default" = "default";

      const customerId = typeof customerIdRaw === "string" && customerIdRaw.trim() ? customerIdRaw : null;
      let effectiveCustomerId: string | null = customerId;

      if (!effectiveCustomerId && typeof quoteId === "string" && quoteId.trim()) {
        try {
          const q = await storage.getQuoteById(organizationId, quoteId);
          const qCustomerId = (q as any)?.customerId;
          if (typeof qCustomerId === "string" && qCustomerId.trim()) {
            effectiveCustomerId = qCustomerId;
          }
        } catch {
          // Fail-soft: quote lookup is optional for this endpoint
        }
      }

      if (effectiveCustomerId) {
        try {
          const customer = await storage.getCustomerById(organizationId, effectiveCustomerId);
          const tier = customer?.pricingTier;
          if (tier === "wholesale" || tier === "retail" || tier === "default") {
            effectiveTier = tier;
            tierSource = effectiveCustomerId === customerId ? "customerId" : "quoteId";
          }
        } catch {
          // Fail-soft: tiered pricing is optional for this endpoint
        }
      } else if (customerTier === "wholesale" || customerTier === "retail" || customerTier === "default") {
        effectiveTier = customerTier;
        tierSource = "customerTier";
      }

      // Fetch product variant if provided
      let variant = null;
      let variantName = null;
      if (variantId && productId) {
        const variants = await storage.getProductVariants(productId);
        variant = variants.find(v => v.id === variantId) ?? null;
        if (variant) {
          variantName = variant.name;
        }
      }

      // Fetch all global variables for formula evaluation
      const globalVariables = await storage.getAllGlobalVariables(organizationId);
      const globalVarsContext: Record<string, number> = {};
      globalVariables.forEach(v => {
        globalVarsContext[v.name] = parseFloat(v.value);
      });

      // Coerce inputs to numbers (handles both string and number inputs)
      const widthNum = Number(width) || 0;
      const heightNum = Number(height) || 0;
      const quantityNum = Number(quantity);

      // If product has a pricing formula attached, use it to override profile/config
      let effectivePricingProfileKey = product.pricingProfileKey ?? "default";
      let effectivePricingProfileConfig = product.pricingProfileConfig;
      let pricingFormulaName: string | null = null;

      if (product.pricingFormulaId) {
        const pricingFormula = await storage.getPricingFormulaById(organizationId, product.pricingFormulaId);
        if (pricingFormula) {
          effectivePricingProfileKey = pricingFormula.pricingProfileKey ?? "default";
          effectivePricingProfileConfig = pricingFormula.config;
          pricingFormulaName = pricingFormula.name;
          console.log(`[PRICING DEBUG] Using pricing formula "${pricingFormula.name}" (${pricingFormula.code}) for product ${product.name}`);
        }
      }

      // Determine pricing profile (new system) with fallback to legacy detection
      const pricingProfile = getProfile(effectivePricingProfileKey);
      const requiresDimensions = profileRequiresDimensions(effectivePricingProfileKey);

      // Legacy detection: if useNestingCalculator is true but pricingProfileKey is default, treat as flat_goods
      const isLegacyNesting = product.useNestingCalculator && product.sheetWidth && product.sheetHeight && effectivePricingProfileKey === "default";
      const useFlatGoodsCalculator = pricingProfile.key === "flat_goods" || isLegacyNesting;

      // Validate dimensions only if the profile requires them
      if (requiresDimensions || useFlatGoodsCalculator) {
        if (!Number.isFinite(widthNum) || widthNum <= 0) {
          return res.status(400).json({ message: "Invalid width value" });
        }
        if (!Number.isFinite(heightNum) || heightNum <= 0) {
          return res.status(400).json({ message: "Invalid height value" });
        }
      }

      // Quantity is always required
      if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
        return res.status(400).json({ message: "Invalid quantity value" });
      }

      // Calculate square footage (may be 0 for qty_only/fee profiles)
      const sqft = requiresDimensions ? (widthNum * heightNum) / 144 : 0;

      // Build formula context with dimensions, quantity, variant base price, material pricing, and global variables
      const basePricePerSqft = variant ? parseFloat(variant.basePricePerSqft) : 0;

      // Resolve p (price per sqft) from Primary Material when available; fall back to variant base price.
      let primaryMaterial: any = null;
      if (product.primaryMaterialId) {
        try {
          primaryMaterial = await storage.getMaterialById(organizationId, product.primaryMaterialId);
        } catch {
          primaryMaterial = null;
        }
      }

      const materialPricePerSqft = resolveMaterialPricePerSqft(primaryMaterial, effectiveTier);
      const resolvedPricePerSqft = materialPricePerSqft ?? (Number.isFinite(basePricePerSqft) && basePricePerSqft > 0 ? basePricePerSqft : null);

      const formulaContext: Record<string, number> = {
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        qty: quantityNum,
        sqft,
        basePricePerSqft,
        // Single-letter aliases for convenience
        w: widthNum,
        h: heightNum,
        q: quantityNum,
        ...globalVarsContext,
      };

      // Canonical pricing variable aliases
      if (resolvedPricePerSqft !== null) {
        formulaContext.p = resolvedPricePerSqft;
        formulaContext.pricePerSqft = resolvedPricePerSqft;
        formulaContext.unitPrice = resolvedPricePerSqft;
        formulaContext.price = resolvedPricePerSqft;
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[FORMULA CONTEXT]", {
          productId,
          variantId: variantId ?? null,
          tier: effectiveTier,
          tierSource,
          customerId: effectiveCustomerId,
          materialId: product.primaryMaterialId ?? null,
          resolvedPricePerSqft,
          ctxKeys: Object.keys(formulaContext).sort(),
        });
      }

      // Initialize calculation context for cross-option communication
      let calculationContext: Record<string, any> = {};

      // Calculate base price using nesting calculator or formula
      let basePrice = 0;
      let nestingDetails: any = undefined;
      let effectiveMaterial: any = null; // Material from thickness selector, if any

      console.log(`[PRICING DEBUG] Product: ${product.name}, pricingProfile: ${pricingProfile.key}, useFlatGoods: ${useFlatGoodsCalculator}${pricingFormulaName ? `, formula: ${pricingFormulaName}` : ''}`);

      if (useFlatGoodsCalculator) {
        // Use Flat Goods Calculator (flat goods profile or legacy nesting)
        console.log(`[PRICING DEBUG] Using Flat Goods Calculator for product ${product.name}`);
        try {
          // Build input from profile config with legacy fallbacks
          const profileConfig = effectivePricingProfileConfig as FlatGoodsConfig | null;

          // PRE-PROCESSING: Check for thickness selector to override material
          const productOptionsJson = ((product.optionsJson as unknown) as PricingOptionJson[]) || [];
          let thicknessMultiplier = 1.0;
          let thicknessVolumePricing: any = null;

          for (const optionJson of productOptionsJson) {
            if (optionJson.config?.kind === "thickness") {
              const selectedThicknessKey = selectedOptions[optionJson.id];
              if (selectedThicknessKey && optionJson.config.thicknessVariants) {
                const selectedVariant = optionJson.config.thicknessVariants.find(
                  (v: any) => v.key === selectedThicknessKey
                );
                if (selectedVariant && selectedVariant.materialId) {
                  // Fetch material from database
                  effectiveMaterial = await storage.getMaterialById(organizationId, selectedVariant.materialId);
                  console.log(`[PRICING DEBUG] Thickness selector: using material ${effectiveMaterial?.name} for ${selectedThicknessKey}`);

                  if (selectedVariant.pricingMode === "multiplier") {
                    thicknessMultiplier = selectedVariant.priceMultiplier || 1.0;
                  } else if (selectedVariant.pricingMode === "volume" && selectedVariant.volumeTiers) {
                    // NestingCalculator expects: { enabled: true, tiers: [{ minSheets, maxSheets, pricePerSheet }] }
                    thicknessVolumePricing = {
                      enabled: true,
                      tiers: selectedVariant.volumeTiers.map((tier: any) => ({
                        minSheets: tier.minSheets,
                        maxSheets: tier.maxSheets || null,
                        pricePerSheet: parseFloat(tier.pricePerSheet) || 0
                      }))
                    };
                  }
                  break;
                }
              }
            }
          }

          // Build base flatGoodsInput (will override with material if loaded)
          const flatGoodsInput = buildFlatGoodsInput(
            profileConfig,
            product,
            variant ?? null,
            widthNum,
            heightNum,
            quantityNum
          );

          // If thickness selector provided a material, override sheet dimensions and cost
          if (effectiveMaterial) {
            // Check if this is a roll material
            if (effectiveMaterial.type === "roll") {
              // Roll material handling
              const rollWidthIn = parseFloat(effectiveMaterial.width) || 0;
              const rollLengthFt = parseFloat(effectiveMaterial.rollLengthFt) || 0;
              const costPerRoll = parseFloat(effectiveMaterial.costPerRoll) || 0;
              const edgeWasteInPerSide = parseFloat(effectiveMaterial.edgeWasteInPerSide) || 0;
              const leadWasteFt = parseFloat(effectiveMaterial.leadWasteFt) || 0;
              const tailWasteFt = parseFloat(effectiveMaterial.tailWasteFt) || 0;

              // Set roll material configuration for the flat goods calculator
              flatGoodsInput.rollMaterial = {
                rollWidthIn,
                rollLengthFt,
                costPerRoll,
                edgeWasteInPerSide,
                leadWasteFt,
                tailWasteFt,
              };

              // Set material type to roll
              flatGoodsInput.materialType = "roll";

              // Use roll width as sheet width (for compatibility with existing code)
              flatGoodsInput.sheetWidth = rollWidthIn;
              flatGoodsInput.sheetHeight = 0; // Rolls have no fixed height

              // Calculate and set costPerSqft based on usable sqft
              const usableWidthIn = Math.max(0, rollWidthIn - 2 * edgeWasteInPerSide);
              const usableLengthFt = Math.max(0, rollLengthFt - leadWasteFt - tailWasteFt);
              const usableSqftPerRoll = (usableWidthIn / 12) * usableLengthFt;

              if (usableSqftPerRoll > 0 && costPerRoll > 0) {
                flatGoodsInput.basePricePerSqft = costPerRoll / usableSqftPerRoll;
                flatGoodsInput.rollMaterial.costPerSqft = flatGoodsInput.basePricePerSqft;
              }

              console.log(`[PRICING DEBUG] Roll material override: ${rollWidthIn}" x ${rollLengthFt}', edge waste: ${edgeWasteInPerSide}"/side, usable: ${usableWidthIn}" x ${usableLengthFt}', $/sqft: ${flatGoodsInput.basePricePerSqft.toFixed(4)}`);
            } else {
              // Sheet material handling (existing logic)
              flatGoodsInput.sheetWidth = parseFloat(effectiveMaterial.width) || flatGoodsInput.sheetWidth;
              flatGoodsInput.sheetHeight = parseFloat(effectiveMaterial.height) || flatGoodsInput.sheetHeight;
              // Material cost per unit (assuming unit = sheet for flat goods)
              const materialCostPerSheet = parseFloat(effectiveMaterial.costPerUnit) || 0;
              // Calculate price per sqft from material cost
              const sheetSqft = (flatGoodsInput.sheetWidth * flatGoodsInput.sheetHeight) / 144;
              if (sheetSqft > 0) {
                flatGoodsInput.basePricePerSqft = materialCostPerSheet / sheetSqft;
              }
              console.log(`[PRICING DEBUG] Sheet material override: ${flatGoodsInput.sheetWidth}×${flatGoodsInput.sheetHeight}, cost/sheet: ${materialCostPerSheet}, $/sqft: ${flatGoodsInput.basePricePerSqft}`);
            }
          }

          // Apply thickness-based pricing if multiplier mode (no material override)
          if (!effectiveMaterial && thicknessMultiplier !== 1.0) {
            flatGoodsInput.basePricePerSqft *= thicknessMultiplier;
            console.log(`[PRICING DEBUG] Thickness multiplier: ${thicknessMultiplier}x applied to base price`);
          }

          // Apply thickness volume pricing if volume mode
          if (thicknessVolumePricing) {
            flatGoodsInput.volumePricing = thicknessVolumePricing;
            console.log(`[PRICING DEBUG] Thickness volume pricing: applied ${thicknessVolumePricing.tiers?.length || 0} tiers`);
          }

          // PRE-PROCESSING: Check if sides volume pricing is needed
          // Scan selectedOptions for sides option with volume pricing mode
          for (const optionJson of productOptionsJson) {
            if (optionJson.config?.kind === "sides") {
              const rawSelectedSide = selectedOptions[optionJson.id];
              // Extract actual value from complex object if needed
              const selectedSideValue = (typeof rawSelectedSide === 'object' && rawSelectedSide !== null && 'value' in rawSelectedSide)
                ? rawSelectedSide.value
                : rawSelectedSide;

              if (selectedSideValue && optionJson.config.pricingMode === "volume" && optionJson.config.volumeTiers && optionJson.config.volumeTiers.length > 0) {
                // Store context for later option processing
                calculationContext.selectedSide = selectedSideValue;
                calculationContext.sidesVolumeTiers = optionJson.config.volumeTiers;

                // Override volumePricing in flatGoodsInput based on selected side
                // NestingCalculator expects: { enabled: true, tiers: [{ minSheets, maxSheets, pricePerSheet }] }
                flatGoodsInput.volumePricing = {
                  enabled: true,
                  tiers: optionJson.config.volumeTiers.map((tier: any) => ({
                    minSheets: tier.minSheets,
                    maxSheets: tier.maxSheets || null,
                    pricePerSheet: parseFloat(selectedSideValue === "double" ? tier.doublePricePerSheet : tier.singlePricePerSheet) || 0
                  }))
                };

                console.log(`[PRICING DEBUG] Sides volume pricing: Applied ${selectedSideValue} tiers to flatGoodsInput.volumePricing:`, JSON.stringify(flatGoodsInput.volumePricing));
                break;
              }
            }
          }

          console.log(`[NESTING DEBUG] Sheet: ${flatGoodsInput.sheetWidth}×${flatGoodsInput.sheetHeight}, Material: ${flatGoodsInput.materialType}, Price/SqFt: $${flatGoodsInput.basePricePerSqft}`);

          // Create nesting calculator factory for the helper
          const createNestingCalculator = (
            sheetWidth: number,
            sheetHeight: number,
            sheetCost: number,
            minPricePerItem: number | null,
            volumePricing: any
          ) => new NestingCalculator(sheetWidth, sheetHeight, sheetCost, minPricePerItem, volumePricing);

          // Calculate using centralized helper
          const flatGoodsResult = flatGoodsCalculator(flatGoodsInput, createNestingCalculator);

          // Check for errors
          if (flatGoodsResult.error) {
            return res.status(400).json({ message: flatGoodsResult.error });
          }

          basePrice = flatGoodsResult.totalPrice;
          nestingDetails = flatGoodsResult.nestingDetails;

          // Validate base price is a finite number
          if (!Number.isFinite(basePrice)) {
            console.error("Flat goods calculator produced invalid result:", basePrice);
            return res.status(400).json({ message: "Flat goods calculation produced an invalid result" });
          }
        } catch (error) {
          console.error("Error in flat goods calculator:", error);
          return res.status(400).json({ message: "Flat goods calculation failed" });
        }
      } else {
        // Use formula evaluation (default, qty_only, fee profiles)
        console.log(`[PRICING DEBUG] Using Formula Evaluation for product ${product.name}, profile: ${pricingProfile.key}`);
        if (!product.pricingFormula) {
          // For fee/qty_only profiles, default formula can be "q * unitPrice" or just the base price
          if (pricingProfile.key === "fee") {
            // Fee profiles: use variant price directly
            basePrice = basePricePerSqft * quantityNum;
            console.log(`[PRICING DEBUG] Fee profile - using variant price: ${basePricePerSqft} × ${quantityNum} = ${basePrice}`);
          } else if (pricingProfile.key === "qty_only") {
            // Quantity-only profiles: use variant price × quantity
            basePrice = basePricePerSqft * quantityNum;
            console.log(`[PRICING DEBUG] Qty-only profile - using variant price: ${basePricePerSqft} × ${quantityNum} = ${basePrice}`);
          } else {
            return res.status(400).json({ message: "Product must have either a pricing formula or nesting calculator enabled" });
          }
        } else {
          try {
            const formula = product.pricingFormula;
            console.log(`[PRICING DEBUG] Formula: ${formula}`);

            // Graceful failure: if formula references p but we cannot resolve it, return a clear error.
            const needsP = /\b(p|pricePerSqft|unitPrice|price)\b/.test(formula);
            if (needsP && !Object.prototype.hasOwnProperty.call(formulaContext, "p")) {
              return res
                .status(400)
                .send(
                  'Missing price per SqFt (p). Select a Primary Material with Unit "sqft" and a sell rate (retail/wholesale/base), or set a variant base price.'
                );
            }

            if (process.env.NODE_ENV === "development") {
              console.log("[FORMULA EVAL]", { formula, ctxKeys: Object.keys(formulaContext).sort() });
            }
            basePrice = evaluate(formula, formulaContext);

            // Validate base price is a finite number
            if (!Number.isFinite(basePrice)) {
              console.error("Base pricing formula produced invalid result:", basePrice);
              return res.status(400).json({ message: "Product pricing formula produced an invalid result" });
            }
          } catch (error) {
            console.error("Error evaluating formula:", error);
            return res.status(400).json({ message: "Invalid pricing formula" });
          }
        }
      }

      // Fetch product options and calculate option costs
      // SUPPORT BOTH: old productOptions table AND new optionsJson field
      const productOptions = productId ? await storage.getProductOptions(productId) : [];
      const productOptionsJson = ((product.optionsJson as unknown) as PricingOptionJson[]) || [];

      let optionsPrice = 0;
      const selectedOptionsArray: Array<{
        optionId: string;
        optionName: string;
        value: string | number | boolean;
        setupCost: number;
        calculatedCost: number;
      }> = [];

      // Build parent-child map to enforce parent toggle states
      const parentChildMap = new Map<string, string[]>();
      productOptions.forEach(opt => {
        if (opt.parentOptionId) {
          if (!parentChildMap.has(opt.parentOptionId)) {
            parentChildMap.set(opt.parentOptionId, []);
          }
          parentChildMap.get(opt.parentOptionId)!.push(opt.id);
        }
      });

      for (const optionId in selectedOptions) {
        const option = productOptions.find(opt => opt.id === optionId);
        if (!option || !option.isActive) continue;

        const value = selectedOptions[optionId];

        // Skip if toggle is false or value is null/undefined
        if (option.type === "toggle" && !value) continue;
        if (value === null || value === undefined) continue;

        // For number type, validate that value is finite
        if (option.type === "number") {
          const numValue = parseFloat(value as string);
          if (!Number.isFinite(numValue)) continue;
        }

        // Check if this option has a parent, and if so, verify parent is enabled
        if (option.parentOptionId) {
          const parent = productOptions.find(p => p.id === option.parentOptionId);
          if (parent && parent.type === "toggle") {
            const parentValue = selectedOptions[option.parentOptionId];
            if (!parentValue) continue; // Skip child if parent toggle is off
          }
        }

        // Parse setup cost safely with default to 0
        const setupCost = option.setupCost ? parseFloat(option.setupCost) : 0;
        let calculatedCost = Number.isFinite(setupCost) ? setupCost : 0;

        // Evaluate price formula if provided
        if (option.priceFormula) {
          try {
            let optionCost = 0;

            // For select options with string values, use simple conditional parsing
            // This is secure (no code execution) but limited to simple ternary patterns
            if (option.type === "select" && typeof value === "string") {
              // Parse formula pattern: value == "string" ? expr : ... : defaultExpr
              // Extract all condition-expression pairs
              const conditions: Array<{ compareValue: string; expression: string }> = [];
              const pattern = /eqstr\(value,\s*"([^"]+)"\)\s*\?\s*([^:]+?)(?=\s*:\s*eqstr\(value|$)/g;

              let match;
              while ((match = pattern.exec(option.priceFormula)) !== null) {
                conditions.push({
                  compareValue: match[1],
                  expression: match[2].trim()
                });
              }

              // Find matching condition
              let matched = false;
              for (const condition of conditions) {
                if (value === condition.compareValue) {
                  optionCost = evaluate(condition.expression, formulaContext);
                  matched = true;
                  break;
                }
              }

              // If no match, extract and evaluate default (after last colon)
              if (!matched) {
                const lastColonPos = option.priceFormula.lastIndexOf(':');
                if (lastColonPos !== -1) {
                  const defaultExpr = option.priceFormula.substring(lastColonPos + 1).trim();
                  optionCost = evaluate(defaultExpr, formulaContext);
                } else {
                  optionCost = 0;
                }
              }
            } else {
              // For number and toggle options, evaluate with mathjs
              optionCost = evaluate(option.priceFormula, {
                ...formulaContext,
                value: option.type === "number" ? parseFloat(value as string) : value,
              });
            }

            // Validate result is a finite number
            if (!Number.isFinite(optionCost)) {
              console.error(`Formula for option ${option.name} produced invalid result: ${optionCost}`);
              return res.status(400).json({ message: `Invalid formula result for option ${option.name}` });
            }

            calculatedCost += optionCost;
          } catch (error) {
            console.error(`Error evaluating formula for option ${option.name}:`, error);
            return res.status(400).json({ message: `Invalid formula for option ${option.name}` });
          }
        }

        // Final validation of calculated cost
        if (!Number.isFinite(calculatedCost)) {
          console.error(`Calculated cost for option ${option.name} is invalid: ${calculatedCost}`);
          return res.status(400).json({ message: `Invalid cost calculation for option ${option.name}` });
        }

        optionsPrice += calculatedCost;
        selectedOptionsArray.push({
          optionId: option.id,
          optionName: option.name,
          value,
          setupCost: Number.isFinite(setupCost) ? setupCost : 0,
          calculatedCost,
        });
      }

      // NEW: Process options from optionsJson field (inline product options)
      for (const optionId in selectedOptions) {
        const optionJson = productOptionsJson.find(opt => opt.id === optionId);
        if (!optionJson) continue; // Skip if not found in optionsJson

        const selectionData = selectedOptions[optionId];

        // Extract value - handle both simple values and complex objects
        let value: string | number | boolean;
        let grommetsLocation: string | undefined;
        let grommetsSpacingCount: number | undefined;
        let grommetsSpacingInches: number | undefined;
        let grommetsPerSign: number | undefined;
        let customPlacementNote: string | undefined;
        let hemsType: string | undefined;
        let polePocket: string | undefined;

        if (typeof selectionData === 'object' && selectionData !== null && 'value' in selectionData) {
          // Complex selection with grommets/hems/pole pocket data
          value = selectionData.value;
          grommetsLocation = selectionData.grommetsLocation;
          grommetsSpacingCount = selectionData.grommetsSpacingCount;
          grommetsSpacingInches = selectionData.grommetsSpacingInches;
          grommetsPerSign = selectionData.grommetsPerSign;
          customPlacementNote = selectionData.customPlacementNote;
          hemsType = selectionData.hemsType;
          polePocket = selectionData.polePocket;
        } else {
          // Simple value
          value = selectionData;
        }

        // Skip inactive selections
        if (optionJson.type === "checkbox" && !value) continue;
        if (value === null || value === undefined) continue;

        const optionAmount = optionJson.amount || 0;
        let setupCost = 0;
        let calculatedCost = 0;

        // Calculate costs based on priceMode
        if (optionJson.priceMode === "flat") {
          setupCost = optionAmount;
          calculatedCost = optionAmount;
        } else if (optionJson.priceMode === "per_qty") {
          calculatedCost = optionAmount * quantityNum;
        } else if (optionJson.priceMode === "per_sqft") {
          calculatedCost = optionAmount * sqft * quantityNum;
        } else if (optionJson.priceMode === "flat_per_item") {
          // Flat amount per finished piece (after nesting)
          calculatedCost = optionAmount * quantityNum;
        } else if (optionJson.priceMode === "percent_of_base") {
          // Percentage of base price (applied later after base calculation)
          // Store for post-processing
          calculatedCost = 0; // Will be calculated after base price
        }

        // Handle grommets special pricing
        if (optionJson.config?.kind === "grommets") {
          // Use grommetsPerSign if provided, otherwise default based on location
          let grommetCount = grommetsPerSign ?? 4; // Default to 4 grommets per sign

          if (!grommetsPerSign) {
            // Fallback: infer count from location if grommetsPerSign not explicitly set
            if (grommetsLocation === "all_corners") {
              grommetCount = 4;
            } else if (grommetsLocation === "top_corners") {
              grommetCount = 2;
            } else if (grommetsLocation === "top_even" && grommetsSpacingCount) {
              grommetCount = grommetsSpacingCount;
            } else if (grommetsLocation === "custom") {
              grommetCount = grommetsPerSign ?? 4; // Custom uses explicit count or default
            }
          }

          // For flat_per_item, multiply by grommet count and quantity
          if (optionJson.priceMode === "flat_per_item") {
            calculatedCost = optionAmount * grommetCount * quantityNum;
            console.log(`[PRICING DEBUG] Grommets: ${grommetCount} grommets/sign × ${quantityNum} qty × $${optionAmount}/grommet = $${calculatedCost}`);
          }
        }

        // Handle hems pricing
        if (optionJson.config?.kind === "hems") {
          const selectedHems = hemsType || optionJson.config.defaultHems || "none";
          if (selectedHems !== "none") {
            // Calculate hems cost - could be per linear foot or flat per piece
            if (optionJson.priceMode === "flat_per_item") {
              // Flat cost per piece based on hem selection
              let hemMultiplier = 1;
              if (selectedHems === "all_sides") hemMultiplier = 4;
              else if (selectedHems === "top_bottom" || selectedHems === "left_right") hemMultiplier = 2;
              calculatedCost = optionAmount * quantityNum * hemMultiplier;
              console.log(`[PRICING DEBUG] Hems (${selectedHems}): ${hemMultiplier} sides × ${quantityNum} qty × $${optionAmount} = $${calculatedCost}`);
            } else if (optionJson.priceMode === "per_sqft") {
              // Linear foot based pricing - approximate perimeter based on dimensions
              const perimeter = 2 * (widthNum + heightNum) / 12; // Convert to feet
              let hemFeet = perimeter;
              if (selectedHems === "top_bottom") hemFeet = 2 * widthNum / 12;
              else if (selectedHems === "left_right") hemFeet = 2 * heightNum / 12;
              calculatedCost = optionAmount * hemFeet * quantityNum;
              console.log(`[PRICING DEBUG] Hems (${selectedHems}): ${hemFeet.toFixed(2)} linear ft × ${quantityNum} qty × $${optionAmount}/ft = $${calculatedCost}`);
            }
          } else {
            calculatedCost = 0; // No hems selected
          }
        }

        // Handle pole pockets pricing
        if (optionJson.config?.kind === "pole_pockets") {
          const selectedPolePocket = polePocket || optionJson.config.defaultPolePocket || "none";
          if (selectedPolePocket !== "none") {
            // Calculate pole pocket cost
            if (optionJson.priceMode === "flat_per_item") {
              // Flat cost per pocket per piece
              let pocketCount = 1;
              if (selectedPolePocket === "top_bottom") pocketCount = 2;
              calculatedCost = optionAmount * pocketCount * quantityNum;
              console.log(`[PRICING DEBUG] Pole Pockets (${selectedPolePocket}): ${pocketCount} pockets × ${quantityNum} qty × $${optionAmount} = $${calculatedCost}`);
            } else if (optionJson.priceMode === "per_sqft") {
              // Linear foot based - width of banner for each pocket
              let pocketFeet = widthNum / 12;
              if (selectedPolePocket === "top_bottom") pocketFeet *= 2;
              calculatedCost = optionAmount * pocketFeet * quantityNum;
              console.log(`[PRICING DEBUG] Pole Pockets (${selectedPolePocket}): ${pocketFeet.toFixed(2)} linear ft × ${quantityNum} qty × $${optionAmount}/ft = $${calculatedCost}`);
            }
          } else {
            calculatedCost = 0; // No pole pockets selected
          }
        }

        // Skip thickness selector option - already processed in pre-stage
        if (optionJson.config?.kind === "thickness") {
          continue;
        }

        // Handle sides pricing - multiplier vs volume pricing mode
        if (optionJson.config?.kind === "sides" && value === "double") {
          const pricingMode = optionJson.config.pricingMode || "multiplier";

          if (pricingMode === "multiplier") {
            // Legacy multiplier mode - apply BEFORE profile pricing
            const multiplier = optionJson.config.doublePriceMultiplier || 1.6;
            basePrice *= multiplier;
            console.log(`[PRICING DEBUG] Sides option: applied ${multiplier}x multiplier to base price`);
          } else if (pricingMode === "volume") {
            // Volume pricing mode - already handled in flatGoodsInput preprocessing
            // No additional pricing logic needed here; volumePricing was injected before calculator
            console.log(`[PRICING DEBUG] Sides option: volume pricing already applied via flatGoodsInput.volumePricing`);
          }
        }

        optionsPrice += calculatedCost;
        selectedOptionsArray.push({
          optionId: optionJson.id,
          optionName: optionJson.label,
          value,
          setupCost,
          calculatedCost,
        });
      }

      // Option Tree v2 (schemaVersion=2) additive evaluation
      // When present on the product and provided by the client, evaluate and merge into snapshot/price.
      try {
        const tree = (product as any).optionTreeJson;
        if (tree && typeof tree === "object" && (tree as any).schemaVersion === 2) {
          const graph = validateOptionTreeV2(tree);
          if (!graph.ok) {
            return res.status(400).json({ message: "Invalid optionTreeJson (v2)", errors: graph.errors });
          }

          const v2 = evaluateOptionTreeV2({
            tree,
            selections: optionSelectionsJson ?? { schemaVersion: 2, selected: {} },
            width: widthNum,
            height: heightNum,
            quantity: quantityNum,
            basePrice,
          });

          if (Array.isArray(v2.selectedOptions) && v2.selectedOptions.length > 0) {
            for (let i = 0; i < v2.selectedOptions.length; i++) {
              selectedOptionsArray.push(v2.selectedOptions[i]);
            }
          }

          optionsPrice += v2.optionsPrice;
        }
      } catch (error) {
        if (isZodError(error)) {
          return res.status(400).json({ message: "Invalid optionTreeJson/optionSelectionsJson (v2)", errors: error.errors });
        }
        const details = (error as any)?.details;
        if (Array.isArray(details)) {
          return res.status(400).json({ message: "Invalid optionTreeJson (v2)", errors: details });
        }
        return res.status(400).json({ message: (error as Error)?.message || "Failed to evaluate option tree (v2)" });
      }

      // CALCULATE mediaSubtotal - includes only media/printing costs, excludes finishing add-ons
      // Media costs include:
      // - Base sheet/area price from NestingCalculator (after volume tiers, thickness, sides)
      // - Laminate (material add-ons that are part of the printed media)
      // Media costs EXCLUDE:
      // - Grommets, stakes, weed & tape, rush, and other non-media finishing options
      let mediaSubtotal = basePrice; // Start with base price (includes thickness, sides multipliers already applied)

      // Add non-percent, media-related options to mediaSubtotal
      // For now, we consider material add-ons (laminate) as part of media cost
      // All other options (grommets, stakes, etc.) are considered finishing and excluded
      for (const optJson of productOptionsJson) {
        if (!selectedOptions[optJson.id]) continue;
        if (optJson.priceMode === "percent_of_base") continue; // Skip percent options for now
        if (optJson.config?.kind === "thickness") continue; // Already in basePrice
        if (optJson.config?.kind === "sides") continue; // Already in basePrice

        // If option has materialAddonConfig, it's a media add-on (like laminate)
        if (optJson.materialAddonConfig) {
          // Find this option in selectedOptionsArray to get its calculated cost
          const optInArray = selectedOptionsArray.find(o => o.optionId === optJson.id);
          if (optInArray) {
            mediaSubtotal += optInArray.calculatedCost;
          }
        }
        // All other options (grommets, weed/tape, stakes, rush) are NOT added to mediaSubtotal
      }

      console.log(`[PRICING DEBUG] Media subtotal (print + material add-ons): $${mediaSubtotal}`);

      // Post-processing: Apply percent_of_base options with percentBase awareness
      const percentOfBaseOptions = productOptionsJson.filter(
        opt => opt.priceMode === "percent_of_base" && selectedOptions[opt.id]
      );

      // Separate options by their percentBase setting
      const mediaPercentOptions = percentOfBaseOptions.filter(opt => opt.percentBase === "media");
      const linePercentOptions = percentOfBaseOptions.filter(opt => !opt.percentBase || opt.percentBase === "line");

      // Apply media-based percent options (e.g., Contour Cutting)
      for (const percentOpt of mediaPercentOptions) {
        const percentValue = percentOpt.amount || 0;
        const percentCost = mediaSubtotal * (percentValue / 100);
        optionsPrice += percentCost;

        // Extract the actual value from selection data (could be simple or complex object)
        const selectionData = selectedOptions[percentOpt.id];
        const extractedValue = (typeof selectionData === 'object' && selectionData !== null && 'value' in selectionData)
          ? selectionData.value
          : selectionData;

        // Find and update the option in selectedOptionsArray
        const existingOpt = selectedOptionsArray.find(o => o.optionId === percentOpt.id);
        if (existingOpt) {
          existingOpt.calculatedCost = percentCost;
        } else {
          selectedOptionsArray.push({
            optionId: percentOpt.id,
            optionName: percentOpt.label,
            value: extractedValue,
            setupCost: 0,
            calculatedCost: percentCost,
          });
        }

        console.log(`[PRICING DEBUG] Percent of MEDIA: ${percentOpt.label} added ${percentValue}% of ${mediaSubtotal} = ${percentCost}`);
      }

      // Apply line-based percent options (e.g., Rush Fee - percent of full line)
      for (const percentOpt of linePercentOptions) {
        const percentValue = percentOpt.amount || 0;
        const percentCost = basePrice * (percentValue / 100);
        optionsPrice += percentCost;

        // Extract the actual value from selection data (could be simple or complex object)
        const selectionData = selectedOptions[percentOpt.id];
        const extractedValue = (typeof selectionData === 'object' && selectionData !== null && 'value' in selectionData)
          ? selectionData.value
          : selectionData;

        // Find and update the option in selectedOptionsArray
        const existingOpt = selectedOptionsArray.find(o => o.optionId === percentOpt.id);
        if (existingOpt) {
          existingOpt.calculatedCost = percentCost;
        } else {
          selectedOptionsArray.push({
            optionId: percentOpt.id,
            optionName: percentOpt.label,
            value: extractedValue,
            setupCost: 0,
            calculatedCost: percentCost,
          });
        }

        console.log(`[PRICING DEBUG] Percent of LINE: ${percentOpt.label} added ${percentValue}% of ${basePrice} = ${percentCost}`);
      }

      // Build materialUsages array for multi-material tracking
      const materialUsages: Array<{
        materialId: string;
        unitType: "sheet" | "sqft" | "linear_ft";
        quantity: number;
      }> = [];

      // Primary material usage
      if (useFlatGoodsCalculator && nestingDetails) {
        // Sheet-based product - use billableSheets from nesting calculator
        const primaryMaterialId = effectiveMaterial?.id || product.primaryMaterialId;
        if (primaryMaterialId && nestingDetails.billableSheets) {
          materialUsages.push({
            materialId: primaryMaterialId,
            unitType: "sheet",
            quantity: nestingDetails.billableSheets
          });
          console.log(`[MATERIAL USAGE] Primary material (sheet): ${primaryMaterialId}, ${nestingDetails.billableSheets} sheets`);
        }
      } else if (requiresDimensions && sqft > 0) {
        // Roll-based or area-based product - use total square footage
        const primaryMaterialId = product.primaryMaterialId;
        if (primaryMaterialId) {
          const totalSqFt = sqft * quantityNum;
          materialUsages.push({
            materialId: primaryMaterialId,
            unitType: "sqft",
            quantity: totalSqFt
          });
          console.log(`[MATERIAL USAGE] Primary material (roll): ${primaryMaterialId}, ${totalSqFt} sqft`);
        }
      }

      // Secondary material usage from material add-on options
      for (const optionJson of productOptionsJson) {
        if (optionJson.materialAddonConfig && selectedOptions[optionJson.id]) {
          const cfg = optionJson.materialAddonConfig;
          const wasteFactor = cfg.wasteFactor || 0;

          if (cfg.usageBasis === "same_area") {
            // Roll/area-based laminate - uses same square footage as printed area
            const baseAreaSqFt = sqft * quantityNum;
            const quantity = baseAreaSqFt * (1 + wasteFactor);

            materialUsages.push({
              materialId: cfg.materialId,
              unitType: cfg.unitType,
              quantity
            });

            console.log(`[MATERIAL USAGE] Add-on material (${optionJson.label}): ${cfg.materialId}, ${quantity} ${cfg.unitType} (base: ${baseAreaSqFt}, waste: ${wasteFactor * 100}%)`);
          } else if (cfg.usageBasis === "same_sheets" && nestingDetails?.billableSheets) {
            // Sheet-based laminate - uses same number of sheets
            const baseSheets = nestingDetails.billableSheets;
            const quantity = baseSheets * (1 + wasteFactor);

            materialUsages.push({
              materialId: cfg.materialId,
              unitType: cfg.unitType,
              quantity
            });

            console.log(`[MATERIAL USAGE] Add-on material (${optionJson.label}): ${cfg.materialId}, ${quantity} ${cfg.unitType} (base: ${baseSheets} sheets, waste: ${wasteFactor * 100}%)`);
          }
        }
      }

      let subtotal = basePrice + optionsPrice;
      let priceBreakDiscount = 0;
      let priceBreakInfo: { type: string; tier: string; discount: number } | undefined;

      // Apply price breaks if enabled
      if (product.priceBreaks && typeof product.priceBreaks === 'object') {
        const priceBreaks = product.priceBreaks as any;
        if (priceBreaks.enabled && priceBreaks.tiers && Array.isArray(priceBreaks.tiers)) {
          // Determine the value to compare based on price break type
          let compareValue = 0;
          switch (priceBreaks.type) {
            case "quantity":
              compareValue = quantityNum;
              break;
            case "sheets":
              compareValue = quantityNum; // For sheets, use quantity directly
              break;
            case "sqft":
              compareValue = sqft;
              break;
            default:
              compareValue = quantityNum;
          }

          // Find the applicable tier
          const applicableTier = priceBreaks.tiers
            .filter((tier: any) => {
              const minValue = tier.minValue || 0;
              const maxValue = tier.maxValue;
              return compareValue >= minValue && (maxValue === undefined || maxValue === null || compareValue <= maxValue);
            })
            .sort((a: any, b: any) => (b.minValue || 0) - (a.minValue || 0))[0];

          if (applicableTier) {
            // Apply the discount based on type
            switch (applicableTier.discountType) {
              case "percentage":
                priceBreakDiscount = subtotal * (applicableTier.discountValue / 100);
                break;
              case "fixed":
                priceBreakDiscount = applicableTier.discountValue;
                break;
              case "multiplier":
                subtotal = subtotal * applicableTier.discountValue;
                priceBreakDiscount = 0; // Multiplier is applied directly, not as a discount
                break;
            }

            priceBreakInfo = {
              type: priceBreaks.type,
              tier: `${applicableTier.minValue}${applicableTier.maxValue ? `-${applicableTier.maxValue}` : '+'}`,
              discount: priceBreakDiscount,
            };
          }
        }
      }

      const total = subtotal - priceBreakDiscount;

      // Final validation of total price
      if (!Number.isFinite(total)) {
        console.error("Total price is invalid:", total);
        return res.status(400).json({ message: "Total price calculation produced an invalid result" });
      }

      res.json({
        price: total,
        breakdown: {
          basePrice,
          mediaSubtotal, // NEW: Media/printing cost only (excludes finishing add-ons)
          addOnsPrice: 0, // Deprecated - keeping for backwards compatibility
          optionsPrice,
          subtotal,
          priceBreakDiscount,
          priceBreakInfo,
          total,
          formula: product.pricingFormula,
          selectedOptions: selectedOptionsArray,
          variantInfo: variantName || undefined,
          nestingDetails: nestingDetails || undefined,
          materialUsages, // NEW: Multi-material tracking
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

  app.post("/api/quotes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

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

      let finalizedLineItems: any[] = [];
      try {
        finalizedLineItems = await storage.finalizeTemporaryLineItemsForUser(
          organizationId,
          userId,
          quote.id
        );
        console.log(
          `[Quotes:POST] Finalized ${finalizedLineItems.length} temporary line items for quote ${quote.id}`
        );
      } catch (err) {
        console.error(
          "[Quotes:POST] Failed to finalize temporary line items for user",
          err
        );
        // Do not block quote creation if finalization fails
      }

      const allLineItems = [...(quote.lineItems || []), ...finalizedLineItems];

      res.json({
        success: true,
        data: {
          ...quote,
          lineItems: allLineItems,
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

  // List Settings (column visibility, order, custom labels, date format)
  app.get("/api/list-settings/:listKey", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ message: "User ID not found" });
      const { listKey } = req.params;

      const [settings] = await db
        .select()
        .from(listSettings)
        .where(
          and(
            eq(listSettings.organizationId, organizationId),
            eq(listSettings.userId, userId),
            eq(listSettings.listKey, listKey)
          )
        )
        .limit(1);

      res.json({ settings: settings?.settingsJson || {} });
    } catch (error) {
      console.error("Error fetching list settings:", error);
      res.status(500).json({ message: "Failed to fetch list settings" });
    }
  });

  app.put("/api/list-settings/:listKey", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const { listKey } = req.params;
      const { settings } = req.body;

      const [updated] = await db
        .insert(listSettings)
        .values({
          organizationId,
          userId,
          listKey,
          settingsJson: settings,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [listSettings.organizationId, listSettings.userId, listSettings.listKey],
          set: {
            settingsJson: settings,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json({ success: true, settings: updated.settingsJson });
    } catch (error) {
      console.error("Error updating list settings:", error);
      res.status(500).json({ message: "Failed to update list settings" });
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

      // Enforce requireApproval preference: Block draft → sent if approval is required
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

      const result = await db.transaction(async (tx) => {
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
          .then((rows) => rows[0]);

        if (!sourceQuote) {
          throw Object.assign(new Error('Quote not found'), { statusCode: 404 });
        }

        // Allow revising approved quotes (status='active') OR converted quotes (has convertedToOrderId)
        // This enables creating new drafts from terminal states that warrant revision
        const isApproved = String((sourceQuote as any).status) === 'active';
        const isConverted = !!(sourceQuote as any).convertedToOrderId;

        if (!isApproved && !isConverted) {
          throw Object.assign(new Error('Only approved or converted quotes can be revised.'), { statusCode: 409 });
        }

        // Get or auto-initialize next quote number (same logic as createQuote)
        let quoteNumberVar = await tx
          .select()
          .from(globalVariables)
          .where(and(
            eq(globalVariables.name, 'next_quote_number'),
            eq(globalVariables.organizationId, organizationId)
          ))
          .limit(1)
          .then((rows) => rows[0]);

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
            label: sourceQuote.label,
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

        // Copy line items (preserve ordering)
        const sourceLineItems = await tx
          .select()
          .from(quoteLineItems)
          .where(and(
            eq(quoteLineItems.quoteId, sourceQuoteId),
          ))
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
            } as any)
            .returning();

          lineItemIdMap.set(li.id, createdLi.id);
        }

        // Copy attachments (quote-level + line-item). Also copy attachment pages for PDF thumbnails.
        const sourceAttachments = await tx
          .select()
          .from(quoteAttachments)
          .where(and(
            eq(quoteAttachments.quoteId, sourceQuoteId),
            eq(quoteAttachments.organizationId, organizationId),
          ))
          .orderBy(asc(quoteAttachments.createdAt));

        const attachmentIdMap = new Map<string, string>();

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
              uploadedByUserId: att.uploadedByUserId,
              uploadedByName: att.uploadedByName,

              fileName: att.fileName,
              fileUrl: att.fileUrl,
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

          attachmentIdMap.set(att.id, createdAtt.id);

          // Copy PDF thumbnail pages if present (only if table exists)
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
                    thumbKey: p.thumbKey,
                    previewKey: p.previewKey,
                    thumbError: p.thumbError,
                    updatedAt: new Date(),
                  } as any);
              }
            } catch (error: any) {
              // If table was dropped mid-transaction or other DB error, log and continue
              // Don't fail the entire revise operation for missing page metadata
              const pgCode = error?.code;
              if (pgCode === '42P01') {
                console.warn('[ReviseQuote] Skipping attachment page copy: quote_attachment_pages missing (42P01)');
              } else {
                console.error('[ReviseQuote] Error copying attachment pages (non-fatal):', error);
              }
              // Continue with revise operation - page metadata is not critical
            }
          } else {
            console.log('[ReviseQuote] Skipping attachment page copy: quote_attachment_pages table not available');
          }
        }

        // Provenance via audit logs (both quotes)
        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName,
          actionType: 'CREATE',
          entityType: 'quote',
          entityId: newQuote.id,
          entityName: newQuote.quoteNumber != null ? String(newQuote.quoteNumber) : undefined,
          description: `Created as revision of quote ${sourceQuote.quoteNumber ?? ''}`.trim(),
          newValues: { sourceQuoteId: sourceQuote.id, sourceQuoteNumber: sourceQuote.quoteNumber },
        } as any);

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName,
          actionType: 'UPDATE',
          entityType: 'quote',
          entityId: sourceQuote.id,
          entityName: sourceQuote.quoteNumber != null ? String(sourceQuote.quoteNumber) : undefined,
          description: `Revised to quote ${newQuote.quoteNumber ?? ''}`.trim(),
          newValues: { revisedQuoteId: newQuote.id, revisedQuoteNumber: newQuote.quoteNumber },
        } as any);

        return {
          id: newQuote.id,
          quoteNumber: newQuote.quoteNumber,
        };
      });

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

      // Allow placeholder line items (productId can be null for newly created items awaiting product selection)
      // This enables the "create first, then edit" workflow where artwork can be attached immediately
      const isPlaceholder = !lineItem.productId;

      // For non-placeholder items, validate required fields
      if (!isPlaceholder && (!lineItem.productName || lineItem.width == null || lineItem.height == null || lineItem.quantity == null || lineItem.linePrice == null)) {
        return res.status(400).json({ message: "Missing required fields in line item" });
      }

      const allowedStatus = ["draft", "active", "canceled"];
      const incomingStatus = allowedStatus.includes(lineItem.status) ? lineItem.status : "active";

      const validatedLineItem = {
        productId: lineItem.productId || null,
        productName: lineItem.productName || "New Item (Select Product)",
        variantId: lineItem.variantId || null,
        variantName: lineItem.variantName || null,
        productType: lineItem.productType || 'wide_roll',
        status: incomingStatus,
        width: lineItem.width != null ? parseFloat(lineItem.width) : 0,
        height: lineItem.height != null ? parseFloat(lineItem.height) : 0,
        quantity: lineItem.quantity != null ? parseInt(lineItem.quantity) : 1,
        specsJson: lineItem.specsJson || null,
        optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
        selectedOptions: lineItem.selectedOptions || [],
        linePrice: lineItem.linePrice != null ? parseFloat(lineItem.linePrice) : 0,
        formulaLinePrice: lineItem.formulaLinePrice != null ? String(parseFloat(lineItem.formulaLinePrice)) : null,
        priceOverride: lineItem.priceOverride || null,
        priceBreakdown: lineItem.priceBreakdown || {
          basePrice: lineItem.linePrice != null ? parseFloat(lineItem.linePrice) : 0,
          optionsPrice: 0,
          total: lineItem.linePrice != null ? parseFloat(lineItem.linePrice) : 0,
          formula: "",
        },
        displayOrder: lineItem.displayOrder || 0,
        // Existing route always attaches to a concrete quote, so not temporary
        isTemporary: false,
      };

      const createdLineItem = await storage.addLineItem(id, validatedLineItem);
      res.json(createdLineItem);
    } catch (error) {
      console.error("Error adding line item:", error);
      res.status(500).json({ message: "Failed to add line item" });
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
        linePrice,
        formulaLinePrice,
        priceOverride,
        priceBreakdown,
        displayOrder,
      } = req.body;

      if (!productId || typeof productId !== "string") {
        return res.status(400).json({ message: "productId is required for temporary line items" });
      }

      const widthNum = width != null ? Number(width) : 1;
      const heightNum = height != null ? Number(height) : 1;
      const quantityNum = quantity != null ? Number(quantity) : 1;
      const linePriceNum = linePrice != null ? Number(linePrice) : 0;

      const effectivePriceBreakdown = priceBreakdown || {
        basePrice: linePriceNum,
        optionsPrice: 0,
        total: linePriceNum,
        formula: "",
      };

      const validatedLineItem = {
        productId,
        productName: productName || "New Item (Select Product)",
        variantId: variantId || null,
        variantName: variantName || null,
        productType: productType || "wide_roll",
        width: Number.isFinite(widthNum) && widthNum > 0 ? widthNum : 1,
        height: Number.isFinite(heightNum) && heightNum > 0 ? heightNum : 1,
        quantity: Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : 1,
        specsJson: specsJson || null,
        optionSelectionsJson: optionSelectionsJson ?? null,
        selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
        linePrice: Number.isFinite(linePriceNum) && linePriceNum >= 0 ? linePriceNum : 0,
        formulaLinePrice: formulaLinePrice != null ? String(Number(formulaLinePrice)) : null,
        priceOverride: priceOverride || null,
        priceBreakdown: effectivePriceBreakdown,
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
      res.status(500).json({ message: "Failed to create temporary line item" });
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
      if (lineItem.linePrice !== undefined) updateData.linePrice = parseFloat(lineItem.linePrice);
      if (lineItem.formulaLinePrice !== undefined) updateData.formulaLinePrice = lineItem.formulaLinePrice != null ? String(parseFloat(lineItem.formulaLinePrice)) : null;
      if (lineItem.priceOverride !== undefined) updateData.priceOverride = lineItem.priceOverride;
      if (lineItem.priceBreakdown !== undefined) updateData.priceBreakdown = lineItem.priceBreakdown;
      if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;
      if (lineItem.isTemporary !== undefined) updateData.isTemporary = lineItem.isTemporary;
      if (lineItem.quoteId !== undefined) updateData.quoteId = lineItem.quoteId;

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

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Files / Attachments
  // ────────────────────────────────────────────────────────────────────────────

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


  // ────────────────────────────────────────────────────────────────────────────
  // Quote file/attachment routes moved to ./routes/attachments.routes.ts
  // (GET/POST/DELETE /api/quotes/:id/files, chunked uploads, /api/quotes/:quoteId/attachments)
  // ────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Line Item Attachments (per-line-item artwork)
  // ────────────────────────────────────────────────────────────────────────────

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
      const enrichedAssets = enrichAssetsWithRoles(linkedAssets);

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

      const { fileName, fileUrl, fileSize, mimeType, description, fileBuffer, originalFilename, storageTarget, requestedStorageTarget } = req.body;

      console.log(`[LineItemFiles:POST] quoteId=${quoteId}, lineItemId=${lineItemId}, fileName=${fileName}`);

      if (!fileName && !originalFilename) {
        return res.status(400).json({ error: "fileName or originalFilename is required" });
      }

      const requestedTarget =
        (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
        (typeof storageTarget === 'string' ? storageTarget : null);

      const bufferForDecision = fileBuffer ? Buffer.from(fileBuffer, 'base64') : null;
      const sizeForDecision = bufferForDecision ? bufferForDecision.length : (fileSize != null ? Number(fileSize) : 0);

      const { decideStorageTarget, getMaxCloudUploadBytes } = await import('./services/storageTarget');
      const maxCloudBytes = getMaxCloudUploadBytes();
      const decidedTarget = decideStorageTarget({
        fileName: (originalFilename || fileName || null) as any,
        fileSizeBytes: sizeForDecision,
        requestedTarget,
        organizationId,
        context: 'POST /api/quotes/:quoteId/line-items/:lineItemId/files',
      });

      // Explicit local_dev selection requires atomic upload payload.
      // But server enforcement wins: even if client asked for local_dev, we may decide supabase.
      if (decidedTarget === 'local_dev' && (!fileBuffer || !originalFilename)) {
        return res.status(400).json({
          error: "local_dev uploads require fileBuffer + originalFilename",
          maxCloudBytes,
          decidedTarget,
        });
      }

      // Legacy flow requires fileUrl.
      if (!fileBuffer && !fileUrl) {
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

      let attachmentData: any = {
        quoteId,
        quoteLineItemId: lineItemId,
        organizationId,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        description: description || null,
        bucket: 'titan-private',
      };

      // Atomic upload path (server decides provider)
      if (fileBuffer && originalFilename) {
        const buffer = bufferForDecision || Buffer.from(fileBuffer, 'base64');
        const contentType = (mimeType || 'application/octet-stream') as string;

        if (decidedTarget === 'supabase' && isSupabaseConfigured()) {
          const { SupabaseStorageService } = await import('./supabaseStorage');
          const {
            generateStoredFilename,
            generateRelativePath,
            computeChecksum,
            getFileExtension,
          } = await import('./utils/fileStorage');

          const storedFilename = generateStoredFilename(originalFilename);
          const relativePath = generateRelativePath({
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            storedFilename,
          });
          const checksum = computeChecksum(buffer);
          const extension = getFileExtension(originalFilename);

          const supabase = new SupabaseStorageService();
          const uploaded = await supabase.uploadFile(relativePath, buffer, contentType);

          attachmentData = {
            ...attachmentData,
            fileName: originalFilename,
            originalFilename,
            fileUrl: normalizeObjectKeyForDb(uploaded.path),
            fileSize: buffer.length,
            mimeType: contentType,
            storedFilename,
            relativePath: normalizeObjectKeyForDb(uploaded.path),
            storageProvider: 'supabase',
            extension,
            sizeBytes: buffer.length,
            checksum,
            thumbStatus: isPdfEarly ? ('thumb_pending' as const) : ('uploaded' as const),
          };
        } else {
          const { processUploadedFile } = await import('./utils/fileStorage');

          const fileMetadata = await processUploadedFile({
            originalFilename,
            buffer,
            mimeType: contentType,
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
          });

          attachmentData = {
            ...attachmentData,
            fileName: originalFilename,
            originalFilename: fileMetadata.originalFilename,
            fileUrl: fileMetadata.relativePath,
            fileSize: fileMetadata.sizeBytes,
            mimeType: contentType,
            storedFilename: fileMetadata.storedFilename,
            relativePath: fileMetadata.relativePath,
            storageProvider: 'local',
            extension: fileMetadata.extension,
            sizeBytes: fileMetadata.sizeBytes,
            checksum: fileMetadata.checksum,
            thumbStatus: isPdfEarly ? ('thumb_pending' as const) : ('uploaded' as const),
          };
        }
      } else {
        // Legacy/signed-URL path
        const storageKey = fileUrl as string;
        let storageProvider: string | undefined;

        if (storageKey && (storageKey.startsWith('http://') || storageKey.startsWith('https://'))) {
          storageProvider = undefined;
        } else if (decidedTarget === 'supabase') {
          storageProvider = 'supabase';
        } else {
          storageProvider = 'local';
        }

        attachmentData = {
          ...attachmentData,
          fileName: (fileName || originalFilename) as string,
          originalFilename: (originalFilename || fileName) as string,
          fileUrl:
            storageProvider === 'supabase' && storageKey && !storageKey.startsWith('http://') && !storageKey.startsWith('https://')
              ? normalizeObjectKeyForDb(storageKey)
              : storageKey,
          fileSize: fileSize || null,
          mimeType: mimeType || null,
          storageProvider,
          thumbStatus: isPdfEarly ? ('thumb_pending' as const) : ('uploaded' as const),
        };
      }

      // Only include PDF-specific fields if columns exist
      if (pdfColumnsExist) {
        attachmentData.pageCountStatus = isPdfEarly ? ('detecting' as const) : ('unknown' as const);
      }

      console.log(`[LineItemFiles:POST] Inserting attachment with quoteLineItemId=${lineItemId}`);
      const [attachment] = await db.insert(quoteAttachments).values(attachmentData).returning();

      // Best-effort self-check for Supabase-backed keys (non-blocking)
      if (attachment.storageProvider === 'supabase' && attachment.fileUrl) {
        res.on('finish', () => {
          scheduleSupabaseObjectSelfCheck({
            bucket: 'titan-private',
            path: attachment.fileUrl,
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
          fileKey: attachment.fileUrl, // Storage key
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

      const hasStorageProvider = !!attachment.storageProvider;
      const isNotHttpUrl =
        !!attachment.fileUrl &&
        !attachment.fileUrl.startsWith('http://') &&
        !attachment.fileUrl.startsWith('https://');

      console.log('[LineItemFiles:POST][Detect]', {
        attachmentId: attachment.id,
        fileName: attachmentFileName,
        mimeType: attachment.mimeType ?? null,
        storageProvider: attachment.storageProvider ?? null,
        fileUrl: attachment.fileUrl ?? null,
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

      if (isSupportedImage && hasStorageProvider && isNotHttpUrl && attachment.fileUrl) {
        const { generateImageDerivatives, isThumbnailGenerationEnabled } = await import('./services/thumbnailGenerator');
        if (isThumbnailGenerationEnabled()) {
          void generateImageDerivatives(
            attachment.id,
            'quote',
            attachment.fileUrl,
            attachment.mimeType || null,
            attachment.storageProvider!,
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
        console.log(`[LineItemFiles:POST] Skipping thumbnail generation for ${attachment.id}: storageProvider=${attachment.storageProvider}, fileUrl starts with http=${attachment.fileUrl?.startsWith('http')}`);
      }

      // Fire-and-forget PDF processing for PDFs (non-blocking)
      // Trigger AFTER response finishes to ensure upload completes successfully first
      // Normalize storageProvider: if missing but Supabase is configured and fileUrl starts with "uploads/", treat as supabase
      const normalizedStorageProvider =
        attachment.storageProvider ??
        (isSupabaseConfigured() && attachment.fileUrl?.startsWith("uploads/")
          ? "supabase"
          : null);

      if (isPdf || isAi) {
        if (!pdfColumnsExist) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but pdf columns missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!normalizedStorageProvider) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but storageProvider missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!isNotHttpUrl) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl is http(s); skipping processing for attachmentId=${attachment.id}`);
        } else if (!attachment.fileUrl) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl missing; skipping processing for attachmentId=${attachment.id}`);
        } else {
          console.log(`[LineItemFiles:POST] PDF/AI detected; queued processing for attachmentId=${attachment.id}, fileName=${attachmentFileName}`);

          res.on("finish", () => {
            setImmediate(() => {
              void (async () => {
                try {
                  console.log(`[LineItemFiles:POST] Starting PDF processing for attachmentId=${attachment.id}`);
                  const { processPdfAttachmentDerivedData } = await import('./services/pdfProcessing');
                  await processPdfAttachmentDerivedData({
                    orgId: organizationId,
                    attachmentId: attachment.id,
                    storageKey: attachment.fileUrl,
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

      res.json({ success: true, data: attachment });
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

      // Generate signed download URL (valid for 1 hour)
      let signedUrl: string;
      if (isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        signedUrl = await supabaseService.getSignedDownloadUrl(attachment.fileUrl, 3600);
      } else {
        // For Replit Object Storage or other providers, return the stored URL directly
        // Note: This assumes the stored URL is publicly accessible or pre-signed
        signedUrl = attachment.fileUrl;
      }

      // Use originalFilename for download, fallback to fileName
      const fileName = attachment.originalFilename || attachment.fileName;

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

      // Download from Supabase and stream to client
      if (isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        const signedUrl = await supabaseService.getSignedDownloadUrl(attachment.fileUrl, 3600);

        // Fetch file from Supabase
        const fileResponse = await fetch(signedUrl);
        if (!fileResponse.ok) {
          throw new Error("Failed to fetch file from storage");
        }

        // Set Content-Disposition header with original filename
        const fileName = attachment.originalFilename || attachment.fileName;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');

        // Stream file to client
        const buffer = await fileResponse.arrayBuffer();
        res.send(Buffer.from(buffer));
      } else {
        return res.status(501).json({ error: "Proxy download not supported for this storage provider" });
      }
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

      // Generate signed URLs for derived assets if they exist
      let thumbUrl: string | null = null;
      let previewUrl: string | null = null;

      if (attachment.thumbKey && isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        thumbUrl = await supabaseService.getSignedDownloadUrl(attachment.thumbKey, 3600);
      }

      if (attachment.previewKey && isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        previewUrl = await supabaseService.getSignedDownloadUrl(attachment.previewKey, 3600);
      }

      console.log(`[LineItemFiles:ASSETS] Returning assets for file ${fileId}, thumbStatus=${attachment.thumbStatus}`);

      return res.json({
        success: true,
        data: {
          thumbUrl,
          previewUrl,
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

      // Validate required fields for image generation
      if (!attachment.fileUrl || !attachment.storageProvider) {
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
        attachment.fileUrl,
        attachment.mimeType,
        attachment.storageProvider,
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

      // Generate signed download URL (valid for 1 hour)
      let signedUrl: string;
      if (isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        signedUrl = await supabaseService.getSignedDownloadUrl(attachment.fileUrl, 3600);
      } else {
        // For Replit Object Storage or other providers, return the stored URL directly
        // Note: This assumes the stored URL is publicly accessible or pre-signed
        signedUrl = attachment.fileUrl;
      }

      console.log(`[LineItemFiles:DOWNLOAD:TEMP] Generated signed URL for file ${fileId}`);

      return res.json({ success: true, data: { signedUrl } });
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

      // Best-effort cleanup of stored objects (do not fail request if cleanup fails)
      try {
        const keys = [
          existingAttachment.relativePath,
          existingAttachment.fileUrl,
          existingAttachment.thumbnailRelativePath,
          existingAttachment.thumbKey,
          existingAttachment.previewKey,
        ].filter((k): k is string => typeof k === 'string' && k.length > 0);

        if (existingAttachment.storageProvider === 'supabase') {
          const supabaseStorage = new SupabaseStorageService();
          await Promise.all(keys.map(async (k) => {
            try {
              await supabaseStorage.deleteFile(k);
            } catch {
              // ignore
            }
          }));
        } else {
          const { deleteFile: deleteLocalFile } = await import('./utils/fileStorage');
          await Promise.all(keys.map(async (k) => {
            try {
              await deleteLocalFile(k);
            } catch {
              // ignore
            }
          }));
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

  app.get("/api/pricing-rules", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const rules = await storage.getAllPricingRules(organizationId);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching pricing rules:", error);
      res.status(500).json({ message: "Failed to fetch pricing rules" });
    }
  });

  // Formula templates routes (admin only)
  app.get("/api/formula-templates", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const templates = await storage.getAllFormulaTemplates(organizationId);
      console.log(`[DEBUG] Returning ${templates.length} formula templates:`, templates.map(t => ({ id: t.id, name: t.name })));
      res.json(templates);
    } catch (error) {
      console.error("Error fetching formula templates:", error);
      res.status(500).json({ message: "Failed to fetch formula templates" });
    }
  });

  app.get("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const template = await storage.getFormulaTemplateById(organizationId, id);
      if (!template) {
        return res.status(404).json({ message: "Formula template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error fetching formula template:", error);
      res.status(500).json({ message: "Failed to fetch formula template" });
    }
  });

  app.get("/api/formula-templates/:id/products", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const products = await storage.getProductsByFormulaTemplate(organizationId, id);
      res.json(products);
    } catch (error) {
      console.error("Error fetching products for formula template:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/formula-templates", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      console.log("[DEBUG] Creating formula template with data:", req.body);
      const template = await storage.createFormulaTemplate(organizationId, req.body);
      console.log("[DEBUG] Created formula template:", { id: template.id, name: template.name });
      res.json(template);
    } catch (error) {
      console.error("Error creating formula template:", error);
      res.status(500).json({ message: "Failed to create formula template" });
    }
  });

  app.patch("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const template = await storage.updateFormulaTemplate(organizationId, id, req.body);
      res.json(template);
    } catch (error) {
      console.error("Error updating formula template:", error);
      res.status(500).json({ message: "Failed to update formula template" });
    }
  });

  app.delete("/api/formula-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      await storage.deleteFormulaTemplate(organizationId, id);
      res.json({ message: "Formula template deleted successfully" });
    } catch (error) {
      console.error("Error deleting formula template:", error);
      res.status(500).json({ message: "Failed to delete formula template" });
    }
  });

  // Email Settings routes
  app.get("/api/email-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getAllEmailSettings(organizationId);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching email settings:", error);
      res.status(500).json({ message: "Failed to fetch email settings" });
    }
  });

  app.get("/api/email-settings/default", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getDefaultEmailSettings(organizationId);
      if (!settings) {
        return res.status(404).json({ message: "No default email settings found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching default email settings:", error);
      res.status(500).json({ message: "Failed to fetch default email settings" });
    }
  });

  app.post("/api/email-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = insertEmailSettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...settingsWithoutOrgId } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.createEmailSettings(organizationId, settingsWithoutOrgId);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating email settings:", error);
      res.status(500).json({ message: "Failed to create email settings" });
    }
  });

  app.patch("/api/email-settings/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = updateEmailSettingsSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const { id, organizationId: _orgId, ...updateData } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.updateEmailSettings(organizationId, req.params.id, updateData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating email settings:", error);
      res.status(500).json({ message: "Failed to update email settings" });
    }
  });

  app.delete("/api/email-settings/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteEmailSettings(organizationId, req.params.id);
      res.json({ message: "Email settings deleted successfully" });
    } catch (error) {
      console.error("Error deleting email settings:", error);
      res.status(500).json({ message: "Failed to delete email settings" });
    }
  });

  // Email sending routes
  app.post("/api/email/test", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { recipientEmail } = req.body;
      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      await emailService.sendTestEmail(organizationId, recipientEmail);
      res.json({ message: "Test email sent successfully" });
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to send test email"
      });
    }
  });

  app.post("/api/quotes/:id/email", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { id } = req.params;
      const { recipientEmail } = req.body;

      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      // Verify user has access to this quote
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);

      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      await emailService.sendQuoteEmail(organizationId, id, recipientEmail, isInternalUser ? undefined : userId);
      res.json({ message: "Quote email sent successfully" });
    } catch (error) {
      console.error("Error sending quote email:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to send quote email"
      });
    }
  });

  // Company Settings routes
  app.get("/api/company-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getCompanySettings(organizationId);
      if (!settings) {
        return res.status(404).json({ message: "Company settings not found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.post("/api/company-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = insertCompanySettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...settingsWithoutOrgId } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.createCompanySettings(organizationId, settingsWithoutOrgId);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating company settings:", error);
      res.status(500).json({ message: "Failed to create company settings" });
    }
  });

  app.patch("/api/company-settings/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = updateCompanySettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...updateData } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.updateCompanySettings(organizationId, req.params.id, updateData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  // Global search endpoint
  // Global search endpoint - searches across all major entities
  app.get("/api/search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      console.log("[GLOBAL SEARCH API] Request received. OrgId:", organizationId);

      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const query = req.query.q as string;
      console.log("[GLOBAL SEARCH API] Query param 'q':", query);

      if (!query || query.length < 2) {
        console.log("[GLOBAL SEARCH API] Query too short or empty, returning empty results");
        return res.json({ customers: [], contacts: [], orders: [], quotes: [], invoices: [], jobs: [] });
      }

      const lowerQuery = query.toLowerCase();
      console.log("[GLOBAL SEARCH API] Searching with lowercase query:", lowerQuery);

      // Search customers
      console.log("[GLOBAL SEARCH API] Calling storage.getAllCustomers...");
      const customersResults = await storage.getAllCustomers(organizationId, { search: query });
      console.log("[GLOBAL SEARCH API] Raw customers results count:", customersResults?.length || 0);
      if (customersResults && customersResults.length > 0) {
        console.log("[GLOBAL SEARCH API] First customer:", customersResults[0]);
      }
      const customers = customersResults.slice(0, 5).map((customer: any) => ({
        id: customer.id,
        title: customer.companyName,
        subtitle: customer.email || customer.phone || undefined,
        url: `/customers/${customer.id}`,
      }));

      // Search contacts
      const contactsResults = await storage.getAllContacts(organizationId, { search: query, page: 1, pageSize: 5 });
      const contacts = contactsResults.slice(0, 5).map((contact: any) => ({
        id: contact.id,
        title: `${contact.firstName} ${contact.lastName}`,
        subtitle: contact.email || contact.companyName || undefined,
        url: `/contacts/${contact.id}`,
      }));

      // Search orders
      const allOrders = await storage.getAllOrders(organizationId);
      const matchingOrders = allOrders
        .filter((order: any) =>
          String(order.orderNumber || '').toLowerCase().includes(lowerQuery) ||
          String(order.jobNumber || '').toLowerCase().includes(lowerQuery) ||
          String(order.customerPO || '').toLowerCase().includes(lowerQuery) ||
          String(order.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((order: any) => ({
          id: order.id,
          title: `Order #${order.orderNumber || order.id.slice(0, 8)}`,
          subtitle: order.customerName || order.status || undefined,
          url: `/orders/${order.id}`,
        }));

      // Search quotes
      const allQuotes = await storage.getAllQuotes(organizationId);
      const matchingQuotes = allQuotes
        .filter((quote: any) =>
          String(quote.quoteNumber || '').toLowerCase().includes(lowerQuery) ||
          String(quote.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((quote: any) => ({
          id: quote.id,
          title: `Quote #${quote.quoteNumber || quote.id.slice(0, 8)}`,
          subtitle: quote.customerName || undefined,
          url: `/edit-quote/${quote.id}`,
        }));

      // Search invoices
      const allInvoices = await db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .orderBy(desc(invoices.createdAt));

      const matchingInvoices = allInvoices
        .filter((invoice: any) =>
          String(invoice.invoiceNumber || '').toLowerCase().includes(lowerQuery) ||
          String(invoice.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((invoice: any) => ({
          id: invoice.id,
          title: `Invoice #${invoice.invoiceNumber || invoice.id.slice(0, 8)}`,
          subtitle: invoice.customerName || invoice.status || undefined,
          url: `/invoices/${invoice.id}`,
        }));

      // Search jobs (from orders)
      const jobsFromOrders = allOrders
        .filter((order: any) =>
          order.jobNumber && String(order.jobNumber).toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((order: any) => ({
          id: order.id,
          title: `Job ${order.jobNumber}`,
          subtitle: order.customerName || order.status || undefined,
          url: `/production/${order.id}`,
        }));

      const response = {
        customers,
        contacts,
        orders: matchingOrders,
        quotes: matchingQuotes,
        invoices: matchingInvoices,
        jobs: jobsFromOrders,
      };

      console.log("[GLOBAL SEARCH API] Sending response:", {
        customersCount: customers.length,
        contactsCount: contacts.length,
        ordersCount: matchingOrders.length,
        quotesCount: matchingQuotes.length,
        invoicesCount: matchingInvoices.length,
        jobsCount: jobsFromOrders.length,
      });
      console.log("[GLOBAL SEARCH API] First customer in response:", customers[0]);

      res.json(response);
    } catch (error) {
      console.error("[GLOBAL SEARCH API] Error performing search:", error);
      res.status(500).json({ message: "Search failed" });
    }
  });

  // Customer routes
  app.get("/api/customers", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const filters = {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
        customerType: req.query.customerType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const customers = await storage.getAllCustomers(organizationId, filters);

      // Calculate availableCredit for each customer
      const customersWithCredit = customers.map(customer => ({
        ...customer,
        availableCredit: (parseFloat(customer.creditLimit || "0") - parseFloat(customer.currentBalance || "0")).toString(),
      }));

      res.json(customersWithCredit);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.post("/api/customers", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const primaryContactInputSchema = z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        title: z.string().optional(),
        isPrimary: z.boolean().optional(),
      });

      const createCustomerWithContactSchema = insertCustomerSchema.extend({
        primaryContact: primaryContactInputSchema.optional(),
      });

      const parsed = createCustomerWithContactSchema.parse(req.body);
      const { primaryContact, ...customerData } = parsed;

      const result = await storage.createCustomerWithPrimaryContact(organizationId, {
        customer: customerData,
        primaryContact: primaryContact || null,
      });

      res.json(result.customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Zod validation error:", error.errors);
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.patch("/api/customers/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const customerData = updateCustomerSchema.parse(req.body);
      const customer = await storage.updateCustomer(organizationId, req.params.id, customerData);
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer:", error);
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteCustomer(organizationId, req.params.id);
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  // =============================
  // Customer CSV Import/Export
  // =============================
  app.get("/api/customers/csv-template", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const templateData = [
        {
          'Customer ID': '',
          'Company Name': 'Acme Printing',
          'Customer Type': 'business',
          Email: 'billing@acme.com',
          Phone: '555-555-5555',
          Website: 'https://acme.com',
          'Billing Street 1': '123 Main St',
          'Billing Street 2': '',
          'Billing City': 'Dallas',
          'Billing State': 'TX',
          'Billing Postal Code': '75001',
          'Billing Country': 'US',
          'Shipping Street 1': '123 Main St',
          'Shipping Street 2': '',
          'Shipping City': 'Dallas',
          'Shipping State': 'TX',
          'Shipping Postal Code': '75001',
          'Shipping Country': 'US',
          'Tax ID': '',
          'Credit Limit': '0',
          'Pricing Tier': 'default',
          'Default Discount %': '',
          'Default Markup %': '',
          'Default Margin %': '',
          'Product Visibility Mode': 'default',
          'Is Tax Exempt': 'false',
          'Tax Rate Override': '',
          'Tax Exempt Reason': '',
          'Tax Exempt Certificate Ref': '',
          'Is Active': 'true',
          Status: 'active',
          Notes: '',
          'External Accounting ID': '',
        },
      ];

      const csv = Papa.unparse(templateData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error generating customer CSV template:', error);
      res.status(500).json({ message: 'Failed to generate CSV template' });
    }
  });

  app.get("/api/customers/export", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const customers = await storage.getAllCustomers(organizationId, {});

      const exportData = customers.map((customer: any) => ({
        'Customer ID': customer.id,
        'Company Name': customer.companyName || '',
        'Customer Type': customer.customerType || '',
        Email: customer.email || '',
        Phone: customer.phone || '',
        Website: customer.website || '',
        'Billing Street 1': customer.billingStreet1 || '',
        'Billing Street 2': customer.billingStreet2 || '',
        'Billing City': customer.billingCity || '',
        'Billing State': customer.billingState || '',
        'Billing Postal Code': customer.billingPostalCode || '',
        'Billing Country': customer.billingCountry || '',
        'Shipping Street 1': customer.shippingStreet1 || '',
        'Shipping Street 2': customer.shippingStreet2 || '',
        'Shipping City': customer.shippingCity || '',
        'Shipping State': customer.shippingState || '',
        'Shipping Postal Code': customer.shippingPostalCode || '',
        'Shipping Country': customer.shippingCountry || '',
        'Tax ID': customer.taxId || '',
        'Credit Limit': customer.creditLimit ?? '',
        'Pricing Tier': customer.pricingTier || 'default',
        'Default Discount %': customer.defaultDiscountPercent ?? '',
        'Default Markup %': customer.defaultMarkupPercent ?? '',
        'Default Margin %': customer.defaultMarginPercent ?? '',
        'Product Visibility Mode': customer.productVisibilityMode || 'default',
        'Is Tax Exempt': customer.isTaxExempt ? 'true' : 'false',
        'Tax Rate Override': customer.taxRateOverride ?? '',
        'Tax Exempt Reason': customer.taxExemptReason || '',
        'Tax Exempt Certificate Ref': customer.taxExemptCertificateRef || '',
        'Is Active': customer.isActive === false ? 'false' : 'true',
        Status: customer.status || '',
        Notes: customer.notes || '',
        'External Accounting ID': customer.externalAccountingId || '',
      }));

      const csv = Papa.unparse(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting customers:', error);
      res.status(500).json({ message: 'Failed to export customers' });
    }
  });

  app.get("/api/customers/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const customer = await storage.getCustomerById(organizationId, req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers/import", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const { csvData, dryRun } = req.body as { csvData?: unknown; dryRun?: unknown };
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: 'CSV data is required' });
      }

      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        console.error('Customer CSV parsing errors:', parseResult.errors);
        return res.status(400).json({
          message: 'CSV parsing failed',
          errors: parseResult.errors.map((e) => e.message),
        });
      }

      const rows = parseResult.data as Record<string, string>[];
      if (rows.length === 0) {
        return res.status(400).json({ message: 'CSV must contain at least one data row' });
      }

      const parseBool = (v: unknown) => {
        if (v == null) return undefined;
        const s = String(v).trim().toLowerCase();
        if (s === '') return undefined;
        if (['true', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', '0', 'no', 'n'].includes(s)) return false;
        return undefined;
      };

      const parseNum = (v: unknown) => {
        if (v == null) return undefined;
        const s = String(v).trim();
        if (s === '') return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };

      const parseTaxRateOverride = (v: unknown) => {
        const n = parseNum(v);
        if (n == null) return undefined;
        // Allow 8.25 to mean 8.25%.
        if (n > 1) return n / 100;
        return n;
      };

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const rowErrors: Array<{ row: number; message: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const customerId = (row['Customer ID'] || row['ID'] || '').trim();
        const companyName = (row['Company Name'] || '').trim();
        if (!companyName) {
          skipped++;
          continue;
        }

        const payload: any = {
          companyName,
          customerType: (row['Customer Type'] || '').trim() || undefined,
          email: (row['Email'] || row['email'] || '').trim() || undefined,
          phone: (row['Phone'] || '').trim() || undefined,
          website: (row['Website'] || '').trim() || undefined,

          billingStreet1: (row['Billing Street 1'] || '').trim() || undefined,
          billingStreet2: (row['Billing Street 2'] || '').trim() || undefined,
          billingCity: (row['Billing City'] || '').trim() || undefined,
          billingState: (row['Billing State'] || '').trim() || undefined,
          billingPostalCode: (row['Billing Postal Code'] || '').trim() || undefined,
          billingCountry: (row['Billing Country'] || '').trim() || undefined,

          shippingStreet1: (row['Shipping Street 1'] || '').trim() || undefined,
          shippingStreet2: (row['Shipping Street 2'] || '').trim() || undefined,
          shippingCity: (row['Shipping City'] || '').trim() || undefined,
          shippingState: (row['Shipping State'] || '').trim() || undefined,
          shippingPostalCode: (row['Shipping Postal Code'] || '').trim() || undefined,
          shippingCountry: (row['Shipping Country'] || '').trim() || undefined,

          taxId: (row['Tax ID'] || '').trim() || undefined,
          creditLimit: parseNum(row['Credit Limit']),
          pricingTier: (row['Pricing Tier'] || '').trim() || undefined,
          defaultDiscountPercent: parseNum(row['Default Discount %']),
          defaultMarkupPercent: parseNum(row['Default Markup %']),
          defaultMarginPercent: parseNum(row['Default Margin %']),
          productVisibilityMode: (row['Product Visibility Mode'] || '').trim() || undefined,

          isTaxExempt: parseBool(row['Is Tax Exempt']),
          taxRateOverride: parseTaxRateOverride(row['Tax Rate Override']),
          taxExemptReason: (row['Tax Exempt Reason'] || '').trim() || undefined,
          taxExemptCertificateRef: (row['Tax Exempt Certificate Ref'] || '').trim() || undefined,

          isActive: parseBool(row['Is Active']),
          status: (row['Status'] || '').trim() || undefined,
          notes: (row['Notes'] || '').trim() || undefined,

          externalAccountingId: (row['External Accounting ID'] || '').trim() || undefined,
        };

        try {
          if (customerId) {
            // Update
            const parsedUpdate = updateCustomerSchema.parse(payload);
            if (parsedUpdate.isTaxExempt && !parsedUpdate.taxExemptReason) {
              throw new Error('Tax exempt reason is required when marking customer as tax exempt');
            }
            if (!dryRun) {
              await storage.updateCustomer(organizationId, customerId, parsedUpdate);
            }
            updated++;
          } else {
            // Create
            const parsedCreate = insertCustomerSchemaRefined.parse(payload);
            if (!dryRun) {
              await storage.createCustomerWithPrimaryContact(organizationId, {
                customer: parsedCreate,
                primaryContact: null,
              });
            }
            created++;
          }
        } catch (err: any) {
          const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Unknown error');
          rowErrors.push({ row: i + 2, message }); // +2 because header row is 1
        }
      }

      res.json({
        message: dryRun ? 'Customer import validated' : 'Customers imported successfully',
        imported: { created, updated, skipped },
        errors: rowErrors,
      });
    } catch (error) {
      console.error('Error importing customers:', error);
      res.status(500).json({ message: 'Failed to import customers' });
    }
  });

  // =============================
  // Enterprise Import Jobs (Validate → Apply)
  // =============================
  app.post('/api/import/jobs/validate', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const schema = z.object({
        resource: z.enum(['customers', 'materials', 'products']),
        csvData: z.string().min(1),
        applyMode: z.enum(['MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES']).optional(),
        sourceFilename: z.string().optional(),
      });

      const parsed = schema.parse(req.body);
      const rows = parseCsvOrThrow(parsed.csvData);
      const userId = getUserId(req.user);

      const applyMode: ImportApplyMode = parsed.applyMode ?? 'MERGE_RESPECT_OVERRIDES';
      const job = await storage.createImportJob({
        organizationId,
        resource: parsed.resource,
        applyMode,
        createdByUserId: userId ?? null,
        sourceFilename: parsed.sourceFilename ?? null,
        summaryJson: null,
      });

      let validCount = 0;
      let invalidCount = 0;
      let skippedCount = 0;

      const jobRows: Array<{ rowNumber: number; status: any; rawJson: any; normalizedJson?: any; error?: string | null }> = [];

      if (parsed.resource === 'customers') {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNumber = i + 2;

          const companyName = (row['Company Name'] || '').trim();
          if (!companyName) {
            skippedCount++;
            jobRows.push({ rowNumber, status: 'skipped', rawJson: row, error: 'Missing Company Name' });
            continue;
          }

          const normalized: any = {
            companyName,
            customerType: (row['Customer Type'] || '').trim() || undefined,
            email: (row['Email'] || row['email'] || '').trim() || undefined,
            phone: (row['Phone'] || '').trim() || undefined,
            website: (row['Website'] || '').trim() || undefined,

            billingStreet1: (row['Billing Street 1'] || '').trim() || undefined,
            billingStreet2: (row['Billing Street 2'] || '').trim() || undefined,
            billingCity: (row['Billing City'] || '').trim() || undefined,
            billingState: (row['Billing State'] || '').trim() || undefined,
            billingPostalCode: (row['Billing Postal Code'] || '').trim() || undefined,
            billingCountry: (row['Billing Country'] || '').trim() || undefined,

            shippingStreet1: (row['Shipping Street 1'] || '').trim() || undefined,
            shippingStreet2: (row['Shipping Street 2'] || '').trim() || undefined,
            shippingCity: (row['Shipping City'] || '').trim() || undefined,
            shippingState: (row['Shipping State'] || '').trim() || undefined,
            shippingPostalCode: (row['Shipping Postal Code'] || '').trim() || undefined,
            shippingCountry: (row['Shipping Country'] || '').trim() || undefined,

            taxId: (row['Tax ID'] || '').trim() || undefined,
            creditLimit: parseNum(row['Credit Limit']),
            pricingTier: (row['Pricing Tier'] || '').trim() || undefined,
            defaultDiscountPercent: parseNum(row['Default Discount %']),
            defaultMarkupPercent: parseNum(row['Default Markup %']),
            defaultMarginPercent: parseNum(row['Default Margin %']),
            productVisibilityMode: (row['Product Visibility Mode'] || '').trim() || undefined,

            isTaxExempt: parseBool(row['Is Tax Exempt']),
            taxRateOverride: parseTaxRateOverride(row['Tax Rate Override']),
            taxExemptReason: (row['Tax Exempt Reason'] || '').trim() || undefined,
            taxExemptCertificateRef: (row['Tax Exempt Certificate Ref'] || '').trim() || undefined,

            isActive: parseBool(row['Is Active']),
            status: (row['Status'] || '').trim() || undefined,
            notes: (row['Notes'] || '').trim() || undefined,

            externalAccountingId: (row['External Accounting ID'] || '').trim() || undefined,
          };

          // Identifiers used on apply
          const identifiers = {
            customerId: (row['Customer ID'] || row['ID'] || '').trim() || undefined,
          };

          try {
            // Use refined schema to validate create-like payload (strongest validation).
            insertCustomerSchemaRefined.parse(normalized);
            validCount++;
            jobRows.push({ rowNumber, status: 'valid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: null });
          } catch (err: any) {
            invalidCount++;
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Invalid row');
            jobRows.push({ rowNumber, status: 'invalid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: message });
          }
        }
      } else if (parsed.resource === 'materials') {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNumber = i + 2;
          const name = (row['Name'] || '').trim();
          const sku = (row['SKU'] || '').trim();
          const type = (row['Type'] || '').trim();
          const unitOfMeasure = (row['Unit Of Measure'] || '').trim();

          if (!name || !sku || !type || !unitOfMeasure) {
            skippedCount++;
            jobRows.push({ rowNumber, status: 'skipped', rawJson: row, error: 'Missing required fields (Name, SKU, Type, Unit Of Measure)' });
            continue;
          }

          const normalized: any = {
            name,
            sku,
            type,
            category: (row['Category'] || '').trim() || undefined,
            unitOfMeasure,
            width: parseNum(row['Width']),
            height: parseNum(row['Height']),
            thickness: parseNum(row['Thickness']),
            thicknessUnit: (row['Thickness Unit'] || '').trim() || undefined,
            color: (row['Color'] || '').trim() || undefined,
            costPerUnit: parseNum(row['Cost Per Unit']),
            wholesaleBaseRate: parseNum(row['Wholesale Base Rate']),
            wholesaleMinCharge: parseNum(row['Wholesale Min Charge']),
            retailBaseRate: parseNum(row['Retail Base Rate']),
            retailMinCharge: parseNum(row['Retail Min Charge']),
            stockQuantity: parseNum(row['Stock Quantity']),
            minStockAlert: parseNum(row['Min Stock Alert']),
            isActive: parseBool(row['Is Active']),
            preferredVendorId: (row['Preferred Vendor ID'] || '').trim() || undefined,
            vendorSku: (row['Vendor SKU'] || '').trim() || undefined,
            vendorCostPerUnit: parseNum(row['Vendor Cost Per Unit']),
            rollLengthFt: parseNum(row['Roll Length Ft']),
            costPerRoll: parseNum(row['Cost Per Roll']),
            edgeWasteInPerSide: parseNum(row['Edge Waste In Per Side']),
            leadWasteFt: parseNum(row['Lead Waste Ft']),
            tailWasteFt: parseNum(row['Tail Waste Ft']),
          };

          const identifiers = {
            materialId: (row['Material ID'] || row['ID'] || '').trim() || undefined,
          };

          try {
            insertMaterialSchema.parse(normalized);
            validCount++;
            jobRows.push({ rowNumber, status: 'valid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: null });
          } catch (err: any) {
            invalidCount++;
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Invalid row');
            jobRows.push({ rowNumber, status: 'invalid', rawJson: row, normalizedJson: { identifiers, ...normalized }, error: message });
          }
        }
      } else {
        // Products: use existing endpoints for now; create a job with a clear message.
        invalidCount = rows.length;
        for (let i = 0; i < rows.length; i++) {
          jobRows.push({ rowNumber: i + 2, status: 'invalid', rawJson: rows[i], error: 'Products import via Import Jobs not implemented yet. Use /api/products/import.' });
        }
      }

      await storage.addImportJobRows(organizationId, job.id, jobRows);

      const summary = {
        totalRows: rows.length,
        valid: validCount,
        invalid: invalidCount,
        skipped: skippedCount,
      };

      await storage.updateImportJobStatus(organizationId, job.id, {
        status: 'validated',
        applyMode,
        summaryJson: summary,
      });

      const invalidRows = jobRows.filter((r) => r.status === 'invalid').slice(0, 100);

      res.json({
        success: true,
        data: {
          job: { ...job, summaryJson: summary, applyMode },
          summary,
          invalidPreview: invalidRows.map((r) => ({ rowNumber: r.rowNumber, error: r.error })),
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      if (error?.statusCode === 400) {
        return res.status(400).json({ message: error.message, errors: (error.errors || []).map((e: any) => e.message) });
      }
      console.error('Error validating import job:', error);
      res.status(500).json({ message: 'Failed to validate import job' });
    }
  });

  app.get('/api/import/jobs/:id', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });
      const job = await storage.getImportJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ message: 'Import job not found' });
      const rows = await storage.listImportJobRows(organizationId, job.id, { limit: 200 });
      res.json({ success: true, data: { job, rows } });
    } catch (error) {
      console.error('Error fetching import job:', error);
      res.status(500).json({ message: 'Failed to fetch import job' });
    }
  });

  app.post('/api/import/jobs/:id/apply', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const bodySchema = z.object({
        applyMode: z.enum(['MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES']).optional(),
      });
      const body = bodySchema.parse(req.body ?? {});

      const job = await storage.getImportJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ message: 'Import job not found' });

      const applyMode: ImportApplyMode = (body.applyMode ?? (job.applyMode as any) ?? 'MERGE_RESPECT_OVERRIDES');
      const rows = await storage.listImportJobRows(organizationId, job.id, { limit: 5000 });

      const validRows = rows.filter((r: any) => r.status === 'valid');

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const appliedRowIds: string[] = [];
      const applyErrors: Array<{ rowNumber: number; error: string }> = [];

      if (job.resource === 'customers') {
        for (const r of validRows) {
          const normalized = (r.normalizedJson || {}) as any;
          const identifiers = normalized.identifiers || {};
          const customerId = (identifiers.customerId || '').trim();

          try {
            // Build patch from normalized data.
            const { identifiers: _ident, ...customerPatchRaw } = normalized;

            // Ensure we only send fields allowed by update schema.
            const parsedUpdate = updateCustomerSchema.parse(customerPatchRaw);

            let existing: any = null;
            if (customerId) {
              existing = await storage.getCustomerById(organizationId, customerId);
            } else if (parsedUpdate.externalAccountingId) {
              const list = await storage.getAllCustomers(organizationId, { search: undefined });
              existing = (list as any[]).find((c) => c.externalAccountingId === parsedUpdate.externalAccountingId) ?? null;
            } else if (parsedUpdate.email) {
              const list = await storage.getAllCustomers(organizationId, { search: parsedUpdate.email });
              existing = (list as any[]).find((c) => c.email === parsedUpdate.email) ?? null;
            }

            if (existing) {
              let patchToApply: any = parsedUpdate;

              if (applyMode === 'MERGE_RESPECT_OVERRIDES') {
                patchToApply = pickOverrideFiltered(existing, parsedUpdate);
              }

              if (applyMode === 'MERGE_AND_SET_OVERRIDES') {
                const nextOverrides = {
                  ...(existing.qbFieldOverrides || {}),
                  ...buildOverridePatch(parsedUpdate),
                };
                patchToApply = { ...parsedUpdate, qbFieldOverrides: nextOverrides };
              }

              await storage.updateCustomer(organizationId, existing.id, patchToApply);
              updated++;
            } else {
              const parsedCreate = insertCustomerSchemaRefined.parse(customerPatchRaw);
              const createdResult = await storage.createCustomerWithPrimaryContact(organizationId, {
                customer: parsedCreate,
                primaryContact: null,
              });
              created++;

              if (applyMode === 'MERGE_AND_SET_OVERRIDES') {
                const nextOverrides = buildOverridePatch(parsedCreate);
                await storage.updateCustomer(organizationId, (createdResult as any).customer?.id ?? (createdResult as any).id, {
                  qbFieldOverrides: nextOverrides,
                });
              }
            }

            appliedRowIds.push(r.id);
          } catch (err: any) {
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Apply failed');
            applyErrors.push({ rowNumber: r.rowNumber, error: message });
          }
        }
      } else if (job.resource === 'materials') {
        for (const r of validRows) {
          const normalized = (r.normalizedJson || {}) as any;
          const identifiers = normalized.identifiers || {};
          const materialId = (identifiers.materialId || '').trim();

          try {
            const { identifiers: _ident, ...materialPatchRaw } = normalized;

            if (materialId) {
              const parsedUpdate = updateMaterialSchema.parse(materialPatchRaw);
              await storage.updateMaterial(organizationId, materialId, parsedUpdate);
              updated++;
            } else {
              const parsedCreate = insertMaterialSchema.parse(materialPatchRaw);
              const { organizationId: _orgId, ...materialData } =
                parsedCreate as typeof parsedCreate & { organizationId?: string };
              await storage.createMaterial(organizationId, materialData);
              created++;
            }

            appliedRowIds.push(r.id);
          } catch (err: any) {
            const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Apply failed');
            applyErrors.push({ rowNumber: r.rowNumber, error: message });
          }
        }
      } else {
        skipped = validRows.length;
      }

      await storage.markImportRowsApplied(organizationId, appliedRowIds);
      await storage.updateImportJobStatus(organizationId, job.id, {
        status: applyErrors.length > 0 ? 'error' : 'applied',
        applyMode,
        summaryJson: {
          ...(job.summaryJson as any),
          applied: { created, updated, skipped, appliedRows: appliedRowIds.length, errors: applyErrors.length },
        },
      });

      res.json({
        success: true,
        data: {
          jobId: job.id,
          applyMode,
          results: { created, updated, skipped, appliedRows: appliedRowIds.length, errors: applyErrors },
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error('Error applying import job:', error);
      res.status(500).json({ message: 'Failed to apply import job' });
    }
  });

  // Customer Contacts routes
  app.get("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contacts = await storage.getCustomerContacts(req.params.customerId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching customer contacts:", error);
      res.status(500).json({ message: "Failed to fetch customer contacts" });
    }
  });

  // Global contacts list with search and pagination
  app.get("/api/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string) : 50;

      const contacts = await storage.getAllContacts(organizationId, { search, page, pageSize });
      res.json({ contacts, total: contacts.length, page, pageSize });
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Contact detail with relations
  app.get("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactWithCustomer = await storage.getContactWithRelations(req.params.id);
      if (!contactWithCustomer) {
        return res.status(404).json({ message: "Contact not found" });
      }

      const { customer, ...contact } = contactWithCustomer;

      // Fetch recent orders for this contact
      const recentOrdersQuery = await db
        .select()
        .from(orders)
        .where(eq(orders.contactId, contact.id))
        .orderBy(desc(orders.createdAt))
        .limit(10);

      // Fetch recent quotes for this contact
      const recentQuotesQuery = await db
        .select()
        .from(quotes)
        .where(eq(quotes.contactId, contact.id))
        .orderBy(desc(quotes.createdAt))
        .limit(10);

      res.json({
        contact,
        customer: customer || null,
        recentOrders: recentOrdersQuery || [],
        recentQuotes: recentQuotesQuery || [],
      });
    } catch (error) {
      console.error("Error fetching contact detail:", error);
      res.status(500).json({ message: "Failed to fetch contact detail" });
    }
  });

  app.post("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contactData = insertCustomerContactSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      const contact = await storage.createCustomerContact(contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer contact:", error);
      res.status(500).json({ message: "Failed to create customer contact" });
    }
  });

  app.patch("/api/customer-contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactData = updateCustomerContactSchema.parse(req.body);
      const contact = await storage.updateCustomerContact(req.params.id, contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer contact:", error);
      res.status(500).json({ message: "Failed to update customer contact" });
    }
  });

  app.delete("/api/customer-contacts/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const contactId = req.params.id;

      // Get contact details before deletion for audit log
      const contact = await storage.getCustomerContactById(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      // Delete the contact
      await storage.deleteCustomerContact(contactId);

      // Create audit log
      const userId = getUserId(req.user);
      const userName = req.user?.name || req.user?.email || 'Unknown';
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'delete',
        entityType: 'contact',
        entityId: contactId,
        entityName: `${contact.firstName} ${contact.lastName}`,
        description: `Deleted contact ${contact.firstName} ${contact.lastName} (${contact.email || 'no email'})`,
        oldValues: contact,
        newValues: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({ message: "Customer contact deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer contact:", error);
      res.status(500).json({ message: "Failed to delete customer contact" });
    }
  });

  // Customer Notes routes
  app.get("/api/customers/:customerId/notes", isAuthenticated, async (req, res) => {
    try {
      const filters = {
        noteType: req.query.noteType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const notes = await storage.getCustomerNotes(req.params.customerId, filters);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching customer notes:", error);
      res.status(500).json({ message: "Failed to fetch customer notes" });
    }
  });

  app.post("/api/customers/:customerId/notes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const noteData = insertCustomerNoteSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const note = await storage.createCustomerNote(noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer note:", error);
      res.status(500).json({ message: "Failed to create customer note" });
    }
  });

  app.patch("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      const noteData = updateCustomerNoteSchema.parse(req.body);
      const note = await storage.updateCustomerNote(req.params.id, noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer note:", error);
      res.status(500).json({ message: "Failed to update customer note" });
    }
  });

  app.delete("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCustomerNote(req.params.id);
      res.json({ message: "Customer note deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer note:", error);
      res.status(500).json({ message: "Failed to delete customer note" });
    }
  });

  // Customer Credit Transactions routes
  app.get("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req, res) => {
    try {
      const transactions = await storage.getCustomerCreditTransactions(req.params.customerId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching customer credit transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer credit transactions" });
    }
  });

  app.post("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const transactionData = insertCustomerCreditTransactionSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const transaction = await storage.createCustomerCreditTransaction(transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to create customer credit transaction" });
    }
  });

  app.patch("/api/customer-credit-transactions/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const transactionData = updateCustomerCreditTransactionSchema.parse(req.body);
      const transaction = await storage.updateCustomerCreditTransaction(req.params.id, transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to update customer credit transaction" });
    }
  });

  app.post("/api/customers/:customerId/apply-credit", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const { amount, type, reason } = req.body;

      if (!amount || !type || !reason) {
        return res.status(400).json({ message: "Amount, type, and reason are required" });
      }

      const customer = await storage.updateCustomerBalance(
        organizationId,
        req.params.customerId,
        parseFloat(amount),
        type,
        reason,
        userId!
      );
      res.json(customer);
    } catch (error) {
      console.error("Error applying credit to customer:", error);
      res.status(500).json({ message: "Failed to apply credit to customer" });
    }
  });


  // Audit Logs routes (owner only)
  // ---------------------------------------------------------------------------
  // Unified Timeline API (read-only)
  // ---------------------------------------------------------------------------
  app.get("/api/timeline", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const quoteId = (req.query.quoteId as string | undefined) || undefined;
      const orderId = (req.query.orderId as string | undefined) || undefined;

      if (!quoteId && !orderId) {
        return res.status(400).json({ message: "Provide quoteId and/or orderId" });
      }

      const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

      type TimelineDto = {
        id: string;
        occurredAt: string;
        actorName: string | null;
        actorUserId: string | null;
        entityType: string;
        eventType: string;
        message: string;
        metadata: any;
      };

      const toIso = (value: any): string => {
        if (!value) return new Date(0).toISOString();
        try {
          if (value instanceof Date) return value.toISOString();
          const d = new Date(String(value));
          return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
        } catch {
          return new Date(0).toISOString();
        }
      };

      const quoteIds = new Set<string>();
      const orderIds = new Set<string>();

      // Validate and expand quote/order context
      if (quoteId) {
        const q = await db
          .select()
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
          .limit(1)
          .then((rows) => rows[0]);
        if (!q) return res.status(404).json({ message: "Quote not found" });
        quoteIds.add(q.id);

        const convertedToOrderId = (q as any)?.convertedToOrderId as string | null | undefined;
        if (convertedToOrderId) {
          const o = await db
            .select({ id: orders.id })
            .from(orders)
            .where(and(eq(orders.id, convertedToOrderId), eq(orders.organizationId, organizationId)))
            .limit(1)
            .then((rows) => rows[0]);
          if (o?.id) orderIds.add(o.id);
        }

        // Fallback: some systems link order via orders.quoteId
        const linkedOrders = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.quoteId, q.id), eq(orders.organizationId, organizationId)));
        for (const o of linkedOrders) orderIds.add(o.id);
      }

      if (orderId) {
        const o = await db
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
          .limit(1)
          .then((rows) => rows[0]);
        if (!o) return res.status(404).json({ message: "Order not found" });
        orderIds.add(o.id);
        if (o.quoteId) quoteIds.add(o.quoteId);
      }

      // Helper: best-effort user name lookup (fail-soft)
      const userNameCache = new Map<string, string>();
      const getActorName = async (userId: string | null | undefined, fallback?: string | null) => {
        if (fallback && String(fallback).trim() !== "") return String(fallback);
        if (!userId) return null;
        const cached = userNameCache.get(userId);
        if (cached) return cached;
        try {
          const u = await db
            .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .then((rows) => rows[0]);
          const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || null : null;
          if (name) userNameCache.set(userId, name);
          return name;
        } catch {
          return null;
        }
      };

      const events: TimelineDto[] = [];

      // 1) Quote audit log via audit_logs
      try {
        const qIds = Array.from(quoteIds);
        const oIds = Array.from(orderIds);
        const auditEntityConds: any[] = [];
        if (qIds.length) {
          auditEntityConds.push(and(eq(auditLogs.entityType, 'quote'), inArray(auditLogs.entityId, qIds)));
        }
        if (oIds.length) {
          auditEntityConds.push(and(eq(auditLogs.entityType, 'order'), inArray(auditLogs.entityId, oIds)));
        }

        const audit: any[] = auditEntityConds.length
          ? await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.organizationId, organizationId), or(...auditEntityConds)))
            .orderBy(desc(auditLogs.createdAt))
            .limit(Math.min(limit * 3, 300))
          : [];

        for (const row of audit) {
          events.push({
            id: `audit:${row.id}`,
            occurredAt: toIso(row.createdAt),
            actorName: row.userName || null,
            actorUserId: row.userId || null,
            entityType: row.entityType,
            eventType: row.actionType,
            message: row.description,
            metadata: {
              entityId: row.entityId,
              entityName: row.entityName,
              oldValues: row.oldValues,
              newValues: row.newValues,
            },
          });
        }
      } catch (err) {
        console.warn('[Timeline] auditLogs unavailable:', err);
      }

      // 2) Order audit log table (order_audit_log)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const oAudit = await db
            .select()
            .from(orderAuditLog)
            .where(inArray(orderAuditLog.orderId, oIds))
            .orderBy(desc(orderAuditLog.createdAt))
            .limit(Math.min(limit * 3, 300));

          for (const row of oAudit) {
            // Generate human-readable message based on actionType and metadata
            let message = row.note || '';

            if (!message) {
              const meta = row.metadata as any || {};

              switch (row.actionType) {
                case 'status_change':
                case 'status_transition':
                case 'status_pill_changed':
                  if (row.fromStatus && row.toStatus) {
                    message = `Status changed: ${row.fromStatus} → ${row.toStatus}`;
                  } else if (row.toStatus) {
                    message = `Status changed to ${row.toStatus}`;
                  } else {
                    message = 'Status updated';
                  }
                  break;

                case 'priority_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Priority changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Priority set to ${meta.newValue}`;
                  } else {
                    message = 'Priority updated';
                  }
                  break;

                case 'due_date_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Due date changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Due date set to ${meta.newValue}`;
                  } else {
                    message = 'Due date updated';
                  }
                  break;

                case 'promised_date_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Promised date changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Promised date set to ${meta.newValue}`;
                  } else {
                    message = 'Promised date updated';
                  }
                  break;

                case 'label_change':
                case 'job_label_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Job label changed: "${meta.oldValue}" → "${meta.newValue}"`;
                  } else if (meta.newValue) {
                    message = `Job label set to "${meta.newValue}"`;
                  } else {
                    message = 'Job label updated';
                  }
                  break;

                case 'po_number_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `PO # changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `PO # set to ${meta.newValue}`;
                  } else {
                    message = 'PO # updated';
                  }
                  break;

                case 'line_item_status_change':
                  if (meta.lineItemId && meta.oldStatus && meta.newStatus) {
                    message = `Line item status changed: ${meta.oldStatus} → ${meta.newStatus}`;
                  } else {
                    message = 'Line item status updated';
                  }
                  break;

                case 'line_items_auto_marked_done':
                  if (meta.count) {
                    message = `Auto-marked ${meta.count} line item(s) as Done`;
                  } else {
                    message = 'Auto-marked line items as Done';
                  }
                  break;

                case 'file_uploaded':
                case 'attachment_uploaded':
                  if (meta.fileName) {
                    message = `Attachment uploaded: ${meta.fileName}`;
                  } else {
                    message = 'Attachment uploaded';
                  }
                  break;

                case 'converted_by_customer':
                  message = 'Order created from customer approval';
                  break;

                case 'note_added':
                  message = 'Note added';
                  break;

                default:
                  // Fallback: use status transition if available, else actionType
                  if (row.fromStatus || row.toStatus) {
                    message = `${row.fromStatus || ''} → ${row.toStatus || ''}`.trim();
                  } else {
                    message = row.actionType.replace(/_/g, ' ');
                  }
              }
            }

            events.push({
              id: `order_audit:${row.id}`,
              occurredAt: toIso(row.createdAt),
              actorName: row.userName || (await getActorName(row.userId ?? null, null)),
              actorUserId: row.userId || null,
              entityType: 'order',
              eventType: row.actionType,
              message,
              metadata: {
                orderId: row.orderId,
                fromStatus: row.fromStatus,
                toStatus: row.toStatus,
                metadata: row.metadata,
                structuredEvent: (row.metadata as any)?.structuredEvent ?? null,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] orderAuditLog unavailable:', err);
      }

      // 3) Quote workflow state (if present) - current state as an event (best effort)
      try {
        const qIds = Array.from(quoteIds);
        if (qIds.length) {
          const states = await db
            .select()
            .from(quoteWorkflowStates)
            .where(inArray(quoteWorkflowStates.quoteId, qIds));

          for (const row of states) {
            let actorUserId: string | null = null;
            if (row.status === 'staff_approved') actorUserId = row.approvedByStaffUserId ?? null;
            if (row.status === 'customer_approved') actorUserId = row.approvedByCustomerUserId ?? null;
            if (row.status === 'rejected') actorUserId = row.rejectedByUserId ?? null;

            events.push({
              id: `quote_workflow:${row.id}`,
              occurredAt: toIso(row.updatedAt),
              actorName: await getActorName(actorUserId, null),
              actorUserId,
              entityType: 'quote',
              eventType: 'workflow_status',
              message: `Quote workflow status: ${row.status}`,
              metadata: {
                quoteId: row.quoteId,
                status: row.status,
                staffNotes: row.staffNotes,
                customerNotes: row.customerNotes,
                rejectionReason: row.rejectionReason,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] quoteWorkflowStates unavailable:', err);
      }

      // 4) Shipments (shipped/delivered)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const rows = await db
            .select()
            .from(shipments)
            .where(inArray(shipments.orderId, oIds))
            .orderBy(desc(shipments.createdAt))
            .limit(Math.min(limit * 2, 200));

          for (const s of rows) {
            const actorName = await getActorName(s.createdByUserId, null);
            const tracking = s.trackingNumber ? ` (${s.trackingNumber})` : '';
            events.push({
              id: `shipment_shipped:${s.id}`,
              occurredAt: toIso(s.shippedAt),
              actorName,
              actorUserId: s.createdByUserId,
              entityType: 'shipment',
              eventType: 'shipped',
              message: `Shipped via ${s.carrier}${tracking}`,
              metadata: { shipmentId: s.id, orderId: s.orderId, carrier: s.carrier, trackingNumber: s.trackingNumber },
            });

            if (s.deliveredAt) {
              events.push({
                id: `shipment_delivered:${s.id}`,
                occurredAt: toIso(s.deliveredAt),
                actorName,
                actorUserId: s.createdByUserId,
                entityType: 'shipment',
                eventType: 'delivered',
                message: `Delivered via ${s.carrier}${tracking}`,
                metadata: { shipmentId: s.id, orderId: s.orderId, carrier: s.carrier, trackingNumber: s.trackingNumber },
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Timeline] shipments unavailable:', err);
      }

      // 5) Invoices + payments
      const invoiceIdToNumber = new Map<string, number>();
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const inv = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.organizationId, organizationId), inArray(invoices.orderId, oIds)))
            .orderBy(desc(invoices.createdAt))
            .limit(Math.min(limit * 2, 200));

          for (const i of inv) {
            invoiceIdToNumber.set(i.id, i.invoiceNumber);
            events.push({
              id: `invoice:${i.id}`,
              occurredAt: toIso(i.createdAt),
              actorName: await getActorName(i.createdByUserId, null),
              actorUserId: i.createdByUserId,
              entityType: 'invoice',
              eventType: 'created',
              message: `Invoice #${i.invoiceNumber} created (${i.status})`,
              metadata: { invoiceId: i.id, invoiceNumber: i.invoiceNumber, orderId: i.orderId, status: i.status, total: i.total },
            });
          }

          const invoiceIds = inv.map((x) => x.id);
          if (invoiceIds.length) {
            const pay = await db
              .select()
              .from(payments)
              .where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds)))
              .orderBy(desc(payments.appliedAt))
              .limit(Math.min(limit * 3, 300));

            for (const p of pay) {
              const invoiceNumber = invoiceIdToNumber.get(p.invoiceId);
              const invoiceLabel = invoiceNumber != null ? `Invoice #${invoiceNumber}` : `Invoice ${p.invoiceId}`;
              events.push({
                id: `payment:${p.id}`,
                occurredAt: toIso(p.appliedAt),
                actorName: await getActorName(p.createdByUserId, null),
                actorUserId: p.createdByUserId,
                entityType: 'payment',
                eventType: 'applied',
                message: `Payment $${Number(p.amount).toFixed(2)} (${p.method}) applied to ${invoiceLabel}`,
                metadata: { paymentId: p.id, invoiceId: p.invoiceId, amount: p.amount, method: p.method, notes: p.notes },
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Timeline] invoices/payments unavailable:', err);
      }

      // 6) Job status log (production)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const js = await db
            .select({
              jobId: jobs.id,
              statusKey: jobs.statusKey,
              logId: jobStatusLog.id,
              oldStatusKey: jobStatusLog.oldStatusKey,
              newStatusKey: jobStatusLog.newStatusKey,
              userId: jobStatusLog.userId,
              createdAt: jobStatusLog.createdAt,
            })
            .from(jobStatusLog)
            .innerJoin(jobs, eq(jobs.id, jobStatusLog.jobId))
            .where(inArray(jobs.orderId, oIds as any))
            .orderBy(desc(jobStatusLog.createdAt))
            .limit(Math.min(limit * 3, 300));

          const uniqueKeys = Array.from(new Set(js.map((x) => x.newStatusKey).filter(Boolean)));
          const keyToLabel = new Map<string, string>();
          try {
            if (uniqueKeys.length) {
              const labels = await db
                .select({ key: jobStatuses.key, label: jobStatuses.label })
                .from(jobStatuses)
                .where(and(eq(jobStatuses.organizationId, organizationId), inArray(jobStatuses.key, uniqueKeys)));
              for (const l of labels) keyToLabel.set(l.key, l.label);
            }
          } catch {
            // ignore label lookup failures
          }

          for (const row of js) {
            const label = keyToLabel.get(row.newStatusKey) || row.newStatusKey;
            const oldLabel = row.oldStatusKey ? (keyToLabel.get(row.oldStatusKey) || row.oldStatusKey) : null;
            const msg = oldLabel ? `Job status: ${oldLabel} → ${label}` : `Job status: ${label}`;
            events.push({
              id: `job_status:${row.logId}`,
              occurredAt: toIso(row.createdAt),
              actorName: await getActorName(row.userId ?? null, null),
              actorUserId: row.userId || null,
              entityType: 'job',
              eventType: 'status_change',
              message: msg,
              metadata: {
                jobId: row.jobId,
                oldStatusKey: row.oldStatusKey,
                newStatusKey: row.newStatusKey,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] jobStatusLog unavailable:', err);
      }

      // Sort DESC and apply limit
      events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      const sliced = events.slice(0, limit);

      return res.json({ success: true, data: sliced });
    } catch (error) {
      console.error('[Timeline] Error:', error);
      return res.status(500).json({ message: 'Failed to fetch timeline' });
    }
  });

  app.get("/api/audit-logs", isAuthenticated, isOwner, async (req, res) => {
    try {
      const filters: any = {};

      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.actionType) filters.actionType = req.query.actionType as string;
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);

      const logs = await storage.getAuditLogs(filters);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

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

  // =============================
  // Production Jobs Endpoints
  // =============================

  // ============================================================
  // JOB STATUS CONFIGURATION (Admin Only)
  // ============================================================
  app.get("/api/settings/job-statuses", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const statuses = await storage.getJobStatuses(organizationId);
      res.json({ success: true, data: statuses });
    } catch (error) {
      console.error("Error fetching job statuses:", error);
      res.status(500).json({ error: "Failed to fetch job statuses" });
    }
  });

  app.post("/api/settings/job-statuses", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const status = await storage.createJobStatus(organizationId, req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error creating job status:", error);
      res.status(500).json({ error: "Failed to create job status" });
    }
  });

  app.patch("/api/settings/job-statuses/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const status = await storage.updateJobStatus(organizationId, req.params.id, req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error updating job status:", error);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  app.delete("/api/settings/job-statuses/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      await storage.deleteJobStatus(organizationId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting job status:", error);
      res.status(500).json({ error: "Failed to delete job status" });
    }
  });

  // ============================================================
  // JOBS & PRODUCTION WORKFLOW
  // ============================================================

  // List jobs (filterable)
  app.get("/api/jobs", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const statusKey = req.query.statusKey as string | undefined;
      const assignedToUserId = req.query.assignedToUserId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const jobs = await storage.getJobs(organizationId, { statusKey, assignedToUserId, orderId });
      res.json({ success: true, data: jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get single job detail
  app.get("/api/jobs/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const job = await storage.getJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ success: true, data: job });
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  // Update job (status, assignedTo, notes, rollWidthUsedInches, materialId)
  app.patch("/api/jobs/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const updates: any = {};
      if (typeof req.body?.statusKey === 'string') updates.statusKey = req.body.statusKey;
      if (typeof req.body?.assignedTo === 'string') updates.assignedTo = req.body.assignedTo;
      if (typeof req.body?.notes === 'string') updates.notes = req.body.notes;
      // Production tracking fields - rollWidthUsedInches and materialId
      if (req.body?.rollWidthUsedInches !== undefined) {
        updates.rollWidthUsedInches = req.body.rollWidthUsedInches === null ? null : parseFloat(req.body.rollWidthUsedInches);
      }
      if (req.body?.materialId !== undefined) {
        updates.materialId = req.body.materialId === null ? null : req.body.materialId;
      }
      const userId = req.user?.claims?.sub || req.user?.id || undefined;
      const updated = await storage.updateJob(organizationId, req.params.id, updates, userId);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ error: "Failed to update job" });
    }
  });

  // Append a job note
  app.post("/api/jobs/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const noteText = (req.body?.noteText || '').toString();
      if (!noteText) return res.status(400).json({ message: "noteText required" });
      const userId = req.user?.claims?.sub || req.user?.id;
      const note = await storage.addJobNote(req.params.id, noteText, userId);
      res.json({ success: true, data: note });
    } catch (error) {
      console.error("Error adding job note:", error);
      res.status(500).json({ error: "Failed to add job note" });
    }
  });

  // ============================================================
  // INVOICES & PAYMENTS
  // ============================================================

  // Apply payment
  app.post('/api/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const userId = getUserId(req.user);
      const { invoiceId, amount, method, notes } = req.body || {};
      if (!invoiceId || !amount || !method) return res.status(400).json({ error: 'invoiceId, amount, method required' });

      // Ensure invoice belongs to org
      const rel = await getInvoiceWithRelations(invoiceId);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const payment = await applyPayment(invoiceId, userId!, { amount: Number(amount), method, notes });
      res.json({ success: true, data: payment });
    } catch (error: any) {
      console.error('Error applying payment:', error);
      res.status(500).json({ error: error.message || 'Failed to apply payment' });
    }
  });

  // Payment deletion (only if invoice not fully paid yet)
  app.delete('/api/payments/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const paymentId = req.params.id;
      const paymentRows = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
      const payment = paymentRows[0];
      if (!payment) return res.status(404).json({ error: 'Payment not found' });

      if (String((payment as any).provider || '').toLowerCase() === 'stripe') {
        return res.status(400).json({ error: 'Stripe payments cannot be deleted' });
      }

      const rel = await getInvoiceWithRelations(payment.invoiceId);
      if (!rel) return res.status(404).json({ error: 'Parent invoice not found' });
      if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: 'Parent invoice not found' });
      if (rel.invoice.status === 'paid') return res.status(400).json({ error: 'Cannot delete payment from fully paid invoice' });
      await db.delete(payments).where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
      await refreshInvoiceStatus(payment.invoiceId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting payment:', error);
      res.status(500).json({ error: 'Failed to delete payment' });
    }
  });

  // ===== SHIPMENT & FULFILLMENT ROUTES =====

  // Get all shipments for an order
  app.get('/api/orders/:id/shipments', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentList = await storage.getShipmentsByOrder(req.params.id);
      res.json({ success: true, data: shipmentList });
    } catch (error) {
      console.error('Error fetching shipments:', error);
      res.status(500).json({ error: 'Failed to fetch shipments' });
    }
  });

  // Create a new shipment (auto-updates order status to "shipped")
  app.post('/api/orders/:id/shipments', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentData = insertShipmentSchema.parse({
        ...req.body,
        orderId: req.params.id,
        createdByUserId: req.user.id,
      });

      const newShipment = await storage.createShipment(shipmentData);

      // Optionally send shipment notification email
      if (req.body.sendEmail) {
        await sendShipmentEmail(req.params.id, newShipment.id.toString(), req.body.emailSubject, req.body.emailMessage);
      }

      res.json({ success: true, data: newShipment });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid shipment data', details: error.errors });
      }
      console.error('Error creating shipment:', error);
      res.status(500).json({ error: 'Failed to create shipment' });
    }
  });

  // Update a shipment (auto-updates order status to "delivered" if deliveredAt is set)
  app.patch('/api/shipments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const shipmentId = req.params.id;
      const updates = updateShipmentSchema.parse(req.body);

      const updated = await storage.updateShipment(shipmentId, updates);
      if (!updated) return res.status(404).json({ error: 'Shipment not found' });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid shipment data', details: error.errors });
      }
      console.error('Error updating shipment:', error);
      res.status(500).json({ error: 'Failed to update shipment' });
    }
  });

  // Delete a shipment (admin/owner only)
  app.delete('/api/shipments/:id', isAuthenticated, isAdminOrOwner, async (req: any, res) => {
    try {
      const shipmentId = req.params.id;
      await storage.deleteShipment(shipmentId);

      res.json({ success: true, message: 'Shipment deleted successfully' });
    } catch (error) {
      console.error('Error deleting shipment:', error);
      res.status(500).json({ error: 'Failed to delete shipment' });
    }
  });

  // Generate packing slip HTML for an order
  app.post('/api/orders/:id/packing-slip', isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const html = await generatePackingSlipHTML(orderId);
      res.json({ success: true, data: { html } });
    } catch (error) {
      console.error('Error generating packing slip:', error);
      res.status(500).json({ error: 'Failed to generate packing slip' });
    }
  });

  // Send shipment notification email
  app.post('/api/orders/:id/send-shipping-email', isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const { shipmentId, subject, customMessage } = req.body;

      if (!shipmentId) {
        return res.status(400).json({ error: 'shipmentId is required' });
      }

      await sendShipmentEmail(orderId, shipmentId.toString(), subject, customMessage);
      res.json({ success: true, message: 'Shipment email sent successfully' });
    } catch (error) {
      console.error('Error sending shipment email:', error);
      res.status(500).json({ error: 'Failed to send shipment email' });
    }
  });

  // Manually update order fulfillment status (override auto-status - manager+ only)
  app.patch('/api/orders/:id/fulfillment-status', isAuthenticated, async (req: any, res) => {
    try {
      // Check role
      if (!['owner', 'admin', 'manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
      }

      const orderId = req.params.id;
      const { status } = req.body;

      if (!['pending', 'packed', 'shipped', 'delivered'].includes(status)) {
        return res.status(400).json({ error: 'Invalid fulfillment status' });
      }

      await updateOrderFulfillmentStatus(orderId, status);

      res.json({ success: true, message: 'Fulfillment status updated successfully' });
    } catch (error) {
      console.error('Error updating fulfillment status:', error);
      res.status(500).json({ error: 'Failed to update fulfillment status' });
    }
  });

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
      const enrichedAssets = enrichAssetsWithRoles(linkedAssets);

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

      type AttachCandidate = {
        fileKey: string;
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
        candidates.push({
          fileKey: singleKey,
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
          candidates.push({
            fileKey: k,
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
        const { loadUploadSessionMeta, saveUploadSessionMeta } = await import('./services/chunkedUploads');
        const { decideStorageTarget } = await import('./services/storageTarget');
        for (const uploadId of uploadIds) {
          const meta = await loadUploadSessionMeta(uploadId);
          if (meta.organizationId !== organizationId) continue;
          if (meta.status !== 'finalized' || !meta.relativePath) continue;

          let storageKey = meta.relativePath;

          const decidedTarget = decideStorageTarget({
            fileName: meta.originalFilename,
            fileSizeBytes: meta.sizeBytes || 0,
            requestedTarget,
            organizationId,
            context: 'POST /api/orders/:orderId/line-items/:lineItemId/files (uploadId)',
          });

          // If the file is small enough for cloud, migrate staged local file to Supabase and attach the cloud key.
          if (decidedTarget === 'supabase' && isSupabaseConfigured() && meta.relativePath) {
            try {
              const { SupabaseStorageService } = await import('./supabaseStorage');
              const { getAbsolutePath, deleteFile: deleteLocalFile } = await import('./utils/fileStorage');
              const fsPromises = await import('fs/promises');

              const abs = getAbsolutePath(meta.relativePath);
              const buffer = await fsPromises.readFile(abs);

              const supabase = new SupabaseStorageService();
              const uploaded = await supabase.uploadFile(meta.relativePath, buffer, meta.mimeType || 'application/octet-stream');
              const newKey = normalizeObjectKeyForDb(uploaded.path);

              const oldKey = meta.relativePath;
              meta.relativePath = newKey;
              await saveUploadSessionMeta(uploadId, meta).catch(() => false);
              await deleteLocalFile(oldKey).catch(() => false);
              storageKey = newKey;
            } catch {
              // fall back to attaching the staged local key
            }
          }

          // NOTE: chunked uploads currently only support quote-attachment/order-attachment.
          // We allow both here, but always attach as an order_line_item asset.
          const k = normalizeStorageKeyFromAny(storageKey);
          if (!k) continue;

          candidates.push({
            fileKey: k,
            fileName: meta.originalFilename || meta.storedFilename || undefined,
            mimeType: meta.mimeType || undefined,
            sizeBytes: meta.sizeBytes || undefined,
            role: normalizeRole(body.role),
          });
        }
      }

      // De-dupe by fileKey
      const uniqueCandidates = Array.from(
        new Map(candidates.map((c) => [c.fileKey, c])).values()
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
        const asset = await assetRepository.createAsset(organizationId, {
          fileKey: c.fileKey,
          fileName: c.fileName || guessFileNameFromKey(c.fileKey),
          mimeType: c.mimeType,
          sizeBytes: c.sizeBytes,
        } as any);

        await assetRepository.linkAsset(organizationId, asset.id, 'order_line_item', lineItemId, normalizeRole(c.role) as any);

        setImmediate(() => {
          assetPreviewGenerator.generatePreviews(asset).catch((err) => {
            console.error('[AssetPreviewGenerator] async generatePreviews failed', err);
          });
        });
        createdAssets.push({ ...enrichAssetWithUrls(asset), role: normalizeRole(c.role) });

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
                  fileKey: asset.fileKey,
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
          const keys = [
            record.relativePath,
            record.fileUrl,
            record.thumbnailRelativePath,
            record.thumbKey,
            record.previewKey,
          ].filter((k): k is string => typeof k === 'string' && k.length > 0);

          if (record.storageProvider === 'supabase') {
            const supabaseStorage = new SupabaseStorageService();
            await Promise.all(keys.map(async (k) => {
              try {
                await supabaseStorage.deleteFile(k);
              } catch {
                // ignore
              }
            }));
          } else {
            const { deleteFile: deleteLocalFile } = await import('./utils/fileStorage');
            await Promise.all(keys.map(async (k) => {
              try {
                await deleteLocalFile(k);
              } catch {
                // ignore
              }
            }));
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
                fromValue: record.fileUrl || record.relativePath || record.thumbKey || record.previewKey || null,
                toValue: null,
                actorUserId: userId ?? null,
                createdAt: new Date().toISOString(),
                metadata: {
                  orderId,
                  lineItemId,
                  attachmentId: record.id,
                  storageProvider: record.storageProvider || null,
                  fileKey:
                    record.relativePath || record.fileUrl || record.thumbnailRelativePath || record.thumbKey || record.previewKey || null,
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
      const { assetLinks, assets } = await import('@shared/schema');
      const existingLink = await db.select({ id: assetLinks.id }).from(assetLinks)
        .where(and(
          eq(assetLinks.organizationId, organizationId),
          eq(assetLinks.assetId, fileId),
          eq(assetLinks.parentType, 'order_line_item'),
          eq(assetLinks.parentId, String(lineItemId))
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
            id: assets.id,
            fileName: assets.fileName,
            fileKey: assets.fileKey,
            mimeType: assets.mimeType,
            sizeBytes: assets.sizeBytes,
          })
          .from(assets)
          .where(and(eq(assets.organizationId, organizationId), eq(assets.id, fileId)))
          .limit(1)
          .then((rows) => rows[0]);
      } catch {
        removedAsset = null;
      }

      await assetRepository.unlinkAsset(organizationId, fileId, 'order_line_item', lineItemId);

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

  // =============================
  // Vendor Routes
  // =============================
  app.get('/api/vendors', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const { search, isActive, page, pageSize } = req.query;
      const vendors = await storage.getVendors(organizationId, {
        search: typeof search === 'string' ? search : undefined,
        isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
      res.json({ success: true, data: vendors });
    } catch (error) {
      console.error('[VENDORS LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/vendors/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const vendor = await storage.getVendorById(organizationId, req.params.id);
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      res.json({ success: true, data: vendor });
    } catch (error) {
      console.error('[VENDOR GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendor' });
    }
  });

  app.post('/api/vendors', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const parsed = insertVendorSchema.parse(req.body);
      const { organizationId: _orgId, ...vendorData } =
        parsed as typeof parsed & { organizationId?: string };
      const created = await storage.createVendor(organizationId, vendorData);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'vendor',
        entityId: created.id,
        entityName: created.name,
        description: `Created vendor ${created.name}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor data', details: error.errors });
      }
      console.error('[VENDOR CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create vendor' });
    }
  });

  app.patch('/api/vendors/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const updates = updateVendorSchema.partial ? updateVendorSchema.partial().parse(req.body) : updateVendorSchema.parse(req.body);
      const existing = await storage.getVendorById(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      const updated = await storage.updateVendor(organizationId, req.params.id, updates);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'vendor',
        entityId: updated.id,
        entityName: updated.name,
        description: `Updated vendor ${updated.name}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor update data', details: error.errors });
      }
      console.error('[VENDOR UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update vendor' });
    }
  });

  app.delete('/api/vendors/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getVendorById(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      await storage.deleteVendor(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'vendor',
        entityId: existing.id,
        entityName: existing.name,
        description: `Deleted (or deactivated) vendor ${existing.name}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[VENDOR DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  });

  // =============================
  // Purchase Order Routes
  // =============================
  app.get('/api/purchase-orders', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const { vendorId, status, search, startDate, endDate } = req.query;
      const pos = await storage.getPurchaseOrders(organizationId, {
        vendorId: typeof vendorId === 'string' ? vendorId : undefined,
        status: typeof status === 'string' ? status : undefined,
        search: typeof search === 'string' ? search : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });
      res.json({ success: true, data: pos });
    } catch (error) {
      console.error('[PO LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase orders' });
    }
  });

  app.get('/api/purchase-orders/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const po = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      res.json({ success: true, data: po });
    } catch (error) {
      console.error('[PO GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase order' });
    }
  });

  app.post('/api/purchase-orders', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const parsed = insertPurchaseOrderSchema.parse(req.body);
      const { organizationId: _orgId, ...poData } =
        parsed as typeof parsed & { organizationId?: string };
      const userId = getUserId(req.user);
      const created = await storage.createPurchaseOrder(organizationId, { ...poData, createdByUserId: userId! });
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'purchase_order',
        entityId: created.id,
        entityName: created.poNumber,
        description: `Created PO ${created.poNumber}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        console.error('[PO CREATE] Zod validation error:', JSON.stringify(error.errors, null, 2));
        console.error('[PO CREATE] Request body:', JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: 'Invalid purchase order data', details: error.errors });
      }
      console.error('[PO CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create purchase order' });
    }
  });

  app.patch('/api/purchase-orders/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const updates = updatePurchaseOrderSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      const updated = await storage.updatePurchaseOrder(organizationId, req.params.id, updates as any);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Updated PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid purchase order update data', details: error.errors });
      }
      console.error('[PO UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update purchase order' });
    }
  });

  app.delete('/api/purchase-orders/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      await storage.deletePurchaseOrder(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'purchase_order',
        entityId: existing.id,
        entityName: existing.poNumber,
        description: `Deleted draft PO ${existing.poNumber}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[PO DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/send', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft POs can be sent' });
      const updated = await storage.sendPurchaseOrder(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'SEND',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Sent PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('[PO SEND] Error:', error);
      res.status(500).json({ error: 'Failed to send purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/receive', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const itemsSchema = z.object({
        items: z.array(z.object({
          lineItemId: z.string(),
          quantityToReceive: z.number().positive(),
          receivedDate: z.string().optional(),
        }))
      });
      const parsed = itemsSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'User not authenticated' });
      const receiveItems = parsed.items.map(i => ({
        lineItemId: i.lineItemId,
        quantityToReceive: i.quantityToReceive,
        receivedDate: i.receivedDate ? new Date(i.receivedDate) : undefined,
      }));
      const updated = await storage.receivePurchaseOrderLines(organizationId, req.params.id, receiveItems, userId);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'RECEIVE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Received items for PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid receive data', details: error.errors });
      }
      console.error('[PO RECEIVE] Error:', error);
      res.status(500).json({ error: 'Failed to receive purchase order items' });
    }
  });

  // ==================== QuickBooks Integration Routes ====================
  // Note: QuickBooks connection is currently per-organization (stored with organizationId).
  // These routes use tenantContext to ensure the user has access to view/manage the connection.

  /**
   * GET /api/integrations/quickbooks/status
   * Check QuickBooks connection status for current organization
   */
  app.get('/api/integrations/quickbooks/status', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const connection = await quickbooksService.getActiveConnection(organizationId);

      if (!connection) {
        return res.json({
          connected: false,
          message: 'QuickBooks not connected'
        });
      }

      // Verify connection belongs to this organization
      if (connection.organizationId !== organizationId) {
        return res.json({
          connected: false,
          message: 'QuickBooks not connected for this organization'
        });
      }

      // Check if token is still valid
      const validToken = await quickbooksService.getValidAccessTokenForOrganization(organizationId);

      res.json({
        connected: !!validToken,
        companyId: connection.companyId,
        connectedAt: connection.createdAt,
        expiresAt: connection.expiresAt,
      });
    } catch (error: any) {
      console.error('[QB Status] Error:', error);
      res.status(500).json({ error: 'Failed to check QuickBooks status' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/auth-url
   * Get OAuth authorization URL to redirect user to QuickBooks
   */
  app.get('/api/integrations/quickbooks/auth-url', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const authUrl = await quickbooksService.getAuthorizationUrlForOrganization(organizationId);
      res.json({ authUrl });
    } catch (error: any) {
      console.error('[QB Auth URL] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/callback
   * OAuth callback endpoint - QuickBooks redirects here after user authorizes
   * Note: This is an unauthenticated redirect from QuickBooks. 
   * The organizationId should be passed via the OAuth state parameter in production.
   */
  app.get('/api/integrations/quickbooks/callback', async (req: any, res) => {
    try {
      const { code, realmId, state, error: authError } = req.query;

      if (authError) {
        console.error('[QB Callback] OAuth error:', authError);
        return res.redirect('/settings?qb_error=' + encodeURIComponent(authError));
      }

      if (!code || !realmId) {
        return res.status(400).json({ error: 'Missing authorization code or realmId' });
      }

      const parsed = quickbooksService.parseOAuthState(state as any);
      if (!parsed?.organizationId) {
        return res.redirect('/settings?qb_error=' + encodeURIComponent('Invalid OAuth state'));
      }

      await quickbooksService.exchangeCodeForTokens(code as string, realmId as string, parsed.organizationId);

      // Redirect to settings page with success
      res.redirect('/settings?qb_connected=true');
    } catch (error: any) {
      console.error('[QB Callback] Error:', error);
      res.redirect('/settings?qb_error=' + encodeURIComponent(error.message));
    }
  });

  /**
   * POST /api/integrations/quickbooks/disconnect
   * Disconnect QuickBooks integration for current organization
   */
  app.post('/api/integrations/quickbooks/disconnect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      await quickbooksService.disconnectConnectionForOrganization(organizationId);
      res.json({ success: true, message: 'QuickBooks disconnected' });
    } catch (error: any) {
      console.error('[QB Disconnect] Error:', error);
      res.status(500).json({ error: 'Failed to disconnect QuickBooks' });
    }
  });

  // ==================== Stripe (Connect) Integration Routes ====================
  // Per-organization Stripe Connect accounts (no tenant secret keys).

  function getStripeModeFromEnv(): 'test' | 'live' {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    return key.startsWith('sk_live_') ? 'live' : 'test';
  }

  function getBaseOrigin(req: any): string {
    const origin = req?.headers?.origin;
    if (origin && typeof origin === 'string') return origin;
    const proto = req.protocol || 'http';
    const host = req.get('host');
    return `${proto}://${host}`;
  }

  app.get('/api/integrations/stripe/status', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);

      const stripeCfg = assertStripeServerConfig();
      if (!stripeCfg.ok) {
        return res.json({
          success: true,
          data: {
            connected: false,
            stripeAccountId: null,
            mode: 'test',
            status: 'not_configured',
            lastError: 'Stripe is not configured. Set STRIPE_SECRET_KEY (sk_...) in server env and restart the server.',
            chargesEnabled: false,
            detailsSubmitted: false,
          },
        });
      }

      const [conn] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, 'stripe')))
        .limit(1);

      const stripeAccountId = conn?.externalAccountId ? String(conn.externalAccountId) : null;
      if (!stripeAccountId) {
        return res.json({
          success: true,
          data: {
            connected: false,
            stripeAccountId: null,
            mode: conn?.mode || getStripeModeFromEnv(),
            status: conn?.status || 'disconnected',
            lastError: conn?.lastError || null,
          },
        });
      }

      const stripe = getStripeClient();
      const acct = await stripe.accounts.retrieve(stripeAccountId);

      const chargesEnabled = Boolean((acct as any).charges_enabled);
      const detailsSubmitted = Boolean((acct as any).details_submitted);

      return res.json({
        success: true,
        data: {
          connected: chargesEnabled,
          stripeAccountId,
          mode: conn?.mode || getStripeModeFromEnv(),
          status: conn?.status || 'connected',
          lastError: conn?.lastError || null,
          chargesEnabled,
          detailsSubmitted,
        },
      });
    } catch (error: any) {
      console.error('[Stripe Status] Error:', { message: String(error?.message || error) });
      res.status(500).json({ success: false, error: 'Failed to check Stripe status' });
    }
  });

  app.post('/api/integrations/stripe/connect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const userId = req.user?.claims?.sub || req.user?.id;
    const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
    const now = new Date();

    try {
      const stripeCfg = assertStripeServerConfig();
      if (!stripeCfg.ok) {
        console.error('[Stripe Connect] STRIPE_NOT_CONFIGURED', { organizationId });
        return res.status(400).json({
          success: false,
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe is not configured. Set STRIPE_SECRET_KEY (sk_...) in server env and restart the server.',
        });
      }

      const stripe = getStripeClient();

      const [existing] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, 'stripe')))
        .limit(1);

      const mode = getStripeModeFromEnv();
      let stripeAccountId = existing?.externalAccountId ? String(existing.externalAccountId) : null;

      if (!stripeAccountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            organizationId,
          },
        });

        stripeAccountId = String(account.id);

        await db
          .insert(integrationConnections)
          .values({
            organizationId,
            provider: 'stripe',
            externalAccountId: stripeAccountId,
            status: 'connected',
            mode,
            lastError: null,
            connectedAt: now,
            createdAt: now,
            updatedAt: now,
          } as any)
          .onConflictDoUpdate({
            target: [integrationConnections.organizationId, integrationConnections.provider],
            set: {
              externalAccountId: stripeAccountId,
              status: 'connected',
              mode,
              lastError: null,
              connectedAt: now,
              disconnectedAt: null,
              updatedAt: now,
            } as any,
          });
      }

      const origin = getBaseOrigin(req);
      const returnUrl = `${origin}/settings/integrations?stripe_connected=true`;
      const refreshUrl = `${origin}/settings/integrations?stripe_refresh=true`;

      const link = await stripe.accountLinks.create({
        account: stripeAccountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.connect.started',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe Connect onboarding started',
          newValues: { stripeAccountId, mode } as any,
          createdAt: now,
        } as any);
      } catch (logErr: any) {
        console.error('[Stripe Connect] audit log failed:', { organizationId, message: String(logErr?.message || logErr) });
      }

      return res.json({ success: true, data: { onboardingUrl: link.url, stripeAccountId, mode } });
    } catch (error: any) {
      const message = String(error?.message || error);
      console.error('[Stripe Connect] Error:', { organizationId, message });

      try {
        await db
          .insert(integrationConnections)
          .values({
            organizationId,
            provider: 'stripe',
            status: 'error',
            mode: getStripeModeFromEnv(),
            lastError: message.slice(0, 800),
            updatedAt: now,
            createdAt: now,
          } as any)
          .onConflictDoUpdate({
            target: [integrationConnections.organizationId, integrationConnections.provider],
            set: { status: 'error', lastError: message.slice(0, 800), updatedAt: now } as any,
          });
      } catch {}

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.connect.failed',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe Connect onboarding failed',
          newValues: { error: message.slice(0, 800) } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.status(500).json({ success: false, error: 'Failed to start Stripe Connect onboarding' });
    }
  });

  app.post('/api/integrations/stripe/disconnect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const userId = req.user?.claims?.sub || req.user?.id;
    const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
    const now = new Date();

    try {
      await db
        .insert(integrationConnections)
        .values({
          organizationId,
          provider: 'stripe',
          status: 'disconnected',
          mode: getStripeModeFromEnv(),
          lastError: null,
          disconnectedAt: now,
          updatedAt: now,
          createdAt: now,
        } as any)
        .onConflictDoUpdate({
          target: [integrationConnections.organizationId, integrationConnections.provider],
          set: {
            externalAccountId: null,
            status: 'disconnected',
            lastError: null,
            disconnectedAt: now,
            updatedAt: now,
          } as any,
        });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.disconnect',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe disconnected for organization',
          createdAt: now,
        } as any);
      } catch (logErr: any) {
        console.error('[Stripe Disconnect] audit log failed:', { organizationId, message: String(logErr?.message || logErr) });
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Stripe Disconnect] Error:', { organizationId, message: String(error?.message || error) });
      return res.status(500).json({ success: false, error: 'Failed to disconnect Stripe' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/pull
   * Queue pull sync jobs to fetch data FROM QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/pull', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { resources } = req.body;

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));

      if (invalidResources.length > 0) {
        return res.status(400).json({
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources
        });
      }

      await quickbooksService.queueSyncJobsForOrganization(organizationId, 'pull', resources);

      res.json({
        success: true,
        message: `Queued ${resources.length} pull sync job(s)`,
        resources
      });
    } catch (error: any) {
      console.error('[QB Pull Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue pull sync' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/push
   * Queue push sync jobs to send data TO QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/push', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { resources } = req.body;

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));

      if (invalidResources.length > 0) {
        return res.status(400).json({
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources
        });
      }

      await quickbooksService.queueSyncJobsForOrganization(organizationId, 'push', resources);

      res.json({
        success: true,
        message: `Queued ${resources.length} push sync job(s)`,
        resources
      });
    } catch (error: any) {
      console.error('[QB Push Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue push sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs
   * Get list of sync jobs with status for current organization
   */
  app.get('/api/integrations/quickbooks/jobs', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { status, limit = 50 } = req.query;

      // Filter jobs by organizationId
      const conditions = [eq(accountingSyncJobs.organizationId, organizationId)];
      if (status) {
        conditions.push(eq(accountingSyncJobs.status, status));
      }

      const jobs = await db
        .select()
        .from(accountingSyncJobs)
        .where(and(...conditions))
        .orderBy(desc(accountingSyncJobs.createdAt))
        .limit(parseInt(limit as string, 10));

      res.json({ jobs });
    } catch (error: any) {
      console.error('[QB Jobs] Error:', error);
      res.status(500).json({ error: 'Failed to fetch sync jobs' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs/:id
   * Get specific sync job details (verifies organization ownership)
   */
  app.get('/api/integrations/quickbooks/jobs/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const [job] = await db
        .select()
        .from(accountingSyncJobs)
        .where(and(
          eq(accountingSyncJobs.id, req.params.id),
          eq(accountingSyncJobs.organizationId, organizationId)
        ))
        .limit(1);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ job });
    } catch (error: any) {
      console.error('[QB Job Detail] Error:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/jobs/trigger
   * Manually trigger sync worker to process pending jobs
   */
  app.post('/api/integrations/quickbooks/jobs/trigger', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      // Trigger worker processing (non-blocking)
      syncWorker.triggerJobProcessing().catch((error) => {
        console.error('[QB Manual Trigger] Error:', error);
      });

      res.json({
        success: true,
        message: 'Sync job processing triggered'
      });
    } catch (error: any) {
      console.error('[QB Manual Trigger] Error:', error);
      res.status(500).json({ error: 'Failed to trigger sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/worker/status
   * Get sync worker status
   */
  app.get('/api/integrations/quickbooks/worker/status', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const status = syncWorker.getWorkerStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[QB Worker Status] Error:', error);
      res.status(500).json({ error: 'Failed to get worker status' });
    }
  });

  /**
   * GET /api/system/status
   * Get system status including feature flags
   */
  app.get('/api/system/status', isAuthenticated, async (req: any, res) => {
    try {
      const { isThumbnailGenerationEnabled } = await import('./services/thumbnailGenerator');
      res.json({
        thumbnailsEnabled: isThumbnailGenerationEnabled(),
      });
    } catch (error: any) {
      console.error('[System Status] Error:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
