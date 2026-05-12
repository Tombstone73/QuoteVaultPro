/**
 * quotes.routes.ts
 *
 * Quote domain routes extracted from server/routes.ts.
 *
 * Routes:
 *   POST   /api/quotes/calculate
 *   POST   /api/quotes
 *   GET    /api/quotes/pending-approvals
 *   GET    /api/quotes
 *   GET    /api/quotes/export.csv
 *   GET    /api/quotes/:id
 *   PATCH  /api/quotes/:id
 *   DELETE /api/quotes/:id
 *   GET    /api/quotes/:id/list-note
 *   PUT    /api/quotes/:id/list-note
 *   POST   /api/quotes/:id/transition
 *   GET    /api/quotes/:id/workflow
 *   POST   /api/quotes/:id/request-changes
 *   POST   /api/quotes/:id/approve
 *   POST   /api/quotes/:id/reject
 *   POST   /api/quotes/:id/duplicate
 *   POST   /api/quotes/:id/revise
 *   POST   /api/quotes/:id/line-items
 *   POST   /api/line-items/temp
 *   PATCH  /api/quotes/:id/line-items/:lineItemId
 *   DELETE /api/quotes/:id/line-items/:lineItemId
 *   GET    /api/admin/quotes
 *   GET    /api/admin/quotes/export
 *
 * Placement: server/routes/quotes.routes.ts
 * Registered by: server/routes.ts via registerQuoteRoutes
 */

import type { Express } from "express";
import { db } from "../db";
import {
  customers,
  quotes,
  organizations,
  customerContacts,
  quoteLineItems,
  products,
  auditLogs,
  quoteListNotes,
} from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { inboundOrdersRepository } from "../storage/inboundOrders.repo";
import { getRequestOrganizationId } from "../tenantContext";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput } from "../quoteOrderPricing";
import {
  isValidTransition,
  getTransitionBlockReason,
  workflowStateToDb,
  DB_TO_WORKFLOW,
  type QuoteStatusDB,
  transitionRequestSchema,
} from "@shared/quoteWorkflow";
import {
  getQuoteWorkflowState,
  assertQuoteEditable,
  assertValidTransition,
  getOrgPreferences,
  cloneQuoteToDraft,
} from "./helpers/quoteWorkflow.helpers";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { ensureCustomerForUser } from "../db/syncUsersToCustomers";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

async function syncInboundCompletionForQuote(args: {
  organizationId: string;
  quoteId: string;
  actorUserId?: string | null;
  quoteStatus: string;
  completionSource: "quote_status" | "quote_staff_approval";
}) {
  if (args.completionSource === "quote_status" && args.quoteStatus === "draft") return;

  await inboundOrdersRepository.markLinkedQuoteCompleted({
    organizationId: args.organizationId,
    quoteId: args.quoteId,
    actorUserId: args.actorUserId ?? null,
    quoteStatus: args.quoteStatus,
    completionSource: args.completionSource,
  });
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

export function registerQuoteRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    isAdmin: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, isAdmin, tenantContext } = middleware;

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Pricing / Calculation
  // ────────────────────────────────────────────────────────────────────────────

  app.post("/api/quotes/calculate", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Import PricingService for PBV2-only pricing
      const { priceLineItem } = await import("../services/pricing/PricingService");

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

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Core CRUD / List / Export / Admin / List Note
  // ────────────────────────────────────────────────────────────────────────────

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

      if (status !== undefined && status !== existing.status) {
        await syncInboundCompletionForQuote({
          organizationId,
          quoteId: id,
          actorUserId: userId ?? null,
          quoteStatus: updatedQuote.status,
          completionSource: "quote_status",
        });
      }

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

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Workflow / Transitions / Revisioning
  // ────────────────────────────────────────────────────────────────────────────

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
      await syncInboundCompletionForQuote({
        organizationId,
        quoteId,
        actorUserId: userId,
        quoteStatus: updatedQuote.status,
        completionSource: "quote_status",
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
      await syncInboundCompletionForQuote({
        organizationId,
        quoteId: id,
        actorUserId: getUserId(req.user) ?? null,
        quoteStatus: quote.status,
        completionSource: "quote_staff_approval",
      });
      res.json({ success: true, data: state });
    } catch (error) {
      console.error('Error approving quote:', error);
      res.status(500).json({ message: 'Failed to approve quote' });
    }
  });

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

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Line Item CRUD
  // ────────────────────────────────────────────────────────────────────────────

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
      const { priceLineItem } = await import("../services/pricing/PricingService");

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
      const { priceLineItem } = await import("../services/pricing/PricingService");

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
        const { priceLineItem } = await import("../services/pricing/PricingService");

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

  // ────────────────────────────────────────────────────────────────────────────
  // Admin Quote Routes
  // ────────────────────────────────────────────────────────────────────────────

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
}
