import type { Express } from "express";
import { db } from "../db";
import {
    orders,
    orderAttachments,
    orderAuditLog,
    orderLineItems,
    assetLinks,
    assets,
    assetVariants,
    quoteAttachments,
    organizations,
    customers,
    products,
    pbv2TreeVersions,
    orderLineItemComponents,
    customerContacts,
    jobs,
    orderStatusPills,
    orderListNotes,
    users,
    auditLogs,
    customerVisibleProducts,
    materials,
    inventoryAdjustments,
    orderMaterialUsage,
    inventoryReservations,
    productionJobs,
    productionEvents,
    insertOrderSchema,
    updateOrderSchema,
    insertOrderLineItemSchema,
    updateOrderLineItemSchema,
    insertMaterialSchema,
    updateMaterialSchema,
    insertInventoryAdjustmentSchema,
    type InsertOrder
} from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, inArray, or, sql } from "drizzle-orm";
import { storage } from "../storage";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import Papa from "papaparse";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput } from "../quoteOrderPricing";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { ensureCustomerForUser } from "../db/syncUsersToCustomers";
import { updateOrderFulfillmentStatus } from "../fulfillmentService";
import { portalContext, tenantContext, getPortalCustomer } from "../tenantContext";
import { recomputeOrderBillingStatus } from "../services/orderBillingService";
import { pbv2ToChildItemProposals, pbv2ToMaterialEffects, pbv2ToPricingAddons } from "@shared/pbv2/pricingAdapter";
import { computePbv2InputSignature } from "@shared/pbv2/pbv2InputSignature";
import { pickPbv2EnvExtras } from "@shared/pbv2/pbv2InputSignature";
import { selectPbv2TreeVersionIdForEvaluation } from "../lib/pbv2OverrideConfig";
import { assignEffectIndexFallback, buildOrderLineItemComponentUpsertValues } from "../lib/pbv2ComponentUpsert";
import { assertPbv2TreeVersionNotDraft } from "../lib/pbv2TreeVersionGuards";
import { normalizePbv2DiffComponent, pbv2DiffComponents } from "@shared/pbv2/pbv2ComponentDiff";
import { buildOrderPbv2Rollup } from "@shared/pbv2/pbv2OrderRollup";
import { buildPbv2OrderRollupResponse } from "../lib/pbv2OrderRollupResponse";
import {
    buildInventoryReservationsFromRollup,
    buildInventoryRollup,
    diffReservationsForInsert,
} from "../lib/pbv2InventoryReservations";
import {
    getInventoryReservationsGate,
    resolveInventoryPolicyFromOrgPreferences,
} from "@shared/inventoryPolicy";
import { convertReservationInputToBaseQty } from "@shared/uomConversions";
import {
    createRequestLogOnce,
    enrichAttachmentWithUrls,
    normalizeObjectKeyForDb,
    scheduleSupabaseObjectSelfCheck,
    tryExtractSupabaseObjectKeyFromUrl
} from "../lib/supabaseObjectHelpers";
import type { FileRole, FileSide } from "../lib/supabaseObjectHelpers";
import {
    createManualReservation,
    deleteManualReservation,
    getManualReservationById,
    listManualReservationsForOrder,
} from "../lib/manualInventoryReservationsRepo";

// Helper function to get userId from request user object
function getUserId(user: any): string | undefined {
    return user?.claims?.sub || user?.id;
}

// Helper to get organizationId from request (matches server/routes.ts behavior)
function getRequestOrganizationId(req: any): string | undefined {
    return req.organizationId || req.headers['x-organization-id'] as string;
}

const productionLineItemStatusRuleSchema = z
    .object({
        id: z.string().optional().nullable(),
        // Back-compat (older drafts)
        key: z.string().optional().nullable(),
        label: z.string().min(1),
        color: z.string().optional().nullable(),
        sendToProduction: z.boolean().optional().default(false),
        stationKey: z.string().optional().nullable(),
        stepKey: z.string().optional().nullable(),
        // Back-compat (older drafts)
        defaultStepKey: z.string().optional().nullable(),
        sortOrder: z.number().int().optional().nullable(),
    })
    .strict();

const productionLineItemStatusRulesSchema = z.array(productionLineItemStatusRuleSchema);

const SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES = [
    {
        id: 'prepress',
        label: 'Sent to Prepress',
        color: 'blue',
        sendToProduction: true,
        stationKey: 'flatbed',
        stepKey: 'prepress',
        sortOrder: 10,
    },
    {
        id: 'print',
        label: 'Sent to Print',
        color: 'purple',
        sendToProduction: true,
        stationKey: 'flatbed',
        stepKey: 'print',
        sortOrder: 20,
    },
    {
        id: 'done',
        label: 'Done',
        color: 'green',
        sendToProduction: false,
        stationKey: null,
        stepKey: null,
        sortOrder: 90,
    },
];

async function loadProductionLineItemStatusRulesForOrganization(organizationId: string) {
    const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

    const settings = (org?.settings as any) ?? {};
    const raw = settings?.preferences?.production?.lineItemStatuses;

    if (raw == null) {
        return { source: 'missing' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES };
    }

    const parsed = productionLineItemStatusRulesSchema.safeParse(raw);
    if (!parsed.success) {
        return { source: 'invalid' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES };
    }

    if (parsed.data.length === 0) {
        return { source: 'empty' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES };
    }

    const rules = parsed.data
        .map((r) => ({
            ...r,
            id: String((r as any).id ?? (r as any).key ?? '').trim(),
            stepKey: (r as any).stepKey ?? (r as any).defaultStepKey ?? null,
        }))
        .filter((r) => !!r.id);

    return { source: 'org' as const, rules };
}

async function loadInventoryPolicyForOrg(organizationId: string) {
    const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

    const prefs = (org?.settings as any)?.preferences;
    return resolveInventoryPolicyFromOrgPreferences(prefs);
}

async function requireInventoryReservationsNotOff(req: any, res: any) {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) {
        res.status(500).json({ message: "Missing organization context" });
        return null;
    }

    const policy = await loadInventoryPolicyForOrg(organizationId);
    const gate = getInventoryReservationsGate(policy);
    if (!gate.allowed) {
        res.status(gate.status).json(gate.body);
        return null;
    }

    return policy;
}

type Pbv2OrderLineItemSnapshot = {
    treeVersionId: string;
    evaluatedAt: string;
    pbv2InputSignature: string;
    explicitSelections: Record<string, unknown>;
    env: Record<string, unknown>;
    pricing: { addOnCents: number; breakdown: any[] };
    materials: any[];
    childItems: any[];
};

type Pbv2ChildItemProposalWithIndex = {
    kind: 'inlineSku' | 'productRef';
    title: string;
    skuRef?: string;
    childProductId?: string;
    qty: number;
    unitPriceCents?: number;
    amountCents?: number;
    invoiceVisibility: 'hidden' | 'rollup' | 'separateLine';
    sourceNodeId: string;
    effectIndex: number;
};

function asRecordOrEmpty(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function numOrUndef(value: unknown): number | undefined {
    if (value == null) return undefined;
    const n = typeof value === 'number' ? value : Number(String(value));
    return Number.isFinite(n) ? n : undefined;
}

async function evaluatePbv2SnapshotForProduct(args: {
    organizationId: string;
    productId: string;
    explicitSelections: Record<string, unknown>;
    env: Record<string, unknown>;
    pricingContext?: { customerTier?: 'default' | 'wholesale' | 'retail' };
    context?: 'persist' | 'recompute';
}): Promise<{ treeVersionId: string; snapshotJson: Pbv2OrderLineItemSnapshot } | null> {
    const { organizationId, productId, explicitSelections, env } = args;
    const context = args.context ?? 'persist';

    const [product] = await db
        .select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId, pricingProfileConfig: products.pricingProfileConfig })
        .from(products)
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
        .limit(1);

    if (!product?.pbv2ActiveTreeVersionId) return null;

    const treeVersionIdToUse = selectPbv2TreeVersionIdForEvaluation({
        activeTreeVersionId: product.pbv2ActiveTreeVersionId,
        pricingProfileConfig: (product as any).pricingProfileConfig,
    });
    if (!treeVersionIdToUse) return null;

    const [treeVersion] = await db
        .select({ id: pbv2TreeVersions.id, status: pbv2TreeVersions.status, treeJson: pbv2TreeVersions.treeJson })
        .from(pbv2TreeVersions)
        .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionIdToUse)))
        .limit(1);

    if (!treeVersion) throw new Error("PBV2 tree version not found");
    assertPbv2TreeVersionNotDraft(treeVersion.status, context);

    const evaluatedAt = new Date().toISOString();

    let pricing;
    let materials;
    let childItems;
    try {
        const pricingRes = pbv2ToPricingAddons(treeVersion.treeJson as any, explicitSelections, env as any, {
            pricingContext: args.pricingContext,
        });
        const materialsRes = pbv2ToMaterialEffects(treeVersion.treeJson as any, explicitSelections, env as any);
        const childItemsRes = pbv2ToChildItemProposals(treeVersion.treeJson as any, explicitSelections, env as any);
        pricing = { addOnCents: pricingRes.addOnCents, breakdown: pricingRes.breakdown };
        materials = materialsRes.materials;
        childItems = childItemsRes.childItems;
    } catch (e: any) {
        const err: any = new Error(e?.message || 'PBV2 evaluation failed');
        err.statusCode = 400;
        throw err;
    }

    const snapshotJson: Pbv2OrderLineItemSnapshot = {
        treeVersionId: String(treeVersion.id),
        evaluatedAt,
        pbv2InputSignature: await computePbv2InputSignature({
            treeVersionId: String(treeVersion.id),
            explicitSelections,
            env,
        }),
        explicitSelections,
        env,
        pricing,
        materials,
        childItems,
    };

    return { treeVersionId: String(treeVersion.id), snapshotJson };
}

function toChildItemProposalsWithIndexFromSnapshot(snapshot: any): Pbv2ChildItemProposalWithIndex[] {
    const raw = (snapshot as any)?.childItems;
    if (!Array.isArray(raw)) return [];

    const out: Pbv2ChildItemProposalWithIndex[] = [];
    for (let i = 0; i < raw.length; i++) {
        const ci = raw[i];
        if (!ci || typeof ci !== 'object') continue;
        const sourceNodeId = typeof (ci as any).sourceNodeId === 'string' ? String((ci as any).sourceNodeId) : '';
        if (!sourceNodeId) continue;
        const effectIndex = Number.isFinite(Number((ci as any).effectIndex)) ? Number((ci as any).effectIndex) : NaN;
        if (!Number.isFinite(effectIndex)) continue;

        const kind = (ci as any).kind === 'inlineSku' || (ci as any).kind === 'productRef' ? (ci as any).kind : null;
        const title = typeof (ci as any).title === 'string' ? String((ci as any).title) : '';
        const qty = Number((ci as any).qty);
        const invoiceVisibility =
            (ci as any).invoiceVisibility === 'hidden' || (ci as any).invoiceVisibility === 'rollup' || (ci as any).invoiceVisibility === 'separateLine'
                ? (ci as any).invoiceVisibility
                : 'rollup';

        if (!kind || !title || !Number.isFinite(qty)) continue;

        out.push({
            kind,
            title,
            skuRef: typeof (ci as any).skuRef === 'string' ? String((ci as any).skuRef) : undefined,
            childProductId: typeof (ci as any).childProductId === 'string' ? String((ci as any).childProductId) : undefined,
            qty,
            unitPriceCents: Number.isFinite(Number((ci as any).unitPriceCents)) ? Number((ci as any).unitPriceCents) : undefined,
            amountCents: Number.isFinite(Number((ci as any).amountCents)) ? Number((ci as any).amountCents) : undefined,
            invoiceVisibility,
            sourceNodeId,
            effectIndex: Math.trunc(effectIndex),
        });
    }

    return out;
}

function toChildItemProposalsFromSnapshot(snapshot: any): (Omit<Pbv2ChildItemProposalWithIndex, 'effectIndex'> & { effectIndex?: number })[] {
    const raw = (snapshot as any)?.childItems;
    if (!Array.isArray(raw)) return [];

    const out: (Omit<Pbv2ChildItemProposalWithIndex, 'effectIndex'> & { effectIndex?: number })[] = [];
    for (let i = 0; i < raw.length; i++) {
        const ci = raw[i];
        if (!ci || typeof ci !== 'object') continue;

        const sourceNodeId = typeof (ci as any).sourceNodeId === 'string' ? String((ci as any).sourceNodeId) : '';
        if (!sourceNodeId) continue;

        const kind = (ci as any).kind === 'inlineSku' || (ci as any).kind === 'productRef' ? (ci as any).kind : null;
        const title = typeof (ci as any).title === 'string' ? String((ci as any).title) : '';
        const qty = Number((ci as any).qty);
        const invoiceVisibility =
            (ci as any).invoiceVisibility === 'hidden' || (ci as any).invoiceVisibility === 'rollup' || (ci as any).invoiceVisibility === 'separateLine'
                ? (ci as any).invoiceVisibility
                : 'rollup';

        if (!kind || !title || !Number.isFinite(qty)) continue;

        const effectIndex = Number.isFinite(Number((ci as any).effectIndex)) ? Math.trunc(Number((ci as any).effectIndex)) : undefined;

        out.push({
            kind,
            title,
            skuRef: typeof (ci as any).skuRef === 'string' ? String((ci as any).skuRef) : undefined,
            childProductId: typeof (ci as any).childProductId === 'string' ? String((ci as any).childProductId) : undefined,
            qty,
            unitPriceCents: Number.isFinite(Number((ci as any).unitPriceCents)) ? Number((ci as any).unitPriceCents) : undefined,
            amountCents: Number.isFinite(Number((ci as any).amountCents)) ? Number((ci as any).amountCents) : undefined,
            invoiceVisibility,
            sourceNodeId,
            effectIndex,
        });
    }

    return out;
}

/**
 * Snapshot customer data for quotes and orders
 */
async function snapshotCustomerData(
    organizationId: string,
    customerId: string,
    contactId?: string | null,
    shippingMethod?: string | null,
    shippingMode?: string | null
): Promise<Record<string, any>> {
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

    let contact = null;
    if (contactId) {
        const [foundContact] = await db
            .select()
            .from(customerContacts as any)
            .where(eq((customerContacts as any).id, contactId))
            .limit(1);
        contact = foundContact;
    }

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

    const finalShippingMethod = shippingMethod || 'ship';
    const finalShippingMode = shippingMode || 'single_shipment';

    let shipToSnapshot: Record<string, any>;

    if (finalShippingMethod === 'pickup') {
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

export async function registerOrderRoutes(
    app: Express,
    deps: {
        isAuthenticated: any;
        tenantContext: any;
        isAdmin: any;
        isAdminOrOwner: any;
    }
) {
    const { isAuthenticated, tenantContext, isAdmin, isAdminOrOwner } = deps;

    // Orders routes
    app.get("/api/orders", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const pageRaw = req.query.page as string | undefined;
            const pageSizeRaw = req.query.pageSize as string | undefined;
            const includeThumbnailsRaw = req.query.includeThumbnails as string | undefined;
            const sortBy = req.query.sortBy as string | undefined;
            const sortDir = (req.query.sortDir as string | undefined) === 'asc' ? 'asc' : 'desc';

            const hasPaging = pageRaw !== undefined || pageSizeRaw !== undefined;

            if (hasPaging) {
                // Paginated response (match Quotes pattern)
                const page = Math.max(1, parseInt(pageRaw || '1', 10) || 1);
                const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw || '25', 10) || 25));
                // Default to false to avoid breaking page load if thumbnails schema is incomplete
                const includeThumbnails = includeThumbnailsRaw === 'true' || includeThumbnailsRaw === '1';

                const result = await storage.getAllOrdersPaginated(organizationId, {
                    search: req.query.search as string | undefined,
                    status: req.query.status as string | undefined,
                    priority: req.query.priority as string | undefined,
                    customerId: req.query.customerId as string | undefined,
                    startDate: req.query.startDate as string | undefined,
                    endDate: req.query.endDate as string | undefined,
                    sortBy,
                    sortDir,
                    page,
                    pageSize,
                    includeThumbnails,
                });

                // If thumbnails are requested, return:
                // - attachmentsSummary: totalCount + up to 3 preview thumbs per order
                // - previewThumbnailUrl: back-compat single preview (first preview thumb)
                // - previewThumbnailUrls: up to 3 preview thumbs per order (prefer attachments, else line-item assets)
                // Server generates usable URLs (no client-side URL construction).
                if (includeThumbnails && result?.items?.length) {
                    try {
                        const orderIds = result.items.map((o: any) => o.id).filter(Boolean);
                        if (orderIds.length) {
                            const attachmentRows = await db
                                .select({
                                    orderId: orderAttachments.orderId,
                                    id: orderAttachments.id,
                                    fileUrl: orderAttachments.fileUrl,
                                    storageProvider: orderAttachments.storageProvider,
                                    thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
                                    thumbKey: orderAttachments.thumbKey,
                                    previewKey: orderAttachments.previewKey,
                                    mimeType: orderAttachments.mimeType,
                                    fileName: orderAttachments.fileName,
                                    originalFilename: orderAttachments.originalFilename,
                                    createdAt: orderAttachments.createdAt,
                                })
                                .from(orderAttachments)
                                .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
                                .where(
                                    and(
                                        inArray(orderAttachments.orderId, orderIds),
                                        eq(orders.organizationId, organizationId),
                                    )
                                )
                                .orderBy(desc(orderAttachments.createdAt));

                            const logOnce = createRequestLogOnce();
                            const countsByOrderId: Record<string, number> = {};
                            const previewsByOrderId: Record<string, any[]> = {};

                            for (const row of attachmentRows) {
                                const orderId = row.orderId as string;
                                countsByOrderId[orderId] = (countsByOrderId[orderId] ?? 0) + 1;
                                if (!previewsByOrderId[orderId]) previewsByOrderId[orderId] = [];
                                if (previewsByOrderId[orderId].length < 3) {
                                    previewsByOrderId[orderId].push(row);
                                }
                            }

                            const attachmentsSummaryByOrderId: Record<
                                string,
                                { totalCount: number; previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }> }
                            > = {};

                            const previewUrlByOrderId: Record<string, string | null> = {};
                            const previewUrlsByOrderId: Record<string, string[]> = {};
                            const previewCountByOrderId: Record<string, number> = {};

                            for (const orderId of orderIds) {
                                const totalCount = countsByOrderId[orderId] ?? 0;
                                const previewRows = previewsByOrderId[orderId] ?? [];

                                const previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }> = [];
                                for (const att of previewRows) {
                                    // Canonical thumbnail doctrine (READS must match WRITES):
                                    // - Do not attempt to render legacy `thumbnailRelativePath` as a URL.
                                    //   That field has historically carried mismatched keys (causing /objects/* -> Supabase 404 spam).
                                    // - Prefer `thumbKey`/`previewKey` via `enrichAttachmentWithUrls`, which is aligned
                                    //   with the current thumbnail writers (see server/workers/thumbnailWorker.ts).
                                    // NOTE: We intentionally do NOT fall back to originalUrl here (could be a PDF).
                                    const enriched = await enrichAttachmentWithUrls(att, { logOnce });
                                    const thumbnailUrl =
                                        (enriched?.thumbnailUrl as string | null) ??
                                        (enriched?.previewThumbnailUrl as string | null) ??
                                        (enriched?.thumbUrl as string | null) ??
                                        (enriched?.previewUrl as string | null) ??
                                        (enriched?.pages?.[0]?.thumbUrl as string | null) ??
                                        null;

                                    previews.push({
                                        id: String(att.id),
                                        filename: String(att.originalFilename ?? att.fileName ?? 'Attachment'),
                                        mimeType: (att.mimeType ?? null) as string | null,
                                        thumbnailUrl,
                                    });
                                }

                                attachmentsSummaryByOrderId[orderId] = {
                                    totalCount,
                                    previews,
                                };

                                previewCountByOrderId[orderId] = totalCount;

                                const urls = Array.from(
                                    new Set(
                                        previews
                                            .map((p) => p.thumbnailUrl)
                                            .filter((u): u is string => typeof u === 'string' && u.length > 0)
                                    )
                                ).slice(0, 3);

                                previewUrlsByOrderId[orderId] = urls;
                                previewUrlByOrderId[orderId] = urls[0] ?? null;
                            }

                            // Fallback: if an order has no order-level attachment previews,
                            // use the first available order_line_item asset thumbnail (batched; no N+1).
                            const needsFallbackOrderIds = orderIds.filter((id) => (previewUrlsByOrderId[id]?.length ?? 0) === 0);
                            if (needsFallbackOrderIds.length) {
                                try {
                                    const lineItemRows = await db
                                        .select({
                                            orderId: orderLineItems.orderId,
                                            lineItemId: orderLineItems.id,
                                        })
                                        .from(orderLineItems)
                                        .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                                        .where(
                                            and(
                                                inArray(orderLineItems.orderId, needsFallbackOrderIds),
                                                eq(orders.organizationId, organizationId)
                                            )
                                        );

                                    const lineItemIds = lineItemRows.map((r) => r.lineItemId).filter(Boolean) as string[];
                                    if (lineItemIds.length) {
                                        const linkRows = await db
                                            .select({
                                                orderId: orderLineItems.orderId,
                                                assetId: assetLinks.assetId,
                                                role: assetLinks.role,
                                                createdAt: assetLinks.createdAt,
                                            })
                                            .from(assetLinks)
                                            .innerJoin(orderLineItems, eq(orderLineItems.id, assetLinks.parentId))
                                            .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                                            .where(
                                                and(
                                                    eq(assetLinks.organizationId, organizationId),
                                                    eq(assetLinks.parentType, 'order_line_item'),
                                                    inArray(assetLinks.parentId, lineItemIds),
                                                    inArray(orderLineItems.orderId, needsFallbackOrderIds),
                                                    eq(orders.organizationId, organizationId)
                                                )
                                            )
                                            .orderBy(desc(assetLinks.createdAt));

                                        const assetIds = Array.from(
                                            new Set(linkRows.map((r) => r.assetId).filter(Boolean) as string[])
                                        );

                                        if (assetIds.length) {
                                            const [assetRows, variantRows] = await Promise.all([
                                                db
                                                    .select()
                                                    .from(assets)
                                                    .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds))),
                                                db
                                                    .select()
                                                    .from(assetVariants)
                                                    .where(
                                                        and(
                                                            eq(assetVariants.organizationId, organizationId),
                                                            inArray(assetVariants.assetId, assetIds)
                                                        )
                                                    ),
                                            ]);

                                            const variantsByAssetId = new Map<string, any[]>();
                                            for (const v of variantRows as any[]) {
                                                const key = String(v.assetId);
                                                const list = variantsByAssetId.get(key) ?? [];
                                                list.push(v);
                                                variantsByAssetId.set(key, list);
                                            }

                                            const assetsById = new Map<string, any>();
                                            for (const a of assetRows as any[]) {
                                                assetsById.set(String(a.id), {
                                                    ...a,
                                                    variants: variantsByAssetId.get(String(a.id)) ?? [],
                                                });
                                            }

                                            const { enrichAssetWithUrls } = await import('../services/assets/enrichAssetWithUrls');

                                            const thumbByAssetId = new Map<string, string | null>();
                                            for (const assetId of assetIds) {
                                                const asset = assetsById.get(assetId);
                                                if (!asset) continue;
                                                const enriched = enrichAssetWithUrls(asset);
                                                const thumb =
                                                    (enriched as any).previewThumbnailUrl ??
                                                    (enriched as any).thumbnailUrl ??
                                                    (enriched as any).thumbUrl ??
                                                    null;
                                                thumbByAssetId.set(assetId, typeof thumb === 'string' && thumb.length ? thumb : null);
                                            }

                                            const linksByOrderId: Record<string, Array<{ assetId: string; role: string }>> = {};
                                            for (const row of linkRows as any[]) {
                                                const orderId = String(row.orderId);
                                                const assetId = String(row.assetId);
                                                const role = String(row.role ?? 'other');
                                                if (!linksByOrderId[orderId]) linksByOrderId[orderId] = [];
                                                linksByOrderId[orderId].push({ assetId, role });
                                            }

                                            // For overflow indicator: count distinct assets per order (even if thumb not ready).
                                            for (const orderId of needsFallbackOrderIds) {
                                                if ((previewCountByOrderId[orderId] ?? 0) > 0) continue;
                                                const links = linksByOrderId[orderId] ?? [];
                                                const uniqueAssetCount = new Set(links.map((l) => l.assetId).filter(Boolean)).size;
                                                if (uniqueAssetCount > 0) previewCountByOrderId[orderId] = uniqueAssetCount;
                                            }

                                            const logOnce = createRequestLogOnce();
                                            let appliedFallbackCount = 0;

                                            for (const orderId of needsFallbackOrderIds) {
                                                if ((previewUrlsByOrderId[orderId]?.length ?? 0) > 0) continue;

                                                const links = linksByOrderId[orderId] ?? [];
                                                if (!links.length) continue;

                                                const primaryLinks = links.filter((l) => l.role === 'primary');
                                                const otherLinks = links.filter((l) => l.role !== 'primary');
                                                const candidates = [...primaryLinks, ...otherLinks];

                                                const picked: string[] = [];
                                                const seen = new Set<string>();
                                                for (const c of candidates) {
                                                    const url = thumbByAssetId.get(c.assetId) ?? null;
                                                    if (!url) continue;
                                                    if (seen.has(url)) continue;
                                                    seen.add(url);
                                                    picked.push(url);
                                                    if (picked.length >= 3) break;
                                                }

                                                if (picked.length) {
                                                    previewUrlsByOrderId[orderId] = picked;
                                                    previewUrlByOrderId[orderId] = picked[0] ?? null;
                                                    appliedFallbackCount += 1;
                                                }
                                            }

                                            if (appliedFallbackCount > 0) {
                                                logOnce(
                                                    'orders-list-line-item-thumb-fallback',
                                                    '[OrdersList] Using line-item asset thumbnails as fallback for',
                                                    appliedFallbackCount,
                                                    'orders'
                                                );
                                            }
                                        }
                                    }
                                } catch (fallbackError: any) {
                                    // Fail-soft: thumbnails are optional.
                                    console.warn(
                                        '[OrdersList] Line-item asset thumbnail fallback failed (fail-soft):',
                                        fallbackError?.message || String(fallbackError)
                                    );
                                }
                            }

                            result.items = result.items.map((o: any) => ({
                                ...o,
                                attachmentsSummary: attachmentsSummaryByOrderId[o.id] ?? { totalCount: 0, previews: [] },
                                previewThumbnailUrl: previewUrlByOrderId[o.id] ?? null,
                                previewThumbnailUrls: previewUrlsByOrderId[o.id] ?? [],
                                previewThumbnailCount: previewCountByOrderId[o.id] ?? 0,
                                // Back-compat: keep existing field aligned.
                                previewImageUrl: previewUrlByOrderId[o.id] ?? null,
                            }));
                        }
                    } catch (error: any) {
                        // Fail-soft: list should still render even if signing fails.
                        console.warn('[OrdersList] Failed to enrich previewThumbnailUrl (fail-soft):', error?.message || String(error));
                        result.items = result.items.map((o: any) => ({
                            ...o,
                            attachmentsSummary: { totalCount: 0, previews: [] },
                            previewThumbnailUrl: null,
                            previewThumbnailUrls: [],
                            previewThumbnailCount: 0,
                            previewImageUrl: null,
                        }));
                    }
                }

                // Contract: always include previewThumbnailUrl; null when not available/requested.
                if (!includeThumbnails && result?.items?.length) {
                    result.items = result.items.map((o: any) => ({
                        ...o,
                        previewThumbnailUrl: null,
                        previewThumbnailUrls: [],
                        previewThumbnailCount: 0,
                        previewImageUrl: null,
                    }));
                }

                return res.json(result);
            }

            // Legacy non-paginated response (for backward compatibility)
            const filters = {
                search: req.query.search as string | undefined,
                status: req.query.status as string | undefined,
                priority: req.query.priority as string | undefined,
                customerId: req.query.customerId as string | undefined,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };
            const ordersList = await storage.getAllOrders(organizationId, filters);
            res.json(ordersList);
        } catch (error) {
            console.error("Error fetching orders:", error);
            res.status(500).json({ message: "Failed to fetch orders" });
        }
    });

    app.get("/api/orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const order = await storage.getOrderById(organizationId, req.params.id);
            if (!order) {
                return res.status(404).json({ message: "Order not found" });
            }
            res.json(order);
        } catch (error) {
            console.error("Error fetching order:", error);
            res.status(500).json({ message: "Failed to fetch order" });
        }
    });

    app.post("/api/orders", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) {
                return res.status(401).json({ message: "User not authenticated" });
            }

            // Validate the order data (excluding line items for now)
            const { lineItems, ...orderFields } = req.body;

            if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
                return res.status(400).json({ message: "At least one line item is required" });
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
            if (orderFields.customerId) {
                [customer] = await db
                    .select()
                    .from(customers)
                    .where(and(
                        eq(customers.id, orderFields.customerId),
                        eq(customers.organizationId, organizationId)
                    ))
                    .limit(1);
            }

            // Load products for each line item to get isTaxable flag
            const productIds = Array.from(new Set(lineItems.map((item: any) => item.productId)));
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
            const lineItemsForTaxCalc: LineItemInput[] = lineItems.map((item: any) => {
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

            // Merge tax data into line items
            const lineItemsWithTax = lineItems.map((item: any, index: number) => {
                const taxData = totalsResult.lineItemsWithTax[index];
                return {
                    ...item,
                    taxAmount: taxData.taxAmount,
                    isTaxableSnapshot: taxData.isTaxableSnapshot,
                };
            });

            // Sanitize timestamp fields to avoid Drizzle toISOString errors
            const sanitizeDateField = (value: any): string | null => {
                if (!value) return null;
                if (value instanceof Date) return value.toISOString();
                if (typeof value === 'string') return value;
                return null;
            };

            // Generate customer/shipping snapshot if customerId is provided
            let snapshotData: Record<string, any> = {};
            if (orderFields.customerId) {
                try {
                    snapshotData = await snapshotCustomerData(
                        organizationId,
                        orderFields.customerId,
                        orderFields.contactId || null,
                        orderFields.shippingMethod || null,
                        orderFields.shippingMode || null
                    );
                } catch (error) {
                    console.error('[OrderCreation] Snapshot failed:', error);
                    // Continue without snapshot - fields will be null
                }
            }

            // Create order with line items and tax totals
            const order = await storage.createOrder(organizationId, {
                ...orderFields,
                dueDate: sanitizeDateField(orderFields.dueDate),
                promisedDate: sanitizeDateField(orderFields.promisedDate),
                requestedDueDate: sanitizeDateField(orderFields.requestedDueDate),
                productionDueDate: sanitizeDateField(orderFields.productionDueDate),
                shippedAt: sanitizeDateField(orderFields.shippedAt),
                createdByUserId: userId,
                lineItems: lineItemsWithTax,
                // Tax totals
                taxRate: totalsResult.taxRate,
                taxAmount: totalsResult.taxAmount,
                taxableSubtotal: totalsResult.taxableSubtotal,
                // Snapshot fields
                status: orderFields.status || 'new',
                ...snapshotData,
                trackingNumber: orderFields.trackingNumber || undefined,
                carrier: orderFields.carrier || undefined,
                carrierAccountNumber: orderFields.carrierAccountNumber || undefined,
                shippingInstructions: orderFields.shippingInstructions || undefined,
            });

            // Create audit log
            await storage.createAuditLog(organizationId, {
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: 'CREATE',
                entityType: 'order',
                entityId: order.id,
                entityName: order.orderNumber,
                description: `Created order ${order.orderNumber}`,
                newValues: order,
            });

            res.json(order);
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("Zod validation error:", error.errors);
                return res.status(400).json({ message: fromZodError(error).message });
            }
            console.error("Error creating order:", error);
            res.status(500).json({ message: "Failed to create order", error: (error as Error).message });
        }
    });

    app.patch("/api/orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            const userRole = req.user?.role || 'customer';

            // Safe per-order billing readiness policy updates
            if (req.body.billingReadyPolicy !== undefined) {
                const isAdminOrOwnerResult = ['owner', 'admin'].includes(String(userRole).toLowerCase());
                if (!isAdminOrOwnerResult) {
                    return res.status(403).json({ message: 'Not authorized to update billing readiness policy' });
                }

                const value = req.body.billingReadyPolicy;
                const allowed = ['all_line_items_done', 'manual', 'none'];
                if (value !== null && value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) {
                    return res.status(400).json({ message: `Invalid billingReadyPolicy. Must be one of: ${allowed.join(', ')} or null` });
                }
            }

            // BLOCK status changes - must use /transition endpoint
            if (req.body.status !== undefined) {
                return res.status(400).json({
                    message: "Status changes must use the /api/orders/:id/transition endpoint for proper validation and side effects.",
                    code: "USE_TRANSITION_ENDPOINT"
                });
            }

            // BLOCK state changes - TitanOS state transitions should also use /transition endpoint
            // (Production scheduling and other side effects depend on proper state transitions)
            if (req.body.state !== undefined) {
                return res.status(400).json({
                    message: "State changes must use the /api/orders/:id/transition endpoint for proper validation and side effects.",
                    code: "USE_TRANSITION_ENDPOINT"
                });
            }

            // Get order to check current status
            const existingOrder = await storage.getOrderById(organizationId, req.params.id);
            if (!existingOrder) {
                return res.status(404).json({ message: "Order not found" });
            }

            // Normalize shippingCents server-side (integer cents; never allow pickup + cents > 0)
            const finalShippingMethod = (req.body.shippingMethod ?? existingOrder.shippingMethod) as string | null | undefined;
            if (finalShippingMethod === 'pickup') {
                req.body.shippingCents = 0;
            } else if (req.body.shippingCents !== undefined) {
                const raw = Number(req.body.shippingCents);
                if (!Number.isFinite(raw)) {
                    return res.status(400).json({ message: "Invalid shippingCents" });
                }
                req.body.shippingCents = Math.max(0, Math.floor(raw));
            }

            // Check if order is terminal (completed/canceled)
            const isTerminal = existingOrder.status === 'completed' || existingOrder.status === 'canceled';

            // Enforce allowCompletedOrderEdits setting for terminal orders
            if (isTerminal) {
                const isAdminOrOwnerResult = ['owner', 'admin'].includes(userRole);

                if (!isAdminOrOwnerResult) {
                    return res.status(403).json({
                        message: "Cannot edit completed or canceled orders",
                        code: "ORDER_LOCKED"
                    });
                }

                // Admin/Owner must have setting enabled
                const [org] = await db
                    .select({ settings: organizations.settings })
                    .from(organizations)
                    .where(eq(organizations.id, organizationId))
                    .limit(1);

                const preferences = (org?.settings as any)?.preferences || {};
                const allowCompletedOrderEdits = preferences?.orders?.allowCompletedOrderEdits || false;

                if (!allowCompletedOrderEdits) {
                    return res.status(403).json({
                        message: "Editing completed/canceled orders is disabled. Enable 'Allow Completed Order Edits' in organization settings.",
                        code: "ORDER_LOCKED_SETTING_DISABLED"
                    });
                }
            }

            // Validate customerId if provided
            if (req.body.customerId) {
                const customer = await storage.getCustomerById(organizationId, req.body.customerId);
                if (!customer) {
                    return res.status(400).json({ message: "Invalid customer ID" });
                }

                // Auto-set contactId to primary contact when customer changes
                if (req.body.customerId !== existingOrder.customerId) {
                    // Find primary contact for new customer, or fallback to newest
                    const contacts = await db
                        .select()
                        .from(customerContacts)
                        .where(eq(customerContacts.customerId, req.body.customerId))
                        .orderBy(
                            sql`CASE WHEN ${customerContacts.isPrimary} = true THEN 0 ELSE 1 END`,
                            sql`${customerContacts.createdAt} DESC`
                        );

                    // Set contactId to primary contact or null if none exist
                    req.body.contactId = contacts[0]?.id || null;
                }
            }

            const orderData = updateOrderSchema.parse({
                ...req.body,
                id: req.params.id,
            });
            const { id, ...updateData } = orderData;

            // NOTE: updateOrderSchema may strip fields we still support updating via PATCH.
            // Customer/contact changes are validated above and also used for snapshot refresh.
            const updateDataWithCustomer = {
                ...updateData,
                ...(req.body.customerId !== undefined ? { customerId: req.body.customerId } : {}),
                ...(req.body.contactId !== undefined ? { contactId: req.body.contactId } : {}),
            };

            // If shipping cents or method changed, keep totals consistent by including shipping in total
            const shippingMethodChangedForTotals = req.body.shippingMethod !== undefined && req.body.shippingMethod !== existingOrder.shippingMethod;
            const shippingCentsChangedForTotals = req.body.shippingCents !== undefined && req.body.shippingCents !== (existingOrder as any).shippingCents;
            if (shippingMethodChangedForTotals || shippingCentsChangedForTotals) {
                const subtotal = Number(updateDataWithCustomer.subtotal ?? existingOrder.subtotal ?? 0);
                const discount = Number(updateDataWithCustomer.discount ?? existingOrder.discount ?? 0);
                const tax = Number((updateDataWithCustomer as any).taxAmount ?? (updateDataWithCustomer as any).tax ?? (existingOrder as any).taxAmount ?? existingOrder.tax ?? 0);
                const cents = Number((updateDataWithCustomer as any).shippingCents ?? (existingOrder as any).shippingCents ?? 0);
                const shipping = Number.isFinite(cents) ? Math.max(0, Math.floor(cents)) / 100 : 0;
                (updateDataWithCustomer as any).total = (subtotal - discount + tax + shipping).toFixed(2);
            }

            // Get old values for audit
            const oldOrder = await storage.getOrderById(organizationId, req.params.id);

            // Determine if we need to refresh snapshots
            const customerChanged = req.body.customerId && req.body.customerId !== oldOrder?.customerId;
            const shippingMethodChanged = req.body.shippingMethod && req.body.shippingMethod !== oldOrder?.shippingMethod;
            const shippingModeChanged = req.body.shippingMode && req.body.shippingMode !== oldOrder?.shippingMode;
            const shouldRefreshSnapshot = customerChanged || shippingMethodChanged || shippingModeChanged;

            let snapshotData: Record<string, any> = {};
            if (shouldRefreshSnapshot && oldOrder) {
                const finalCustomerId = req.body.customerId || oldOrder.customerId;
                const finalContactId = req.body.contactId !== undefined ? req.body.contactId : oldOrder.contactId;
                const finalShippingMethod = req.body.shippingMethod || oldOrder.shippingMethod;
                const finalShippingMode = req.body.shippingMode || oldOrder.shippingMode;

                if (finalCustomerId) {
                    try {
                        snapshotData = await snapshotCustomerData(
                            organizationId,
                            finalCustomerId,
                            finalContactId,
                            finalShippingMethod,
                            finalShippingMode
                        );
                        console.log(`[PATCH /api/orders/${req.params.id}] Refreshed snapshot due to changes`);
                    } catch (error) {
                        console.error('[OrderUpdate] Snapshot refresh failed:', error);
                        // Continue without snapshot refresh
                    }
                }
            }

            // Update order - now returns full OrderWithRelations
            const order = await storage.updateOrder(organizationId, req.params.id, {
                ...updateDataWithCustomer,
                ...snapshotData,
            });

            // If per-order billing policy changed, recompute readiness and return refreshed order.
            if (req.body.billingReadyPolicy !== undefined) {
                try {
                    await recomputeOrderBillingStatus({ organizationId, orderId: req.params.id });
                } catch (e) {
                    console.warn('[BillingReady] Recompute after policy change failed:', e);
                }
                const refreshed = await storage.getOrderById(organizationId, req.params.id);
                if (refreshed) {
                    return res.json(refreshed);
                }
            }

            // Create audit log entries
            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

            // Structured timeline events (v1): only whitelisted fields, only when values actually changed.
            // Stored in order_audit_log.metadata. Old rows remain supported in the UI.
            if (userId && oldOrder) {
                const toNullableString = (v: any): string | null => {
                    if (v == null) return null;
                    const s = String(v);
                    const t = s.trim();
                    return t.length > 0 ? t : null;
                };

                const toDateOnlyIso = (v: any): string | null => {
                    if (!v) return null;
                    try {
                        const d = new Date(String(v));
                        if (!Number.isFinite(d.getTime())) return null;
                        return d.toISOString().split('T')[0];
                    } catch {
                        return null;
                    }
                };

                const mapFulfillmentType = (shippingMethod: any): string | null => {
                    const v = toNullableString(shippingMethod);
                    if (!v) return null;
                    if (v === 'pickup') return 'pickup';
                    if (v === 'deliver') return 'delivery';
                    if (v === 'ship') return 'shipping';
                    return v;
                };

                const displayLabel = `Order ${order.orderNumber}`;
                const nowIso = new Date().toISOString();

                const diffs: Array<{ fieldKey: string; fromValue: any; toValue: any }> = [];

                // Order-level whitelist
                {
                    const from = toNullableString((oldOrder as any).poNumber);
                    const to = toNullableString((order as any).poNumber);
                    if (from !== to) diffs.push({ fieldKey: 'poNumber', fromValue: from ?? '', toValue: to ?? '' });
                }
                {
                    const from = toNullableString((oldOrder as any).label);
                    const to = toNullableString((order as any).label);
                    if (from !== to) diffs.push({ fieldKey: 'jobLabel', fromValue: from ?? '', toValue: to ?? '' });
                }
                {
                    const from = toNullableString((oldOrder as any).priority);
                    const to = toNullableString((order as any).priority);
                    if (from !== to) diffs.push({ fieldKey: 'priority', fromValue: from, toValue: to });
                }
                {
                    const from = mapFulfillmentType((oldOrder as any).shippingMethod);
                    const to = mapFulfillmentType((order as any).shippingMethod);
                    if (from !== to) diffs.push({ fieldKey: 'fulfillmentType', fromValue: from, toValue: to });
                }
                {
                    const from = toDateOnlyIso((oldOrder as any).promisedDate);
                    const to = toDateOnlyIso((order as any).promisedDate);
                    if (from !== to) diffs.push({ fieldKey: 'promisedDate', fromValue: from, toValue: to });
                }
                {
                    const from = toDateOnlyIso((oldOrder as any).dueDate);
                    const to = toDateOnlyIso((order as any).dueDate);
                    if (from !== to) diffs.push({ fieldKey: 'dueDate', fromValue: from, toValue: to });
                }
                {
                    const from = Boolean((oldOrder as any).billingReadyOverride);
                    const to = Boolean((order as any).billingReadyOverride);
                    if (from !== to) diffs.push({ fieldKey: 'billingReadyOverride', fromValue: from, toValue: to });
                }
                {
                    // In UI this is currently labeled as pickup notes / shipping instructions.
                    // v1 maps it to customerNotes as the closest whitelisted field.
                    const from = toNullableString((oldOrder as any).shippingInstructions);
                    const to = toNullableString((order as any).shippingInstructions);
                    if (from !== to) diffs.push({ fieldKey: 'customerNotes', fromValue: from ?? '', toValue: to ?? '' });
                }

                for (const d of diffs) {
                    await storage.createOrderAuditLog({
                        orderId: order.id,
                        userId,
                        userName,
                        actionType: 'order.field_changed',
                        fromStatus: null,
                        toStatus: null,
                        note: null,
                        metadata: {
                            structuredEvent: {
                                eventType: 'order.field_changed',
                                entityType: 'order',
                                entityId: order.id,
                                displayLabel,
                                fieldKey: d.fieldKey,
                                fromValue: d.fromValue,
                                toValue: d.toValue,
                                actorUserId: userId,
                                createdAt: nowIso,
                            },
                        },
                    });
                }
            }

            res.json(order);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: fromZodError(error).message });
            }
            console.error("Error updating order:", error);
            res.status(500).json({ message: "Failed to update order" });
        }
    });

    // Bulk Line Item Status Update Endpoint
    app.patch("/api/orders/:orderId/line-items/status", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const { status, lineItemIds } = req.body;

            if (!status || typeof status !== 'string') {
                return res.status(400).json({ message: "status is required" });
            }

            const validStatuses = ['queued', 'printing', 'finishing', 'done', 'canceled'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
            }

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ message: "Order not found" });

            const allLineItems = await db
                .select()
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            let itemsToUpdate = allLineItems;
            if (lineItemIds && Array.isArray(lineItemIds) && lineItemIds.length > 0) {
                itemsToUpdate = allLineItems.filter(li => lineItemIds.includes(li.id));
            } else {
                itemsToUpdate = allLineItems.filter(li => li.status !== 'done' && li.status !== 'canceled');
            }

            if (itemsToUpdate.length === 0) {
                return res.json({ success: true, message: "No line items to update", updatedCount: 0 });
            }

            const updatePromises = itemsToUpdate.map(li =>
                db
                    .update(orderLineItems)
                    .set({
                        status: status as any,
                        updatedAt: sql`now()`
                    })
                    .where(eq(orderLineItems.id, li.id))
            );

            await Promise.all(updatePromises);

            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
            await storage.createOrderAuditLog({
                orderId: order.id,
                userId,
                userName,
                actionType: 'bulk_line_item_status_update',
                fromStatus: null,
                toStatus: null,
                note: `Bulk updated ${itemsToUpdate.length} line item(s) to status: ${status}`,
                metadata: {
                    status,
                    count: itemsToUpdate.length,
                    lineItemIds: itemsToUpdate.map(li => li.id),
                },
            });
            
            // Trigger: Auto-schedule production when line items move into in_production
            if (status === 'in_production') {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[BulkLineItemStatus:TRIGGER] Detected ${itemsToUpdate.length} items moving to in_production for orderId=${orderId}`);
                }
                
                try {
                    const { scheduleOrderLineItemsForProduction } = await import('../services/productionScheduling');
                    const { loadProductionLineItemStatusRulesForOrganization, appendEvent } = await import('../productionHelpers');
                    
                    // Only schedule items that weren't already in production
                    const itemsMovingIntoProduction = itemsToUpdate.filter(li => li.status !== 'in_production');
                    
                    if (itemsMovingIntoProduction.length > 0) {
                        const scheduleResult = await scheduleOrderLineItemsForProduction({
                            organizationId,
                            orderId,
                            lineItemIds: itemsMovingIntoProduction.map(li => li.id),
                            loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
                            appendEvent,
                        });
                        
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`[BulkLineItemStatus:TRIGGER] Auto-scheduled production for ${itemsMovingIntoProduction.length} items:`, scheduleResult.data);
                        }
                    }
                } catch (productionErr: any) {
                    console.error('[BulkLineItemStatus:TRIGGER] Production auto-scheduling failed:', productionErr);
                    // Fail soft - don't break the status update
                }
            }

            // Billing readiness recompute (fail-soft)
            try {
                const recompute = await recomputeOrderBillingStatus({ organizationId, orderId });
                if ((recompute as any).updated) {
                    try {
                        await storage.createOrderAuditLog({
                            orderId,
                            userId,
                            userName,
                            actionType: 'order_billing_ready_auto',
                            fromStatus: null,
                            toStatus: null,
                            note: `Billing status auto-updated: ${(recompute as any).from} → ${(recompute as any).to}`,
                            metadata: recompute as any,
                        });
                    } catch { }
                }
            } catch (e) {
                console.warn('[BillingReady] Recompute failed:', e);
            }

            res.json({
                success: true,
                message: `Updated ${itemsToUpdate.length} line item(s) to ${status}`,
                updatedCount: itemsToUpdate.length,
            });
        } catch (error) {
            console.error("Error bulk updating line item status:", error);
            res.status(500).json({ message: "Failed to update line item statuses" });
        }
    });

    // Order Status Transition Endpoint
    app.post("/api/orders/:orderId/transition", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const { toStatus, reason } = req.body;

            if (!toStatus || typeof toStatus !== 'string') {
                return res.status(400).json({ success: false, message: "toStatus is required" });
            }

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });

            const lineItems = await db
                .select()
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            const attachments = await db
                .select()
                .from(orderAttachments)
                .where(eq(orderAttachments.orderId, orderId));

            let jobsCount = 0;
            try {
                const jobRecords = await db
                    .select()
                    .from(jobs)
                    .where(eq(jobs.orderId, orderId));
                jobsCount = jobRecords.length;
            } catch (err) {
                console.warn('[OrderTransition] Could not load jobs count:', err);
            }

            const orgPreferences = await getOrgPreferences(organizationId);

            if (toStatus === 'completed') {
                const requireLineItemsDone = orgPreferences?.orders?.requireLineItemsDoneToComplete ?? true;
                if (requireLineItemsDone) {
                    const incompleteLi = lineItems.filter(li => li.status !== 'done' && li.status !== 'canceled');
                    if (incompleteLi.length > 0) {
                        return res.status(400).json({
                            success: false,
                            message: `Cannot complete order: ${incompleteLi.length} line item(s) are not finished.`,
                            code: 'LINE_ITEMS_NOT_COMPLETE',
                            incompleteCount: incompleteLi.length,
                        });
                    }
                }
            }

            const { validateOrderTransition } = await import('../services/orderTransition');
            const validation = validateOrderTransition(order.status, toStatus, {
                order,
                lineItemsCount: lineItems.length,
                attachmentsCount: attachments.length,
                fulfillmentStatus: order.fulfillmentStatus,
                jobsCount,
                hasShippedAt: !!order.shippedAt,
                orgPreferences,
            });

            if (!validation.ok) {
                return res.status(400).json({
                    success: false,
                    message: validation.message,
                    code: validation.code,
                });
            }

            const updateData: Partial<InsertOrder> = {
                status: toStatus as any,
            };

            const now = new Date().toISOString();
            
            // Trigger: Auto-schedule production when order moves into in_production
            const isMovingIntoProduction = order.status !== 'in_production' && toStatus === 'in_production';
            
            if (order.status === 'new' && toStatus === 'in_production') {
                try {
                    await storage.autoDeductInventoryWhenOrderMovesToProduction(organizationId, orderId, userId);
                } catch (invErr) {
                    console.error('[OrderTransition] Inventory deduction failed:', invErr);
                    validation.warnings = validation.warnings || [];
                    validation.warnings.push('Inventory deduction failed - please verify stock levels manually.');
                }
                updateData.startedProductionAt = now;
            }

            const updatedOrder = await storage.updateOrder(organizationId, orderId, updateData);
            
            // Auto-schedule production jobs after status update (fail-soft)
            if (isMovingIntoProduction) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[OrderTransition:TRIGGER] Detected transition to in_production for orderId=${orderId}`);
                }
                
                try {
                    const { scheduleOrderLineItemsForProduction } = await import('../services/productionScheduling');
                    const { loadProductionLineItemStatusRulesForOrganization, appendEvent } = await import('../productionHelpers');
                    
                    const scheduleResult = await scheduleOrderLineItemsForProduction({
                        organizationId,
                        orderId,
                        lineItemIds: undefined, // Schedule ALL production-required items
                        loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
                        appendEvent,
                    });
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`[OrderTransition:TRIGGER] Auto-scheduled production jobs for order ${orderId}:`, scheduleResult.data);
                    }
                    
                    if (scheduleResult.success && scheduleResult.data.createdJobCount > 0) {
                        validation.warnings = validation.warnings || [];
                        validation.warnings.push(`✓ Scheduled ${scheduleResult.data.createdJobCount} line item(s) for production.`);
                    }
                } catch (productionErr: any) {
                    console.error('[OrderTransition:TRIGGER] Production auto-scheduling failed:', productionErr);
                    validation.warnings = validation.warnings || [];
                    validation.warnings.push('Production auto-scheduling failed - use "Send to Production" button if needed.');
                }
            }
            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

            await storage.createAuditLog(organizationId, {
                userId,
                userName,
                actionType: 'UPDATE',
                entityType: 'order',
                entityId: updatedOrder.id,
                entityName: updatedOrder.orderNumber,
                description: `Changed order status from ${order.status} to ${toStatus}${reason ? `: ${reason}` : ''}`,
                oldValues: { status: order.status },
                newValues: { status: toStatus, reason },
            });

            await storage.createOrderAuditLog({
                orderId: updatedOrder.id,
                userId,
                userName,
                actionType: 'status_transition',
                fromStatus: order.status,
                toStatus: toStatus,
                note: reason || null,
                metadata: null,
            });

            return res.json({
                success: true,
                data: updatedOrder,
                message: `Order status changed to ${toStatus}`,
                warnings: validation.warnings,
            });
        } catch (error: any) {
            console.error('[OrderTransition] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to transition order status", error: error?.message });
        }
    });

    // TitanOS State Transitions
    app.post("/api/orders/:orderId/complete-production", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const { autoMarkRemainingDone } = req.body || {};

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });

            if (order.state !== 'open') {
                return res.status(400).json({ success: false, code: 'INVALID_STATE', message: `Cannot complete production from ${order.state} state.` });
            }

            const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
            const remainingLineItems = lineItems.filter((li: any) => li.status !== 'done' && li.status !== 'canceled');
            const remainingCount = remainingLineItems.length;
            const remainingIds = remainingLineItems.map((li: any) => li.id);

            const orgPreferences = await getOrgPreferences(organizationId);
            const requireAllLineItemsDoneToComplete = orgPreferences?.orders?.requireAllLineItemsDoneToComplete ?? true;

            const shouldAutoMark = requireAllLineItemsDoneToComplete ? autoMarkRemainingDone === true : true;

            if (requireAllLineItemsDoneToComplete && remainingCount > 0 && !shouldAutoMark) {
                return res.status(409).json({ success: false, code: 'LINE_ITEMS_NOT_COMPLETE', remainingCount, canOverride: true });
            }

            const { determineRoutingTarget, mapStateToLegacyStatus } = await import('../services/orderStateService');
            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
            const nowIso = new Date().toISOString();

            const result = await db.transaction(async (tx) => {
                let didAutoMark = false;
                let autoMarkedCount = 0;

                if (remainingCount > 0 && shouldAutoMark) {
                    didAutoMark = true;
                    autoMarkedCount = remainingCount;
                    await tx.update(orderLineItems).set({ status: 'done', updatedAt: sql`now()` as any }).where(and(eq(orderLineItems.orderId, orderId), inArray(orderLineItems.id, remainingIds)));
                }

                const routingTarget = determineRoutingTarget(order as any);
                const legacyStatus = mapStateToLegacyStatus('production_complete' as any);

                const [updatedOrder] = await tx.update(orders).set({
                    state: 'production_complete' as any,
                    status: legacyStatus as any,
                    productionCompletedAt: nowIso,
                    routingTarget,
                    updatedAt: sql`now()` as any,
                }).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId))).returning();

                return { updatedOrder, didAutoMark, autoMarkedCount };
            });

            // Billing readiness recompute (fail-soft)
            try {
                const recompute = await recomputeOrderBillingStatus({ organizationId, orderId });
                if ((recompute as any).updated) {
                    try {
                        await storage.createOrderAuditLog({
                            orderId,
                            userId,
                            userName,
                            actionType: 'order_billing_ready_auto',
                            fromStatus: null,
                            toStatus: null,
                            note: `Billing status auto-updated: ${(recompute as any).from} → ${(recompute as any).to}`,
                            metadata: recompute as any,
                        });
                    } catch { }
                }
            } catch (e) {
                console.warn('[BillingReady] Recompute failed:', e);
            }

            return res.json({ success: true, data: result.updatedOrder, didAutoMark: result.didAutoMark, autoMarkedCount: result.autoMarkedCount, message: 'Order production completed' });
        } catch (error: any) {
            console.error('[CompleteProduction] Error:', error);
            return res.status(500).json({ success: false, message: 'Failed to complete production', error: error?.message });
        }
    });

    app.patch("/api/orders/:orderId/state", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const { nextState, notes } = req.body;

            if (!nextState) return res.status(400).json({ success: false, message: "nextState is required" });

            const { validateOrderStateTransition, transitionOrderState, isTerminalState } = await import('../services/orderStateService');
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });

            if (isTerminalState(order.state as any)) {
                return res.status(400).json({ success: false, message: `Cannot transition from ${order.state} state.`, code: 'TERMINAL_STATE' });
            }

            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
            const updatedOrder = await transitionOrderState({
                organizationId,
                orderId,
                nextState: nextState as any,
                actorUserId: userId,
                actorUserName: userName,
                notes,
            });

            return res.json({ success: true, data: updatedOrder, message: `Order transitioned to ${nextState}` });
        } catch (error: any) {
            console.error('[OrderStateTransition] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to transition order state", error: error?.message });
        }
    });

    app.get(["/api/orders/status-pills", "/api/order-status-pills"], isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const stateScope = (req.query.stateScope ?? req.query.state) as string;
            if (!stateScope) return res.status(400).json({ success: false, message: "state parameter is required" });
            const { listStatusPills } = await import('../services/orderStatusPillService');
            const pills = await listStatusPills(organizationId, stateScope as any, true);
            return res.json({ success: true, data: pills, pills });
        } catch (error: any) {
            console.error('[StatusPills:GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch status pills", error: error?.message });
        }
    });

    app.post("/api/orders/status-pills", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { createStatusPill } = await import('../services/orderStatusPillService');
            const pill = await createStatusPill(organizationId, req.body);
            res.json({ success: true, data: pill });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.patch("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { updateStatusPill } = await import('../services/orderStatusPillService');
            const pill = await updateStatusPill(organizationId, req.params.pillId, req.body);
            res.json({ success: true, data: pill });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.delete("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { deleteStatusPill } = await import('../services/orderStatusPillService');
            await deleteStatusPill(organizationId, req.params.pillId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.post("/api/orders/status-pills/:pillId/make-default", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { setDefaultPill } = await import('../services/orderStatusPillService');
            await setDefaultPill(organizationId, req.params.pillId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    // Assign Status Pill
    app.patch("/api/orders/:orderId/status-pill", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const value = (req.body?.value ?? req.body?.statusPillValue) as string | null;
            const { assignOrderStatusPill } = await import('../services/orderStatusPillService');
            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

            await assignOrderStatusPill({
                organizationId,
                orderId,
                statusPillValue: value,
                actorUserId: userId,
                actorUserName: userName,
            });

            const updatedOrder = await storage.getOrderById(organizationId, orderId);
            return res.json({ success: true, data: updatedOrder, message: value ? `Status pill set to "${value}"` : 'Status pill cleared' });
        } catch (error: any) {
            console.error('[StatusPill:PATCH] Error:', error);
            return res.status(500).json({ success: false, message: error?.message || "Failed to update status pill" });
        }
    });

    // Order List Notes
    app.get("/api/orders/:id/list-note", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const [note] = await db.select().from(orderListNotes).where(and(eq(orderListNotes.organizationId, organizationId), eq(orderListNotes.orderId, req.params.id))).limit(1);
            res.json({ listLabel: note?.listLabel || null });
        } catch (error) {
            console.error("Error fetching order list note:", error);
            res.status(500).json({ message: "Failed to fetch list note" });
        }
    });

    app.put("/api/orders/:id/list-note", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ message: "User not authenticated" });
            const { id: orderId } = req.params;
            const { listLabel } = req.body;
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ message: "Order not found" });
            const [updated] = await db.insert(orderListNotes).values({ organizationId, orderId, listLabel: listLabel || null, updatedByUserId: userId }).onConflictDoUpdate({ target: [orderListNotes.organizationId, orderListNotes.orderId], set: { listLabel: listLabel || null, updatedByUserId: userId, updatedAt: new Date() } }).returning();
            res.json({ success: true, listLabel: updated.listLabel });
        } catch (error) {
            console.error("Error updating order list note:", error);
            res.status(500).json({ message: "Failed to update list note" });
        }
    });

    // Order Attachments
    app.get("/api/orders/:orderId/attachments", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId } = req.params;
            const { includeLineItems } = req.query;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ error: "Order not found" });
            const whereConditions: any[] = [eq(orderAttachments.orderId, orderId)];
            if (includeLineItems !== 'true') whereConditions.push(isNull(orderAttachments.orderLineItemId));
            const files = await db.select().from(orderAttachments).where(and(...whereConditions)).orderBy(desc(orderAttachments.createdAt));
            
            // Debug logging - check what DB returned BEFORE enrichment
            if (files.length > 0 && process.env.DEBUG_THUMBNAILS) {
                console.log('[OrderAttachments:GET] 📊 Raw DB record (before enrichment):');
                console.log('  - attachmentId:', files[0].id);
                console.log('  - fileName:', files[0].fileName);
                console.log('  - thumbKey:', files[0].thumbKey);
                console.log('  - previewKey:', files[0].previewKey);
                console.log('  - thumbStatus:', files[0].thumbStatus);
            }
            
            const logOnce = createRequestLogOnce();
            const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));
            
            // Debug logging for thumbnail troubleshooting
            if (enrichedFiles.length > 0 && process.env.DEBUG_THUMBNAILS) {
                console.log('[OrderAttachments:GET] 🔍 Enriched attachment (after enrichment):');
                console.log('  - attachmentId:', enrichedFiles[0].id);
                console.log('  - thumbUrl:', enrichedFiles[0].thumbUrl);
                console.log('  - previewUrl:', enrichedFiles[0].previewUrl);
                console.log('  - thumbKey:', enrichedFiles[0].thumbKey);
                console.log('  - previewKey:', enrichedFiles[0].previewKey);
            }
            
            return res.json({ success: true, data: enrichedFiles });
        } catch (error) {
            console.error("[OrderAttachments:GET] Error:", error);
            return res.status(500).json({ error: "Failed to fetch order attachments" });
        }
    });

    // Unified attachments for Orders list modal: order-level attachments + line-item artwork assets
    app.get('/api/orders/:orderId/attachments-unified', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const [orderRow] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!orderRow) return res.status(404).json({ error: 'Order not found' });

            const logOnce = createRequestLogOnce();

            // 1) Order-level attachments (legacy order_attachments rows)
            const attachmentRows = await db
                .select({
                    id: orderAttachments.id,
                    fileName: orderAttachments.fileName,
                    originalFilename: orderAttachments.originalFilename,
                    fileUrl: orderAttachments.fileUrl,
                    storageProvider: orderAttachments.storageProvider,
                    thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
                    thumbKey: orderAttachments.thumbKey,
                    previewKey: orderAttachments.previewKey,
                    mimeType: orderAttachments.mimeType,
                    createdAt: orderAttachments.createdAt,
                    orderLineItemId: orderAttachments.orderLineItemId,
                })
                .from(orderAttachments)
                .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
                .where(and(eq(orderAttachments.orderId, orderId), eq(orders.organizationId, organizationId)))
                .orderBy(desc(orderAttachments.createdAt));

            const enrichedAttachments = await Promise.all(
                attachmentRows.map((a) => enrichAttachmentWithUrls(a as any, { logOnce }))
            );

            const attachmentItems = (enrichedAttachments as any[]).map((att) => {
                const filename = String(att?.originalFilename ?? att?.fileName ?? 'Attachment');
                const objectPath = (att?.objectPath as string | null) ?? null;
                const objectsUrl = typeof objectPath === 'string' && objectPath.length
                    ? `/objects/${objectPath}?filename=${encodeURIComponent(filename)}`
                    : null;
                const previewThumbnailUrl =
                    (att?.previewThumbnailUrl as string | null) ??
                    (att?.thumbnailUrl as string | null) ??
                    (att?.thumbUrl as string | null) ??
                    (att?.previewUrl as string | null) ??
                    null;

                return {
                    id: String(att?.id),
                    filename,
                    mimeType: (att?.mimeType as string | null) ?? null,
                    fileSize: (att?.fileSize as number | null) ?? null,
                    originalUrl: objectsUrl ?? ((att?.originalUrl as string | null) ?? null),
                    objectPath,
                    downloadUrl:
                        (att?.downloadUrl as string | null) ??
                        (objectPath ? `/objects/${objectPath}?download=1&filename=${encodeURIComponent(filename)}` : null),
                    previewThumbnailUrl,
                    createdAt: att?.createdAt ?? null,
                    source: 'order' as const,
                };
            });

            // 2) Line-item assets linked via asset_links (PHASE 2 pipeline)
            const lineItemRows = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            const lineItemIds = lineItemRows.map((r) => r.id).filter(Boolean) as string[];

            let lineItemAssetItems: any[] = [];
            if (lineItemIds.length) {
                const linkRows = await db
                    .select({
                        lineItemId: assetLinks.parentId,
                        assetId: assetLinks.assetId,
                        role: assetLinks.role,
                        createdAt: assetLinks.createdAt,
                    })
                    .from(assetLinks)
                    .where(
                        and(
                            eq(assetLinks.organizationId, organizationId),
                            eq(assetLinks.parentType, 'order_line_item'),
                            inArray(assetLinks.parentId, lineItemIds)
                        )
                    )
                    .orderBy(desc(assetLinks.createdAt));

                const assetIds = Array.from(new Set(linkRows.map((r) => r.assetId).filter(Boolean) as string[]));

                if (assetIds.length) {
                    const [assetRows, variantRows] = await Promise.all([
                        db
                            .select()
                            .from(assets)
                            .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds))),
                        db
                            .select()
                            .from(assetVariants)
                            .where(and(eq(assetVariants.organizationId, organizationId), inArray(assetVariants.assetId, assetIds))),
                    ]);

                    const variantsByAssetId = new Map<string, any[]>();
                    for (const v of variantRows as any[]) {
                        const key = String(v.assetId);
                        const list = variantsByAssetId.get(key) ?? [];
                        list.push(v);
                        variantsByAssetId.set(key, list);
                    }

                    const assetsById = new Map<string, any>();
                    for (const a of assetRows as any[]) {
                        assetsById.set(String(a.id), {
                            ...a,
                            variants: variantsByAssetId.get(String(a.id)) ?? [],
                        });
                    }

                    const { enrichAssetWithUrls } = await import('../services/assets/enrichAssetWithUrls');

                    lineItemAssetItems = (linkRows as any[])
                        .map((link) => {
                            const asset = assetsById.get(String(link.assetId));
                            if (!asset) return null;
                            const enriched = enrichAssetWithUrls(asset);
                            const filename = String((enriched as any).fileName ?? 'Artwork');
                            const previewThumbnailUrl =
                                (enriched as any).previewThumbnailUrl ??
                                (enriched as any).thumbnailUrl ??
                                (enriched as any).thumbUrl ??
                                null;

                            return {
                                id: String(link.assetId),
                                filename,
                                mimeType: (enriched as any).mimeType ?? (asset as any)?.mimeType ?? null,
                                fileSize: (enriched as any).fileSize ?? (asset as any)?.fileSize ?? null,
                                objectPath: typeof (asset as any)?.fileKey === 'string' ? String((asset as any).fileKey) : null,
                                originalUrl:
                                    typeof (asset as any)?.fileKey === 'string'
                                        ? `/objects/${String((asset as any).fileKey)}?filename=${encodeURIComponent(filename)}`
                                        : ((enriched as any).originalUrl ?? (enriched as any).fileUrl ?? null),
                                downloadUrl:
                                    typeof (asset as any)?.fileKey === 'string'
                                        ? `/objects/${String((asset as any).fileKey)}?download=1&filename=${encodeURIComponent(filename)}`
                                        : null,
                                previewThumbnailUrl,
                                createdAt: link.createdAt ?? (enriched as any).createdAt ?? null,
                                source: 'line_item' as const,
                                parentLineItemId: String(link.lineItemId),
                                role: String(link.role ?? 'other'),
                            };
                        })
                        .filter(Boolean);
                }
            }

            const allItems = [...attachmentItems, ...lineItemAssetItems]
                .sort((a, b) => {
                    const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bt - at;
                });

            return res.json({ success: true, data: allItems });
        } catch (error) {
            console.error('[OrderAttachmentsUnified:GET] Error:', error);
            return res.status(500).json({ error: 'Failed to fetch attachments' });
        }
    });

    // Batched per-line-item preview thumbnails for Order Detail line-item headers
    // Contract: { success: true, data: { [lineItemId]: { thumbUrls: string[] (<=3), thumbCount: number } } }
    app.get('/api/orders/:orderId/line-item-previews', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const [orderRow] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!orderRow) return res.status(404).json({ error: 'Order not found' });

            // 1) Fetch line item ids (batched)
            const lineItemRows = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.orderId, orderId), eq(orders.organizationId, organizationId)));

            const lineItemIds = lineItemRows.map((r) => r.id).filter(Boolean) as string[];

            if (!lineItemIds.length) {
                return res.json({ success: true, data: {} });
            }

            // Seed output map so callers can safely access missing line items
            const out: Record<string, { thumbUrls: string[]; thumbCount: number }> = {};
            for (const id of lineItemIds) out[String(id)] = { thumbUrls: [], thumbCount: 0 };

            // 2) Fetch all asset links for these line items (batched)
            const linkRows = await db
                .select({
                    lineItemId: assetLinks.parentId,
                    assetId: assetLinks.assetId,
                    createdAt: assetLinks.createdAt,
                })
                .from(assetLinks)
                .where(
                    and(
                        eq(assetLinks.organizationId, organizationId),
                        eq(assetLinks.parentType, 'order_line_item'),
                        inArray(assetLinks.parentId, lineItemIds)
                    )
                )
                .orderBy(desc(assetLinks.createdAt));

            const assetIds = Array.from(new Set(linkRows.map((r) => r.assetId).filter(Boolean) as string[]));
            if (!assetIds.length) {
                return res.json({ success: true, data: out });
            }

            // 3) Fetch assets + variants (batched)
            const [assetRows, variantRows] = await Promise.all([
                db
                    .select()
                    .from(assets)
                    .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds))),
                db
                    .select()
                    .from(assetVariants)
                    .where(and(eq(assetVariants.organizationId, organizationId), inArray(assetVariants.assetId, assetIds))),
            ]);

            const variantsByAssetId = new Map<string, any[]>();
            for (const v of variantRows as any[]) {
                const key = String(v.assetId);
                const list = variantsByAssetId.get(key) ?? [];
                list.push(v);
                variantsByAssetId.set(key, list);
            }

            const assetsById = new Map<string, any>();
            for (const a of assetRows as any[]) {
                assetsById.set(String(a.id), { ...a, variants: variantsByAssetId.get(String(a.id)) ?? [] });
            }

            // 4) Enrich URLs for thumb resolution (same helper used elsewhere)
            const { enrichAssetWithUrls } = await import('../services/assets/enrichAssetWithUrls');

            // 5) Aggregate per lineItemId
            const assetIdsByLineItem = new Map<string, Set<string>>();
            const seenUrlsByLineItem = new Map<string, Set<string>>();

            for (const link of linkRows as any[]) {
                const lineItemId = String(link.lineItemId);
                const assetId = String(link.assetId);
                if (!lineItemId || !assetId) continue;

                const set = assetIdsByLineItem.get(lineItemId) ?? new Set<string>();
                set.add(assetId);
                assetIdsByLineItem.set(lineItemId, set);

                // Only collect up to 3 urls per line item
                const current = out[lineItemId];
                if (!current) continue;
                if (current.thumbUrls.length >= 3) continue;

                const raw = assetsById.get(assetId);
                if (!raw) continue;
                const enriched = enrichAssetWithUrls(raw);

                // Use the same priority as client getThumbSrc (previewThumbnailUrl, thumbnailUrl, thumbUrl, previewUrl, pages[0].thumbUrl)
                const url =
                    (enriched as any).previewThumbnailUrl ??
                    (enriched as any).thumbnailUrl ??
                    (enriched as any).thumbUrl ??
                    (enriched as any).previewUrl ??
                    (enriched as any).pages?.[0]?.thumbUrl ??
                    null;

                if (typeof url !== 'string' || !url.length) continue;

                const seen = seenUrlsByLineItem.get(lineItemId) ?? new Set<string>();
                if (seen.has(url)) continue;
                seen.add(url);
                seenUrlsByLineItem.set(lineItemId, seen);

                current.thumbUrls.push(url);
            }

            assetIdsByLineItem.forEach((set, lineItemId) => {
                if (!out[lineItemId]) out[lineItemId] = { thumbUrls: [], thumbCount: 0 };
                out[lineItemId].thumbCount = set.size;
            });

            return res.json({ success: true, data: out });
        } catch (error) {
            console.error('[OrderLineItemPreviews:GET] Error:', error);
            return res.status(500).json({ error: 'Failed to fetch line item previews' });
        }
    });

    app.post("/api/orders/:orderId/attachments", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { uploadId, files, description, fileName, fileUrl, fileSize, mimeType, requestedStorageTarget, storageTarget } = req.body;
            const requestedTarget =
                (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
                (typeof storageTarget === 'string' ? storageTarget : null);
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ error: "Order not found" });

            if (uploadId) {
                const { loadUploadSessionMeta, saveUploadSessionMeta, deleteUploadSession } = await import('../services/chunkedUploads');
                const meta = await loadUploadSessionMeta(uploadId);
                if (meta.organizationId !== organizationId) return res.status(404).json({ error: 'Upload not found' });
                if (!meta.relativePath) return res.status(400).json({ error: 'Upload not finalized' });

                const { decideStorageTarget } = await import('../services/storageTarget');
                const decidedTarget = decideStorageTarget({
                    fileName: meta.originalFilename,
                    fileSizeBytes: meta.sizeBytes || 0,
                    requestedTarget,
                    organizationId,
                    context: 'POST /api/orders/:orderId/attachments (uploadId)',
                });

                let fileKey = meta.relativePath!;
                let storageProvider: 'local' | 'supabase' | undefined = 'local';
                if (decidedTarget === 'supabase' && isSupabaseConfigured() && meta.relativePath) {
                    const { SupabaseStorageService } = await import('../supabaseStorage');
                    const { getAbsolutePath, deleteFile: deleteLocalFile } = await import('../utils/fileStorage.js');
                    const fsPromises = await import('fs/promises');

                    const abs = getAbsolutePath(meta.relativePath);
                    const buffer = await fsPromises.readFile(abs);

                    const supabase = new SupabaseStorageService();
                    const uploaded = await supabase.uploadFile(meta.relativePath, buffer, meta.mimeType || 'application/octet-stream');
                    fileKey = normalizeObjectKeyForDb(uploaded.path);
                    storageProvider = 'supabase';

                    await deleteLocalFile(meta.relativePath).catch(() => false);
                }

                const [created] = await db.insert(orderAttachments).values({
                    orderId,
                    quoteId: order.quoteId || null,
                    uploadedByUserId: userId,
                    uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    description: description || null,
                    fileName: meta.originalFilename,
                    fileUrl: fileKey,
                    fileSize: meta.sizeBytes,
                    mimeType: meta.mimeType,
                    originalFilename: meta.originalFilename,
                    relativePath: fileKey,
                    storageProvider,
                    sizeBytes: meta.sizeBytes,
                }).returning();
                await deleteUploadSession(uploadId);
                const enriched = await enrichAttachmentWithUrls(created);
                return res.json({ success: true, data: [enriched] });
            }

            if (Array.isArray(files) && files.length > 0) {
                const { processUploadedFile, generateStoredFilename, generateRelativePath, computeChecksum, getFileExtension } = await import('../utils/fileStorage.js');
                const { decideStorageTarget } = await import('../services/storageTarget');
                const inserted = await db.transaction(async (tx) => {
                    const results = [];
                    for (const f of files) {
                        const buffer = Buffer.from(f.fileBufferBase64, 'base64');
                        const decidedTarget = decideStorageTarget({
                            fileName: f.fileName,
                            fileSizeBytes: buffer.length,
                            requestedTarget,
                            organizationId,
                            context: 'POST /api/orders/:orderId/attachments (atomic)',
                        });

                        let storageProvider: 'local' | 'supabase' | undefined = 'local';
                        let fileKey: string;
                        let sizeBytes: number;
                        let checksum: string | null = null;
                        let extension: string | null = null;
                        let storedFilename: string | null = null;
                        let originalFilename: string;

                        if (decidedTarget === 'supabase' && isSupabaseConfigured()) {
                            const { SupabaseStorageService } = await import('../supabaseStorage');
                            storedFilename = generateStoredFilename(f.fileName);
                            const relativePath = generateRelativePath({
                                organizationId,
                                orderNumber: order?.orderNumber ? String(order.orderNumber) : undefined,
                                storedFilename,
                                resourceType: 'order',
                                resourceId: orderId,
                            });
                            checksum = computeChecksum(buffer);
                            extension = getFileExtension(f.fileName);
                            sizeBytes = buffer.length;

                            const supabase = new SupabaseStorageService();
                            const uploaded = await supabase.uploadFile(relativePath, buffer, f.mimeType || 'application/octet-stream');
                            fileKey = normalizeObjectKeyForDb(uploaded.path);
                            storageProvider = 'supabase';
                            originalFilename = f.fileName;
                        } else {
                            const fileMetadata = await processUploadedFile({
                                originalFilename: f.fileName,
                                buffer,
                                mimeType: f.mimeType,
                                organizationId,
                                resourceType: 'order',
                                resourceId: orderId,
                                orderNumber: order?.orderNumber ? String(order.orderNumber) : undefined,
                            });
                            fileKey = fileMetadata.relativePath;
                            sizeBytes = fileMetadata.sizeBytes;
                            checksum = fileMetadata.checksum || null;
                            extension = fileMetadata.extension || null;
                            storedFilename = fileMetadata.storedFilename || null;
                            originalFilename = fileMetadata.originalFilename;
                        }

                        const [created] = await tx.insert(orderAttachments).values({
                            orderId,
                            quoteId: order.quoteId || null,
                            uploadedByUserId: userId,
                            uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                            description: description || null,
                            fileName: f.fileName,
                            fileUrl: fileKey,
                            fileSize: sizeBytes,
                            mimeType: f.mimeType,
                            originalFilename,
                            storedFilename,
                            relativePath: fileKey,
                            storageProvider,
                            extension,
                            checksum,
                            sizeBytes,
                        }).returning();
                        results.push(created);
                    }
                    return results;
                });
                return res.json({ success: true, data: inserted });
            }

            if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });
            if (!fileName) return res.status(400).json({ error: "fileName is required" });

            const { decideStorageTarget } = await import('../services/storageTarget');
            const sizeForDecision = fileSize != null ? Number(fileSize) : 0;
            const decidedTarget = decideStorageTarget({
                fileName,
                fileSizeBytes: Number.isFinite(sizeForDecision) ? sizeForDecision : 0,
                requestedTarget,
                organizationId,
                context: 'POST /api/orders/:orderId/attachments (legacy)',
            });

            const isHttp = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'));
            const storageProvider: 'local' | 'supabase' | undefined = isHttp
                ? undefined
                : (decidedTarget === 'supabase' ? 'supabase' : 'local');
            const normalizedKey =
                storageProvider === 'supabase' && typeof fileUrl === 'string' && !isHttp
                    ? normalizeObjectKeyForDb(fileUrl)
                    : fileUrl;

            const [attachment] = await db.insert(orderAttachments).values({
                orderId,
                quoteId: order.quoteId || null,
                uploadedByUserId: userId,
                uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                fileName,
                originalFilename: fileName,
                fileUrl: normalizedKey,
                relativePath: storageProvider ? normalizedKey : null,
                fileSize: fileSize || null,
                mimeType: mimeType || null,
                description: description || null,
                storageProvider,
            }).returning();

            // PHASE 2: Create asset + link to order (fail-soft)
            try {
                const { assetRepository } = await import('../services/assets/AssetRepository');
                const { assetPreviewGenerator } = await import('../services/assets/AssetPreviewGenerator');
                const asset = await assetRepository.createAsset(organizationId, {
                    fileKey: normalizedKey,
                    fileName: fileName,
                    mimeType: mimeType || undefined,
                    sizeBytes: fileSize || undefined,
                });
                await assetRepository.linkAsset(organizationId, asset.id, 'order', orderId, 'attachment');
                console.log(`[OrderAttachments:POST] Created asset ${asset.id} + linked to order ${orderId}`);

                setImmediate(() => {
                    assetPreviewGenerator.generatePreviews(asset).catch((err) => {
                        console.error('[AssetPreviewGenerator] async generatePreviews failed', err);
                    });
                });
            } catch (assetError) {
                console.error(`[OrderAttachments:POST] Asset creation failed (non-blocking):`, assetError);
            }

            return res.json({ success: true, data: attachment });
        } catch (error) {
            console.error("[OrderAttachments:POST] Error:", error);
            return res.status(500).json({ error: "Failed to attach file to order" });
        }
    });

    app.delete("/api/orders/:orderId/attachments/:attachmentId", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId, attachmentId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            // Validate order belongs to tenant
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ error: "Order not found" });

            // Only delete order-level (non-line-item) attachments from this endpoint
            const [attachment] = await db
                .select()
                .from(orderAttachments)
                .where(
                    and(
                        eq(orderAttachments.id, attachmentId),
                        eq(orderAttachments.orderId, orderId),
                        isNull(orderAttachments.orderLineItemId)
                    )
                )
                .limit(1);

            if (!attachment) return res.status(404).json({ error: "Attachment not found" });

            // Remove DB link
            await db
                .delete(orderAttachments)
                .where(
                    and(
                        eq(orderAttachments.id, attachmentId),
                        eq(orderAttachments.orderId, orderId),
                        isNull(orderAttachments.orderLineItemId)
                    )
                );

            // Best-effort cleanup: delete storage objects only when safe
            // Safe means: no other attachment rows reference the same storage key, and no remaining Asset links reference that file.
            try {
                const storageKeyRaw = (attachment as any).fileUrl as string | null | undefined;
                const storageProviderRaw = (attachment as any).storageProvider as
                    | "local"
                    | "s3"
                    | "gcs"
                    | "supabase"
                    | null
                    | undefined;

                const storageKey = storageKeyRaw ? String(storageKeyRaw) : "";
                const storageProvider = storageProviderRaw ?? null;

                if (
                    storageKey &&
                    !storageKey.startsWith("http://") &&
                    !storageKey.startsWith("https://")
                ) {
                    if (!storageProvider) {
                        // No known storage provider -> nothing safe to delete
                    } else {
                        const storageProviderForQuery: "local" | "s3" | "gcs" | "supabase" = storageProvider;

                        const [{ orderRefs = 0 } = {}] = await db
                            .select({ orderRefs: sql<number>`count(*)` })
                            .from(orderAttachments)
                            .where(and(eq(orderAttachments.fileUrl, storageKey), eq(orderAttachments.storageProvider, storageProviderForQuery)));

                        const [{ quoteRefs = 0 } = {}] = await db
                            .select({ quoteRefs: sql<number>`count(*)` })
                            .from(quoteAttachments)
                            .where(
                                and(
                                    eq(quoteAttachments.organizationId, organizationId),
                                    eq(quoteAttachments.fileUrl, storageKey),
                                    eq(quoteAttachments.storageProvider, storageProviderForQuery)
                                )
                            );

                        const remainingAttachmentRefs = Number(orderRefs) + Number(quoteRefs);

                    // Asset cleanup (PHASE 2 pipeline): unlink matching assets from this order,
                    // and delete the asset+variants only if the asset is no longer linked anywhere.
                        let hasRemainingAssetLinksForFile = false;
                        const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

                        try {
                            const { assets, assetLinks, assetVariants } = await import("@shared/schema");

                        const matchingAssets = await db
                            .select({ id: assets.id, fileKey: assets.fileKey })
                            .from(assets)
                            .where(and(eq(assets.organizationId, organizationId), eq(assets.fileKey, normalizedFileKey)));

                        if (matchingAssets.length > 0) {
                            // Unlink all matching assets from this order
                            await Promise.all(
                                matchingAssets.map((a) =>
                                    db
                                        .delete(assetLinks)
                                        .where(
                                            and(
                                                eq(assetLinks.organizationId, organizationId),
                                                eq(assetLinks.assetId, a.id),
                                                eq(assetLinks.parentType, "order"),
                                                eq(assetLinks.parentId, orderId)
                                            )
                                        )
                                )
                            );

                            // Determine whether any of these assets remain linked elsewhere
                            const linkCounts = await Promise.all(
                                matchingAssets.map(async (a) => {
                                    const [{ cnt = 0 } = {}] = await db
                                        .select({ cnt: sql<number>`count(*)` })
                                        .from(assetLinks)
                                        .where(and(eq(assetLinks.organizationId, organizationId), eq(assetLinks.assetId, a.id)));
                                    return { assetId: a.id, count: Number(cnt) };
                                })
                            );

                            hasRemainingAssetLinksForFile = linkCounts.some((c) => c.count > 0);

                            // If assets are now unlinked everywhere AND no other attachment rows reference the file,
                            // delete asset variants objects + asset rows.
                            if (!hasRemainingAssetLinksForFile && remainingAttachmentRefs === 0) {
                                const { deleteFile: deleteLocalFile } = await import("../utils/fileStorage.js");

                                const deleteKeys = async (keys: string[]) => {
                                    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
                                    if (uniqueKeys.length === 0) return;

                                    if (storageProvider === "supabase" && isSupabaseConfigured()) {
                                        const supabase = new SupabaseStorageService();
                                        await Promise.all(uniqueKeys.map((k) => supabase.deleteFile(normalizeObjectKeyForDb(k)).catch(() => false)));
                                    } else if (storageProvider === "local") {
                                        await Promise.all(uniqueKeys.map((k) => deleteLocalFile(k).catch(() => false)));
                                    }
                                };

                                for (const a of matchingAssets) {
                                    const variants = await db
                                        .select({ key: assetVariants.key })
                                        .from(assetVariants)
                                        .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, a.id)));

                                    await deleteKeys([
                                        ...(variants.map((v) => v.key || "")),
                                        normalizedFileKey,
                                    ]);

                                    await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, a.id)));
                                }
                            }
                        }
                        } catch (assetCleanupError) {
                            // fail-soft: asset pipeline is optional and should not block attachment deletion
                            console.error("[OrderAttachments:DELETE] Asset cleanup failed (non-blocking):", assetCleanupError);
                        }

                    // If the file is still referenced anywhere, do not delete storage blobs.
                    // Also avoid deleting blobs if any asset still links to the file.
                        if (remainingAttachmentRefs === 0 && !hasRemainingAssetLinksForFile) {
                            const { deleteFile: deleteLocalFile } = await import("../utils/fileStorage.js");

                        const keysToDelete: string[] = [];
                        keysToDelete.push(storageKey);
                        const thumbKey = (attachment as any).thumbKey as string | null | undefined;
                        const previewKey = (attachment as any).previewKey as string | null | undefined;
                        if (thumbKey) keysToDelete.push(thumbKey);
                        if (previewKey) keysToDelete.push(previewKey);

                        const uniqueKeys = Array.from(new Set(keysToDelete.map((k) => String(k)).filter(Boolean)));

                            if (storageProviderForQuery === "supabase" && isSupabaseConfigured()) {
                                const supabase = new SupabaseStorageService();
                                await Promise.all(uniqueKeys.map((k) => supabase.deleteFile(normalizeObjectKeyForDb(k)).catch(() => false)));
                            } else if (storageProviderForQuery === "local") {
                                await Promise.all(uniqueKeys.map((k) => deleteLocalFile(k).catch(() => false)));
                            }
                        }
                    }
                }
            } catch (cleanupError) {
                console.error("[OrderAttachments:DELETE] Storage cleanup failed (non-blocking):", cleanupError);
            }

            return res.json({ success: true });
        } catch (error) {
            console.error("[OrderAttachments:DELETE] Error:", error);
            return res.status(500).json({ error: "Failed to delete order attachment" });
        }
    });

    // Inventory Management Routes
    app.get('/api/materials', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const list = await storage.getAllMaterials(organizationId);
            res.json({ success: true, data: list });
        } catch (err) {
            console.error('Error listing materials', err);
            res.status(500).json({ error: 'Failed to list materials' });
        }
    });

    app.get('/api/materials/csv-template', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const templateData = [
                {
                    'Material ID': '',
                    Name: '13oz Vinyl',
                    SKU: 'VINYL-13OZ',
                    Type: 'roll',
                    Category: 'Vinyl',
                    'Unit Of Measure': 'sqft',
                    Width: '54',
                    Height: '',
                    Thickness: '',
                    'Thickness Unit': 'mil',
                    Color: 'White',
                    'Cost Per Unit': '0.2500',
                    'Wholesale Base Rate': '',
                    'Wholesale Min Charge': '',
                    'Retail Base Rate': '',
                    'Retail Min Charge': '',
                    'Stock Quantity': '0',
                    'Min Stock Alert': '0',
                    'Is Active': 'true',
                    'Preferred Vendor ID': '',
                    'Vendor SKU': '',
                    'Vendor Cost Per Unit': '',
                    'Roll Length Ft': '150',
                    'Cost Per Roll': '225.00',
                    'Edge Waste In Per Side': '0',
                    'Lead Waste Ft': '0',
                    'Tail Waste Ft': '0',
                },
            ];
            const csv = Papa.unparse(templateData);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="material-import-template.csv"');
            res.send(csv);
        } catch (error) {
            console.error('Error generating material CSV template:', error);
            res.status(500).json({ error: 'Failed to generate CSV template' });
        }
    });

    app.get('/api/materials/export', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const list = await storage.getAllMaterials(organizationId);

            const exportData = (list || []).map((m: any) => ({
                'Material ID': m.id,
                Name: m.name || '',
                SKU: m.sku || '',
                Type: m.type || '',
                Category: m.category || '',
                'Unit Of Measure': m.unitOfMeasure || '',
                Width: m.width ?? '',
                Height: m.height ?? '',
                Thickness: m.thickness ?? '',
                'Thickness Unit': m.thicknessUnit ?? '',
                Color: m.color ?? '',
                'Cost Per Unit': m.costPerUnit ?? '',
                'Wholesale Base Rate': m.wholesaleBaseRate ?? '',
                'Wholesale Min Charge': m.wholesaleMinCharge ?? '',
                'Retail Base Rate': m.retailBaseRate ?? '',
                'Retail Min Charge': m.retailMinCharge ?? '',
                'Stock Quantity': m.stockQuantity ?? '',
                'Min Stock Alert': m.minStockAlert ?? '',
                'Is Active': m.isActive === false ? 'false' : 'true',
                'Preferred Vendor ID': m.preferredVendorId ?? '',
                'Vendor SKU': m.vendorSku ?? '',
                'Vendor Cost Per Unit': m.vendorCostPerUnit ?? '',
                'Roll Length Ft': m.rollLengthFt ?? '',
                'Cost Per Roll': m.costPerRoll ?? '',
                'Edge Waste In Per Side': m.edgeWasteInPerSide ?? '',
                'Lead Waste Ft': m.leadWasteFt ?? '',
                'Tail Waste Ft': m.tailWasteFt ?? '',
            }));

            const csv = Papa.unparse(exportData);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="materials.csv"');
            res.send(csv);
        } catch (error) {
            console.error('Error exporting materials:', error);
            res.status(500).json({ error: 'Failed to export materials' });
        }
    });

    app.post('/api/materials/import', isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

            const { csvData, dryRun } = req.body as { csvData?: unknown; dryRun?: unknown };
            if (!csvData || typeof csvData !== 'string') {
                return res.status(400).json({ error: 'CSV data is required' });
            }

            const parseResult = Papa.parse(csvData, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (header: string) => header.trim(),
            });

            if (parseResult.errors.length > 0) {
                return res.status(400).json({
                    error: 'CSV parsing failed',
                    errors: parseResult.errors.map((e) => e.message),
                });
            }

            const rows = parseResult.data as Record<string, string>[];
            if (rows.length === 0) {
                return res.status(400).json({ error: 'CSV must contain at least one data row' });
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

            let created = 0;
            let updated = 0;
            let skipped = 0;
            const rowErrors: Array<{ row: number; message: string }> = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const materialId = (row['Material ID'] || row['ID'] || '').trim();
                const name = (row['Name'] || '').trim();
                const sku = (row['SKU'] || '').trim();
                const type = (row['Type'] || '').trim();
                const unitOfMeasure = (row['Unit Of Measure'] || '').trim();

                if (!name || !sku || !type || !unitOfMeasure) {
                    skipped++;
                    continue;
                }

                const payload: any = {
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

                try {
                    if (materialId) {
                        const parsedUpdate = updateMaterialSchema.parse(payload);
                        if (!dryRun) {
                            await storage.updateMaterial(organizationId, materialId, parsedUpdate);
                        }
                        updated++;
                    } else {
                        const parsedCreate = insertMaterialSchema.parse(payload);
                        const { organizationId: _orgId, ...materialData } =
                            parsedCreate as typeof parsedCreate & { organizationId?: string };
                        if (!dryRun) {
                            await storage.createMaterial(organizationId, materialData);
                        }
                        created++;
                    }
                } catch (err: any) {
                    const message = err instanceof z.ZodError ? fromZodError(err).message : (err?.message || 'Unknown error');
                    rowErrors.push({ row: i + 2, message });
                }
            }

            res.json({
                message: dryRun ? 'Material import validated' : 'Materials imported successfully',
                imported: { created, updated, skipped },
                errors: rowErrors,
            });
        } catch (error) {
            console.error('Error importing materials:', error);
            res.status(500).json({ error: 'Failed to import materials' });
        }
    });

    app.get('/api/materials/low-stock', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const alerts = await storage.getMaterialLowStockAlerts(organizationId);
            res.json({ success: true, data: alerts });
        } catch (err) {
            console.error('Error getting low stock alerts', err);
            res.status(500).json({ error: 'Failed to get low stock alerts' });
        }
    });

    app.get('/api/materials/:id', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const material = await storage.getMaterialById(organizationId, req.params.id);
            if (!material) return res.status(404).json({ error: 'Material not found' });
            res.json({ success: true, data: material });
        } catch (err) {
            console.error('Error fetching material', err);
            res.status(500).json({ error: 'Failed to fetch material' });
        }
    });

    app.post('/api/materials', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const parsed = insertMaterialSchema.parse(req.body);
            const { organizationId: _orgId, ...materialData } =
                parsed as typeof parsed & { organizationId?: string };
            const created = await storage.createMaterial(organizationId, materialData);
            res.json({ success: true, data: created });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            res.status(500).json({ error: 'Failed to create material' });
        }
    });

    app.patch('/api/materials/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const parsed = updateMaterialSchema.parse(req.body);
            const { organizationId: _orgId, ...materialData } =
                parsed as typeof parsed & { organizationId?: string };
            const updated = await storage.updateMaterial(organizationId, req.params.id, materialData);
            res.json({ success: true, data: updated });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            res.status(500).json({ error: 'Failed to update material' });
        }
    });

    app.delete('/api/materials/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            await storage.deleteMaterial(organizationId, req.params.id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete material' });
        }
    });

    app.post('/api/materials/:id/adjust', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const material = await storage.getMaterialById(organizationId, req.params.id);
            if (!material) return res.status(404).json({ error: 'Material not found' });
            const parsed = insertInventoryAdjustmentSchema.parse({ ...req.body, materialId: req.params.id });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });
            const adjustment = await storage.adjustInventory(organizationId, parsed.materialId, parsed.type as any, parsed.quantityChange, userId, parsed.reason || undefined, parsed.orderId || undefined);
            res.json({ success: true, data: adjustment });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            res.status(500).json({ error: 'Failed to adjust inventory' });
        }
    });

    app.get('/api/materials/:id/adjustments', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const adjustments = await storage.getInventoryAdjustments(req.params.id);
            res.json({ success: true, data: adjustments });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch adjustments' });
        }
    });

    app.get('/api/materials/:id/usage', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const usage = await storage.getMaterialUsageByMaterial(req.params.id);
            res.json({ success: true, data: usage });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch material usage' });
        }
    });

    // Material usage subroutes for orders
    app.get('/api/orders/:id/material-usage', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const usage = await storage.getMaterialUsageByOrder(req.params.id);
            res.json({ success: true, data: usage });
        } catch (err) {
            console.error('Error fetching material usage', err);
            res.status(500).json({ error: 'Failed to fetch material usage' });
        }
    });

    app.post('/api/orders/:id/deduct-inventory', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });
            await storage.autoDeductInventoryWhenOrderMovesToProduction(organizationId, req.params.id, userId);
            const usage = await storage.getMaterialUsageByOrder(req.params.id);
            res.json({ success: true, data: usage });
        } catch (err) {
            console.error('Error deducting inventory manually', err);
            res.status(500).json({ error: 'Failed to deduct inventory' });
        }
    });

    app.delete("/api/orders/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            const order = await storage.getOrderById(organizationId, req.params.id);
            await storage.deleteOrder(organizationId, req.params.id);
            if (userId && order) {
                await storage.createAuditLog(organizationId, { userId, userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email, actionType: 'DELETE', entityType: 'order', entityId: req.params.id, entityName: order.orderNumber, description: `Deleted order ${order.orderNumber}` });
            }
            res.json({ message: "Order deleted successfully" });
        } catch (error) {
            console.error("Error deleting order:", error);
            res.status(500).json({ message: "Failed to delete order" });
        }
    });

    app.post("/api/quotes/:id/convert-to-order", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ success: false, message: "User not authenticated" });
            const { dueDate, promisedDate, priority, notesInternal } = req.body || {};
            const order = await storage.convertQuoteToOrder(organizationId, req.params.id, userId, { dueDate: dueDate ? new Date(dueDate) : undefined, promisedDate: promisedDate ? new Date(promisedDate) : undefined, priority: priority || "normal", notesInternal: notesInternal ?? undefined });
            res.status(201).json({ success: true, data: { order } });
        } catch (error: any) {
            console.error("[QUOTE TO ORDER CONVERSION] failed", error);
            res.status(error?.message?.includes('already converted') ? 409 : 500).json({ success: false, message: error?.message || "Failed to convert quote to order" });
        }
    });

    // Convert quote to order (LEGACY ENDPOINT - kept for backward compatibility)
    app.post("/api/orders/from-quote/:quoteId", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) {
                return res.status(401).json({ message: "User not authenticated" });
            }

            const { quoteId } = req.params;
            const { dueDate, promisedDate, priority, notesInternal, customerId, contactId } = req.body;
            const userRole = req.user.role || 'employee';

            console.log('[CONVERT QUOTE TO ORDER] Starting conversion:', {
                quoteId,
                userId,
                userRole,
                providedCustomerId: customerId,
                providedContactId: contactId,
                dueDate,
                promisedDate,
                priority,
            });

            // Get the quote to check its source and customerId
            const quote = await storage.getQuoteById(organizationId, quoteId);
            if (!quote) {
                console.error('[CONVERT QUOTE TO ORDER] Quote not found:', quoteId);
                return res.status(404).json({ message: "Quote not found" });
            }

            console.log('[CONVERT QUOTE TO ORDER] Quote details:', {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                quoteCustomerId: quote.customerId,
                quoteContactId: quote.contactId,
                quoteSource: quote.source,
                lineItemsCount: quote.lineItems?.length || 0,
            });

            let finalCustomerId: string;
            let finalContactId: string | null;

            // Handle customer quick quote differently
            if (quote.source === 'customer_quick_quote') {
                if (quote.customerId) {
                    finalCustomerId = quote.customerId;
                    finalContactId = null;
                } else if (userRole === 'customer' || !['owner', 'admin', 'manager', 'employee'].includes(userRole)) {
                    try {
                        finalCustomerId = await ensureCustomerForUser(userId);
                        finalContactId = null;
                    } catch (error) {
                        return res.status(400).json({
                            message: "Cannot convert quote to order: No customer account found. Please contact support to set up your customer account."
                        });
                    }
                } else {
                    finalCustomerId = customerId;
                    finalContactId = contactId || null;
                    if (!finalCustomerId) {
                        return res.status(400).json({ message: "Customer ID is required to convert this quote to an order" });
                    }
                }
            } else {
                finalCustomerId = customerId || quote.customerId;
                finalContactId = contactId || quote.contactId;

                if (!finalCustomerId) {
                    return res.status(400).json({
                        message: "This quote is missing a customer. Please edit the quote and select a customer before converting to an order."
                    });
                }
            }

            if (quote.customerId !== finalCustomerId || quote.contactId !== finalContactId) {
                await storage.updateQuote(organizationId, quoteId, {
                    customerId: finalCustomerId,
                    contactId: finalContactId,
                });
            }

            const order = await storage.convertQuoteToOrder(organizationId, quoteId, userId, {
                dueDate: dueDate || undefined,
                promisedDate: promisedDate || undefined,
                priority,
                notesInternal,
            });

            await storage.createAuditLog(organizationId, {
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: 'CREATE',
                entityType: 'order',
                entityId: order.id,
                entityName: order.orderNumber,
                description: `Created order ${order.orderNumber} from quote ${quote.quoteNumber}`,
                newValues: order,
            });

            res.json(order);
        } catch (error: any) {
            console.error("[CONVERT QUOTE TO ORDER] Error:", error);
            if (error?.message?.includes('already converted')) {
                return res.status(409).json({
                    message: error.message,
                    error: error.message
                });
            }
            res.status(500).json({ message: "Failed to convert quote to order", error: error.message });
        }
    });

    app.patch('/api/orders/:id/fulfillment-status', isAuthenticated, async (req: any, res) => {
        try {
            if (!['owner', 'admin', 'manager'].includes(req.user?.role)) {
                return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
            }
            const { status } = req.body;
            if (!['pending', 'packed', 'shipped', 'delivered'].includes(status)) {
                return res.status(400).json({ error: 'Invalid fulfillment status' });
            }
            await updateOrderFulfillmentStatus(req.params.id, status);
            res.json({ success: true, message: 'Fulfillment status updated successfully' });
        } catch (error) {
            console.error('Error updating fulfillment status:', error);
            res.status(500).json({ error: 'Failed to update fulfillment status' });
        }
    });

    // Customer portal: My Quotes (customer_quick_quote only)
    app.get('/api/portal/my-quotes', isAuthenticated, portalContext, async (req: any, res) => {
        try {
            const portalCustomer = getPortalCustomer(req);
            if (!portalCustomer) {
                return res.status(403).json({ error: 'No customer account linked to this user' });
            }
            const { organizationId, id: customerId } = portalCustomer;
            const quotes = await storage.getQuotesForCustomer(organizationId, customerId, { source: 'customer_quick_quote' });
            res.json({ success: true, data: quotes });
        } catch (error) {
            console.error('Error fetching portal quotes:', error);
            res.status(500).json({ error: 'Failed to fetch quotes' });
        }
    });

    // Customer portal: My Orders
    app.get('/api/portal/my-orders', isAuthenticated, portalContext, async (req: any, res) => {
        try {
            const portalCustomer = getPortalCustomer(req);
            if (!portalCustomer) {
                return res.status(403).json({ error: 'No customer account linked to this user' });
            }
            const { organizationId, id: customerId } = portalCustomer;
            const orders = await storage.getAllOrders(organizationId, { customerId });
            res.json({ success: true, data: orders });
        } catch (error) {
            console.error('Error fetching portal orders:', error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    // Customer portal: Convert quote
    app.post('/api/portal/convert-quote/:id', isAuthenticated, portalContext, async (req: any, res) => {
        try {
            const portalCustomer = getPortalCustomer(req);
            if (!portalCustomer) {
                return res.status(403).json({ error: 'No customer account linked to this user' });
            }
            const { organizationId, id: customerId } = portalCustomer;
            const quoteId = req.params.id;
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });

            const quote = await storage.getQuoteById(organizationId, quoteId, userId);
            if (!quote) return res.status(404).json({ error: 'Quote not found' });
            if (quote.customerId !== customerId) {
                return res.status(403).json({ error: 'Quote does not belong to this customer' });
            }

            const existingState = await storage.getQuoteWorkflowState(quoteId);
            if (!existingState || existingState.status !== 'customer_approved') {
                await storage.updateQuoteWorkflowState(quoteId, { status: 'customer_approved', approvedByCustomerUserId: userId, customerNotes: req.body?.customerNotes || null });
            }
            const order = await storage.convertQuoteToOrder(organizationId, quoteId, userId, {
                priority: req.body?.priority,
                dueDate: req.body?.dueDate || undefined,
                promisedDate: req.body?.promisedDate || undefined,
                notesInternal: req.body?.internalNotes,
            });
            await storage.createOrderAuditLog({
                orderId: order.id,
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: 'converted_by_customer',
                fromStatus: 'pending_customer_approval',
                toStatus: 'new',
                note: req.body?.note || null,
                metadata: null,
            });
            res.json({ success: true, data: order });
        } catch (error: any) {
            console.error('Error converting quote (portal):', error);
            if (error?.message?.includes('already converted')) {
                return res.status(409).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to convert quote' });
        }
    });

    // Order-specific Audit & Files
    app.get('/api/orders/:id/audit', isAuthenticated, async (req: any, res) => {
        try {
            const auditEntries = await storage.getOrderAuditLog(req.params.id);
            res.json({ success: true, data: auditEntries });
        } catch (error) {
            console.error('Error fetching order audit:', error);
            res.status(500).json({ error: 'Failed to fetch audit trail' });
        }
    });

    app.post('/api/orders/:id/audit', isAuthenticated, async (req: any, res) => {
        try {
            const userId = getUserId(req.user);
            const { actionType, fromStatus, toStatus, note, metadata } = req.body;
            const entry = await storage.createOrderAuditLog({
                orderId: req.params.id,
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: actionType || 'note_added',
                fromStatus: fromStatus || null,
                toStatus: toStatus || null,
                note: note || null,
                metadata: metadata || null,
            });
            res.json({ success: true, data: entry });
        } catch (error) {
            console.error('Error adding audit entry:', error);
            res.status(500).json({ error: 'Failed to add audit entry' });
        }
    });

    app.get('/api/orders/:id/files', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            const files = await storage.listOrderFiles(req.params.id);
            const logOnce = createRequestLogOnce();
            const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

            // PHASE 2: Include linked assets for order-level attachments
            let enrichedAssets: any[] = [];
            if (organizationId) {
                try {
                    const { assetRepository } = await import('../services/assets/AssetRepository');
                    const { enrichAssetsWithRoles } = await import('../services/assets/enrichAssetWithUrls');
                    const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'order', req.params.id);
                    enrichedAssets = enrichAssetsWithRoles(linkedAssets);
                } catch (assetError) {
                    console.error('[OrderFiles:GET] Asset enrichment failed:', assetError);
                }
            }

            res.json({ success: true, data: enrichedFiles, assets: enrichedAssets });
        } catch (error) {
            console.error('Error fetching order files:', error);
            res.status(500).json({ error: 'Failed to fetch files' });
        }
    });

    // Unlink an asset from an order (removes the asset_link row; does NOT delete the asset)
    app.delete('/api/orders/:orderId/assets/:assetId', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const { orderId, assetId } = req.params;

            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order) return res.status(404).json({ error: 'Order not found' });

            const deleted = await db
                .delete(assetLinks)
                .where(
                    and(
                        eq(assetLinks.organizationId, organizationId),
                        eq(assetLinks.parentType, 'order'),
                        eq(assetLinks.parentId, orderId),
                        eq(assetLinks.assetId, assetId)
                    )
                )
                .returning();

            if (!deleted.length) return res.status(404).json({ error: 'Asset link not found' });
            return res.json({ success: true });
        } catch (error) {
            console.error('[OrderAssets:DELETE] Error:', error);
            return res.status(500).json({ error: 'Failed to unlink asset' });
        }
    });

    // Unlink an asset from an order line item (removes the asset_link row; does NOT delete the asset)
    app.delete('/api/orders/:orderId/line-items/:lineItemId/assets/:assetId', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const { orderId, lineItemId, assetId } = req.params;

            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order) return res.status(404).json({ error: 'Order not found' });

            const [li] = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
                .limit(1);

            if (!li) return res.status(404).json({ error: 'Line item not found' });

            const deleted = await db
                .delete(assetLinks)
                .where(
                    and(
                        eq(assetLinks.organizationId, organizationId),
                        eq(assetLinks.parentType, 'order_line_item'),
                        eq(assetLinks.parentId, lineItemId),
                        eq(assetLinks.assetId, assetId)
                    )
                )
                .returning();

            if (!deleted.length) return res.status(404).json({ error: 'Asset link not found' });
            return res.json({ success: true });
        } catch (error) {
            console.error('[OrderLineItemAssets:DELETE] Error:', error);
            return res.status(500).json({ error: 'Failed to unlink asset' });
        }
    });

    app.post('/api/orders/:id/files', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);

            const {
                fileName,
                fileUrl,
                fileSize,
                mimeType,
                description,
                quoteId,
                orderLineItemId,
                role,
                side,
                isPrimary,
                thumbnailUrl,
                fileBuffer,
                originalFilename,
                orderNumber,
                requestedStorageTarget,
                storageTarget
            } = req.body;

            const requestedTarget =
                (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
                (typeof storageTarget === 'string' ? storageTarget : null);

            if (!fileName && !originalFilename) {
                return res.status(400).json({ error: 'fileName or originalFilename is required' });
            }

            const validRoles = ['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other'];
            const validSides = ['front', 'back', 'na'];

            if (role && !validRoles.includes(role)) {
                return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
            }

            if (side && !validSides.includes(side)) {
                return res.status(400).json({ error: `Invalid side. Must be one of: ${validSides.join(', ')}` });
            }

            let attachmentData: any = {
                orderId: req.params.id,
                orderLineItemId: orderLineItemId || null,
                quoteId: quoteId || null,
                uploadedByUserId: userId,
                uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                description: description || null,
                role: (role || 'other') as FileRole,
                side: (side || 'na') as FileSide,
                isPrimary: isPrimary || false,
            };

            if (fileBuffer && originalFilename) {
                const { decideStorageTarget } = await import('../services/storageTarget');
                const { processUploadedFile, generateStoredFilename, generateRelativePath, computeChecksum, getFileExtension } = await import('../utils/fileStorage.js');
                const buffer = Buffer.from(fileBuffer, 'base64');

                const decidedTarget = decideStorageTarget({
                    fileName: originalFilename,
                    fileSizeBytes: buffer.length,
                    requestedTarget,
                    organizationId,
                    context: 'POST /api/orders/:id/files (atomic)',
                });

                if (decidedTarget === 'supabase' && isSupabaseConfigured()) {
                    const { SupabaseStorageService } = await import('../supabaseStorage');
                    const storedFilename = generateStoredFilename(originalFilename);
                    const relativePath = generateRelativePath({
                        organizationId,
                        orderNumber: orderNumber ? String(orderNumber) : undefined,
                        lineItemId: orderLineItemId ? String(orderLineItemId) : undefined,
                        storedFilename,
                        resourceType: 'order',
                        resourceId: req.params.id,
                    });
                    const checksum = computeChecksum(buffer);
                    const extension = getFileExtension(originalFilename);
                    const sizeBytes = buffer.length;

                    const supabase = new SupabaseStorageService();
                    const uploaded = await supabase.uploadFile(relativePath, buffer, mimeType || 'application/octet-stream');
                    const fileKey = normalizeObjectKeyForDb(uploaded.path);

                    attachmentData = {
                        ...attachmentData,
                        fileName: originalFilename,
                        fileUrl: fileKey,
                        fileSize: sizeBytes,
                        mimeType: mimeType || 'application/octet-stream',
                        thumbnailUrl: thumbnailUrl || null,
                        originalFilename,
                        storedFilename,
                        relativePath: fileKey,
                        storageProvider: 'supabase',
                        extension,
                        sizeBytes,
                        checksum,
                    };
                } else {
                    const fileMetadata = await processUploadedFile({
                        originalFilename,
                        buffer,
                        mimeType: mimeType || 'application/octet-stream',
                        organizationId,
                        orderNumber,
                        lineItemId: orderLineItemId,
                    });

                    attachmentData = {
                        ...attachmentData,
                        fileName: originalFilename,
                        fileUrl: fileMetadata.relativePath,
                        fileSize: fileMetadata.sizeBytes,
                        mimeType: mimeType || 'application/octet-stream',
                        thumbnailUrl: thumbnailUrl || null,
                        originalFilename: fileMetadata.originalFilename,
                        storedFilename: fileMetadata.storedFilename,
                        relativePath: fileMetadata.relativePath,
                        storageProvider: 'local',
                        extension: fileMetadata.extension,
                        sizeBytes: fileMetadata.sizeBytes,
                        checksum: fileMetadata.checksum,
                    };
                }
            }
            else {
                if (!fileUrl) {
                    return res.status(400).json({ error: 'fileUrl is required for legacy uploads' });
                }
                const resolvedFileName = (fileName || originalFilename) as string;
                const bucketName = 'titan-private';

                const { decideStorageTarget } = await import('../services/storageTarget');
                const sizeForDecision = fileSize != null ? Number(fileSize) : 0;
                const decidedTarget = decideStorageTarget({
                    fileName: resolvedFileName,
                    fileSizeBytes: Number.isFinite(sizeForDecision) ? sizeForDecision : 0,
                    requestedTarget,
                    organizationId,
                    context: 'POST /api/orders/:id/files (legacy)',
                });

                const isHttp = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'));

                let storageProvider: 'local' | 'supabase' | undefined;
                if (isHttp) {
                    storageProvider = undefined;
                } else {
                    storageProvider = decidedTarget === 'supabase' ? 'supabase' : 'local';
                }

                const normalizedKey =
                    storageProvider === 'supabase' && typeof fileUrl === 'string' && !isHttp
                        ? normalizeObjectKeyForDb(fileUrl)
                        : fileUrl;

                attachmentData = {
                    ...attachmentData,
                    fileName: resolvedFileName,
                    fileUrl: normalizedKey,
                    relativePath: storageProvider ? normalizedKey : null,
                    fileSize: fileSize || null,
                    mimeType: mimeType || null,
                    thumbnailUrl: storageProvider ? null : (thumbnailUrl || null),
                    storageProvider,
                    bucket: bucketName,
                };
            }

            const [attachment] = await db.insert(orderAttachments).values(attachmentData).returning();

            await storage.createOrderAuditLog({
                orderId: req.params.id,
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: 'file_uploaded',
                fromStatus: null,
                toStatus: null,
                note: `File attached: ${originalFilename || fileName} (${role || 'other'})`,
                metadata: { fileId: attachment.id, fileName: originalFilename || fileName, role, side } as any,
            });

            res.json({ success: true, data: attachment });
        } catch (error) {
            console.error('Error attaching file to order:', error);
            res.status(500).json({ error: 'Failed to attach file to order' });
        }
    });

    app.patch('/api/orders/:orderId/files/:fileId', isAuthenticated, async (req: any, res) => {
        try {
            const userId = getUserId(req.user);
            const { role, side, isPrimary, description } = req.body;
            const validRoles = ['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other'];
            const validSides = ['front', 'back', 'na'];

            if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
            if (side && !validSides.includes(side)) return res.status(400).json({ error: 'Invalid side' });

            const updates: any = {};
            if (role !== undefined) updates.role = role;
            if (side !== undefined) updates.side = side;
            if (isPrimary !== undefined) updates.isPrimary = isPrimary;
            if (description !== undefined) updates.description = description;

            const updated = await storage.updateOrderFileMeta(req.params.fileId, updates);
            await storage.createOrderAuditLog({
                orderId: req.params.orderId,
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                actionType: 'file_updated',
                fromStatus: null,
                toStatus: null,
                note: `File metadata updated: ${updated.fileName}`,
                metadata: { fileId: updated.id, updates } as any,
            });
            res.json({ success: true, data: updated });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update file metadata' });
        }
    });

    app.delete('/api/orders/:orderId/files/:fileId', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const [order] = await db.select({ id: orders.id }).from(orders)
                .where(and(eq(orders.id, req.params.orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order) return res.status(404).json({ error: 'Order not found' });

            const userId = getUserId(req.user);
            const files = await storage.getOrderAttachments(req.params.orderId);
            const file = files.find(f => f.id === req.params.fileId);

            if (!file) {
                return res.status(404).json({ error: 'File not found' });
            }

            const deleted = await storage.detachOrderFile(req.params.fileId);
            if (!deleted) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Best-effort cleanup of stored objects
            try {
                const keys = [
                    file.relativePath,
                    file.fileUrl,
                    file.thumbnailRelativePath,
                    (file as any).thumbKey,
                    (file as any).previewKey,
                ].filter((k): k is string => typeof k === 'string' && k.length > 0);

                if (file.storageProvider === 'supabase' && isSupabaseConfigured()) {
                    const supabase = new SupabaseStorageService();
                    await Promise.all(keys.map((k) => supabase.deleteFile(normalizeObjectKeyForDb(k)).catch(() => false)));
                } else {
                    const { deleteFile: deleteLocalFile } = await import('../utils/fileStorage');
                    await Promise.all(keys.map((k) => deleteLocalFile(k).catch(() => false)));
                }
            } catch {
                // ignore
            }

            if (file) {
                await storage.createOrderAuditLog({
                    orderId: req.params.orderId,
                    userId,
                    userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    actionType: 'file_deleted',
                    fromStatus: null,
                    toStatus: null,
                    note: `File removed: ${file.fileName}`,
                    metadata: { fileId: file.id, fileName: file.fileName } as any,
                });
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete file' });
        }
    });

    app.get('/api/orders/:id/artwork-summary', isAuthenticated, async (req: any, res) => {
        try {
            const summary = await storage.getOrderArtworkSummary(req.params.id);
            res.json({ success: true, data: summary });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch artwork summary' });
        }
    });

    // Order Line Items routes
    app.get("/api/orders/:orderId/line-items", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);
            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!order) return res.status(404).json({ message: "Order not found" });

            const lineItems = await storage.getOrderLineItems(orderId);

            // Enrich with product PBV2 active tree version id for staleness detection.
            const productIds = Array.from(new Set(lineItems.map((li: any) => String((li as any).productId || '')).filter(Boolean)));
            const productTreeById = new Map<string, string | null>();
            if (productIds.length > 0) {
                const rows = await db
                    .select({ id: products.id, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
                    .from(products)
                    .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds as any)));
                for (const r of rows) productTreeById.set(String(r.id), (r as any).pbv2ActiveTreeVersionId ? String((r as any).pbv2ActiveTreeVersionId) : null);
            }

            const components = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderId, orderId),
                    eq(orderLineItemComponents.status, 'ACCEPTED')
                ));

            const byLineItemId = new Map<string, any[]>();
            for (const c of components) {
                const key = String((c as any).orderLineItemId);
                const arr = byLineItemId.get(key);
                if (arr) arr.push(c as any);
                else byLineItemId.set(key, [c as any]);
            }

            res.json(lineItems.map((li: any) => ({
                ...li,
                pbv2ActiveTreeVersionId: productTreeById.get(String((li as any).productId || '')) ?? null,
                components: byLineItemId.get(String(li.id)) ?? [],
            })));
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch order line items" });
        }
    });

    app.get("/api/order-line-items/:id", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const lineItemId = String(req.params.id);
            const [li] = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const lineItem = await storage.getOrderLineItemById(lineItemId);
            if (!lineItem) return res.status(404).json({ message: "Order line item not found" });

            const [productRow] = await db
                .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
                .from(products)
                .where(and(eq(products.organizationId, organizationId), eq(products.id, String((lineItem as any).productId))))
                .limit(1);

            const components = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderLineItemId, lineItemId),
                    eq(orderLineItemComponents.status, 'ACCEPTED')
                ));

            res.json({ ...(lineItem as any), pbv2ActiveTreeVersionId: productRow?.pbv2ActiveTreeVersionId ? String(productRow.pbv2ActiveTreeVersionId) : null, components });
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch order line item" });
        }
    });

    app.post("/api/order-line-items", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const parsed = insertOrderLineItemSchema.parse(req.body);
            
            // Server-authoritative: ignore any client-supplied pbv2 or price fields
            const { 
                pbv2ExplicitSelections, 
                pbv2Env, 
                pbv2TreeVersionId: _ignoredTreeVersionId,
                pbv2SnapshotJson: _ignoredSnapshot,
                pricedAt: _ignoredPricedAt,
                unitPrice: _ignoredUnitPrice,
                totalPrice: _ignoredTotalPrice,
                ...lineItemData 
            } = parsed as any;

            // Log warning if client tried to send forbidden fields
            if (_ignoredTreeVersionId || _ignoredSnapshot || _ignoredPricedAt || _ignoredUnitPrice || _ignoredTotalPrice) {
                console.warn('[ORDER_LINE_ITEM_CREATE] Client attempted to send forbidden pricing fields (ignored):', {
                    hadTreeVersionId: !!_ignoredTreeVersionId,
                    hadSnapshot: !!_ignoredSnapshot,
                    hadPricedAt: !!_ignoredPricedAt,
                    hadUnitPrice: !!_ignoredUnitPrice,
                    hadTotalPrice: !!_ignoredTotalPrice,
                });
            }

            const [order] = await db
                .select({ id: orders.id, customerId: orders.customerId })
                .from(orders)
                .where(and(eq(orders.id, String(lineItemData.orderId)), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!order) return res.status(404).json({ message: "Order not found" });

            // Server-authoritative pricing using PricingService
            const { priceLineItem } = await import("../services/pricing/PricingService");
            
            const pricingResult = await priceLineItem({
                organizationId,
                productId: lineItemData.productId,
                quantity: Number(lineItemData.quantity),
                widthIn: lineItemData.width ? Number(lineItemData.width) : undefined,
                heightIn: lineItemData.height ? Number(lineItemData.height) : undefined,
                pbv2ExplicitSelections: pbv2ExplicitSelections || {},
                pbv2TreeVersionIdOverride: undefined, // Always use active tree
            });

            // Structured logging for PBV2 pricing persistence
            console.log(`[PBV2_PRICE_PERSIST] orderId=${lineItemData.orderId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

            // Create line item with server-computed pricing
            const created = await storage.createOrderLineItem({
                ...lineItemData,
                pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
                pbv2SnapshotJson: pricingResult.pbv2SnapshotJson as any,
                pricedAt: new Date(),
                unitPrice: pricingResult.lineTotalCents / 100 / Number(lineItemData.quantity),
                totalPrice: pricingResult.lineTotalCents / 100,
            });

            res.json(created);
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            console.error('[ORDER_LINE_ITEM_CREATE] Error:', error);
            res.status(500).json({ message: "Failed to create order line item" });
        }
    });

    app.patch("/api/order-line-items/:id", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user);
            const parsed = updateOrderLineItemSchema.parse({ ...(req.body as any), id: req.params.id });
            const { pbv2ExplicitSelections, pbv2Env, ...lineItemData } = parsed as any;
            const { id, ...updateData } = lineItemData;

            void pbv2ExplicitSelections;
            void pbv2Env;

            const lineItemId = String(req.params.id);
            const [ownership] = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!ownership) return res.status(404).json({ message: "Order line item not found" });

            const oldLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!oldLineItem) return res.status(404).json({ message: "Order line item not found" });

            // Server-authoritative: detect pricing-relevant changes
            const pricingFieldsChanged =
                updateData.productId !== undefined ||
                updateData.width !== undefined ||
                updateData.height !== undefined ||
                updateData.quantity !== undefined ||
                updateData.optionSelectionsJson !== undefined ||
                (pbv2ExplicitSelections !== undefined && pbv2ExplicitSelections !== null);

            if (pricingFieldsChanged) {
                // Reprice using PricingService
                const { priceLineItem } = await import("../services/pricing/PricingService");
                
                const pricingResult = await priceLineItem({
                    organizationId,
                    productId: updateData.productId ?? oldLineItem.productId,
                    quantity: updateData.quantity !== undefined ? Number(updateData.quantity) : oldLineItem.quantity,
                    widthIn: updateData.width !== undefined ? Number(updateData.width) : (oldLineItem.width ? Number(oldLineItem.width) : undefined),
                    heightIn: updateData.height !== undefined ? Number(updateData.height) : (oldLineItem.height ? Number(oldLineItem.height) : undefined),
                    pbv2ExplicitSelections: pbv2ExplicitSelections || (oldLineItem as any).optionSelectionsJson?.selected || {},
                    pbv2TreeVersionIdOverride: undefined, // Always reprice with active tree
                });

                // Structured logging for PBV2 repricing
                console.log(`[PBV2_PRICE_PERSIST] orderId=${oldLineItem.orderId} lineItemId=${lineItemId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

                // Set server-authoritative PBV2 fields
                updateData.pbv2TreeVersionId = pricingResult.pbv2TreeVersionId;
                updateData.pbv2SnapshotJson = pricingResult.pbv2SnapshotJson as any;
                updateData.pricedAt = new Date();
                updateData.unitPrice = pricingResult.lineTotalCents / 100 / Number(updateData.quantity ?? oldLineItem.quantity);
                updateData.totalPrice = pricingResult.lineTotalCents / 100;
            }

            const lineItem = await storage.updateOrderLineItem(lineItemId, updateData);

            // NOTE: PBV2 is recomputed explicitly via /pbv2/recompute.
            // Do not silently overwrite persisted snapshots/components during general edits.
            const finalLineItem = lineItem as any;

            if (oldLineItem && updateData.status !== undefined && oldLineItem.status !== updateData.status && userId) {
                const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
                await storage.createOrderAuditLog({
                    orderId: (finalLineItem ?? lineItem).orderId,
                    userId,
                    userName,
                    actionType: 'line_item_status_change',
                    fromStatus: null,
                    toStatus: null,
                    note: null,
                    metadata: { lineItemId: lineItem.id, oldStatus: oldLineItem.status, newStatus: updateData.status },
                });
            }

            // Structured timeline events (v1)
            if (oldLineItem && userId) {
                const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
                const nowIso = new Date().toISOString();

                const toNullableString = (v: any): string | null => {
                    if (v == null) return null;
                    const s = String(v);
                    const t = s.trim();
                    return t.length > 0 ? t : null;
                };

                const toMoneyCents = (v: any): number | null => {
                    const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
                    if (!Number.isFinite(n)) return null;
                    return Math.round(n * 100);
                };

                const specsOverrideEnabled = (li: any): boolean => {
                    const s = li?.specsJson;
                    if (!s || typeof s !== 'object') return false;
                    const po = (s as any).priceOverride;
                    if (!po || typeof po !== 'object') return false;
                    if (typeof (po as any).mode === 'string') return (po as any).mode === 'total' || (po as any).mode === 'unit';
                    return true;
                };

                const shortValue = (v: any): string | null => {
                    if (v == null) return null;
                    if (typeof v === 'boolean') return v ? 'true' : 'false';
                    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
                    if (typeof v === 'string') {
                        const t = v.replace(/\s+/g, ' ').trim();
                        if (!t) return null;
                        return t.length > 60 ? `${t.slice(0, 59)}…` : t;
                    }
                    try {
                        const t = JSON.stringify(v);
                        return t.length > 60 ? `${t.slice(0, 59)}…` : t;
                    } catch {
                        return null;
                    }
                };

                const displayLabel = toNullableString(((finalLineItem ?? lineItem) as any).description) || 'Line item';
                const diffs: Array<{ fieldKey: string; fromValue: any; toValue: any; metadata?: any }> = [];

                // Line item field whitelist
                {
                    const from = toNullableString((oldLineItem as any).description) ?? '';
                    const to = toNullableString(((finalLineItem ?? lineItem) as any).description) ?? '';
                    if (from !== to) diffs.push({ fieldKey: 'description', fromValue: from, toValue: to });
                }
                {
                    const from = Number((oldLineItem as any).quantity);
                    const to = Number((lineItem as any).quantity);
                    if (Number.isFinite(from) && Number.isFinite(to) && from !== to) diffs.push({ fieldKey: 'quantity', fromValue: from, toValue: to });
                }
                {
                    const from = toMoneyCents((oldLineItem as any).unitPrice);
                    const to = toMoneyCents((lineItem as any).unitPrice);
                    if (from != null && to != null && from !== to) diffs.push({ fieldKey: 'unitPriceCents', fromValue: from, toValue: to });
                }
                {
                    const from = toMoneyCents((oldLineItem as any).totalPrice);
                    const to = toMoneyCents((lineItem as any).totalPrice);
                    if (from != null && to != null && from !== to) diffs.push({ fieldKey: 'totalPriceCents', fromValue: from, toValue: to });
                }
                {
                    const from = toNullableString((oldLineItem as any).status);
                    const to = toNullableString((lineItem as any).status);
                    if (from !== to) diffs.push({ fieldKey: 'status', fromValue: from, toValue: to });
                }
                {
                    const from = specsOverrideEnabled(oldLineItem as any);
                    const to = specsOverrideEnabled(lineItem as any);
                    if (from !== to) diffs.push({ fieldKey: 'overrideEnabled', fromValue: from, toValue: to });
                }

                // Option summary diffs (v1): only selection value changes, skip auto-default applications.
                try {
                    const productIdBefore = String((oldLineItem as any).productId || '');
                    const productIdAfter = String((lineItem as any).productId || '');
                    if (productIdBefore && productIdBefore === productIdAfter) {
                        const [p] = await db.select({ optionsJson: products.optionsJson }).from(products).where(eq(products.id, productIdAfter)).limit(1);
                        const optionDefs = Array.isArray((p as any)?.optionsJson) ? ((p as any).optionsJson as any[]) : [];
                        const defaultsById = new Map<string, any>();
                        const labelById = new Map<string, string>();
                        for (const o of optionDefs) {
                            const oid = typeof o?.id === 'string' ? o.id : '';
                            if (!oid) continue;
                            if (o?.defaultValue != null) defaultsById.set(oid, o.defaultValue);
                            const lbl = typeof o?.label === 'string' ? o.label : (typeof o?.name === 'string' ? o.name : '');
                            if (lbl) labelById.set(oid, lbl);
                        }

                        const normalizeOptVal = (v: any): string | number | boolean | null => {
                            if (v == null) return null;
                            if (typeof v === 'boolean') return v;
                            if (typeof v === 'number') return Number.isFinite(v) ? v : null;
                            if (typeof v === 'string') {
                                const t = v.trim();
                                return t.length > 0 ? t : null;
                            }
                            return null;
                        };

                        const beforeArr = Array.isArray((oldLineItem as any).selectedOptions) ? ((oldLineItem as any).selectedOptions as any[]) : [];
                        const afterArr = Array.isArray((lineItem as any).selectedOptions) ? ((lineItem as any).selectedOptions as any[]) : [];
                        const beforeById = new Map<string, any>();
                        const afterById = new Map<string, any>();
                        for (const s of beforeArr) {
                            const oid = typeof s?.optionId === 'string' ? s.optionId : '';
                            if (oid) beforeById.set(oid, s);
                        }
                        for (const s of afterArr) {
                            const oid = typeof s?.optionId === 'string' ? s.optionId : '';
                            if (oid) afterById.set(oid, s);
                        }

                        const allIds = new Set<string>();
                        for (const optionId of Array.from(beforeById.keys())) allIds.add(optionId);
                        for (const optionId of Array.from(afterById.keys())) allIds.add(optionId);

                        for (const optionId of Array.from(allIds)) {
                            const b = beforeById.get(optionId);
                            const a = afterById.get(optionId);
                            const bVal = normalizeOptVal(b?.value);
                            const aVal = normalizeOptVal(a?.value);

                            // Do NOT log when value is null/unknown
                            if (bVal == null && aVal == null) continue;

                            const defaultVal = defaultsById.get(optionId);
                            const defaultNorm = normalizeOptVal(defaultVal);

                            // Skip auto-applied defaults
                            if (bVal == null && aVal != null && defaultNorm != null && aVal === defaultNorm) continue;
                            if (aVal == null && bVal != null && defaultNorm != null && bVal === defaultNorm) continue;

                            if (bVal === aVal) continue;

                            const optionLabel = labelById.get(optionId) || (typeof a?.optionName === 'string' ? a.optionName : (typeof b?.optionName === 'string' ? b.optionName : 'Option'));
                            const fromStr = bVal == null ? 'None' : (shortValue(bVal) ?? null);
                            const toStr = aVal == null ? 'None' : (shortValue(aVal) ?? null);
                            if (fromStr == null || toStr == null) continue;

                            diffs.push({
                                fieldKey: `option:${optionId}`,
                                fromValue: fromStr,
                                toValue: toStr,
                                metadata: { optionId, optionLabel },
                            });
                        }
                    }
                } catch {
                    // fail-soft: do not block line item updates if option diffing fails
                }

                for (const d of diffs) {
                    await storage.createOrderAuditLog({
                        orderId: lineItem.orderId,
                        userId,
                        userName,
                        actionType: 'line_item.field_changed',
                        fromStatus: null,
                        toStatus: null,
                        note: null,
                        metadata: {
                            structuredEvent: {
                                eventType: 'line_item.field_changed',
                                entityType: 'line_item',
                                entityId: lineItem.id,
                                displayLabel,
                                fieldKey: d.fieldKey,
                                fromValue: d.fromValue,
                                toValue: d.toValue,
                                actorUserId: userId,
                                createdAt: nowIso,
                                metadata: {
                                    orderId: lineItem.orderId,
                                    lineItemId: lineItem.id,
                                    ...(d.metadata || {}),
                                },
                            },
                        },
                    });
                }
            }
            res.json(finalLineItem ?? lineItem);
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            res.status(500).json({ message: "Failed to update order line item" });
        }
    });

    // PBV2: Explicit recompute for an order line item (updates snapshot only; accepted components remain unchanged)
    app.post("/api/order-line-items/:id/pbv2/recompute", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const lineItemId = String(req.params.id);
            const parsed = z.object({
                pbv2ExplicitSelections: (insertOrderLineItemSchema as any).shape.pbv2ExplicitSelections.optional(),
                pbv2Env: (insertOrderLineItemSchema as any).shape.pbv2Env.optional(),
            }).parse(req.body);

            const explicitSelections = (parsed.pbv2ExplicitSelections && typeof parsed.pbv2ExplicitSelections === 'object') ? parsed.pbv2ExplicitSelections : {};
            const providedEnv = (parsed.pbv2Env && typeof parsed.pbv2Env === 'object') ? parsed.pbv2Env : {};

            const [li] = await db
                .select({
                    id: orderLineItems.id,
                    orderId: orderLineItems.orderId,
                    productId: orderLineItems.productId,
                    width: orderLineItems.width,
                    height: orderLineItems.height,
                    quantity: orderLineItems.quantity,
                    customerId: orders.customerId,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const widthIn = numOrUndef((li as any).width);
            const heightIn = numOrUndef((li as any).height);
            const quantity = numOrUndef((li as any).quantity) ?? undefined;
            const computedEnv: Record<string, unknown> = {
                widthIn,
                heightIn,
                quantity,
                sqft: widthIn != null && heightIn != null ? (widthIn * heightIn) / 144 : undefined,
                perimeterIn: widthIn != null && heightIn != null ? 2 * (widthIn + heightIn) : undefined,
            };
            const env = { ...computedEnv, ...providedEnv };

            let customerTier: 'default' | 'wholesale' | 'retail' | undefined;
            if ((li as any).customerId) {
                const [customer] = await db
                    .select({ pricingTier: customers.pricingTier })
                    .from(customers)
                    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, String((li as any).customerId))))
                    .limit(1);
                const tier = (customer as any)?.pricingTier;
                if (tier === 'default' || tier === 'wholesale' || tier === 'retail') customerTier = tier;
            }

            // Evaluate using the PRODUCT ACTIVE tree version (must not be DRAFT).
            const pbv2 = await evaluatePbv2SnapshotForProduct({
                organizationId,
                productId: String((li as any).productId),
                explicitSelections: explicitSelections as any,
                env,
                pricingContext: { customerTier },
                context: 'recompute',
            }).catch((e: any) => {
                if (e?.statusCode) throw e;
                throw Object.assign(new Error(e?.message || 'PBV2 recompute failed'), { statusCode: 400 });
            });

            const [updated] = await db
                .update(orderLineItems)
                .set({
                    pbv2TreeVersionId: pbv2 ? pbv2.treeVersionId : null,
                    pbv2SnapshotJson: pbv2 ? (pbv2.snapshotJson as any) : null,
                    updatedAt: new Date(),
                })
                .where(eq(orderLineItems.id, lineItemId))
                .returning();

            const components = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderLineItemId, lineItemId),
                    eq(orderLineItemComponents.status, 'ACCEPTED')
                ));

            res.json({ ...(updated as any), components });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            res.status(500).json({ message: (error as any)?.message ?? "Failed to recompute PBV2" });
        }
    });

    // PBV2: Acknowledge staleness / keep existing snapshot (audit only)
    app.post("/api/order-line-items/:id/pbv2/keep-existing", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user);
            const lineItemId = String(req.params.id);

            const [li] = await db
                .select({
                    id: orderLineItems.id,
                    orderId: orderLineItems.orderId,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
            await storage.createOrderAuditLog({
                orderId: (li as any).orderId,
                userId: userId ?? null,
                userName,
                actionType: 'line_item.pbv2.keep_existing',
                fromStatus: null,
                toStatus: null,
                note: 'PBV2 snapshot kept despite inputs change',
                metadata: { lineItemId } as any,
            });

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ message: (error as any)?.message ?? "Failed to keep PBV2 snapshot" });
        }
    });

    // PBV2: Apply updates (void outdated accepted components + accept new/revised proposals)
    app.post("/api/order-line-items/:id/pbv2/apply", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user);
            const lineItemId = String(req.params.id);

            const [li] = await db
                .select({
                    lineItemId: orderLineItems.id,
                    orderId: orderLineItems.orderId,
                    productId: orderLineItems.productId,
                    width: orderLineItems.width,
                    height: orderLineItems.height,
                    quantity: orderLineItems.quantity,
                    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
                    pbv2TreeVersionId: orderLineItems.pbv2TreeVersionId,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const snapshot = li.pbv2SnapshotJson as any;
            if (!snapshot || typeof snapshot !== "object") {
                return res.status(400).json({ message: "Order line item has no PBV2 snapshot; cannot apply updates." });
            }

            const snapshotTreeVersionId = String((snapshot as any).treeVersionId || li.pbv2TreeVersionId || "");
            if (!snapshotTreeVersionId) {
                return res.status(400).json({ message: "Snapshot missing treeVersionId; cannot apply updates." });
            }

            // Ensure snapshot tree version exists and is not DRAFT.
            const [treeVersion] = await db
                .select({ id: pbv2TreeVersions.id, status: pbv2TreeVersions.status })
                .from(pbv2TreeVersions)
                .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, snapshotTreeVersionId)))
                .limit(1);

            if (!treeVersion) return res.status(400).json({ message: "PBV2 tree version not found" });
            try {
                assertPbv2TreeVersionNotDraft(treeVersion.status, "accept");
            } catch (e: any) {
                return res.status(e?.statusCode ?? 409).json({ message: e?.message ?? "PBV2 DRAFT tree versions cannot be applied on orders" });
            }

            // Hard block: snapshot must not be stale relative to current inputs (and current active tree version).
            const explicitSelections =
                (snapshot as any).explicitSelections && typeof (snapshot as any).explicitSelections === "object"
                    ? (snapshot as any).explicitSelections
                    : null;
            const envSnapshot =
                (snapshot as any).env && typeof (snapshot as any).env === "object" ? (snapshot as any).env : null;

            if (!explicitSelections || !envSnapshot) {
                const missing: string[] = [];
                if (!explicitSelections) missing.push("explicitSelections");
                if (!envSnapshot) missing.push("env");
                return res.status(400).json({ message: `Snapshot missing inputs (${missing.join(", ")}); cannot apply updates.` });
            }

            const [productRow] = await db
                .select({ pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
                .from(products)
                .where(and(eq(products.organizationId, organizationId), eq(products.id, String((li as any).productId))))
                .limit(1);

            const activeTreeVersionId = productRow?.pbv2ActiveTreeVersionId ? String(productRow.pbv2ActiveTreeVersionId) : "";

            const snapshotSig =
                typeof (snapshot as any).pbv2InputSignature === "string" && (snapshot as any).pbv2InputSignature.length
                    ? String((snapshot as any).pbv2InputSignature)
                    : await computePbv2InputSignature({
                        treeVersionId: snapshotTreeVersionId,
                        explicitSelections,
                        env: envSnapshot,
                    });

            const widthIn = numOrUndef((li as any).width);
            const heightIn = numOrUndef((li as any).height);
            const quantity = numOrUndef((li as any).quantity) ?? undefined;
            const computedEnv: Record<string, unknown> = {
                widthIn,
                heightIn,
                quantity,
                sqft: widthIn != null && heightIn != null ? (widthIn * heightIn) / 144 : undefined,
                perimeterIn: widthIn != null && heightIn != null ? 2 * (widthIn + heightIn) : undefined,
            };
            const envExtras = pickPbv2EnvExtras(envSnapshot as any);
            const envCurrent = { ...computedEnv, ...envExtras };

            const currentSig = await computePbv2InputSignature({
                treeVersionId: activeTreeVersionId || snapshotTreeVersionId,
                explicitSelections,
                env: envCurrent,
            });

            if (currentSig !== snapshotSig) {
                return res.status(409).json({ message: "PBV2 snapshot is out of date; recompute PBV2 before applying updates." });
            }

            // Snapshot must contain proposals for deterministic reconciliation.
            if (!Array.isArray((snapshot as any).childItems)) {
                return res.status(400).json({ message: "Snapshot missing PBV2 proposals; recompute PBV2 before applying updates." });
            }

            const snapshotProposals = toChildItemProposalsFromSnapshot(snapshot);
            const proposalsWithIndex = assignEffectIndexFallback(snapshotProposals as any)
                .filter((ci: any) => ci && typeof ci === "object" && typeof ci.sourceNodeId === "string" && Number.isFinite(Number(ci.effectIndex)))
                .map((ci: any) => ({
                    kind: ci.kind,
                    title: ci.title,
                    skuRef: ci.skuRef,
                    childProductId: ci.childProductId,
                    qty: Number(ci.qty),
                    unitPriceCents: ci.unitPriceCents,
                    amountCents: ci.amountCents,
                    invoiceVisibility: ci.invoiceVisibility,
                    sourceNodeId: String(ci.sourceNodeId),
                    effectIndex: Math.trunc(Number(ci.effectIndex)),
                }))
                // Treat non-positive qty as absent.
                .filter((p: any) => Number.isFinite(Number(p.qty)) && Number(p.qty) > 0);

            const acceptedRows = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderLineItemId, lineItemId),
                    eq(orderLineItemComponents.status, "ACCEPTED"),
                ));

            const acceptedKeyed = acceptedRows
                .map((r: any) => {
                    const normalized = normalizePbv2DiffComponent({
                        pbv2SourceNodeId: r.pbv2SourceNodeId,
                        pbv2EffectIndex: r.pbv2EffectIndex,
                        kind: r.kind,
                        title: r.title,
                        skuRef: r.skuRef,
                        childProductId: r.childProductId,
                        qty: r.qty,
                        unitPriceCents: r.unitPriceCents,
                        amountCents: r.amountCents,
                        invoiceVisibility: r.invoiceVisibility,
                    });
                    return normalized ? { normalized, row: r } : null;
                })
                .filter(Boolean) as Array<{ normalized: any; row: any }>;

            const proposedKeyed = proposalsWithIndex
                .map((p: any) =>
                    normalizePbv2DiffComponent({
                        pbv2SourceNodeId: p.sourceNodeId,
                        pbv2EffectIndex: p.effectIndex,
                        kind: p.kind,
                        title: p.title,
                        skuRef: p.skuRef,
                        childProductId: p.childProductId,
                        qty: p.qty,
                        unitPriceCents: p.unitPriceCents,
                        amountCents: p.amountCents,
                        invoiceVisibility: p.invoiceVisibility,
                    }),
                )
                .filter(Boolean) as any[];

            const diff = pbv2DiffComponents(
                acceptedKeyed.map((x) => x.normalized),
                proposedKeyed,
            );

            const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0;
            if (!hasChanges) {
                return res.json({
                    message: "No PBV2 changes to apply",
                    appliedDiff: {
                        added: 0,
                        removed: 0,
                        modified: 0,
                        voided: 0,
                        accepted: 0,
                    },
                    diff,
                    components: acceptedRows,
                });
            }

            const acceptedRowByKey = new Map<string, any>();
            for (const { normalized, row } of acceptedKeyed) {
                acceptedRowByKey.set(`${normalized.key.pbv2SourceNodeId}::${normalized.key.pbv2EffectIndex}`, row);
            }

            const now = new Date();
            const voidIds: string[] = [];
            for (const r of diff.removed) {
                const row = acceptedRowByKey.get(`${r.key.pbv2SourceNodeId}::${r.key.pbv2EffectIndex}`);
                if (row?.id) voidIds.push(String(row.id));
            }
            for (const m of diff.modified) {
                const row = acceptedRowByKey.get(`${m.key.pbv2SourceNodeId}::${m.key.pbv2EffectIndex}`);
                if (row?.id) voidIds.push(String(row.id));
            }

            const upsertTargets = [...diff.added.map((x) => x.key), ...diff.modified.map((m) => m.key)];
            const proposalByKey = new Map<string, any>();
            for (const p of proposalsWithIndex) {
                proposalByKey.set(`${p.sourceNodeId}::${p.effectIndex}`, p);
            }

            await db.transaction(async (tx) => {
                if (voidIds.length > 0) {
                    await tx
                        .update(orderLineItemComponents)
                        .set({ status: "VOIDED", updatedAt: now })
                        .where(and(
                            eq(orderLineItemComponents.organizationId, organizationId),
                            inArray(orderLineItemComponents.id, voidIds as any),
                        ));
                }

                for (const key of upsertTargets) {
                    const proposal = proposalByKey.get(`${key.pbv2SourceNodeId}::${key.pbv2EffectIndex}`);
                    if (!proposal) continue;

                    const qty = Number(proposal.qty);
                    if (!Number.isFinite(qty) || qty <= 0) continue;

                    const values = buildOrderLineItemComponentUpsertValues({
                        organizationId,
                        orderId: String(li.orderId),
                        orderLineItemId: String(li.lineItemId),
                        treeVersionId: snapshotTreeVersionId,
                        proposal: {
                            kind: proposal.kind,
                            title: proposal.title,
                            skuRef: proposal.skuRef,
                            childProductId: proposal.childProductId,
                            qty,
                            unitPriceCents: proposal.unitPriceCents,
                            amountCents: proposal.amountCents,
                            invoiceVisibility: proposal.invoiceVisibility,
                            sourceNodeId: proposal.sourceNodeId,
                            effectIndex: proposal.effectIndex,
                        },
                        createdByUserId: userId ?? null,
                        now,
                    });

                    const updateSet: Partial<typeof orderLineItemComponents.$inferInsert> = {
                        status: "ACCEPTED",
                        kind: values.kind,
                        title: values.title,
                        skuRef: values.skuRef,
                        childProductId: values.childProductId,
                        qty: values.qty,
                        unitPriceCents: values.unitPriceCents,
                        amountCents: values.amountCents,
                        invoiceVisibility: values.invoiceVisibility,
                        pbv2TreeVersionId: values.pbv2TreeVersionId,
                        updatedAt: now,
                    };

                    await tx
                        .insert(orderLineItemComponents)
                        .values(values)
                        .onConflictDoUpdate({
                            target: [
                                orderLineItemComponents.organizationId,
                                orderLineItemComponents.orderLineItemId,
                                orderLineItemComponents.pbv2SourceNodeId,
                                orderLineItemComponents.pbv2EffectIndex,
                            ],
                            targetWhere: sql`${orderLineItemComponents.status} = 'ACCEPTED' and ${orderLineItemComponents.pbv2SourceNodeId} is not null and ${orderLineItemComponents.pbv2EffectIndex} is not null`,
                            set: updateSet as any,
                        });
                }
            });

            const components = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderLineItemId, lineItemId),
                    eq(orderLineItemComponents.status, "ACCEPTED"),
                ));

            res.json({
                message: "PBV2 updates applied",
                appliedDiff: {
                    added: diff.added.length,
                    removed: diff.removed.length,
                    modified: diff.modified.length,
                    voided: voidIds.length,
                    accepted: upsertTargets.length,
                },
                diff,
                components,
            });
        } catch (error) {
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to apply PBV2 updates" });
        }
    });

    // PBV2: Accept child item proposals as persisted components
    app.post("/api/order-line-items/:id/pbv2/components/accept", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user);
            const lineItemId = String(req.params.id);

            const [li] = await db
                .select({
                    lineItemId: orderLineItems.id,
                    orderId: orderLineItems.orderId,
                    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
                    pbv2TreeVersionId: orderLineItems.pbv2TreeVersionId,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const snapshot = li.pbv2SnapshotJson as any;
            if (!snapshot || typeof snapshot !== 'object') {
                return res.status(400).json({ message: "Order line item has no PBV2 snapshot; cannot accept components." });
            }

            const treeVersionId = String((snapshot as any).treeVersionId || li.pbv2TreeVersionId || "");
            if (!treeVersionId) {
                return res.status(400).json({ message: "Snapshot missing treeVersionId; cannot accept components." });
            }

            const [treeVersion] = await db
                .select({ id: pbv2TreeVersions.id, status: pbv2TreeVersions.status, treeJson: pbv2TreeVersions.treeJson })
                .from(pbv2TreeVersions)
                .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, treeVersionId)))
                .limit(1);

            if (!treeVersion) return res.status(400).json({ message: "PBV2 tree version not found" });
            try {
                assertPbv2TreeVersionNotDraft(treeVersion.status, 'accept');
            } catch (e: any) {
                return res.status(e?.statusCode ?? 409).json({ message: e?.message ?? "PBV2 DRAFT tree versions cannot be accepted on orders" });
            }

            // Prefer snapshot childItems always. If effectIndex is missing (older snapshots), assign it deterministically.
            // Never recompute using product active trees.
            const hasChildItemsArray = Array.isArray((snapshot as any).childItems);
            let proposalsWithIndex: Pbv2ChildItemProposalWithIndex[] = [];

            if (hasChildItemsArray) {
                const snapshotProposals = toChildItemProposalsFromSnapshot(snapshot);
                const withIndex = assignEffectIndexFallback(snapshotProposals as any);
                proposalsWithIndex = withIndex
                    .filter((ci: any) => ci && typeof ci === 'object' && typeof ci.sourceNodeId === 'string' && Number.isFinite(Number(ci.effectIndex)))
                    .map((ci: any) => ({
                        kind: ci.kind,
                        title: ci.title,
                        skuRef: ci.skuRef,
                        childProductId: ci.childProductId,
                        qty: Number(ci.qty),
                        unitPriceCents: ci.unitPriceCents,
                        amountCents: ci.amountCents,
                        invoiceVisibility: ci.invoiceVisibility,
                        sourceNodeId: String(ci.sourceNodeId),
                        effectIndex: Math.trunc(Number(ci.effectIndex)),
                    }));
            } else {
                // Fallback: recompute proposals only if snapshot has enough inputs AND we can resolve the exact treeVersionId.
                const selections = (snapshot as any).explicitSelections && typeof (snapshot as any).explicitSelections === 'object' ? (snapshot as any).explicitSelections : null;
                const env = (snapshot as any).env && typeof (snapshot as any).env === 'object' ? (snapshot as any).env : null;
                if (!selections || !env) {
                    const missing: string[] = [];
                    if (!selections) missing.push('explicitSelections');
                    if (!env) missing.push('env');
                    return res.status(400).json({ message: `Snapshot missing inputs (${missing.join(', ')}); cannot accept components.` });
                }

                const recomputed = pbv2ToChildItemProposals(treeVersion.treeJson as any, selections as any, env as any);
                const recomputedItems = (Array.isArray((recomputed as any)?.childItems) ? (recomputed as any).childItems : [])
                    .filter((ci: any) => ci && typeof ci === 'object' && typeof ci.sourceNodeId === 'string')
                    .map((ci: any) => ({
                        kind: ci.kind,
                        title: ci.title,
                        skuRef: ci.skuRef,
                        childProductId: ci.childProductId,
                        qty: Number(ci.qty),
                        unitPriceCents: ci.unitPriceCents,
                        amountCents: ci.amountCents,
                        invoiceVisibility: ci.invoiceVisibility,
                        sourceNodeId: String(ci.sourceNodeId),
                        effectIndex: Number.isFinite(Number(ci.effectIndex)) ? Math.trunc(Number(ci.effectIndex)) : undefined,
                    }));

                const withIndex = assignEffectIndexFallback(recomputedItems as any);
                proposalsWithIndex = withIndex
                    .filter((ci: any) => Number.isFinite(Number(ci.effectIndex)))
                    .map((ci: any) => ({
                        kind: ci.kind,
                        title: ci.title,
                        skuRef: ci.skuRef,
                        childProductId: ci.childProductId,
                        qty: Number(ci.qty),
                        unitPriceCents: ci.unitPriceCents,
                        amountCents: ci.amountCents,
                        invoiceVisibility: ci.invoiceVisibility,
                        sourceNodeId: String(ci.sourceNodeId),
                        effectIndex: Math.trunc(Number(ci.effectIndex)),
                    }));
            }

            if (proposalsWithIndex.length === 0) {
                return res.json({ success: true, data: [] });
            }

            // Upsert each component idempotently using the stable PBV2 key.
            await db.transaction(async (tx) => {
                for (const p of proposalsWithIndex) {
                    if (!p.sourceNodeId || !Number.isFinite(p.effectIndex)) continue;
                    const qty = Number(p.qty);
                    if (!Number.isFinite(qty) || qty <= 0) continue;

                    const values = buildOrderLineItemComponentUpsertValues({
                        organizationId,
                        orderId: String(li.orderId),
                        orderLineItemId: String(li.lineItemId),
                        treeVersionId,
                        proposal: {
                            kind: p.kind,
                            title: p.title,
                            skuRef: p.skuRef,
                            childProductId: p.childProductId,
                            qty,
                            unitPriceCents: p.unitPriceCents,
                            amountCents: p.amountCents,
                            invoiceVisibility: p.invoiceVisibility,
                            sourceNodeId: p.sourceNodeId,
                            effectIndex: p.effectIndex,
                        },
                        createdByUserId: userId ?? null,
                        now: new Date(),
                    });

                    const updateSet: Partial<typeof orderLineItemComponents.$inferInsert> = {
                        status: 'ACCEPTED',
                        kind: values.kind,
                        title: values.title,
                        skuRef: values.skuRef,
                        childProductId: values.childProductId,
                        qty: values.qty,
                        unitPriceCents: values.unitPriceCents,
                        amountCents: values.amountCents,
                        invoiceVisibility: values.invoiceVisibility,
                        pbv2TreeVersionId: values.pbv2TreeVersionId,
                        updatedAt: new Date(),
                    };

                    await tx
                        .insert(orderLineItemComponents)
                        .values(values)
                        .onConflictDoUpdate({
                            target: [
                                orderLineItemComponents.organizationId,
                                orderLineItemComponents.orderLineItemId,
                                orderLineItemComponents.pbv2SourceNodeId,
                                orderLineItemComponents.pbv2EffectIndex,
                            ],
                            // Matches the partial unique index in migration 0024.
                            targetWhere: sql`${orderLineItemComponents.status} = 'ACCEPTED' and ${orderLineItemComponents.pbv2SourceNodeId} is not null and ${orderLineItemComponents.pbv2EffectIndex} is not null`,
                            set: updateSet as any,
                        });
                }
            });

            const components = await db
                .select()
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderLineItemId, lineItemId),
                    eq(orderLineItemComponents.status, 'ACCEPTED')
                ));

            res.json({ success: true, data: components });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to accept PBV2 components" });
        }
    });

    // PBV2: Void a persisted component
    app.patch("/api/order-line-item-components/:componentId/void", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const componentId = String(req.params.componentId);

            const [updated] = await db
                .update(orderLineItemComponents)
                .set({ status: 'VOIDED', updatedAt: new Date() })
                .where(and(eq(orderLineItemComponents.id, componentId), eq(orderLineItemComponents.organizationId, organizationId)))
                .returning();

            if (!updated) return res.status(404).json({ message: "Component not found" });
            res.json({ success: true, data: updated });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to void component" });
        }
    });

    app.patch("/api/orders/:orderId/line-items/:lineItemId/status", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            const { orderId, lineItemId } = req.params;
            const { status } = req.body;

            const routing = await loadProductionLineItemStatusRulesForOrganization(organizationId);
            const routingRules = routing.rules;
            const fallbackValidStatuses = ['queued', 'printing', 'finishing', 'done', 'canceled'];
            const rule = routingRules.find((r) => r.id === status);

            if (!status) return res.status(400).json({ message: "Invalid status" });
            // Allow org-configured statuses; also allow legacy statuses for back-compat.
            if (!rule && !fallbackValidStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ message: "Order not found" });

            const oldLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!oldLineItem || oldLineItem.orderId !== orderId) return res.status(404).json({ message: "Line item not found" });

            const updatedLineItem = await storage.updateOrderLineItem(lineItemId, { status });
            if (userId && oldLineItem.status !== status) {
                const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
                try {
                    await storage.createOrderAuditLog({
                        orderId: order.id,
                        userId,
                        userName,
                        actionType: 'line_item_status_change',
                        fromStatus: null,
                        toStatus: null,
                        note: null,
                        metadata: { lineItemId: updatedLineItem.id, oldStatus: oldLineItem.status, newStatus: status },
                    });
                } catch (e) {
                    console.warn('[OrderLineItemStatus] audit log failed:', e);
                }
            }

            await recomputeOrderBillingStatus({ organizationId, orderId });
            
            // Trigger: Auto-schedule production when single line item moves into in_production
            if (status === 'in_production' && oldLineItem.status !== 'in_production') {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[SingleLineItemStatus:TRIGGER] Detected line item ${lineItemId} moving to in_production for orderId=${orderId}`);
                }
                
                try {
                    const { scheduleOrderLineItemsForProduction } = await import('../services/productionScheduling');
                    const { loadProductionLineItemStatusRulesForOrganization, appendEvent } = await import('../productionHelpers');
                    
                    const scheduleResult = await scheduleOrderLineItemsForProduction({
                        organizationId,
                        orderId,
                        lineItemIds: [lineItemId],
                        loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
                        appendEvent,
                    });
                    
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`[SingleLineItemStatus:TRIGGER] Auto-scheduled production for item ${lineItemId}:`, scheduleResult.data);
                    }
                } catch (productionErr: any) {
                    console.error('[SingleLineItemStatus:TRIGGER] Production auto-scheduling failed:', productionErr);
                    // Fail soft - don't break the status update
                }
            }

            const warnings: string[] = [];
            if (routing.source !== 'org') {
                console.warn(`[OrderLineItemStatus] No org routing config (source=${routing.source}); skipping production intake.`);
                warnings.push('Production routing config missing/invalid; no job created.');
            } else if (!rule) {
                warnings.push('Status saved. No production routing rule found for this status.');
            } else if (rule.sendToProduction) {
                const stationKey = String(rule.stationKey ?? '').trim();
                const stepKey = String((rule as any).stepKey ?? '').trim();

                if (!stationKey || !stepKey) {
                    console.warn('[OrderLineItemStatus] Routing rule missing station/step; skipping intake.');
                    warnings.push('Routing rule missing station/step; no job created.');
                } else {
                    try {
                        await db.transaction(async (tx) => {
                            const existing = await tx
                                .select({
                                    id: productionJobs.id,
                                    status: productionJobs.status,
                                    stationKey: productionJobs.stationKey,
                                    stepKey: productionJobs.stepKey,
                                })
                                .from(productionJobs)
                                .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.lineItemId, lineItemId)))
                                .limit(1);

                            let jobId: string;
                            let created = false;
                            let appliedStationKey = stationKey;
                            let appliedStepKey = stepKey;
                            let ignoredDueToDone = false;
                            let ignoredDueToExistingRouting = false;

                            if (!existing[0]) {
                                // New job MUST be line-item backed.
                                const [inserted] = await tx
                                    .insert(productionJobs)
                                    .values({
                                        organizationId,
                                        orderId,
                                        lineItemId,
                                        stationKey,
                                        stepKey,
                                        status: 'queued',
                                        totalSeconds: 0,
                                    })
                                    .returning({ id: productionJobs.id });
                                jobId = inserted.id;
                                created = true;
                            } else {
                                jobId = existing[0].id;

                                // No implicit routing changes. Keep existing station/step unless explicit override is used.
                                appliedStationKey = existing[0].stationKey;
                                appliedStepKey = existing[0].stepKey;
                                ignoredDueToDone = existing[0].status === 'done';
                                ignoredDueToExistingRouting =
                                    existing[0].status !== 'done' &&
                                    (existing[0].stationKey !== stationKey || existing[0].stepKey !== stepKey);

                                if (ignoredDueToExistingRouting) {
                                    console.warn(
                                        `[OrderLineItemStatus] Routing differs for existing jobId=${jobId}; ignoring requested routing (${stationKey}/${stepKey}) and keeping existing (${existing[0].stationKey}/${existing[0].stepKey}). Use /api/production/jobs/:jobId/routing for explicit override.`,
                                    );
                                }

                                if (existing[0].status !== 'done') {
                                    await tx
                                        .update(productionJobs)
                                        .set({
                                            orderId,
                                            updatedAt: new Date(),
                                        })
                                        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
                                }
                            }

                            await tx.insert(productionEvents).values({
                                organizationId,
                                productionJobId: jobId,
                                type: 'intake',
                                payload: {
                                    fromStatus: oldLineItem.status,
                                    toStatus: status,
                                    requested: { stationKey, stepKey },
                                    applied: { stationKey: appliedStationKey, stepKey: appliedStepKey },
                                    created,
                                    duplicate: !created,
                                    ignoredDueToDone,
                                    ignoredDueToExistingRouting,
                                },
                            });
                        });
                    } catch (e: any) {
                        console.warn('[OrderLineItemStatus] production intake failed:', e);
                        warnings.push('Production intake failed (status saved).');
                    }
                }
            }

            res.json({ success: true, data: updatedLineItem, warnings: warnings.length ? warnings : undefined });
        } catch (error) {
            const err: any = error;
            console.error({
                route: 'PATCH /api/orders/:orderId/line-items/:lineItemId/status',
                orderId: req?.params?.orderId,
                lineItemId: req?.params?.lineItemId,
                body: req?.body,
                errorMessage: String(err?.message || err),
                errorStack: err?.stack,
                pgCode: err?.code,
                pgDetail: err?.detail,
            });
            res.status(500).json({ message: err?.message ?? "Internal server error" });
        }
    });

    app.delete("/api/order-line-items/:id", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const lineItemId = String(req.params.id);
            const [ownership] = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!ownership) return res.status(404).json({ message: "Order line item not found" });

            await storage.deleteOrderLineItem(lineItemId);
            res.json({ message: "Order line item deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete order line item" });
        }
    });

    // PBV2: Orders-only production rollup (materials from current-valid snapshots + accepted components)
    app.get("/api/orders/:orderId/pbv2/rollup", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            // Ensure order exists in this org.
            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const lineItems = await db
                .select({
                    id: orderLineItems.id,
                    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
                })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            const acceptedComponents = await db
                .select({
                    orderLineItemId: orderLineItemComponents.orderLineItemId,
                    kind: orderLineItemComponents.kind,
                    title: orderLineItemComponents.title,
                    skuRef: orderLineItemComponents.skuRef,
                    childProductId: orderLineItemComponents.childProductId,
                    qty: orderLineItemComponents.qty,
                    unitPriceCents: orderLineItemComponents.unitPriceCents,
                    amountCents: orderLineItemComponents.amountCents,
                    invoiceVisibility: orderLineItemComponents.invoiceVisibility,
                })
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderId, orderId),
                    eq(orderLineItemComponents.status, "ACCEPTED"),
                ));

            const rollup = await buildOrderPbv2Rollup({
                orderId,
                lineItems: lineItems.map((li: any) => ({ id: String(li.id), pbv2SnapshotJson: (li as any).pbv2SnapshotJson ?? null })),
                acceptedComponents: acceptedComponents as any,
            });

            res.json(buildPbv2OrderRollupResponse(rollup));
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to build PBV2 rollup" });
        }
    });

    // Inventory reservations (derived from PBV2 rollups)
    const handleGetOrderInventory = async (req: any, res: any) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            // Ensure order exists in this org.
            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const rows = await db
                .select({
                    sourceType: inventoryReservations.sourceType,
                    sourceKey: inventoryReservations.sourceKey,
                    uom: inventoryReservations.uom,
                    qty: inventoryReservations.qty,
                    status: inventoryReservations.status,
                })
                .from(inventoryReservations)
                .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.orderId, orderId)));

            const reserved = buildInventoryRollup({ reservations: rows as any, status: "RESERVED" });
            const released = buildInventoryRollup({ reservations: rows as any, status: "RELEASED" });

            res.json({
                orderId,
                reserved,
                released,
                hasActiveReservations: reserved.items.length > 0,
            });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to load inventory reservations" });
        }
    };

    app.get("/api/orders/:orderId/inventory", isAuthenticated, tenantContext, handleGetOrderInventory);
    app.get("/api/orders/:orderId/inventory/reservations", isAuthenticated, tenantContext, handleGetOrderInventory);

    app.post("/api/orders/:orderId/inventory/reserve", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            // Ensure order exists in this org.
            const [order] = await db
                .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const isCanceled = String((order as any).state || "") === "canceled" || String((order as any).status || "") === "canceled" || Boolean((order as any).canceledAt);
            if (isCanceled) {
                return res.status(409).json({ message: "Cannot reserve inventory for a canceled order." });
            }

            const lineItems = await db
                .select({
                    id: orderLineItems.id,
                    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
                })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            const acceptedComponents = await db
                .select({
                    orderLineItemId: orderLineItemComponents.orderLineItemId,
                    kind: orderLineItemComponents.kind,
                    title: orderLineItemComponents.title,
                    skuRef: orderLineItemComponents.skuRef,
                    childProductId: orderLineItemComponents.childProductId,
                    qty: orderLineItemComponents.qty,
                    invoiceVisibility: orderLineItemComponents.invoiceVisibility,
                })
                .from(orderLineItemComponents)
                .where(and(
                    eq(orderLineItemComponents.organizationId, organizationId),
                    eq(orderLineItemComponents.orderId, orderId),
                    eq(orderLineItemComponents.status, "ACCEPTED"),
                ));

            const rollup = await buildOrderPbv2Rollup({
                orderId,
                lineItems: lineItems.map((li: any) => ({ id: String(li.id), pbv2SnapshotJson: (li as any).pbv2SnapshotJson ?? null })),
                acceptedComponents: acceptedComponents as any,
            });

            const staleWarnings = (rollup.warnings ?? []).filter((w: any) => String(w.code || "").startsWith("PBV2_SNAPSHOT_"));
            if (staleWarnings.length > 0) {
                return res.status(409).json({
                    message: "PBV2 snapshot is stale for one or more line items; cannot reserve inventory.",
                    warnings: staleWarnings,
                });
            }

            const createdByUserId = getUserId(req.user) ?? null;
            const desired = buildInventoryReservationsFromRollup({ organizationId, orderId, rollup, createdByUserId });

            // If there are existing RESERVED rows, only allow re-reserve if it matches exactly.
            const existingReservedRows = await db
                .select({
                    sourceType: inventoryReservations.sourceType,
                    sourceKey: inventoryReservations.sourceKey,
                    uom: inventoryReservations.uom,
                    qty: inventoryReservations.qty,
                    status: inventoryReservations.status,
                })
                .from(inventoryReservations)
                .where(and(
                    eq(inventoryReservations.organizationId, organizationId),
                    eq(inventoryReservations.orderId, orderId),
                    eq(inventoryReservations.status, "RESERVED"),
                ));

            const normalizeQty = (v: any) => {
                const n = Number(String(v));
                if (!Number.isFinite(n)) return "0.00";
                return (Math.round(n * 100) / 100).toFixed(2);
            };
            const toKey = (r: any) => `${r.sourceType}::${r.sourceKey}::${r.uom}`;
            const desiredMap = new Map(desired.map((r) => [toKey(r), normalizeQty(r.qty)]));
            const existingMap = new Map<string, string>();
            for (const r of existingReservedRows as any[]) {
                const k = toKey(r);
                const prev = existingMap.get(k) ?? "0.00";
                const sum = Number(prev) + Number(normalizeQty(r.qty));
                existingMap.set(k, sum.toFixed(2));
            }

            if (existingMap.size > 0) {
                if (existingMap.size !== desiredMap.size) {
                    return res.status(409).json({
                        message: "Active reservations exist for this order but PBV2 intent has drifted. Release inventory before reserving again.",
                    });
                }
                for (const [k, v] of Array.from(existingMap.entries())) {
                    if (!desiredMap.has(k) || desiredMap.get(k) !== v) {
                        return res.status(409).json({
                            message: "Active reservations exist for this order but PBV2 intent has drifted. Release inventory before reserving again.",
                        });
                    }
                }
            }

            const toInsert = diffReservationsForInsert({ desired, existingReserved: existingReservedRows as any });

            if (toInsert.length > 0) {
                await db.insert(inventoryReservations).values(toInsert as any);
            }

            // TODO(inventory-availability): When mode=enforced, block on insufficient on-hand once availability checks are implemented.
            const meta = policy.mode === "enforced"
                ? {
                    inventoryPolicy: {
                        mode: policy.mode,
                        warning: "Enforced mode is not fully implemented yet (availability checks are pending). No additional blocking is applied.",
                    },
                }
                : undefined;

            res.json({ orderId, insertedCount: toInsert.length, ...(meta ? { meta } : {}) });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to reserve inventory" });
        }
    });

    app.post("/api/orders/:orderId/inventory/release", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            // Ensure order exists in this org.
            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });
            const now = new Date();

            const updated = await db
                .update(inventoryReservations)
                .set({
                    status: "RELEASED",
                    updatedAt: now,
                })
                .where(and(
                    eq(inventoryReservations.organizationId, organizationId),
                    eq(inventoryReservations.orderId, orderId),
                    eq(inventoryReservations.status, "RESERVED"),
                ))
                .returning({ id: inventoryReservations.id });

            // TODO(inventory-availability): When mode=enforced, block on insufficient on-hand once availability checks are implemented.
            const meta = policy.mode === "enforced"
                ? {
                    inventoryPolicy: {
                        mode: policy.mode,
                        warning: "Enforced mode is not fully implemented yet (availability checks are pending). No additional blocking is applied.",
                    },
                }
                : undefined;

            res.json({ orderId, releasedCount: updated.length, ...(meta ? { meta } : {}) });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to release inventory" });
        }
    });

    // Manual inventory reservations (no PBV2 dependency)
    app.get("/api/orders/:orderId/manual-reservations", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const rows = await listManualReservationsForOrder(db as any, { organizationId, orderId });
            res.json({ success: true, data: rows });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to load manual reservations" });
        }
    });

    app.post("/api/orders/:orderId/manual-reservations", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);

            const parsed = z
                .object({
                    materialId: z.string().min(1),
                    quantity: z.coerce.number().positive(),
                    inputUom: z.enum(["sheet", "sqft", "linear_ft", "ml", "ea"]).optional(),
                })
                .safeParse(req.body);

            if (!parsed.success) {
                return res.status(400).json({ message: fromZodError(parsed.error).message });
            }

            const [order] = await db
                .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const isCanceled = String((order as any).state || "") === "canceled" || String((order as any).status || "") === "canceled" || Boolean((order as any).canceledAt);
            if (isCanceled) {
                return res.status(409).json({ message: "Cannot reserve inventory for a canceled order." });
            }

            const [material] = await db
                .select({
                    id: materials.id,
                    sku: materials.sku,
                    type: materials.type,
                    unitOfMeasure: materials.unitOfMeasure,
                    width: materials.width,
                })
                .from(materials)
                .where(and(eq(materials.organizationId, organizationId), eq(materials.id, parsed.data.materialId)))
                .limit(1);

            if (!material) return res.status(404).json({ message: "Material not found" });

            const conversion = convertReservationInputToBaseQty({
                material: {
                    type: String((material as any).type),
                    unitOfMeasure: String((material as any).unitOfMeasure),
                    width: (material as any).width,
                },
                inputUom: parsed.data.inputUom ?? String((material as any).unitOfMeasure),
                inputQuantity: parsed.data.quantity,
            });

            if (!conversion.ok) {
                return res.status(400).json({ message: conversion.message });
            }

            const createdByUserId = getUserId(req.user) ?? null;
            const created = await createManualReservation(db as any, {
                organizationId,
                orderId,
                sourceKey: String((material as any).sku),
                uom: String(conversion.baseUom),
                qty: conversion.convertedQty,
                createdByUserId,
            });

            const hydrated = await getManualReservationById(db as any, {
                organizationId,
                orderId,
                reservationId: String((created as any).id),
            });

            res.json({ success: true, data: hydrated ?? created });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to create manual reservation" });
        }
    });

    app.delete("/api/orders/:orderId/manual-reservations/:reservationId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const policy = await requireInventoryReservationsNotOff(req, res);
            if (!policy) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);
            const reservationId = String(req.params.reservationId);

            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            if (!order) return res.status(404).json({ message: "Order not found" });

            const deletedCount = await deleteManualReservation(db as any, { organizationId, orderId, reservationId });
            if (deletedCount === 0) return res.status(404).json({ message: "Manual reservation not found" });

            res.json({ success: true, deletedCount });
        } catch (error) {
            const err: any = error;
            res.status(500).json({ message: err?.message ?? "Failed to delete manual reservation" });
        }
    });

    // Customer portal: Products (filtered by visibility settings)
    app.get('/api/portal/products', isAuthenticated, portalContext, async (req: any, res) => {
        try {
            const portalCustomer = getPortalCustomer(req);
            if (!portalCustomer) {
                return res.status(403).json({ error: 'No customer account linked to this user' });
            }
            const { organizationId, id: customerId, productVisibilityMode } =
                portalCustomer as any;

            const allProducts = await storage.getAllProducts(organizationId);
            let visibleProducts = allProducts;

            if (productVisibilityMode === 'linked-only') {
                const visibleProductIds = await db
                    .select({ productId: customerVisibleProducts.productId })
                    .from(customerVisibleProducts)
                    .where(eq(customerVisibleProducts.customerId, customerId));

                const visibleIdSet = new Set(visibleProductIds.map(row => row.productId));
                visibleProducts = allProducts.filter(p => visibleIdSet.has(p.id));
            }

            res.json({ success: true, data: visibleProducts });
        } catch (error) {
            console.error('Error fetching portal products:', error);
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    });

    // Job file routes
    app.get('/api/jobs/:id/files', isAuthenticated, async (req: any, res) => {
        try {
            const files = await storage.listJobFiles(req.params.id);
            res.json({ success: true, data: files });
        } catch (error) {
            console.error('Error fetching job files:', error);
            res.status(500).json({ error: 'Failed to fetch job files' });
        }
    });

    app.post('/api/jobs/:id/files', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const userId = getUserId(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) {
                return res.status(400).json({ error: 'Organization context required' });
            }
            const { fileId, role } = req.body;

            if (!fileId) {
                return res.status(400).json({ error: 'fileId is required' });
            }

            const validRoles = ['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other'];
            if (role && !validRoles.includes(role)) {
                return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
            }

            // Fetch job to get orderId and verify tenant ownership
            const job = await storage.getJob(organizationId, req.params.id);
            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }

            const jobFile = await storage.attachFileToJob({
                jobId: req.params.id,
                organizationId,
                orderId: job.orderId || null,
                fileId,
                role: role || 'artwork',
                attachedByUserId: userId,
            });

            res.json({ success: true, data: jobFile });
        } catch (error) {
            console.error('Error attaching file to job:', error);
            res.status(500).json({ error: 'Failed to attach file to job' });
        }
    });

    app.delete('/api/jobs/:jobId/files/:fileId', isAuthenticated, async (req: any, res) => {
        try {
            await storage.detachJobFile(req.params.fileId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error detaching file from job:', error);
            res.status(500).json({ error: 'Failed to detach file from job' });
        }
    });

    // PACK C: Bulk download order + line item attachments as zip
    app.get('/api/orders/:orderId/attachments.zip', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const { orderId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            // Verify order access
            const [orderRow] = await db
                .select({ id: orders.id, orderNumber: orders.orderNumber })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!orderRow) return res.status(404).json({ error: 'Order not found' });

            // Collect all attachments (order-level + line-item assets)
            const attachmentRows = await db
                .select({
                    id: orderAttachments.id,
                    fileName: orderAttachments.fileName,
                    originalFilename: orderAttachments.originalFilename,
                    fileUrl: orderAttachments.fileUrl,
                    relativePath: orderAttachments.relativePath,
                })
                .from(orderAttachments)
                .where(eq(orderAttachments.orderId, orderId))
                .orderBy(orderAttachments.createdAt);

            const lineItemRows = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));

            const lineItemIds = lineItemRows.map((r) => r.id).filter(Boolean) as string[];

            let lineItemAssetRows: any[] = [];
            if (lineItemIds.length) {
                const linkRows = await db
                    .select({
                        assetId: assetLinks.assetId,
                    })
                    .from(assetLinks)
                    .where(
                        and(
                            eq(assetLinks.organizationId, organizationId),
                            eq(assetLinks.parentType, 'order_line_item'),
                            inArray(assetLinks.parentId, lineItemIds)
                        )
                    );

                const assetIds = Array.from(new Set(linkRows.map((r) => r.assetId).filter(Boolean) as string[]));
                if (assetIds.length) {
                    lineItemAssetRows = await db
                        .select({
                            id: assets.id,
                            fileName: assets.fileName,
                            fileKey: assets.fileKey,
                        })
                        .from(assets)
                        .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds)));
                }
            }

            // Build file list with objectPaths
            const files: Array<{ filename: string; objectPath: string }> = [];

            for (const att of attachmentRows) {
                const filename = String(att.originalFilename || att.fileName || `attachment-${att.id}`);
                // Extract objectPath from fileUrl (if it starts with /objects/) or use relativePath
                let objectPath: string | null = null;
                if (att.fileUrl && att.fileUrl.startsWith('/objects/')) {
                    objectPath = att.fileUrl.replace('/objects/', '').split('?')[0];
                } else if (att.relativePath) {
                    objectPath = att.relativePath;
                }
                if (objectPath) files.push({ filename, objectPath });
            }

            for (const asset of lineItemAssetRows) {
                const filename = String(asset.fileName || `asset-${asset.id}`);
                const objectPath = asset.fileKey as string | null;
                if (objectPath) files.push({ filename, objectPath });
            }

            if (files.length === 0) {
                return res.status(404).json({ error: 'No attachments found for this order' });
            }

            // Stream zip using archiver
            const archiver = (await import('archiver')).default;
            const { Readable } = await import('stream');
            const { promises: fsPromises } = await import('fs');
            const path = await import('path');
            const { SupabaseStorageService, isSupabaseConfigured } = await import('../supabaseStorage');

            const archive = archiver('zip', { zlib: { level: 9 } });

            const zipFilename = `Order-${orderRow.orderNumber || orderId}-attachments.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

            archive.on('error', (err: Error) => {
                console.error('[OrderAttachmentsZip] Archiver error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to create zip archive' });
                }
            });

            archive.pipe(res);

            // Helper to get file stream (mirrors /objects endpoint logic)
            const resolveLocalStoragePath = (key: string): string => {
                const root = process.env.FILE_STORAGE_ROOT || './data/uploads';
                return path.join(root, key);
            };

            for (const file of files) {
                try {
                    const keyToTry = file.objectPath;
                    let streamAdded = false;

                    // 1) Try Supabase
                    if (isSupabaseConfigured()) {
                        try {
                            const supabaseService = new SupabaseStorageService();
                            const signedUrl = await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
                            const upstream = await fetch(signedUrl);
                            if (upstream.ok) {
                                const body: any = (upstream as any).body;
                                if (body && typeof Readable.fromWeb === 'function') {
                                    const nodeStream = Readable.fromWeb(body);
                                    const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
                                    archive.append(nodeStream, { name: safeFilename });
                                    streamAdded = true;
                                }
                            }
                        } catch (supabaseError) {
                            // fall through to local
                        }
                    }

                    // 2) Try local filesystem
                    if (!streamAdded) {
                        const localPath = resolveLocalStoragePath(keyToTry);
                        await fsPromises.access(localPath, fsPromises.constants.R_OK);
                        const fs = await import('fs');
                        const nodeStream = fs.createReadStream(localPath);
                        const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
                        archive.append(nodeStream, { name: safeFilename });
                        streamAdded = true;
                    }

                    if (!streamAdded) {
                        console.warn(`[OrderAttachmentsZip] Could not resolve file: ${file.filename} (${keyToTry})`);
                    }
                } catch (err) {
                    console.error(`[OrderAttachmentsZip] Failed to add ${file.filename}:`, err);
                    // Continue with other files
                }
            }

            await archive.finalize();
        } catch (error) {
            console.error('[OrderAttachmentsZip:GET] Error:', error);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Failed to generate zip archive' });
            }
        }
    });
}
