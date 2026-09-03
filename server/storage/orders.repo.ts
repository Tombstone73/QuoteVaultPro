import { db } from "../db";
import {
    orders,
    orderLineItems,
    orderLineItemComponents,
    orderInternalNotes,
    lineItemProofApprovals,
    lineItemProofManualApprovalOverrides,
    lineItemProofVersions,
    shipments,
    orderAttachments,
    orderAuditLog,
    customers,
    customerContacts,
    customerContactLinks,
    users,
    products,
    productTypes,
    organizations,
    productVariants,
    quotes,
    quoteListNotes,
    orderListNotes,
    orderStatusPills,
    quoteAttachments,
    quoteLineItems,
    productionJobs,
    productionRuns,
    productionRunMembers,
    invoices,
    jobs,
    jobStatusLog,
    auditLogs,
    assets,
    assetLinks,
    type Order,
    type InsertOrder,
    type OrderWithRelations,
    type OrderLineItem,
    type InsertOrderLineItem,
    type LineItemMaterialUsage,
    type Shipment,
    type InsertShipment,
    type UpdateShipment,
    type OrderAttachment,
    type InsertOrderAttachment,
    type UpdateOrderAttachment,
    type OrderAuditLog,
    type InsertOrderAuditLog,
    type User,
    type CustomerContact,
    type InsertJobStatusLog,
} from "@shared/schema";
import { eq, and, or, ilike, gte, lte, asc, desc, sql, isNull, inArray, ne } from "drizzle-orm";
import { deriveLineItemProofSummary, deriveOrderProofSummary, type LineItemProofSummary, type OrderProofSummary } from "@shared/orderProofStatus";
import { deriveOrderInvoiceState, type OrderInvoiceStateSummary } from "@shared/orderInvoiceState";
import { resolveDerivativeFileAccess } from "../lib/supabaseObjectHelpers";
import { getInitialWorkflowState, transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { resolveActiveProductionOwners } from "../services/productionOwnership";
import { copyLineItemDesignSnapshotFields, materializeLineItemDesignSnapshot } from "../services/designLineItemSnapshot";
import { productDesignConfigRepository } from "./productDesignConfig.repo";
import { canonicalArtworkWriteService } from "../services/artwork/CanonicalArtworkWriteService";
import {
    enrichLineItemWithEffectivePricing,
    mergePricingIntoSpecsJson,
    resolvePersistedLineItemPricing,
} from "../lib/lineItemPricingPersistence";
import {
    allocateJobNumber,
    isDocumentNumberUniqueViolation,
    toDocumentNumberConflictError,
} from "../services/documentNumberingService";
import {
    shouldApplyQuoteConversionProductionIntake,
    shouldCreateLegacyProductionJob,
    type ProductionIntakePolicy,
} from "../services/productionIntakePolicy";
import { defaultNewProductionArtworkAllocation } from "@shared/artworkAllocation";
import { resolveLineItemProofApprovalRequirement, resolveProofingPolicyFromOrgPreferences } from "@shared/proofApprovalLock";
import { resolveOrderCustomerIdForContact } from "@shared/orderCustomerResolution";
import { ensureOrderBackedInvoiceForOrderInTransaction } from "../invoicesService";
import { digitsOnlySearchTerm, normalizeOrderSearchTerm, orderSearchTokens, parseOrderSearchDate } from "../lib/orderListSearch";
import {
    buildInitialOrderStatusFields,
    CANONICAL_NEW_ORDER_STATUS,
    CANONICAL_NEW_ORDER_STATUS_PILL_KEY,
} from "../services/orders/initialOrderStatus";

type ProductionSummaryStatus = "none" | "clear" | "needs_handoff" | "partial" | "in_production" | "complete";

/** Stable errors for all direct, quote, inbound, and assistant order writes. */
export class OrderIdentityError extends Error {
    readonly statusCode = 400;
    constructor(readonly code: "ORDER_IDENTITY_REQUIRED" | "ORDER_CUSTOMER_NOT_FOUND" | "ORDER_CONTACT_NOT_FOUND" | "ORDER_CONTACT_CUSTOMER_CONFLICT", message: string) {
        super(message);
    }
}

type OrderProductionSummary = {
    requiredCount: number;
    handedOffCount: number;
    pendingHandoffCount: number;
    inProductionCount: number;
    completeCount: number;
    status: ProductionSummaryStatus;
    printerNames: string[];
    stationKeys: string[];
    stationLabel: string;
};

type OrderWithProofSummary = Order & {
    proofStatus?: OrderProofSummary["proofStatus"];
    proofStatusLabel?: string;
    proofActionRequired?: boolean;
    proofCounts?: OrderProofSummary["proofCounts"];
    proofLineItemId?: string | null;
};

function buildOrderSearchConditions(organizationId: string, rawSearch: unknown): any[] {
    const normalizedSearch = String(rawSearch ?? "").trim();
    if (!normalizedSearch) return [];

    const dueDate = parseOrderSearchDate(normalizedSearch);
    if (dueDate) return [gte(orders.dueDate, dueDate.start), sql`${orders.dueDate} < ${dueDate.end}`];

    return orderSearchTokens(normalizedSearch).map((token) => {
        const pattern = `%${token}%`;
        const normalizedPattern = `%${normalizeOrderSearchTerm(token)}%`;
        const digits = digitsOnlySearchTerm(token);
        const phoneCondition = digits.length >= 3
            ? sql`regexp_replace(coalesce(${customerContacts.phone}, ''), '\\D', '', 'g') like ${`%${digits}%`} or regexp_replace(coalesce(${customerContacts.mobile}, ''), '\\D', '', 'g') like ${`%${digits}%`}`
            : sql`false`;
        return or(
            ilike(orders.orderNumber, pattern),
            ilike(orders.displayNumber, pattern),
            sql`regexp_replace(lower(coalesce(${orders.displayNumber}, ${orders.orderNumber})), '[^a-z0-9]', '', 'g') like ${normalizedPattern}`,
            ilike(orders.poNumber, pattern),
            ilike(orders.label, pattern),
            ilike(orders.notesInternal, pattern),
            sql`exists (select 1 from ${orderListNotes} where ${orderListNotes.orderId} = ${orders.id} and ${orderListNotes.organizationId} = ${organizationId} and ${orderListNotes.listLabel} ilike ${pattern})`,
            sql`exists (select 1 from ${customers} where ${customers.id} = ${orders.customerId} and ${customers.organizationId} = ${organizationId} and (${customers.companyName} ilike ${pattern} or ${customers.email} ilike ${pattern} or regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${digits.length >= 3 ? `%${digits}%` : "__never_matches__"}))`,
            sql`exists (select 1 from ${customerContacts} where ${customerContacts.id} = ${orders.contactId} and ${customerContacts.organizationId} = ${organizationId} and (${customerContacts.firstName} ilike ${pattern} or ${customerContacts.lastName} ilike ${pattern} or concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName}) ilike ${pattern} or ${customerContacts.email} ilike ${pattern} or ${phoneCondition}))`,
            sql`exists (select 1 from ${orderLineItems} inner join ${products} on ${products.id} = ${orderLineItems.productId} and ${products.organizationId} = ${organizationId} where ${orderLineItems.orderId} = ${orders.id} and (${orderLineItems.description} ilike ${pattern} or ${products.name} ilike ${pattern} or ${products.shopName} ilike ${pattern} or ${products.description} ilike ${pattern} or ${products.category} ilike ${pattern}))`,
        );
    });
}

/**
 * Hard deletion is only permitted for disposable orders. Production records are
 * operational history, so operators must cancel or archive an order once any
 * production job, run, or run-member exists for it.
 */
export class OrderDeletionProtectedError extends Error {
    readonly code = "ORDER_DELETION_PRODUCTION_HISTORY" as const;
    readonly statusCode = 409;

    constructor(readonly details: {
        hasProductionJob: boolean;
        hasProductionRun: boolean;
        hasProductionRunMember: boolean;
    }) {
        super("Orders with production history cannot be deleted. Cancel or archive the order instead.");
    }
}

type OrderSnapshotFields = Pick<
    typeof orders.$inferInsert,
    | "billToName"
    | "billToCompany"
    | "billToAddress1"
    | "billToAddress2"
    | "billToCity"
    | "billToState"
    | "billToPostalCode"
    | "billToCountry"
    | "billToPhone"
    | "billToEmail"
    | "shippingMethod"
    | "shippingMode"
    | "shipToName"
    | "shipToCompany"
    | "shipToAddress1"
    | "shipToAddress2"
    | "shipToCity"
    | "shipToState"
    | "shipToPostalCode"
    | "shipToCountry"
    | "shipToPhone"
    | "shipToEmail"
    | "carrier"
    | "carrierAccountNumber"
    | "shippingInstructions"
>;

function cleanText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeShippingMethod(value: unknown): "pickup" | "ship" | "deliver" | null {
    const normalized = cleanText(value)?.toLowerCase();
    if (!normalized) return null;
    if (normalized === "pickup") return "pickup";
    if (normalized === "deliver" || normalized === "delivery") return "deliver";
    if (normalized === "ship" || normalized === "shipping") return "ship";
    return null;
}

function normalizeShippingMode(value: unknown): "single_shipment" | "multi_shipment" {
    const normalized = cleanText(value)?.toLowerCase();
    return normalized === "multi_shipment" ? "multi_shipment" : "single_shipment";
}

function contactName(contact: typeof customerContacts.$inferSelect | null | undefined): string | null {
    if (!contact) return null;
    return cleanText(`${contact.firstName || ""} ${contact.lastName || ""}`) ?? cleanText((contact as any).name);
}

function buildOrderSnapshotFromQuote(args: {
    quote: typeof quotes.$inferSelect;
    customer?: typeof customers.$inferSelect | null;
    contact?: typeof customerContacts.$inferSelect | null;
}): OrderSnapshotFields {
    const { quote, customer, contact } = args;
    const billToName =
        cleanText(quote.billToName) ??
        contactName(contact) ??
        cleanText(quote.customerName) ??
        cleanText(customer?.companyName);
    const billToCompany =
        cleanText(quote.billToCompany) ??
        cleanText(customer?.companyName) ??
        cleanText(quote.customerName);
    const shippingMethod = normalizeShippingMethod(quote.shippingMethod) ?? "ship";
    const shippingMode = normalizeShippingMode(quote.shippingMode);

    const billToAddress1 = cleanText(quote.billToAddress1) ?? cleanText(customer?.billingStreet1) ?? cleanText(customer?.billingAddress);
    const billToAddress2 = cleanText(quote.billToAddress2) ?? cleanText(customer?.billingStreet2);
    const billToCity = cleanText(quote.billToCity) ?? cleanText(customer?.billingCity);
    const billToState = cleanText(quote.billToState) ?? cleanText(customer?.billingState);
    const billToPostalCode = cleanText(quote.billToPostalCode) ?? cleanText(customer?.billingPostalCode);
    const billToCountry = cleanText(quote.billToCountry) ?? cleanText(customer?.billingCountry) ?? "US";
    const billToPhone = cleanText(quote.billToPhone) ?? cleanText(customer?.phone);
    const billToEmail = cleanText(quote.billToEmail) ?? cleanText(contact?.email) ?? cleanText(customer?.email);

    const pickupUsesBilling = shippingMethod === "pickup";
    const shipToName = cleanText(quote.shipToName) ?? (pickupUsesBilling ? billToName : null) ?? billToName;
    const shipToCompany = cleanText(quote.shipToCompany) ?? (pickupUsesBilling ? billToCompany : null) ?? billToCompany;
    const shipToAddress1 =
        cleanText(quote.shipToAddress1) ??
        (pickupUsesBilling ? billToAddress1 : null) ??
        cleanText(customer?.shippingStreet1) ??
        cleanText(customer?.shippingAddress) ??
        billToAddress1;
    const shipToAddress2 =
        cleanText(quote.shipToAddress2) ??
        (pickupUsesBilling ? billToAddress2 : null) ??
        cleanText(customer?.shippingStreet2) ??
        billToAddress2;
    const shipToCity =
        cleanText(quote.shipToCity) ??
        (pickupUsesBilling ? billToCity : null) ??
        cleanText(customer?.shippingCity) ??
        billToCity;
    const shipToState =
        cleanText(quote.shipToState) ??
        (pickupUsesBilling ? billToState : null) ??
        cleanText(customer?.shippingState) ??
        billToState;
    const shipToPostalCode =
        cleanText(quote.shipToPostalCode) ??
        (pickupUsesBilling ? billToPostalCode : null) ??
        cleanText(customer?.shippingPostalCode) ??
        billToPostalCode;
    const shipToCountry =
        cleanText(quote.shipToCountry) ??
        (pickupUsesBilling ? billToCountry : null) ??
        cleanText(customer?.shippingCountry) ??
        billToCountry;

    return {
        billToName,
        billToCompany,
        billToAddress1,
        billToAddress2,
        billToCity,
        billToState,
        billToPostalCode,
        billToCountry,
        billToPhone,
        billToEmail,
        shippingMethod,
        shippingMode,
        shipToName,
        shipToCompany,
        shipToAddress1,
        shipToAddress2,
        shipToCity,
        shipToState,
        shipToPostalCode,
        shipToCountry,
        shipToPhone: cleanText(quote.shipToPhone) ?? billToPhone,
        shipToEmail: cleanText(quote.shipToEmail) ?? billToEmail,
        carrier: cleanText(quote.carrier),
        carrierAccountNumber: cleanText(quote.carrierAccountNumber),
        shippingInstructions: cleanText(quote.shippingInstructions),
    };
}

function validateOrderSnapshotForConversion(snapshot: OrderSnapshotFields) {
    const errors: Array<{ code: string; message: string; field: string }> = [];
    if (!snapshot.billToName && !snapshot.billToCompany) {
        errors.push({
            code: "MISSING_BILLING_IDENTITY",
            field: "billToName",
            message: "Billing name or company is required before converting a quote to an order.",
        });
    }
    if (!snapshot.shippingMethod) {
        errors.push({
            code: "MISSING_FULFILLMENT_METHOD",
            field: "shippingMethod",
            message: "Fulfillment method is required before converting a quote to an order.",
        });
    }
    if (snapshot.shippingMethod !== "pickup" && !snapshot.shipToName && !snapshot.shipToCompany) {
        errors.push({
            code: "MISSING_SHIPPING_IDENTITY",
            field: "shipToName",
            message: "Shipping/delivery name or company is required for non-pickup orders.",
        });
    }

    if (errors.length > 0) {
        throw Object.assign(new Error("Quote cannot be converted until required order snapshot fields are complete."), {
            statusCode: 400,
            code: "QUOTE_CONVERSION_MISSING_ORDER_SNAPSHOT",
            errors,
        });
    }
}

const ORDER_ATTACHMENT_SAFE_SELECT = {
    id: orderAttachments.id,
    fileRecordId: orderAttachments.fileRecordId,
    orderId: orderAttachments.orderId,
    orderLineItemId: orderAttachments.orderLineItemId,
    quoteId: orderAttachments.quoteId,
    uploadedByUserId: orderAttachments.uploadedByUserId,
    uploadedByName: orderAttachments.uploadedByName,
    fileName: orderAttachments.fileName,
    fileUrl: orderAttachments.fileUrl,
    fileSize: orderAttachments.fileSize,
    mimeType: orderAttachments.mimeType,
    description: orderAttachments.description,
    originalFilename: orderAttachments.originalFilename,
    storedFilename: orderAttachments.storedFilename,
    relativePath: orderAttachments.relativePath,
    storageProvider: orderAttachments.storageProvider,
    extension: orderAttachments.extension,
    sizeBytes: orderAttachments.sizeBytes,
    checksum: orderAttachments.checksum,
    thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
    thumbnailGeneratedAt: orderAttachments.thumbnailGeneratedAt,
    thumbKey: orderAttachments.thumbKey,
    previewKey: orderAttachments.previewKey,
    role: orderAttachments.role,
    side: orderAttachments.side,
    isPrimary: orderAttachments.isPrimary,
    thumbnailUrl: orderAttachments.thumbnailUrl,
    createdAt: orderAttachments.createdAt,
    updatedAt: orderAttachments.updatedAt,
} as const;

export type CreateOrderLineItemInput = Omit<InsertOrderLineItem, 'orderId' | 'requiresProofApproval'> & {
    requiresProofApproval?: boolean;
    variantId?: string | null;
    productName?: string | null;
    unit_price?: number | string | null;
    total_price?: number | string | null;
    linePrice?: number | string | null;
    line_price?: number | string | null;
    priceOverride?: any;
};

function formatProductionStationLabel(value: unknown): string {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return "Unassigned";
    if (normalized === "wide_roll" || normalized === "roll") return "Roll";
    if (normalized === "flatbed") return "Flatbed";
    if (normalized === "prepress") return "Prepress";
    if (normalized === "design") return "Design";
    if (normalized === "fulfillment") return "Fulfillment";
    return normalized
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") || "Unassigned";
}

export class OrdersRepository {
    constructor(
        private readonly dbInstance = db,
        private readonly atomicConversionScoped = false,
    ) { }

    withExecutor(executor: any, atomicConversionScoped = false): OrdersRepository {
        return new OrdersRepository(executor as typeof db, atomicConversionScoped);
    }

    private normalizeWorkflowStateForSummary(value: unknown): string {
        const normalized = String(value ?? "").trim().toLowerCase();
        if (!normalized) return "new";

        if (normalized === "complete") return "completed";
        return normalized;
    }

    private async buildProductionSummaries(organizationId: string, orderIds: string[]) {
        const summaries = new Map<string, OrderProductionSummary>();
        if (!orderIds.length) return summaries;

        const lineItems = await this.dbInstance
            .select({
                orderId: orderLineItems.orderId,
                lineItemId: orderLineItems.id,
                workflowState: orderLineItems.workflowState,
                status: orderLineItems.status,
                requiresProductionJob: products.requiresProductionJob,
                workflowIntent: products.workflowIntent,
            })
            .from(orderLineItems)
            .innerJoin(products, eq(orderLineItems.productId, products.id))
            .where(inArray(orderLineItems.orderId, orderIds));

        const lineItemIds = lineItems.map((lineItem) => String(lineItem.lineItemId));
        const activeOwners = lineItemIds.length > 0
            ? await resolveActiveProductionOwners(this.dbInstance, {
                organizationId,
                lineItemIds,
                debugLabel: "OrdersRepository.buildProductionSummaries",
            })
            : new Map<string, any>();
        const printerRows = await this.dbInstance
            .select({
                orderId: productionJobs.orderId,
                assignedPrinterName: productionJobs.assignedPrinterName,
            })
            .from(productionJobs)
            .where(and(
                eq(productionJobs.organizationId, organizationId),
                inArray(productionJobs.orderId, orderIds),
                sql`LOWER(COALESCE(${productionJobs.stationKey}, '')) NOT IN ('prepress', 'design', 'fulfillment')`,
            ));
        const printerNamesByOrder = new Map<string, string[]>();
        for (const row of printerRows) {
            const name = String(row.assignedPrinterName || "").trim();
            if (!name) continue;
            const list = printerNamesByOrder.get(row.orderId) ?? [];
            if (!list.some((existing) => existing.toLowerCase() === name.toLowerCase())) list.push(name);
            printerNamesByOrder.set(row.orderId, list);
        }

        const terminalStates = new Set(["completed", "canceled"]);
        const readyStates = new Set(["ready_for_prepress", "ready_for_production"]);
        const activePipelineStates = new Set(["in_prepress", "in_production"]);

        for (const orderId of orderIds) {
            summaries.set(orderId, {
                requiredCount: 0,
                handedOffCount: 0,
                pendingHandoffCount: 0,
                inProductionCount: 0,
                completeCount: 0,
                status: "none",
                printerNames: printerNamesByOrder.get(orderId) ?? [],
                stationKeys: [],
                stationLabel: "Unassigned",
            });
        }

        for (const lineItem of lineItems) {
            if (lineItem.requiresProductionJob !== true || lineItem.workflowIntent === "service_fee") continue;

            const orderId = String(lineItem.orderId);
            const summary = summaries.get(orderId);
            if (!summary) continue;

            summary.requiredCount += 1;

            const workflowState = this.normalizeWorkflowStateForSummary(lineItem.workflowState ?? lineItem.status);
            const activeOwner = activeOwners.get(String(lineItem.lineItemId));
            const hasActiveOwner = !!activeOwner;
            if (hasActiveOwner) {
                const stationKey = String(activeOwner.stationKey || "").trim();
                if (stationKey && !summary.stationKeys.includes(stationKey)) {
                    summary.stationKeys.push(stationKey);
                }
            }

            if (terminalStates.has(workflowState)) {
                summary.completeCount += 1;
                summary.handedOffCount += 1;
                continue;
            }

            if (readyStates.has(workflowState)) {
                if (hasActiveOwner) {
                    summary.handedOffCount += 1;
                    summary.inProductionCount += 1;
                } else {
                    summary.pendingHandoffCount += 1;
                }
                continue;
            }

            if (activePipelineStates.has(workflowState) && hasActiveOwner) {
                summary.handedOffCount += 1;
                summary.inProductionCount += 1;
            }
        }

        for (const summary of Array.from(summaries.values())) {
            summary.stationLabel = summary.stationKeys.length > 0
                ? summary.stationKeys.map((key) => formatProductionStationLabel(key)).join(", ")
                : (summary.status === "complete" ? "Completed" : "Unassigned");

            if (summary.requiredCount === 0) {
                summary.status = "none";
                summary.stationLabel = "Unassigned";
                continue;
            }

            if (summary.completeCount === summary.requiredCount) {
                summary.status = "complete";
                summary.stationLabel = "Completed";
                continue;
            }

            if (summary.pendingHandoffCount > 0 && summary.handedOffCount === 0 && summary.inProductionCount === 0) {
                summary.status = "needs_handoff";
                continue;
            }

            if (summary.pendingHandoffCount > 0) {
                summary.status = "partial";
                continue;
            }

            if (summary.inProductionCount > 0) {
                summary.status = "in_production";
                continue;
            }

            summary.status = "clear";
        }

        return summaries;
    }

    private async buildProofSummaries(organizationId: string, orderIds: string[]) {
        const orderSummaries = new Map<string, OrderProofSummary>();
        const lineItemSummaries = new Map<string, LineItemProofSummary>();

        if (!orderIds.length) {
            return { orderSummaries, lineItemSummaries };
        }

        const lineItems = await this.dbInstance
            .select({
                orderId: orderLineItems.orderId,
                lineItemId: orderLineItems.id,
                requiresProofApproval: orderLineItems.requiresProofApproval,
                approvedProofVersionId: orderLineItems.approvedProofVersionId,
            })
            .from(orderLineItems)
            .where(inArray(orderLineItems.orderId, orderIds));

        const lineItemIds = lineItems.map((lineItem) => String(lineItem.lineItemId));

        if (!lineItemIds.length) {
            for (const orderId of orderIds) {
                orderSummaries.set(orderId, deriveOrderProofSummary([]));
            }
            return { orderSummaries, lineItemSummaries };
        }

        const [versions, approvals, overrides] = await Promise.all([
            this.dbInstance
                .select({
                    lineItemId: lineItemProofVersions.lineItemId,
                    id: lineItemProofVersions.id,
                    status: lineItemProofVersions.status,
                    sentAt: lineItemProofVersions.sentAt,
                    versionNumber: lineItemProofVersions.versionNumber,
                    createdAt: lineItemProofVersions.createdAt,
                })
                .from(lineItemProofVersions)
                .where(
                    and(
                        eq(lineItemProofVersions.organizationId, organizationId),
                        inArray(lineItemProofVersions.lineItemId, lineItemIds),
                    ),
                )
                .orderBy(desc(lineItemProofVersions.versionNumber), desc(lineItemProofVersions.createdAt)),
            this.dbInstance
                .select({
                    lineItemId: lineItemProofApprovals.lineItemId,
                    proofVersionId: lineItemProofApprovals.proofVersionId,
                    decision: lineItemProofApprovals.decision,
                    respondedAt: lineItemProofApprovals.respondedAt,
                    createdAt: lineItemProofApprovals.createdAt,
                })
                .from(lineItemProofApprovals)
                .where(
                    and(
                        eq(lineItemProofApprovals.organizationId, organizationId),
                        inArray(lineItemProofApprovals.lineItemId, lineItemIds),
                    ),
                )
                .orderBy(desc(lineItemProofApprovals.respondedAt), desc(lineItemProofApprovals.createdAt)),
            this.dbInstance
                .select({
                    lineItemId: lineItemProofManualApprovalOverrides.lineItemId,
                    proofVersionId: lineItemProofManualApprovalOverrides.proofVersionId,
                    overriddenAt: lineItemProofManualApprovalOverrides.overriddenAt,
                    createdAt: lineItemProofManualApprovalOverrides.createdAt,
                })
                .from(lineItemProofManualApprovalOverrides)
                .where(
                    and(
                        eq(lineItemProofManualApprovalOverrides.organizationId, organizationId),
                        inArray(lineItemProofManualApprovalOverrides.lineItemId, lineItemIds),
                    ),
                )
                .orderBy(desc(lineItemProofManualApprovalOverrides.overriddenAt), desc(lineItemProofManualApprovalOverrides.createdAt)),
        ]);

        const versionsByLineItem = new Map<string, typeof versions>();
        for (const version of versions) {
            const key = String(version.lineItemId);
            const bucket = versionsByLineItem.get(key) ?? [];
            bucket.push(version);
            versionsByLineItem.set(key, bucket);
        }

        const approvalsByLineItem = new Map<string, typeof approvals>();
        for (const approval of approvals) {
            const key = String(approval.lineItemId);
            const bucket = approvalsByLineItem.get(key) ?? [];
            bucket.push(approval);
            approvalsByLineItem.set(key, bucket);
        }

        const overridesByLineItem = new Map<string, typeof overrides>();
        for (const override of overrides) {
            const key = String(override.lineItemId);
            const bucket = overridesByLineItem.get(key) ?? [];
            bucket.push(override);
            overridesByLineItem.set(key, bucket);
        }

        const lineItemsByOrderId = new Map<string, LineItemProofSummary[]>();
        for (const lineItem of lineItems) {
            const lineItemId = String(lineItem.lineItemId);
            const orderId = String(lineItem.orderId);
            const lineVersions = versionsByLineItem.get(lineItemId) ?? [];
            const lineApprovals = approvalsByLineItem.get(lineItemId) ?? [];
            const lineOverrides = overridesByLineItem.get(lineItemId) ?? [];
            const approvedProofVersionId = lineItem.approvedProofVersionId ? String(lineItem.approvedProofVersionId) : null;
            const currentActionableVersion = lineVersions.find((version) => version.status === "draft" || version.status === "awaiting_response") ?? null;
            const latestVersion = lineVersions[0] ?? null;
            const latestDecision = lineApprovals[0]?.decision ?? null;
            const approvedNormally = approvedProofVersionId
                ? lineApprovals.some((approval) => approval.proofVersionId === approvedProofVersionId && approval.decision === "approved")
                : false;
            const approvedByOverride = approvedProofVersionId
                ? lineOverrides.some((override) => override.proofVersionId === approvedProofVersionId)
                : false;
            const lineSummary = deriveLineItemProofSummary({
                lineItemId,
                requiresProofApproval: Boolean(lineItem.requiresProofApproval),
                approvedProofVersionId,
                currentActionableProofVersionStatus: currentActionableVersion?.status ?? null,
                latestProofVersionStatus: latestVersion?.status ?? null,
                latestDecision,
                hasAnyProofVersion: lineVersions.length > 0,
                hasSentProofVersion: lineVersions.some((version) => Boolean(version.sentAt) || version.status !== "draft"),
                approvedNormally,
                approvedByOverride,
            });

            lineItemSummaries.set(lineItemId, lineSummary);

            const bucket = lineItemsByOrderId.get(orderId) ?? [];
            bucket.push(lineSummary);
            lineItemsByOrderId.set(orderId, bucket);
        }

        for (const orderId of orderIds) {
            orderSummaries.set(orderId, deriveOrderProofSummary(lineItemsByOrderId.get(orderId) ?? []));
        }

        return { orderSummaries, lineItemSummaries };
    }

    private async getDesignConfigMap(organizationId: string, productIds: string[], executor: any = this.dbInstance) {
        const configs = await productDesignConfigRepository.listByProductIds(organizationId, Array.from(new Set(productIds)), executor);
        return new Map(configs.map((config) => [config.productId, config]));
    }

    private async resolvePreviewThumbnailUrl(att: { fileRecordId?: string | null; thumbKey?: string | null; previewKey?: string | null }) {
        const previewAccess = await resolveDerivativeFileAccess(att, "preview");
        if (previewAccess.url) return previewAccess.url;

        const thumbAccess = await resolveDerivativeFileAccess(att, "thumbnail");
        return thumbAccess.url ?? null;
    }

    private async generateNextOrderNumber(organizationId: string, tx?: any): Promise<{ jobNumber: number; orderNumber: string; displayNumber: string; numberCore: number }> {
        const executor = tx || this.dbInstance;
        const jobNumber = await allocateJobNumber(organizationId, executor);
        return { jobNumber, orderNumber: jobNumber.toString(), displayNumber: String(jobNumber), numberCore: jobNumber };
    }

    async getMaxOrderNumber(organizationId: string): Promise<number | null> {
        const result = await this.dbInstance.execute(
            sql`SELECT MAX(COALESCE(number_core, CASE WHEN order_number ~ '^[0-9]+$' THEN order_number::integer ELSE NULL END)) AS max_num FROM orders WHERE organization_id = ${organizationId}`
        );
        const val = (result as any).rows?.[0]?.max_num;
        return val != null ? Number(val) : null;
    }

    private async getPreviewThumbnailsForOrderIds(organizationId: string, orderIds: string[]) {
        const previewData: Map<string, {
            thumbnails: string[];
            totalCount: number;
            previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }>;
        }> = new Map();
        if (!orderIds.length) return previewData;

        // Query orderAttachments with thumb_ready status (matches Quotes pattern exactly)
        // Join with orders for organizationId filtering since order_attachments doesn't have org column
        const attachmentsQuery = await this.dbInstance
            .select({
                id: orderAttachments.id,
                fileRecordId: orderAttachments.fileRecordId,
                orderId: orderAttachments.orderId,
                fileName: orderAttachments.fileName,
                originalFilename: orderAttachments.originalFilename,
                mimeType: orderAttachments.mimeType,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
            .where(
                and(
                    inArray(orderAttachments.orderId, orderIds),
                    eq(orders.organizationId, organizationId)
                )
            )
            .orderBy(orderAttachments.createdAt);

        const groupedAttachments = new Map<string, string[]>();
        const groupedPreviews = new Map<string, Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }>>();
        const countMap = new Map<string, number>();

        const resolvedRows = await Promise.all(attachmentsQuery.map(async (att) => {
            return {
                id: String(att.id),
                orderId: att.orderId,
                filename: String(att.originalFilename ?? att.fileName ?? "Attachment"),
                mimeType: att.mimeType ?? null,
                thumbnailUrl: await this.resolvePreviewThumbnailUrl(att),
            };
        }));

        for (const att of resolvedRows) {
            countMap.set(att.orderId, (countMap.get(att.orderId) || 0) + 1);
            if (!att.thumbnailUrl) continue;
            if (!groupedAttachments.has(att.orderId)) {
                groupedAttachments.set(att.orderId, []);
            }
            const group = groupedAttachments.get(att.orderId)!;
            if (group.length < 3) {
                group.push(att.thumbnailUrl);
            }

            if (!groupedPreviews.has(att.orderId)) {
                groupedPreviews.set(att.orderId, []);
            }
            const previewGroup = groupedPreviews.get(att.orderId)!;
            if (previewGroup.length < 3) {
                previewGroup.push({
                    id: att.id,
                    filename: att.filename,
                    mimeType: att.mimeType,
                    thumbnailUrl: att.thumbnailUrl,
                });
            }
        }

        // Populate previewData for all requested orders.
        // Thumbnails are only from thumb_ready attachments, but totalCount is ALL attachments.
        for (const orderIdKey of orderIds) {
            const thumbnails = groupedAttachments.get(orderIdKey) || [];
            previewData.set(orderIdKey, {
                thumbnails,
                totalCount: countMap.get(orderIdKey) || 0,
                previews: groupedPreviews.get(orderIdKey) || [],
            });
        }

        return previewData;
    }

    async getAllOrdersPaginated(organizationId: string, opts: {
        search?: string;
        status?: string;
        state?: string;
        statusPillId?: string;
        statusPillIds?: string[];
        priority?: string;
        customerId?: string;
        startDate?: string;
        endDate?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
        page: number;
        pageSize: number;
        includeThumbnails: boolean;
    }): Promise<{
        items: Array<OrderWithProofSummary & {
            customer: any;
            contact: any;
            lineItemsCount: number;
            productionSummary?: OrderProductionSummary;
            previewThumbnails?: string[];
            thumbsCount?: number;
            attachmentsSummary?: {
                totalCount: number;
                previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }>;
            };
            listLabel?: string | null;
            invoiceState?: OrderInvoiceStateSummary;
        }>;
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    }> {
        const page = Math.max(1, opts.page);
        const pageSize = Math.min(200, Math.max(1, opts.pageSize));
        const offset = (page - 1) * pageSize;

        const conditions = [eq(orders.organizationId, organizationId)] as any[];
        conditions.push(...buildOrderSearchConditions(organizationId, opts.search));
        if (opts.status) conditions.push(eq(orders.status, opts.status));
        if (opts.state) conditions.push(eq(orders.state, opts.state));
        if (opts.statusPillId) conditions.push(eq(orders.statusPillId, opts.statusPillId));
        if (opts.statusPillIds !== undefined) {
            conditions.push(opts.statusPillIds.length > 0
                ? inArray(orders.statusPillId, opts.statusPillIds)
                : sql`false`);
        }
        if (opts.priority) conditions.push(eq(orders.priority, opts.priority));
        if (opts.customerId) conditions.push(eq(orders.customerId, opts.customerId));
        if (opts.startDate) conditions.push(gte(orders.createdAt, opts.startDate));
        if (opts.endDate) conditions.push(lte(orders.createdAt, opts.endDate));

        const whereClause = and(...conditions);

        // Determine order by
        let orderByClause = desc(orders.createdAt);
        if (opts.sortBy) {
            const dir = opts.sortDir === 'asc' ? 'asc' : 'desc';
            // This mirrors deriveOrderProofSummary's status priority in SQL so
            // paging happens after, not before, the canonical order-level sort.
            const proofSortRank = sql<number>`(
                select coalesce(min(
                    case
                        when not proof_sort_lines.requires_proof_approval then null
                        when proof_sort_lines.approved_proof_version_id is not null then 4
                        when (
                            select proof_sort_approvals.decision
                            from ${lineItemProofApprovals} as proof_sort_approvals
                            where proof_sort_approvals.organization_id = ${organizationId}
                              and proof_sort_approvals.line_item_id = proof_sort_lines.id
                            order by proof_sort_approvals.responded_at desc, proof_sort_approvals.created_at desc
                            limit 1
                        ) = 'approved' then 4
                        when (
                            select proof_sort_versions.status
                            from ${lineItemProofVersions} as proof_sort_versions
                            where proof_sort_versions.organization_id = ${organizationId}
                              and proof_sort_versions.line_item_id = proof_sort_lines.id
                            order by proof_sort_versions.version_number desc, proof_sort_versions.created_at desc
                            limit 1
                        ) = 'approved' then 4
                        when (
                            select proof_sort_actionable.status
                            from ${lineItemProofVersions} as proof_sort_actionable
                            where proof_sort_actionable.organization_id = ${organizationId}
                              and proof_sort_actionable.line_item_id = proof_sort_lines.id
                              and proof_sort_actionable.status in ('draft', 'awaiting_response')
                            order by proof_sort_actionable.version_number desc, proof_sort_actionable.created_at desc
                            limit 1
                        ) = 'draft' then 2
                        when (
                            select proof_sort_versions.status
                            from ${lineItemProofVersions} as proof_sort_versions
                            where proof_sort_versions.organization_id = ${organizationId}
                              and proof_sort_versions.line_item_id = proof_sort_lines.id
                            order by proof_sort_versions.version_number desc, proof_sort_versions.created_at desc
                            limit 1
                        ) = 'draft' then 2
                        when (
                            select proof_sort_approvals.decision
                            from ${lineItemProofApprovals} as proof_sort_approvals
                            where proof_sort_approvals.organization_id = ${organizationId}
                              and proof_sort_approvals.line_item_id = proof_sort_lines.id
                            order by proof_sort_approvals.responded_at desc, proof_sort_approvals.created_at desc
                            limit 1
                        ) in ('rejected', 'revision_requested') then 0
                        when (
                            select proof_sort_versions.status
                            from ${lineItemProofVersions} as proof_sort_versions
                            where proof_sort_versions.organization_id = ${organizationId}
                              and proof_sort_versions.line_item_id = proof_sort_lines.id
                            order by proof_sort_versions.version_number desc, proof_sort_versions.created_at desc
                            limit 1
                        ) in ('rejected', 'revision_requested') then 0
                        when (
                            select proof_sort_actionable.status
                            from ${lineItemProofVersions} as proof_sort_actionable
                            where proof_sort_actionable.organization_id = ${organizationId}
                              and proof_sort_actionable.line_item_id = proof_sort_lines.id
                              and proof_sort_actionable.status in ('draft', 'awaiting_response')
                            order by proof_sort_actionable.version_number desc, proof_sort_actionable.created_at desc
                            limit 1
                        ) = 'awaiting_response' then 3
                        when exists (
                            select 1
                            from ${lineItemProofVersions} as proof_sort_sent
                            where proof_sort_sent.organization_id = ${organizationId}
                              and proof_sort_sent.line_item_id = proof_sort_lines.id
                              and (proof_sort_sent.sent_at is not null or proof_sort_sent.status <> 'draft')
                        ) then 3
                        else 1
                    end
                ), 5)
                from ${orderLineItems} as proof_sort_lines
                where proof_sort_lines.order_id = ${orders.id}
            )`;
            switch (opts.sortBy) {
                case 'orderNumber':
                    orderByClause = dir === 'asc'
                        ? sql`COALESCE(${orders.numberCore}, CASE WHEN ${orders.orderNumber} ~ '^[0-9]+$' THEN ${orders.orderNumber}::integer ELSE NULL END) ASC NULLS LAST`
                        : sql`COALESCE(${orders.numberCore}, CASE WHEN ${orders.orderNumber} ~ '^[0-9]+$' THEN ${orders.orderNumber}::integer ELSE NULL END) DESC NULLS LAST`;
                    break;
                case 'customer':
                    orderByClause = dir === 'asc'
                        ? sql`coalesce(${customers.companyName}, nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')) ASC NULLS LAST`
                        : sql`coalesce(${customers.companyName}, nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')) DESC NULLS LAST`;
                    break;
                case 'total':
                    orderByClause = dir === 'asc' ? sql`${orders.total}::numeric ASC` : sql`${orders.total}::numeric DESC`;
                    break;
                case 'dueDate':
                    orderByClause = dir === 'asc' ? sql`${orders.dueDate} ASC NULLS LAST` : sql`${orders.dueDate} DESC NULLS LAST`;
                    break;
                case 'status':
                    orderByClause = dir === 'asc' ? sql`${orders.status} ASC` : sql`${orders.status} DESC`;
                    break;
                case 'priority':
                    orderByClause = dir === 'asc' ? sql`${orders.priority} ASC` : sql`${orders.priority} DESC`;
                    break;
                case 'proof':
                    orderByClause = dir === 'asc'
                        ? sql`${proofSortRank} ASC, ${orders.createdAt} DESC`
                        : sql`${proofSortRank} DESC, ${orders.createdAt} DESC`;
                    break;
                case 'label':
                    orderByClause = dir === 'asc' ? sql`${orders.label} ASC NULLS LAST` : sql`${orders.label} DESC NULLS LAST`;
                    break;
                default:
                    orderByClause = desc(orders.createdAt);
            }
        }

        const [{ totalCount }] = await this.dbInstance
            .select({ totalCount: sql<number>`count(*)::int` })
            .from(orders)
            .where(whereClause);

        const rows = await this.dbInstance
            .select({
                order: orders,
                customerCompanyName: customers.companyName,
                customer: customers,
                contact: customerContacts,
                lineItemsCount: sql<number>`(
                    select count(*)::int from ${orderLineItems}
                    where ${orderLineItems.orderId} = ${orders.id}
                )`,
            })
            .from(orders)
            .leftJoin(
                customers,
                and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId))
            )
            .leftJoin(
                customerContacts,
                and(eq(customerContacts.id, orders.contactId), eq(customerContacts.organizationId, organizationId))
            )
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(pageSize)
            .offset(offset);

        const orderIds = rows.map((r) => r.order.id);
        const productionSummaries = await this.buildProductionSummaries(organizationId, orderIds);
        const { orderSummaries } = await this.buildProofSummaries(organizationId, orderIds);
        const invoiceRows = orderIds.length > 0
            ? await this.dbInstance.select({
                orderId: invoices.orderId,
                status: invoices.status,
                dueDate: invoices.dueDate,
                lastSentAt: invoices.lastSentAt,
                amountPaid: invoices.amountPaid,
                balanceDue: invoices.balanceDue,
                total: invoices.total,
            }).from(invoices).where(and(
                eq(invoices.organizationId, organizationId),
                inArray(invoices.orderId, orderIds),
            ))
            : [];
        const invoicesByOrderId = new Map<string, typeof invoiceRows>();
        for (const invoice of invoiceRows) {
            if (!invoice.orderId) continue;
            const existing = invoicesByOrderId.get(invoice.orderId) ?? [];
            existing.push(invoice);
            invoicesByOrderId.set(invoice.orderId, existing);
        }
        let previewData = new Map<string, {
            thumbnails: string[];
            totalCount: number;
            previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }>;
        }>();
        
        if (opts.includeThumbnails) {
            try {
                previewData = await this.getPreviewThumbnailsForOrderIds(organizationId, orderIds);
            } catch (error: any) {
                console.error('[orders] thumbnails disabled/fallback due to error:', error.message);
                // Fail-soft: return empty thumbnails instead of crashing
                previewData = new Map();
            }
        }

        // Fetch list notes for all orders in this page
        const { orderListNotes } = await import("@shared/schema");
        const listNotesResult = await this.dbInstance
            .select({
                orderId: orderListNotes.orderId,
                listLabel: orderListNotes.listLabel,
            })
            .from(orderListNotes)
            .where(
                and(
                    eq(orderListNotes.organizationId, organizationId),
                    inArray(orderListNotes.orderId, orderIds)
                )
            );

        const listNotesMap = new Map<string, string | null>();
        for (const note of listNotesResult) {
            listNotesMap.set(note.orderId, note.listLabel);
        }

        const items = rows.map(({ order, customer, contact, lineItemsCount }) => ({
            ...order,
            customer,
            contact,
            lineItemsCount,
            productionSummary: productionSummaries.get(order.id) ?? {
                requiredCount: 0,
                handedOffCount: 0,
                pendingHandoffCount: 0,
                inProductionCount: 0,
                completeCount: 0,
                status: "none",
                printerNames: [],
                stationKeys: [],
                stationLabel: "Unassigned",
            },
            previewThumbnails: previewData.get(order.id)?.thumbnails || [],
            thumbsCount: previewData.get(order.id)?.totalCount || 0,
            attachmentsSummary: previewData.get(order.id)
                ? {
                    totalCount: previewData.get(order.id)?.totalCount || 0,
                    previews: previewData.get(order.id)?.previews || [],
                }
                : { totalCount: 0, previews: [] },
            listLabel: listNotesMap.get(order.id) || null,
            invoiceState: deriveOrderInvoiceState({
                billingStatus: order.billingStatus,
                invoices: invoicesByOrderId.get(order.id) ?? [],
            }),
            proofStatus: orderSummaries.get(order.id)?.proofStatus ?? "no_proof_required",
            proofStatusLabel: orderSummaries.get(order.id)?.proofStatusLabel ?? "No Proof Needed",
            proofActionRequired: orderSummaries.get(order.id)?.proofActionRequired ?? false,
            proofCounts: orderSummaries.get(order.id)?.proofCounts ?? {
                required: 0,
                needed: 0,
                draftNotSent: 0,
                awaitingApproval: 0,
                approved: 0,
                issue: 0,
            },
            proofLineItemId: orderSummaries.get(order.id)?.proofLineItemId ?? null,
        }));

        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        return {
            items,
            page,
            pageSize,
            totalCount,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        };
    }

    async getAllOrders(organizationId: string, filters?: {
        search?: string;
        status?: string;
        priority?: string;
        customerId?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<OrderWithProofSummary & { productionSummary?: OrderProductionSummary }>> {
        const conditions = [eq(orders.organizationId, organizationId)] as any[];
        if (filters?.search) {
            const pattern = `%${filters.search}%`;
            conditions.push(or(
                ilike(orders.orderNumber, pattern),
                ilike(orders.poNumber, pattern),
                ilike(orders.label, pattern),
                ilike(orders.notesInternal, pattern)
            ));
        }
        if (filters?.status) conditions.push(eq(orders.status, filters.status));
        if (filters?.priority) conditions.push(eq(orders.priority, filters.priority));
        if (filters?.customerId) conditions.push(eq(orders.customerId, filters.customerId));
        if (filters?.startDate) conditions.push(gte(orders.createdAt, filters.startDate.toISOString()));
        if (filters?.endDate) conditions.push(lte(orders.createdAt, filters.endDate.toISOString()));

        let query = this.dbInstance.select().from(orders) as any;
        query = query.where(and(...conditions));
        query = query.orderBy(desc(orders.createdAt));
        const rows = await query;
        const productionSummaries = await this.buildProductionSummaries(
            organizationId,
            rows.map((order: Order) => order.id),
        );
        const { orderSummaries } = await this.buildProofSummaries(
            organizationId,
            rows.map((order: Order) => order.id),
        );

        // Enrich orders with customer and contact data
        const enrichedOrders = await Promise.all(rows.map(async (order: Order) => {
            const [customer] = order.customerId
                ? await this.dbInstance.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.organizationId, organizationId)))
                : [undefined];

            const [contact] = order.contactId
                ? await this.dbInstance.select().from(customerContacts).where(and(eq(customerContacts.id, order.contactId), eq(customerContacts.organizationId, organizationId)))
                : [undefined];

            return {
                ...order,
                customer,
                contact,
                productionSummary: productionSummaries.get(order.id) ?? {
                    requiredCount: 0,
                    handedOffCount: 0,
                    pendingHandoffCount: 0,
                    inProductionCount: 0,
                    completeCount: 0,
                    status: "none",
                    printerNames: [],
                    stationKeys: [],
                    stationLabel: "Unassigned",
                },
                proofStatus: orderSummaries.get(order.id)?.proofStatus ?? "no_proof_required",
                proofStatusLabel: orderSummaries.get(order.id)?.proofStatusLabel ?? "No Proof Needed",
                proofActionRequired: orderSummaries.get(order.id)?.proofActionRequired ?? false,
                proofCounts: orderSummaries.get(order.id)?.proofCounts ?? {
                    required: 0,
                    needed: 0,
                    draftNotSent: 0,
                    awaitingApproval: 0,
                    approved: 0,
                    issue: 0,
                },
                proofLineItemId: orderSummaries.get(order.id)?.proofLineItemId ?? null,
            };
        }));

        return enrichedOrders;
    }

    async searchActiveOrdersForInboundAttachment(organizationId: string, search: string | null, limit = 20): Promise<Array<{
        id: string;
        orderNumber: string | null;
        customerId: string | null;
        label: string | null;
        poNumber: string | null;
        status: string | null;
        customerName: string | null;
        contactEmail: string | null;
        contactName: string | null;
    }>> {
        const normalizedLimit = Math.max(1, Math.min(50, Math.round(limit)));
        const term = search?.trim() ?? "";
        const conditions = [
            eq(orders.organizationId, organizationId),
            sql`coalesce(${orders.status}, '') not in ('cancelled', 'canceled', 'completed', 'closed')`,
        ];
        if (term) {
            const pattern = `%${term}%`;
            conditions.push(or(
                ilike(orders.orderNumber, pattern),
                ilike(orders.poNumber, pattern),
                ilike(orders.label, pattern),
                ilike(orders.notesInternal, pattern),
                ilike(customers.companyName, pattern),
                ilike(customerContacts.email, pattern),
                ilike(customerContacts.firstName, pattern),
                ilike(customerContacts.lastName, pattern),
            ) as any);
        }
        return await this.dbInstance
            .select({
                id: orders.id,
                orderNumber: orders.orderNumber,
                customerId: orders.customerId,
                label: orders.label,
                poNumber: orders.poNumber,
                status: orders.status,
                customerName: customers.companyName,
                contactEmail: customerContacts.email,
                contactName: sql<string | null>`nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')`,
            })
            .from(orders)
            .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
            .leftJoin(customerContacts, and(eq(customerContacts.id, orders.contactId), eq(customerContacts.organizationId, organizationId)))
            .where(and(...conditions))
            .orderBy(desc(orders.updatedAt))
            .limit(normalizedLimit);
    }

    async getOrderById(organizationId: string, id: string): Promise<OrderWithRelations | undefined> {
        const [order] = await this.dbInstance.select().from(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
        if (!order) return undefined;
        const rawLineItems = await this.dbInstance
            .select()
            .from(orderLineItems)
            .where(eq(orderLineItems.orderId, id))
            .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt), asc(orderLineItems.id));
        const lineItemIds = rawLineItems.map((lineItem) => String(lineItem.id));
        const activeOwnerByLineItem = lineItemIds.length > 0
            ? await resolveActiveProductionOwners(this.dbInstance, {
                organizationId,
                lineItemIds,
                debugLabel: "OrdersRepository.getOrderById",
            })
            : new Map<string, any>();

        const acceptedComponents = await this.dbInstance
            .select()
            .from(orderLineItemComponents)
            .where(and(
                eq(orderLineItemComponents.organizationId, organizationId),
                eq(orderLineItemComponents.orderId, id),
                eq(orderLineItemComponents.status, 'ACCEPTED')
            ));

        const componentsByLineItemId = new Map<string, any[]>();
        for (const c of acceptedComponents) {
            const key = String((c as any).orderLineItemId);
            const arr = componentsByLineItemId.get(key);
            if (arr) arr.push(c as any);
            else componentsByLineItemId.set(key, [c as any]);
        }

        const enrichedLineItems = await Promise.all(
            rawLineItems.map(async (li, index) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, li.productId));
                let productVariant = null as any;
                if (li.productVariantId) {
                    [productVariant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
                }
                const activeOwner = activeOwnerByLineItem.get(String(li.id)) ?? null;
                return {
                    ...enrichLineItemWithEffectivePricing(li as any),
                    product,
                    productVariant,
                    pbv2ActiveTreeVersionId: (product as any)?.pbv2ActiveTreeVersionId ? String((product as any).pbv2ActiveTreeVersionId) : null,
                    components: componentsByLineItemId.get(String(li.id)) ?? [],
                    activeOwnerJobId: activeOwner?.id ?? null,
                    activeOwnerStationKey: activeOwner?.stationKey ?? null,
                    activeOwnerStepKey: activeOwner?.stepKey ?? null,
                    activeOwnerStatus: activeOwner?.status ?? null,
                    lineNumber: index + 1,
                } as any;
            })
        );
        const { orderSummaries, lineItemSummaries } = await this.buildProofSummaries(organizationId, [id]);
        const enrichedLineItemsWithProof = enrichedLineItems.map((lineItem: any) => ({
            ...lineItem,
            proofSummary: lineItemSummaries.get(String(lineItem.id)) ?? deriveLineItemProofSummary({
                lineItemId: String(lineItem.id),
                requiresProofApproval: Boolean(lineItem.requiresProofApproval),
                approvedProofVersionId: lineItem.approvedProofVersionId ?? null,
                hasAnyProofVersion: false,
                hasSentProofVersion: false,
            }),
        }));
        const [customer] = order.customerId
            ? await this.dbInstance.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.organizationId, organizationId))).catch(() => [])
            : [];
        
        // Contact resolution with fallback logic
        let contact: CustomerContact | null = null;
        if (order.contactId) {
            // If order has a contact_id, fetch that specific contact
            const contactRows = await this.dbInstance.select().from(customerContacts).where(and(eq(customerContacts.id, order.contactId), eq(customerContacts.organizationId, organizationId)));
            contact = contactRows[0] || null;
        }
        
        // Fallback: If no contact_id or contact not found, get best contact for the customer
        if (!contact && order.customerId) {
            const contactsForCustomer = await this.dbInstance
                .select()
                .from(customerContacts)
                .where(and(eq(customerContacts.customerId, order.customerId), eq(customerContacts.organizationId, organizationId)))
                .orderBy(
                    sql`CASE WHEN ${customerContacts.isPrimary} = true THEN 0 ELSE 1 END`,
                    sql`${customerContacts.createdAt} DESC`
                );
            contact = contactsForCustomer[0] || null;
        }
        
        const [createdByUser] = await this.dbInstance.select().from(users).where(eq(users.id, order.createdByUserId));
        return {
            ...order,
            lineItems: enrichedLineItemsWithProof,
            customer,
            contact,
            createdByUser,
            proofStatus: orderSummaries.get(id)?.proofStatus ?? "no_proof_required",
            proofStatusLabel: orderSummaries.get(id)?.proofStatusLabel ?? "No Proof Needed",
            proofActionRequired: orderSummaries.get(id)?.proofActionRequired ?? false,
            proofCounts: orderSummaries.get(id)?.proofCounts ?? {
                required: 0,
                needed: 0,
                draftNotSent: 0,
                awaitingApproval: 0,
                approved: 0,
                issue: 0,
            },
            proofLineItemId: orderSummaries.get(id)?.proofLineItemId ?? null,
        } as OrderWithRelations;
    }

    async createOrder(organizationId: string, data: {
        customerId?: string | null;
        contactId?: string | null;
        quoteId?: string | null;
        sourceQuoteNumber?: number | null;
        /** Present only for a new-style Quote conversion; never caller-derived. */
        jobNumber?: number | null;
        label?: string | null;
        poNumber?: string | null;
        status?: string;
        priority?: string;
        dueDate?: Date | string | null;
        promisedDate?: Date | string | null;
        requestedDueDate?: Date | string | null;
        discount?: number;
        notesInternal?: string | null;
        createdByUserId: string;
        lineItems: CreateOrderLineItemInput[];
        taxRate?: number;
        taxAmount?: number;
        taxableSubtotal?: number;
        billToName?: string | null;
        billToCompany?: string | null;
        billToAddress1?: string | null;
        billToAddress2?: string | null;
        billToCity?: string | null;
        billToState?: string | null;
        billToPostalCode?: string | null;
        billToCountry?: string | null;
        billToPhone?: string | null;
        billToEmail?: string | null;
        shippingMethod?: string | null;
        shippingMode?: string | null;
        shipToName?: string | null;
        shipToCompany?: string | null;
        shipToAddress1?: string | null;
        shipToAddress2?: string | null;
        shipToCity?: string | null;
        shipToState?: string | null;
        shipToPostalCode?: string | null;
        shipToCountry?: string | null;
        shipToPhone?: string | null;
        shipToEmail?: string | null;
        carrier?: string | null;
        carrierAccountNumber?: string | null;
        shippingInstructions?: string | null;
        trackingNumber?: string | null;
        shippingCents?: number | null;
        /** Durable provenance for the required linked draft invoice. */
        invoiceAuditSource?: "order_created" | "quote_converted" | "inbound_order";
        /** Opt-in policy for workflows that must defer all production intake. */
        productionIntakePolicy?: ProductionIntakePolicy;
    }): Promise<OrderWithRelations> {
        // Direct Orders must never commit without their normal linked draft
        // invoice. Quote conversion and inbound conversion already supply a
        // transaction-scoped repository, so this outer transaction safely
        // composes with those workflows as a savepoint.
        if (!this.atomicConversionScoped) {
            return this.dbInstance.transaction(async (tx) => {
                return this.withExecutor(tx, true).createOrder(organizationId, data);
            });
        }
        await this.validateOrderIdentity(organizationId, data.customerId ?? null, data.contactId ?? null);
        if (!data.lineItems || data.lineItems.length === 0) throw new Error('At least one line item required');
        const subtotal = data.lineItems.reduce((sum, li: any) => {
            const fallbackTotal = Number(li.totalPrice ?? li.linePrice ?? 0);
            const baseCalculatedTotalCents = Number.isFinite(Number(li?.pbv2SnapshotJson?.pricing?.totalCents))
                ? Math.round(Number(li.pbv2SnapshotJson.pricing.totalCents))
                : Math.round((Number.isFinite(fallbackTotal) ? fallbackTotal : 0) * 100);
            const effectivePricing = resolvePersistedLineItemPricing({
                baseCalculatedTotalCents,
                quantity: li.quantity,
                body: li,
                specsJson: li.specsJson,
                legacyOverridePriceCents: li.overridePriceCents,
            });
            return sum + effectivePricing.effectiveTotalCents / 100;
        }, 0);
        const discount = data.discount || 0;
        const taxAmount = data.taxAmount ?? 0;
        const shipping = Math.max(0, Number(data.shippingCents ?? 0)) / 100;
        const total = subtotal - discount + taxAmount + shipping;

        // Sanitize date fields: convert Date objects to ISO strings, keep strings as-is, convert undefined/invalid to null
        const sanitizeDateField = (value: any): string | null => {
            if (!value) return null;
            if (value instanceof Date) return value.toISOString();
            if (typeof value === 'string') return value;
            return null;
        };

        const created = await this.dbInstance.transaction(async (tx) => {
            const inheritedJobNumber = Number(data.jobNumber);
            const orderNumberParts = Number.isSafeInteger(inheritedJobNumber) && inheritedJobNumber > 0
                ? { jobNumber: inheritedJobNumber, orderNumber: String(inheritedJobNumber), displayNumber: String(inheritedJobNumber), numberCore: inheritedJobNumber }
                : await this.generateNextOrderNumber(organizationId, tx);
            const requestedStatus = data.status?.trim() || CANONICAL_NEW_ORDER_STATUS;
            const [canonicalNewPill] = requestedStatus === CANONICAL_NEW_ORDER_STATUS
                ? await tx
                    .select({
                        id: orderStatusPills.id,
                        key: orderStatusPills.key,
                        name: orderStatusPills.name,
                        isActive: orderStatusPills.isActive,
                    })
                    .from(orderStatusPills)
                    .where(and(
                        eq(orderStatusPills.organizationId, organizationId),
                        eq(orderStatusPills.key, CANONICAL_NEW_ORDER_STATUS_PILL_KEY),
                        eq(orderStatusPills.isActive, true),
                    ))
                    .limit(1)
                : [];
            const initialStatusFields = buildInitialOrderStatusFields({
                requestedStatus,
                canonicalNewPill,
                actorUserId: data.createdByUserId,
            });
            const orderInsert: typeof orders.$inferInsert = {
                organizationId,
                orderNumber: orderNumberParts.orderNumber,
                jobNumber: orderNumberParts.jobNumber,
                displayNumber: orderNumberParts.displayNumber,
                numberCore: orderNumberParts.numberCore,
                quoteId: data.quoteId || null,
                sourceQuoteNumber: data.sourceQuoteNumber ?? null,
                customerId: data.customerId,
                contactId: data.contactId || null,
                poNumber: data.poNumber || null,
                label: data.label || null,
                ...initialStatusFields,
                priority: data.priority || 'normal',
                dueDate: sanitizeDateField(data.dueDate),
                promisedDate: sanitizeDateField(data.promisedDate),
                requestedDueDate: sanitizeDateField(data.requestedDueDate),
                subtotal: subtotal.toString(),
                tax: taxAmount.toString(),
                taxRate: data.taxRate != null ? data.taxRate.toString() : null,
                taxAmount: data.taxAmount != null ? data.taxAmount.toString() : undefined,
                taxableSubtotal: data.taxableSubtotal != null ? data.taxableSubtotal.toString() : undefined,
                total: total.toString(),
                discount: discount.toString(),
                notesInternal: data.notesInternal || null,
                createdByUserId: data.createdByUserId,
                billToName: data.billToName ?? null,
                billToCompany: data.billToCompany ?? null,
                billToAddress1: data.billToAddress1 ?? null,
                billToAddress2: data.billToAddress2 ?? null,
                billToCity: data.billToCity ?? null,
                billToState: data.billToState ?? null,
                billToPostalCode: data.billToPostalCode ?? null,
                billToCountry: data.billToCountry ?? null,
                billToPhone: data.billToPhone ?? null,
                billToEmail: data.billToEmail ?? null,
                shippingMethod: data.shippingMethod ?? null,
                shippingMode: data.shippingMode ?? null,
                shipToName: data.shipToName ?? null,
                shipToCompany: data.shipToCompany ?? null,
                shipToAddress1: data.shipToAddress1 ?? null,
                shipToAddress2: data.shipToAddress2 ?? null,
                shipToCity: data.shipToCity ?? null,
                shipToState: data.shipToState ?? null,
                shipToPostalCode: data.shipToPostalCode ?? null,
                shipToCountry: data.shipToCountry ?? null,
                shipToPhone: data.shipToPhone ?? null,
                shipToEmail: data.shipToEmail ?? null,
                carrier: data.carrier ?? null,
                carrierAccountNumber: data.carrierAccountNumber ?? null,
                shippingInstructions: data.shippingInstructions ?? null,
                trackingNumber: data.trackingNumber ?? null,
                shippingCents: data.shippingCents ?? 0,
            };
            const [order] = await tx.insert(orders).values(orderInsert).returning();

            // If this order is being created from a quote, carry forward quote-level (non-line-item) attachments.
            // This is done inside the same transaction so conversion is atomic.
            let inheritedFromQuoteNumber: string | null = null;
            let inheritedQuoteAttachmentIds: string[] = [];
            let createdOrderAttachmentIds: string[] = [];

            if (data.quoteId) {
                const [quoteRow] = await tx
                    .select({ quoteNumber: quotes.quoteNumber })
                    .from(quotes)
                    .where(and(eq(quotes.id, data.quoteId), eq(quotes.organizationId, organizationId)));
                inheritedFromQuoteNumber = quoteRow?.quoteNumber != null ? String(quoteRow.quoteNumber) : null;

                const quoteLevelAttachments = await tx
                    .select()
                    .from(quoteAttachments)
                    .where(
                        and(
                            eq(quoteAttachments.quoteId, data.quoteId),
                            eq(quoteAttachments.organizationId, organizationId),
                            isNull(quoteAttachments.quoteLineItemId)
                        )
                    );

                if (quoteLevelAttachments.length > 0) {
                    inheritedQuoteAttachmentIds = quoteLevelAttachments.map((a) => a.id);
                    const orderAttachmentInserts: typeof orderAttachments.$inferInsert[] = quoteLevelAttachments.map((a) => ({
                        orderId: order.id,
                        orderLineItemId: null,
                        quoteId: data.quoteId,
                        fileRecordId: a.fileRecordId ?? null,
                        uploadedByUserId: a.uploadedByUserId ?? null,
                        uploadedByName: a.uploadedByName ?? null,
                        fileName: a.fileName,
                        fileUrl: a.fileUrl ?? null,
                        fileSize: a.fileSize ?? null,
                        mimeType: a.mimeType ?? null,
                        description: a.description ?? null,
                        originalFilename: a.originalFilename ?? null,
                        storedFilename: a.storedFilename ?? null,
                        relativePath: a.relativePath ?? null,
                        storageProvider: (a.storageProvider as any) ?? undefined,
                        extension: a.extension ?? null,
                        sizeBytes: a.sizeBytes ?? null,
                        checksum: a.checksum ?? null,
                        thumbnailRelativePath: a.thumbnailRelativePath ?? null,
                        thumbnailGeneratedAt: a.thumbnailGeneratedAt ?? null,
                        productionQuantity: a.productionQuantity ?? null,
                        productionGroupId: a.productionGroupId ?? null,
                        // role/side/isPrimary use defaults on order_attachments
                    }));

                    const inserted = await tx.insert(orderAttachments).values(orderAttachmentInserts).returning({ id: orderAttachments.id });
                    createdOrderAttachmentIds = inserted.map((r) => r.id);

                    // Add provenance entry so it's clear these files were inherited from the quote.
                    const [userRow] = await tx
                        .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
                        .from(users)
                        .where(eq(users.id, data.createdByUserId));
                    const userName = userRow
                        ? `${userRow.firstName || ''} ${userRow.lastName || ''}`.trim() || userRow.email
                        : null;

                    await tx.insert(orderAuditLog).values({
                        orderId: order.id,
                        userId: data.createdByUserId,
                        userName,
                        actionType: 'file_inherited',
                        fromStatus: null,
                        toStatus: null,
                        note: `Inherited ${quoteLevelAttachments.length} attachment(s) from quote ${inheritedFromQuoteNumber || data.quoteId}`,
                        metadata: {
                            inheritedFromQuoteId: data.quoteId,
                            inheritedFromQuoteNumber,
                            quoteAttachmentIds: inheritedQuoteAttachmentIds,
                            orderAttachmentIds: createdOrderAttachmentIds,
                        },
                    } as any);
                }
            }

            const lineItemsWithSnapshots = await Promise.all(data.lineItems.map(async (li) => {
                const existingSnapshot = (li as any).quoteLineItemId != null ||
                    (li as any).requiresDesignSnapshot !== undefined ||
                    (li as any).designPricingModeSnapshot !== undefined;

                if (existingSnapshot) {
                    return copyLineItemDesignSnapshotFields(li as any);
                }

                return materializeLineItemDesignSnapshot({
                    config: await productDesignConfigRepository.getByProductId(organizationId, li.productId, tx),
                    requestedNeedsDesignOverride: Object.prototype.hasOwnProperty.call(li as any, 'needsDesignOverride')
                        ? ((li as any).needsDesignOverride ?? null)
                        : undefined,
                    requestedEffectiveRequiresDesign: typeof (li as any).requiresDesign === 'boolean' ? (li as any).requiresDesign : null,
                });
            }));

            const productIds = Array.from(new Set(data.lineItems.map((li) => li.productId)));
            const productProofRows = productIds.length > 0
                ? await tx
                    .select({
                        productId: products.id,
                        requiresProofApproval: products.requiresProofApproval,
                    })
                    .from(products)
                    .where(inArray(products.id, productIds as [string, ...string[]]))
                : [];
            const productProofApprovalMap = new Map<string, boolean>();
            for (const row of productProofRows) {
                productProofApprovalMap.set(row.productId, Boolean(row.requiresProofApproval));
            }

            const lineItemsData = data.lineItems.map((li, index) => {
                const designSnapshot = lineItemsWithSnapshots[index];
                const totalRaw =
                    (li as any).totalPrice ??
                    (li as any).total_price ??
                    (li as any).linePrice ??
                    (li as any).line_price;

                const totalPriceNum = Number(totalRaw ?? (li as any).linePrice ?? 0);

                const totalSafe = Number.isFinite(totalPriceNum) ? totalPriceNum : 0;
                const specsJsonRaw = (li as any).specsJson || null;
                const pbv2SnapshotJsonRaw = (li as any).pbv2SnapshotJson ?? null;
                const baseCalculatedTotalCents = Number.isFinite(Number((pbv2SnapshotJsonRaw as any)?.pricing?.totalCents))
                    ? Math.round(Number((pbv2SnapshotJsonRaw as any).pricing.totalCents))
                    : Math.round(totalSafe * 100);
                const effectivePricing = resolvePersistedLineItemPricing({
                    baseCalculatedTotalCents,
                    quantity: li.quantity,
                    body: li as any,
                    specsJson: specsJsonRaw,
                    legacyOverridePriceCents: (li as any).overridePriceCents,
                });
                const specsJsonWithPricing = mergePricingIntoSpecsJson({
                    specsJson: specsJsonRaw,
                    pricing: effectivePricing,
                });

                const selectedOptionsRaw = (li as any).selectedOptions;
                const selectedOptionsSafe = Array.isArray(selectedOptionsRaw) ? selectedOptionsRaw : [];

                const taxAmountRaw = (li as any).taxAmount;
                const taxAmountSafe = Number.isFinite(Number(taxAmountRaw)) ? Number(taxAmountRaw) : 0;
                const isTaxableSnapshotRaw = (li as any).isTaxableSnapshot;
                const isTaxableSnapshotSafe = typeof isTaxableSnapshotRaw === "boolean" ? isTaxableSnapshotRaw : true;
                const requiresDesignSafe = designSnapshot.effectiveRequiresDesign;
                const requiresPrepressSafe = typeof (li as any).requiresPrepress === "boolean" ? (li as any).requiresPrepress : true;
                // Honor the snapshot value when explicitly provided (e.g. during quote-to-order conversion);
                // only fall back to the live product when the caller did not pass a boolean.
                const requiresProofApprovalSafe = typeof (li as any).requiresProofApproval === "boolean"
                    ? (li as any).requiresProofApproval
                    : (productProofApprovalMap.get(li.productId) ?? false);
                const requestedWorkflowState = typeof (li as any).workflowState === "string"
                    ? (li as any).workflowState
                    : null;
                const workflowStateSafe = requestedWorkflowState || getInitialWorkflowState({
                    requiresDesign: requiresDesignSafe,
                    requiresPrepress: requiresPrepressSafe,
                    requiresProofApproval: requiresProofApprovalSafe,
                });
                return {
                    orderId: order.id,
                    quoteLineItemId: (li as any).quoteLineItemId || null,
                    productId: li.productId,
                    productVariantId: (li as any).productVariantId || (li as any).variantId || null,
                    productType: (li as any).productType || 'wide_roll',
                    description: (li as any).description || (li as any).productName || 'Item',
                    width: li.width ? li.width.toString() : null,
                    height: li.height ? li.height.toString() : null,
                    quantity: li.quantity,
                    sqft: (li as any).sqft ? (li as any).sqft.toString() : null,
                    unitPrice: (effectivePricing.effectiveUnitPriceCents / 100).toFixed(2),
                    totalPrice: (effectivePricing.effectiveTotalCents / 100).toFixed(2),
                    status: 'new',
                    workflowState: workflowStateSafe,
                    requiresDesignSnapshot: designSnapshot.requiresDesignSnapshot,
                    designBriefRequiredSnapshot: designSnapshot.designBriefRequiredSnapshot,
                    estimatedDesignMinutesSnapshot: designSnapshot.estimatedDesignMinutesSnapshot,
                    includedDesignMinutesSnapshot: designSnapshot.includedDesignMinutesSnapshot,
                    designPricingModeSnapshot: designSnapshot.designPricingModeSnapshot,
                    flatFeeAmountSnapshot: designSnapshot.flatFeeAmountSnapshot,
                    hourlyRateSnapshot: designSnapshot.hourlyRateSnapshot,
                    overageRateSnapshot: designSnapshot.overageRateSnapshot,
                    internalLaborRateSnapshot: designSnapshot.internalLaborRateSnapshot,
                    needsDesignOverride: designSnapshot.needsDesignOverride,
                    requiresDesign: requiresDesignSafe,
                    requiresProofApproval: requiresProofApprovalSafe,
                    requiresPrepress: requiresPrepressSafe,
                    productionNotes: (li as any).productionNotes ?? null,
                    specsJson: specsJsonWithPricing,
                    selectedOptions: selectedOptionsSafe,
                    optionSelectionsJson: (li as any).optionSelectionsJson ?? null,
                    pbv2TreeVersionId: (li as any).pbv2TreeVersionId ?? null,
                    pbv2SnapshotJson: pbv2SnapshotJsonRaw,
                    pricedAt: (li as any).pricedAt ?? null,
                    nestingConfigSnapshot: (li as any).nestingConfigSnapshot || null,
                    // These are commercial/material snapshots.  They are deliberately
                    // accepted by the canonical create path so a safe order duplicate
                    // can retain its sold configuration without carrying operational
                    // state such as production jobs or reservations.
                    materialId: (li as any).materialId ?? null,
                    materialUsageJson: (li as any).materialUsageJson ?? null,
                    materialUsages: Array.isArray((li as any).materialUsages) ? (li as any).materialUsages : [],
                    requiresInventory: typeof (li as any).requiresInventory === "boolean" ? (li as any).requiresInventory : true,
                    sortOrder: (li as any).sortOrder ?? index, // Use provided sortOrder or default to index
                    overridePriceCents: effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null,
                    overrideAt: effectivePricing.hasPriceOverride ? new Date() : null,
                    overrideByUserId: effectivePricing.hasPriceOverride ? data.createdByUserId : null,
                    overrideReason: (li as any).overrideReason ?? null,
                    lineItemRole: (li as any).lineItemRole ?? "standalone",
                    childDisplayMode: (li as any).childDisplayMode ?? "hidden",
                    parentPriceMode: (li as any).parentPriceMode ?? "sum_children",
                    childCalculatedTotalCents: (li as any).childCalculatedTotalCents ?? null,
                    // Tax fields
                    taxAmount: taxAmountSafe.toString(),
                    isTaxableSnapshot: isTaxableSnapshotSafe,
                } as typeof orderLineItems.$inferInsert;
            });
            const createdLineItems = lineItemsData.length ? await tx.insert(orderLineItems).values(lineItemsData).returning() : [];
            return { order, lineItems: createdLineItems };
        }).catch((error) => {
            if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
            throw error;
        });

        // Auto-create legacy job records only when the caller did not explicitly
        // defer production intake. Deferred orders retain their canonical line
        // workflow state, but create neither legacy jobs nor production ownership.
        await Promise.all(created.lineItems.map(async (li) => {
            if (!shouldCreateLegacyProductionJob({
                policy: data.productionIntakePolicy,
                lineItemRole: (li as any).lineItemRole,
                workflowState: li.workflowState,
            })) return;
            const [existing] = await this.dbInstance.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
            if (!existing) {
                // Fetch product with productType relation
                const productWithType = await this.dbInstance.query.products.findFirst({
                    where: eq(products.id, li.productId),
                    with: { productType: true },
                });
                const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

                const jobInsert: typeof jobs.$inferInsert = {
                    organizationId,
                    orderId: created.order.id,
                    orderLineItemId: li.id,
                    productType: productTypeName,
                    statusKey: 'new',
                    priority: 'normal',
                    specsJson: (li as any).specsJson || null,
                    assignedToUserId: null,
                    notesInternal: null,
                } as any;
                const [newJob] = await this.dbInstance.insert(jobs).values(jobInsert).returning();
                // Fail-soft: logging should not block order creation/conversion.
                // Multi-tenant: organizationId must always be persisted.
                try {
                    if (!organizationId) {
                        console.error('[createOrder] Missing organizationId; skipping job_status_log insert', {
                            orderId: created.order.id,
                            jobId: newJob.id,
                        });
                    } else {
                        await this.dbInstance.insert(jobStatusLog).values({
                            organizationId,
                            jobId: newJob.id,
                            oldStatusKey: null,
                            newStatusKey: 'new',
                            userId: data.createdByUserId,
                        } as InsertJobStatusLog).returning();
                    }
                } catch (error) {
                    if (this.atomicConversionScoped) throw error;
                    console.error('[createOrder] Failed job_status_log insert (non-blocking)', {
                        organizationId,
                        orderId: created.order.id,
                        jobId: newJob.id,
                        error,
                    });
                }
            }
        }));

        await ensureOrderBackedInvoiceForOrderInTransaction(this.dbInstance, {
            organizationId,
            orderId: created.order.id,
            actorUserId: data.createdByUserId,
            source: data.invoiceAuditSource ?? (data.quoteId ? "quote_converted" : "order_created"),
        });

        const [customer] = data.customerId
            ? await this.dbInstance.select().from(customers).where(and(eq(customers.id, data.customerId), eq(customers.organizationId, organizationId)))
            : [];
        let contact: CustomerContact | null = null;
        if (data.contactId) {
            const contactRows = await this.dbInstance.select().from(customerContacts).where(and(eq(customerContacts.id, data.contactId), eq(customerContacts.organizationId, organizationId)));
            contact = contactRows[0] || null;
        }
        const [createdByUser] = await this.dbInstance.select().from(users).where(eq(users.id, data.createdByUserId));
        const enrichedLineItems = await Promise.all(
            created.lineItems.map(async (li) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, li.productId));
                let productVariant = null as any;
                if (li.productVariantId) {
                    [productVariant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
                }
                return { ...li, product, productVariant } as any;
            })
        );
        return {
            ...created.order,
            lineItems: enrichedLineItems,
            customer,
            contact,
            createdByUser,
        } as OrderWithRelations;
    }

    /**
     * Adds a staff-authored order note as a structured row. Inbound conversion
     * uses this instead of overloading the historical orders.notesInternal blob
     * with source/provenance text.
     */
    async addOrderInternalNote(params: {
        organizationId: string;
        orderId: string;
        userId: string | null;
        noteText: string;
    }) {
        const [note] = await this.dbInstance
            .insert(orderInternalNotes)
            .values({
                organizationId: params.organizationId,
                orderId: params.orderId,
                createdByUserId: params.userId,
                noteText: params.noteText.trim(),
                audienceTags: null,
            })
            .returning();
        return note;
    }

    async updateOrder(organizationId: string, id: string, orderData: Partial<InsertOrder>): Promise<Order> {
        if (orderData.jobNumber !== undefined || orderData.orderNumber !== undefined || orderData.displayNumber !== undefined || orderData.numberCore !== undefined) {
            throw new Error("Commercial Job Number and document number fields are immutable after Order creation.");
        }
        if (orderData.customerId !== undefined || orderData.contactId !== undefined) {
            const [existing] = await this.dbInstance.select({ customerId: orders.customerId, contactId: orders.contactId })
                .from(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId))).limit(1);
            if (!existing) throw new Error('Order not found');
            await this.validateOrderIdentity(
                organizationId,
                orderData.customerId !== undefined ? orderData.customerId ?? null : existing.customerId,
                orderData.contactId !== undefined ? orderData.contactId ?? null : existing.contactId,
            );
        }
        const updateData: any = { ...orderData, updatedAt: new Date() };
        const [updated] = await this.dbInstance
            .update(orders)
            .set(updateData)
            .where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error('Order not found');
        return updated;
    }

    private async validateOrderIdentity(organizationId: string, customerId: string | null, contactId: string | null): Promise<void> {
        if (!customerId && !contactId) {
            throw new OrderIdentityError("ORDER_IDENTITY_REQUIRED", "An order must have a customer, a contact, or both.");
        }
        let contact: CustomerContact | null = null;
        if (customerId) {
            const [customer] = await this.dbInstance.select({ id: customers.id }).from(customers)
                .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).limit(1);
            if (!customer) throw new OrderIdentityError("ORDER_CUSTOMER_NOT_FOUND", "Customer was not found for this organization.");
        }
        if (contactId) {
            const [found] = await this.dbInstance.select().from(customerContacts)
                .where(and(eq(customerContacts.id, contactId), eq(customerContacts.organizationId, organizationId))).limit(1);
            if (!found) throw new OrderIdentityError("ORDER_CONTACT_NOT_FOUND", "Contact was not found for this organization.");
            contact = found;
        }
        if (customerId && contact) {
            const linkRows = await this.dbInstance.select({ customerId: customerContactLinks.customerId }).from(customerContactLinks).where(and(
                eq(customerContactLinks.organizationId, organizationId),
                eq(customerContactLinks.contactId, contact.id),
                ne(customerContactLinks.status, "removed"),
            ));
            const associatedCustomerIds = new Set<string>(linkRows.map((row) => row.customerId));
            if (contact.customerId) associatedCustomerIds.add(contact.customerId);
            if (associatedCustomerIds.size > 0 && !associatedCustomerIds.has(customerId)) {
                throw new OrderIdentityError("ORDER_CONTACT_CUSTOMER_CONFLICT", "Contact is not linked to the selected customer.");
            }
        }
    }

    async deleteOrder(organizationId: string, id: string): Promise<void> {
        // Keep the guard and delete in one transaction. The row lock prevents
        // a concurrent production insert from appearing between the history
        // check and the hard delete, which could otherwise reintroduce the
        // cascade-loss race this policy is meant to prevent.
        await this.dbInstance.transaction(async (tx: any) => {
            const [order] = await tx.select({ id: orders.id }).from(orders).where(and(
                eq(orders.id, id),
                eq(orders.organizationId, organizationId),
            )).for("update");
            if (!order) return;

            // Keep this guard at the repository boundary so every current and
            // future hard-delete caller receives the same protection.
            const [[productionJob], [productionRun], [productionRunMember]] = await Promise.all([
                tx.select({ id: productionJobs.id }).from(productionJobs).where(and(
                eq(productionJobs.organizationId, organizationId),
                eq(productionJobs.orderId, id),
                )).limit(1),
                tx.select({ id: productionRuns.id }).from(productionRuns).where(and(
                eq(productionRuns.organizationId, organizationId),
                eq(productionRuns.orderId, id),
                )).limit(1),
                tx.select({ id: productionRunMembers.id }).from(productionRunMembers)
                .innerJoin(productionJobs, eq(productionRunMembers.productionJobId, productionJobs.id))
                .innerJoin(productionRuns, eq(productionRunMembers.productionRunId, productionRuns.id))
                .where(and(
                    eq(productionRunMembers.organizationId, organizationId),
                    eq(productionJobs.organizationId, organizationId),
                    eq(productionRuns.organizationId, organizationId),
                    or(
                        eq(productionJobs.orderId, id),
                        eq(productionRuns.orderId, id),
                    ),
                ))
                .limit(1),
            ]);

            if (productionJob || productionRun || productionRunMember) {
                throw new OrderDeletionProtectedError({
                    hasProductionJob: Boolean(productionJob),
                    hasProductionRun: Boolean(productionRun),
                    hasProductionRunMember: Boolean(productionRunMember),
                });
            }

            await tx.delete(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
        });
    }

    async convertQuoteToOrder(organizationId: string, quoteId: string, createdByUserId: string, options?: {
        dueDate?: Date;
        promisedDate?: Date;
        priority?: string;
        notesInternal?: string | null;
        poNumber?: string | null;
        productionIntakePolicy?: ProductionIntakePolicy;
        customerId?: string | null;
        contactId?: string | null;
    }): Promise<OrderWithRelations> {
        if (!this.atomicConversionScoped) {
            return this.dbInstance.transaction(async (tx) => {
                return this.withExecutor(tx, true).convertQuoteToOrder(organizationId, quoteId, createdByUserId, options);
            });
        }

        // Fetch the quote with line items
        const [storedQuote] = await this.dbInstance
            .select()
            .from(quotes)
            .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
            .for("update");
        let quote = storedQuote;
        if (!quote) throw new Error('Quote not found');
        
        // The quote row is the serialization point for conversion. A retry or a
        // concurrent request observes the committed linkage and returns it.
        if (quote.convertedToOrderId) {
            const existingOrder = await this.getOrderById(organizationId, quote.convertedToOrderId);
            if (!existingOrder || existingOrder.quoteId !== quote.id) {
                throw new Error('Quote conversion linkage is invalid');
            }
            return existingOrder;
        }

        // Legacy callers may request an identity correction during conversion.
        // Apply and validate it only after the Quote lock has been acquired.
        let resolvedContactId = options?.contactId !== undefined ? options.contactId : quote.contactId;
        let resolvedCustomerId = options?.customerId !== undefined ? options.customerId : quote.customerId;
        if (resolvedContactId) {
            const [contact] = await this.dbInstance
                .select({ id: customerContacts.id, customerId: customerContacts.customerId })
                .from(customerContacts)
                .where(and(eq(customerContacts.id, resolvedContactId), eq(customerContacts.organizationId, organizationId)))
                .limit(1);
            if (contact) {
                const linkedCustomers = await this.dbInstance
                    .select({ id: customers.id, isPrimary: customerContactLinks.isPrimary })
                    .from(customerContactLinks)
                    .innerJoin(customers, and(eq(customers.id, customerContactLinks.customerId), eq(customers.organizationId, organizationId)))
                    .where(and(
                        eq(customerContactLinks.organizationId, organizationId),
                        eq(customerContactLinks.contactId, contact.id),
                        eq(customerContactLinks.status, "active"),
                    ))
                    .orderBy(desc(customerContactLinks.isPrimary), asc(customers.companyName), asc(customers.id));
                if (contact.customerId && !linkedCustomers.some((link) => link.id === contact.customerId)) {
                    const [legacyCustomer] = await this.dbInstance.select({ id: customers.id }).from(customers)
                        .where(and(eq(customers.id, contact.customerId), eq(customers.organizationId, organizationId))).limit(1);
                    if (legacyCustomer) linkedCustomers.push({ id: legacyCustomer.id, isPrimary: false });
                }
                resolvedCustomerId = resolveOrderCustomerIdForContact({
                    currentCustomerId: resolvedCustomerId,
                    legacyCustomerId: contact.customerId,
                    linkedCustomers,
                });
            }
        }
        await this.validateOrderIdentity(organizationId, resolvedCustomerId, resolvedContactId);
        if (resolvedCustomerId !== quote.customerId || resolvedContactId !== quote.contactId) {
            const [updatedQuote] = await this.dbInstance.update(quotes)
                .set({ customerId: resolvedCustomerId, contactId: resolvedContactId })
                .where(and(eq(quotes.id, quote.id), eq(quotes.organizationId, organizationId)))
                .returning();
            quote = updatedQuote;
        }
        
        const quoteLines = await this.dbInstance.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
        const activeQuoteLines = quoteLines.filter((line) => line.status !== "canceled" && line.status !== "draft");
        if (activeQuoteLines.length === 0) throw new Error('Quote has no active line items');

        const [customer] = quote.customerId
            ? await this.dbInstance
                .select()
                .from(customers)
                .where(and(eq(customers.id, quote.customerId), eq(customers.organizationId, organizationId)))
                .limit(1)
            : [];
        const [contact] = quote.contactId
            ? await this.dbInstance
                .select()
                .from(customerContacts)
                .where(and(eq(customerContacts.id, quote.contactId), eq(customerContacts.organizationId, organizationId)))
                .limit(1)
            : [];
        const orderSnapshot = buildOrderSnapshotFromQuote({ quote, customer: customer ?? null, contact: contact ?? null });
        validateOrderSnapshotForConversion(orderSnapshot);

        // Fetch org settings for prepress default (migration 0051)
        const [org] = await this.dbInstance
            .select({ prepressDefaultEnabled: organizations.prepressDefaultEnabled, settings: organizations.settings })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1);
        const orgPrepressDefault = org?.prepressDefaultEnabled ?? true;

        // Fetch product types for prepress override logic (migration 0051)
        const productIds = Array.from(new Set(activeQuoteLines.map(ql => ql.productId)));
        const productsWithTypes = productIds.length > 0
            ? await this.dbInstance
                .select({
                    productId: products.id,
                    productTypeId: products.productTypeId,
                    requiresPrepressOverride: productTypes.requiresPrepressOverride,
                    requiresProofApproval: products.requiresProofApproval,
                    workflowIntent: products.workflowIntent,
                })
                .from(products)
                .leftJoin(productTypes, eq(products.productTypeId, productTypes.id))
                .where(inArray(products.id, productIds as [string, ...string[]]))
            : [];
        
        const productPrepressMap = new Map<string, boolean>();
        const productProofApprovalMap = new Map<string, boolean>();
        const productWorkflowIntentMap = new Map<string, string>();
        for (const p of productsWithTypes) {
            // requiresPrepress = productType.requiresPrepressOverride ?? org.prepressDefaultEnabled
            const requiresPrepress = p.requiresPrepressOverride !== null 
                ? p.requiresPrepressOverride 
                : orgPrepressDefault;
            productPrepressMap.set(p.productId, requiresPrepress);
            productProofApprovalMap.set(p.productId, Boolean(p.requiresProofApproval));
            productWorkflowIntentMap.set(p.productId, p.workflowIntent ?? "standard_production");
        }

        // Convert quote line items to order line items
        const orderLineItemsData: CreateOrderLineItemInput[] = activeQuoteLines.map((storedQuoteLine, index) => {
            const ql = enrichLineItemWithEffectivePricing(storedQuoteLine as any);
            // TEMP→PERMANENT routing truth handoff:
            // If the quote line item carries explicit routing intent (migration 0015), use it.
            // Otherwise fall back to productType / org-level default (pre-existing behavior).
            const qlAny = ql as any;
            const fulfillmentOrService =
                productWorkflowIntentMap.get(ql.productId) === "fulfillment_only" ||
                productWorkflowIntentMap.get(ql.productId) === "service_fee";
            const requiresDesign: boolean = typeof qlAny.requiresDesign === "boolean"
                ? qlAny.requiresDesign
                : fulfillmentOrService ? false : false;
            const requiresPrepress: boolean = typeof qlAny.requiresPrepress === 'boolean'
                ? qlAny.requiresPrepress
                : fulfillmentOrService ? false : (productPrepressMap.get(ql.productId) ?? orgPrepressDefault);
            const proofApproval = resolveLineItemProofApprovalRequirement({
                productRequiresProofApproval: productProofApprovalMap.get(ql.productId) ?? false,
                requestedRequiresProofApproval: typeof qlAny.requiresProofApproval === "boolean" ? qlAny.requiresProofApproval : undefined,
                proofingPolicy: resolveProofingPolicyFromOrgPreferences((org?.settings as any)?.preferences),
                customerRequiresProofApproval: customer?.alwaysRequireProof === true,
            });
            const requiresProofApproval = fulfillmentOrService ? false : proofApproval.requiresProofApproval;
            const copiedDesignSnapshot = copyLineItemDesignSnapshotFields(qlAny);
            const designSnapshot = {
                ...copiedDesignSnapshot,
                effectiveRequiresDesign: requiresDesign,
                needsDesignOverride:
                    requiresDesign === copiedDesignSnapshot.requiresDesignSnapshot
                        ? null
                        : requiresDesign,
            };
            // Line item lifecycle: new → in_production → complete | canceled
            const initialStatus = 'new' as unknown as InsertOrderLineItem['status'];
            const workflowState = getInitialWorkflowState({
                requiresDesign: designSnapshot.effectiveRequiresDesign,
                requiresPrepress,
                requiresProofApproval,
            });

            const lineItemData: CreateOrderLineItemInput = {
                quoteLineItemId: ql.id,
                productId: ql.productId,
                productVariantId: ql.variantId,
                productType: ql.productType,
                description: (ql as any).description ?? ql.productName,
                width: ql.width ? Number(ql.width) : 0,
                height: ql.height ? Number(ql.height) : 0,
                quantity: ql.quantity,
                sqft: null,
                unitPrice: ql.effectiveUnitPriceCents / 100,
                totalPrice: ql.effectiveTotalCents / 100,
                status: initialStatus,
                workflowState,
                designStatus: designSnapshot.effectiveRequiresDesign ? "needs_design" : null,
                requiresDesignSnapshot: designSnapshot.requiresDesignSnapshot,
                designBriefRequiredSnapshot: designSnapshot.designBriefRequiredSnapshot,
                estimatedDesignMinutesSnapshot: designSnapshot.estimatedDesignMinutesSnapshot,
                includedDesignMinutesSnapshot: designSnapshot.includedDesignMinutesSnapshot,
                designPricingModeSnapshot: designSnapshot.designPricingModeSnapshot,
                flatFeeAmountSnapshot: designSnapshot.flatFeeAmountSnapshot == null ? null : Number(designSnapshot.flatFeeAmountSnapshot),
                hourlyRateSnapshot: designSnapshot.hourlyRateSnapshot == null ? null : Number(designSnapshot.hourlyRateSnapshot),
                overageRateSnapshot: designSnapshot.overageRateSnapshot == null ? null : Number(designSnapshot.overageRateSnapshot),
                internalLaborRateSnapshot: designSnapshot.internalLaborRateSnapshot == null ? null : Number(designSnapshot.internalLaborRateSnapshot),
                needsDesignOverride: designSnapshot.needsDesignOverride,
                requiresDesign: designSnapshot.effectiveRequiresDesign,
                requiresProofApproval,
                requiresPrepress, // Snapshot prepress requirement (TEMP→PERMANENT)
                specsJson: ql.specsJson,
                selectedOptions: ql.selectedOptions,
                optionSelectionsJson: (ql as any).optionSelectionsJson ?? null,
                // PBV2 snapshot fields (copied from quote line item - no repricing during conversion)
                pbv2TreeVersionId: (ql as any).pbv2TreeVersionId ?? null,
                pbv2SnapshotJson: (ql as any).pbv2SnapshotJson ?? null,
                pricedAt: (ql as any).pricedAt ?? null, // Preserve pricing timestamp from quote
                priceOverride: (ql as any).priceOverride ?? null,
                overridePriceCents: (ql as any).overridePriceCents ?? null,
                overrideAt: (ql as any).overrideAt ?? null,
                overrideByUserId: (ql as any).overrideByUserId ?? null,
                overrideReason: (ql as any).overrideReason ?? null,
                lineItemRole: (ql as any).lineItemRole ?? "standalone",
                childDisplayMode: (ql as any).childDisplayMode ?? "hidden",
                parentPriceMode: (ql as any).parentPriceMode ?? "sum_children",
                childCalculatedTotalCents: (ql as any).childCalculatedTotalCents ?? null,
                // Resolved after insert because quote and order line IDs differ.
                parentLineItemId: null,
                nestingConfigSnapshot: null,
                requiresInventory: false,
                materialId: null,
                sortOrder: ql.displayOrder ?? index, // Use quote displayOrder or default to index
                taxAmount: ql.taxAmount || '0',
                isTaxableSnapshot: ql.isTaxableSnapshot,
            };

            return lineItemData;
        });

        // Create the order
        const orderData = {
            customerId: quote.customerId!,
            contactId: quote.contactId,
            quoteId: quote.id,
            sourceQuoteNumber: quote.quoteNumber, // Immutable snapshot — survives quote deletion
            // Legacy Quotes retain their historical QT identity. A legacy
            // conversion receives a fresh Job Number at Order creation.
            jobNumber: quote.jobNumber ?? null,
            label: quote.label || null, // Copy jobLabel from quote
            poNumber: options?.poNumber ? String(options.poNumber) : null,
            status: 'new',
            priority: options?.priority || 'normal',
            // /orders/new uses quote.requestedDueDate as the operator-facing order due date.
            // Keep requestedDueDate as an audit/source snapshot while also populating dueDate.
            dueDate: options?.dueDate || (quote.requestedDueDate ? new Date(quote.requestedDueDate) : null),
            promisedDate: options?.promisedDate || null,
            requestedDueDate: quote.requestedDueDate || null,
            discount: quote.discountAmount ? Number(quote.discountAmount) : 0,
            notesInternal: options?.notesInternal ? String(options.notesInternal) : null,
            createdByUserId,
            lineItems: orderLineItemsData,
            taxRate: quote.taxRate ? parseFloat(quote.taxRate.toString()) : undefined,
            taxAmount: quote.taxAmount ? parseFloat(quote.taxAmount) : undefined,
            taxableSubtotal: quote.taxableSubtotal ? parseFloat(quote.taxableSubtotal) : undefined,
            shippingCents: quote.shippingCents ?? 0,
            productionIntakePolicy: options?.productionIntakePolicy,
            ...orderSnapshot,
        };

        console.log('[CONVERT QUOTE TO ORDER] Creating order:', {
            organizationId,
            quoteId,
            quoteNumber: quote.quoteNumber,
            quoteLabel: quote.label,
            lineItemsCount: orderLineItemsData.length,
        });

        const createdOrder = await this.createOrder(organizationId, orderData);

        // Quote and order line IDs differ, so bundle edges are restored only
        // after all order rows have been inserted.
        const createdOrderLines = await this.dbInstance
            .select({ id: orderLineItems.id, quoteLineItemId: orderLineItems.quoteLineItemId })
            .from(orderLineItems)
            .where(eq(orderLineItems.orderId, createdOrder.id));
        const orderIdByQuoteLineId = new Map(createdOrderLines
            .filter((line) => line.quoteLineItemId)
            .map((line) => [String(line.quoteLineItemId), line.id]));
        for (const quoteLine of activeQuoteLines) {
            if ((quoteLine as any).lineItemRole !== "child" || !(quoteLine as any).parentLineItemId) continue;
            const childOrderId = orderIdByQuoteLineId.get(String(quoteLine.id));
            const parentOrderId = orderIdByQuoteLineId.get(String((quoteLine as any).parentLineItemId));
            if (!childOrderId || !parentOrderId) throw new Error("Unable to preserve quote line item bundle during conversion");
            await this.dbInstance
                .update(orderLineItems)
                .set({ parentLineItemId: parentOrderId, lineItemRole: "child" })
                .where(eq(orderLineItems.id, childOrderId));
        }

        const [quoteListNote] = await this.dbInstance
                .select({ listLabel: quoteListNotes.listLabel })
                .from(quoteListNotes)
                .where(and(eq(quoteListNotes.organizationId, organizationId), eq(quoteListNotes.quoteId, quoteId)))
                .limit(1);

        if (quoteListNote && quoteListNote.listLabel !== undefined) {
            await this.dbInstance
                    .insert(orderListNotes)
                    .values({
                        organizationId,
                        orderId: createdOrder.id,
                        listLabel: quoteListNote.listLabel || null,
                        updatedByUserId: createdByUserId,
                        updatedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                        target: [orderListNotes.organizationId, orderListNotes.orderId],
                        set: {
                            listLabel: quoteListNote.listLabel || null,
                            updatedByUserId: createdByUserId,
                            updatedAt: new Date(),
                        },
                    });
        }
        
        console.log('[CONVERT QUOTE TO ORDER] Order created:', {
            orderId: createdOrder.id,
            orderNumber: createdOrder.orderNumber,
            orderLabel: createdOrder.label,
        });

        // Update quote to link to the created order (marks it as converted)
        await this.dbInstance
            .update(quotes)
            .set({ 
                convertedToOrderId: createdOrder.id
            })
            .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)));

        if (shouldApplyQuoteConversionProductionIntake(options?.productionIntakePolicy) && (createdOrder.lineItems?.length ?? 0) > 0) {
            for (const lineItem of createdOrder.lineItems || []) {
                const targetWorkflowState = (lineItem.workflowState ?? getInitialWorkflowState({
                    requiresDesign: Boolean(lineItem.requiresDesign),
                    requiresPrepress: typeof lineItem.requiresPrepress === 'boolean' ? lineItem.requiresPrepress : true,
                })) as any;

                await transitionLineItemWorkflowState(this.dbInstance, {
                    organizationId,
                    lineItemId: lineItem.id,
                    toState: targetWorkflowState,
                    actorUserId: createdByUserId,
                    metadata: {
                        source: 'quote_to_order_conversion',
                        quoteId,
                    },
                });
            }
        }

        // Copy asset links through the transaction-bound executor.
        {
            const transactionAssets = {
                listAssetsForParents: async (tenantId: string, parentType: string, parentIds: string[]) => {
                    const rows = await this.dbInstance
                        .select({ asset: assets, role: assetLinks.role, parentId: assetLinks.parentId })
                        .from(assetLinks)
                        .innerJoin(assets, eq(assetLinks.assetId, assets.id))
                        .where(and(
                            eq(assetLinks.organizationId, tenantId),
                            eq(assets.organizationId, tenantId),
                            eq(assetLinks.parentType, parentType),
                            inArray(assetLinks.parentId, parentIds as [string, ...string[]]),
                        ));
                    const grouped = new Map<string, Array<(typeof rows)[number]["asset"] & { role: string }>>();
                    for (const row of rows) grouped.set(row.parentId, [...(grouped.get(row.parentId) || []), { ...row.asset, role: row.role }]);
                    return grouped;
                },
                linkAssetsBatch: async (links: Array<typeof assetLinks.$inferInsert>) => this.dbInstance.insert(assetLinks).values(links).returning(),
            };
            
            // Build mapping of quoteLineItemId → orderLineItemId
            const lineItemMap = new Map<string, string>();
            for (const orderLineItem of createdOrder.lineItems || []) {
                if (orderLineItem.quoteLineItemId) {
                    lineItemMap.set(orderLineItem.quoteLineItemId, orderLineItem.id);
                }
            }

            // Query asset_links for all source quote line items
            const sourceQuoteLineItemIds = Array.from(lineItemMap.keys());
            if (sourceQuoteLineItemIds.length > 0) {
                const assetsMap = await transactionAssets.listAssetsForParents(
                    organizationId,
                    'quote_line_item',
                    sourceQuoteLineItemIds
                );

                // Create new asset_links for order line items
                const newLinks: any[] = [];
                for (const quoteLineItemId of Array.from(lineItemMap.keys())) {
                    const orderLineItemId = lineItemMap.get(quoteLineItemId)!;
                    const sourceAssets = assetsMap.get(quoteLineItemId) || [];
                    for (const asset of sourceAssets) {
                        newLinks.push({
                            organizationId,
                            assetId: asset.id,
                            parentType: 'order_line_item',
                            parentId: orderLineItemId,
                            role: asset.role, // Preserve role from quote
                        });
                    }
                }

                if (newLinks.length > 0) {
                    await transactionAssets.linkAssetsBatch(newLinks);
                    console.log(`[CONVERT QUOTE] Copied ${newLinks.length} asset_links from quote to order`);
                }
            }
        }

        // Copy quote line item attachments to order line items transactionally.
        {
            // Build mapping of quoteLineItemId → orderLineItemId
            const lineItemMap = new Map<string, string>();
            for (const orderLineItem of createdOrder.lineItems || []) {
                if (orderLineItem.quoteLineItemId) {
                    lineItemMap.set(orderLineItem.quoteLineItemId, orderLineItem.id);
                }
            }

            const sourceQuoteLineItemIds = Array.from(lineItemMap.keys());
            if (sourceQuoteLineItemIds.length > 0) {
                // Fetch quote line item attachments
                const quoteLineItemAttachments = await this.dbInstance
                    .select()
                    .from(quoteAttachments)
                    .where(
                        and(
                            eq(quoteAttachments.quoteId, quoteId),
                            eq(quoteAttachments.organizationId, organizationId),
                            inArray(quoteAttachments.quoteLineItemId, sourceQuoteLineItemIds as [string, ...string[]])
                        )
                    );

                if (quoteLineItemAttachments.length > 0) {
                    const orderAttachmentInserts: typeof orderAttachments.$inferInsert[] = [];
                    const artworkSideByOrderLineItemAndFileRecord = new Map<string, "front" | "back" | "both" | "unassigned">();
                    for (const orderLineItem of createdOrder.lineItems || []) {
                        const links = (orderLineItem as any)?.specsJson?.staffReviewedDraft?.artworkLinks;
                        if (!Array.isArray(links)) continue;
                        for (const link of links) {
                            if (!link || link.source === "staff_removed" || !link.fileRecordId) continue;
                            const assignmentSide = link.assignmentSide;
                            if (assignmentSide !== "front" && assignmentSide !== "back" && assignmentSide !== "both") continue;
                            artworkSideByOrderLineItemAndFileRecord.set(`${orderLineItem.id}:${link.fileRecordId}`, assignmentSide);
                        }
                    }
                    
                    for (const qa of quoteLineItemAttachments) {
                        if (!qa.quoteLineItemId) continue;
                        const orderLineItemId = lineItemMap.get(qa.quoteLineItemId);
                        if (!orderLineItemId) continue;

                        const assignmentSide = qa.fileRecordId
                            ? artworkSideByOrderLineItemAndFileRecord.get(`${orderLineItemId}:${qa.fileRecordId}`) ?? "unassigned"
                            : "unassigned";
                        const attachmentSides = assignmentSide === "both"
                            ? ["front", "back"] as const
                            : assignmentSide === "front" || assignmentSide === "back"
                                ? [assignmentSide]
                                : ["na"] as const;
                        for (const side of attachmentSides) orderAttachmentInserts.push({
                            orderId: createdOrder.id,
                            orderLineItemId: orderLineItemId,
                            quoteId: quoteId,
                            fileRecordId: qa.fileRecordId ?? null,
                            uploadedByUserId: qa.uploadedByUserId ?? null,
                            uploadedByName: qa.uploadedByName ?? null,
                            fileName: qa.fileName,
                            fileUrl: qa.fileUrl ?? null,
                            fileSize: qa.fileSize ?? null,
                            mimeType: qa.mimeType ?? null,
                            description: qa.description ?? null,
                            originalFilename: qa.originalFilename ?? null,
                            storedFilename: qa.storedFilename ?? null,
                            relativePath: qa.relativePath ?? null,
                            storageProvider: (qa.storageProvider as any) ?? undefined,
                            extension: qa.extension ?? null,
                            sizeBytes: qa.sizeBytes ?? null,
                            checksum: qa.checksum ?? null,
                            thumbnailRelativePath: qa.thumbnailRelativePath ?? null,
                            thumbnailGeneratedAt: qa.thumbnailGeneratedAt ?? null,
                            thumbStatus: qa.thumbStatus ?? 'uploaded',
                            thumbKey: qa.thumbKey ?? null,
                            previewKey: qa.previewKey ?? null,
                            thumbError: qa.thumbError ?? null,
                            productionQuantity: qa.productionQuantity ?? null,
                            productionGroupId: qa.productionGroupId ?? null,
                            role: qa.productionRole === "reference" ? "reference" : "artwork",
                            side,
                            isPrimary: side !== "na",
                        });
                    }

                    if (orderAttachmentInserts.length > 0) {
                        await this.dbInstance.transaction(async (tx) => {
                            for (const attachment of orderAttachmentInserts) {
                                if (attachment.role !== "artwork" || !attachment.orderLineItemId || !attachment.fileRecordId) continue;
                                await canonicalArtworkWriteService.attachSourceArtwork({
                                    tx,
                                    organizationId,
                                    orderId: createdOrder.id,
                                    lineItemId: attachment.orderLineItemId,
                                    fileRecordId: attachment.fileRecordId,
                                    side: attachment.side,
                                    allocationQuantity: attachment.productionQuantity ?? null,
                                    allocationGroupId: attachment.productionGroupId ?? null,
                                    actorUserId: createdByUserId,
                                    origin: "legacy_backfill",
                                });
                            }
                            await tx.insert(orderAttachments).values(orderAttachmentInserts);
                        });
                        console.log(`[CONVERT QUOTE] Copied ${orderAttachmentInserts.length} line item attachments from quote to order`);
                    }
                }
            }
        }

        // Create timeline entry for the conversion in the same transaction.
        {
            const [user] = await this.dbInstance
                .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
                .from(users)
                .where(eq(users.id, createdByUserId));
            
            const userName = user
                ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
                : 'System';

            await this.dbInstance.insert(auditLogs).values({
                organizationId,
                userId: createdByUserId,
                userName,
                actionType: 'CONVERSION',
                entityType: 'quote',
                entityId: quoteId,
                entityName: quote.quoteNumber?.toString() || quoteId,
                description: `Converted to Order #${createdOrder.orderNumber}`,
                oldValues: { converted: false },
                newValues: { converted: true, orderId: createdOrder.id, orderNumber: createdOrder.orderNumber },
            });
        }

        return createdOrder;
    }

    // Order line item operations
    async getOrderLineItems(orderId: string): Promise<OrderLineItem[]> {
        return await this.dbInstance
            .select()
            .from(orderLineItems)
            .where(eq(orderLineItems.orderId, orderId))
            .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt), asc(orderLineItems.id));
    }

    async getOrderLineItemById(id: string): Promise<OrderLineItem | undefined> {
        const [item] = await this.dbInstance.select().from(orderLineItems).where(eq(orderLineItems.id, id));
        return item;
    }

    async createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem> {
        const [orderRow] = await this.dbInstance
            .select({ organizationId: orders.organizationId })
            .from(orders)
            .where(eq(orders.id, lineItem.orderId))
            .limit(1);

        if (!orderRow) {
            throw new Error(`Order ${lineItem.orderId} not found`);
        }

        const existingSnapshot = (lineItem as any).quoteLineItemId != null ||
            (lineItem as any).requiresDesignSnapshot !== undefined ||
            (lineItem as any).designPricingModeSnapshot !== undefined;
        const designSnapshot = existingSnapshot
            ? copyLineItemDesignSnapshotFields(lineItem as any)
            : materializeLineItemDesignSnapshot({
                config: await productDesignConfigRepository.getByProductId(orderRow.organizationId, lineItem.productId),
                requestedNeedsDesignOverride: Object.prototype.hasOwnProperty.call(lineItem as any, 'needsDesignOverride')
                    ? ((lineItem as any).needsDesignOverride ?? null)
                    : undefined,
                requestedEffectiveRequiresDesign: typeof (lineItem as any).requiresDesign === 'boolean' ? (lineItem as any).requiresDesign : null,
            });

        type SelectedOptionsInsert = typeof orderLineItems.$inferInsert["selectedOptions"];
        type SelectedOptionInsert = SelectedOptionsInsert extends Array<infer T> ? T : never;
        type NestingConfigInsert = typeof orderLineItems.$inferInsert["nestingConfigSnapshot"];
        type NestingConfigNonNull = Exclude<NestingConfigInsert, null | undefined>;
        type MaterialUsageJsonInsert = typeof orderLineItems.$inferInsert["materialUsageJson"];
        type MaterialUsageJsonNonNull = Exclude<MaterialUsageJsonInsert, null | undefined>;
        type MaterialUsageJsonRow = MaterialUsageJsonNonNull extends Array<infer T> ? T : never;
        type MaterialUsagesInsert = typeof orderLineItems.$inferInsert["materialUsages"];

        const asArrayOrUndefined = <T>(value: unknown): T[] | undefined => {
            return Array.isArray(value) ? (value as T[]) : undefined;
        };

        const asObjectOrNull = <T>(value: unknown): T | null | undefined => {
            if (value === undefined) return undefined;
            if (value === null) return null;
            return typeof value === "object" ? (value as T) : undefined;
        };

        const [productProofRow] = await this.dbInstance
            .select({ requiresProofApproval: products.requiresProofApproval })
            .from(products)
            .where(eq(products.id, lineItem.productId))
            .limit(1);
        const requiresProofApprovalSafe = typeof lineItem.requiresProofApproval === "boolean"
            ? lineItem.requiresProofApproval
            : Boolean(productProofRow?.requiresProofApproval);
        const baseCalculatedTotalCents = Number.isFinite(Number((lineItem as any)?.pbv2SnapshotJson?.pricing?.totalCents))
            ? Math.round(Number((lineItem as any).pbv2SnapshotJson.pricing.totalCents))
            : Math.round(Number(lineItem.totalPrice) * 100);
        const effectivePricing = resolvePersistedLineItemPricing({
            baseCalculatedTotalCents,
            quantity: lineItem.quantity,
            body: lineItem as any,
            specsJson: lineItem.specsJson,
            legacyOverridePriceCents: (lineItem as any).overridePriceCents,
        });
        const specsJsonWithPricing = mergePricingIntoSpecsJson({
            specsJson: lineItem.specsJson,
            pricing: effectivePricing,
        });

        // JSON/array fields often come from Zod/JSON sources as unknown; narrow them to the Drizzle column types.
        const selectedOptions = asArrayOrUndefined<SelectedOptionInsert>(lineItem.selectedOptions) as SelectedOptionsInsert | undefined;
        const nestingConfigSnapshot = asObjectOrNull<NestingConfigNonNull>(lineItem.nestingConfigSnapshot) as NestingConfigInsert;
        const materialUsageJson = asArrayOrUndefined<MaterialUsageJsonRow>(lineItem.materialUsageJson) as MaterialUsageJsonInsert | undefined;
        const materialUsages = asArrayOrUndefined<LineItemMaterialUsage>(lineItem.materialUsages) as MaterialUsagesInsert | undefined;

        // Drizzle table expects string-valued money/dimension columns; API/DTO may provide numbers.
        const lineItemInsert: typeof orderLineItems.$inferInsert = {
            orderId: lineItem.orderId,
            quoteLineItemId: lineItem.quoteLineItemId ?? null,
            productId: lineItem.productId,
            productVariantId: lineItem.productVariantId ?? null,
            productType: lineItem.productType ?? "wide_roll",
            description: lineItem.description,
            width: lineItem.width == null ? null : lineItem.width.toString(),
            height: lineItem.height == null ? null : lineItem.height.toString(),
            quantity: lineItem.quantity,
            sqft: lineItem.sqft == null ? null : lineItem.sqft.toString(),
            unitPrice: (effectivePricing.effectiveUnitPriceCents / 100).toFixed(2),
            totalPrice: (effectivePricing.effectiveTotalCents / 100).toFixed(2),
            status: lineItem.status,
            workflowState: lineItem.workflowState ?? getInitialWorkflowState({
                requiresDesign: designSnapshot.effectiveRequiresDesign,
                requiresPrepress: typeof lineItem.requiresPrepress === "boolean" ? lineItem.requiresPrepress : true,
                requiresProofApproval: requiresProofApprovalSafe,
            }),
            requiresDesignSnapshot: designSnapshot.requiresDesignSnapshot,
            designBriefRequiredSnapshot: designSnapshot.designBriefRequiredSnapshot,
            estimatedDesignMinutesSnapshot: designSnapshot.estimatedDesignMinutesSnapshot,
            includedDesignMinutesSnapshot: designSnapshot.includedDesignMinutesSnapshot,
            designPricingModeSnapshot: designSnapshot.designPricingModeSnapshot,
            flatFeeAmountSnapshot: designSnapshot.flatFeeAmountSnapshot,
            hourlyRateSnapshot: designSnapshot.hourlyRateSnapshot,
            overageRateSnapshot: designSnapshot.overageRateSnapshot,
            internalLaborRateSnapshot: designSnapshot.internalLaborRateSnapshot,
            needsDesignOverride: designSnapshot.needsDesignOverride,
            requiresDesign: designSnapshot.effectiveRequiresDesign,
            requiresProofApproval: requiresProofApprovalSafe,
            requiresPrepress: lineItem.requiresPrepress ?? true,
            specsJson: specsJsonWithPricing ?? undefined,
            selectedOptions,
            nestingConfigSnapshot,
            materialId: lineItem.materialId ?? null,
            materialUsageJson,
            materialUsages,
            requiresInventory: lineItem.requiresInventory ?? undefined,
            sortOrder: lineItem.sortOrder ?? 0, // Default to 0 if not provided
            // In schema this is optional (defaultable) but not nullable: use undefined (omit) rather than null.
            taxAmount: lineItem.taxAmount == null ? undefined : String(lineItem.taxAmount),
            isTaxableSnapshot: lineItem.isTaxableSnapshot ?? undefined,
            // PBV2 server-authoritative fields (Phase 5)
            pbv2TreeVersionId: (lineItem as any).pbv2TreeVersionId ?? undefined,
            pbv2SnapshotJson: (lineItem as any).pbv2SnapshotJson ?? undefined,
            pricedAt: (lineItem as any).pricedAt ?? undefined,
            overridePriceCents: effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null,
            overrideAt: effectivePricing.hasPriceOverride ? new Date() : null,
            overrideByUserId: effectivePricing.hasPriceOverride ? ((lineItem as any).overrideByUserId ?? null) : null,
            overrideReason: (lineItem as any).overrideReason ?? null,
            parentLineItemId: (lineItem as any).parentLineItemId ?? null,
            lineItemRole: (lineItem as any).lineItemRole ?? "standalone",
            childDisplayMode: (lineItem as any).childDisplayMode ?? "hidden",
            parentPriceMode: (lineItem as any).parentPriceMode ?? "sum_children",
            childCalculatedTotalCents: (lineItem as any).childCalculatedTotalCents ?? null,
        };
        const [created] = await this.dbInstance.insert(orderLineItems).values(lineItemInsert).returning();
        return created;
    }

    async updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem> {
        const updateData: any = { ...lineItem, updatedAt: new Date() };
        const [updated] = await this.dbInstance
            .update(orderLineItems)
            .set(updateData)
            .where(eq(orderLineItems.id, id))
            .returning();
        if (!updated) throw new Error('Order line item not found');
        return updated;
    }

    async deleteOrderLineItem(id: string): Promise<void> {
        await this.dbInstance.delete(orderLineItems).where(eq(orderLineItems.id, id));
    }

    // Shipment operations
    async getShipmentsByOrder(organizationId: string, orderId: string): Promise<Shipment[]> {
        return await this.dbInstance
            .select()
            .from(shipments)
            .where(and(eq(shipments.organizationId, organizationId), eq(shipments.orderId, orderId)))
            .orderBy(desc(shipments.createdAt));
    }

    async getShipmentById(id: string): Promise<Shipment | undefined> {
        const [shipment] = await this.dbInstance.select().from(shipments).where(eq(shipments.id, id));
        return shipment;
    }

    async createShipment(shipment: InsertShipment): Promise<Shipment> {
        let organizationId = (shipment as any).organizationId as string | undefined;

        if (!organizationId && shipment.orderId) {
            const [order] = await this.dbInstance
                .select({ organizationId: orders.organizationId })
                .from(orders)
                .where(eq(orders.id, shipment.orderId))
                .limit(1);
            organizationId = order?.organizationId;
        }

        if (!organizationId) {
            throw new Error('organizationId is required to create shipment');
        }

        const insertPayload: any = {
            ...shipment,
            organizationId,
        };

        if (insertPayload.weightLbs !== undefined && insertPayload.weightLbs !== null) {
            insertPayload.weightLbs = String(insertPayload.weightLbs);
        }
        if (insertPayload.dimLengthIn !== undefined && insertPayload.dimLengthIn !== null) {
            insertPayload.dimLengthIn = String(insertPayload.dimLengthIn);
        }
        if (insertPayload.dimWidthIn !== undefined && insertPayload.dimWidthIn !== null) {
            insertPayload.dimWidthIn = String(insertPayload.dimWidthIn);
        }
        if (insertPayload.dimHeightIn !== undefined && insertPayload.dimHeightIn !== null) {
            insertPayload.dimHeightIn = String(insertPayload.dimHeightIn);
        }

        const [created] = await this.dbInstance.insert(shipments).values(insertPayload).returning();
        return created;
    }

    async updateShipment(id: string, shipmentData: Partial<InsertShipment>): Promise<Shipment> {
        const setPayload: any = { ...shipmentData, updatedAt: new Date() };
        if (setPayload.weightLbs !== undefined && setPayload.weightLbs !== null) {
            setPayload.weightLbs = String(setPayload.weightLbs);
        }
        if (setPayload.dimLengthIn !== undefined && setPayload.dimLengthIn !== null) {
            setPayload.dimLengthIn = String(setPayload.dimLengthIn);
        }
        if (setPayload.dimWidthIn !== undefined && setPayload.dimWidthIn !== null) {
            setPayload.dimWidthIn = String(setPayload.dimWidthIn);
        }
        if (setPayload.dimHeightIn !== undefined && setPayload.dimHeightIn !== null) {
            setPayload.dimHeightIn = String(setPayload.dimHeightIn);
        }

        const [updated] = await this.dbInstance
            .update(shipments)
            .set(setPayload)
            .where(eq(shipments.id, id))
            .returning();
        if (!updated) throw new Error('Shipment not found');
        return updated;
    }

    async deleteShipment(id: string): Promise<void> {
        await this.dbInstance.delete(shipments).where(eq(shipments.id, id));
    }

    // Order attachments operations
    async getOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
        const rows = await this.dbInstance
            .select(ORDER_ATTACHMENT_SAFE_SELECT)
            .from(orderAttachments)
            .where(and(eq(orderAttachments.orderId, orderId), isNull(orderAttachments.orderLineItemId)))
            .orderBy(desc(orderAttachments.createdAt));

        return rows as any;
    }

    async listAllOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
        const rows = await this.dbInstance
            .select(ORDER_ATTACHMENT_SAFE_SELECT)
            .from(orderAttachments)
            .where(eq(orderAttachments.orderId, orderId))
            .orderBy(desc(orderAttachments.createdAt));
        return rows as any;
    }

    async createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment> {
        const role = String((attachment as any).role ?? "").toLowerCase();
        const attachmentValues = {
            ...attachment,
            productionQuantity: (attachment as any).orderLineItemId && ((role === "artwork") || (role === "output"))
                ? (attachment as any).productionQuantity ?? defaultNewProductionArtworkAllocation(role)
                : (attachment as any).productionQuantity ?? null,
        };
        const [newAttachment] = await this.dbInstance
            .insert(orderAttachments)
            .values(attachmentValues)
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if ((newAttachment as any)?.fileRecordId) {
            void import('../workers/thumbnailWorker')
                .then(({ triggerThumbnailGenerationForAttachment }) => {
                    triggerThumbnailGenerationForAttachment({
                        attachmentType: 'order',
                        attachmentId: String((newAttachment as any).id),
                        reason: 'order-repo-create-attachment',
                    });
                })
                .catch((error) => {
                    console.error('[OrdersRepo] Failed to trigger thumbnail generation:', error);
                });
        }

        return newAttachment as any;
    }

    async updateOrderAttachment(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(updates)
            .where(eq(orderAttachments.id, id))
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if (!updated) {
            throw new Error(`Order attachment ${id} not found`);
        }

        return updated as any;
    }

    async deleteOrderAttachment(id: string): Promise<void> {
        await this.dbInstance.delete(orderAttachments).where(eq(orderAttachments.id, id));
    }

    // Artwork & file handling operations
    async listOrderFiles(orderId: string): Promise<(OrderAttachment & { uploadedByUser?: User | null })[]> {
        const files = await this.dbInstance
            .select({
                file: ORDER_ATTACHMENT_SAFE_SELECT,
                user: users,
            })
            .from(orderAttachments)
            .leftJoin(users, eq(orderAttachments.uploadedByUserId, users.id))
            .where(and(eq(orderAttachments.orderId, orderId), isNull(orderAttachments.orderLineItemId)))
            .orderBy(desc(orderAttachments.createdAt));

        return files.map(f => ({
            ...(f.file as any),
            uploadedByUser: f.user || null,
        })) as any;
    }

    async attachFileToOrder(data: InsertOrderAttachment): Promise<OrderAttachment> {
        // Validate isPrimary constraint: only one primary per role+side combination
        if (data.isPrimary && data.role && data.side) {
            // Unset any existing primary for this role+side
            await this.dbInstance
                .update(orderAttachments)
                .set({ isPrimary: false })
                .where(
                    and(
                        eq(orderAttachments.orderId, data.orderId),
                        eq(orderAttachments.role, data.role as any),
                        eq(orderAttachments.side, data.side as any)
                    )
                );
        }

        const [newAttachment] = await this.dbInstance
            .insert(orderAttachments)
            .values(data)
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if ((newAttachment as any)?.fileRecordId) {
            void import('../workers/thumbnailWorker')
                .then(({ triggerThumbnailGenerationForAttachment }) => {
                    triggerThumbnailGenerationForAttachment({
                        attachmentType: 'order',
                        attachmentId: String((newAttachment as any).id),
                        reason: 'order-repo-attach-file',
                    });
                })
                .catch((error) => {
                    console.error('[OrdersRepo] Failed to trigger thumbnail generation:', error);
                });
        }

        return newAttachment as any;
    }

    async updateOrderFileMeta(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        // If setting isPrimary=true, need to unset others for same role+side
        if (updates.isPrimary) {
            // Get the current file to know its orderId, role, side
            const [currentFile] = await this.dbInstance
                .select(ORDER_ATTACHMENT_SAFE_SELECT)
                .from(orderAttachments)
                .where(eq(orderAttachments.id, id));

            if (currentFile) {
                const role = updates.role || currentFile.role;
                const side = updates.side || currentFile.side;

                // Unset other primaries for this role+side
                await this.dbInstance
                    .update(orderAttachments)
                    .set({ isPrimary: false })
                    .where(
                        and(
                            eq(orderAttachments.orderId, currentFile.orderId),
                            eq(orderAttachments.role, role as any),
                            eq(orderAttachments.side, side as any),
                            sql`${orderAttachments.id} != ${id}` // Exclude current file
                        )
                    );
            }
        }

        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(updates)
            .where(eq(orderAttachments.id, id))
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if (!updated) {
            throw new Error(`Order file ${id} not found`);
        }

        return updated as any;
    }

    async detachOrderFile(id: string): Promise<boolean> {
        const deleted = await this.dbInstance
            .delete(orderAttachments)
            .where(and(eq(orderAttachments.id, id), isNull(orderAttachments.orderLineItemId)))
            .returning({ id: orderAttachments.id });

        return deleted.length > 0;
    }

    async getOrderArtworkSummary(orderId: string): Promise<{
        front?: OrderAttachment | null;
        back?: OrderAttachment | null;
        other: OrderAttachment[];
    }> {
        const rows = await this.dbInstance
            .select(ORDER_ATTACHMENT_SAFE_SELECT)
            .from(orderAttachments)
            .where(
                and(
                    eq(orderAttachments.orderId, orderId),
                    eq(orderAttachments.role, 'artwork')
                )
            )
            .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

        const files = rows as any as OrderAttachment[];

        const shared = files.find(f => (f.side as any) === 'both' && f.isPrimary) || files.find(f => (f.side as any) === 'both') || null;
        const front = files.find(f => f.side === 'front' && f.isPrimary) || files.find(f => f.side === 'front') || shared;
        const back = files.find(f => f.side === 'back' && f.isPrimary) || files.find(f => f.side === 'back') || shared;
        const other = files.filter(f => f.side === 'na' || (!f.isPrimary && (f.side === 'front' || f.side === 'back')));

        return { front, back, other };
    }

    // Order audit log operations
    async getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]> {
        return await this.dbInstance
            .select()
            .from(orderAuditLog)
            .where(eq(orderAuditLog.orderId, orderId))
            .orderBy(desc(orderAuditLog.createdAt));
    }

    async createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog> {
        const [auditLogEntry] = await this.dbInstance.insert(orderAuditLog).values(log).returning();
        return auditLogEntry;
    }
}
