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
 *   GET    /api/quotes/:id/pdf
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
  customerContactLinks,
  quoteLineItems,
  products,
  pbv2TreeVersions,
  auditLogs,
  quoteListNotes,
} from "@shared/schema";
import { resolvePbv2RuntimeDimensions } from "@shared/pbv2/fixedDimensions";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import { getProductWorkflowDefaults } from "@shared/productWorkflowIntent";
import {
  buildProofApprovalManualOverrideAuditEvent,
  resolveLineItemProofApprovalRequirement,
  resolveProofApprovalLockEnabledFromOrgPreferences,
  resolveProofingPolicyFromOrgPreferences,
} from "@shared/proofApprovalLock";
import { eq, desc, and, inArray, ne, sql } from "drizzle-orm";
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
import { calculateQuoteAggregateTotals } from "./helpers/quoteTotals.helpers";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { ensureCustomerForUser } from "../db/syncUsersToCustomers";
import {
  normalizeQuoteCreateLineItem,
  QuoteCreateLineItemValidationError,
} from "../lib/quoteCreateLineItemNormalizer";
import {
  buildQuoteLineItemPriceOverridePersistencePatch,
  coerceLineItemOverrideAt,
  haveLineItemPricingDriversChanged,
  LineItemPriceOverrideValidationError,
} from "../lib/lineItemPricingPersistence";
import { generateQuotePdfBytes, QuotePdfEligibilityError } from "../lib/quotePdf";
import { skipsRequiredPrintOptionValidation } from "@shared/productPricingValidation";
import { normalizeRole } from "@shared/roleAccess";
import { parentBundlePricingUpdate } from "../services/lineItemBundles";
import { assertValidParentLink } from "../services/lineItemParentLinking";
import { canonicalQuoteOperations } from "../services/quotes/canonicalQuoteOperations";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

const TITAN_GRAPHICS_ORGANIZATION_ID = "org_titan_001";

function savedQuotesVisibleInPortalByDefault(settings: unknown, organizationId: string): boolean {
  const preferences = (settings as any)?.preferences;
  const configured = preferences?.quotes?.savedQuotesVisibleInPortalByDefault;
  if (typeof configured === "boolean") return configured;
  return organizationId === TITAN_GRAPHICS_ORGANIZATION_ID;
}

function getAuditUserName(user: any): string | null {
  return `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || user?.email || null;
}

async function createProofApprovalManualOverrideAuditLog(args: {
  organizationId: string;
  userId: string | null | undefined;
  userName: string | null | undefined;
  entityType: "quote_line_item" | "order_line_item";
  entityId: string;
  entityName?: string | null;
}) {
  const auditEvent = buildProofApprovalManualOverrideAuditEvent({
    entityType: args.entityType,
    entityId: args.entityId,
    entityName: args.entityName,
  });
  await db.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId ?? null,
    userName: args.userName ?? null,
    ...auditEvent,
  });
}

function hasExplicitPriceOverrideMetadata(value: any): boolean {
  const override = value?.priceOverride;
  const overrideRecord = override && typeof override === "object" && !Array.isArray(override) ? override : null;
  const mode = overrideRecord?.mode ?? overrideRecord?.priceOverrideMode ?? value?.priceOverrideMode;
  const hasMode = typeof mode === "string" && mode.trim().length > 0;
  const hasValue =
    overrideRecord?.valueCents !== undefined ||
    overrideRecord?.priceOverrideValueCents !== undefined ||
    overrideRecord?.value !== undefined ||
    value?.priceOverrideValueCents !== undefined ||
    value?.priceOverrideValuePercent !== undefined;

  return hasMode && hasValue;
}

function hasQuoteLineItemOverridePatch(value: any): boolean {
  return (
    value?.priceOverride !== undefined ||
    value?.priceOverrideMode !== undefined ||
    value?.priceOverrideValueCents !== undefined ||
    value?.priceOverrideValuePercent !== undefined ||
    value?.overridePriceCents !== undefined
  );
}

async function refreshQuoteAggregateTotals(organizationId: string, quoteId: string) {
  const [quoteRow] = await db
    .select({
      discountAmount: quotes.discountAmount,
      taxRate: quotes.taxRate,
      shippingCents: quotes.shippingCents,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
    .limit(1);

  if (!quoteRow) return null;

  const lineRows = await db
    .select({
      status: quoteLineItems.status,
      linePrice: quoteLineItems.linePrice,
      isTaxableSnapshot: quoteLineItems.isTaxableSnapshot,
      quantity: quoteLineItems.quantity,
      specsJson: quoteLineItems.specsJson,
      pbv2SnapshotJson: quoteLineItems.pbv2SnapshotJson,
      overridePriceCents: quoteLineItems.overridePriceCents,
      parentLineItemId: quoteLineItems.parentLineItemId,
      lineItemRole: quoteLineItems.lineItemRole,
    })
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId));

  const totals = calculateQuoteAggregateTotals({
    lineItems: lineRows,
    discountAmount: quoteRow.discountAmount,
    taxRate: quoteRow.taxRate,
    shippingCents: quoteRow.shippingCents,
  });

  const [updated] = await db
    .update(quotes)
    .set({
      subtotal: totals.subtotal.toFixed(2),
      taxableSubtotal: totals.taxableSubtotal.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      totalPrice: totals.totalPrice.toFixed(2),
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
    .returning({
      subtotal: quotes.subtotal,
      taxableSubtotal: quotes.taxableSubtotal,
      taxAmount: quotes.taxAmount,
      totalPrice: quotes.totalPrice,
    });

  return updated ?? null;
}

async function recalculateQuoteBundleParent(parentLineItemId: string) {
  const [parent] = await db.select().from(quoteLineItems).where(eq(quoteLineItems.id, parentLineItemId)).limit(1);
  if (!parent || parent.lineItemRole !== "parent") return null;
  const children = await db.select().from(quoteLineItems).where(eq(quoteLineItems.parentLineItemId, parent.id));
  const pricing = parentBundlePricingUpdate(parent as any, children as any);
  const [updated] = await db.update(quoteLineItems).set({
    childCalculatedTotalCents: pricing.childCalculatedTotalCents,
    linePrice: pricing.totalPrice.toFixed(2),
    formulaLinePrice: pricing.totalPrice.toFixed(2),
    priceBreakdown: {
      basePrice: pricing.totalPrice,
      optionsPrice: 0,
      total: pricing.totalPrice,
      formula: "bundle",
    },
  }).where(eq(quoteLineItems.id, parent.id)).returning();
  return updated ?? null;
}

async function repriceQuotePbv2LineItems(organizationId: string, quoteId: string) {
  const lineRows = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId));

  const { priceLineItem } = await import("../services/pricing/PricingService");

  for (const line of lineRows) {
    if (line.status === "canceled") continue;
    if (!line.productId) continue;
    if (!line.pbv2TreeVersionId && !(line.pbv2SnapshotJson as any)?.pricingSystem) continue;

    const product = await storage.getProductById(organizationId, line.productId);
    if (!product) throw new Error(`Cannot reprice PBV2 quote line item ${line.id}: product no longer exists`);
    const { widthIn: width, heightIn: height } = dimensionsForProductPricing(product, line.width, line.height);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Cannot reprice PBV2 quote line item ${line.id}: missing width, height, or quantity`);
    }

    const optionSelectionsJson = (line.optionSelectionsJson ?? {}) as any;
    const pricingResult = await priceLineItem({
      organizationId,
      productId: line.productId,
      quantity,
      widthIn: width,
      heightIn: height,
      pbv2ExplicitSelections: optionSelectionsJson.selected || {},
      pbv2TreeVersionIdOverride: undefined,
    });

    const baseLinePrice = pricingResult.lineTotalCents / 100;
    const basePriceBreakdown = {
      basePrice: pricingResult.breakdown.baseCents / 100,
      optionsPrice: pricingResult.breakdown.optionsCents / 100,
      total: baseLinePrice,
      formula: "",
      nestingDetails: pricingResult.breakdown.nestingDetails ?? null,
      pricingMethod: pricingResult.breakdown.pricingMethod,
    };
    const effectivePatch = buildQuoteLineItemPriceOverridePersistencePatch({
      existingLineItem: {
        ...line,
        linePrice: baseLinePrice,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        priceBreakdown: basePriceBreakdown,
      },
      incomingUpdate: {},
      baseCalculatedTotalCents: pricingResult.lineTotalCents,
    });

    await db
      .update(quoteLineItems)
      .set({
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        selectedOptions: pricingResult.pbv2SnapshotJson.selectedOptions || [],
        pricedAt: new Date(),
        specsJson: effectivePatch.specsJson,
        linePrice: effectivePatch.linePrice.toFixed(2),
        priceBreakdown: {
          ...basePriceBreakdown,
          total: effectivePatch.linePrice,
        } as any,
        formulaLinePrice: effectivePatch.formulaLinePrice?.toFixed(2) ?? null,
        priceOverride: null,
        overridePriceCents: effectivePatch.overridePriceCents,
      })
      .where(eq(quoteLineItems.id, line.id));
  }
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

class QuoteIdentityError extends Error {
  constructor(
    readonly code: "QUOTE_IDENTITY_REQUIRED" | "CUSTOMER_NOT_FOUND" | "CONTACT_NOT_FOUND" | "CONTACT_CUSTOMER_CONFLICT",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

async function validateQuoteIdentity(
  organizationId: string,
  customerId: string | null | undefined,
  contactId: string | null | undefined,
): Promise<void> {
  const normalizedCustomerId = customerId || null;
  const normalizedContactId = contactId || null;
  if (!normalizedCustomerId && !normalizedContactId) {
    throw new QuoteIdentityError("QUOTE_IDENTITY_REQUIRED", "A quote must have a customer, a contact, or both.", 400);
  }

  if (normalizedCustomerId) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, normalizedCustomerId), eq(customers.organizationId, organizationId)))
      .limit(1);
    if (!customer) {
      throw new QuoteIdentityError("CUSTOMER_NOT_FOUND", "Customer was not found for this organization.", 404);
    }
  }

  let contact: typeof customerContacts.$inferSelect | null = null;
  if (normalizedContactId) {
    const [foundContact] = await db
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.id, normalizedContactId), eq(customerContacts.organizationId, organizationId)))
      .limit(1);
    if (!foundContact) {
      throw new QuoteIdentityError("CONTACT_NOT_FOUND", "Contact was not found for this organization.", 404);
    }
    contact = foundContact;
  }

  if (!normalizedCustomerId || !contact) return;

  const linkRows = await db
    .select({ customerId: customerContactLinks.customerId })
    .from(customerContactLinks)
    .where(and(
      eq(customerContactLinks.organizationId, organizationId),
      eq(customerContactLinks.contactId, contact.id),
      ne(customerContactLinks.status, "removed"),
    ));
  const associatedCustomerIds = new Set<string>(linkRows.map((row) => row.customerId));
  if (contact.customerId) associatedCustomerIds.add(contact.customerId);
  if (associatedCustomerIds.size > 0 && !associatedCustomerIds.has(normalizedCustomerId)) {
    throw new QuoteIdentityError("CONTACT_CUSTOMER_CONFLICT", "Contact is not linked to the selected customer.", 409);
  }
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
        overridePriceCents, // Optional staff-entered effective total preview
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
          measurementMode: products.measurementMode,
          pricingProfileKey: products.pricingProfileKey,
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

      const treeVersionIdForDimensions = pbv2TreeVersionIdOverride || product.pbv2ActiveTreeVersionId;
      let runtimeWidth = dimensionsForProductPricing(product, width, height).widthIn;
      let runtimeHeight = dimensionsForProductPricing(product, width, height).heightIn;
      if (product.measurementMode !== "quantity_only" && product.pricingProfileKey !== "fee" && treeVersionIdForDimensions) {
        const [treeVersionForDimensions] = await db
          .select({ treeJson: pbv2TreeVersions.treeJson })
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.id, treeVersionIdForDimensions),
              eq(pbv2TreeVersions.organizationId, organizationId)
            )
          )
          .limit(1);
        const resolvedDimensions = resolvePbv2RuntimeDimensions({
          treeJson: treeVersionForDimensions?.treeJson,
          widthIn: width,
          heightIn: height,
        });
        runtimeWidth = resolvedDimensions.widthIn;
        runtimeHeight = resolvedDimensions.heightIn;
      }

      if (!Number.isFinite(runtimeWidth) || runtimeWidth <= 0 || !Number.isFinite(runtimeHeight) || runtimeHeight <= 0) {
        return res.status(400).json({ message: "width and height must be positive" });
      }

      // Call unified PricingService with error handling
      let pricingResult;
      try {
        pricingResult = await priceLineItem({
          organizationId,
          productId,
          quantity,
          widthIn: runtimeWidth,
          heightIn: runtimeHeight,
          pbv2ExplicitSelections,
          pbv2TreeVersionIdOverride,
          overridePriceCents: Number.isFinite(Number(overridePriceCents))
            ? Math.max(0, Math.round(Number(overridePriceCents)))
            : undefined,
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

        // Convert PBV2 missing required selections error to 422 with friendly message
        if (pricingError.code === 'PBV2_PRICING_MATRIX_ERROR') {
          return res.status(422).json({
            message: pricingError.message,
            code: 'PBV2_PRICING_MATRIX_ERROR',
            details: pricingError.details ?? [],
          });
        }

        if (pricingError.code === 'PBV2_FORMULA_ERROR') {
          return res.status(422).json({
            message: pricingError.message,
            code: 'PBV2_FORMULA_ERROR',
            details: pricingError.details ?? [],
            debug: pricingError.debug,
          });
        }

        if (pricingError.code === 'PRODUCT_PRICE_NOT_CONFIGURED') {
          return res.status(422).json({ message: pricingError.message, code: pricingError.code });
        }

        // Re-throw other pricing errors (will be caught by outer handler)
        throw pricingError;
      }

      // Format response. PBV2 pricing is authoritative.
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
        variant: null,
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
        hasCustomerId: _hasCustomerId,
        status: _statusFromClient,
        ...quotePayload
      } = req.body as any;

      const { customerId, contactId, customerName, source, lineItems } = quotePayload;
      const finalStatus: "draft" = "draft";

      if (!Array.isArray(lineItems) || lineItems.length === 0 || !hasLineItems) {
        return res.status(400).json({
          success: false,
          message: "At least one line item is required to create a quote.",
          code: "QUOTE_LINE_ITEMS_REQUIRED",
        });
      }

      if (source !== "customer_quick_quote" && !customerId && !contactId) {
        return res.status(400).json({
          success: false,
          message: "Customer or contact is required to create a quote.",
          code: "QUOTE_IDENTITY_REQUIRED",
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

      const canonicalIdentity = await canonicalQuoteOperations.normalizeOwnerIdentity({
        organizationId,
        customerId: finalCustomerId ?? null,
        contactId: contactId ?? null,
      });
      finalCustomerId = canonicalIdentity.customerId;
      const finalContactId = canonicalIdentity.contactId;
      await validateQuoteIdentity(organizationId, finalCustomerId ?? null, finalContactId);

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
      const proofApprovalLockEnabled = resolveProofApprovalLockEnabledFromOrgPreferences((org.settings as any)?.preferences);
      const proofingPolicy = resolveProofingPolicyFromOrgPreferences((org.settings as any)?.preferences);
      const requestedPortalVisibility =
        typeof quotePayload.visibleInCustomerPortal === "boolean"
          ? quotePayload.visibleInCustomerPortal
          : undefined;
      const visibleInCustomerPortal =
        requestedPortalVisibility ?? savedQuotesVisibleInPortalByDefault(org.settings, organizationId);

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

      // Validate each line item, merge tax data, and preserve PBV2 pricing snapshots.
      const quoteCreateJsonChanges: Array<{ lineItemIndex: number; changes: unknown[] }> = [];
      const proofApprovalManualOverrideIndexes: number[] = [];
      const validatedLineItems = rawLineItems.map((item: any, index: number) => {
        const taxData = totalsResult.lineItemsWithTax[index] ?? { taxAmount: 0, isTaxableSnapshot: true };
        const normalized = normalizeQuoteCreateLineItem(item, index, taxData);
        const product = productMap.get(item.productId);
        const proofApproval = resolveLineItemProofApprovalRequirement({
          productRequiresProofApproval: Boolean(product?.requiresProofApproval),
          requestedRequiresProofApproval: typeof item.requiresProofApproval === "boolean" ? item.requiresProofApproval : undefined,
          proofApprovalLockEnabled,
          proofingPolicy,
          customerRequiresProofApproval: customer?.alwaysRequireProof === true,
        });
        if (normalized.jsonChanges.length > 0) {
          quoteCreateJsonChanges.push({ lineItemIndex: index, changes: normalized.jsonChanges });
        }
        if (proofApproval.manualOverride) {
          proofApprovalManualOverrideIndexes.push(index);
        }
        return {
          ...normalized.lineItem,
          requiresProofApproval: proofApproval.requiresProofApproval,
        };
      });

      if (quoteCreateJsonChanges.length > 0) {
        console.warn("[QUOTE CREATE] sanitized JSON values before persistence", {
          organizationId,
          userId,
          changes: quoteCreateJsonChanges,
        });
      }

      // Generate customer/shipping snapshot if customerId is provided
      let snapshotData: Record<string, any> = {};
      if (finalCustomerId) {
        try {
          snapshotData = await snapshotCustomerData(
            organizationId,
            finalCustomerId,
            finalContactId,
            quotePayload.shippingMethod || null,
            quotePayload.shippingMode || null
          );
        } catch (error) {
          console.error('[QuoteCreation] Snapshot failed:', error);
          // Continue without snapshot - fields will be null
        }
      }

      const quote = await canonicalQuoteOperations.createDraft({ organizationId, actorUserId: userId, payload: {
        ...quotePayload,
        userId,
        customerId: finalCustomerId,
        contactId: finalContactId || undefined,
        customerName: customerName || undefined,
        source: source || 'internal',
        visibleInCustomerPortal,
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
      } });

      if (proofApprovalManualOverrideIndexes.length > 0 && Array.isArray((quote as any).lineItems)) {
        const userName = getAuditUserName(req.user);
        for (const index of proofApprovalManualOverrideIndexes) {
          const lineItem = (quote as any).lineItems[index];
          if (!lineItem?.id) continue;
          await createProofApprovalManualOverrideAuditLog({
            organizationId,
            userId,
            userName,
            entityType: "quote_line_item",
            entityId: String(lineItem.id),
            entityName: lineItem.productName ?? (validatedLineItems[index] as any)?.productName ?? null,
          });
        }
      }

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
      if (error instanceof QuoteCreateLineItemValidationError) {
        console.warn("[QUOTE CREATE] invalid line item payload", {
          message: error.message,
          code: error.code,
          lineItemIndex: error.lineItemIndex,
          field: error.field,
          lineItemCount: Array.isArray(req.body?.lineItems) ? req.body.lineItems.length : 0,
        });
        return res.status(error.status).json({
          message: error.message,
          code: error.code,
          lineItemIndex: error.lineItemIndex,
          field: error.field,
        });
      }
      if (error instanceof QuoteIdentityError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      const err = error as any;
      console.error("[QUOTE CREATE] failed to create quote", {
        error: {
          name: err?.name,
          message: err?.message,
          code: err?.code,
          detail: err?.detail,
          constraint: err?.constraint,
          stack: err?.stack,
        },
        body: {
          status: req.body?.status,
          hasLineItems: Array.isArray(req.body?.lineItems),
          hasCustomerId: !!req.body?.customerId,
          lineItemCount: Array.isArray(req.body?.lineItems) ? req.body.lineItems.length : 0,
          lineItems: Array.isArray(req.body?.lineItems)
            ? req.body.lineItems.map((item: any, index: number) => ({
                index,
                productId: item?.productId,
                hasProductName: !!item?.productName,
                width: item?.width,
                height: item?.height,
                quantity: item?.quantity,
                linePrice: item?.linePrice,
                hasPbv2SnapshotJson: !!item?.pbv2SnapshotJson,
                pbv2TreeVersionId: item?.pbv2TreeVersionId,
              }))
            : [],
        },
      });
      res.status(500).json({ message: "Failed to create quote" });
    }
  });

  app.get("/api/quotes/pending-approvals", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
        .leftJoin(customers, and(eq(quotes.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .leftJoin(customerContacts, and(eq(quotes.contactId, customerContacts.id), eq(customerContacts.organizationId, organizationId)))
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
      // Quote visibility is tenant-membership scoped. The global user role is not
      // authoritative when a person has different roles in different organizations.
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);

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
        portalVisibility:
          req.query.portalVisibility === "visible" || req.query.portalVisibility === "hidden"
            ? (req.query.portalVisibility as "visible" | "hidden")
            : undefined,
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
      // Keep export visibility identical to the Quotes list: use the active
      // organization membership role resolved by tenantContext.
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);

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

  app.get("/api/quotes/:id/pdf", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ["owner", "admin", "manager", "employee"].includes(String(userRole).toLowerCase());
      if (!isInternalUser) {
        return res.status(403).json({ message: "Quote PDF preview is available to staff only." });
      }

      const { id } = req.params;
      // Repair stale aggregate rows from older quote saves before rendering the
      // document. The aggregate resolver honors persisted line overrides.
      await refreshQuoteAggregateTotals(organizationId, id);
      const quote = await storage.getQuoteById(organizationId, id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const [organization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      const companySettings = await storage.getCompanySettings(organizationId);
      const pdfBytes = await generateQuotePdfBytes({ quote: quote as any, organization, companySettings: companySettings as any });
      const quoteNumber = (quote as any).displayNumber || (quote as any).quoteNumber || id;
      const safeQuoteNumber = String(quoteNumber).replace(/[^a-z0-9._-]+/gi, "-");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="quote-${safeQuoteNumber}.pdf"`);
      return res.status(200).send(Buffer.from(pdfBytes));
    } catch (error) {
      if (error instanceof QuotePdfEligibilityError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Error generating quote PDF:", error);
      return res.status(500).json({ message: "Failed to generate quote PDF" });
    }
  });

  app.get("/api/quotes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;

      // Internal users can access any quote, customers only their own
      let quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);

      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      await refreshQuoteAggregateTotals(organizationId, id);
      quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId) ?? quote;

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
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
        visibleInCustomerPortal,
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
        visibleInCustomerPortal,
        taxAmount,
      });

      // Internal users can update any quote, customers only their own
      const existing = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!existing) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const isVisibilityOnlyUpdate =
        Object.keys(req.body || {}).length === 1 &&
        visibleInCustomerPortal !== undefined;

      if (!isVisibilityOnlyUpdate && !assertQuoteEditable(res, existing)) return;

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

      const identityTouched = customerId !== undefined || contactId !== undefined;
      if (!isPartialUpdate || identityTouched) {
        await validateQuoteIdentity(
          organizationId,
          customerId !== undefined ? customerId ?? null : existing.customerId ?? null,
          contactId !== undefined ? contactId ?? null : existing.contactId ?? null,
        );
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
      if (visibleInCustomerPortal !== undefined) updateData.visibleInCustomerPortal = visibleInCustomerPortal === true;

      // Add snapshot data if customer/shipping changed
      Object.assign(updateData, snapshotData);

      if (process.env.NODE_ENV === 'development') {
        console.log(`[PATCH /api/quotes/${id}] updateData keys:`, Object.keys(updateData));
        console.log(`[PATCH /api/quotes/${id}] label value:`, updateData.label);
      }

      let updatedQuote = await canonicalQuoteOperations.updateEditableHeader({
        organizationId,
        actorUserId: userId,
        quoteId: id,
        changes: updateData,
      });

      if (
        visibleInCustomerPortal !== undefined &&
        Boolean((existing as any).visibleInCustomerPortal) !== Boolean(updatedQuote.visibleInCustomerPortal)
      ) {
        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId ?? null,
            userName: getAuditUserName(req.user),
            actionType: "UPDATE",
            entityType: "quote",
            entityId: id,
            entityName: updatedQuote.displayNumber || updatedQuote.quoteNumber?.toString() || id,
            description: updatedQuote.visibleInCustomerPortal
              ? "Quote made visible in customer portal"
              : "Quote hidden from customer portal",
            oldValues: { visibleInCustomerPortal: Boolean((existing as any).visibleInCustomerPortal) },
            newValues: { visibleInCustomerPortal: Boolean(updatedQuote.visibleInCustomerPortal) },
          });
        } catch (auditError) {
          console.error("[QuoteVisibility] Failed to audit portal visibility change:", auditError);
        }
      }

      const shouldRefreshAggregateTotals =
        subtotal !== undefined ||
        taxRate !== undefined ||
        taxAmount !== undefined ||
        totalPrice !== undefined ||
        discountAmount !== undefined ||
        shippingCents !== undefined ||
        !isPartialUpdate;

      if (shouldRefreshAggregateTotals) {
        await repriceQuotePbv2LineItems(organizationId, id);
        const refreshedTotals = await refreshQuoteAggregateTotals(organizationId, id);
        if (refreshedTotals) {
          updatedQuote = {
            ...updatedQuote,
            ...refreshedTotals,
          };
        }
      }

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
      if (error instanceof QuoteIdentityError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error("Error updating quote:", error);
      res.status(500).json({ message: "Failed to update quote" });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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

      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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

      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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

      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id } = req.params;
      const lineItem = req.body;

      // Internal users can add line items to any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, quote)) return;

      const requestedParentLineItemId = typeof lineItem.parentLineItemId === "string" && lineItem.parentLineItemId.trim()
        ? lineItem.parentLineItemId.trim()
        : null;
      if (requestedParentLineItemId) {
        const [parent] = await db.select({ id: quoteLineItems.id, lineItemRole: quoteLineItems.lineItemRole })
          .from(quoteLineItems)
          .where(and(eq(quoteLineItems.id, requestedParentLineItemId), eq(quoteLineItems.quoteId, id)))
          .limit(1);
        if (!parent || parent.lineItemRole === "child") {
          return res.status(400).json({ message: "Child items must belong to a parent line item on this quote." });
        }
      }

      // Validate required fields for pricing
      if (!lineItem.productId || lineItem.quantity == null) {
        return res.status(400).json({ message: "Missing required fields: productId, quantity" });
      }

      const productForMeasurement = await storage.getProductById(organizationId, lineItem.productId);
      if (!productForMeasurement) return res.status(404).json({ message: "Product not found" });
      const { widthIn, heightIn } = dimensionsForProductPricing(productForMeasurement, lineItem.width, lineItem.height);
      if (!Number.isFinite(widthIn) || widthIn <= 0 || !Number.isFinite(heightIn) || heightIn <= 0) {
        return res.status(400).json({ message: "width and height must be positive for this product" });
      }

      // Server-authoritative PBV2 pricing - call PricingService directly
      const { priceLineItem } = await import("../services/pricing/PricingService");

      const pricingResult = await priceLineItem({
        organizationId,
        productId: lineItem.productId,
        quantity: parseInt(lineItem.quantity),
        widthIn,
        heightIn,
        pbv2ExplicitSelections: lineItem.optionSelectionsJson?.selected || {},
        pbv2TreeVersionIdOverride: undefined, // Always use active tree for new line items
      });

      // Structured logging for PBV2 pricing persistence
      console.log(`[PBV2_PRICE_PERSIST] quoteId=${id} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

      const allowedStatus = ["draft", "active", "canceled"];
      const incomingStatus = allowedStatus.includes(lineItem.status) ? lineItem.status : "active";
      const [orgForProofPolicy] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const [productForProofPolicy] = await db
        .select({
          requiresProofApproval: products.requiresProofApproval,
          workflowIntent: products.workflowIntent,
        })
        .from(products)
        .where(eq(products.id, lineItem.productId))
        .limit(1);
      const workflowDefaults = getProductWorkflowDefaults(productForMeasurement);
      const requestedRequiresDesign = typeof lineItem.requiresDesign === "boolean" ? lineItem.requiresDesign : undefined;
      const requestedRequiresPrepress = typeof lineItem.requiresPrepress === "boolean" ? lineItem.requiresPrepress : undefined;
      const requestedRequiresProofApproval = typeof lineItem.requiresProofApproval === "boolean" ? lineItem.requiresProofApproval : undefined;
      const proofingPolicy = resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences);
      const proofApproval = resolveLineItemProofApprovalRequirement({
        productRequiresProofApproval: Boolean(productForProofPolicy?.requiresProofApproval),
        requestedRequiresProofApproval,
        proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
        proofingPolicy,
      });
      const requiresProofApproval = proofingPolicy === "automatic" && typeof workflowDefaults.requiresProofApproval === "boolean" && requestedRequiresProofApproval === undefined
        ? workflowDefaults.requiresProofApproval
        : proofApproval.requiresProofApproval;

      const validatedLineItem = {
        productId: lineItem.productId,
        productName: lineItem.productName || "New Item",
        variantId: lineItem.variantId || null,
        variantName: lineItem.variantName || null,
        productType: lineItem.productType || 'wide_roll',
        status: incomingStatus,
        // The PBV2 evaluator receives neutral 1 x 1 geometry for quantity-only
        // products; quote data does not persist that fictional finished size.
        width: productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee" ? 0 : widthIn,
        height: productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee" ? 0 : heightIn,
        quantity: parseInt(lineItem.quantity),
        specsJson: lineItem.specsJson || null,
        optionSelectionsJson: lineItem.optionSelectionsJson ?? null,
        // PBV2 snapshot fields (server-authoritative from PricingService)
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        pricedAt: new Date(),
        selectedOptions: pricingResult.pbv2SnapshotJson.selectedOptions || [],
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
        requiresDesign: requestedRequiresDesign ?? workflowDefaults.requiresDesign ?? false,
        requiresPrepress: requestedRequiresPrepress ?? workflowDefaults.requiresPrepress ?? null,
        requiresProofApproval,
        parentLineItemId: requestedParentLineItemId,
        lineItemRole: requestedParentLineItemId ? "child" as const : "standalone" as const,
      };

      const createdLineItem = await storage.addLineItem(id, validatedLineItem);
      if (requestedParentLineItemId) {
        const [parent] = await db.select().from(quoteLineItems).where(eq(quoteLineItems.id, requestedParentLineItemId)).limit(1);
        if (parent?.lineItemRole === "parent") {
          await recalculateQuoteBundleParent(requestedParentLineItemId);
        }
      }
      if (proofApproval.manualOverride) {
        await createProofApprovalManualOverrideAuditLog({
          organizationId,
          userId,
          userName: getAuditUserName(req.user),
          entityType: "quote_line_item",
          entityId: String(createdLineItem.id),
          entityName: (createdLineItem as any).productName ?? null,
        });
      }
      await refreshQuoteAggregateTotals(organizationId, id);
      res.json(createdLineItem);
    } catch (error) {
      console.error("Error adding line item:", error);
      if ((error as any)?.code === "PRODUCT_PRICE_NOT_CONFIGURED") {
        return res.status(422).json({ message: (error as any).message, code: "PRODUCT_PRICE_NOT_CONFIGURED" });
      }
      if ((error as any)?.code === "PBV2_FORMULA_ERROR") {
        return res.status(422).json({
          message: (error as any).message,
          code: "PBV2_FORMULA_ERROR",
          details: (error as any).details ?? [],
          debug: (error as any).debug,
        });
      }
      res.status(500).json({ message: "Failed to add line item", error: (error as Error).message });
    }
  });

  // One-level bundle operations. The wrapper uses the first selected product only
  // to satisfy the historical non-null product FK; it is explicitly non-production.
  app.post("/api/quotes/:id/line-item-bundles", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const quoteId = String(req.params.id);
      const payload = z.object({
        lineItemIds: z.array(z.string().min(1)).min(2),
        name: z.string().trim().min(1).max(255),
        description: z.string().trim().max(2000).optional().nullable(),
        childDisplayMode: z.enum(["hidden", "visible_summary", "visible_detail"]).default("hidden"),
      }).parse(req.body ?? {});
      if (new Set(payload.lineItemIds).size !== payload.lineItemIds.length) {
        return res.status(400).json({ message: "A bundle cannot contain the same line item twice." });
      }
      const quote = await storage.getQuoteById(organizationId, quoteId);
      if (!quote) return res.status(404).json({ message: "Quote not found" });
      if (!assertQuoteEditable(res, quote)) return;

      const result = await db.transaction(async (tx) => {
        const selected = await tx.select().from(quoteLineItems).where(and(
          eq(quoteLineItems.quoteId, quoteId),
          inArray(quoteLineItems.id, payload.lineItemIds),
        ));
        if (selected.length !== payload.lineItemIds.length) {
          throw Object.assign(new Error("Every selected line item must belong to this quote."), { statusCode: 400 });
        }
        if (selected.some((line) => line.lineItemRole !== "standalone" || line.parentLineItemId)) {
          throw Object.assign(new Error("Only standalone line items can be grouped. Remove existing bundle membership first."), { statusCode: 409 });
        }
        const source = selected[0];
        const pricing = parentBundlePricingUpdate({ parentPriceMode: "sum_children" } as any, selected as any);
        const [parent] = await tx.insert(quoteLineItems).values({
          quoteId,
          productId: source.productId,
          productName: payload.name,
          variantId: null,
          variantName: null,
          productType: source.productType,
          width: source.width,
          height: source.height,
          quantity: 1,
          specsJson: payload.description ? { bundleDescription: payload.description } : null,
          pbv2TreeVersionId: source.pbv2TreeVersionId,
          pbv2SnapshotJson: source.pbv2SnapshotJson,
          pricedAt: new Date(),
          selectedOptions: [],
          linePrice: pricing.totalPrice.toFixed(2),
          formulaLinePrice: pricing.totalPrice.toFixed(2),
          priceOverride: null,
          priceBreakdown: { basePrice: pricing.totalPrice, optionsPrice: 0, total: pricing.totalPrice, formula: "bundle" },
          materialUsages: [],
          taxAmount: "0",
          isTaxableSnapshot: selected.some((line) => line.isTaxableSnapshot !== false),
          displayOrder: Math.min(...selected.map((line) => line.displayOrder)),
          isTemporary: false,
          description: payload.description ?? null,
          requiresDesign: false,
          requiresDesignSnapshot: false,
          requiresPrepress: false,
          requiresProofApproval: false,
          lineItemRole: "parent",
          childDisplayMode: payload.childDisplayMode,
          parentPriceMode: "sum_children",
          childCalculatedTotalCents: pricing.childCalculatedTotalCents,
        } as any).returning();
        await tx.update(quoteLineItems).set({
          parentLineItemId: parent.id,
          lineItemRole: "child",
        }).where(inArray(quoteLineItems.id, payload.lineItemIds));
        return parent;
      });
      await refreshQuoteAggregateTotals(organizationId, quoteId);
      await db.insert(auditLogs).values({
        organizationId,
        userId: getUserId(req.user) ?? null,
        userName: getAuditUserName(req.user),
        actionType: "CREATE",
        entityType: "quote_line_item_bundle",
        entityId: result.id,
        entityName: result.productName,
        description: `Grouped ${payload.lineItemIds.length} quote line items`,
        newValues: { childCount: payload.lineItemIds.length, childDisplayMode: payload.childDisplayMode },
      } as any);
      return res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
      return res.status(error?.statusCode ?? 500).json({ message: error?.message ?? "Failed to create line item bundle" });
    }
  });

  app.patch("/api/quotes/:id/line-item-bundles/:parentId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const payload = z.object({
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        childDisplayMode: z.enum(["hidden", "visible_summary", "visible_detail"]).optional(),
        parentPriceMode: z.enum(["sum_children", "manual_override"]).optional(),
        manualPriceCents: z.number().int().min(0).optional(),
      }).parse(req.body ?? {});
      if (payload.parentPriceMode === "manual_override" && payload.manualPriceCents === undefined) {
        return res.status(400).json({ message: "manualPriceCents is required for a manual bundle price." });
      }
      const quote = await storage.getQuoteById(organizationId, String(req.params.id));
      if (!quote) return res.status(404).json({ message: "Quote not found" });
      if (!assertQuoteEditable(res, quote)) return;
      const [parent] = await db.select().from(quoteLineItems).where(and(
        eq(quoteLineItems.id, String(req.params.parentId)), eq(quoteLineItems.quoteId, String(req.params.id)),
      )).limit(1);
      if (!parent || parent.lineItemRole !== "parent") return res.status(404).json({ message: "Bundle parent not found" });
      const update: any = {};
      if (payload.name !== undefined) update.productName = payload.name;
      if (payload.description !== undefined) { update.description = payload.description; update.specsJson = { ...((parent as any).specsJson ?? {}), bundleDescription: payload.description }; }
      if (payload.childDisplayMode !== undefined) update.childDisplayMode = payload.childDisplayMode;
      if (payload.parentPriceMode !== undefined) update.parentPriceMode = payload.parentPriceMode;
      if (payload.parentPriceMode === "manual_override") {
        update.linePrice = (payload.manualPriceCents! / 100).toFixed(2);
        update.formulaLinePrice = update.linePrice;
        update.overridePriceCents = payload.manualPriceCents;
      }
      const [updated] = await db.update(quoteLineItems).set(update).where(eq(quoteLineItems.id, parent.id)).returning();
      if (updated?.parentPriceMode === "sum_children") await recalculateQuoteBundleParent(updated.id);
      await refreshQuoteAggregateTotals(organizationId, String(req.params.id));
      return res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
      return res.status(500).json({ message: error?.message ?? "Failed to update bundle" });
    }
  });

  app.delete("/api/quotes/:id/line-item-bundles/:parentId/children/:childId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const quoteId = String(req.params.id);
      const parentId = String(req.params.parentId);
      const childId = String(req.params.childId);
      const quote = await storage.getQuoteById(organizationId, quoteId);
      if (!quote) return res.status(404).json({ message: "Quote not found" });
      if (!assertQuoteEditable(res, quote)) return;
      const [child] = await db.select({ id: quoteLineItems.id }).from(quoteLineItems).where(and(
        eq(quoteLineItems.id, childId), eq(quoteLineItems.quoteId, quoteId), eq(quoteLineItems.parentLineItemId, parentId),
      )).limit(1);
      if (!child) return res.status(404).json({ message: "Bundle child not found" });
      await db.update(quoteLineItems).set({ parentLineItemId: null, lineItemRole: "standalone" }).where(eq(quoteLineItems.id, childId));
      const remaining = await db.select({ id: quoteLineItems.id }).from(quoteLineItems).where(eq(quoteLineItems.parentLineItemId, parentId));
      if (remaining.length === 0) await db.delete(quoteLineItems).where(eq(quoteLineItems.id, parentId));
      else await recalculateQuoteBundleParent(parentId);
      await refreshQuoteAggregateTotals(organizationId, quoteId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: error?.message ?? "Failed to remove bundle child" });
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
        displayOrder,
      } = req.body;

      if (!productId || typeof productId !== "string") {
        return res.status(400).json({ message: "productId is required for temporary line items" });
      }

      const productForMeasurement = await storage.getProductById(organizationId, productId);
      if (!productForMeasurement) return res.status(404).json({ message: "Product not found" });
      const { widthIn: widthNum, heightIn: heightNum } = dimensionsForProductPricing(productForMeasurement, width, height);
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
        width: productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee" ? 0 : widthNum,
        height: productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee" ? 0 : heightNum,
        quantity: quantityNum,
        specsJson: specsJson || null,
        optionSelectionsJson: optionSelectionsJson ?? null,
        // PBV2 snapshot fields (server-authoritative from PricingService)
        pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
        pbv2SnapshotJson: pricingResult.pbv2SnapshotJson,
        pricedAt: new Date(),
        selectedOptions: pricingResult.pbv2SnapshotJson.selectedOptions || [],
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
      if ((error as any)?.code === "PRODUCT_PRICE_NOT_CONFIGURED") {
        return res.status(422).json({ message: (error as any).message, code: "PRODUCT_PRICE_NOT_CONFIGURED" });
      }
      if ((error as any)?.code === "PBV2_FORMULA_ERROR") {
        return res.status(422).json({
          message: (error as any).message,
          code: "PBV2_FORMULA_ERROR",
          details: (error as any).details ?? [],
          debug: (error as any).debug,
        });
      }
      res.status(500).json({ message: "Failed to create temporary line item", error: (error as Error).message });
    }
  });

  app.patch("/api/quotes/:id/line-items/:lineItemId/parent", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { parentLineItemId } = z.object({ parentLineItemId: z.string().min(1).nullable() }).parse(req.body ?? {});
      const quoteId = String(req.params.id);
      const childId = String(req.params.lineItemId);
      const quote = await storage.getQuoteById(organizationId, quoteId);
      if (!quote) return res.status(404).json({ message: "Quote not found" });
      if (!assertQuoteEditable(res, quote)) return;
      const lines = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
      assertValidParentLink(lines as any, childId, parentLineItemId);
      const child = lines.find((line) => line.id === childId)!;
      const priorParentId = child.parentLineItemId ? String(child.parentLineItemId) : null;
      if (priorParentId === parentLineItemId) return res.json({ success: true, data: child });
      const [updated] = await db.update(quoteLineItems).set({
        parentLineItemId,
        lineItemRole: parentLineItemId ? "child" : "standalone",
      }).where(eq(quoteLineItems.id, childId)).returning();
      for (const parentId of Array.from(new Set([priorParentId, parentLineItemId].filter(Boolean) as string[]))) {
        await recalculateQuoteBundleParent(parentId);
      }
      await refreshQuoteAggregateTotals(organizationId, quoteId);
      await db.insert(auditLogs).values({
        organizationId, userId: getUserId(req.user) ?? null, userName: getAuditUserName(req.user),
        actionType: parentLineItemId ? "QUOTE_LINE_ITEM_PARENT_LINKED" : "QUOTE_LINE_ITEM_PARENT_UNLINKED",
        entityType: "quote_line_item", entityId: childId, entityName: child.productName,
        description: parentLineItemId ? "Quote line item linked to a parent line item." : "Quote line item unlinked from its parent.",
        newValues: { parentLineItemId }, oldValues: { parentLineItemId: priorParentId },
      } as any);
      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(error?.statusCode ?? 400).json({ success: false, message: error?.message ?? "Failed to update line item parent" });
    }
  });

  app.patch("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, tenantContext, async (req: any, res) => {
    const patchDiagnostics: Record<string, unknown> = {
      quoteId: req.params?.id,
      lineItemId: req.params?.lineItemId,
      hasPriceOverride: hasQuoteLineItemOverridePatch(req.body),
      priceOverrideMode: req.body?.priceOverrideMode ?? req.body?.priceOverride?.mode ?? null,
      priceOverrideValueCents: req.body?.priceOverrideValueCents ?? req.body?.priceOverride?.valueCents ?? null,
      overridePriceCents: req.body?.overridePriceCents ?? null,
      pricingDriversChanged: null,
    };
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      patchDiagnostics.organizationId = organizationId;
      const userId = getUserId(req.user);
      patchDiagnostics.userId = userId ?? null;
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
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

      const currentLineItem = quote.lineItems?.find((li: any) => li.id === lineItemId);
      if (!currentLineItem) {
        return res.status(404).json({ message: "Line item not found" });
      }

      // Check if pricing-relevant fields actually changed (require repricing).
      // Editor hydration/save payloads include pricing fields even when unchanged;
      // presence alone must not force a reprice with incomplete option state.
      const pricingFieldPresent =
        lineItem.productId !== undefined ||
        lineItem.width !== undefined ||
        lineItem.height !== undefined ||
        lineItem.quantity !== undefined ||
        lineItem.optionSelectionsJson !== undefined;
      const pricingFieldsChanged = pricingFieldPresent
        ? haveLineItemPricingDriversChanged({
            existingLineItem: currentLineItem,
            incomingUpdate: lineItem,
            pbv2ExplicitSelections: lineItem.optionSelectionsJson?.selected,
          })
        : false;
      patchDiagnostics.pricingDriversChanged = pricingFieldsChanged;
      patchDiagnostics.pricingFieldPresent = pricingFieldPresent;

      let repricedBaseTotalCents: number | null = null;
      let pricingProduct: Awaited<ReturnType<typeof storage.getProductById>> | null = null;
      if (pricingFieldsChanged) {
        // Server-authoritative repricing when pricing inputs change
        const { priceLineItem } = await import("../services/pricing/PricingService");
        const pricingProductId = lineItem.productId ?? currentLineItem.productId;
        pricingProduct = pricingProductId ? await storage.getProductById(organizationId, pricingProductId) : null;
        if (!pricingProduct) return res.status(404).json({ message: "Product not found" });
        const pricingDimensions = dimensionsForProductPricing(
          pricingProduct,
          lineItem.width !== undefined ? lineItem.width : currentLineItem.width,
          lineItem.height !== undefined ? lineItem.height : currentLineItem.height,
        );
        if (!Number.isFinite(pricingDimensions.widthIn) || pricingDimensions.widthIn <= 0 || !Number.isFinite(pricingDimensions.heightIn) || pricingDimensions.heightIn <= 0) {
          return res.status(400).json({ message: "width and height must be positive for this product" });
        }

        const pricingResult = await priceLineItem({
          organizationId,
          productId: pricingProductId,
          quantity: lineItem.quantity !== undefined ? parseInt(lineItem.quantity) : currentLineItem.quantity,
          widthIn: pricingDimensions.widthIn,
          heightIn: pricingDimensions.heightIn,
          pbv2ExplicitSelections: lineItem.optionSelectionsJson?.selected || currentLineItem.optionSelectionsJson?.selected || {},
          pbv2TreeVersionIdOverride: undefined, // Always reprice with active tree
          ...(skipsRequiredPrintOptionValidation(pricingProduct) &&
          hasExplicitPriceOverrideMetadata(lineItem) &&
          Number.isFinite(Number(lineItem.overridePriceCents))
            ? { overridePriceCents: Math.max(0, Math.round(Number(lineItem.overridePriceCents))) }
            : {}),
        });

        // Structured logging for PBV2 pricing persistence
        console.log(`[PBV2_PRICE_PERSIST] quoteId=${id} lineItemId=${lineItemId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

        // Set server-authoritative PBV2 fields
        updateData.pbv2TreeVersionId = pricingResult.pbv2TreeVersionId;
        updateData.pbv2SnapshotJson = pricingResult.pbv2SnapshotJson;
        updateData.selectedOptions = pricingResult.pbv2SnapshotJson.selectedOptions || [];
        updateData.pricedAt = new Date();
        updateData.linePrice = pricingResult.lineTotalCents / 100;
        repricedBaseTotalCents = pricingResult.pricingOverrideApplied
          ? pricingResult.breakdown.baseCents
          : pricingResult.lineTotalCents;
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
        updateData.overridePriceCents = null;
        updateData.overrideAt = null;
        updateData.overrideByUserId = null;
        if (pricingProduct.measurementMode === "quantity_only" || pricingProduct.pricingProfileKey === "fee") {
          updateData.width = 0;
          updateData.height = 0;
        }
      }

      // Apply other field updates
      if (lineItem.productId !== undefined) updateData.productId = lineItem.productId;
      if (lineItem.productName) updateData.productName = lineItem.productName;
      if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
      if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
      if (lineItem.productType !== undefined) updateData.productType = lineItem.productType;
      if (lineItem.status !== undefined && allowedStatus.includes(lineItem.status)) updateData.status = lineItem.status;
      if (lineItem.width !== undefined && pricingProduct?.measurementMode !== "quantity_only" && pricingProduct?.pricingProfileKey !== "fee") updateData.width = parseFloat(lineItem.width);
      if (lineItem.height !== undefined && pricingProduct?.measurementMode !== "quantity_only" && pricingProduct?.pricingProfileKey !== "fee") updateData.height = parseFloat(lineItem.height);
      if (lineItem.quantity !== undefined) updateData.quantity = parseInt(lineItem.quantity);
      if (lineItem.optionSelectionsJson !== undefined) updateData.optionSelectionsJson = lineItem.optionSelectionsJson;
      if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;
      if (lineItem.isTemporary !== undefined) updateData.isTemporary = lineItem.isTemporary;
      if (lineItem.quoteId !== undefined) updateData.quoteId = lineItem.quoteId;
      if (lineItem.isTemporary !== undefined) updateData.isTemporary = lineItem.isTemporary;
      if (lineItem.quoteId !== undefined) updateData.quoteId = lineItem.quoteId;
      // Line item enhancements (migrations 0039, 0040)
      if (lineItem.description !== undefined) updateData.description = lineItem.description;
      if (lineItem.productionNotes !== undefined) updateData.productionNotes = lineItem.productionNotes;
      const clearsPriceOverride =
        (lineItem as any).priceOverride === null ||
        (lineItem as any).priceOverrideMode === null ||
        (lineItem as any).overridePriceCents === null;
      const hasExplicitPriceOverride = hasExplicitPriceOverrideMetadata(lineItem);
      const hasMalformedPriceOverride =
        hasQuoteLineItemOverridePatch(lineItem) &&
        !clearsPriceOverride &&
        !hasExplicitPriceOverride &&
        ((lineItem as any).priceOverride !== undefined ||
          (lineItem as any).priceOverrideMode !== undefined ||
          (lineItem as any).priceOverrideValueCents !== undefined ||
          (lineItem as any).priceOverrideValuePercent !== undefined);

      if (hasMalformedPriceOverride) {
        return res.status(422).json({
          message: "Invalid price override payload",
          code: "INVALID_PRICE_OVERRIDE",
        });
      }

      if (clearsPriceOverride) {
        const overridePatch = buildQuoteLineItemPriceOverridePersistencePatch({
          existingLineItem: {
            ...currentLineItem,
            ...(pricingFieldsChanged
              ? {
                  linePrice: repricedBaseTotalCents !== null ? repricedBaseTotalCents / 100 : currentLineItem.linePrice,
                  priceBreakdown: updateData.priceBreakdown ?? currentLineItem.priceBreakdown,
                  pbv2SnapshotJson: updateData.pbv2SnapshotJson ?? currentLineItem.pbv2SnapshotJson,
                }
              : {}),
          },
          incomingUpdate: lineItem,
          baseCalculatedTotalCents: repricedBaseTotalCents,
        });
        updateData.specsJson = overridePatch.specsJson;
        updateData.linePrice = overridePatch.linePrice;
        updateData.formulaLinePrice = overridePatch.formulaLinePrice;
        updateData.priceBreakdown = {
          ...(updateData.priceBreakdown ?? overridePatch.priceBreakdown),
          total: overridePatch.linePrice,
        };
        updateData.overridePriceCents = null;
        updateData.overrideAt = null;
        updateData.overrideByUserId = null;
      } else if (hasExplicitPriceOverride) {
        delete updateData.priceOverride;
        const overridePatch = buildQuoteLineItemPriceOverridePersistencePatch({
          existingLineItem: {
            ...currentLineItem,
            ...(pricingFieldsChanged
              ? {
                  linePrice: repricedBaseTotalCents !== null ? repricedBaseTotalCents / 100 : currentLineItem.linePrice,
                  priceBreakdown: updateData.priceBreakdown ?? currentLineItem.priceBreakdown,
                  pbv2SnapshotJson: updateData.pbv2SnapshotJson ?? currentLineItem.pbv2SnapshotJson,
                }
              : {}),
          },
          incomingUpdate: lineItem,
          baseCalculatedTotalCents: repricedBaseTotalCents,
        });
        updateData.specsJson = overridePatch.specsJson;
        updateData.linePrice = overridePatch.linePrice;
        updateData.formulaLinePrice = overridePatch.formulaLinePrice;
        updateData.priceBreakdown = {
          ...(updateData.priceBreakdown ?? overridePatch.priceBreakdown),
          total: overridePatch.linePrice,
        };
        updateData.overridePriceCents = overridePatch.overridePriceCents;
        const incomingOverrideAt = coerceLineItemOverrideAt((lineItem as any).overrideAt);
        updateData.overrideAt = incomingOverrideAt === undefined ? new Date() : incomingOverrideAt;
        updateData.overrideByUserId = (lineItem as any).overrideByUserId !== undefined ? (lineItem as any).overrideByUserId : userId ?? null;
      }
      if ((lineItem as any).overrideReason !== undefined) updateData.overrideReason = (lineItem as any).overrideReason;
      if ((lineItem as any).overrideAt !== undefined && !clearsPriceOverride && !hasExplicitPriceOverride) {
        updateData.overrideAt = coerceLineItemOverrideAt((lineItem as any).overrideAt);
      }
      if ((lineItem as any).overrideByUserId !== undefined) updateData.overrideByUserId = (lineItem as any).overrideByUserId;
      // Canonical routing intent (migration 0015)
      if (lineItem.requiresDesign !== undefined) updateData.requiresDesign = lineItem.requiresDesign === true;
      if (lineItem.requiresPrepress !== undefined) updateData.requiresPrepress = typeof lineItem.requiresPrepress === 'boolean' ? lineItem.requiresPrepress : null;
      let proofApprovalManualOverride = false;
      if (lineItem.requiresProofApproval !== undefined || lineItem.productId !== undefined) {
        const [orgForProofPolicy] = await db
          .select({ settings: organizations.settings })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        const [productForProofPolicy] = await db
          .select({ requiresProofApproval: products.requiresProofApproval })
          .from(products)
          .where(eq(products.id, lineItem.productId ?? currentLineItem.productId))
          .limit(1);
        const proofApproval = resolveLineItemProofApprovalRequirement({
          productRequiresProofApproval: Boolean(productForProofPolicy?.requiresProofApproval),
          requestedRequiresProofApproval: typeof lineItem.requiresProofApproval === "boolean" ? lineItem.requiresProofApproval : undefined,
          proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
          proofingPolicy: resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
        });
        updateData.requiresProofApproval = proofApproval.requiresProofApproval;
        proofApprovalManualOverride =
          proofApproval.manualOverride &&
          (Boolean((currentLineItem as any).requiresProofApproval) || lineItem.productId !== undefined);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No supported line item fields to update" });
      }

      const updatedLineItem = await storage.updateLineItem(lineItemId, updateData);
      if ((updatedLineItem as any).parentLineItemId) {
        await recalculateQuoteBundleParent(String((updatedLineItem as any).parentLineItemId));
      }
      if (proofApprovalManualOverride) {
        await createProofApprovalManualOverrideAuditLog({
          organizationId,
          userId,
          userName: getAuditUserName(req.user),
          entityType: "quote_line_item",
          entityId: String(updatedLineItem.id),
          entityName: (updatedLineItem as any).productName ?? null,
        });
      }
      await refreshQuoteAggregateTotals(organizationId, id);
      res.json(updatedLineItem);
    } catch (error) {
      console.error("[QUOTE_LINE_ITEM_PATCH_ERROR]", {
        ...patchDiagnostics,
        errorName: (error as any)?.name,
        errorCode: (error as any)?.code,
        errorMessage: (error as Error)?.message,
        errorStack: (error as Error)?.stack,
      });
      if ((error as any)?.code === "PBV2_FORMULA_ERROR") {
        return res.status(422).json({
          message: (error as any).message,
          code: "PBV2_FORMULA_ERROR",
          details: (error as any).details ?? [],
          debug: (error as any).debug,
        });
      }
      if ((error as any)?.code === "PRODUCT_PRICE_NOT_CONFIGURED") {
        return res.status(422).json({ message: (error as any).message, code: "PRODUCT_PRICE_NOT_CONFIGURED" });
      }
      if (error instanceof LineItemPriceOverrideValidationError) {
        return res.status(error.statusCode).json({
          message: error.message,
          code: "INVALID_PRICE_OVERRIDE",
        });
      }
      res.status(500).json({ message: "Failed to update line item" });
    }
  });

  app.delete("/api/quotes/:id/line-items/:lineItemId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const { id, lineItemId } = req.params;

      // Internal users can delete line items from any quote, customers only their own
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      if (!assertQuoteEditable(res, quote)) return;

      const existingLineItem = quote.lineItems?.find((line: any) => line.id === lineItemId);
      await storage.deleteLineItem(lineItemId);
      if ((existingLineItem as any)?.parentLineItemId) {
        const parentId = String((existingLineItem as any).parentLineItemId);
        const remaining = await db.select({ id: quoteLineItems.id }).from(quoteLineItems).where(eq(quoteLineItems.parentLineItemId, parentId));
        if (remaining.length === 0) await db.delete(quoteLineItems).where(eq(quoteLineItems.id, parentId));
        else await recalculateQuoteBundleParent(parentId);
      }
      await refreshQuoteAggregateTotals(organizationId, id);
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
