import type { Express } from "express";
import { db } from "../db";
import { parseOrderStatusPillIdsQuery } from "./helpers/orderStatusPillFilter";
import { DEFAULT_PRODUCTION_ROUTING_RULES } from "../services/productionMapService";
import {
    auditLogs,
    orders,
    orderAttachments,
    orderAuditLog,
    orderLineItems,
    lineItemFiles,
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
    invoices,
    orderListNotes,
    users,
    customerVisibleProducts,
    materials,
    materialProductLinks,
    orderMaterialUsage,
    inventoryReservations,
    productionJobs,
    productionEvents,
    productionRunMembers,
    productionRuns,
    productTypes,
    insertOrderSchema,
    updateOrderSchema,
    insertOrderInternalNoteSchema,
    insertOrderLineItemSchema,
    insertOrderLineItemNoteSchema,
    updateOrderLineItemSchema,
    updateLineItemDesignBriefSchema,
    insertMaterialSchema,
    updateMaterialSchema,
    insertMaterialReorderRequestSchema,
    type InsertOrder
} from "@shared/schema";
import { isPortalFileCategory, normalizePortalFileCategory } from "@shared/portalFileVisibility";
import { buildArtworkAllocationStatus, defaultNewProductionArtworkAllocation, reconcileStagedArtworkAllocations } from "@shared/artworkAllocation";
import { synchronizeFinalArtworkForLineQuantityChange } from "../services/canonicalArtworkAllocationService";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import { eq, desc, asc, and, isNull, isNotNull, inArray, or, sql } from "drizzle-orm";
import { storage } from "../storage";
import { OrderDeletionProtectedError, OrderIdentityError, OrdersRepository } from "../storage/orders.repo";
import { resolveOrderCustomerContactIds } from "../services/orderCustomerResolutionService";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import Papa from "papaparse";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings, type LineItemInput } from "../quoteOrderPricing";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { ensureCustomerForUser } from "../db/syncUsersToCustomers";
import { updateOrderFulfillmentStatus } from "../fulfillmentService";
import { portalContext, tenantContext, getPortalCustomer } from "../tenantContext";
import { recomputeOrderBillingStatus } from "../services/orderBillingService";
import { listOrderDesignBillingVisibility } from "../services/designCostSummaryService";
import { getInitialWorkflowState, transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { completeProductionJobWorkflow, markOrderReadyForFulfillmentIfProductionComplete } from "./productionJobs.routes";
import {
    isOrderShortcutCompletableProductionStation,
    listOrderProductionPrerequisitesToBypass,
    missingOwnerRepairState,
    requiresCanonicalProductionCompletion,
} from "../services/orderProductionCompletionPolicy";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";
import { appendEvent } from "../productionHelpers";
import { routeLineItemToProduction } from "../services/productionRoutingService";
import { resolvePostPrepressProductionRoute } from "../services/productionRoutingResolver";
import { routeEligibleOrderLineItems } from "../services/orderSaveRoutingService";
import { normalizeOrderSaveRoutingMode } from "@shared/orderSaveRouting";
import {
    businessDateForOrderDueFilter,
    getOrganizationTimezone,
    isOrderDueFilter,
} from "../services/orderDueDateService";
import { getLineItemDesignBriefDetail, upsertLineItemDesignBrief } from "../services/lineItemDesignBriefService";
import { addLineItemNote, addOrderInternalNote, listLineItemNotes, listOrderInternalNotes } from "../services/structuredOrderNotesService";
import { findActiveJobForLineItem } from "../services/productionOwnership";
import { autoSyncCanonicalProofForLineItem, reconcileLineItemProofGateRelease } from "../services/proofingService";
import { materializeLineItemDesignSnapshot } from "../services/designLineItemSnapshot";
import { productDesignConfigRepository } from "../storage/productDesignConfig.repo";
import { pbv2ToChildItemProposals, pbv2ToMaterialEffects, pbv2ToPricingAddons, pbv2ToRuntimeSelectionContext } from "@shared/pbv2/pricingAdapter";
import { enrichRollLinearFootMaterialEffects } from "@shared/pbv2/rollMaterialEffects";
import { extractFormulaVariables, parseFormulaBoolean } from "@shared/pbv2/formulaHelpers";
import { computePbv2InputSignature } from "@shared/pbv2/pbv2InputSignature";
import { pickPbv2EnvExtras } from "@shared/pbv2/pbv2InputSignature";
import type { OptionRuntimeSelectionContext } from "@shared/optionTreeV2";
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
import {
    buildProofApprovalManualOverrideAuditEvent,
    resolveLineItemProofApprovalRequirement,
    resolveProofApprovalLockEnabledFromOrgPreferences,
    resolveProofingPolicyFromOrgPreferences,
} from "@shared/proofApprovalLock";
import {
    buildOrderCreationFingerprint,
    extractOrderCreationIdempotencyKey,
    orderCreationIdempotencyStore,
} from "./helpers/orderCreationIdempotency.helpers";
import { getClientBooleanOverride } from "../lib/clientBooleanOverride";
import {
    mergePricingIntoSpecsJson,
    resolvePersistedLineItemPricing,
    enrichLineItemWithEffectivePricing,
    getPersistedBaseCalculatedTotalCents,
    haveLineItemPricingDriversChanged,
} from "../lib/lineItemPricingPersistence";
import { convertReservationInputToBaseQty } from "@shared/uomConversions";
import {
    createRequestLogOnce,
    enrichAttachmentWithUrls,
    normalizeObjectKeyForDb,
    resolveOriginalFileAccess,
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
import { createLineItemFileRecord } from "../services/lineItemFileRecordService";
import { canonicalArtworkWriteService } from "../services/artwork/CanonicalArtworkWriteService";
import { lineItemArtworkReadResolver } from "../services/artwork/LineItemArtworkReadResolver";
import {
    assertStage18PDevFixtureAccess,
    isStage18PDevFixtureCustomer,
} from "../lib/stage18pDevFixtureAccess";
import {
    getOrderWorkflow,
    publishOrderWorkflowDraft,
    upsertOrderWorkflowDraft,
    updateOrderWorkflowStatus,
} from "../services/orderWorkflowService";
import { assessOrderCancellationEligibility, cancelOrder, OrderCancellationError } from "../services/orderCancellationService";
import { duplicateOrder, OrderDuplicationError } from "../services/orderDuplicationService";
import { assessOrderCloseEligibility } from "../services/orderCloseEligibility";
import { assessOrderOperationalCompletion } from "../services/orderCompletionPolicy";
import { cancelOrderRequestSchema } from "@shared/orderCancellation";
import { isCanceledOrder } from "@shared/operationalState";
import { isLineItemCommerciallyEditable, isOrderCommerciallyEditable } from "@shared/orderCommercialEditability";
import { hasAdminOrOwnerOperationalRole } from "@shared/roleAccess";
import { assertValidParentLink } from "../services/lineItemParentLinking";
import { parentBundlePricingUpdate } from "../services/lineItemBundles";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { deleteStoredObjectKeysIfUnreferenced } from "../services/storage/storageReferenceGuard";
import { fileDerivativeRepository } from "../storage/fileDerivative.repo";
import { buildManualInventoryAdjustment } from "../services/materialInventoryLogic";
import {
    collectLineItemProductionMaterialIds,
    resolveLineItemMaterialDisplayLabel,
} from "./flatStockNesting.shared";
import { generatePackingSlipHtmlForOrder } from "../services/packingSlipService";
import { getFileUploadNamingPolicy } from "../prepressFileService";
import { withOrderOriginalArtworkDisplayFilename } from "../services/originalArtworkFiles";
import { generateOrderPdfBytes, orderPdfFilename, OrderPdfEligibilityError } from "../lib/orderPdf";
import { shouldAutoScheduleCreatedOrderLineItem } from "../services/orderLineItemCreationPolicy";
import { assignPromotedCustomerUpload, CustomerUploadReviewError, designateCustomerUploadArtworkSide, promoteCustomerUpload, reviewCustomerUpload, selectAssignedCustomerUploadForArtwork, selectCustomerUploadPrimaryArtworkCandidate } from "../services/customerUploadReview.service";
import { duplicateMaterial, DuplicateMaterialError } from "../services/materialDuplicationService";
import { canonicalOrderOperations } from "../services/orders/canonicalOrderOperations";
import { normalizeOrderPatchShipping } from "../services/orders/orderHeaderUpdatePolicy";
import { CustomerCreditPolicyError } from "../services/customerCreditPolicyService";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import { FulfillmentHttpError } from "../services/fulfillment/types";
import { recalculateEditableOrderFinancials, recalculateEditableOrderFinancialsInTransaction } from "../services/orders/orderTaxCalculationService";

// Helper function to get userId from request user object
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function normalizeLinkedProductIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((id) => String(id || "").trim()).filter(Boolean)));
}

function buildMaterialLinkWarning(ignoredProductIds: string[]) {
    if (ignoredProductIds.length === 0) return null;
    return {
        code: "MATERIAL_PRODUCT_LINKS_IGNORED",
        message: "Some linked products were inactive, invalid, or unavailable in this organization.",
        productIds: ignoredProductIds,
    };
}

// Retired material sell-price fields remain stored only as compatibility debt.
// Material APIs deliberately do not expose or update them; PBV2 owns sell pricing.
function toPublicMaterial(material: any) {
    const {
        unitOfMeasure: _migrationUnit,
        sellPriceUnit: _retiredSellPriceUnit,
        wholesalePriceUnit: _retiredWholesalePriceUnit,
        wholesaleBaseRate: _retiredWholesaleBaseRate,
        wholesaleMinCharge: _retiredWholesaleMinCharge,
        retailBaseRate: _retiredRetailBaseRate,
        retailMinCharge: _retiredRetailMinCharge,
        ...publicMaterial
    } = material;
    return publicMaterial;
}

function toOperationalMaterialConfig(material: any) {
    return toPublicMaterial(material);
}

// Helper to get organizationId from request (matches server/routes.ts behavior)
function getRequestOrganizationId(req: any): string | undefined {
    return req.organizationId || req.headers['x-organization-id'] as string;
}

const portalAttachmentVisibilitySchema = z.object({
    customerVisible: z.boolean(),
    portalFileCategory: z.string().trim().optional().nullable(),
    portalDisplayName: z.string().trim().max(500).optional().nullable(),
    portalDescription: z.string().trim().max(2000).optional().nullable(),
});

const customerUploadReviewSchema = z.object({
    status: z.enum(["accepted", "rejected"]),
    reviewNote: z.string().trim().max(2000).optional().nullable(),
});

const customerUploadPromotionSchema = z.object({
    promotion: z.enum(["reference", "artwork"]),
    confirmPromotion: z.literal(true),
});

const customerUploadAssignmentSchema = z.object({
    targetOrderId: z.string().trim().min(1),
    targetLineItemId: z.string().trim().min(1),
    assignmentType: z.literal("reference_for_line_item"),
    assignmentNote: z.string().trim().max(2000).optional().nullable(),
    confirmAssignment: z.literal(true),
});

const customerUploadArtworkSelectionSchema = z.object({
    targetOrderId: z.string().trim().min(1),
    targetLineItemId: z.string().trim().min(1),
    artworkSelectionType: z.literal("artwork_side_intake"),
    artworkSelectionNote: z.string().trim().max(2000).optional().nullable(),
    confirmArtworkSelection: z.literal(true),
});

const customerUploadArtworkSideDesignationSchema = z.object({
    targetOrderId: z.string().trim().min(1),
    targetLineItemId: z.string().trim().min(1),
    side: z.enum(["front", "back", "both"]),
    designationNote: z.string().trim().max(2000).optional().nullable(),
    confirmArtworkSideDesignation: z.literal(true),
});

const customerUploadPrimaryArtworkCandidateSchema = z.object({
    targetOrderId: z.string().trim().min(1),
    targetLineItemId: z.string().trim().min(1),
    side: z.enum(["front", "back", "both"]),
    candidateNote: z.string().trim().max(2000).optional().nullable(),
    confirmPrimaryArtworkCandidate: z.literal(true),
});

const completeProductionRequestSchema = z.object({
    confirmBypass: z.literal(true).optional(),
}).strict();

const stage18PDevUploadFixturesSchema = z.object({
    confirmDevFixtureCreation: z.literal(true),
});

const stage18PDevFixtureUploadDefinitions = [
    { key: "front_candidate_a", fileName: "DEV TEST ONLY - Stage 18P - Front Candidate A.png", stage: "pending" },
    { key: "front_candidate_b", fileName: "DEV TEST ONLY - Stage 18P - Front Candidate B.png", stage: "pending" },
    { key: "back_candidate", fileName: "DEV TEST ONLY - Stage 18P - Back Candidate.png", stage: "pending" },
    { key: "both_candidate", fileName: "DEV TEST ONLY - Stage 18P - Both Candidate.png", stage: "pending" },
    { key: "negative_pending", fileName: "DEV TEST ONLY - Stage 18P - Negative Pending.png", stage: "pending" },
    { key: "rejected", fileName: "DEV TEST ONLY - Stage 18P - Rejected Upload.png", stage: "rejected" },
    { key: "accepted_only", fileName: "DEV TEST ONLY - Stage 18P - Accepted Only.png", stage: "accepted" },
    { key: "promoted_unassigned", fileName: "DEV TEST ONLY - Stage 18P - Promoted Unassigned.png", stage: "promoted" },
    { key: "assigned_not_intake", fileName: "DEV TEST ONLY - Stage 18P - Assigned Not Intake.png", stage: "assigned" },
    { key: "intake_side_na", fileName: "DEV TEST ONLY - Stage 18P - Intake Side NA.png", stage: "intake" },
    { key: "operational_primary", fileName: "DEV TEST ONLY - Stage 18P - Operational Primary Denial.png", stage: "operational_primary" },
] as const;

// A harmless 1×1 PNG. It is intentionally embedded so DEV fixture setup does
// not need browser file-selection or any customer-supplied artwork.
const stage18PDevFixturePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7QgAAAABJRU5ErkJggg==",
    "base64",
);

function assertInternalStaffUser(req: any, res: any): boolean {
    if (req.user?.role === "customer" || !req.orgRole) {
        res.status(403).json({ error: "Access denied" });
        return false;
    }
    return true;
}

/**
 * Creates the final Production owner for an authorized Order-level override.
 * Prerequisite jobs are voided (never marked normally complete) and both the
 * event stream and audit log retain the exact stages that were bypassed.
 */
async function bypassOrderProductionPrerequisites(tx: any, args: {
    organizationId: string;
    orderId: string;
    line: any;
    activePrerequisiteJob: any | null;
    bypassedStages: string[];
    actorUserId: string;
    actorUserName: string | null;
}) {
    const now = new Date();
    const source = "order_complete_production_override" as const;
    const activeJob = args.activePrerequisiteJob;

    if (activeJob) {
        const [lastTimer] = await tx
            .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
            .from(productionEvents)
            .where(and(
                eq(productionEvents.organizationId, args.organizationId),
                eq(productionEvents.productionJobId, activeJob.id),
                inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
            ))
            .orderBy(desc(productionEvents.createdAt))
            .limit(1);

        let totalSeconds = Number(activeJob.totalSeconds) || 0;
        if (lastTimer?.type === "timer_started") {
            const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(lastTimer.createdAt as any).getTime()) / 1000));
            totalSeconds += elapsedSeconds;
            await appendEvent({
                tx,
                organizationId: args.organizationId,
                productionJobId: activeJob.id,
                type: "timer_stopped",
                actorUserId: args.actorUserId,
                payload: {
                    seconds: elapsedSeconds,
                    source,
                    reason: "production_prerequisite_bypassed",
                },
            });
        }

        await tx
            .update(productionJobs)
            .set({
                status: "void",
                completedAt: now,
                completedByUserId: args.actorUserId,
                previousStatus: activeJob.status,
                previousStation: activeJob.stationKey,
                totalSeconds,
                updatedAt: now,
            })
            .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, activeJob.id)));

        await appendEvent({
            tx,
            organizationId: args.organizationId,
            productionJobId: activeJob.id,
            type: "note",
            actorUserId: args.actorUserId,
            payload: {
                eventType: "production_prerequisites_bypassed",
                source,
                orderId: args.orderId,
                lineItemId: args.line.id,
                bypassedStages: args.bypassedStages,
                previousStationKey: activeJob.stationKey,
                previousStepKey: activeJob.stepKey,
                previousStatus: activeJob.status,
                actorUserId: args.actorUserId,
                bypassedAt: now.toISOString(),
            },
        });
    }

    await tx
        .update(orderLineItems)
        .set({
            workflowState: "ready_for_production",
            status: "in_production",
            designStatus: args.bypassedStages.includes("Design") ? "bypassed" : args.line.designStatus,
            requiresDesign: args.bypassedStages.includes("Design") ? false : args.line.requiresDesign,
            requiresProofApproval: args.bypassedStages.includes("Proof") ? false : args.line.requiresProofApproval,
            requiresPrepress: args.bypassedStages.includes("Prepress") ? false : args.line.requiresPrepress,
            updatedAt: now,
        } as any)
        .where(eq(orderLineItems.id, args.line.id));

    const route = await resolvePostPrepressProductionRoute({
        organizationId: args.organizationId,
        productTypeId: args.line.productTypeId,
        productTypeNameSnapshot: args.line.productType,
    });
    const productionOwner = await routeLineItemToProduction({
        tx,
        organizationId: args.organizationId,
        orderId: args.orderId,
        lineItemId: args.line.id,
        stationKey: route.stationKey,
        stepKey: route.stepKey,
        trigger: "line_item_status",
        actorUserId: args.actorUserId,
        extraEventPayload: {
            source,
            bypassedStages: args.bypassedStages,
            routingReason: "order_complete_production_override",
        },
    });

    await appendEvent({
        tx,
        organizationId: args.organizationId,
        productionJobId: productionOwner.jobId,
        type: "note",
        actorUserId: args.actorUserId,
        payload: {
            eventType: "production_prerequisites_bypassed",
            source,
            orderId: args.orderId,
            lineItemId: args.line.id,
            bypassedStages: args.bypassedStages,
            actorUserId: args.actorUserId,
            bypassedAt: now.toISOString(),
        },
    });

    await tx.insert(auditLogs).values({
        organizationId: args.organizationId,
        userId: args.actorUserId,
        userName: args.actorUserName,
        actionType: "ORDER_PRODUCTION_PREREQUISITES_BYPASSED",
        entityType: "order_line_item",
        entityId: args.line.id,
        entityName: args.line.description || null,
        description: `Production prerequisites bypassed by Order-level override: ${args.bypassedStages.join(", ")}.`,
        oldValues: {
            workflowState: args.line.workflowState,
            designStatus: args.line.designStatus,
            requiresDesign: args.line.requiresDesign,
            requiresProofApproval: args.line.requiresProofApproval,
            requiresPrepress: args.line.requiresPrepress,
        },
        newValues: {
            source,
            bypassedStages: args.bypassedStages,
            productionJobId: productionOwner.jobId,
            prerequisiteJobId: activeJob?.id ?? null,
        },
    } as any);

    return productionOwner;
}

function normalizePortalVisibilityPatch(input: z.infer<typeof portalAttachmentVisibilitySchema>) {
    const category = input.customerVisible
        ? normalizePortalFileCategory(input.portalFileCategory)
        : input.portalFileCategory && isPortalFileCategory(input.portalFileCategory)
            ? input.portalFileCategory
            : null;

    return {
        customerVisible: input.customerVisible,
        portalFileCategory: category,
        portalDisplayName: input.portalDisplayName || null,
        portalDescription: input.portalDescription || null,
    };
}

const manualInventoryAdjustmentSchema = z.object({
    adjustmentMode: z.enum(["set_quantity", "add_quantity", "subtract_quantity"]),
    quantity: z.coerce.number(),
    reason: z.enum(["damage", "miscount", "scrap", "correction", "received_outside_reorder", "other"]),
    otherReason: z.string().trim().optional(),
    notes: z.string().trim().optional(),
}).superRefine((value, ctx) => {
    if (!Number.isFinite(value.quantity)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity must be numeric" });
    }
    if ((value.adjustmentMode === "add_quantity" || value.adjustmentMode === "subtract_quantity") && value.quantity <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity must be greater than zero" });
    }
    if (value.adjustmentMode === "set_quantity" && value.quantity < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity cannot be negative" });
    }
    if (value.reason === "other" && !value.otherReason?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherReason"], message: "Other reason is required" });
    }
});

const materialReorderReceiveSchema = z.object({
    receivedQuantity: z.coerce.number().positive(),
    notes: z.string().trim().optional(),
});

async function recomputeOrderTotalsFromPersistedLineItems(orderId: string, organizationId: string, actorUserId?: string | null) {
    return recalculateEditableOrderFinancials({ organizationId, orderId, actorUserId: actorUserId ?? null });
}

async function recalculateOrderBundleParent(parentLineItemId: string, executor: any = db) {
    const [parent] = await executor.select().from(orderLineItems).where(eq(orderLineItems.id, parentLineItemId)).limit(1);
    if (!parent || parent.lineItemRole !== "parent") return null;
    const children = await executor.select().from(orderLineItems).where(eq(orderLineItems.parentLineItemId, parent.id));
    const pricing = parentBundlePricingUpdate(parent as any, children as any);
    const [updated] = await executor.update(orderLineItems).set({
        childCalculatedTotalCents: pricing.childCalculatedTotalCents,
        unitPrice: pricing.unitPrice.toFixed(2), totalPrice: pricing.totalPrice.toFixed(2), updatedAt: new Date(),
    }).where(eq(orderLineItems.id, parent.id)).returning();
    return updated ?? null;
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

async function resolveEffectiveLineItemRouting(args: {
    organizationId: string;
    productId: string;
    requestedRequiresDesign?: boolean | null;
    requestedRequiresPrepress?: boolean | null;
    requestedRequiresProofApproval?: boolean | null;
    designDefaultRequiresDesign?: boolean | null;
}) {
    const [org] = await db
        .select({
            prepressDefaultEnabled: organizations.prepressDefaultEnabled,
            settings: organizations.settings,
        })
        .from(organizations)
        .where(eq(organizations.id, args.organizationId))
        .limit(1);

    const [productRow] = await db
        .select({
            requiresPrepressOverride: productTypes.requiresPrepressOverride,
            requiresProofApproval: products.requiresProofApproval,
            workflowIntent: products.workflowIntent,
        })
        .from(products)
        .leftJoin(productTypes, eq(products.productTypeId, productTypes.id))
        .where(eq(products.id, args.productId))
        .limit(1);

    const fulfillmentOrService = productRow?.workflowIntent === "fulfillment_only" || productRow?.workflowIntent === "service_fee";
    const requiresDesign = typeof args.requestedRequiresDesign === "boolean"
        ? args.requestedRequiresDesign
        : fulfillmentOrService ? false : args.designDefaultRequiresDesign === true;
    const requiresPrepress = typeof args.requestedRequiresPrepress === "boolean"
        ? args.requestedRequiresPrepress
        : fulfillmentOrService ? false : productRow?.requiresPrepressOverride ?? org?.prepressDefaultEnabled ?? true;
    const proofApproval = resolveLineItemProofApprovalRequirement({
        productRequiresProofApproval: Boolean(productRow?.requiresProofApproval),
        requestedRequiresProofApproval: args.requestedRequiresProofApproval,
        proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences((org?.settings as any)?.preferences),
        proofingPolicy: resolveProofingPolicyFromOrgPreferences((org?.settings as any)?.preferences),
    });
    const requiresProofApproval = fulfillmentOrService && typeof args.requestedRequiresProofApproval !== "boolean"
        ? false
        : proofApproval.requiresProofApproval;

    return {
        requiresDesign,
        requiresPrepress,
        requiresProofApproval,
        proofApprovalManualOverride: proofApproval.manualOverride,
        isServiceFee: productRow?.workflowIntent === "service_fee",
        workflowState: getInitialWorkflowState({ requiresDesign, requiresPrepress, requiresProofApproval }),
    };
}

export const ROUTING_EDIT_INTAKE_SAFE_STATES = [
    "new",
    "needs_design",
    "ready_for_prepress",
    "ready_for_production",
    "in_design",
    "awaiting_proof_approval",
    "in_prepress",
    "in_production",
    "on_hold",
] as const;

const LINE_ITEM_EDIT_LOCKED_STATES = new Set(["completed", "complete", "canceled", "cancelled"]);
const ACTIVE_LINE_ITEM_EDIT_WARNING_STATES = new Set([
    "ready_for_prepress",
    "in_prepress",
    "ready_for_production",
    "in_production",
    "awaiting_proof_approval",
    "in_design",
    "on_hold",
]);

export function canEditLineItemRouting(args: {
    workflowState?: string | null;
    hasActiveJob: boolean;
}): boolean {
    const currentWorkflowState = String(args.workflowState || "new").trim().toLowerCase();
    return !LINE_ITEM_EDIT_LOCKED_STATES.has(currentWorkflowState);
}

const productionLineItemStatusRulesSchema = z.array(productionLineItemStatusRuleSchema);

const workflowStatusInputSchema = z
    .object({
        key: z.string().min(1),
        label: z.string().min(1),
        category: z.enum(["new", "active", "ready", "completed", "canceled", "on_hold"]),
        color: z.string().optional().nullable(),
        sortOrder: z.number().int().optional(),
        isDefaultForNew: z.boolean().optional(),
        isActive: z.boolean().optional(),
    })
    .strict();

const workflowDraftPayloadSchema = z
    .object({
        name: z.string().min(1).max(120).optional(),
        statuses: z.array(workflowStatusInputSchema).min(1).optional(),
    })
    .strict();

const SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES = () => DEFAULT_PRODUCTION_ROUTING_RULES.map((rule) => ({ ...rule }));

async function loadProductionLineItemStatusRulesForOrganization(organizationId: string) {
    const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

    const settings = (org?.settings as any) ?? {};
    const raw = settings?.preferences?.production?.lineItemStatuses;

    if (raw == null) {
        return { source: 'missing' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES() };
    }

    const parsed = productionLineItemStatusRulesSchema.safeParse(raw);
    if (!parsed.success) {
        return { source: 'invalid' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES() };
    }

    if (parsed.data.length === 0) {
        return { source: 'empty' as const, rules: SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES() };
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
    runtimeSelectionContext: OptionRuntimeSelectionContext;
    pricing: { addOnCents: number; breakdown: any[] };
    materials: any[];
    materialWarnings?: any[];
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
        const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(treeVersion.treeJson as any, explicitSelections, env as any);
        const materialsRes = pbv2ToMaterialEffects(treeVersion.treeJson as any, explicitSelections, env as any);
        const materialIds = Array.from(new Set(
            (materialsRes.materials ?? [])
                .map((material: any) => String(material?.skuRef || "").trim())
                .filter(Boolean),
        ));
        const materialRows = materialIds.length > 0
            ? await db
                .select({
                    id: materials.id,
                    name: materials.name,
                    materialForm: materials.materialForm,
                    inventoryUnit: materials.inventoryUnit,
                    consumptionUnit: materials.consumptionUnit,
                    width: materials.width,
                    edgeWasteInPerSide: materials.edgeWasteInPerSide,
                })
                .from(materials)
                .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
            : [];
        const treeMeta = (treeVersion.treeJson as any)?.meta && typeof (treeVersion.treeJson as any).meta === "object"
            ? (treeVersion.treeJson as any).meta
            : {};
        const pricingProfileConfig = product.pricingProfileConfig && typeof product.pricingProfileConfig === "object"
            ? product.pricingProfileConfig as Record<string, unknown>
            : {};
        const formulaVariables = {
            ...extractFormulaVariables({ variables: (pricingProfileConfig as any).variables }),
            ...extractFormulaVariables({ variables: (pricingProfileConfig as any).formulaVariables }),
            ...extractFormulaVariables({ variables: (treeMeta as any).variables }),
            ...extractFormulaVariables({ variables: (treeMeta as any).formulaVariables }),
            ...extractFormulaVariables({ variables: (treeMeta as any).pricingFormulaVariables }),
        };
        const allowRotation = Object.prototype.hasOwnProperty.call(formulaVariables, "allow_rotation")
            ? parseFormulaBoolean((formulaVariables as any).allow_rotation)
            : false;
        const enrichedMaterials = enrichRollLinearFootMaterialEffects({
            effects: materialsRes.materials,
            materials: materialRows,
            env,
            formulaVariables,
            allowRotation,
        });
        const childItemsRes = pbv2ToChildItemProposals(treeVersion.treeJson as any, explicitSelections, env as any);
        materials = enrichedMaterials.effects;
        childItems = childItemsRes.childItems;
        pricing = { addOnCents: pricingRes.addOnCents, breakdown: pricingRes.breakdown };
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
            runtimeSelectionContext,
            pricing,
            materials,
            materialWarnings: enrichedMaterials.warnings,
            childItems,
        };

        return { treeVersionId: String(treeVersion.id), snapshotJson };
    } catch (e: any) {
        const err: any = new Error(e?.message || 'PBV2 evaluation failed');
        err.statusCode = 400;
        throw err;
    }
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
    customerId: string | null | undefined,
    contactId?: string | null,
    shippingMethod?: string | null,
    shippingMode?: string | null
): Promise<Record<string, any>> {
    const [customer] = customerId ? await db.select().from(customers).where(and(
        eq(customers.id, customerId), eq(customers.organizationId, organizationId)
    )).limit(1) : [];

    let contact = null;
    if (contactId) {
        const [foundContact] = await db
            .select()
            .from(customerContacts as any)
            .where(and(eq((customerContacts as any).id, contactId), eq((customerContacts as any).organizationId, organizationId)))
            .limit(1);
        contact = foundContact;
    }

    if (!customer && !contact) throw new Error("Order identity requires a customer or contact.");
    const billToName = contact
        ? `${contact.firstName} ${contact.lastName}`.trim()
        : customer!.companyName;

    const billToSnapshot = {
        billToName,
        billToCompany: customer?.companyName ?? null,
        billToAddress1: customer ? (customer.billingStreet1 || customer.billingAddress || null) : (contact?.street1 || null),
        billToAddress2: customer ? (customer.billingStreet2 || null) : (contact?.street2 || null),
        billToCity: customer ? (customer.billingCity || null) : (contact?.city || null),
        billToState: customer ? (customer.billingState || null) : (contact?.state || null),
        billToPostalCode: customer ? (customer.billingPostalCode || null) : (contact?.postalCode || null),
        billToCountry: customer ? (customer.billingCountry || 'US') : (contact?.country || 'US'),
        billToPhone: customer?.phone || contact?.phone || contact?.mobile || null,
        billToEmail: customer?.email || contact?.email || null,
    };

    const finalShippingMethod = shippingMethod || 'ship';
    const finalShippingMode = shippingMode || 'single_shipment';

    let shipToSnapshot: Record<string, any>;

    if (finalShippingMethod === 'pickup') {
        shipToSnapshot = {
            shipToName: billToName,
            shipToCompany: customer?.companyName ?? null,
            shipToAddress1: billToSnapshot.billToAddress1,
            shipToAddress2: billToSnapshot.billToAddress2,
            shipToCity: billToSnapshot.billToCity,
            shipToState: billToSnapshot.billToState,
            shipToPostalCode: billToSnapshot.billToPostalCode,
            shipToCountry: billToSnapshot.billToCountry,
            shipToPhone: billToSnapshot.billToPhone,
            shipToEmail: billToSnapshot.billToEmail,
        };
    } else {
        const hasShippingAddress = !!customer && (!!customer.shippingStreet1 || !!customer.shippingAddress);

        shipToSnapshot = {
            shipToName: billToName,
            shipToCompany: customer?.companyName ?? null,
            shipToAddress1: hasShippingAddress
                ? (customer!.shippingStreet1 || customer!.shippingAddress || null)
                : billToSnapshot.billToAddress1,
            shipToAddress2: hasShippingAddress
                ? (customer!.shippingStreet2 || null)
                : billToSnapshot.billToAddress2,
            shipToCity: hasShippingAddress
                ? (customer!.shippingCity || null)
                : billToSnapshot.billToCity,
            shipToState: hasShippingAddress
                ? (customer!.shippingState || null)
                : billToSnapshot.billToState,
            shipToPostalCode: hasShippingAddress
                ? (customer!.shippingPostalCode || null)
                : billToSnapshot.billToPostalCode,
            shipToCountry: hasShippingAddress
                ? (customer!.shippingCountry || 'US')
                : billToSnapshot.billToCountry,
            shipToPhone: billToSnapshot.billToPhone,
            shipToEmail: billToSnapshot.billToEmail,
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

async function createProofApprovalManualOverrideAuditLog(args: {
    organizationId: string;
    userId: string | null | undefined;
    userName: string | null | undefined;
    entityType: "quote_line_item" | "order_line_item";
    entityId: string;
    entityName?: string | null;
    executor?: any;
}) {
    const auditEvent = buildProofApprovalManualOverrideAuditEvent({
        entityType: args.entityType,
        entityId: args.entityId,
        entityName: args.entityName,
    });
    await (args.executor ?? db).insert(auditLogs).values({
        organizationId: args.organizationId,
        userId: args.userId ?? null,
        userName: args.userName ?? null,
        ...auditEvent,
    });
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

    // This route family always runs after tenantContext. Keep saved-order line
    // mutations bound to the authoritative membership role rather than the
    // global users.role/users.isAdmin identity fields.
    const requireOrderLineItemAdminOrOwner = (req: any, res: any, next: any) => {
        if (hasAdminOrOwnerOperationalRole(String(req.actorOrgRole ?? req.orgRole ?? ""))) {
            return next();
        }
        return res.status(403).json({ message: "Access denied. Organization Admin or Owner role required." });
    };

    const persistOrderAttachment = async (args: {
        orderId: string;
        orderLineItemId?: string | null;
        quoteId?: string | null;
        organizationId: string;
        userId: string | null;
        userName: string;
        description?: string | null;
        requestedTarget?: string | null;
        orderNumber?: string | null;
        role?: FileRole;
        side?: FileSide;
        isPrimary?: boolean;
        productionQuantity?: number | null;
        productionGroupId?: string | null;
        source:
            | {
                kind: "buffer";
                buffer: Buffer;
                originalFilename: string;
                mimeType: string;
            }
            | {
                kind: "upload-session";
                uploadId: string;
                expectedPurpose: "order-attachment";
                expectedParentId: string;
            }
            | {
                kind: "existing-key";
                fileUrl: string;
                originalFilename: string;
                mimeType?: string | null;
                fileSize?: number | null;
                checksum?: string | null;
                storedFilename?: string | null;
                extension?: string | null;
            };
    }) => {
        const sourceMimeType = (
            args.source.kind === 'buffer'
                ? args.source.mimeType
                : 'mimeType' in args.source
                    ? args.source.mimeType ?? null
                    : null
        )?.toLowerCase() ?? '';
        const sourceFilename = (
            args.source.kind === 'upload-session'
                ? ''
                : args.source.originalFilename
        ).toLowerCase();
        const isPdfSource = sourceMimeType.includes('pdf') || sourceFilename.endsWith('.pdf');

        const finalized = await storageApplicationService.finalizeUpload({
            organizationId: args.organizationId,
            createdByUserId: args.userId,
            requestedTarget: args.requestedTarget,
            resource: {
                organizationId: args.organizationId,
                resourceType: "order",
                resourceId: args.orderId,
                orderNumber: args.orderNumber ?? undefined,
                lineItemId: args.orderLineItemId ?? undefined,
            },
            source: args.source,
            persistLink: async (tx, stored) => {
                if (args.orderLineItemId && args.role === "artwork") {
                    await canonicalArtworkWriteService.attachSourceArtwork({
                        tx,
                        organizationId: args.organizationId,
                        orderId: args.orderId,
                        lineItemId: args.orderLineItemId,
                        fileRecordId: stored.fileRecord.id,
                        side: args.side,
                        allocationQuantity: args.productionQuantity ?? null,
                        allocationGroupId: args.productionGroupId ?? null,
                        actorUserId: args.userId,
                    });
                }
                let created: typeof orderAttachments.$inferSelect | undefined;
                try {
                    [created] = await tx.insert(orderAttachments).values({
                        orderId: args.orderId,
                        orderLineItemId: args.orderLineItemId ?? null,
                        quoteId: args.quoteId || null,
                        fileRecordId: stored.fileRecord.id,
                        uploadedByUserId: args.userId,
                        uploadedByName: args.userName,
                        description: args.description || null,
                        fileName: stored.storedObject.originalFilename,
                        fileUrl: null,
                        fileSize: stored.storedObject.sizeBytes,
                        mimeType: stored.storedObject.mimeType,
                        originalFilename: stored.storedObject.originalFilename,
                        storedFilename: stored.storedObject.storedFilename,
                        relativePath: null,
                        storageProvider: null,
                        extension: stored.storedObject.extension,
                        checksum: stored.storedObject.checksum,
                        sizeBytes: stored.storedObject.sizeBytes,
                        thumbStatus: isPdfSource ? 'thumb_pending' : 'uploaded',
                        role: args.role ?? 'other',
                        side: args.side ?? 'na',
                        isPrimary: args.isPrimary ?? false,
                        productionQuantity: args.orderLineItemId && (args.role === "artwork" || args.role === "output")
                            ? args.productionQuantity ?? defaultNewProductionArtworkAllocation(args.role)
                            : null,
                        productionGroupId: args.orderLineItemId && (args.role === "artwork" || args.role === "output")
                            ? args.productionGroupId ?? null
                            : null,
                    }).returning();
                } catch (error: any) {
                    console.error("[OrderAttachments:COMPATIBILITY_PROJECTION] Failed", {
                        stage: "compatibility_projection",
                        organizationId: args.organizationId,
                        orderId: args.orderId,
                        lineItemId: args.orderLineItemId ?? null,
                        fileRecordId: stored.fileRecord.id,
                        actorUserId: args.userId,
                        role: args.role ?? "other",
                        side: args.side ?? "na",
                        error: error?.message ?? String(error),
                        code: error?.code ?? null,
                        stack: error?.stack ?? null,
                    });
                    throw error;
                }

                if (!created) {
                    throw new Error("Failed to create order attachment link");
                }

                return created;
            },
        });

        void import('../workers/thumbnailWorker')
            .then(({ triggerThumbnailGenerationForAttachment }) => {
                triggerThumbnailGenerationForAttachment({
                    attachmentType: 'order',
                    attachmentId: String(finalized.linkedRecord.id),
                    reason: 'order-attachment-upload',
                });
            })
            .catch((error) => {
                console.error('[OrderAttachments:POST] Failed to trigger thumbnail generation:', error);
            });

        return finalized.linkedRecord;
    };

    const kickoffOrderPdfThumbnailProcessing = async (args: {
        organizationId: string;
        attachment: any;
        logLabel: string;
    }) => {
        const attachmentFileName = String(args.attachment?.originalFilename ?? args.attachment?.fileName ?? '').toLowerCase();
        const attachmentMimeType = String(args.attachment?.mimeType ?? '').toLowerCase();
        const isPdf = attachmentMimeType.includes('pdf') || attachmentFileName.endsWith('.pdf');

        if (!isPdf) {
            return;
        }

        const resolvedOriginal = args.attachment.fileRecordId
            ? await canonicalFileReadResolver.resolveOriginal(String(args.attachment.fileRecordId))
            : null;
        const canonicalStorageKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? args.attachment.fileUrl ?? null;
        const canonicalStorageProvider = resolvedOriginal?.providerType === 'local_filesystem'
            ? 'local'
            : resolvedOriginal?.providerType === 's3'
                ? 's3'
                : resolvedOriginal?.objectKey
                    ? 'supabase'
                    : ((args.attachment.storageProvider as 'local' | 's3' | 'gcs' | 'supabase' | null | undefined) ?? null);
        const isNotHttpUrl = typeof canonicalStorageKey === 'string' && canonicalStorageKey.length > 0 && !/^https?:\/\//i.test(canonicalStorageKey);

        if (!canonicalStorageProvider || !canonicalStorageKey || !isNotHttpUrl) {
            return;
        }

        setImmediate(() => {
            void (async () => {
                try {
                    const { processPdfAttachmentDerivedData } = await import('../services/pdfProcessing');
                    await processPdfAttachmentDerivedData({
                        orgId: args.organizationId,
                        attachmentId: String(args.attachment.id),
                        storageKey: canonicalStorageKey,
                        storageProvider: canonicalStorageProvider,
                        mimeType: args.attachment.mimeType || null,
                        attachmentType: 'order',
                    });
                } catch (error: any) {
                    console.error(`[${args.logLabel}] PDF kickoff failed for ${args.attachment.id}:`, error);
                }
            })();
        });
    };

    const createOriginalLineItemFileFromOrderAttachment = async (args: {
        organizationId: string;
        orderId: string;
        lineItemId: string;
        attachment: any;
        userId: string;
    }) => {
        const resolvedOriginal = args.attachment.fileRecordId
            ? await canonicalFileReadResolver.resolveOriginal(String(args.attachment.fileRecordId))
            : null;
        const storagePath =
            resolvedOriginal?.objectKey ||
            resolvedOriginal?.localPathRef ||
            (args.attachment.fileUrl as string | null) ||
            null;

        if (!storagePath) return null;

        return createLineItemFileRecord({
            organizationId: args.organizationId,
            orderId: args.orderId,
            lineItemId: args.lineItemId,
            role: 'original',
            storagePath,
            storageKey: storagePath,
            storageBucket: null,
            originalFilename: (args.attachment.originalFilename as string | null) || (args.attachment.fileName as string),
            mimeType: args.attachment.mimeType,
            sizeBytes: args.attachment.sizeBytes ?? args.attachment.fileSize,
            fileRecordId: args.attachment.fileRecordId ?? null,
            sourceOrderAttachmentId: args.attachment.id ?? null,
            uploadedByUserId: args.userId,
        });
    };

    const getPendingOrderArtworkUploads = (lineItem: any): Array<{
        uploadId: string;
        productionQuantity: number | null;
        productionGroupId: string | null;
        allocationSource: "automatic" | "manual";
    }> => {
        const raw = Array.isArray(lineItem?.pendingOrderAttachmentUploadIds)
            ? lineItem.pendingOrderAttachmentUploadIds
            : Array.isArray(lineItem?.pendingOrderAttachments)
                ? lineItem.pendingOrderAttachments.map((attachment: any) => attachment?.uploadId)
                : [];
        const allocationByUploadId = new Map(
            (Array.isArray(lineItem?.pendingOrderArtworkAllocations) ? lineItem.pendingOrderArtworkAllocations : [])
                .filter((allocation: any) => typeof allocation?.uploadId === "string" && allocation.uploadId.trim().length > 0)
                .map((allocation: any) => [
                    allocation.uploadId.trim(),
                    {
                        productionQuantity: allocation.productionQuantity == null || allocation.productionQuantity === ""
                            ? null
                            : Number(allocation.productionQuantity),
                        productionGroupId: typeof allocation.productionGroupId === "string" && allocation.productionGroupId.trim()
                            ? allocation.productionGroupId.trim()
                            : null,
                        allocationSource: allocation.allocationSource === "manual" ? "manual" as const : "automatic" as const,
                    },
                ]),
        );

        const uploads = Array.from(new Set(
            raw
                .map((uploadId: unknown) => typeof uploadId === "string" ? uploadId.trim() : "")
                .filter((uploadId: string) => uploadId.length > 0)
        )).map((uploadId) => ({
            uploadId,
            productionQuantity: allocationByUploadId.get(uploadId)?.productionQuantity ?? null,
            productionGroupId: allocationByUploadId.get(uploadId)?.productionGroupId ?? null,
            allocationSource: allocationByUploadId.get(uploadId)?.allocationSource ?? "automatic" as const,
        }));

        // The browser supplies an immediate draft default, but promotion is the
        // authority boundary. Reapply only safe automatic defaults here so a
        // stale client cannot leave a single artwork allocation blank.
        return reconcileStagedArtworkAllocations({
            lineQuantity: lineItem?.quantity,
            attachments: uploads,
        }).map((upload) => ({
            ...upload,
            productionQuantity: upload.productionQuantity ?? null,
            productionGroupId: upload.productionGroupId ?? null,
            allocationSource: upload.allocationSource === "manual" ? "manual" : "automatic",
        }));
    };

    const promoteDirectOrderPendingArtwork = async (args: {
        organizationId: string;
        order: any;
        sourceLineItems: any[];
        createdLineItems: any[];
        userId: string;
        userName: string;
        requestedTarget?: string | null;
    }): Promise<Array<{ lineItemIndex: number; uploadId: string; message: string }>> => {
        const warnings: Array<{ lineItemIndex: number; uploadId: string; message: string }> = [];

        for (let index = 0; index < args.sourceLineItems.length; index += 1) {
            const uploads = getPendingOrderArtworkUploads(args.sourceLineItems[index]);
            if (uploads.length === 0) continue;

            const createdLineItem = args.createdLineItems[index];
            const orderLineItemId = createdLineItem?.id ? String(createdLineItem.id) : null;
            if (!orderLineItemId) {
                for (const upload of uploads) {
                    warnings.push({ lineItemIndex: index, uploadId: upload.uploadId, message: "Created order line item was not returned for TEMP artwork promotion." });
                }
                continue;
            }

            for (const upload of uploads) {
                try {
                    const attachment = await persistOrderAttachment({
                        orderId: String(args.order.id),
                        orderLineItemId,
                        quoteId: null,
                        organizationId: args.organizationId,
                        userId: args.userId,
                        userName: args.userName,
                        requestedTarget: args.requestedTarget,
                        orderNumber: args.order.orderNumber ? String(args.order.orderNumber) : undefined,
                        role: "artwork",
                        side: "na",
                        isPrimary: false,
                        productionQuantity: upload.productionQuantity,
                        productionGroupId: upload.productionGroupId,
                        source: {
                            kind: "upload-session",
                            uploadId: upload.uploadId,
                            expectedPurpose: "order-attachment",
                            expectedParentId: String(args.order.id),
                        },
                    });

                    await kickoffOrderPdfThumbnailProcessing({
                        organizationId: args.organizationId,
                        attachment,
                        logLabel: "DirectOrderPendingArtwork",
                    });

                    await createOriginalLineItemFileFromOrderAttachment({
                        organizationId: args.organizationId,
                        orderId: String(args.order.id),
                        lineItemId: orderLineItemId,
                        attachment,
                        userId: args.userId,
                    });

                    try {
                        await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                            organizationId: args.organizationId,
                            lineItemId: orderLineItemId,
                            actorUserId: args.userId,
                            reason: "artwork_saved",
                        }));
                    } catch (proofSyncError) {
                        console.error("[AutoProofSync:DIRECT_ORDER_TEMP_ARTWORK] Failed after TEMP artwork promotion (non-fatal):", proofSyncError);
                    }
                } catch (error: any) {
                    console.error("[DirectOrderPendingArtwork] Failed to promote TEMP upload", {
                        orderId: args.order.id,
                        orderLineItemId,
                        uploadId: upload.uploadId,
                        error: error?.message || String(error),
                    });
                    warnings.push({ lineItemIndex: index, uploadId: upload.uploadId, message: error?.message || "Failed to promote TEMP artwork upload." });
                }
            }
        }

        return warnings;
    };

    app.get("/api/workflow/order", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const userId = getUserId(req.user);
            const data = await getOrderWorkflow(organizationId, userId ?? null);
            return res.json({ success: true, data });
        } catch (error: any) {
            console.error("[GET /api/workflow/order]", error);
            return res.status(500).json({ success: false, message: "Failed to load order workflow", error: error?.message });
        }
    });

    app.post("/api/workflow/order/draft", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const parsed = workflowDraftPayloadSchema.safeParse(req.body ?? {});
            if (!parsed.success) {
                return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
            }

            const userId = getUserId(req.user);
            const data = await upsertOrderWorkflowDraft(organizationId, userId ?? null, parsed.data);
            return res.json({ success: true, data, message: "Draft workflow saved" });
        } catch (error: any) {
            console.error("[POST /api/workflow/order/draft]", error);
            return res.status(500).json({ success: false, message: "Failed to save draft workflow", error: error?.message });
        }
    });

    app.post("/api/workflow/order/publish", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const data = await publishOrderWorkflowDraft(organizationId);
            return res.json({ success: true, data, message: "Workflow published" });
        } catch (error: any) {
            const message = String(error?.message || "Failed to publish workflow");
            if (message.includes("No draft workflow")) {
                return res.status(400).json({ success: false, message });
            }
            console.error("[POST /api/workflow/order/publish]", error);
            return res.status(500).json({ success: false, message: "Failed to publish workflow", error: error?.message });
        }
    });

    app.post("/api/orders/:orderId/status", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

            const { orderId } = req.params;
            const { workflowStatusId, toStatus, reason } = req.body ?? {};

            let resolvedWorkflowStatusId: string | undefined = typeof workflowStatusId === "string" && workflowStatusId.trim().length > 0
                ? workflowStatusId.trim()
                : undefined;

            if (!resolvedWorkflowStatusId && typeof toStatus === "string" && toStatus.trim().length > 0) {
                const workflow = await getOrderWorkflow(organizationId, userId);
                const matched = workflow.statuses.find((s: any) => s.key === toStatus.trim().toLowerCase());
                resolvedWorkflowStatusId = matched?.id;
            }

            if (!resolvedWorkflowStatusId) {
                return res.status(400).json({ success: false, message: "workflowStatusId or valid toStatus is required" });
            }
            if (['canceled', 'cancelled'].includes(String(toStatus || '').trim().toLowerCase())) return res.status(409).json({ success: false, code: 'USE_CANONICAL_CANCELLATION', message: 'Use the canonical order cancellation operation.' });

            const transition = await updateOrderWorkflowStatus({
                organizationId,
                orderId,
                workflowStatusId: resolvedWorkflowStatusId,
                changedByUserId: userId,
                note: typeof reason === "string" ? reason : null,
            });

            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
            await storage.createAuditLog(organizationId, {
                userId,
                userName,
                actionType: 'UPDATE',
                entityType: 'order',
                entityId: transition.order.id,
                entityName: transition.order.orderNumber,
                description: `Changed order status to ${transition.toStatusLabel}${reason ? `: ${reason}` : ''}`,
                oldValues: { workflowStatusId: transition.fromStatusId, status: transition.fromStatusLabel },
                newValues: { workflowStatusId: transition.toStatusId, status: transition.toStatusLabel, canonicalState: transition.canonicalState },
            });

            await storage.createOrderAuditLog({
                orderId: transition.order.id,
                userId,
                userName,
                actionType: 'status_transition',
                fromStatus: transition.fromStatusLabel,
                toStatus: transition.toStatusLabel,
                note: typeof reason === "string" ? reason : null,
                metadata: { workflowStatusId: transition.toStatusId, canonicalState: transition.canonicalState },
            });

            return res.json({
                success: true,
                data: transition.order,
                message: `Order status changed to ${transition.toStatusLabel}`,
            });
        } catch (error: any) {
            const message = String(error?.message || "Failed to change order status");
            if (
                message.includes("Transition not allowed") ||
                message.includes("Invalid workflowStatusId") ||
                message.includes("Order not found")
            ) {
                const status = message.includes("Order not found") ? 404 : 400;
                return res.status(status).json({ success: false, message });
            }
            console.error('[POST /api/orders/:orderId/status] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to change order status", error: error?.message });
        }
    });

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
            const dueFilterRaw = req.query.due as string | undefined;
            if (dueFilterRaw !== undefined && !isOrderDueFilter(dueFilterRaw)) {
                return res.status(400).json({ message: "due must be one of: today, tomorrow, overdue" });
            }
            const dueFilter = dueFilterRaw;

            const hasPaging = pageRaw !== undefined || pageSizeRaw !== undefined;

            if (hasPaging) {
                // Paginated response (match Quotes pattern)
                const page = Math.max(1, parseInt(pageRaw || '1', 10) || 1);
                const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw || '25', 10) || 25));
                // Default to false to avoid breaking page load if thumbnails schema is incomplete
                const includeThumbnails = includeThumbnailsRaw === 'true' || includeThumbnailsRaw === '1';
                const statusPillIds = parseOrderStatusPillIdsQuery(req.query.statusPillIds);
                const dueDatePart = dueFilter
                    ? businessDateForOrderDueFilter(dueFilter, new Date(), await getOrganizationTimezone(organizationId))
                    : undefined;

                const result = await storage.getAllOrdersPaginated(organizationId, {
                    search: req.query.search as string | undefined,
                    status: req.query.status as string | undefined,
                    state: req.query.state as string | undefined,
                    statusPillId: req.query.statusPillId as string | undefined,
                    ...(statusPillIds !== undefined ? { statusPillIds } : {}),
                    priority: req.query.priority as string | undefined,
                    customerId: req.query.customerId as string | undefined,
                    startDate: req.query.startDate as string | undefined,
                    endDate: req.query.endDate as string | undefined,
                    dueFilter,
                    dueDatePart,
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
                            const attachmentsSummaryByOrderId: Record<
                                string,
                                { totalCount: number; previews: Array<{ id: string; filename: string; mimeType?: string | null; thumbnailUrl?: string | null }> }
                            > = {};

                            const previewUrlByOrderId: Record<string, string | null> = {};
                            const previewUrlsByOrderId: Record<string, string[]> = {};
                            const previewCountByOrderId: Record<string, number> = {};

                            for (const orderId of orderIds) {
                                const item = result.items.find((entry: any) => entry.id === orderId);
                                const attachmentsSummary = item?.attachmentsSummary ?? { totalCount: 0, previews: [] };
                                const previews = attachmentsSummary.previews ?? [];
                                const totalCount = attachmentsSummary.totalCount ?? 0;

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

                                            const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');

                                            const thumbByAssetId = new Map<string, string | null>();
                                            await Promise.all(assetIds.map(async (assetId) => {
                                                const asset = assetsById.get(assetId);
                                                if (!asset) return;
                                                const enriched = await enrichAssetPreviewUrls(asset);
                                                const thumb =
                                                    (enriched as any).previewThumbnailUrl ??
                                                    (enriched as any).thumbnailUrl ??
                                                    (enriched as any).thumbUrl ??
                                                    null;
                                                thumbByAssetId.set(assetId, typeof thumb === 'string' && thumb.length ? thumb : null);
                                            }));

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
            // Billing readiness is derived from current line-item workflow and pricing.
            // Recompute on read so service/fee lines cannot remain visibly stale after
            // their product configuration or price was corrected.
            await recomputeOrderBillingStatus({ organizationId, orderId: req.params.id });
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

    app.get("/api/orders/:id/pdf", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            if (!assertInternalStaffUser(req, res)) return;

            const order = await storage.getOrderById(organizationId, req.params.id);
            if (!order) {
                return res.status(404).json({ message: "Order not found" });
            }

            const [organization] = await db
                .select()
                .from(organizations)
                .where(eq(organizations.id, organizationId))
                .limit(1);

            const pdfBytes = await generateOrderPdfBytes({ order: order as any, organization });
            await db.insert(auditLogs).values({
                organizationId,
                userId: getUserId(req.user) ?? null,
                userName: req.user?.email || req.user?.username || req.user?.name || null,
                actionType: req.query?.disposition === "download" ? "order_pdf_downloaded" : "order_pdf_previewed",
                entityType: "order",
                entityId: order.id,
                entityName: (order as any).displayNumber || order.orderNumber,
                description: req.query?.disposition === "download"
                    ? `Downloaded order PDF for ${(order as any).displayNumber || order.orderNumber}.`
                    : `Previewed order PDF for ${(order as any).displayNumber || order.orderNumber}.`,
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${orderPdfFilename(order)}"`);
            return res.status(200).send(Buffer.from(pdfBytes));
        } catch (error) {
            if (error instanceof OrderPdfEligibilityError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            console.error("Error generating order PDF:", error);
            return res.status(500).json({ message: "Failed to generate order PDF" });
        }
    });

    app.patch("/api/orders/:orderId/proof-policy", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const actorUserId = getUserId(req.user);
            if (!actorUserId) return res.status(401).json({ success: false, message: "User ID not found" });

            const parsed = z.object({
                policy: z.enum(["inherit_default", "force_required", "bypass"]),
                reason: z.string().max(1000).optional().nullable(),
            }).safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
            }

            const [existingOrder] = await db
                .select({
                    id: orders.id,
                    orderNumber: orders.orderNumber,
                    proofApprovalPolicyOverride: orders.proofApprovalPolicyOverride,
                    proofApprovalOverrideReason: orders.proofApprovalOverrideReason,
                    proofApprovalOverrideAt: orders.proofApprovalOverrideAt,
                    proofApprovalOverrideByUserId: orders.proofApprovalOverrideByUserId,
                })
                .from(orders)
                .where(and(eq(orders.id, req.params.orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!existingOrder) {
                return res.status(404).json({ success: false, message: "Order not found" });
            }

            const reason = parsed.data.reason?.trim() || null;
            const overrideAt = parsed.data.policy === "inherit_default" ? null : new Date();
            const overrideBy = parsed.data.policy === "inherit_default" ? null : actorUserId;

            const [updatedOrder] = await db
                .update(orders)
                .set({
                    proofApprovalPolicyOverride: parsed.data.policy,
                    proofApprovalOverrideReason: parsed.data.policy === "inherit_default" ? null : reason,
                    proofApprovalOverrideAt: overrideAt,
                    proofApprovalOverrideByUserId: overrideBy,
                    updatedAt: new Date().toISOString(),
                } as any)
                .where(and(eq(orders.id, req.params.orderId), eq(orders.organizationId, organizationId)))
                .returning();

            await db.insert(auditLogs).values({
                organizationId,
                userId: actorUserId,
                userName: req.user?.email || req.user?.name || null,
                actionType: "UPDATE",
                entityType: "order",
                entityId: existingOrder.id,
                entityName: existingOrder.orderNumber,
                description: parsed.data.policy === "bypass"
                    ? "Proof approval bypass enabled for order"
                    : parsed.data.policy === "force_required"
                        ? "Proof approval forced for order"
                        : "Proof approval policy reset to product defaults",
                oldValues: {
                    proofApprovalPolicyOverride: existingOrder.proofApprovalPolicyOverride,
                    proofApprovalOverrideReason: existingOrder.proofApprovalOverrideReason,
                    proofApprovalOverrideAt: existingOrder.proofApprovalOverrideAt,
                    proofApprovalOverrideByUserId: existingOrder.proofApprovalOverrideByUserId,
                },
                newValues: {
                    proofApprovalPolicyOverride: parsed.data.policy,
                    proofApprovalOverrideReason: parsed.data.policy === "inherit_default" ? null : reason,
                    proofApprovalOverrideAt: overrideAt,
                    proofApprovalOverrideByUserId: overrideBy,
                },
                ipAddress: req.ip || null,
                userAgent: req.headers["user-agent"] || null,
            } as any);

            return res.json({ success: true, data: updatedOrder, message: "Proof policy updated" });
        } catch (error: any) {
            console.error("[PATCH /api/orders/:orderId/proof-policy] Error:", error);
            return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || "Failed to update proof policy" });
        }
    });

    app.get("/api/orders/:orderId/proof-recipients", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const [orderRow] = await db
                .select({
                    orderId: orders.id,
                    contactId: orders.contactId,
                    billToEmail: orders.billToEmail,
                    billToName: orders.billToName,
                    customerId: orders.customerId,
                    customerName: customers.companyName,
                    customerEmail: customers.email,
                })
                .from(orders)
                .leftJoin(customers, eq(orders.customerId, customers.id))
                .where(and(eq(orders.id, req.params.orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!orderRow) return res.status(404).json({ success: false, message: "Order not found" });

            const contacts = orderRow.customerId ? await db
                .select({
                    id: customerContacts.id,
                    firstName: customerContacts.firstName,
                    lastName: customerContacts.lastName,
                    email: customerContacts.email,
                    isPrimary: customerContacts.isPrimary,
                    flags: customerContacts.flags,
                })
                .from(customerContacts)
                .where(eq(customerContacts.customerId, orderRow.customerId))
                .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.lastName), asc(customerContacts.firstName)) : [];

            const normalizedContacts = contacts
                .filter((contact) => String(contact.email || "").trim())
                .map((contact) => ({
                    id: contact.id,
                    name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
                    email: String(contact.email || "").trim(),
                    isPrimary: Boolean(contact.isPrimary),
                    isOrderContact: contact.id === orderRow.contactId,
                    isBillingContact: Array.isArray(contact.flags) && contact.flags.includes("billing_contact"),
                }));

            const selected =
                normalizedContacts.find((contact) => contact.isOrderContact) ??
                normalizedContacts.find((contact) => contact.isPrimary) ??
                normalizedContacts.find((contact) => contact.isBillingContact) ??
                (orderRow.billToEmail
                    ? {
                        id: "billing_snapshot",
                        name: orderRow.billToName || orderRow.customerName || "",
                        email: String(orderRow.billToEmail).trim(),
                        isPrimary: false,
                        isOrderContact: false,
                        isBillingContact: true,
                    }
                    : null) ??
                (orderRow.customerEmail
                    ? {
                        id: "customer",
                        name: orderRow.customerName || "",
                        email: String(orderRow.customerEmail).trim(),
                        isPrimary: true,
                        isOrderContact: false,
                        isBillingContact: false,
                    }
                    : null);

            return res.json({
                success: true,
                data: {
                    defaultRecipient: selected,
                    contacts: normalizedContacts,
                },
            });
        } catch (error: any) {
            console.error("[GET /api/orders/:orderId/proof-recipients] Error:", error);
            return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || "Failed to load proof recipients" });
        }
    });

    // Order Traveler — assembles a clean, print-ready whole-order summary
    // (header + all line items) for the shared ticket-printing framework.
    // Read-only; backend stays the source of truth for material names etc.
    app.get("/api/orders/:orderId/traveler", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) {
                return res.status(500).json({ success: false, message: "Missing organization context", code: "MISSING_ORGANIZATION_CONTEXT" });
            }
            const orderId = String(req.params.orderId || "");
            if (!orderId.trim()) return res.status(400).json({ message: "orderId required" });

            const orderRows = await db
                .select({
                    id: orders.id,
                    orderNumber: orders.orderNumber,
                    poNumber: orders.poNumber,
                    jobLabel: orders.label,
                    dueDate: orders.dueDate,
                    priority: orders.priority,
                    notesInternal: orders.notesInternal,
                    contactId: orders.contactId,
                    customerName: customers.companyName,
                })
                .from(orders)
                .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);

            const order = orderRows[0];
            if (!order) return res.status(404).json({ message: "Order not found" });

            let contactName: string | null = null;
            if (order.contactId) {
                const contactRows = await db
                    .select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName })
                    .from(customerContacts)
                    .where(eq(customerContacts.id, order.contactId))
                    .limit(1);
                const c = contactRows[0];
                if (c) contactName = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null;
            }

            const lineItemRows = await db
                .select({
                    id: orderLineItems.id,
                    description: orderLineItems.description,
                    quantity: orderLineItems.quantity,
                    width: orderLineItems.width,
                    height: orderLineItems.height,
                    materialId: orderLineItems.materialId,
                    productPrimaryMaterialId: products.primaryMaterialId,
                    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
                    materialUsageJson: orderLineItems.materialUsageJson,
                    materialUsages: orderLineItems.materialUsages,
                    specsJson: orderLineItems.specsJson,
                    optionSelectionsJson: orderLineItems.optionSelectionsJson,
                    selectedOptions: orderLineItems.selectedOptions,
                    productionNotes: orderLineItems.productionNotes,
                    sortOrder: orderLineItems.sortOrder,
                    createdAt: orderLineItems.createdAt,
                })
                .from(orderLineItems)
                .leftJoin(products, and(eq(orderLineItems.productId, products.id), eq(products.organizationId, organizationId)))
                .where(eq(orderLineItems.orderId, orderId))
                .orderBy(orderLineItems.sortOrder, orderLineItems.createdAt);

            const materialIds = Array.from(
                new Set(lineItemRows.flatMap((li) => collectLineItemProductionMaterialIds({
                    lineItem: li,
                    productPrimaryMaterialId: li.productPrimaryMaterialId ?? null,
                }))),
            );
            const materialNameById = new Map<string, string>();
            if (materialIds.length > 0) {
                const materialRows = await db
                    .select({ id: materials.id, name: materials.name })
                    .from(materials)
                    .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
                for (const m of materialRows) materialNameById.set(m.id, m.name);
            }

            const travelerLineItems = lineItemRows.map((li) => {
                const size = li.width && li.height ? `${li.width} × ${li.height}` : null;
                return {
                    description: li.description ?? "",
                    quantity: Number(li.quantity) || 0,
                    size,
                    material: resolveLineItemMaterialDisplayLabel({
                        lineItem: li,
                        materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
                        materialById: materialNameById,
                        productPrimaryMaterialId: li.productPrimaryMaterialId ?? null,
                        primaryMaterialName: li.productPrimaryMaterialId ? materialNameById.get(li.productPrimaryMaterialId) ?? null : null,
                    }),
                    productionNotes: li.productionNotes ?? null,
                };
            });

            return res.json({
                success: true,
                data: {
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    poNumber: order.poNumber ?? null,
                    jobLabel: order.jobLabel ?? null,
                    customerName: String(order.customerName || "—"),
                    contactName,
                    dueDate: order.dueDate ?? null,
                    priority: order.priority ?? null,
                    internalNotes: order.notesInternal ?? null,
                    lineItems: travelerLineItems,
                },
            });
        } catch (error) {
            console.error("Error building order traveler:", error);
            return res.status(500).json({ message: "Failed to build order traveler" });
        }
    });

    // Packing slip preview/generation. Read-only: this does not create shipments
    // and does not update fulfillment/order state.
    app.post("/api/orders/:orderId/packing-slip", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

            const orderId = String(req.params.orderId || "");
            if (!orderId.trim()) {
                return res.status(400).json({ success: false, message: "orderId required", code: "VALIDATION_ERROR" });
            }

            const html = await generatePackingSlipHtmlForOrder(organizationId, orderId);
            if (!html) {
                return res.status(404).json({ success: false, message: "Order not found", code: "NOT_FOUND" });
            }

            return res.json({
                success: true,
                data: {
                    html,
                    filename: `packing-slip-${orderId}.html`,
                },
            });
        } catch (error) {
            console.error("Error building packing slip:", error);
            return res.status(500).json({ success: false, message: "Failed to build packing slip" });
        }
    });

    // Print-history logging for an order traveler. Order travelers are not tied
    // to a production job, so we use the existing generic `audit_logs` table
    // (no migration needed) rather than `production_events`.
    app.post("/api/orders/:orderId/traveler-print", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const orderId = String(req.params.orderId || "");
            if (!orderId.trim()) return res.status(400).json({ message: "orderId required" });

            const orderRows = await db
                .select({ id: orders.id, orderNumber: orders.orderNumber })
                .from(orders)
                .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
                .limit(1);
            const order = orderRows[0];
            if (!order) return res.status(404).json({ message: "Order not found" });

            const userId = getUserId(req.user);
            const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || req.user?.email || null;

            await db.insert(auditLogs).values({
                organizationId,
                userId: userId ?? null,
                userName,
                actionType: "PRINT",
                entityType: "order",
                entityId: orderId,
                entityName: order.orderNumber,
                description: `Printed order traveler for ${order.orderNumber}`,
            });

            return res.json({ success: true, data: { success: true } });
        } catch (error) {
            console.error("Error logging order traveler print:", error);
            return res.status(500).json({ message: "Failed to log order traveler print" });
        }
    });

    app.get("/api/orders/:id/design-billing-visibility", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const items = await listOrderDesignBillingVisibility({
                organizationId,
                orderId: String(req.params.id),
            });

            if (items === null) {
                return res.status(404).json({ message: "Order not found" });
            }

            return res.json({ success: true, data: items, message: "Order design billing visibility loaded" });
        } catch (error) {
            console.error("[GET /api/orders/:id/design-billing-visibility] Failed", error);
            return res.status(500).json({ message: "Failed to load order design billing visibility" });
        }
    });

    app.post("/api/orders", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) {
                return res.status(401).json({ success: false, message: "User not authenticated", code: "UNAUTHENTICATED" });
            }

            // Validate the order data (excluding line items for now)
            const { lineItems, idempotencyKey: _bodyIdempotencyKey, creditOverride, creditOverrideReason, jobNumber: _callerJobNumber, ...orderFields } = req.body;

            if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
                return res.status(400).json({ success: false, message: "At least one line item is required", code: "ORDER_LINE_ITEMS_REQUIRED" });
            }

            const quoteLinkageFields = ["quoteId", "sourceQuoteId", "sourceQuoteNumber"].filter((field) => {
                const value = orderFields[field];
                return value !== undefined && value !== null && String(value).trim() !== "";
            });
            const linkedLineItemIndex = lineItems.findIndex((item: any) => {
                const value = item?.quoteLineItemId;
                return value !== undefined && value !== null && String(value).trim() !== "";
            });
            if (quoteLinkageFields.length > 0 || linkedLineItemIndex >= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Direct order creation cannot include quote linkage. Use the quote conversion endpoint for quote-derived orders.",
                    code: "DIRECT_ORDER_QUOTE_LINKAGE_NOT_ALLOWED",
                });
            }

            for (let index = 0; index < lineItems.length; index += 1) {
                const lineItem = lineItems[index];
                if (!Array.isArray(lineItem?.pendingOrderArtworkAllocations)) continue;
                const uploads = getPendingOrderArtworkUploads(lineItem);
                if (uploads.length === 0) continue;
                const allocation = buildArtworkAllocationStatus({
                    lineQuantity: lineItem.quantity,
                    members: uploads.map((upload) => ({
                        id: upload.uploadId,
                        role: "artwork",
                        productionQuantity: upload.productionQuantity,
                        productionGroupId: upload.productionGroupId,
                    })),
                });
                if (!allocation.valid) {
                    return res.status(400).json({
                        success: false,
                        message: `Artwork allocation for line ${index + 1} is unresolved: ${allocation.issue}`,
                        code: "ARTWORK_ALLOCATION_UNRESOLVED",
                        allocation,
                    });
                }
            }

            console.info("[POST /api/orders] Direct order create request reached route", {
                organizationId,
                userId,
                lineItemCount: lineItems.length,
                hasIdempotencyKey: Boolean(req.header("Idempotency-Key") || req.body?.idempotencyKey),
            });

            const createOrderForRequest = async () => {
            const resolvedIdentity = await resolveOrderCustomerContactIds({
                organizationId,
                customerId: orderFields.customerId,
                contactId: orderFields.contactId,
            });
            orderFields.customerId = resolvedIdentity.customerId;
            orderFields.contactId = resolvedIdentity.contactId;

            // Load organization for tax settings
            const [org] = await db
                .select()
                .from(organizations)
                .where(eq(organizations.id, organizationId))
                .limit(1);

            if (!org) {
                throw Object.assign(new Error("Organization not found"), { statusCode: 500 });
            }

            const orgTaxSettings = getOrganizationTaxSettings(org);
            const proofApprovalLockEnabled = resolveProofApprovalLockEnabledFromOrgPreferences((org.settings as any)?.preferences);
            const proofingPolicy = resolveProofingPolicyFromOrgPreferences((org.settings as any)?.preferences);

            // Load customer for tax calculation (if applicable)
            let customer = null;
            if (orderFields.customerId || orderFields.contactId) {
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
                const fallbackTotal = Number(item.totalPrice ?? item.linePrice ?? 0);
                const baseCalculatedTotalCents = Number.isFinite(Number(item?.pbv2SnapshotJson?.pricing?.totalCents))
                    ? Math.round(Number(item.pbv2SnapshotJson.pricing.totalCents))
                    : Math.round((Number.isFinite(fallbackTotal) ? fallbackTotal : 0) * 100);
                const effectivePricing = resolvePersistedLineItemPricing({
                    baseCalculatedTotalCents,
                    quantity: item.quantity,
                    body: item,
                    specsJson: item.specsJson,
                    legacyOverridePriceCents: item.overridePriceCents,
                });
                return {
                    productId: item.productId,
                    variantId: item.variantId || null,
                    linePrice: effectivePricing.effectiveTotalCents / 100,
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
            const proofApprovalManualOverrideIndexes: number[] = [];
            const lineItemsWithTax = lineItems.map((item: any, index: number) => {
                const taxData = totalsResult.lineItemsWithTax[index];
                const product = productMap.get(item.productId);
                const proofApproval = resolveLineItemProofApprovalRequirement({
                    productRequiresProofApproval: Boolean(product?.requiresProofApproval),
                    requestedRequiresProofApproval: typeof item.requiresProofApproval === "boolean" ? item.requiresProofApproval : undefined,
                    proofApprovalLockEnabled,
                    proofingPolicy,
                    customerRequiresProofApproval: customer?.alwaysRequireProof === true,
                });
                if (proofApproval.manualOverride) {
                    proofApprovalManualOverrideIndexes.push(index);
                }
                return {
                    ...item,
                    requiresProofApproval: proofApproval.requiresProofApproval,
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
            const order = await canonicalOrderOperations.create({ organizationId, actorUserId: userId, actorOrgRole: String(req.actorOrgRole ?? req.orgRole ?? ""), creditOverride: creditOverride === true, creditOverrideReason: creditOverrideReason ?? null, payload: {
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
            } });

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

            if (proofApprovalManualOverrideIndexes.length > 0 && Array.isArray((order as any).lineItems)) {
                const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
                for (const index of proofApprovalManualOverrideIndexes) {
                    const lineItem = (order as any).lineItems[index];
                    if (!lineItem?.id) continue;
                    await createProofApprovalManualOverrideAuditLog({
                        organizationId,
                        userId,
                        userName,
                        entityType: "order_line_item",
                        entityId: String(lineItem.id),
                        entityName: lineItem.description ?? lineItemsWithTax[index]?.description ?? null,
                    });
                }
            }

            if (Array.isArray((order as any).lineItems)) {
                for (const lineItem of (order as any).lineItems) {
                    try {
                        await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                            organizationId,
                            lineItemId: String(lineItem.id),
                            actorUserId: userId,
                            reason: 'order_saved',
                        }));
                    } catch (proofSyncError) {
                        console.error('[AutoProofSync:ORDER_CREATE] Failed (non-fatal):', proofSyncError);
                    }
                }
            }

            const pendingArtworkWarnings = await promoteDirectOrderPendingArtwork({
                organizationId,
                order,
                sourceLineItems: lineItems,
                createdLineItems: Array.isArray((order as any).lineItems) ? (order as any).lineItems : [],
                userId,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                requestedTarget: typeof req.body?.requestedStorageTarget === "string"
                    ? req.body.requestedStorageTarget
                    : typeof req.body?.storageTarget === "string"
                        ? req.body.storageTarget
                        : null,
            });

            if (pendingArtworkWarnings.length > 0) {
                (order as any).attachmentPromotionWarnings = pendingArtworkWarnings;
            }

            const configuredRoutingMode = normalizeOrderSaveRoutingMode((org.settings as any)?.preferences?.orders?.saveRoutingMode);
            const requestedRoutingMode = req.body?.routeAfterSave === "route_eligible" || req.body?.routeAfterSave === "save_only"
                ? req.body.routeAfterSave
                : configuredRoutingMode;
            if (requestedRoutingMode === "route_eligible") {
                try {
                    (order as any).routingResult = await db.transaction((tx) => routeEligibleOrderLineItems(tx, {
                        organizationId,
                        orderId: String(order.id),
                        actorUserId: userId,
                        actorName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                        mode: "route_eligible",
                    }));
                } catch (routingError: any) {
                    // Commercial persistence has already succeeded. Return a structured
                    // failure rather than undoing a valid order or hiding the failure.
                    (order as any).routingResult = [{
                        lineItemId: null,
                        status: "failed",
                        reason: routingError?.message || "Order saved, but automatic routing could not start.",
                    }];
                }
            }

            return order;
            };

            const key = extractOrderCreationIdempotencyKey(req);
            const fingerprint = buildOrderCreationFingerprint({
                route: "POST /api/orders",
                body: req.body,
            });
            const result = await orderCreationIdempotencyStore.run(
                {
                    scope: `${organizationId}:${userId}:orders:create`,
                    key,
                    fingerprint,
                },
                createOrderForRequest,
            );

            const attachmentPromotionWarnings = Array.isArray((result.value as any)?.attachmentPromotionWarnings)
                ? (result.value as any).attachmentPromotionWarnings
                : [];

            res.json({
                success: true,
                data: {
                    order: result.value,
                    ...(attachmentPromotionWarnings.length > 0 ? { attachmentPromotionWarnings } : {}),
                    ...((result.value as any)?.routingResult ? { routingResult: (result.value as any).routingResult } : {}),
                },
                message: attachmentPromotionWarnings.length > 0
                    ? "Order created successfully with artwork promotion warnings"
                    : "Order created successfully",
                ...(attachmentPromotionWarnings.length > 0 ? { warnings: attachmentPromotionWarnings } : {}),
                ...result.value,
            });
        } catch (error) {
            if (error instanceof CustomerCreditPolicyError) {
                return res.status(409).json({
                    success: false,
                    message: error.message,
                    code: error.code,
                    details: error.details,
                });
            }
            if (error instanceof z.ZodError) {
                console.error("Zod validation error:", error.errors);
                return res.status(400).json({ success: false, message: fromZodError(error).message, code: "ORDER_VALIDATION_ERROR" });
            }
            if ((error as any)?.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
                return res.status(409).json({ success: false, message: (error as Error).message, code: (error as any).code });
            }
            if (error instanceof OrderIdentityError) {
                const statusCode = error.code === "ORDER_CONTACT_CUSTOMER_CONFLICT"
                    ? 409
                    : error.code === "ORDER_CUSTOMER_NOT_FOUND" || error.code === "ORDER_CONTACT_NOT_FOUND"
                        ? 404
                        : 400;
                return res.status(statusCode).json({ success: false, message: error.message, code: error.code });
            }
            if ((error as any)?.statusCode) {
                return res.status((error as any).statusCode).json({
                    success: false,
                    message: (error as Error).message,
                    code: (error as any)?.code || "ORDER_CREATE_ERROR",
                });
            }
            console.error("Error creating order:", error);
            res.status(500).json({
                success: false,
                message: "Failed to create order",
                error: (error as Error).message,
                code: "ORDER_CREATE_FAILED",
            });
        }
    });

    app.post("/api/orders/:orderId/route-eligible-line-items", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId || !userId) return res.status(401).json({ success: false, message: "Authentication and organization context are required." });
            const orderId = String(req.params.orderId);
            const [order] = await db.select({ id: orders.id })
                .from(orders)
                .innerJoin(organizations, eq(organizations.id, orders.organizationId))
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!order) return res.status(404).json({ success: false, message: "Order not found." });
            const routingResult = await db.transaction((tx) => routeEligibleOrderLineItems(tx, {
                organizationId,
                orderId,
                actorUserId: userId,
                actorName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                mode: "route_eligible",
            }));
            return res.json({ success: true, data: { orderId, routingResult } });
        } catch (error: any) {
            console.error("[OrderSaveRouting] Failed", error);
            return res.status(500).json({ success: false, message: "Order was saved, but routing could not be completed.", error: error?.message });
        }
    });

    app.patch("/api/orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
        let updateStage = "request_start";
        try {
            updateStage = "resolve_request_context";
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();

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
            updateStage = "load_existing_order";
            const existingOrder = await storage.getOrderById(organizationId, req.params.id);
            if (!existingOrder) {
                return res.status(404).json({ message: "Order not found" });
            }

            if (req.body.shippingMethod !== undefined && req.body.shippingMethod !== existingOrder.shippingMethod) {
                updateStage = "validate_fulfillment_method";
                await canonicalFulfillmentOperations.assertFulfillmentMethodChangeAllowed(organizationId, req.params.id, req.body.shippingMethod);
            }

            // Normalize an explicitly submitted shipping change only. Header-only
            // PATCHes on pickup orders must not gain a synthetic financial field.
            const normalizedShipping = normalizeOrderPatchShipping(req.body, existingOrder.shippingMethod);
            if (normalizedShipping.error) {
                return res.status(400).json({ message: normalizedShipping.error });
            }
            if (normalizedShipping.shippingCents !== undefined) {
                req.body.shippingCents = normalizedShipping.shippingCents;
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
                if (req.body.customerId !== existingOrder.customerId && req.body.contactId === undefined) {
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

            if (req.body.customerId !== undefined || req.body.contactId !== undefined) {
                updateStage = "resolve_customer_contact";
                const resolvedIdentity = await resolveOrderCustomerContactIds({
                    organizationId,
                    customerId: req.body.customerId !== undefined ? req.body.customerId : existingOrder.customerId,
                    contactId: req.body.contactId !== undefined ? req.body.contactId : existingOrder.contactId,
                });
                req.body.customerId = resolvedIdentity.customerId;
                req.body.contactId = resolvedIdentity.contactId;
            }

            updateStage = "validate_patch";
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
            updateStage = "load_audit_baseline";
            const oldOrder = await storage.getOrderById(organizationId, req.params.id);

            // Determine if we need to refresh snapshots
            const customerChanged = req.body.customerId !== undefined && req.body.customerId !== oldOrder?.customerId;
            const contactChanged = req.body.contactId !== undefined && req.body.contactId !== oldOrder?.contactId;
            const shippingMethodChanged = req.body.shippingMethod && req.body.shippingMethod !== oldOrder?.shippingMethod;
            const shippingModeChanged = req.body.shippingMode && req.body.shippingMode !== oldOrder?.shippingMode;
            const shouldRefreshSnapshot = customerChanged || contactChanged || shippingMethodChanged || shippingModeChanged;

            let snapshotData: Record<string, any> = {};
            if (shouldRefreshSnapshot && oldOrder) {
                const finalCustomerId = req.body.customerId !== undefined ? req.body.customerId : oldOrder.customerId;
                const finalContactId = req.body.contactId !== undefined ? req.body.contactId : oldOrder.contactId;
                const finalShippingMethod = req.body.shippingMethod || oldOrder.shippingMethod;
                const finalShippingMode = req.body.shippingMode || oldOrder.shippingMode;

                if (finalCustomerId || finalContactId) {
                    try {
                        updateStage = "refresh_customer_snapshot";
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
            const creditOverride = req.body.creditOverride === true;
            const creditOverrideReason = req.body.creditOverrideReason ?? null;
            delete req.body.creditOverride;
            delete req.body.creditOverrideReason;
            updateStage = "update_editable_header";
            const order = await canonicalOrderOperations.updateEditableHeader({
                organizationId,
                actorUserId: userId,
                actorOrgRole: userRole,
                creditOverride,
                creditOverrideReason,
                orderId: req.params.id,
                allowNonNew: true, // route already enforces its terminal-edit policy
                changes: {
                ...updateDataWithCustomer,
                ...snapshotData,
                },
            });

            // If per-order billing policy changed, recompute readiness and return refreshed order.
            if (req.body.billingReadyPolicy !== undefined) {
                try {
                    updateStage = "recompute_billing_readiness";
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
                updateStage = "write_order_field_audit";
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

            updateStage = "respond_success";
            res.json(order);
        } catch (error) {
            if (error instanceof FulfillmentHttpError) {
                return res.status(error.status).json({ message: error.message, code: error.code });
            }
            if (error instanceof CustomerCreditPolicyError) {
                return res.status(409).json({ message: error.message, code: error.code, details: error.details });
            }
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: fromZodError(error).message });
            }
            if ((error as any)?.code?.startsWith("ORDER_")) {
                return res.status((error as any).statusCode ?? 400).json({ message: (error as Error).message, code: (error as any).code });
            }
            const submittedFields = Object.keys(req.body ?? {})
                .filter((field) => [
                    "poNumber", "dueDate", "promisedDate", "label", "priority",
                    "customerId", "contactId", "shippingMethod", "shippingMode", "shippingCents",
                    "subtotal", "tax", "taxAmount", "total", "discount", "billingReadyPolicy",
                ].includes(field))
                .sort();
            console.error("[OrderUpdate] Failed", {
                orderId: req.params.id,
                stage: updateStage,
                submittedFields,
                errorName: error instanceof Error ? error.name : typeof error,
                errorCode: typeof (error as any)?.code === "string" ? (error as any).code : null,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({ message: "Failed to update order", code: "ORDER_UPDATE_FAILED" });
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

            const validStatuses = ['complete', 'canceled'];
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
                itemsToUpdate = allLineItems.filter(li => li.status !== 'complete' && li.status !== 'canceled');
            }

            if (itemsToUpdate.length === 0) {
                return res.json({ success: true, message: "No line items to update", updatedCount: 0 });
            }

            const targetState = status === 'complete' ? 'completed' : 'canceled';
            await db.transaction(async (tx) => {
                for (const lineItem of itemsToUpdate) {
                    await transitionLineItemWorkflowState(tx, {
                        organizationId,
                        lineItemId: lineItem.id,
                        toState: targetState,
                        actorUserId: userId,
                        metadata: {
                            source: 'bulk_line_item_status_patch',
                            requestedStatus: status,
                        },
                    });
                }
            });

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
            if (['canceled', 'cancelled'].includes(toStatus.trim().toLowerCase())) return res.status(409).json({ success: false, code: 'USE_CANONICAL_CANCELLATION', message: 'Use the canonical order cancellation operation.' });

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
                    const incompleteLi = lineItems.filter(li => li.status !== 'complete' && li.status !== 'canceled');
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
                    const inventoryDeduction = await storage.autoDeductInventoryWhenOrderMovesToProduction(organizationId, orderId, userId);
                    if (inventoryDeduction.skippedStockDeductionCount > 0) {
                        validation.warnings = validation.warnings || [];
                        validation.warnings.push(
                            `${inventoryDeduction.skippedStockDeductionCount} material stock deduction(s) skipped: manual inventory review required.`
                        );
                    }
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
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: "Unauthorized" });

            const { orderId } = req.params;
            const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;
            const request = completeProductionRequestSchema.safeParse(req.body ?? {});
            if (!request.success) {
                return res.status(400).json({ success: false, message: request.error.issues[0]?.message || "Invalid Complete Production request" });
            }
            const confirmBypass = request.data.confirmBypass === true;
            if (confirmBypass && !hasAdminOrOwnerOperationalRole(req)) {
                return res.status(403).json({
                    success: false,
                    code: "PRODUCTION_BYPASS_OVERRIDE_FORBIDDEN",
                    message: "Only an owner or administrator may bypass production prerequisites.",
                });
            }

            const result = await db.transaction(async (tx) => {
                const [order] = await tx
                    .select()
                    .from(orders)
                    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                    .for("update")
                    .limit(1);
                if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404, code: "ORDER_NOT_FOUND" });

                // The action is idempotent once canonical Production has already
                // handed the order to Fulfillment.
                if (order.state === "production_complete") {
                    return { order, completedJobIds: [] as string[], alreadyCompleted: true };
                }
                if (order.state !== "open") {
                    throw Object.assign(new Error(`Cannot complete production from ${order.state} state.`), {
                        statusCode: 400,
                        code: "INVALID_STATE",
                    });
                }
                if (order.status !== "in_production") {
                    throw Object.assign(new Error(`Cannot complete production while order status is ${order.status}. Move the order into production first.`), {
                        statusCode: 409,
                        code: "PARENT_ORDER_NOT_IN_PRODUCTION",
                    });
                }

                const lines = await tx
                    .select({
                        id: orderLineItems.id,
                        workflowState: orderLineItems.workflowState,
                        status: orderLineItems.status,
                        description: orderLineItems.description,
                        lineItemRole: orderLineItems.lineItemRole,
                        productionBypassed: orderLineItems.productionBypassed,
                        designStatus: orderLineItems.designStatus,
                        requiresDesign: orderLineItems.requiresDesign,
                        requiresProofApproval: orderLineItems.requiresProofApproval,
                        requiresPrepress: orderLineItems.requiresPrepress,
                        approvedProofVersionId: orderLineItems.approvedProofVersionId,
                        productType: orderLineItems.productType,
                        productTypeId: products.productTypeId,
                        requiresProductionJob: products.requiresProductionJob,
                        workflowIntent: products.workflowIntent,
                    })
                    .from(orderLineItems)
                    .innerJoin(products, eq(orderLineItems.productId, products.id))
                    .where(eq(orderLineItems.orderId, orderId))
                    .for("update");

                const productionLines = lines.filter(requiresCanonicalProductionCompletion);
                const completedJobIds: string[] = [];
                const maxTransitionsPerLine = 16;

                const activeJobsForLine = async (lineItemId: string) => tx
                    .select({
                        id: productionJobs.id,
                        stationKey: productionJobs.stationKey,
                        status: productionJobs.status,
                        stepKey: productionJobs.stepKey,
                        totalSeconds: productionJobs.totalSeconds,
                    })
                    .from(productionJobs)
                    .where(and(
                        eq(productionJobs.organizationId, organizationId),
                        eq(productionJobs.lineItemId, lineItemId),
                        sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
                    ))
                    .for("update");

                const assertNoActiveRunOwnsJobs = async (jobIds: string[]) => {
                    if (jobIds.length === 0) return;
                    const [runMember] = await tx
                        .select({ runId: productionRuns.id, runNumber: productionRuns.runNumber })
                        .from(productionRunMembers)
                        .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
                        .where(and(
                            eq(productionRunMembers.organizationId, organizationId),
                            inArray(productionRunMembers.productionJobId, jobIds),
                            inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
                            sql`coalesce(${productionRunMembers.remainingQuantity}, 0) > 0`,
                        ))
                        .limit(1);
                    if (runMember) {
                        throw Object.assign(new Error("This production work is owned by an active Combined Run. Record its outcome from Production instead."), {
                            statusCode: 409,
                            code: "PRODUCTION_RUN_OUTCOME_REQUIRED",
                            details: { runId: runMember.runId, runNumber: runMember.runNumber },
                        });
                    }
                };

                const bypassesByLineId = new Map<string, string[]>();
                const bypasses: Array<{ lineItemId: string; lineLabel: string; stages: string[] }> = [];
                for (const line of productionLines) {
                    const lineIsComplete = ["completed", "canceled"].includes(String(line.workflowState || "").toLowerCase())
                        || ["complete", "completed", "canceled", "cancelled"].includes(String(line.status || "").toLowerCase());
                    if (lineIsComplete) continue;

                    const activeJobs = await activeJobsForLine(line.id);
                    const activeProductionJobs = activeJobs.filter((job) => String(job.stationKey || "").toLowerCase() !== "fulfillment");
                    await assertNoActiveRunOwnsJobs(activeProductionJobs.map((job) => job.id));
                    if (activeProductionJobs.length > 1) {
                        throw Object.assign(new Error("This line has multiple active production owners and must be repaired before it can be completed."), {
                            statusCode: 409,
                            code: "PRODUCTION_OWNERSHIP_CONFLICT",
                            details: { lineItemId: line.id, productionJobIds: activeProductionJobs.map((job) => job.id) },
                        });
                    }

                    const activeJob = activeProductionJobs[0] ?? null;
                    const stages = listOrderProductionPrerequisitesToBypass({
                        workflowState: line.workflowState,
                        designStatus: line.designStatus,
                        requiresDesign: line.requiresDesign,
                        requiresProofApproval: line.requiresProofApproval,
                        requiresPrepress: line.requiresPrepress,
                        approvedProofVersionId: line.approvedProofVersionId,
                        activeStationKey: activeJob?.stationKey,
                        activeStepKey: activeJob?.stepKey,
                    });
                    if (stages.length > 0) {
                        bypassesByLineId.set(line.id, stages);
                        bypasses.push({
                            lineItemId: line.id,
                            lineLabel: line.description || `Line ${line.id}`,
                            stages,
                        });
                    }
                }

                if (bypasses.length > 0 && !confirmBypass) {
                    return {
                        requiresConfirmation: true,
                        bypasses,
                        order,
                        completedJobIds: [] as string[],
                        alreadyCompleted: false,
                    };
                }

                const manuallyCompletedLineIds = new Set<string>();

                for (const line of productionLines) {
                    const lineIsComplete = ["completed", "canceled"].includes(String(line.workflowState || "").toLowerCase())
                        || ["complete", "completed", "canceled", "cancelled"].includes(String(line.status || "").toLowerCase());
                    if (lineIsComplete) continue;

                    for (let transitionCount = 0; transitionCount < maxTransitionsPerLine; transitionCount++) {
                        let activeJobs = await activeJobsForLine(line.id);
                        const activeProductionJobs = activeJobs.filter((job) => String(job.stationKey || "").toLowerCase() !== "fulfillment");

                        if (activeProductionJobs.length === 0) {
                            if (activeJobs.length > 0) break; // Fulfillment owns the physical handoff; never complete it here.

                            const bypassedStages = bypassesByLineId.get(line.id);
                            if (bypassedStages && confirmBypass) {
                                await bypassOrderProductionPrerequisites(tx, {
                                    organizationId,
                                    orderId,
                                    line,
                                    activePrerequisiteJob: null,
                                    bypassedStages,
                                    actorUserId: userId,
                                    actorUserName: userName || null,
                                });
                                manuallyCompletedLineIds.add(line.id);
                                continue;
                            }

                            const repairState = missingOwnerRepairState(line.workflowState);
                            if (!repairState) {
                                throw Object.assign(new Error("This line has not completed its required Design, Proofing, or Prepress prerequisite."), {
                                    statusCode: 409,
                                    code: "PRODUCTION_PREREQUISITE_NOT_READY",
                                    details: { lineItemId: line.id, workflowState: line.workflowState, status: line.status },
                                });
                            }

                            // Reapplying the existing production-ready state uses the
                            // line-item workflow owner repair to create exactly one
                            // routed job, instead of fabricating a record here.
                            await transitionLineItemWorkflowState(tx, {
                                organizationId,
                                lineItemId: line.id,
                                toState: repairState,
                                actorUserId: userId,
                                metadata: { source: "order_complete_production_owner_repair", orderId },
                            });
                            activeJobs = await activeJobsForLine(line.id);
                            const repairedProductionJobs = activeJobs.filter((job) => String(job.stationKey || "").toLowerCase() !== "fulfillment");
                            if (repairedProductionJobs.length === 0) {
                                throw Object.assign(new Error("Production ownership could not be established for this line."), {
                                    statusCode: 409,
                                    code: "PRODUCTION_OWNER_REPAIR_FAILED",
                                    details: { lineItemId: line.id },
                                });
                            }
                            activeProductionJobs.splice(0, activeProductionJobs.length, ...repairedProductionJobs);
                        }

                        if (activeProductionJobs.length !== 1) {
                            throw Object.assign(new Error("This line has multiple active production owners and must be repaired before it can be completed."), {
                                statusCode: 409,
                                code: "PRODUCTION_OWNERSHIP_CONFLICT",
                                details: { lineItemId: line.id, productionJobIds: activeProductionJobs.map((job) => job.id) },
                            });
                        }

                        const activeJob = activeProductionJobs[0];
                        if (!isOrderShortcutCompletableProductionStation(activeJob.stationKey)) {
                            const bypassedStages = bypassesByLineId.get(line.id);
                            if (bypassedStages && confirmBypass) {
                                await bypassOrderProductionPrerequisites(tx, {
                                    organizationId,
                                    orderId,
                                    line,
                                    activePrerequisiteJob: activeJob,
                                    bypassedStages,
                                    actorUserId: userId,
                                    actorUserName: userName || null,
                                });
                                manuallyCompletedLineIds.add(line.id);
                                continue;
                            }
                            throw Object.assign(new Error(`Production prerequisite at ${activeJob.stationKey} must be completed from its own workspace.`), {
                                statusCode: 409,
                                code: "PRODUCTION_PREREQUISITE_NOT_READY",
                                details: { lineItemId: line.id, productionJobId: activeJob.id, stationKey: activeJob.stationKey },
                            });
                        }

                        await assertNoActiveRunOwnsJobs([activeJob.id]);
                        await completeProductionJobWorkflow(tx, {
                            organizationId,
                            userId,
                            jobId: activeJob.id,
                            // A queued job has not been manually started. The
                            // canonical completion operation records this as its
                            // supported skip-production completion, while started
                            // jobs retain their normal timer/audit handling.
                            skipProduction: "auto",
                            manualOverride: manuallyCompletedLineIds.has(line.id)
                                ? {
                                    source: "order_complete_production_override" as const,
                                    bypassedPrerequisites: bypassesByLineId.get(line.id) ?? [],
                                }
                                : null,
                            auditUserName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || null,
                            ipAddress: req.ip || null,
                            userAgent: req.headers["user-agent"] || null,
                        });
                        completedJobIds.push(activeJob.id);
                    }

                    const remainingJobs = await activeJobsForLine(line.id);
                    if (remainingJobs.some((job) => String(job.stationKey || "").toLowerCase() !== "fulfillment")) {
                        throw Object.assign(new Error("Production completion did not reach the fulfillment handoff for this line."), {
                            statusCode: 409,
                            code: "PRODUCTION_COMPLETION_INCOMPLETE",
                            details: { lineItemId: line.id },
                        });
                    }
                }

                // A prior canonical job completion may already have created a
                // queued Fulfillment handoff while leaving an older Order
                // projection stale. Reconcile only that projection here; this
                // never completes the Fulfillment job or changes shipment state.
                const activeOrderJobs = await tx
                    .select({ id: productionJobs.id, stationKey: productionJobs.stationKey })
                    .from(productionJobs)
                    .where(and(
                        eq(productionJobs.organizationId, organizationId),
                        eq(productionJobs.orderId, orderId),
                        sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
                    ))
                    .for("update");
                const activeNonFulfillmentJob = activeOrderJobs.find((job) => String(job.stationKey || "").toLowerCase() !== "fulfillment");
                const fulfillmentHandoffJob = activeOrderJobs.find((job) => String(job.stationKey || "").toLowerCase() === "fulfillment");
                const [projectionBeforeRepair] = await tx
                    .select({ state: orders.state })
                    .from(orders)
                    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                    .limit(1);
                if (projectionBeforeRepair?.state !== "production_complete" && !activeNonFulfillmentJob && fulfillmentHandoffJob) {
                    await markOrderReadyForFulfillmentIfProductionComplete(tx, {
                        organizationId,
                        orderId,
                        actorUserId: userId,
                        productionJobId: fulfillmentHandoffJob.id,
                    });
                }

                const [updatedOrder] = await tx
                    .select()
                    .from(orders)
                    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                    .limit(1);
                if (!updatedOrder || updatedOrder.state !== "production_complete") {
                    throw Object.assign(new Error("Production work completed but the order did not reach the fulfillment handoff."), {
                        statusCode: 409,
                        code: "ORDER_PRODUCTION_HANDOFF_INCOMPLETE",
                    });
                }

                return { order: updatedOrder, completedJobIds, alreadyCompleted: false };
            });

            if ((result as any).requiresConfirmation) {
                return res.status(409).json({
                    success: false,
                    code: "PRODUCTION_BYPASS_CONFIRMATION_REQUIRED",
                    message: "Production steps are incomplete. Confirm the bypass to complete production.",
                    details: { bypasses: (result as any).bypasses },
                });
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

            return res.json({
                success: true,
                data: result.order,
                completedJobCount: result.completedJobIds.length,
                alreadyCompleted: result.alreadyCompleted,
                message: result.alreadyCompleted ? "Order production was already completed" : "Order production completed",
            });
        } catch (error: any) {
            console.error('[CompleteProduction] Error:', error);
            return res.status(error?.statusCode || 500).json({
                success: false,
                code: error?.code || "COMPLETE_PRODUCTION_FAILED",
                message: error?.message || "Failed to complete production",
                details: error?.details,
            });
        }
    });

    app.post("/api/orders/:orderId/complete", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

            const parsed = z.object({ notes: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
            const orderId = String(req.params.orderId);
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });

            const lineRows = await db.select({ productId: orderLineItems.productId, status: orderLineItems.status })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));
            const productIds = Array.from(new Set(lineRows.map((line) => line.productId)));
            const productRows = productIds.length > 0
                ? await db.select({ id: products.id, workflowIntent: products.workflowIntent }).from(products)
                    .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds)))
                : [];
            const workflowIntentByProductId = new Map(productRows.map((product) => [product.id, product.workflowIntent]));
            const invoiceRows = await db.select({ status: invoices.status, balanceDue: invoices.balanceDue })
                .from(invoices)
                .where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, orderId)));
            const assessment = assessOrderOperationalCompletion({
                state: order.state,
                fulfillmentStatus: order.fulfillmentStatus,
                lineItems: lineRows.map((line) => ({ status: line.status, workflowIntent: workflowIntentByProductId.get(line.productId) })),
                invoices: invoiceRows,
            });
            if (!assessment.ok) {
                return res.status(409).json({ success: false, code: assessment.code, message: assessment.message });
            }

            const now = new Date().toISOString();
            await db.update(orders).set({
                state: "production_complete",
                status: "ready_for_shipment",
                ...(!assessment.serviceFeeOnly && !order.productionCompletedAt ? { productionCompletedAt: now } : {}),
                routingTarget: assessment.needsInvoicing ? "invoicing" : null,
                updatedAt: sql`now()` as any,
            }).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

            const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;
            await storage.createOrderAuditLog({
                orderId,
                userId,
                userName,
                actionType: "order_completed_operationally",
                fromStatus: order.state,
                toStatus: "production_complete",
                note: parsed.notes || "Order marked operationally complete",
                metadata: {
                    serviceFeeOnly: assessment.serviceFeeOnly,
                    invoiceCount: assessment.activeInvoiceCount,
                    needsInvoicing: assessment.needsInvoicing,
                    allInvoicesPaid: assessment.allInvoicesPaid,
                },
            });

            try {
                await recomputeOrderBillingStatus({ organizationId, orderId });
            } catch (error) {
                console.warn("[CompleteOrder] Billing readiness recompute failed:", error);
            }

            const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
            await applyWorkflowStatusPillFailSoft({
                organizationId,
                orderId,
                triggerKey: "order_completed",
                actorUserId: userId,
                actorUserName: userName,
                source: "system",
                reason: "Order marked operationally complete",
                metadata: { invoiceCount: assessment.activeInvoiceCount, needsInvoicing: assessment.needsInvoicing },
            });

            const updatedOrder = await storage.getOrderById(organizationId, orderId);
            return res.json({
                success: true,
                data: updatedOrder,
                invoiceAction: assessment.needsInvoicing ? "ready_to_invoice" : "existing_invoice_preserved",
                invoiceCount: assessment.activeInvoiceCount,
                message: assessment.needsInvoicing
                    ? "Order completed and is ready to invoice."
                    : "Order completed. Existing invoice preserved.",
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: fromZodError(error).message });
            }
            console.error("[POST /api/orders/:orderId/complete] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to complete order" });
        }
    });

    app.post("/api/orders/:orderId/close", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;

            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

            const parsed = z.object({
                notes: z.string().trim().max(2000).optional(),
                confirmUnpaidInvoices: z.boolean().optional(),
            }).parse(req.body ?? {});
            const orderId = String(req.params.orderId);
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });
            if (order.state === "closed" || order.state === "canceled") {
                return res.status(409).json({ success: false, code: "TERMINAL_STATE", message: `Cannot close an order in ${order.state} state.` });
            }

            const lineRows = await db.select({ productId: orderLineItems.productId, status: orderLineItems.status })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, orderId));
            const productIds = Array.from(new Set(lineRows.map((line) => line.productId)));
            const productRows = productIds.length > 0
                ? await db.select({ id: products.id, workflowIntent: products.workflowIntent }).from(products)
                    .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds)))
                : [];
            const workflowIntentByProductId = new Map(productRows.map((product) => [product.id, product.workflowIntent]));
            const invoiceRows = await db.select({ status: invoices.status }).from(invoices)
                .where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, orderId)));
            const nonVoidInvoices = invoiceRows.filter((invoice) => String(invoice.status).toLowerCase() !== "void");
            const unpaidInvoiceCount = nonVoidInvoices.filter((invoice) => String(invoice.status).toLowerCase() !== "paid").length;
            const eligibility = assessOrderCloseEligibility({
                state: order.state,
                routingTarget: order.routingTarget,
                lineItems: lineRows.map((line) => ({ status: line.status, workflowIntent: workflowIntentByProductId.get(line.productId) })),
                invoiceCount: nonVoidInvoices.length,
                unpaidInvoiceCount,
            });
            if (!eligibility.ok) {
                return res.status(409).json({ success: false, code: eligibility.code, message: eligibility.message });
            }
            if (eligibility.requiresUnpaidConfirmation && !parsed.confirmUnpaidInvoices) {
                return res.status(409).json({
                    success: false,
                    code: "UNPAID_INVOICES_CONFIRMATION_REQUIRED",
                    message: "This order has unpaid invoices. Close order anyway? Payment collection remains available after closing.",
                    unpaidInvoiceCount,
                });
            }

            const { transitionOrderState } = await import("../services/orderStateService");
            const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;
            const updatedOrder = await transitionOrderState({
                organizationId,
                orderId,
                nextState: "closed",
                actorUserId: userId,
                actorUserName: userName,
                notes: parsed.notes,
                metadata: { source: "manual_close", serviceFeeOnly: eligibility.serviceFeeOnly, unpaidInvoiceCount },
            });
            const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
            await applyWorkflowStatusPillFailSoft({
                organizationId,
                orderId,
                triggerKey: "order_closed",
                actorUserId: userId,
                actorUserName: userName,
                source: "system",
                reason: "Order closed",
                metadata: { unpaidInvoiceCount },
            });
            const refreshedOrder = await storage.getOrderById(organizationId, orderId);
            return res.json({ success: true, data: refreshedOrder ?? updatedOrder, message: "Order closed." });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: fromZodError(error).message });
            }
            console.error("[POST /api/orders/:orderId/close] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to close order" });
        }
    });

    app.post("/api/orders/:orderId/reopen", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
            const parsed = z.object({
                reason: z.string().trim().min(1).max(2000),
                targetState: z.enum(["open", "production_complete"]).optional(),
            }).parse(req.body ?? {});
            const { reopenOrder } = await import("../services/orderStateService");
            const userName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;
            const updatedOrder = await reopenOrder({
                organizationId,
                orderId: String(req.params.orderId),
                actorUserId: userId,
                actorUserName: userName,
                reason: parsed.reason,
                targetState: parsed.targetState,
            });
            return res.json({ success: true, data: updatedOrder, message: "Order reopened." });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: fromZodError(error).message });
            }
            return res.status(400).json({ success: false, message: error?.message || "Failed to reopen order" });
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
            if (['canceled', 'cancelled'].includes(String(nextState).trim().toLowerCase())) return res.status(409).json({ success: false, code: 'USE_CANONICAL_CANCELLATION', message: 'Use the canonical order cancellation operation.' });

            const { validateOrderStateTransition, transitionOrderState, isTerminalState } = await import('../services/orderStateService');
            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found" });

            if (isTerminalState(order.state as any)) {
                return res.status(400).json({ success: false, message: `Cannot transition from ${order.state} state.`, code: 'TERMINAL_STATE' });
            }

            const lineItems = await db.select({ id: orderLineItems.id }).from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
            const validation = validateOrderStateTransition(order.state as any, nextState as any, { order: order as any, lineItemsCount: lineItems.length });
            if (!validation.ok) {
                return res.status(409).json({ success: false, code: validation.code, message: validation.message });
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
            const stateScope = (req.query.stateScope ?? req.query.state) as string | undefined;
            if (stateScope && !["open", "production_complete", "closed", "canceled"].includes(stateScope)) {
                return res.status(400).json({ success: false, message: "Invalid state parameter" });
            }
            const { listStatusPills, seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
            await seedDefaultPillsForOrg(organizationId);
            const pills = await listStatusPills(organizationId, stateScope as any, true);
            return res.json({ success: true, data: pills, pills });
        } catch (error: any) {
            console.error('[StatusPills:GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch status pills", error: error?.message });
        }
    });

    app.post("/api/orders/status-pills", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
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

    app.patch("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
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

    app.delete("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
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

    app.post("/api/orders/status-pills/:pillId/make-default", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
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

    app.get("/api/settings/order-status-pills", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const { listStatusPills, seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
            await seedDefaultPillsForOrg(organizationId);
            const pills = await listStatusPills(organizationId, undefined, false);
            return res.json({ success: true, data: pills, pills });
        } catch (error: any) {
            console.error('[StatusPills:SETTINGS_GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch status-pill settings" });
        }
    });

    app.get("/api/settings/workflow-status-pill-mappings", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const { seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
            const { listWorkflowStatusPillMappings } = await import('../services/workflowStatusPillService');
            await seedDefaultPillsForOrg(organizationId);
            const mappings = await listWorkflowStatusPillMappings(organizationId);
            return res.json({ success: true, data: mappings, mappings });
        } catch (error: any) {
            console.error('[WorkflowStatusPillMappings:GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch workflow status mappings" });
        }
    });

    app.patch("/api/settings/workflow-status-pill-mappings/:triggerKey", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const { workflowStatusPillAssignmentSourceSchema, workflowStatusPillTriggerSchema } = await import('@shared/orderStatusWorkflowAutomation');
            const triggerKey = workflowStatusPillTriggerSchema.parse(req.params.triggerKey);
            const payload = z.object({
                targetStatusKey: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(100),
                source: workflowStatusPillAssignmentSourceSchema.optional(),
                isActive: z.boolean().optional(),
                overwriteExceptionStatus: z.boolean().optional(),
            }).parse(req.body);
            const { upsertWorkflowStatusPillMapping } = await import('../services/workflowStatusPillService');
            const mapping = await upsertWorkflowStatusPillMapping({ organizationId, triggerKey, ...payload });
            return res.json({ success: true, data: mapping });
        } catch (error: any) {
            const message = error instanceof z.ZodError ? fromZodError(error).message : error?.message || "Failed to update workflow status mapping";
            return res.status(400).json({ success: false, message });
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
            const statusPillId = (req.body?.statusPillId ?? null) as string | null;
            const value = (req.body?.value ?? req.body?.statusPillValue ?? null) as string | null;
            const { assignOrderStatusPill } = await import('../services/orderStatusPillService');
            const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

            const assignment = await assignOrderStatusPill({
                organizationId,
                orderId,
                statusPillId,
                statusPillValue: value,
                actorUserId: userId,
                actorUserName: userName,
                source: 'user',
                reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null,
            });

            const updatedOrder = await storage.getOrderById(organizationId, orderId);
            const label = assignment.statusPill?.name ?? null;
            return res.json({
                success: true,
                data: updatedOrder,
                statusPill: assignment.statusPill,
                eventId: assignment.eventId,
                message: label ? `Status pill set to "${label}"` : 'Status pill cleared',
            });
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
            if (includeLineItems !== 'true') {
                whereConditions.push(or(isNull(orderAttachments.orderLineItemId), eq(orderAttachments.portalFileCategory, "customer_upload")));
            }
            const files = await db.select().from(orderAttachments).where(and(...whereConditions)).orderBy(desc(orderAttachments.createdAt));
            const namingPolicy = await getFileUploadNamingPolicy(organizationId);
            const orderNumber = (order as any).orderNumber ?? null;

            if (files.length > 0 && process.env.DEBUG_THUMBNAILS) {
                console.log('[OrderAttachments:GET] 📊 Raw DB record (before enrichment):');
                console.log('  - attachmentId:', files[0].id);
                console.log('  - fileUrl:', files[0].fileUrl);
                console.log('  - fileRecordId:', files[0].fileRecordId ?? null);
                console.log('  - thumbnailUrl:', files[0].thumbnailUrl);
                console.log('  - thumbKey:', files[0].thumbKey);
                console.log('  - previewKey:', files[0].previewKey);
            }

            const logOnce = createRequestLogOnce();
            const attachmentItems = await Promise.all(files.map((file) =>
                enrichAttachmentWithUrls(withOrderOriginalArtworkDisplayFilename(file, { orderNumber, namingPolicy }), { logOnce })
            ));
            let lineItemAssetItems: any[] = [];

            if (includeLineItems === 'true') {
                const lineItemRows = await db
                    .select({ id: orderLineItems.id })
                    .from(orderLineItems)
                    .where(eq(orderLineItems.orderId, orderId));

                const lineItemIds = lineItemRows.map((row) => row.id).filter(Boolean) as string[];

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

                        const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');
                        const logOnce = createRequestLogOnce();

                        lineItemAssetItems = (await Promise.all((linkRows as any[])
                            .map(async (link) => {
                                const asset = assetsById.get(String(link.assetId));
                                if (!asset) return null;
                                const enriched = await enrichAssetPreviewUrls(asset);
                                const originalAccess = await resolveOriginalFileAccess(asset, { logOnce });
                                const displayAsset = withOrderOriginalArtworkDisplayFilename(enriched as any, { orderNumber, namingPolicy });
                                const filename = String((displayAsset as any).displayFilename ?? (enriched as any).fileName ?? 'Artwork');
                                const previewThumbnailUrl =
                                    (enriched as any).previewThumbnailUrl ??
                                    (enriched as any).thumbnailUrl ??
                                    (enriched as any).thumbUrl ??
                                    null;

                                return {
                                    id: String(link.assetId),
                                    filename,
                                    fileName: filename,
                                    displayFilename: filename,
                                    computedDisplayFilename: filename,
                                    mimeType: (enriched as any).mimeType ?? (asset as any)?.mimeType ?? null,
                                    fileSize: (enriched as any).fileSize ?? (asset as any)?.fileSize ?? null,
                                    objectPath: originalAccess.objectPath,
                                    originalUrl: originalAccess.originalUrl,
                                    downloadUrl: originalAccess.downloadUrl,
                                    availabilityStatus: originalAccess.availabilityStatus,
                                    previewThumbnailUrl,
                                    createdAt: link.createdAt ?? (enriched as any).createdAt ?? null,
                                    source: 'line_item' as const,
                                    parentLineItemId: String(link.lineItemId),
                                    role: String(link.role ?? 'other'),
                                };
                            }))).filter(Boolean);
                    }
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

    app.post("/api/orders/:orderId/dev-stage18p-upload-fixtures", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        const parsed = stage18PDevUploadFixturesSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                code: "DEV_STAGE_18P_FIXTURE_CONFIRMATION_REQUIRED",
                message: "confirmDevFixtureCreation: true is required.",
            });
        }

        try {
            assertStage18PDevFixtureAccess({
                requestHost: req.get("host"),
                requestOrigin: req.get("origin"),
            });

            const organizationId = getRequestOrganizationId(req);
            const actorUserId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!actorUserId) return res.status(401).json({ error: "Authentication required" });

            const [fixtureOrder] = await db
                .select({
                    id: orders.id,
                    customerId: orders.customerId,
                    orderNumber: orders.orderNumber,
                    status: orders.status,
                    state: orders.state,
                    customerName: customers.companyName,
                })
                .from(orders)
                .innerJoin(customers, eq(customers.id, orders.customerId))
                .where(and(
                    eq(orders.id, req.params.orderId),
                    eq(orders.organizationId, organizationId),
                    eq(customers.organizationId, organizationId),
                ))
                .limit(1);

            if (!fixtureOrder || !isStage18PDevFixtureCustomer(fixtureOrder.customerName)) {
                return res.status(404).json({
                    success: false,
                    code: "DEV_STAGE_18P_FIXTURE_NOT_FOUND",
                    message: "A labelled DEV Stage 18P fixture order is required.",
                });
            }
            if (fixtureOrder.status !== "new" || fixtureOrder.state !== "open") {
                return res.status(409).json({
                    success: false,
                    code: "DEV_STAGE_18P_FIXTURE_ORDER_NOT_SAFE",
                    message: "DEV fixture uploads can only be created on a new, open order.",
                });
            }

            const existingInvoice = await db
                .select({ id: invoices.id })
                .from(invoices)
                .where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, fixtureOrder.id)))
                .limit(1);
            if (existingInvoice[0]) {
                return res.status(409).json({
                    success: false,
                    code: "DEV_STAGE_18P_FIXTURE_ORDER_BILLED",
                    message: "DEV fixture uploads cannot be created on an invoiced order.",
                });
            }

            const lineItems = await db
                .select({ id: orderLineItems.id, sortOrder: orderLineItems.sortOrder })
                .from(orderLineItems)
                .where(eq(orderLineItems.orderId, fixtureOrder.id))
                .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.id));
            if (lineItems.length < 4) {
                return res.status(409).json({
                    success: false,
                    code: "DEV_STAGE_18P_FIXTURE_LINE_ITEMS_REQUIRED",
                    message: "The labelled DEV fixture order must have at least four line items.",
                });
            }

            const actorUserName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || "DEV fixture staff";
            const existingFixtures = await db
                .select()
                .from(orderAttachments)
                .where(and(
                    eq(orderAttachments.orderId, fixtureOrder.id),
                    eq(orderAttachments.portalFileCategory, "customer_upload"),
                    inArray(orderAttachments.portalDisplayName, stage18PDevFixtureUploadDefinitions.map((fixture) => fixture.fileName)),
                ));
            const existingByName = new Map(existingFixtures.map((fixture) => [fixture.portalDisplayName, fixture]));
            const fixtureResults: Array<{ key: string; attachmentId: string; created: boolean }> = [];

            for (const definition of stage18PDevFixtureUploadDefinitions) {
                let attachment: any = existingByName.get(definition.fileName) ?? null;
                let created = false;
                if (!attachment) {
                    attachment = await persistOrderAttachment({
                        orderId: fixtureOrder.id,
                        organizationId,
                        userId: actorUserId,
                        userName: "DEV TEST ONLY - Stage 18P customer fixture",
                        description: `DEV TEST ONLY - Stage 18P. Harmless generated upload fixture: ${definition.key}.`,
                        orderNumber: fixtureOrder.orderNumber,
                        role: "reference",
                        side: "na",
                        isPrimary: false,
                        source: {
                            kind: "buffer",
                            buffer: stage18PDevFixturePng,
                            originalFilename: definition.fileName,
                            mimeType: "image/png",
                        },
                    });
                    const [updated] = await db
                        .update(orderAttachments)
                        .set({
                            customerVisible: true,
                            portalFileCategory: "customer_upload",
                            portalDisplayName: definition.fileName,
                            portalDescription: `DEV TEST ONLY - Stage 18P. Harmless generated upload fixture: ${definition.key}.`,
                            customerUploadReviewStatus: "pending_review",
                            updatedAt: new Date(),
                        })
                        .where(and(eq(orderAttachments.id, attachment.id), eq(orderAttachments.orderId, fixtureOrder.id)))
                        .returning();
                    attachment = updated ?? attachment;
                    created = true;
                }

                if (!attachment) {
                    throw new Error(`DEV fixture attachment could not be resolved: ${definition.key}`);
                }

                if (created && definition.stage !== "pending") {
                    if (definition.stage === "rejected") {
                        attachment = await reviewCustomerUpload({
                            organizationId,
                            entityType: "order",
                            entityId: fixtureOrder.id,
                            attachmentId: attachment.id,
                            status: "rejected",
                            reviewNote: "DEV TEST ONLY - Stage 18P rejection fixture.",
                            actorUserId,
                            actorUserName,
                            ipAddress: req.ip,
                            userAgent: req.get?.("user-agent") || null,
                        });
                    } else {
                        attachment = await reviewCustomerUpload({
                            organizationId,
                            entityType: "order",
                            entityId: fixtureOrder.id,
                            attachmentId: attachment.id,
                            status: "accepted",
                            reviewNote: "DEV TEST ONLY - Stage 18P accepted fixture.",
                            actorUserId,
                            actorUserName,
                            ipAddress: req.ip,
                            userAgent: req.get?.("user-agent") || null,
                        });
                    }
                }

                if (created && ["promoted", "assigned", "intake", "operational_primary"].includes(definition.stage)) {
                    attachment = await promoteCustomerUpload({
                        organizationId,
                        entityType: "order",
                        entityId: fixtureOrder.id,
                        attachmentId: attachment.id,
                        promotion: "artwork",
                        actorUserId,
                        actorUserName,
                        ipAddress: req.ip,
                        userAgent: req.get?.("user-agent") || null,
                    });
                }

                const targetLineItemId = definition.stage === "assigned" || definition.stage === "intake"
                    ? lineItems[1]!.id
                    : definition.stage === "operational_primary"
                        ? lineItems[2]!.id
                        : null;
                if (created && targetLineItemId) {
                    attachment = await assignPromotedCustomerUpload({
                        organizationId,
                        sourceOrderId: fixtureOrder.id,
                        targetOrderId: fixtureOrder.id,
                        targetLineItemId,
                        attachmentId: attachment.id,
                        assignmentType: "reference_for_line_item",
                        assignmentNote: "DEV TEST ONLY - Stage 18P fixture assignment.",
                        actorUserId,
                        actorUserName,
                        ipAddress: req.ip,
                        userAgent: req.get?.("user-agent") || null,
                    });
                }

                if (created && ["intake", "operational_primary"].includes(definition.stage) && targetLineItemId) {
                    attachment = await selectAssignedCustomerUploadForArtwork({
                        organizationId,
                        sourceOrderId: fixtureOrder.id,
                        targetOrderId: fixtureOrder.id,
                        targetLineItemId,
                        attachmentId: attachment.id,
                        artworkSelectionType: "artwork_side_intake",
                        artworkSelectionNote: "DEV TEST ONLY - Stage 18P fixture intake.",
                        actorUserId,
                        actorUserName,
                        ipAddress: req.ip,
                        userAgent: req.get?.("user-agent") || null,
                    });
                }

                if (created && definition.stage === "operational_primary" && targetLineItemId) {
                    attachment = await designateCustomerUploadArtworkSide({
                        organizationId,
                        sourceOrderId: fixtureOrder.id,
                        targetOrderId: fixtureOrder.id,
                        targetLineItemId,
                        attachmentId: attachment.id,
                        side: "front",
                        designationNote: "DEV TEST ONLY - Stage 18P operational-primary denial fixture.",
                        actorUserId,
                        actorUserName,
                        ipAddress: req.ip,
                        userAgent: req.get?.("user-agent") || null,
                    });
                    const [primaryFixture] = await db
                        .update(orderAttachments)
                        .set({ isPrimary: true, updatedAt: new Date() })
                        .where(and(eq(orderAttachments.id, attachment.id), eq(orderAttachments.orderId, fixtureOrder.id)))
                        .returning();
                    attachment = primaryFixture ?? attachment;
                }

                fixtureResults.push({ key: definition.key, attachmentId: attachment.id, created });
            }

            await db.insert(auditLogs).values({
                organizationId,
                userId: actorUserId,
                userName: actorUserName,
                actionType: "dev_stage18p_upload_fixtures_created",
                entityType: "order",
                entityId: fixtureOrder.id,
                entityName: `DEV TEST ONLY - Stage 18P order ${fixtureOrder.orderNumber}`,
                description: "Created or reused DEV-only Stage 18P customer-upload fixtures.",
                oldValues: null,
                newValues: {
                    fixtureIds: fixtureResults,
                    createdFixtureIds: fixtureResults.filter((fixture) => fixture.created).map((fixture) => fixture.attachmentId),
                    reusedFixtureIds: fixtureResults.filter((fixture) => !fixture.created).map((fixture) => fixture.attachmentId),
                    finalArtwork: false,
                    proofChanged: false,
                    prepressChanged: false,
                    productionChanged: false,
                    billingChanged: false,
                    paymentChanged: false,
                    epsChanged: false,
                },
                ipAddress: req.ip || null,
                userAgent: req.get?.("user-agent") || null,
            });

            return res.status(201).json({
                success: true,
                data: {
                    orderId: fixtureOrder.id,
                    fixtureIds: fixtureResults,
                },
            });
        } catch (error: any) {
            if (error?.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ success: false, message: error.message });
            console.error("[OrderAttachments:Stage18PDevFixtures] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to create DEV Stage 18P upload fixtures." });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-review", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadReviewSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await reviewCustomerUpload({
                organizationId,
                entityType: "order",
                entityId: req.params.orderId,
                attachmentId: req.params.attachmentId,
                status: parsed.data.status,
                reviewNote: parsed.data.reviewNote,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadReview] Error:", error);
            return res.status(500).json({ error: "Failed to review customer upload" });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-promotion", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadPromotionSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await promoteCustomerUpload({
                organizationId,
                entityType: "order",
                entityId: req.params.orderId,
                attachmentId: req.params.attachmentId,
                promotion: parsed.data.promotion,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadPromotion] Error:", error);
            return res.status(500).json({ error: "Failed to promote customer upload" });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-assignment", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadAssignmentSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await assignPromotedCustomerUpload({
                organizationId,
                sourceOrderId: req.params.orderId,
                targetOrderId: parsed.data.targetOrderId,
                targetLineItemId: parsed.data.targetLineItemId,
                attachmentId: req.params.attachmentId,
                assignmentType: parsed.data.assignmentType,
                assignmentNote: parsed.data.assignmentNote,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadAssignment] Error:", error);
            return res.status(500).json({ error: "Failed to assign customer upload" });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-artwork-selection", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadArtworkSelectionSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await selectAssignedCustomerUploadForArtwork({
                organizationId,
                sourceOrderId: req.params.orderId,
                targetOrderId: parsed.data.targetOrderId,
                targetLineItemId: parsed.data.targetLineItemId,
                attachmentId: req.params.attachmentId,
                artworkSelectionType: parsed.data.artworkSelectionType,
                artworkSelectionNote: parsed.data.artworkSelectionNote,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadArtworkSelection] Error:", error);
            return res.status(500).json({ error: "Failed to select customer upload for artwork-side handling" });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-artwork-side-designation", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadArtworkSideDesignationSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await designateCustomerUploadArtworkSide({
                organizationId,
                sourceOrderId: req.params.orderId,
                targetOrderId: parsed.data.targetOrderId,
                targetLineItemId: parsed.data.targetLineItemId,
                attachmentId: req.params.attachmentId,
                side: parsed.data.side,
                designationNote: parsed.data.designationNote,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadArtworkSideDesignation] Error:", error);
            return res.status(500).json({ error: "Failed to designate customer upload artwork side" });
        }
    });

    app.post("/api/orders/:orderId/attachments/:attachmentId/customer-upload-primary-artwork-candidate", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;
            const organizationId = getRequestOrganizationId(req);
            const userId = getUserId(req.user);
            if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
            if (!userId) return res.status(401).json({ error: "Authentication required" });

            const parsed = customerUploadPrimaryArtworkCandidateSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

            const updated = await selectCustomerUploadPrimaryArtworkCandidate({
                organizationId,
                sourceOrderId: req.params.orderId,
                targetOrderId: parsed.data.targetOrderId,
                targetLineItemId: parsed.data.targetLineItemId,
                attachmentId: req.params.attachmentId,
                side: parsed.data.side,
                candidateNote: parsed.data.candidateNote,
                actorUserId: userId,
                actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") || null,
            });
            return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
        } catch (error: any) {
            if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
            console.error("[OrderAttachments:CustomerUploadPrimaryArtworkCandidate] Error:", error);
            return res.status(500).json({ error: "Failed to select customer upload primary artwork candidate" });
        }
    });

    app.get("/api/orders/:id/cancellation-eligibility", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) {
                return res.status(500).json({ success: false, message: "Missing organization context" });
            }

            const eligibility = await assessOrderCancellationEligibility({
                organizationId,
                orderId: String(req.params.id),
            });

            return res.json({ success: true, data: eligibility });
        } catch (error: any) {
            console.error("[GET /api/orders/:id/cancellation-eligibility] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to check cancellation eligibility" });
        }
    });

    app.post("/api/orders/:id/cancel", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;

            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) {
                return res.status(500).json({ success: false, message: "Missing organization context" });
            }

            const userId = getUserId(req.user);
            if (!userId) {
                return res.status(401).json({ success: false, message: "Authentication required" });
            }

            const parsed = cancelOrderRequestSchema.parse(req.body ?? {});
            const result = await cancelOrder({
                organizationId,
                orderId: String(req.params.id),
                actorUserId: userId,
                reason: parsed.reason,
                internalNote: parsed.internalNote ?? null,
                ipAddress: req.ip,
                userAgent: req.get?.("user-agent") ?? req.headers["user-agent"] ?? null,
            });

            return res.json({
                success: true,
                data: result,
                warnings: result.warnings,
                message: result.warnings.length > 0
                    ? `Order cancelled with ${result.warnings.length} warning(s).`
                    : "Order cancelled.",
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    code: "VALIDATION_ERROR",
                    message: fromZodError(error).message,
                    details: error.flatten(),
                });
            }
            if (error instanceof OrderCancellationError) {
                return res.status(error.statusCode).json({
                    success: false,
                    code: error.code,
                    message: error.message,
                    details: error.details ?? null,
                });
            }
            console.error("[POST /api/orders/:id/cancel] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to cancel order" });
        }
    });

    // A duplicate is a new commercial order, never a resurrection or mutation
    // of the historical source.  Owner/Admin is resolved by tenantContext.
    app.post("/api/orders/:id/duplicate", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ success: false, message: "User not authenticated" });

            const createDuplicate = () => duplicateOrder({
                organizationId,
                sourceOrderId: req.params.id,
                actorUserId: userId,
                actorName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || null,
            });
            const result = await orderCreationIdempotencyStore.run(
                {
                    scope: `${organizationId}:${userId}:orders:${req.params.id}:duplicate`,
                    key: extractOrderCreationIdempotencyKey(req),
                    fingerprint: buildOrderCreationFingerprint({ route: "POST /api/orders/:id/duplicate", orderId: req.params.id, body: req.body }),
                },
                createDuplicate,
            );
            return res.status(result.replayed ? 200 : 201).json({ success: true, data: { order: result.value } });
        } catch (error: any) {
            if (error instanceof OrderDuplicationError) {
                return res.status(error.code === "ORDER_NOT_FOUND" ? 404 : 400).json({ success: false, message: error.message, code: error.code });
            }
            if (error?.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
                return res.status(409).json({ success: false, message: error.message, code: error.code });
            }
            console.error("[POST /api/orders/:id/duplicate] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to duplicate order" });
        }
    });

    app.patch("/api/orders/:orderId/attachments/:attachmentId/portal-visibility", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            if (!assertInternalStaffUser(req, res)) return;

            const { orderId, attachmentId } = req.params;
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const userId = getUserId(req.user);

            const parsed = portalAttachmentVisibilitySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: fromZodError(parsed.error).message });
            }

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ error: "Attachment not found" });

            const [existing] = await db
                .select()
                .from(orderAttachments)
                .where(and(
                    eq(orderAttachments.id, attachmentId),
                    eq(orderAttachments.orderId, orderId),
                    isNull(orderAttachments.orderLineItemId)
                ))
                .limit(1);

            if (!existing) return res.status(404).json({ error: "Attachment not found" });

            const patch = normalizePortalVisibilityPatch(parsed.data);
            const [updated] = await db
                .update(orderAttachments)
                .set({
                    ...patch,
                    portalVisibilityUpdatedAt: new Date(),
                    portalVisibilityUpdatedBy: userId ?? null,
                    updatedAt: new Date(),
                } as any)
                .where(and(
                    eq(orderAttachments.id, attachmentId),
                    eq(orderAttachments.orderId, orderId),
                    isNull(orderAttachments.orderLineItemId)
                ))
                .returning();

            try {
                await db.insert(auditLogs).values({
                    organizationId,
                    userId: userId ?? null,
                    userName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
                    actionType: "portal_file_visibility.updated",
                    entityType: "order_attachment",
                    entityId: attachmentId,
                    entityName: updated?.originalFilename || updated?.fileName || attachmentId,
                    description: patch.customerVisible
                        ? "Order attachment marked visible in the customer portal."
                        : "Order attachment hidden from the customer portal.",
                    oldValues: {
                        customerVisible: existing.customerVisible,
                        portalFileCategory: existing.portalFileCategory,
                        portalDisplayName: existing.portalDisplayName,
                        portalDescription: existing.portalDescription,
                    },
                    newValues: patch,
                    ipAddress: req.ip,
                    userAgent: req.get?.("user-agent") || null,
                } as any);
            } catch (auditError) {
                console.error("[OrderAttachments:PortalVisibility] Audit log failed:", auditError);
            }

            const enriched = await enrichAttachmentWithUrls(updated);
            return res.json({ success: true, data: enriched });
        } catch (error) {
            console.error("[OrderAttachments:PortalVisibility] Error:", error);
            return res.status(500).json({ error: "Failed to update portal visibility" });
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

            const resolutions = await lineItemArtworkReadResolver.resolveForLineItems({
                organizationId,
                lineItemIds,
                purpose: "order",
            });
            for (const lineItemId of lineItemIds) {
                const resolution = resolutions.get(lineItemId);
                const thumbnailIds = resolution?.artwork
                    .map((artwork) => artwork.fileRecordId)
                    .filter((id): id is string => !!id)
                    .slice(0, 3) ?? [];
                out[lineItemId] = {
                    thumbUrls: Array.from(new Set(thumbnailIds)).map((id) => `/api/artwork/file-records/${encodeURIComponent(id)}/content?variant=thumbnail`),
                    thumbCount: resolution?.artwork.length ?? 0,
                };
            }

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
                const created = await persistOrderAttachment({
                    orderId,
                    quoteId: order.quoteId || null,
                    organizationId,
                    userId,
                    userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    description,
                    requestedTarget,
                    orderNumber: order.orderNumber,
                    source: {
                        kind: "upload-session",
                        uploadId,
                        expectedPurpose: "order-attachment",
                        expectedParentId: orderId,
                    },
                });
                await kickoffOrderPdfThumbnailProcessing({
                    organizationId,
                    attachment: created,
                    logLabel: 'OrderAttachments:POST',
                });
                const enriched = await enrichAttachmentWithUrls(created);
                return res.json({ success: true, data: [enriched] });
            }

            if (Array.isArray(files) && files.length > 0) {
                const inserted = [];
                for (const f of files) {
                    const created = await persistOrderAttachment({
                        orderId,
                        quoteId: order.quoteId || null,
                        organizationId,
                        userId,
                        userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                        description,
                        requestedTarget,
                        orderNumber: order.orderNumber,
                        source: {
                            kind: "buffer",
                            buffer: Buffer.from(f.fileBufferBase64, 'base64'),
                            originalFilename: f.fileName,
                            mimeType: f.mimeType || 'application/octet-stream',
                        },
                    });
                    inserted.push(created);
                    await kickoffOrderPdfThumbnailProcessing({
                        organizationId,
                        attachment: created,
                        logLabel: 'OrderAttachments:POST',
                    });
                }
                const enrichedInserted = await Promise.all(inserted.map((file) => enrichAttachmentWithUrls(file)));
                return res.json({ success: true, data: enrichedInserted });
            }

            if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });
            if (!fileName) return res.status(400).json({ error: "fileName is required" });

            const isHttp = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'));
            const attachment = isHttp
                ? (await db.insert(orderAttachments).values({
                    orderId,
                    quoteId: order.quoteId || null,
                    uploadedByUserId: userId,
                    uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    fileName,
                    originalFilename: fileName,
                    fileUrl,
                    relativePath: null,
                    fileSize: fileSize || null,
                    mimeType: mimeType || null,
                    description: description || null,
                    storageProvider: undefined,
                }).returning())[0]
                : await persistOrderAttachment({
                    orderId,
                    quoteId: order.quoteId || null,
                    organizationId,
                    userId,
                    userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    description,
                    requestedTarget,
                    orderNumber: order.orderNumber,
                    source: {
                        kind: "existing-key",
                        fileUrl: normalizeObjectKeyForDb(fileUrl),
                        originalFilename: fileName,
                        mimeType: mimeType || null,
                        fileSize: fileSize || null,
                    },
                });

            await kickoffOrderPdfThumbnailProcessing({
                organizationId,
                attachment,
                logLabel: 'OrderAttachments:POST',
            });

            // PHASE 2: Create asset + link to order (fail-soft)
            try {
                const { assetRepository } = await import('../services/assets/AssetRepository');
                const resolvedOriginal = attachment.fileRecordId
                    ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
                    : null;
                const assetFileKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? attachment.fileUrl;
                const asset = await assetRepository.createAsset(organizationId, {
                    fileRecordId: attachment.fileRecordId ?? null,
                    fileKey: attachment.fileRecordId ? null : assetFileKey,
                    fileName: fileName,
                    mimeType: mimeType || undefined,
                    sizeBytes: fileSize || undefined,
                });
                await assetRepository.linkAsset(organizationId, asset.id, 'order', orderId, 'attachment');
                console.log(`[OrderAttachments:POST] Created asset ${asset.id} + linked to order ${orderId}`);
            } catch (assetError) {
                console.error(`[OrderAttachments:POST] Asset creation failed (non-blocking):`, assetError);
            }

            const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
            return res.json({ success: true, data: enrichedAttachment });
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

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ error: "Order not found" });

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

            await db
                .delete(orderAttachments)
                .where(
                    and(
                        eq(orderAttachments.id, attachmentId),
                        eq(orderAttachments.orderId, orderId),
                        isNull(orderAttachments.orderLineItemId)
                    )
                );

            try {
                const resolvedOriginal = attachment.fileRecordId
                    ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
                    : null;
                const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? attachment.fileUrl ?? "");
                const storageProvider = resolvedOriginal?.providerType === "local_filesystem"
                    ? "local"
                    : resolvedOriginal?.providerType === "s3"
                        ? "s3"
                        : resolvedOriginal?.objectKey
                            ? "supabase"
                            : ((attachment.storageProvider as "local" | "s3" | "gcs" | "supabase" | null | undefined) ?? null);

                if (storageKey) {
                    const [{ orderRefs = 0 } = {}] = attachment.fileRecordId
                        ? await db
                            .select({ orderRefs: sql<number>`count(*)` })
                            .from(orderAttachments)
                            .where(eq(orderAttachments.fileRecordId, String(attachment.fileRecordId)))
                        : !storageProvider
                            ? [{ orderRefs: 0 }]
                        : await db
                            .select({ orderRefs: sql<number>`count(*)` })
                            .from(orderAttachments)
                            .where(
                                and(
                                    eq(orderAttachments.fileUrl, storageKey),
                                    eq(orderAttachments.storageProvider, storageProvider)
                                )
                            );

                    const [{ quoteRefs = 0 } = {}] = attachment.fileRecordId
                        ? await db
                            .select({ quoteRefs: sql<number>`count(*)` })
                            .from(quoteAttachments)
                            .where(
                                and(
                                    eq(quoteAttachments.organizationId, organizationId),
                                    eq(quoteAttachments.fileRecordId, String(attachment.fileRecordId))
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
                                    eq(quoteAttachments.storageProvider, storageProvider)
                                )
                            );

                    const remainingAttachmentRefs = Number(orderRefs) + Number(quoteRefs);
                    let hasRemainingAssetLinksForFile = false;
                    const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

                    try {
                        const { assets, assetLinks, assetVariants } = await import("@shared/schema");
                        const matchingAssets = attachment.fileRecordId
                            ? await db
                                .select({ id: assets.id, fileKey: assets.fileKey })
                                .from(assets)
                                .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(attachment.fileRecordId))))
                            : await db
                                .select({ id: assets.id, fileKey: assets.fileKey })
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
                                                eq(assetLinks.parentType, "order"),
                                                eq(assetLinks.parentId, orderId)
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

                            if (!hasRemainingAssetLinksForFile && remainingAttachmentRefs === 0) {
                                for (const asset of matchingAssets) {
                                    const variants = await db
                                        .select({ key: assetVariants.key })
                                        .from(assetVariants)
                                        .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, asset.id)));

                                    await deleteStoredObjectKeysIfUnreferenced({
                                        organizationId,
                                        fileRecordId: attachment.fileRecordId ? String(attachment.fileRecordId) : null,
                                        legacyStorageProvider: storageProvider,
                                        keys: [...variants.map((variant) => variant.key || ""), normalizedFileKey],
                                        exclusions: { assetIds: [asset.id] },
                                        logContext: {
                                            route: "order-attachment-delete",
                                            orderId,
                                            attachmentId: attachment.id,
                                            assetId: asset.id,
                                        },
                                    });

                                    await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                                }
                            }
                        }
                    } catch (assetCleanupError) {
                        console.error("[OrderAttachments:DELETE] Asset cleanup failed (non-blocking):", assetCleanupError);
                    }

                    if (remainingAttachmentRefs === 0 && !hasRemainingAssetLinksForFile && storageProvider) {
                        const derivativeRows = attachment.fileRecordId
                            ? await fileDerivativeRepository.listByFileRecordId(String(attachment.fileRecordId))
                            : [];
                        const derivativeKeys = attachment.fileRecordId
                            ? derivativeRows.map((row) => row.objectKey ?? null)
                            : [(attachment as any).thumbKey ?? null, (attachment as any).previewKey ?? null];

                        const derivativeDeletion = await deleteStoredObjectKeysIfUnreferenced({
                            organizationId,
                            fileRecordId: attachment.fileRecordId ? String(attachment.fileRecordId) : null,
                            legacyStorageProvider: storageProvider,
                            keys: [storageKey, ...derivativeKeys],
                            logContext: {
                                route: "order-attachment-delete",
                                orderId,
                                attachmentId: attachment.id,
                            },
                        });

                        if (attachment.fileRecordId && !derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0) {
                            await fileDerivativeRepository.deleteByFileRecordId(String(attachment.fileRecordId));
                        } else if (attachment.fileRecordId && (derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0)) {
                            console.warn("[OrderAttachments:DELETE] Skipped derivative row cleanup due to storage delete failures", {
                                fileRecordId: String(attachment.fileRecordId),
                                failedKeys: derivativeDeletion.failedKeys,
                                skipped: derivativeDeletion.skipped,
                                reason: derivativeDeletion.reason ?? null,
                            });
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
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
            const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
            const limitRaw = Number(req.query.limit);
            const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 20;

            let list = await storage.getAllMaterials(organizationId);
            const materialIds = list.map((material: any) => String(material.id)).filter(Boolean);
            const linkRows = materialIds.length > 0
                ? await db
                    .select({
                        materialId: materialProductLinks.materialId,
                        productId: materialProductLinks.productId,
                    })
                    .from(materialProductLinks)
                    .where(and(
                        eq(materialProductLinks.organizationId, organizationId),
                        inArray(materialProductLinks.materialId, materialIds),
                        isNull(materialProductLinks.removedAt)
                    ))
                : [];
            const linkedProductIdsByMaterialId = new Map<string, string[]>();
            for (const row of linkRows) {
                const materialId = String(row.materialId);
                const current = linkedProductIdsByMaterialId.get(materialId) || [];
                current.push(String(row.productId));
                linkedProductIdsByMaterialId.set(materialId, current);
            }
            list = list.map((material: any) => ({
                ...toPublicMaterial(material),
                linkedProductIds: linkedProductIdsByMaterialId.get(String(material.id)) || [],
            }));

            if (!includeInactive) {
                list = list.filter((m: any) => m?.isActive !== false);
            }

            if (search) {
                const s = search.toLowerCase();
                list = list.filter((m: any) => {
                    const name = String(m?.name || '').toLowerCase();
                    const sku = String(m?.sku || '').toLowerCase();
                    return name.includes(s) || sku.includes(s);
                });
            }

            // Search mode: compact payload for dropdowns/search selectors
            if (search || req.query.limit !== undefined) {
                const materialsList = list
                    .slice(0, limit)
                    .map((m: any) => ({
                        id: m.id,
                        name: m.name,
                        materialForm: m.materialForm,
                        inventoryUnit: m.inventoryUnit,
                        consumptionUnit: m.consumptionUnit,
                        vendorCostUnit: m.vendorCostUnit,
                        isActive: m.isActive,
                        linkedProductIds: m.linkedProductIds || [],
                    }));
                return res.json({ success: true, data: { materials: materialsList } });
            }

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
                    'Material Form': 'roll',
                    Category: 'Vinyl',
                    'Inventory Unit': 'square_foot',
                    'Vendor Cost Unit': 'square_foot',
                    'Consumption Unit': 'square_foot',
                    Width: '54',
                    Height: '',
                    Thickness: '',
                    'Thickness Unit': 'mil',
                    Color: 'White',
                    'Cost Per Unit': '0.2500',
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
                'Material Form': m.materialForm || '',
                Category: m.category || '',
                'Inventory Unit': m.inventoryUnit || '',
                'Vendor Cost Unit': m.vendorCostUnit || '',
                'Consumption Unit': m.consumptionUnit || '',
                Width: m.width ?? '',
                Height: m.height ?? '',
                Thickness: m.thickness ?? '',
                'Thickness Unit': m.thicknessUnit ?? '',
                Color: m.color ?? '',
                'Cost Per Unit': m.costPerUnit ?? '',
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
                const materialForm = (row['Material Form'] || '').trim();
                const inventoryUnit = (row['Inventory Unit'] || '').trim();
                const consumptionUnit = (row['Consumption Unit'] || '').trim();

                if (!name || !sku || !materialForm || !inventoryUnit || !consumptionUnit) {
                    skipped++;
                    rowErrors.push({ row: i + 2, message: 'Name, SKU, Material Form, Inventory Unit, and Consumption Unit are required.' });
                    continue;
                }

                const payload: any = {
                    name,
                    sku,
                    materialForm,
                    category: (row['Category'] || '').trim() || undefined,
                    inventoryUnit,
                    vendorCostUnit: (row['Vendor Cost Unit'] || '').trim() || undefined,
                    consumptionUnit,
                    width: parseNum(row['Width']),
                    height: parseNum(row['Height']),
                    thickness: parseNum(row['Thickness']),
                    thicknessUnit: (row['Thickness Unit'] || '').trim() || undefined,
                    color: (row['Color'] || '').trim() || undefined,
                    costPerUnit: parseNum(row['Cost Per Unit']),
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
                        const existing = await storage.getMaterialById(organizationId, materialId);
                        if (!existing) throw new Error('Material not found');
                        const parsedUpdate = updateMaterialSchema.parse(payload);
                        insertMaterialSchema.parse({ ...toOperationalMaterialConfig(existing), ...parsedUpdate, type: parsedUpdate.materialForm ?? existing.type });
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

    app.get('/api/material-reorder-requests', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const requests = await storage.listMaterialReorderRequests(organizationId);
            res.json({ success: true, data: requests });
        } catch (err) {
            console.error('Error fetching material reorder requests', err);
            res.status(500).json({ error: 'Failed to fetch material reorder requests' });
        }
    });

    app.get('/api/materials/:id', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const material = await storage.getMaterialById(organizationId, req.params.id);
            if (!material) return res.status(404).json({ error: 'Material not found' });
            const linkedProducts = await storage.listProductsForMaterial(organizationId, req.params.id, { activeOnly: true });
            res.json({ success: true, data: { ...toPublicMaterial(material), linkedProductIds: linkedProducts.map((product: any) => product.id) } });
        } catch (err) {
            console.error('Error fetching material', err);
            res.status(500).json({ error: 'Failed to fetch material' });
        }
    });

    app.post('/api/materials/:id/duplicate', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

            const result = await duplicateMaterial({
                organizationId,
                materialId: String(req.params.id),
            });

            return res.json({
                success: true,
                data: result.material,
                created: true,
                sourceMaterialId: String(req.params.id),
                copiedProductLinkIds: result.copiedProductLinkIds,
            });
        } catch (err) {
            if (err instanceof DuplicateMaterialError) {
                return res.status(err.statusCode).json({
                    success: false,
                    code: err.code,
                    error: err.message,
                });
            }
            if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: fromZodError(err).message });
            if (typeof (err as any)?.code === 'string' && String((err as any).code).startsWith('MATERIAL_WEIGHT_')) {
                return res.status(400).json({ success: false, error: (err as any).message, code: (err as any).code });
            }
            console.error('[POST /api/materials/:id/duplicate] Error:', err);
            return res.status(500).json({ success: false, error: 'Failed to duplicate material' });
        }
    });

    app.post('/api/materials', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const parsed = insertMaterialSchema.parse(req.body);
            const { organizationId: _orgId, linkedProductIds: rawLinkedProductIds = [], ...materialData } =
                parsed as typeof parsed & { organizationId?: string; linkedProductIds?: string[] };
            const linkedProductIds = normalizeLinkedProductIds(rawLinkedProductIds);

            const normalizedName = String(materialData.name || '').trim().toLowerCase();
            if (normalizedName) {
                const [existing] = await db
                    .select()
                    .from(materials)
                    .where(
                        and(
                            eq(materials.organizationId, organizationId),
                            sql`lower(trim(${materials.name})) = ${normalizedName}`
                        )
                    )
                    .limit(1);

                if (existing) {
                    return res.json({
                        success: true,
                        data: toPublicMaterial(existing),
                        created: false,
                        duplicate: true,
                    });
                }
            }

            const created = await storage.createMaterial(organizationId, materialData);
            const warnings: any[] = [];
            let finalLinkedProductIds: string[] = [];
            if (linkedProductIds.length > 0) {
                try {
                    const linkResult = await storage.replaceProductsForMaterial(organizationId, created.id, linkedProductIds);
                    finalLinkedProductIds = linkResult.linkedProductIds;
                    const warning = buildMaterialLinkWarning(linkResult.ignoredProductIds);
                    if (warning) warnings.push(warning);
                } catch (linkError) {
                    console.error('[Materials] Failed to link products after material create', {
                        materialId: created.id,
                        linkedProductIds,
                        error: linkError,
                    });
                    warnings.push({
                        code: "MATERIAL_PRODUCT_LINKS_FAILED",
                        message: "Material was saved, but linked products could not be updated. You can retry from the material editor.",
                    });
                }
            }
            res.json({
                success: true,
                data: { ...toPublicMaterial(created), linkedProductIds: finalLinkedProductIds },
                created: true,
                duplicate: false,
                warnings,
            });
        } catch (err) {
            if ((err as any)?.code === '23505') {
                try {
                    const organizationId = getRequestOrganizationId(req);
                    if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
                    const parsed = insertMaterialSchema.parse(req.body);
                    const normalizedName = String(parsed.name || '').trim().toLowerCase();
                    if (normalizedName) {
                        const [existing] = await db
                            .select()
                            .from(materials)
                            .where(
                                and(
                                    eq(materials.organizationId, organizationId),
                                    sql`lower(trim(${materials.name})) = ${normalizedName}`
                                )
                            )
                            .limit(1);

                        if (existing) {
                            return res.json({
                                success: true,
                                data: toPublicMaterial(existing),
                                created: false,
                                duplicate: true,
                            });
                        }
                    }
                } catch {
                    // fallthrough to generic handling
                }
            }
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            if (typeof (err as any)?.code === 'string' && String((err as any).code).startsWith('MATERIAL_WEIGHT_')) {
                return res.status(400).json({ error: (err as any).message, code: (err as any).code });
            }
            res.status(500).json({ error: 'Failed to create material' });
        }
    });

    app.patch('/api/materials/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const parsed = updateMaterialSchema.parse(req.body);
            const { organizationId: _orgId, linkedProductIds: rawLinkedProductIds, ...materialData } =
                parsed as typeof parsed & { organizationId?: string; linkedProductIds?: string[] };
            const currentMaterial = await storage.getMaterialById(organizationId, req.params.id);
            if (!currentMaterial) return res.status(404).json({ error: 'Material not found' });
            // PATCH validation is performed against the resulting configuration, not just the sparse payload.
            insertMaterialSchema.parse({ ...toOperationalMaterialConfig(currentMaterial), ...materialData, type: (materialData as any).materialForm ?? currentMaterial.type });
            const shouldReplaceLinkedProducts = Array.isArray(rawLinkedProductIds);
            const linkedProductIds = normalizeLinkedProductIds(rawLinkedProductIds);

            if (typeof (materialData as any).name === 'string') {
                const normalizedName = String((materialData as any).name || '').trim().toLowerCase();
                if (normalizedName) {
                    const [existing] = await db
                        .select({ id: materials.id, name: materials.name })
                        .from(materials)
                        .where(
                            and(
                                eq(materials.organizationId, organizationId),
                                sql`lower(trim(${materials.name})) = ${normalizedName}`,
                                sql`${materials.id} <> ${req.params.id}`
                            )
                        )
                        .limit(1);
                    if (existing) {
                        return res.status(409).json({
                            error: 'Material name already exists in this organization',
                            duplicate: true,
                            data: existing,
                        });
                    }
                }
            }

            const updated = await storage.updateMaterial(organizationId, req.params.id, materialData);
            const warnings: any[] = [];
            let finalLinkedProductIds: string[] | undefined;
            if (shouldReplaceLinkedProducts) {
                try {
                    const linkResult = await storage.replaceProductsForMaterial(organizationId, req.params.id, linkedProductIds);
                    finalLinkedProductIds = linkResult.linkedProductIds;
                    const warning = buildMaterialLinkWarning(linkResult.ignoredProductIds);
                    if (warning) warnings.push(warning);
                } catch (linkError) {
                    console.error('[Materials] Failed to link products after material update', {
                        materialId: req.params.id,
                        linkedProductIds,
                        error: linkError,
                    });
                    warnings.push({
                        code: "MATERIAL_PRODUCT_LINKS_FAILED",
                        message: "Material was saved, but linked products could not be updated. You can retry from the material editor.",
                    });
                }
            } else {
                const linkedProducts = await storage.listProductsForMaterial(organizationId, req.params.id, { activeOnly: true });
                finalLinkedProductIds = linkedProducts.map((product: any) => product.id);
            }
            res.json({ success: true, data: { ...toPublicMaterial(updated), linkedProductIds: finalLinkedProductIds || [] }, warnings });
        } catch (err) {
            if ((err as any)?.code === '23505') {
                return res.status(409).json({
                    error: 'Material name already exists in this organization',
                    duplicate: true,
                });
            }
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            if (typeof (err as any)?.code === 'string' && String((err as any).code).startsWith('MATERIAL_WEIGHT_')) {
                return res.status(400).json({ error: (err as any).message, code: (err as any).code });
            }
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
            const parsed = manualInventoryAdjustmentSchema.parse(req.body);
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });

            const movement = buildManualInventoryAdjustment({
                currentQuantity: Number(material.stockQuantity || 0),
                adjustmentMode: parsed.adjustmentMode,
                quantity: parsed.quantity,
                reason: parsed.reason,
                otherReason: parsed.otherReason,
                notes: parsed.notes,
            });

            const adjustment = await storage.adjustInventory(
                organizationId,
                material.id,
                movement.detailType,
                movement.quantityDelta,
                userId,
                movement.reason || undefined,
                undefined,
                { notes: movement.notes || undefined, movementType: movement.movementType }
            );

            res.json({ success: true, data: adjustment, message: 'Inventory adjusted' });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            if ((err as any)?.message === 'Adjustment would make stock negative') {
                return res.status(400).json({ error: 'Adjustment would make stock negative' });
            }
            res.status(500).json({ error: 'Failed to adjust inventory' });
        }
    });

    app.post('/api/materials/:id/reorder-requests', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const material = await storage.getMaterialById(organizationId, req.params.id);
            if (!material) return res.status(404).json({ error: 'Material not found' });
            if (material.isActive === false) return res.status(400).json({ error: 'Cannot create reorder request for an inactive material' });

            const parsed = insertMaterialReorderRequestSchema.parse({ ...req.body, materialId: req.params.id });
            const userId = getUserId(req.user);
            const created = await storage.createMaterialReorderRequest(organizationId, {
                ...parsed,
                requestedByUserId: userId || null,
            });
            res.json({ success: true, data: created, message: 'Reorder request created' });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            if ((err as any)?.message === 'Open reorder request already exists for this material') {
                return res.status(409).json({ error: 'Open reorder request already exists for this material' });
            }
            console.error('Error creating material reorder request', err);
            res.status(500).json({ error: 'Failed to create reorder request' });
        }
    });

    app.post('/api/material-reorder-requests/:id/mark-ordered', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });
            const updated = await storage.markMaterialReorderRequestOrdered(organizationId, req.params.id, userId);
            res.json({ success: true, data: updated, message: 'Reorder request marked ordered' });
        } catch (err) {
            const message = String((err as any)?.message || 'Failed to mark reorder request ordered');
            if (message.includes('not found')) return res.status(404).json({ error: message });
            if (message.includes('Only requested')) return res.status(400).json({ error: message });
            console.error('Error marking material reorder request ordered', err);
            res.status(500).json({ error: 'Failed to mark reorder request ordered' });
        }
    });

    app.post('/api/material-reorder-requests/:id/cancel', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });
            const updated = await storage.cancelMaterialReorderRequest(organizationId, req.params.id, userId);
            res.json({ success: true, data: updated, message: 'Reorder request cancelled' });
        } catch (err) {
            const message = String((err as any)?.message || 'Failed to cancel reorder request');
            if (message.includes('not found')) return res.status(404).json({ error: message });
            if (message.includes('Only requested or ordered')) return res.status(400).json({ error: message });
            console.error('Error cancelling material reorder request', err);
            res.status(500).json({ error: 'Failed to cancel reorder request' });
        }
    });

    app.post('/api/material-reorder-requests/:id/receive', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Not authenticated' });
            const parsed = materialReorderReceiveSchema.parse(req.body);
            const result = await storage.receiveMaterialReorderRequest(
                organizationId,
                req.params.id,
                parsed.receivedQuantity,
                userId,
                parsed.notes || undefined,
            );
            res.json({ success: true, data: result, message: 'Reorder request received' });
        } catch (err) {
            if (err instanceof z.ZodError) return res.status(400).json({ error: fromZodError(err).message });
            const message = String((err as any)?.message || 'Failed to receive reorder request');
            if (message.includes('not found')) return res.status(404).json({ error: message });
            if (message.includes('Only requested or ordered')) return res.status(400).json({ error: message });
            console.error('Error receiving material reorder request', err);
            res.status(500).json({ error: 'Failed to receive reorder request' });
        }
    });

    app.get('/api/materials/:id/adjustments', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const adjustments = await storage.getInventoryAdjustments(organizationId, req.params.id);
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
            const deductionResult = await storage.autoDeductInventoryWhenOrderMovesToProduction(organizationId, req.params.id, userId);
            const usage = await storage.getMaterialUsageByOrder(req.params.id);
            res.json({
                success: true,
                data: usage,
                message: deductionResult.skippedStockDeductionCount > 0
                    ? "Inventory deduction completed with skipped stock mutation(s); manual inventory review required."
                    : "Inventory deducted",
                deductionResult,
            });
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
            if (error instanceof OrderDeletionProtectedError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                    code: error.code,
                    details: error.details,
                });
            }
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
            const { poNumber, dueDate, promisedDate, priority, notesInternal } = req.body || {};
            const convertQuoteForRequest = async () => {
                return await canonicalOrderOperations.convertQuoteToOrder({ organizationId, actorUserId: userId, quoteId: req.params.id, options: {
                    poNumber: poNumber ? String(poNumber) : undefined,
                    dueDate: dueDate ? new Date(dueDate) : undefined,
                    promisedDate: promisedDate ? new Date(promisedDate) : undefined,
                    priority: priority || "normal",
                    notesInternal: notesInternal ?? undefined,
                } });
            };
            const key = extractOrderCreationIdempotencyKey(req);
            const fingerprint = buildOrderCreationFingerprint({
                route: "POST /api/quotes/:id/convert-to-order",
                quoteId: req.params.id,
                body: req.body,
            });
            const result = await orderCreationIdempotencyStore.run(
                {
                    scope: `${organizationId}:${userId}:quotes:${req.params.id}:convert-to-order`,
                    key,
                    fingerprint,
                },
                convertQuoteForRequest,
            );
            res.status(result.replayed ? 200 : 201).json({ success: true, data: { order: result.value } });
        } catch (error: any) {
            console.error("[QUOTE TO ORDER CONVERSION] failed", error);
            if (error?.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
                return res.status(409).json({
                    success: false,
                    message: error.message,
                    code: error.code,
                });
            }
            if (error instanceof OrderIdentityError) {
                const statusCode = error.code === "ORDER_CONTACT_CUSTOMER_CONFLICT"
                    ? 409
                    : error.code === "ORDER_CUSTOMER_NOT_FOUND" || error.code === "ORDER_CONTACT_NOT_FOUND"
                        ? 404
                        : 400;
                return res.status(statusCode).json({
                    success: false,
                    message: error.message,
                    code: error.code,
                });
            }
            const status = error?.statusCode || (error?.message?.includes('already converted') ? 409 : 500);
            res.status(status).json({
                success: false,
                message: error?.message || "Failed to convert quote to order",
                code: error?.code,
                errors: error?.errors,
            });
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
            const { poNumber, dueDate, promisedDate, priority, notesInternal, customerId, contactId } = req.body;
            const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase();

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

            let finalCustomerId: string | null;
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
                finalCustomerId = customerId !== undefined ? customerId || null : quote.customerId || null;
                finalContactId = contactId !== undefined ? contactId || null : quote.contactId || null;

                if (!finalCustomerId && !finalContactId) {
                    return res.status(400).json({
                        message: "This quote is missing a customer or contact. Please edit the quote and select a buyer before converting to an order.",
                        code: "ORDER_IDENTITY_REQUIRED",
                    });
                }
            }

            const convertQuoteForRequest = async () => {
                const order = await canonicalOrderOperations.convertQuoteToOrder({ organizationId, actorUserId: userId, quoteId, options: {
                    poNumber: poNumber ? String(poNumber) : undefined,
                    dueDate: dueDate || undefined,
                    promisedDate: promisedDate || undefined,
                    priority,
                    notesInternal,
                    customerId: finalCustomerId,
                    contactId: finalContactId,
                } });

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

                return order;
            };

            const key = extractOrderCreationIdempotencyKey(req);
            const fingerprint = buildOrderCreationFingerprint({
                route: "POST /api/orders/from-quote/:quoteId",
                quoteId,
                body: req.body,
            });
            const result = await orderCreationIdempotencyStore.run(
                {
                    scope: `${organizationId}:${userId}:orders:from-quote:${quoteId}`,
                    key,
                    fingerprint,
                },
                convertQuoteForRequest,
            );

            res.json(result.value);
        } catch (error: any) {
            console.error("[CONVERT QUOTE TO ORDER] Error:", error);
            if (error?.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
                return res.status(409).json({
                    message: error.message,
                    error: error.message,
                    code: error.code,
                });
            }
            if (error?.message?.includes('already converted')) {
                return res.status(409).json({
                    message: error.message,
                    error: error.message
                });
            }
            const status = error?.statusCode || 500;
            res.status(status).json({
                success: false,
                message: error?.message || "Failed to convert quote to order",
                error: error?.message,
                code: error?.code,
                errors: error?.errors,
            });
        }
    });

    app.patch('/api/orders/:id/fulfillment-status', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            if (!['owner', 'admin', 'manager'].includes(String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase())) {
                return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
            }

            const [order] = await db
                .select({
                    id: orders.id,
                    state: orders.state,
                })
                .from(orders)
                .where(and(eq(orders.id, req.params.id), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            if (order.state === 'production_complete') {
                return res.status(409).json({
                    error: 'Manual fulfillment status overrides are disabled for fulfillment-managed orders. Use shipment or pickup actions.',
                    code: 'FULFILLMENT_ARTIFACT_SYNC_REQUIRED',
                });
            }

            const { status } = req.body;
            if (!['pending', 'packed', 'shipped', 'delivered'].includes(status)) {
                return res.status(400).json({ error: 'Invalid fulfillment status' });
            }
            if (['shipped', 'delivered'].includes(status)) {
                return res.status(409).json({
                    error: 'Terminal fulfillment status must be recorded through shipment or pickup actions.',
                    code: 'FULFILLMENT_TERMINAL_ACTION_REQUIRED',
                });
            }
            await updateOrderFulfillmentStatus(organizationId, req.params.id, status);
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
            const order = await canonicalOrderOperations.convertQuoteToOrder({ organizationId, actorUserId: userId, quoteId, options: {
                priority: req.body?.priority,
                dueDate: req.body?.dueDate || undefined,
                promisedDate: req.body?.promisedDate || undefined,
                notesInternal: req.body?.internalNotes,
            } });
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
            const status = error?.statusCode || 500;
            res.status(status).json({
                success: false,
                error: error?.message || 'Failed to convert quote',
                code: error?.code,
                errors: error?.errors,
            });
        }
    });

    // Order-specific Audit & Files
    app.get('/api/orders/:id/audit', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const order = await storage.getOrderById(organizationId, req.params.id);
            if (!order) return res.status(404).json({ message: "Order not found" });
            const auditEntries = await storage.getOrderAuditLog(req.params.id);
            res.json({ success: true, data: auditEntries });
        } catch (error) {
            console.error('Error fetching order audit:', error);
            res.status(500).json({ error: 'Failed to fetch audit trail' });
        }
    });

    app.get('/api/orders/:orderId/internal-notes', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const notes = await listOrderInternalNotes({
                organizationId,
                orderId: String(req.params.orderId),
            });

            if (notes === null) {
                return res.status(404).json({ message: 'Order not found' });
            }

            return res.json({ success: true, data: notes, message: 'Order internal notes loaded' });
        } catch (error) {
            console.error('[ORDER_INTERNAL_NOTES_GET] Error:', error);
            return res.status(500).json({ message: 'Failed to fetch order internal notes' });
        }
    });

    app.post('/api/orders/:orderId/internal-notes', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const userId = getUserId(req.user) ?? null;
            const parsed = insertOrderInternalNoteSchema.parse(req.body ?? {});

            const note = await addOrderInternalNote({
                organizationId,
                orderId: String(req.params.orderId),
                userId,
                values: parsed,
            });

            if (!note) {
                return res.status(404).json({ message: 'Order not found' });
            }

            return res.status(201).json({ success: true, data: note, message: 'Order internal note added' });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            console.error('[ORDER_INTERNAL_NOTES_POST] Error:', error);
            return res.status(500).json({ message: 'Failed to add order internal note' });
        }
    });

    app.get('/api/orders/:orderId/line-items/:lineItemId/notes', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const notes = await listLineItemNotes({
                organizationId,
                orderId: String(req.params.orderId),
                lineItemId: String(req.params.lineItemId),
                category: typeof req.query.category === 'string' ? req.query.category : null,
            });

            if (notes === null) {
                return res.status(404).json({ message: 'Order line item not found for this order' });
            }

            return res.json({ success: true, data: notes, message: 'Line item notes loaded' });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            console.error('[ORDER_LINE_ITEM_NOTES_GET] Error:', error);
            return res.status(500).json({ message: 'Failed to fetch line item notes' });
        }
    });

    app.post('/api/orders/:orderId/line-items/:lineItemId/notes', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

            const userId = getUserId(req.user) ?? null;
            const parsed = insertOrderLineItemNoteSchema.parse(req.body ?? {});

            const note = await addLineItemNote({
                organizationId,
                orderId: String(req.params.orderId),
                lineItemId: String(req.params.lineItemId),
                userId,
                values: parsed,
            });

            if (!note) {
                return res.status(404).json({ message: 'Order line item not found for this order' });
            }

            return res.status(201).json({ success: true, data: note, message: 'Line item note added' });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            console.error('[ORDER_LINE_ITEM_NOTES_POST] Error:', error);
            return res.status(500).json({ message: 'Failed to add line item note' });
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
            const [orderRow] = organizationId
                ? await db
                    .select({ orderNumber: orders.orderNumber })
                    .from(orders)
                    .where(and(eq(orders.id, req.params.id), eq(orders.organizationId, organizationId)))
                    .limit(1)
                : [];
            const namingPolicy = organizationId ? await getFileUploadNamingPolicy(organizationId) : null;
            const enrichedFiles = await Promise.all(files.map((f) =>
                enrichAttachmentWithUrls(
                    namingPolicy
                        ? withOrderOriginalArtworkDisplayFilename(f, { orderNumber: orderRow?.orderNumber ?? null, namingPolicy })
                        : f,
                    { logOnce }
                )
            ));

            // PHASE 2: Include linked assets for order-level attachments
            let enrichedAssets: any[] = [];
            if (organizationId) {
                try {
                    const { assetRepository } = await import('../services/assets/AssetRepository');
                    const { enrichAssetsWithRoles } = await import('../services/assets/enrichAssetWithUrls');
                    const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'order', req.params.id);
                    const assetsWithUrls = await enrichAssetsWithRoles(linkedAssets);
                    enrichedAssets = namingPolicy
                        ? assetsWithUrls.map((asset: any) => withOrderOriginalArtworkDisplayFilename(asset, {
                            orderNumber: orderRow?.orderNumber ?? null,
                            namingPolicy,
                        }))
                        : assetsWithUrls;
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
        let uploadStep = 'load_request';
        try {
            uploadStep = 'resolve_organization';
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            uploadStep = 'resolve_user';
            const userId = getUserId(req.user);
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });
            const orderId = String(req.params.id);

            const {
                uploadId,
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

            uploadStep = 'load_order';
            const [order] = await db
                .select({ id: orders.id, orderNumber: orders.orderNumber })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const requestedTarget =
                (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
                (typeof storageTarget === 'string' ? storageTarget : null);

            if (uploadId && typeof uploadId === 'string') {
                const attachment = await persistOrderAttachment({
                    orderId,
                    quoteId: quoteId || null,
                    organizationId,
                    userId,
                    userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    description,
                    requestedTarget,
                    orderNumber: orderNumber ? String(orderNumber) : (order.orderNumber ? String(order.orderNumber) : undefined),
                    orderLineItemId: orderLineItemId ? String(orderLineItemId) : null,
                    role: (role || 'other') as FileRole,
                    side: (side || 'na') as FileSide,
                    isPrimary: isPrimary || false,
                    source: {
                        kind: 'upload-session',
                        uploadId,
                        expectedPurpose: 'order-attachment',
                        expectedParentId: orderId,
                    },
                });

                await kickoffOrderPdfThumbnailProcessing({
                    organizationId,
                    attachment,
                    logLabel: 'OrderFiles:POST',
                });

            await kickoffOrderPdfThumbnailProcessing({
                organizationId,
                attachment,
                logLabel: 'OrderFiles:POST',
            });

                const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
                if (orderLineItemId) {
                    try {
                        await createOriginalLineItemFileFromOrderAttachment({
                            organizationId,
                            orderId,
                            lineItemId: String(orderLineItemId),
                            attachment,
                            userId,
                        });
                    } catch (lineItemFileError) {
                        console.error('[OrderFiles:POST] Failed to mirror upload-session file into line_item_files (non-fatal):', lineItemFileError);
                    }

                    try {
                        await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                            organizationId,
                            lineItemId: String(orderLineItemId),
                            actorUserId: userId,
                            reason: 'artwork_saved',
                        }));
                    } catch (proofSyncError) {
                        console.error('[AutoProofSync:ORDER_FILE_UPLOAD] Failed after upload-session persist (non-fatal):', proofSyncError);
                    }
                }
                return res.json({ success: true, data: enrichedAttachment });
            }

            if (!fileName && !originalFilename) {
                return res.status(400).json({ error: 'fileName or originalFilename is required' });
            }

            const validRoles = ['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other'];
            const validSides = ['front', 'back', 'both', 'na'];

            if (role && !validRoles.includes(role)) {
                return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
            }

            if (side && !validSides.includes(side)) {
                return res.status(400).json({ error: `Invalid side. Must be one of: ${validSides.join(', ')}` });
            }

            uploadStep = 'resolve_line_item';
            let resolvedLineItemId: string | null = orderLineItemId ? String(orderLineItemId) : null;
            if (resolvedLineItemId) {
                const [lineItem] = await db
                    .select({ id: orderLineItems.id })
                    .from(orderLineItems)
                    .where(
                        and(
                            eq(orderLineItems.id, resolvedLineItemId),
                            eq(orderLineItems.orderId, orderId)
                        )
                    )
                    .limit(1);

                if (!lineItem) {
                    return res.status(404).json({ error: 'Line item not found' });
                }
            }

            uploadStep = 'prepare_attachment_payload';
            const baseAttachmentData: any = {
                orderId,
                orderLineItemId: resolvedLineItemId,
                quoteId: quoteId || null,
                uploadedByUserId: userId,
                uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                description: description || null,
                role: (role || 'other') as FileRole,
                side: (side || 'na') as FileSide,
                isPrimary: isPrimary || false,
                productionQuantity: resolvedLineItemId && (role === "artwork" || role === "output")
                    ? defaultNewProductionArtworkAllocation(role)
                    : null,
                productionGroupId: null,
            };
            uploadStep = fileBuffer && originalFilename
                ? 'canonical_finalize_buffer'
                : !fileUrl
                    ? 'validate_legacy_payload'
                    : (typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')))
                        ? 'insert_http_attachment'
                        : 'canonical_finalize_existing_key';

            let canonicalUpload: Awaited<ReturnType<typeof storageApplicationService.finalizeUpload<any>>> | null = null;

            if (fileBuffer && originalFilename) {
                canonicalUpload = await storageApplicationService.finalizeUpload({
                    organizationId,
                    createdByUserId: userId,
                    requestedTarget,
                    resource: {
                        organizationId,
                        resourceType: 'order',
                        resourceId: orderId,
                        orderNumber: orderNumber ? String(orderNumber) : (order.orderNumber ? String(order.orderNumber) : undefined),
                        lineItemId: resolvedLineItemId || undefined,
                    },
                    source: {
                        kind: 'buffer',
                        buffer: Buffer.from(fileBuffer, 'base64'),
                        originalFilename,
                        mimeType: mimeType || 'application/octet-stream',
                    },
                    persistLink: async (tx, stored) => {
                        if (resolvedLineItemId && role === "artwork") {
                            await canonicalArtworkWriteService.attachSourceArtwork({
                                tx,
                                organizationId,
                                orderId,
                                lineItemId: resolvedLineItemId,
                                fileRecordId: stored.fileRecord.id,
                                side: side as FileSide | null,
                                allocationQuantity: baseAttachmentData.productionQuantity,
                                allocationGroupId: baseAttachmentData.productionGroupId,
                                actorUserId: userId,
                            });
                        }
                        const [created] = await tx.insert(orderAttachments).values({
                            ...baseAttachmentData,
                            fileRecordId: stored.fileRecord.id,
                            fileName: stored.storedObject.originalFilename,
                            fileUrl: null,
                            fileSize: stored.storedObject.sizeBytes,
                            mimeType: stored.storedObject.mimeType,
                            thumbnailUrl: thumbnailUrl || null,
                            originalFilename: stored.storedObject.originalFilename,
                            storedFilename: stored.storedObject.storedFilename,
                            relativePath: null,
                            storageProvider: null,
                            extension: stored.storedObject.extension,
                            sizeBytes: stored.storedObject.sizeBytes,
                            checksum: stored.storedObject.checksum,
                        }).returning();
                        if (!created) throw new Error('Failed to create order file link');
                        return created;
                    },
                });
            } else if (!fileUrl) {
                throw new Error('fileUrl is required for legacy uploads');
            } else if (!(typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')))) {
                canonicalUpload = await storageApplicationService.finalizeUpload({
                    organizationId,
                    createdByUserId: userId,
                    requestedTarget,
                    resource: {
                        organizationId,
                        resourceType: 'order',
                        resourceId: orderId,
                        orderNumber: orderNumber ? String(orderNumber) : (order.orderNumber ? String(order.orderNumber) : undefined),
                        lineItemId: resolvedLineItemId || undefined,
                    },
                    source: {
                        kind: 'existing-key',
                        fileUrl: normalizeObjectKeyForDb(fileUrl),
                        originalFilename: (fileName || originalFilename) as string,
                        mimeType: mimeType || null,
                        fileSize: fileSize || null,
                    },
                    persistLink: async (tx, stored) => {
                        if (resolvedLineItemId && role === "artwork") {
                            await canonicalArtworkWriteService.attachSourceArtwork({
                                tx,
                                organizationId,
                                orderId,
                                lineItemId: resolvedLineItemId,
                                fileRecordId: stored.fileRecord.id,
                                side: side as FileSide | null,
                                allocationQuantity: baseAttachmentData.productionQuantity,
                                allocationGroupId: baseAttachmentData.productionGroupId,
                                actorUserId: userId,
                            });
                        }
                        const [created] = await tx.insert(orderAttachments).values({
                            ...baseAttachmentData,
                            fileRecordId: stored.fileRecord.id,
                            fileName: stored.storedObject.originalFilename,
                            fileUrl: null,
                            relativePath: null,
                            fileSize: stored.storedObject.sizeBytes,
                            mimeType: stored.storedObject.mimeType,
                            thumbnailUrl: null,
                            originalFilename: stored.storedObject.originalFilename,
                            storedFilename: stored.storedObject.storedFilename,
                            storageProvider: null,
                            extension: stored.storedObject.extension,
                            sizeBytes: stored.storedObject.sizeBytes,
                            checksum: stored.storedObject.checksum,
                        }).returning();
                        if (!created) throw new Error('Failed to create order file link');
                        return created;
                    },
                });
            }

            const attachment = canonicalUpload
                ? canonicalUpload.linkedRecord
                : (await db.insert(orderAttachments).values({
                    ...baseAttachmentData,
                    fileName: (fileName || originalFilename) as string,
                    fileUrl,
                    relativePath: null,
                    fileSize: fileSize || null,
                    mimeType: mimeType || null,
                    thumbnailUrl: thumbnailUrl || null,
                    storageProvider: undefined,
                    bucket: 'titan-private',
                }).returning())[0];

            if (attachment.fileRecordId) {
                void import('../workers/thumbnailWorker')
                    .then(({ triggerThumbnailGenerationForAttachment }) => {
                        triggerThumbnailGenerationForAttachment({
                            attachmentType: 'order',
                            attachmentId: String(attachment.id),
                            reason: 'order-file-upload',
                        });
                    })
                    .catch((error) => {
                        console.error('[POST /api/orders/:id/files] Failed to trigger thumbnail generation:', error);
                    });
            }

            if (resolvedLineItemId) {
                uploadStep = 'create_line_item_file_record';
                await createOriginalLineItemFileFromOrderAttachment({
                    organizationId,
                    orderId,
                    lineItemId: String(resolvedLineItemId),
                    attachment: {
                        ...attachment,
                        fileRecordId: attachment.fileRecordId ?? canonicalUpload?.fileRecord.id ?? null,
                    },
                    userId,
                });
            }

            uploadStep = 'write_order_audit_log';
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

            uploadStep = 'respond_success';
            const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
            if (resolvedLineItemId) {
                try {
                    await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                        organizationId,
                        lineItemId: String(resolvedLineItemId),
                        actorUserId: userId,
                        reason: 'artwork_saved',
                    }));
                } catch (proofSyncError) {
                    console.error('[AutoProofSync:ORDER_FILE_UPLOAD] Failed after attachment persist (non-fatal):', proofSyncError);
                }
            }
            res.json({ success: true, data: enrichedAttachment });
        } catch (error: any) {
            console.error('[POST /api/orders/:id/files] Failed', {
                step: uploadStep,
                orderId: req.params.id,
                organizationId: getRequestOrganizationId(req) ?? null,
                storageJobId: error?.storageJobId ?? null,
                error: error?.message || String(error),
                code: error?.code ?? null,
            });
            res.status(500).json({
                error: error?.message || 'Failed to attach file to order',
                step: uploadStep,
                storageJobId: error?.storageJobId ?? null,
            });
        }
    });

    app.patch('/api/orders/:orderId/files/:fileId', isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const userId = getUserId(req.user);
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
            const [order] = await db
                .select({ organizationId: orders.organizationId })
                .from(orders)
                .where(and(eq(orders.id, req.params.orderId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!order?.organizationId) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const [file] = await db
                .select({ id: orderAttachments.id })
                .from(orderAttachments)
                .where(and(eq(orderAttachments.id, req.params.fileId), eq(orderAttachments.orderId, req.params.orderId)))
                .limit(1);
            if (!file) return res.status(404).json({ error: 'File not found' });

            const { role, side, isPrimary, description } = req.body;
            const validRoles = ['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other'];
            const validSides = ['front', 'back', 'both', 'na'];

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

            if ((updated as any).orderLineItemId && userId) {
                try {
                    await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                        organizationId: String(order.organizationId),
                        lineItemId: String((updated as any).orderLineItemId),
                        actorUserId: userId,
                        reason: 'artwork_saved',
                    }));
                } catch (proofSyncError) {
                    console.error('[AutoProofSync:ORDER_FILE_UPDATE] Failed (non-fatal):', proofSyncError);
                }
            }

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
            const files = await storage.listOrderFiles(req.params.orderId);
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
                const resolvedOriginal = file.fileRecordId
                    ? await canonicalFileReadResolver.resolveOriginal(String(file.fileRecordId))
                    : null;
                const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? file.fileUrl ?? '');
                const storageProvider = resolvedOriginal?.providerType === 'local_filesystem'
                    ? 'local'
                    : resolvedOriginal?.providerType === 's3'
                        ? 's3'
                        : resolvedOriginal?.objectKey
                            ? 'supabase'
                            : ((file.storageProvider as 'local' | 's3' | 'gcs' | 'supabase' | null | undefined) ?? null);

                if (storageKey) {
                    const [{ orderRefs = 0 } = {}] = file.fileRecordId
                        ? await db
                            .select({ orderRefs: sql<number>`count(*)` })
                            .from(orderAttachments)
                            .where(eq(orderAttachments.fileRecordId, String(file.fileRecordId)))
                        : !storageProvider
                            ? [{ orderRefs: 0 }]
                            : await db
                                .select({ orderRefs: sql<number>`count(*)` })
                                .from(orderAttachments)
                                .where(
                                    and(
                                        eq(orderAttachments.fileUrl, storageKey),
                                        eq(orderAttachments.storageProvider, storageProvider)
                                    )
                                );

                    const [{ quoteRefs = 0 } = {}] = file.fileRecordId
                        ? await db
                            .select({ quoteRefs: sql<number>`count(*)` })
                            .from(quoteAttachments)
                            .where(
                                and(
                                    eq(quoteAttachments.organizationId, organizationId),
                                    eq(quoteAttachments.fileRecordId, String(file.fileRecordId))
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
                                        eq(quoteAttachments.storageProvider, storageProvider)
                                    )
                                );

                    let hasRemainingAssetLinksForFile = false;
                    try {
                        const matchingAssets = file.fileRecordId
                            ? await db
                                .select({ id: assets.id })
                                .from(assets)
                                .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(file.fileRecordId))))
                            : await db
                                .select({ id: assets.id })
                                .from(assets)
                                .where(and(eq(assets.organizationId, organizationId), eq(assets.fileKey, normalizeObjectKeyForDb(storageKey))));

                        if (matchingAssets.length > 0) {
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
                        }
                    } catch (assetRefError) {
                        console.error('[OrderFiles:DELETE] Asset reference check failed (non-blocking):', assetRefError);
                    }

                    if (Number(orderRefs) + Number(quoteRefs) === 0 && !hasRemainingAssetLinksForFile && storageProvider) {
                        const derivativeRows = file.fileRecordId
                            ? await fileDerivativeRepository.listByFileRecordId(String(file.fileRecordId))
                            : [];
                        const derivativeKeys = file.fileRecordId
                            ? derivativeRows.map((row) => row.objectKey ?? null)
                            : [file.thumbnailRelativePath ?? (file as any).thumbKey ?? null, (file as any).previewKey ?? null];

                        const derivativeDeletion = await deleteStoredObjectKeysIfUnreferenced({
                            organizationId,
                            fileRecordId: file.fileRecordId ? String(file.fileRecordId) : null,
                            legacyStorageProvider: storageProvider,
                            keys: [storageKey, ...derivativeKeys],
                            logContext: {
                                route: "order-file-delete",
                                orderId: req.params.orderId,
                                attachmentId: file.id,
                            },
                        });

                        if (file.fileRecordId && !derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0) {
                            await fileDerivativeRepository.deleteByFileRecordId(String(file.fileRecordId));
                        } else if (file.fileRecordId && (derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0)) {
                            console.warn("[OrderFiles:DELETE] Skipped derivative row cleanup due to storage delete failures", {
                                fileRecordId: String(file.fileRecordId),
                                failedKeys: derivativeDeletion.failedKeys,
                                skipped: derivativeDeletion.skipped,
                                reason: derivativeDeletion.reason ?? null,
                            });
                        }
                    }
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
    app.patch("/api/orders/:orderId/line-items/reorder", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const orderId = String(req.params.orderId);
            const payload = z.object({
                items: z.array(z.object({
                    id: z.string().min(1),
                    sortOrder: z.number().int().min(0),
                })).min(1),
            }).parse(req.body ?? {});
            const requestedIds = payload.items.map((item) => item.id);
            if (new Set(requestedIds).size !== requestedIds.length) {
                return res.status(400).json({ message: "Line item order contains duplicate IDs." });
            }

            const [order] = await db
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!order) return res.status(404).json({ message: "Order not found" });

            const activeItems = await db
                .select({ id: orderLineItems.id })
                .from(orderLineItems)
                .where(and(eq(orderLineItems.orderId, orderId), sql`lower(coalesce(${orderLineItems.status}, '')) <> 'canceled'`));
            const activeIds = new Set(activeItems.map((item) => String(item.id)));
            if (requestedIds.length !== activeIds.size || requestedIds.some((id) => !activeIds.has(id))) {
                return res.status(409).json({ message: "Line items changed while reordering. Refresh and try again." });
            }

            await db.transaction(async (tx) => {
                for (const item of payload.items) {
                    await tx
                        .update(orderLineItems)
                        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
                        .where(and(eq(orderLineItems.id, item.id), eq(orderLineItems.orderId, orderId)));
                }
            });

            return res.json({ success: true, items: payload.items });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: fromZodError(error).message });
            }
            console.error("[ORDER_LINE_ITEM_REORDER] Error:", error);
            return res.status(500).json({ message: "Failed to reorder order line items." });
        }
    });

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
                ...enrichLineItemWithEffectivePricing(li),
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

            res.json({ ...enrichLineItemWithEffectivePricing(lineItem as any), pbv2ActiveTreeVersionId: productRow?.pbv2ActiveTreeVersionId ? String(productRow.pbv2ActiveTreeVersionId) : null, components });
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch order line item" });
        }
    });

    app.get("/api/orders/:orderId/line-items/:lineItemId/design-brief", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const detail = await getLineItemDesignBriefDetail({
                organizationId,
                orderId: String(req.params.orderId),
                orderLineItemId: String(req.params.lineItemId),
            });

            if (!detail) {
                return res.status(404).json({ message: "Order line item not found" });
            }

            return res.json({ success: true, data: detail });
        } catch (error) {
            console.error("[LINE_ITEM_DESIGN_BRIEF_GET] Error:", error);
            return res.status(500).json({ message: "Failed to fetch line item design brief" });
        }
    });

    app.put("/api/orders/:orderId/line-items/:lineItemId/design-brief", isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user) ?? null;
            const parsed = updateLineItemDesignBriefSchema.parse(req.body ?? {});

            const detail = await upsertLineItemDesignBrief({
                organizationId,
                orderId: String(req.params.orderId),
                orderLineItemId: String(req.params.lineItemId),
                userId,
                values: parsed,
            });

            if (!detail) {
                return res.status(404).json({ message: "Order line item not found" });
            }

            return res.json({ success: true, data: detail, message: "Design brief saved" });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            console.error("[LINE_ITEM_DESIGN_BRIEF_PUT] Error:", error);
            return res.status(500).json({ message: "Failed to save line item design brief" });
        }
    });

    app.post("/api/order-line-items", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const parsed = insertOrderLineItemSchema.parse(req.body);
            
            // Server-authoritative: ignore any client-supplied pbv2 or price fields
            const {
                pbv2ExplicitSelections,
                pbv2Env,
                duplicateSourceLineItemId,
                pbv2TreeVersionId: _ignoredTreeVersionId,
                pbv2SnapshotJson: _ignoredSnapshot,
                pricedAt: _ignoredPricedAt,
                unitPrice: _ignoredUnitPrice,
                totalPrice: _ignoredTotalPrice,
                workflowState: _ignoredWorkflowState,
                status: _ignoredStatus,
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
                .select({
                    id: orders.id,
                    customerId: orders.customerId,
                    state: orders.state,
                    status: orders.status,
                    canceledAt: orders.canceledAt,
                })
                .from(orders)
                .where(and(eq(orders.id, String(lineItemData.orderId)), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!order) return res.status(404).json({ message: "Order not found" });
            if (isCanceledOrder(order)) {
                return res.status(409).json({ message: "Cannot add line items to a cancelled order.", code: "ORDER_CANCELLED" });
            }
            if (lineItemData.parentLineItemId) {
                const [parent] = await db.select({ id: orderLineItems.id, lineItemRole: orderLineItems.lineItemRole })
                    .from(orderLineItems)
                    .where(and(eq(orderLineItems.id, String(lineItemData.parentLineItemId)), eq(orderLineItems.orderId, String(order.id))))
                    .limit(1);
                if (!parent || parent.lineItemRole === "child") {
                    return res.status(400).json({ message: "Child items must belong to a parent line item on this order." });
                }
                lineItemData.lineItemRole = "child";
            }

            if (duplicateSourceLineItemId) {
                const [sourceLineItem] = await db
                    .select({ id: orderLineItems.id })
                    .from(orderLineItems)
                    .where(and(
                        eq(orderLineItems.id, String(duplicateSourceLineItemId)),
                        eq(orderLineItems.orderId, String(lineItemData.orderId)),
                    ))
                    .limit(1);
                if (!sourceLineItem) {
                    return res.status(404).json({
                        message: "The source line item could not be found on this order.",
                        code: "DUPLICATE_SOURCE_NOT_FOUND",
                    });
                }
            }

            // Server-authoritative pricing using PricingService
            const { priceLineItem } = await import("../services/pricing/PricingService");
            const userId = getUserId(req.user);
            const productForMeasurement = await storage.getProductById(organizationId, String(lineItemData.productId));
            if (!productForMeasurement) return res.status(404).json({ message: "Product not found" });
            const nonDimensionalProduct = productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee";
            const pricingDimensions = nonDimensionalProduct
                ? { widthIn: 1, heightIn: 1 }
                : dimensionsForProductPricing(productForMeasurement, lineItemData.width, lineItemData.height);
            if (!Number.isFinite(pricingDimensions.widthIn) || pricingDimensions.widthIn <= 0 || !Number.isFinite(pricingDimensions.heightIn) || pricingDimensions.heightIn <= 0) {
                return res.status(400).json({ message: "width and height must be positive for this product" });
            }

            // Quantity-only pricing uses neutral geometry internally, but a line item
            // must not persist that implementation detail as a fictional 1 x 1 size.
            lineItemData.width = nonDimensionalProduct ? 0 : pricingDimensions.widthIn;
            lineItemData.height = nonDimensionalProduct ? 0 : pricingDimensions.heightIn;
            
            const pricingResult = await priceLineItem({
                organizationId,
                productId: lineItemData.productId,
                quantity: Number(lineItemData.quantity),
                widthIn: pricingDimensions.widthIn,
                heightIn: pricingDimensions.heightIn,
                pbv2ExplicitSelections: pbv2ExplicitSelections || lineItemData.optionSelectionsJson?.selected || {},
                pbv2TreeVersionIdOverride: undefined, // Always use active tree
            });

            // Structured logging for PBV2 pricing persistence
            console.log(`[PBV2_PRICE_PERSIST] orderId=${lineItemData.orderId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

            const effectivePricing = resolvePersistedLineItemPricing({
                baseCalculatedTotalCents: pricingResult.lineTotalCents,
                quantity: Number(lineItemData.quantity),
                body: req.body,
                specsJson: lineItemData.specsJson,
                legacyOverridePriceCents: (req.body as any)?.overridePriceCents,
            });
            const specsJsonWithPricing = mergePricingIntoSpecsJson({
                specsJson: lineItemData.specsJson,
                pricing: effectivePricing,
            });

            // If the client didn't explicitly send requiresDesign, pass null so
            // materializeLineItemDesignSnapshot falls back to the product's design config
            // rather than treating Zod's default(false) as an intentional override.
            const requestedRequiresDesignOverride = getClientBooleanOverride(req.body, "requiresDesign");
            const requestedRequiresPrepressOverride = getClientBooleanOverride(req.body, "requiresPrepress");
            const requestedRequiresProofApprovalOverride = getClientBooleanOverride(req.body, "requiresProofApproval");

            const designSnapshot = materializeLineItemDesignSnapshot({
                config: await productDesignConfigRepository.getByProductId(organizationId, String(lineItemData.productId)),
                requestedNeedsDesignOverride: Object.prototype.hasOwnProperty.call(lineItemData, 'needsDesignOverride')
                    ? ((lineItemData as any).needsDesignOverride ?? null)
                    : undefined,
                requestedEffectiveRequiresDesign: requestedRequiresDesignOverride,
            });

            const routing = await resolveEffectiveLineItemRouting({
                organizationId,
                productId: String(lineItemData.productId),
                requestedRequiresDesign: requestedRequiresDesignOverride,
                designDefaultRequiresDesign: designSnapshot.effectiveRequiresDesign,
                requestedRequiresPrepress: requestedRequiresPrepressOverride,
                requestedRequiresProofApproval: requestedRequiresProofApprovalOverride,
            });
            // A service fee is not design work by default. Preserve an explicit
            // line-level design override, but do not carry a product's unrelated
            // design configuration into a normal billing-only line snapshot.
            const persistedDesignSnapshot = routing.isServiceFee && !routing.requiresDesign
                ? {
                    ...designSnapshot,
                    requiresDesignSnapshot: false,
                    designBriefRequiredSnapshot: false,
                    designPricingModeSnapshot: "none" as const,
                    flatFeeAmountSnapshot: null,
                    hourlyRateSnapshot: null,
                    overageRateSnapshot: null,
                    internalLaborRateSnapshot: null,
                    needsDesignOverride: null,
                    effectiveRequiresDesign: false,
                }
                : designSnapshot;

            // Persist the line item, its financial rollup, invoice snapshot, and
            // billing state as one unit. A failed response must never leave a
            // successful add/delete visible only after reopening the Order.
            const created = await db.transaction(async (tx) => {
              const createdLineItem = await new OrdersRepository(tx).createOrderLineItem({
                ...lineItemData,
                ...(pricingResult.pbv2TreeVersionId
                    ? {
                        optionSelectionsJson: {
                            schemaVersion: 2,
                            selected: pricingResult.pbv2SnapshotJson.selections || {},
                            resolved: {
                                visibleNodeIds: pricingResult.pbv2SnapshotJson.visibleNodeIds || [],
                            },
                        },
                    }
                    : {}),
                selectedOptions: pricingResult.pbv2SnapshotJson.selectedOptions || [],
                status: "new",
                workflowState: routing.workflowState,
                requiresDesignSnapshot: persistedDesignSnapshot.requiresDesignSnapshot,
                designBriefRequiredSnapshot: persistedDesignSnapshot.designBriefRequiredSnapshot,
                estimatedDesignMinutesSnapshot: persistedDesignSnapshot.estimatedDesignMinutesSnapshot,
                includedDesignMinutesSnapshot: persistedDesignSnapshot.includedDesignMinutesSnapshot,
                designPricingModeSnapshot: persistedDesignSnapshot.designPricingModeSnapshot,
                flatFeeAmountSnapshot: persistedDesignSnapshot.flatFeeAmountSnapshot,
                hourlyRateSnapshot: persistedDesignSnapshot.hourlyRateSnapshot,
                overageRateSnapshot: persistedDesignSnapshot.overageRateSnapshot,
                internalLaborRateSnapshot: persistedDesignSnapshot.internalLaborRateSnapshot,
                needsDesignOverride: persistedDesignSnapshot.needsDesignOverride,
                requiresDesign: routing.requiresDesign,
                requiresProofApproval: routing.requiresProofApproval,
                requiresPrepress: routing.requiresPrepress,
                pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
                pbv2SnapshotJson: pricingResult.pbv2SnapshotJson as any,
                pricedAt: new Date(),
                specsJson: specsJsonWithPricing,
                overridePriceCents: effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null,
                overrideAt: effectivePricing.hasPriceOverride ? new Date() : null,
                overrideByUserId: effectivePricing.hasPriceOverride ? (userId ?? null) : null,
                unitPrice: effectivePricing.effectiveUnitPriceCents / 100,
                totalPrice: effectivePricing.effectiveTotalCents / 100,
              });

              if (lineItemData.parentLineItemId) {
                const [parent] = await tx.select().from(orderLineItems).where(eq(orderLineItems.id, String(lineItemData.parentLineItemId))).limit(1);
                if (parent?.lineItemRole === "parent") {
                    await recalculateOrderBundleParent(parent.id, tx);
                }
              }
              await recalculateEditableOrderFinancialsInTransaction(tx, {
                organizationId,
                orderId: String(createdLineItem.orderId),
                actorUserId: userId ?? null,
              });
              await recomputeOrderBillingStatus({ organizationId, orderId: String(createdLineItem.orderId), executor: tx });
              if (routing.proofApprovalManualOverride) {
                await createProofApprovalManualOverrideAuditLog({
                  organizationId,
                  userId,
                  userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                  entityType: "order_line_item",
                  entityId: String(createdLineItem.id),
                  entityName: (createdLineItem as any).description ?? null,
                  executor: tx,
                });
              }
              return createdLineItem;
            });

            // Auto-schedule production job if the product type has sendToProductionDefault=true.
            // Fail-soft: scheduling failure does not block the line item create response.
            try {
                const [ptRow] = await db
                    .select({ sendToProductionDefault: productTypes.sendToProductionDefault })
                    .from(products)
                    .innerJoin(productTypes, eq(products.productTypeId, productTypes.id))
                    .where(eq(products.id, String(created.productId)))
                    .limit(1);

                if (shouldAutoScheduleCreatedOrderLineItem({
                    duplicateSourceLineItemId,
                    isServiceFee: routing.isServiceFee,
                    sendToProductionDefault: ptRow?.sendToProductionDefault === true,
                    workflowState: created.workflowState,
                })) {
                    const { scheduleOrderLineItemsForProduction } = await import('../services/productionScheduling');
                    const { loadProductionLineItemStatusRulesForOrganization, appendEvent } = await import('../productionHelpers');
                    const scheduleResult = await scheduleOrderLineItemsForProduction({
                        organizationId,
                        orderId: String(created.orderId),
                        lineItemIds: [created.id],
                        loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
                        appendEvent,
                    });
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`[AutoProductionSchedule:CREATE] lineItemId=${created.id} productId=${created.productId} sendToProductionDefault=true → auto-scheduled:`, scheduleResult.data);
                    }
                }
            } catch (autoScheduleErr: any) {
                console.error('[AutoProductionSchedule:CREATE] Failed (non-fatal):', autoScheduleErr?.message ?? autoScheduleErr);
            }

            if (userId) {
                try {
                    await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                        organizationId,
                        lineItemId: String(created.id),
                        actorUserId: userId,
                        reason: 'line_item_saved',
                    }));
                } catch (proofSyncError) {
                    console.error('[AutoProofSync:LINE_ITEM_CREATE] Failed (non-fatal):', proofSyncError);
                }
            }

            res.json(enrichLineItemWithEffectivePricing(created as any));
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            if ((error as any)?.code === 'PBV2_FORMULA_ERROR') {
                return res.status(422).json({
                    message: (error as any).message,
                    code: 'PBV2_FORMULA_ERROR',
                    details: (error as any).details ?? [],
                    debug: (error as any).debug,
                });
            }
            if ((error as any)?.code === 'PRODUCT_PRICE_NOT_CONFIGURED') {
                return res.status(422).json({ message: (error as any).message, code: 'PRODUCT_PRICE_NOT_CONFIGURED' });
            }
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            console.error('[ORDER_LINE_ITEM_CREATE] Error:', error);
            res.status(500).json({
                message: (req.body as any)?.duplicateSourceLineItemId
                    ? "Unable to duplicate this line item. Its saved product or option configuration could not be recreated."
                    : "Failed to create order line item",
            });
        }
    });

    app.post("/api/order-line-items/:id/production-bypass", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            if (req.user?.accountType === "PORTAL_CUSTOMER" || req.user?.role === "customer") {
                return res.status(403).json({ success: false, message: "Customer portal users cannot bypass production." });
            }
            const parsed = z.object({ reason: z.string().trim().min(3, "A production bypass reason is required.").max(2000) }).safeParse(req.body ?? {});
            if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "A production bypass reason is required." });
            const userId = getUserId(req.user) ?? null;
            const [lineItem] = await db.select({
                id: orderLineItems.id,
                orderId: orderLineItems.orderId,
                productName: orderLineItems.description,
                productionBypassed: orderLineItems.productionBypassed,
                lineItemRole: orderLineItems.lineItemRole,
            }).from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, String(req.params.id)), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!lineItem) return res.status(404).json({ success: false, message: "Order line item not found" });

            const now = new Date();
            const groupCondition = lineItem.lineItemRole === "parent"
                ? or(eq(orderLineItems.id, lineItem.id), eq(orderLineItems.parentLineItemId, lineItem.id))
                : eq(orderLineItems.id, lineItem.id);
            const updated = await db.transaction(async (tx) => tx.update(orderLineItems).set({
                productionBypassed: true,
                productionBypassReason: parsed.data.reason,
                productionBypassedByUserId: userId,
                productionBypassedAt: now,
                requiresDesign: false,
                requiresPrepress: false,
                requiresProofApproval: false,
                workflowState: "no_production_required" as any,
                updatedAt: now,
            }).where(and(eq(orderLineItems.orderId, lineItem.orderId), groupCondition)).returning());

            await db.insert(auditLogs).values({
                organizationId,
                userId,
                actionType: "ORDER_LINE_ITEM_PRODUCTION_BYPASSED",
                entityType: "order_line_item",
                entityId: lineItem.id,
                entityName: lineItem.productName ?? null,
                description: `Production bypassed for ${lineItem.lineItemRole === "parent" ? "order line item group" : "order line item"}: ${parsed.data.reason}`,
                newValues: {
                    reason: parsed.data.reason,
                    previousBypassed: lineItem.productionBypassed === true,
                    groupedChildCount: Math.max(0, updated.length - 1),
                },
            } as any);
            await recomputeOrderBillingStatus({ organizationId, orderId: lineItem.orderId });
            const updatedParent = updated.find((item) => item.id === lineItem.id) ?? updated[0];
            return res.json({ success: true, data: enrichLineItemWithEffectivePricing(updatedParent as any), groupedChildCount: Math.max(0, updated.length - 1) });
        } catch (error: any) {
            return res.status(error?.statusCode ?? 500).json({ success: false, message: error?.message ?? "Failed to bypass production" });
        }
    });

    app.patch("/api/order-line-items/:id/parent", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const { parentLineItemId } = z.object({ parentLineItemId: z.string().min(1).nullable() }).parse(req.body ?? {});
            const childId = String(req.params.id);
            const [ownership] = await db.select({ orderId: orderLineItems.orderId, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
                .from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, childId), eq(orders.organizationId, organizationId))).limit(1);
            if (!ownership) return res.status(404).json({ success: false, message: "Order line item not found" });
            if (isCanceledOrder({ state: ownership.state, status: ownership.status, canceledAt: ownership.canceledAt })) {
                return res.status(409).json({ success: false, message: "Cannot edit line items on a cancelled order." });
            }
            const lines = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, ownership.orderId));
            assertValidParentLink(lines as any, childId, parentLineItemId);
            const child = lines.find((line) => line.id === childId)!;
            const priorParentId = child.parentLineItemId ? String(child.parentLineItemId) : null;
            if (priorParentId === parentLineItemId) return res.json({ success: true, data: enrichLineItemWithEffectivePricing(child as any) });
            const [updated] = await db.update(orderLineItems).set({
                parentLineItemId,
                lineItemRole: parentLineItemId ? "child" : "standalone",
                updatedAt: new Date(),
            }).where(eq(orderLineItems.id, childId)).returning();
            for (const parentId of [priorParentId, parentLineItemId].filter((id): id is string => Boolean(id))) {
                await recalculateOrderBundleParent(parentId);
            }
            await recomputeOrderTotalsFromPersistedLineItems(String(ownership.orderId), organizationId, getUserId(req.user) ?? null);
            await recomputeOrderBillingStatus({ organizationId, orderId: String(ownership.orderId) });
            await db.insert(auditLogs).values({
                organizationId, userId: getUserId(req.user) ?? null,
                actionType: parentLineItemId ? "ORDER_LINE_ITEM_PARENT_LINKED" : "ORDER_LINE_ITEM_PARENT_UNLINKED",
                entityType: "order_line_item", entityId: childId, entityName: child.description ?? null,
                description: parentLineItemId ? "Order line item linked to a parent line item." : "Order line item unlinked from its parent.",
                newValues: { parentLineItemId }, oldValues: { parentLineItemId: priorParentId },
            } as any);
            return res.json({ success: true, data: enrichLineItemWithEffectivePricing(updated as any) });
        } catch (error: any) {
            return res.status(error?.statusCode ?? 400).json({ success: false, message: error?.message ?? "Failed to update line item parent" });
        }
    });

    // Commercial corrections deliberately use a narrow endpoint. The normal
    // line-item editor submits a broad product/routing payload, so reusing it
    // after production completion would risk rewriting operational history.
    app.patch("/api/order-line-items/:id/commercial-pricing", isAuthenticated, tenantContext, requireOrderLineItemAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const payload = z.object({
                priceOverrideMode: z.enum([
                    "override_total_after_margin",
                    "override_unit_after_margin",
                    "override_total_before_margin",
                    "override_unit_before_margin",
                    "apply_discount",
                    "append_value",
                ]).nullable(),
                priceOverrideValueCents: z.number().int().min(0).nullable().optional(),
                priceOverrideValuePercent: z.number().min(0).max(100).nullable().optional(),
            }).strict().parse(req.body ?? {});
            const lineItemId = String(req.params.id);
            const userId = getUserId(req.user) ?? null;

            const [ownership] = await db
                .select({
                    orderId: orderLineItems.orderId,
                    orderState: orders.state,
                    orderStatus: orders.status,
                    orderCanceledAt: orders.canceledAt,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!ownership) return res.status(404).json({ message: "Order line item not found" });
            if (!isOrderCommerciallyEditable({ state: ownership.orderState, status: ownership.orderStatus, canceledAt: ownership.orderCanceledAt })) {
                return res.status(409).json({ message: "Cannot correct pricing on a cancelled or voided order.", code: "ORDER_COMMERCIAL_EDIT_LOCKED" });
            }

            const oldLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!oldLineItem) return res.status(404).json({ message: "Order line item not found" });
            if (!isLineItemCommerciallyEditable(oldLineItem)) {
                return res.status(409).json({ message: "Cannot correct pricing on a cancelled or voided line item.", code: "LINE_ITEM_COMMERCIAL_EDIT_LOCKED" });
            }

            const baseCalculatedTotalCents = getPersistedBaseCalculatedTotalCents(oldLineItem as any);
            const pricing = resolvePersistedLineItemPricing({
                baseCalculatedTotalCents,
                quantity: (oldLineItem as any).quantity,
                body: {
                    ...payload,
                    // The resolver recognizes an explicit null as a clear. For
                    // a new override the mode/value are authoritative; this
                    // compatibility value is only a fallback for old records.
                    overridePriceCents: payload.priceOverrideMode === null
                        ? null
                        : (oldLineItem as any).overridePriceCents,
                },
                specsJson: (oldLineItem as any).specsJson,
                legacyOverridePriceCents: (oldLineItem as any).overridePriceCents,
            });

            const [lineItem] = await db
                .update(orderLineItems)
                .set({
                    specsJson: mergePricingIntoSpecsJson({ specsJson: (oldLineItem as any).specsJson, pricing }),
                    overridePriceCents: pricing.hasPriceOverride ? pricing.effectiveTotalCents : null,
                    overrideAt: pricing.hasPriceOverride ? new Date() : null,
                    overrideByUserId: pricing.hasPriceOverride ? userId : null,
                    unitPrice: (pricing.effectiveUnitPriceCents / 100).toFixed(2),
                    totalPrice: (pricing.effectiveTotalCents / 100).toFixed(2),
                    updatedAt: new Date(),
                })
                .where(eq(orderLineItems.id, lineItemId))
                .returning();
            if (!lineItem) return res.status(404).json({ message: "Order line item not found" });

            await recomputeOrderTotalsFromPersistedLineItems(String(lineItem.orderId), organizationId, userId);
            await recomputeOrderBillingStatus({ organizationId, orderId: String(lineItem.orderId) });

            const oldTotalCents = Math.round(Number((oldLineItem as any).totalPrice ?? 0) * 100);
            await storage.createOrderAuditLog({
                orderId: lineItem.orderId,
                orderLineItemId: lineItem.id,
                userId,
                userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
                actionType: "line_item.commercial_pricing_corrected",
                fromStatus: null,
                toStatus: null,
                note: "Commercial pricing correction applied without changing production routing.",
                metadata: {
                    structuredEvent: {
                        eventType: "line_item.commercial_pricing_corrected",
                        entityType: "order_line_item",
                        entityId: lineItem.id,
                        fieldKey: "totalPriceCents",
                        fromValue: oldTotalCents,
                        toValue: pricing.effectiveTotalCents,
                        actorUserId: userId,
                        createdAt: new Date().toISOString(),
                        metadata: { orderId: lineItem.orderId, priceOverrideMode: pricing.priceOverrideMode },
                    },
                },
            });

            return res.json(enrichLineItemWithEffectivePricing(lineItem as any));
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            console.error("[OrderCommercialPricing] Failed", error);
            return res.status(500).json({ message: "Failed to correct line item pricing" });
        }
    });

    app.patch("/api/order-line-items/:id", isAuthenticated, tenantContext, requireOrderLineItemAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

            const userId = getUserId(req.user);
            const parsed = updateOrderLineItemSchema.parse({ ...(req.body as any), id: req.params.id });
            const { pbv2ExplicitSelections, pbv2Env, ...lineItemData } = parsed as any;
            const {
                id,
                workflowState: _ignoredWorkflowState,
                ...updateData
            } = lineItemData;

            void pbv2ExplicitSelections;
            void pbv2Env;

            const lineItemId = String(req.params.id);
            const [ownership] = await db
                .select({
                    id: orderLineItems.id,
                    orderState: orders.state,
                    orderStatus: orders.status,
                    orderCanceledAt: orders.canceledAt,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);
            if (!ownership) return res.status(404).json({ message: "Order line item not found" });
            if (isCanceledOrder({ state: ownership.orderState, status: ownership.orderStatus, canceledAt: ownership.orderCanceledAt })) {
                return res.status(409).json({ message: "Cannot edit line items on a cancelled order.", code: "ORDER_CANCELLED" });
            }

            const oldLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!oldLineItem) return res.status(404).json({ message: "Order line item not found" });

            const oldLineItemStatus = String((oldLineItem as any).status || "").trim().toLowerCase();
            const oldLineItemWorkflowState = String((oldLineItem as any).workflowState || "new").trim().toLowerCase();
            if (LINE_ITEM_EDIT_LOCKED_STATES.has(oldLineItemStatus) || LINE_ITEM_EDIT_LOCKED_STATES.has(oldLineItemWorkflowState)) {
                return res.status(409).json({
                    message: "Completed or cancelled line items are locked for editing.",
                    code: "LINE_ITEM_EDIT_LOCKED",
                });
            }

            const activeJob = await findActiveJobForLineItem(db, {
                organizationId,
                lineItemId,
            });
            const isActiveOperationalEdit =
                Boolean(activeJob) ||
                ACTIVE_LINE_ITEM_EDIT_WARNING_STATES.has(oldLineItemStatus) ||
                ACTIVE_LINE_ITEM_EDIT_WARNING_STATES.has(oldLineItemWorkflowState);
            const submittedFields = Object.keys(updateData).filter((field) => updateData[field] !== undefined);
            const requestedRequiresDesign = updateData.requiresDesign;
            const requestedRequiresPrepress = updateData.requiresPrepress;
            const requestedRequiresProofApproval = updateData.requiresProofApproval;
            const shouldReconcileProofGateRemoval =
                requestedRequiresProofApproval === false &&
                oldLineItemWorkflowState === "awaiting_proof_approval";
            const hasRoutingChange =
                updateData.productId !== undefined ||
                (typeof requestedRequiresDesign === "boolean" && requestedRequiresDesign !== Boolean((oldLineItem as any).requiresDesign)) ||
                (typeof requestedRequiresPrepress === "boolean" && requestedRequiresPrepress !== Boolean((oldLineItem as any).requiresPrepress)) ||
                (typeof requestedRequiresProofApproval === "boolean" && requestedRequiresProofApproval !== Boolean((oldLineItem as any).requiresProofApproval));
            let proofApprovalManualOverride = false;

            if (hasRoutingChange) {
                if (!canEditLineItemRouting({
                    workflowState: (oldLineItem as any).workflowState,
                    hasActiveJob: Boolean(activeJob),
                })) {
                    throw Object.assign(
                        new Error("Cannot change Design/Prepress routing after active workflow has started. Use workflow transitions instead."),
                        { statusCode: 409 },
                    );
                }

                const routing = await resolveEffectiveLineItemRouting({
                    organizationId,
                    productId: String(updateData.productId ?? oldLineItem.productId),
                    requestedRequiresDesign: typeof requestedRequiresDesign === "boolean" ? requestedRequiresDesign : Boolean((oldLineItem as any).requiresDesign),
                    requestedRequiresPrepress: typeof requestedRequiresPrepress === "boolean" ? requestedRequiresPrepress : Boolean((oldLineItem as any).requiresPrepress),
                    requestedRequiresProofApproval: typeof requestedRequiresProofApproval === "boolean" ? requestedRequiresProofApproval : Boolean((oldLineItem as any).requiresProofApproval),
                });
                proofApprovalManualOverride =
                    routing.proofApprovalManualOverride &&
                    (Boolean((oldLineItem as any).requiresProofApproval) || updateData.productId !== undefined);

                const snapshotRequiresDesign = Boolean((oldLineItem as any).requiresDesignSnapshot);
                updateData.needsDesignOverride = routing.requiresDesign === snapshotRequiresDesign
                    ? null
                    : routing.requiresDesign;

                updateData.requiresDesign = routing.requiresDesign;
                updateData.requiresProofApproval = routing.requiresProofApproval;
                updateData.requiresPrepress = routing.requiresPrepress;
                if (!isActiveOperationalEdit) {
                    updateData.workflowState = routing.workflowState;
                    updateData.status = "new";
                }
            }

            if (isActiveOperationalEdit && submittedFields.length > 0) {
                const currentSpecs = updateData.specsJson && typeof updateData.specsJson === "object" && !Array.isArray(updateData.specsJson)
                    ? updateData.specsJson
                    : ((oldLineItem as any).specsJson && typeof (oldLineItem as any).specsJson === "object" && !Array.isArray((oldLineItem as any).specsJson)
                        ? (oldLineItem as any).specsJson
                        : {});
                updateData.specsJson = {
                    ...currentSpecs,
                    flags: {
                        ...((currentSpecs as any).flags || {}),
                        production_change_warning: {
                            at: new Date().toISOString(),
                            actorUserId: userId,
                            changedFields: submittedFields,
                            workflowState: oldLineItemWorkflowState,
                            productionJobId: activeJob?.id ?? null,
                        },
                    },
                };
            }

            // Server-authoritative: detect actual pricing-driver changes, not merely
            // full edit-form payloads that repeat persisted product/dimension/options.
            const pricingFieldsChanged = haveLineItemPricingDriversChanged({
                existingLineItem: oldLineItem as any,
                incomingUpdate: updateData as any,
                pbv2ExplicitSelections,
            });
            const overrideFieldsChanged =
                Object.prototype.hasOwnProperty.call(req.body ?? {}, "overridePriceCents") ||
                Object.prototype.hasOwnProperty.call(req.body ?? {}, "priceOverride") ||
                Object.prototype.hasOwnProperty.call(req.body ?? {}, "priceOverrideMode") ||
                Object.prototype.hasOwnProperty.call(req.body ?? {}, "priceOverrideValueCents") ||
                Object.prototype.hasOwnProperty.call(req.body ?? {}, "priceOverrideValuePercent");

            if (!pricingFieldsChanged) {
                const incomingSnapshotTotalCents = Number((updateData as any)?.pbv2SnapshotJson?.pricing?.totalCents);
                const persistedBaseCalculatedTotalCents = getPersistedBaseCalculatedTotalCents(oldLineItem as any);
                if (
                    Number.isFinite(incomingSnapshotTotalCents) &&
                    Math.round(incomingSnapshotTotalCents) !== persistedBaseCalculatedTotalCents &&
                    process.env.NODE_ENV === "development"
                ) {
                    console.warn("[ORDER_LINE_ITEM_UPDATE] Ignoring client PBV2 preview base because pricing drivers are unchanged", {
                        lineItemId,
                        incomingSnapshotTotalCents: Math.round(incomingSnapshotTotalCents),
                        persistedBaseCalculatedTotalCents,
                    });
                }
                delete (updateData as any).pbv2TreeVersionId;
                delete (updateData as any).pbv2SnapshotJson;
                delete (updateData as any).pricedAt;
            }

            if (!pricingFieldsChanged && !overrideFieldsChanged) {
                delete (updateData as any).unitPrice;
                delete (updateData as any).totalPrice;
                delete (updateData as any).overridePriceCents;
            }

            let latestBaseCalculatedTotalCents: number | null = null;
            if (pricingFieldsChanged) {
                // Reprice using PricingService
                const { priceLineItem } = await import("../services/pricing/PricingService");
                const productChangedForPricing =
                    updateData.productId !== undefined &&
                    String(updateData.productId) !== String(oldLineItem.productId);
                const effectivePbv2Selections =
                    pbv2ExplicitSelections ||
                    updateData.optionSelectionsJson?.selected ||
                    (productChangedForPricing ? {} : ((oldLineItem as any).optionSelectionsJson?.selected || {}));
                const pricingProductId = String(updateData.productId ?? oldLineItem.productId);
                const productForMeasurement = await storage.getProductById(organizationId, pricingProductId);
                if (!productForMeasurement) return res.status(404).json({ message: "Product not found" });
                const nonDimensionalProduct = productForMeasurement.measurementMode === "quantity_only" || productForMeasurement.pricingProfileKey === "fee";
                const pricingDimensions = nonDimensionalProduct
                    ? { widthIn: 1, heightIn: 1 }
                    : dimensionsForProductPricing(
                        productForMeasurement,
                        updateData.width !== undefined ? updateData.width : oldLineItem.width,
                        updateData.height !== undefined ? updateData.height : oldLineItem.height,
                    );
                if (!Number.isFinite(pricingDimensions.widthIn) || pricingDimensions.widthIn <= 0 || !Number.isFinite(pricingDimensions.heightIn) || pricingDimensions.heightIn <= 0) {
                    return res.status(400).json({ message: "width and height must be positive for this product" });
                }
                if (nonDimensionalProduct) {
                    updateData.width = 0;
                    updateData.height = 0;
                }
                
                const pricingResult = await priceLineItem({
                    organizationId,
                    productId: pricingProductId,
                    quantity: updateData.quantity !== undefined ? Number(updateData.quantity) : oldLineItem.quantity,
                    widthIn: pricingDimensions.widthIn,
                    heightIn: pricingDimensions.heightIn,
                    pbv2ExplicitSelections: effectivePbv2Selections,
                    pbv2TreeVersionIdOverride: undefined, // Always reprice with active tree
                });

                // Structured logging for PBV2 repricing
                console.log(`[PBV2_PRICE_PERSIST] orderId=${oldLineItem.orderId} lineItemId=${lineItemId} treeVersionId=${pricingResult.pbv2TreeVersionId} totalCents=${pricingResult.lineTotalCents} pricedAt=${new Date().toISOString()}`);

                // Set server-authoritative PBV2 fields
                updateData.pbv2TreeVersionId = pricingResult.pbv2TreeVersionId;
                updateData.pbv2SnapshotJson = pricingResult.pbv2SnapshotJson as any;
                if (pricingResult.pbv2TreeVersionId) {
                    updateData.optionSelectionsJson = {
                        schemaVersion: 2,
                        selected: pricingResult.pbv2SnapshotJson.selections || {},
                        resolved: {
                            visibleNodeIds: pricingResult.pbv2SnapshotJson.visibleNodeIds || [],
                        },
                    };
                }
                updateData.selectedOptions = pricingResult.pbv2SnapshotJson.selectedOptions || [];
                updateData.pricedAt = new Date();
                latestBaseCalculatedTotalCents = pricingResult.lineTotalCents;
            }

            if (pricingFieldsChanged || overrideFieldsChanged) {
                const previousSpecs = (oldLineItem as any).specsJson && typeof (oldLineItem as any).specsJson === "object"
                    ? (oldLineItem as any).specsJson
                    : {};
                const baseCalculatedTotalCents = latestBaseCalculatedTotalCents
                    ?? getPersistedBaseCalculatedTotalCents(oldLineItem as any);
                const quantityForPricing = Number(updateData.quantity ?? oldLineItem.quantity);
                const effectivePricing = resolvePersistedLineItemPricing({
                    baseCalculatedTotalCents,
                    quantity: quantityForPricing,
                    body: overrideFieldsChanged ? req.body : undefined,
                    specsJson: overrideFieldsChanged ? updateData.specsJson : previousSpecs,
                    legacyOverridePriceCents: overrideFieldsChanged
                        ? (req.body as any)?.overridePriceCents
                        : (oldLineItem as any).overridePriceCents,
                });

                updateData.specsJson = mergePricingIntoSpecsJson({
                    specsJson: updateData.specsJson ?? previousSpecs,
                    pricing: effectivePricing,
                });
                updateData.overridePriceCents = effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null;
                updateData.overrideAt = effectivePricing.hasPriceOverride
                    ? ((oldLineItem as any).overrideAt ?? new Date())
                    : null;
                updateData.overrideByUserId = effectivePricing.hasPriceOverride
                    ? ((oldLineItem as any).overrideByUserId ?? userId ?? null)
                    : null;
                updateData.unitPrice = (effectivePricing.effectiveUnitPriceCents / 100).toFixed(2);
                updateData.totalPrice = (effectivePricing.effectiveTotalCents / 100).toFixed(2);
            }

            const lineItem = shouldReconcileProofGateRemoval
                ? await db.transaction(async (tx) => {
                    await tx
                        .update(orderLineItems)
                        .set({ ...updateData, updatedAt: new Date() })
                        .where(eq(orderLineItems.id, lineItemId));
                    await reconcileLineItemProofGateRelease(tx, {
                        organizationId,
                        lineItemId,
                        actorUserId: userId ?? null,
                        source: "order_line_item_edit:proof_requirement_removed",
                    });
                    const [reconciled] = await tx
                        .select()
                        .from(orderLineItems)
                        .where(eq(orderLineItems.id, lineItemId))
                        .limit(1);
                    if (!reconciled) throw new Error("Order line item not found after proof-gate reconciliation");
                    return reconciled;
                })
                : await storage.updateOrderLineItem(lineItemId, updateData);
            const quantityChanged =
                updateData.quantity !== undefined &&
                Number((oldLineItem as any).quantity) !== Number((lineItem as any).quantity);
            const finalArtworkSynchronization = quantityChanged
                ? await synchronizeFinalArtworkForLineQuantityChange({
                    organizationId,
                    lineItemId,
                    previousLineQuantity: (oldLineItem as any).quantity,
                    actorUserId: userId ?? null,
                    actorName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || null,
                })
                : null;

            if (proofApprovalManualOverride) {
                await createProofApprovalManualOverrideAuditLog({
                    organizationId,
                    userId,
                    userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
                    entityType: "order_line_item",
                    entityId: String(lineItem.id),
                    entityName: (lineItem as any).description ?? null,
                });
            }

            if (userId) {
                try {
                    await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
                        organizationId,
                        lineItemId,
                        actorUserId: userId,
                        reason: 'line_item_saved',
                    }));
                } catch (proofSyncError) {
                    console.error('[AutoProofSync:LINE_ITEM_UPDATE] Failed (non-fatal):', proofSyncError);
                }
            }

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

            if (oldLineItem && userId && isActiveOperationalEdit && submittedFields.length > 0) {
                const stableValue = (value: any): any => {
                    if (value instanceof Date) return value.toISOString();
                    if (value === undefined) return null;
                    return value;
                };
                const valuesEqual = (a: any, b: any): boolean => {
                    try {
                        return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
                    } catch {
                        return String(a ?? "") === String(b ?? "");
                    }
                };

                const savedLineItem = (finalLineItem ?? lineItem) as any;
                const changedFields = submittedFields.filter((field) =>
                    !valuesEqual((oldLineItem as any)[field], savedLineItem[field])
                );

                if (changedFields.length > 0) {
                    const previousValues = Object.fromEntries(changedFields.map((field) => [field, stableValue((oldLineItem as any)[field])]));
                    const newValues = Object.fromEntries(changedFields.map((field) => [field, stableValue(savedLineItem[field])]));
                    const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

                    await storage.createOrderAuditLog({
                        orderId: lineItem.orderId,
                        orderLineItemId: lineItem.id,
                        userId,
                        userName,
                        actionType: 'line_item.active_work_changed',
                        fromStatus: oldLineItemWorkflowState,
                        toStatus: String(savedLineItem.workflowState || oldLineItemWorkflowState),
                        note: 'Active production/prepress line item edited; operator review may be required.',
                        metadata: {
                            eventType: 'line_item.active_work_changed',
                            orderId: lineItem.orderId,
                            lineItemId: lineItem.id,
                            actorUserId: userId,
                            changedFields,
                            previousValues,
                            newValues,
                            workflowState: oldLineItemWorkflowState,
                            productionJobId: activeJob?.id ?? null,
                            productionJobStatus: activeJob?.status ?? null,
                            warning: 'This line item is already in production/prepress. Changes may require rework, updated files, or operator review.',
                            createdAt: new Date().toISOString(),
                        },
                    });
                }
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

            // Auto-schedule production job when productId changes and new product type has sendToProductionDefault=true.
            // Guard: only fires when productId is explicitly changed by this edit.
            // Fail-soft: scheduling failure does not block the line item update response.
            if (updateData.productId !== undefined && !isActiveOperationalEdit) {
                try {
                    const newProductId = String(updateData.productId);
                    const [ptRow] = await db
                        .select({
                            sendToProductionDefault: productTypes.sendToProductionDefault,
                            workflowIntent: products.workflowIntent,
                        })
                        .from(products)
                        .innerJoin(productTypes, eq(products.productTypeId, productTypes.id))
                        .where(eq(products.id, newProductId))
                        .limit(1);

                    if (ptRow?.workflowIntent !== "service_fee" && ptRow?.sendToProductionDefault === true && String((finalLineItem ?? lineItem).workflowState || "") === "ready_for_production") {
                        const { scheduleOrderLineItemsForProduction } = await import('../services/productionScheduling');
                        const { loadProductionLineItemStatusRulesForOrganization, appendEvent } = await import('../productionHelpers');
                        const scheduleResult = await scheduleOrderLineItemsForProduction({
                            organizationId,
                            orderId: String(lineItem.orderId),
                            lineItemIds: [lineItem.id],
                            loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
                            appendEvent,
                        });
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`[AutoProductionSchedule:PATCH] lineItemId=${lineItem.id} newProductId=${newProductId} sendToProductionDefault=true → auto-scheduled:`, scheduleResult.data);
                        }
                    }
                } catch (autoScheduleErr: any) {
                    console.error('[AutoProductionSchedule:PATCH] Failed (non-fatal):', autoScheduleErr?.message ?? autoScheduleErr);
                }
            }

            await recomputeOrderTotalsFromPersistedLineItems(String(lineItem.orderId), organizationId, userId ?? null);
            await recomputeOrderBillingStatus({ organizationId, orderId: String(lineItem.orderId) });

            res.json({
                ...enrichLineItemWithEffectivePricing((finalLineItem ?? lineItem) as any),
                finalArtworkSynchronization,
            });
        } catch (error) {
            if (error instanceof z.ZodError) return res.status(400).json({ message: fromZodError(error).message });
            if ((error as any)?.code === 'PBV2_FORMULA_ERROR') {
                return res.status(422).json({
                    message: (error as any).message,
                    code: 'PBV2_FORMULA_ERROR',
                    details: (error as any).details ?? [],
                    debug: (error as any).debug,
                });
            }
            if ((error as any)?.statusCode) return res.status((error as any).statusCode).json({ message: (error as any).message });
            res.status(500).json({ message: "Failed to update order line item" });
        }
    });

    // PBV2: Explicit recompute for an order line item. The financial snapshot
    // must use the same PricingService evaluator as quote and order creation;
    // accepted components remain unchanged.
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
            // Environment extras were previously passed to a simplified adapter
            // which cannot evaluate matrices, Formula Library pricing, or the
            // Product pricing profile. Canonical pricing owns its inputs from
            // the persisted line instead of accepting an untrusted parallel env.

            const [li] = await db
                .select({
                    id: orderLineItems.id,
                    orderId: orderLineItems.orderId,
                    productId: orderLineItems.productId,
                    width: orderLineItems.width,
                    height: orderLineItems.height,
                    quantity: orderLineItems.quantity,
                    optionSelectionsJson: orderLineItems.optionSelectionsJson,
                    specsJson: orderLineItems.specsJson,
                    overridePriceCents: orderLineItems.overridePriceCents,
                    unitPrice: orderLineItems.unitPrice,
                    totalPrice: orderLineItems.totalPrice,
                    customerId: orders.customerId,
                })
                .from(orderLineItems)
                .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                .limit(1);

            if (!li) return res.status(404).json({ message: "Order line item not found" });

            const { priceLineItem } = await import("../services/pricing/PricingService");
            const persistedSelections = (li as any).optionSelectionsJson?.selected;
            const effectiveSelections = Object.keys(explicitSelections).length > 0
                ? explicitSelections
                : (persistedSelections && typeof persistedSelections === "object" ? persistedSelections : {});
            const pricingResult = await priceLineItem({
                organizationId,
                productId: String((li as any).productId),
                quantity: Number((li as any).quantity),
                widthIn: numOrUndef((li as any).width),
                heightIn: numOrUndef((li as any).height),
                pbv2ExplicitSelections: effectiveSelections,
                // Explicit recompute is an intentional current-Product pricing
                // operation. Normal saved-order updates continue to reprice only
                // on established pricing-driver changes.
                pbv2TreeVersionIdOverride: undefined,
            }).catch((error: any) => {
                throw Object.assign(new Error(error?.message || "PBV2 recompute failed"), { statusCode: 400 });
            });
            const effectivePricing = resolvePersistedLineItemPricing({
                baseCalculatedTotalCents: pricingResult.lineTotalCents,
                quantity: Number((li as any).quantity),
                specsJson: (li as any).specsJson,
                legacyOverridePriceCents: (li as any).overridePriceCents,
            });
            const specsJson = mergePricingIntoSpecsJson({
                specsJson: (li as any).specsJson,
                pricing: effectivePricing,
            });

            const [updated] = await db
                .update(orderLineItems)
                .set({
                    pbv2TreeVersionId: pricingResult.pbv2TreeVersionId,
                    pbv2SnapshotJson: pricingResult.pbv2SnapshotJson as any,
                    optionSelectionsJson: { schemaVersion: 2, selected: pricingResult.pbv2SnapshotJson.selections || {} } as any,
                    selectedOptions: pricingResult.pbv2SnapshotJson.selectedOptions || [],
                    specsJson: specsJson as any,
                    overridePriceCents: effectivePricing.hasPriceOverride ? effectivePricing.effectiveTotalCents : null,
                    unitPrice: (effectivePricing.effectiveUnitPriceCents / 100).toFixed(2),
                    totalPrice: (effectivePricing.effectiveTotalCents / 100).toFixed(2),
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

            await recomputeOrderTotalsFromPersistedLineItems(String((li as any).orderId), organizationId, getUserId(req.user) ?? null);
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
            if (!userId) return res.status(401).json({ error: "Unauthorized" });
            const { orderId, lineItemId } = req.params;
            const { status } = req.body;

            const fallbackValidStatuses = ['complete', 'canceled'];

            if (!status) return res.status(400).json({ message: "Invalid status" });
            if (!fallbackValidStatuses.includes(status)) {
                return res.status(400).json({ message: "Direct line item status edits only support complete or canceled. Use workflow transitions for operational moves." });
            }

            const order = await storage.getOrderById(organizationId, orderId);
            if (!order) return res.status(404).json({ message: "Order not found" });

            const oldLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!oldLineItem || oldLineItem.orderId !== orderId) return res.status(404).json({ message: "Line item not found" });

            const targetState = status === 'complete' ? 'completed' : 'canceled';
            const transition = await db.transaction(async (tx) => {
                return transitionLineItemWorkflowState(tx, {
                    organizationId,
                    lineItemId,
                    toState: targetState,
                    actorUserId: userId,
                    metadata: {
                        source: 'legacy_line_item_status_patch',
                        requestedStatus: status,
                    },
                });
            });
            const updatedLineItem = await storage.getOrderLineItemById(lineItemId);
            if (!updatedLineItem) return res.status(404).json({ message: "Line item not found after update" });
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
            res.json({ success: true, data: updatedLineItem, workflow: transition });
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
            const ownership = await db.transaction(async (tx) => {
                const [ownedLineItem] = await tx
                    .select({ id: orderLineItems.id, orderId: orderLineItems.orderId })
                    .from(orderLineItems)
                    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
                    .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
                    .limit(1);
                if (!ownedLineItem) return null;

                await new OrdersRepository(tx).deleteOrderLineItem(lineItemId);
                await recalculateEditableOrderFinancialsInTransaction(tx, {
                    organizationId,
                    orderId: String(ownedLineItem.orderId),
                    actorUserId: getUserId(req.user) ?? null,
                });
                await recomputeOrderBillingStatus({ organizationId, orderId: String(ownedLineItem.orderId), executor: tx });
                return ownedLineItem;
            });

            if (!ownership) return res.status(404).json({ message: "Order line item not found" });
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
                    inputUom: z.string().trim().min(1).optional(),
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
                    materialForm: materials.materialForm,
                    inventoryUnit: materials.inventoryUnit,
                    consumptionUnit: materials.consumptionUnit,
                    width: materials.width,
                    rollLengthFt: materials.rollLengthFt,
                    edgeWasteInPerSide: materials.edgeWasteInPerSide,
                    leadWasteFt: materials.leadWasteFt,
                    tailWasteFt: materials.tailWasteFt,
                })
                .from(materials)
                .where(and(eq(materials.organizationId, organizationId), eq(materials.id, parsed.data.materialId)))
                .limit(1);

            if (!material) return res.status(404).json({ message: "Material not found" });

            const conversion = convertReservationInputToBaseQty({
                material: {
                    materialForm: (material as any).materialForm,
                    inventoryUnit: (material as any).inventoryUnit,
                    consumptionUnit: (material as any).consumptionUnit,
                    width: (material as any).width,
                    rollLengthFt: (material as any).rollLengthFt,
                    edgeWasteInPerSide: (material as any).edgeWasteInPerSide,
                    leadWasteFt: (material as any).leadWasteFt,
                    tailWasteFt: (material as any).tailWasteFt,
                },
                inputUom: parsed.data.inputUom ?? String((material as any).consumptionUnit),
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
                    fileRecordId: orderAttachments.fileRecordId,
                    fileName: orderAttachments.fileName,
                    originalFilename: orderAttachments.originalFilename,
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
                            fileRecordId: assets.fileRecordId,
                            fileName: assets.fileName,
                        })
                        .from(assets)
                        .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, assetIds)));
                }
            }

            // Build file list with objectPaths
            const files: Array<{ filename: string; objectPath: string }> = [];

            for (const att of attachmentRows) {
                const resolved = await resolveOriginalFileAccess(att, { logOnce: createRequestLogOnce() });
                if (resolved.objectPath) files.push({ filename: resolved.displayFilename, objectPath: resolved.objectPath });
            }

            const logOnce = createRequestLogOnce();
            for (const asset of lineItemAssetRows) {
                const resolved = await resolveOriginalFileAccess(asset, { logOnce });
                if (resolved.objectPath) files.push({ filename: resolved.displayFilename, objectPath: resolved.objectPath });
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
