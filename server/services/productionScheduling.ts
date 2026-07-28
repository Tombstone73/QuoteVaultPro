import { db } from "../db";
import { orderLineItems, products, orders } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { routeLineItemToProduction } from "./productionRoutingService";
import { resolveInitialProductionRoute } from "./productionRoutingResolver";
import { isCanceledOrder } from "@shared/operationalState";
import { syncParentOrderForOperationalChildren } from "./orderWorkflowSyncService";
import { resolveLineItemProofReleaseGate } from "./proofGateService";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";

type SchedulingCandidateLineItem = {
  lineItemId: string;
  productId: string;
  productTypeId: string | null;
  materialId: string | null;
  status: string;
  workflowState: string | null;
  lineItemRequiresDesignSnapshot: boolean | null;
  lineItemRequiresProofApprovalSnapshot: boolean | null;
  lineItemRequiresPrepressSnapshot: boolean | null;
  approvedProofVersionId: string | null;
  requiresProductionJob: boolean;
  workflowIntent: string | null;
  lineItemRole?: string | null;
  productionBypassed?: boolean | null;
};

type ScheduledItem = {
  lineItemId: string;
  productionJobId: string;
  stationKey: string;
  stepKey: string;
  routingReason: string;
  reused?: boolean;
};

type FailedItem = {
  lineItemId: string;
  traceId: string;
  step: string;
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
  message: string;
};

const toFailedItem = (lineItemId: string, traceId: string, step: string, error: any): FailedItem => ({
  lineItemId,
  traceId,
  step,
  code: typeof error?.code === "string" ? error.code : undefined,
  constraint: typeof error?.constraint === "string" ? error.constraint : undefined,
  table: typeof error?.table === "string" ? error.table : undefined,
  detail: typeof error?.detail === "string" ? error.detail : undefined,
  message: String(error?.message || "Unknown scheduling error"),
});

const WORKFLOW_STATES_REQUIRING_APPROVED_PROOF = new Set(["ready_for_production", "in_production"]);

export function isProductionEligibleBundleLineItem(item: Pick<SchedulingCandidateLineItem, "lineItemRole" | "requiresProductionJob" | "workflowIntent" | "productionBypassed">): boolean {
  return item.productionBypassed !== true && item.lineItemRole !== "parent" && item.requiresProductionJob === true && item.workflowIntent !== "service_fee";
}

function logProofSchedulingBlock(args: {
  traceId: string;
  orderId: string;
  lineItemId: string;
  currentWorkflowState: string;
  targetWorkflowState?: string;
  requiresProofApproval: boolean;
  approvedProofVersionId: string | null;
  routingReason?: string;
  reason: "awaiting_proof_approval" | "missing_approved_proof";
}) {
  console.warn("[ProductionScheduling] blocked proof-gated handoff", {
    traceId: args.traceId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
    currentWorkflowState: args.currentWorkflowState,
    targetWorkflowState: args.targetWorkflowState,
    requiresProofApproval: args.requiresProofApproval,
    approvedProofVersionId: args.approvedProofVersionId,
    routingReason: args.routingReason,
    reason: args.reason,
  });
}

/**
 * scheduleOrderLineItemsForProduction
 * 
 * Starts the first operational workflow stage for each line item that requires production.
 * - If lineItemIds is omitted, targets ALL production-required line items in the order.
 * - If lineItemIds is provided, targets ONLY those items (still filtered by requiresProductionJob).
 * - Idempotent: does not duplicate jobs if they already exist.
 * - Transactional per line item: a failed item is rolled back and returned with
 *   actionable diagnostics without obscuring the successfully-started items.
 * 
 * Returns:
 * - createdJobCount: number of new jobs created
 * - existingJobCount: number of jobs that already existed
 * - skippedNonProductionCount: number of items skipped (product doesn't require production)
 * - affectedLineItemIds: array of line item IDs that now have production jobs
 */
export async function scheduleOrderLineItemsForProduction(args: {
  organizationId: string;
  orderId: string;
  lineItemIds?: string[];
  actorUserId?: string | null;
  loadRoutingRules: (orgId: string) => Promise<{ source: string; rules: any[] }>;
  appendEvent: (args: { tx: any; organizationId: string; productionJobId: string; type: "intake" | "routing_override" | "timer_started" | "timer_stopped" | "note" | "reprint_incremented" | "media_used_set"; payload?: any }) => Promise<void>;
  traceId?: string;
  loadLineItemsForSchedulingFn?: (args: {
    organizationId: string;
    orderId: string;
    lineItemIds?: string[];
  }) => Promise<{ orderExists: boolean; lineItemRecords: SchedulingCandidateLineItem[] }>;
  transactionRunner?: {
    transaction: <T>(cb: (tx: any) => Promise<T>) => Promise<T>;
  };
  resolveInitialProductionRouteFn?: typeof resolveInitialProductionRoute;
  routeLineItemToProductionFn?: typeof routeLineItemToProduction;
  transitionLineItemWorkflowStateFn?: typeof transitionLineItemWorkflowState;
  syncParentOrderForOperationalChildrenFn?: typeof syncParentOrderForOperationalChildren;
}): Promise<{
  success: boolean;
  data: {
    createdJobCount: number;
    existingJobCount: number;
    skippedNonProductionCount: number;
    affectedLineItemIds: string[];
    scheduled: ScheduledItem[];
    failed: FailedItem[];
    lineItemDiagnostics: Record<string, {
      stationKey: string;
      stepKey: string;
      routingReason: string;
      routingSource?: string;
      idempotencyNote?: string;
    }>;
  };
  message: string;
  traceId: string;
}> {
  const {
    organizationId,
    orderId,
    lineItemIds,
    loadRoutingRules: _loadRoutingRules,
    appendEvent,
    traceId,
    loadLineItemsForSchedulingFn,
    transactionRunner,
    resolveInitialProductionRouteFn,
    routeLineItemToProductionFn,
    transitionLineItemWorkflowStateFn,
    syncParentOrderForOperationalChildrenFn,
  } = args;

  const requestTraceId = String(traceId || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const txRunner = transactionRunner ?? db;
  const resolveRoute = resolveInitialProductionRouteFn ?? resolveInitialProductionRoute;
  const routeToProduction = routeLineItemToProductionFn ?? routeLineItemToProduction;
  const transitionWorkflow = transitionLineItemWorkflowStateFn ?? transitionLineItemWorkflowState;
  // Test callers that supply an in-memory transaction do not model order-level
  // reads. Production callers always use the canonical order workflow sync.
  const syncOperationalOrder = syncParentOrderForOperationalChildrenFn ?? (
    transactionRunner
      ? async (_tx: any, _syncArgs: Parameters<typeof syncParentOrderForOperationalChildren>[1]) => null
      : syncParentOrderForOperationalChildren
  );

  const defaultLoadLineItemsForScheduling = async ({
    organizationId,
    orderId,
    lineItemIds,
  }: {
    organizationId: string;
    orderId: string;
    lineItemIds?: string[];
  }): Promise<{ orderExists: boolean; lineItemRecords: SchedulingCandidateLineItem[] }> => {
    const [orderRecord] = await db
      .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
      .limit(1);

    if (!orderRecord) {
      return {
        orderExists: false,
        lineItemRecords: [],
      };
    }

    if (isCanceledOrder(orderRecord)) {
      throw Object.assign(new Error("Cancelled orders cannot be scheduled for production"), {
        statusCode: 409,
        code: "ORDER_CANCELLED",
        orderId,
      });
    }

    const lineItemRecords = await db
      .select({
        lineItemId: orderLineItems.id,
        productId: orderLineItems.productId,
        productTypeId: products.productTypeId,
        materialId: orderLineItems.materialId,
        status: orderLineItems.status,
        workflowState: orderLineItems.workflowState,
        lineItemRequiresDesignSnapshot: orderLineItems.requiresDesign,
        lineItemRequiresProofApprovalSnapshot: orderLineItems.requiresProofApproval,
        lineItemRequiresPrepressSnapshot: orderLineItems.requiresPrepress,
        approvedProofVersionId: orderLineItems.approvedProofVersionId,
        requiresProductionJob: products.requiresProductionJob,
        workflowIntent: products.workflowIntent,
        lineItemRole: orderLineItems.lineItemRole,
        productionBypassed: orderLineItems.productionBypassed,
      })
      .from(orderLineItems)
      .innerJoin(products, eq(orderLineItems.productId, products.id))
      .where(
        and(
          eq(orderLineItems.orderId, orderId),
          lineItemIds && lineItemIds.length > 0 ? inArray(orderLineItems.id, lineItemIds) : undefined,
        ),
      );

    return {
      orderExists: true,
      lineItemRecords,
    };
  };

  const loadLineItems = loadLineItemsForSchedulingFn ?? defaultLoadLineItemsForScheduling;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[ProductionScheduling] Starting schedule traceId=${requestTraceId} for orderId=${orderId}, targetLineItems=${lineItemIds?.length ?? 'ALL'}`);
  }

  const loaded = await loadLineItems({ organizationId, orderId, lineItemIds });
  if (!loaded.orderExists) {
    throw new Error("Order not found");
  }

  if (loaded.lineItemRecords.length === 0) {
    return {
      success: true,
      data: {
        createdJobCount: 0,
        existingJobCount: 0,
        skippedNonProductionCount: 0,
        affectedLineItemIds: [],
        scheduled: [],
        failed: [],
        lineItemDiagnostics: {},
      },
      message: "No line items found",
      traceId: requestTraceId,
    };
  }

  const productionRequiredItems = loaded.lineItemRecords.filter(
    isProductionEligibleBundleLineItem,
  );
  const skippedCount = loaded.lineItemRecords.length - productionRequiredItems.length;

  if (productionRequiredItems.length === 0) {
    return {
      success: true,
      data: {
        createdJobCount: 0,
        existingJobCount: 0,
        skippedNonProductionCount: skippedCount,
        affectedLineItemIds: [],
        scheduled: [],
        failed: [],
        lineItemDiagnostics: {},
      },
      message: "No line items require production",
      traceId: requestTraceId,
    };
  }

  let createdCount = 0;
  let existingCount = 0;
  let blockedByProofCount = 0;
  let routedToProofingCount = 0;
  const affectedIds: string[] = [];
  const scheduled: ScheduledItem[] = [];
  const failed: FailedItem[] = [];
  const lineItemDiagnostics: Record<string, {
    stationKey: string;
    stepKey: string;
    routingReason: string;
    routingSource?: string;
    idempotencyNote?: string;
  }> = {};

  for (const item of productionRequiredItems) {
    let step = "begin_item";
    try {
      const currentWorkflowState = String(item.workflowState || "").trim().toLowerCase();

      step = "resolve_initial_route";
      const route = await resolveRoute({
        organizationId,
        productTypeId: item.productTypeId,
        lineItemRequiresDesignSnapshot:
          typeof item.lineItemRequiresDesignSnapshot === "boolean"
            ? item.lineItemRequiresDesignSnapshot
            : undefined,
        lineItemRequiresPrepressSnapshot:
          typeof item.lineItemRequiresPrepressSnapshot === "boolean"
            ? item.lineItemRequiresPrepressSnapshot
            : undefined,
      });

      const targetWorkflowState =
        route.stationKey === "design" || route.stepKey === "design"
          ? "needs_design"
          : route.stationKey === "prepress" || route.stepKey === "prepress"
            ? "ready_for_prepress"
            : "ready_for_production";

      const proofRequiredWithoutApproval = item.lineItemRequiresProofApprovalSnapshot === true && !item.approvedProofVersionId;
      // Design remains the first gate. Otherwise a required proof is itself the
      // first production stage, rather than a reason to reject production intake.
      if (proofRequiredWithoutApproval && targetWorkflowState !== "needs_design") {
        const scheduledItem = await txRunner.transaction(async (tx) => {
          step = "route_line_item_to_proofing";
          const transition = await transitionWorkflow(tx, {
            organizationId,
            lineItemId: item.lineItemId,
            toState: "awaiting_proof_approval",
            actorUserId: args.actorUserId ?? null,
            metadata: {
              source: "production_intake",
              traceId: requestTraceId,
              routingReason: "proof_required_first_stage",
            },
          });

          if (!transition.activeOwnerJobId || !transition.activeOwnerStationKey || !transition.activeOwnerStepKey) {
            throw new Error("Proofing intake did not establish an operational owner");
          }

          await syncOperationalOrder(tx, {
            organizationId,
            orderId,
            lineItemId: item.lineItemId,
            actorUserId: args.actorUserId ?? null,
            source: "production_schedule:awaiting_proof_approval",
          });

          return {
            lineItemId: item.lineItemId,
            productionJobId: transition.activeOwnerJobId,
            stationKey: transition.activeOwnerStationKey,
            stepKey: transition.activeOwnerStepKey,
            routingReason: "proof_required_first_stage",
            reused: transition.ownershipAction !== "created",
            idempotencyReason: transition.ownershipAction === "none" ? "Existing proofing owner reused" : undefined,
          };
        });

        if (scheduledItem.reused) {
          existingCount++;
        } else {
          createdCount++;
        }

        affectedIds.push(item.lineItemId);
        scheduled.push(scheduledItem);
        routedToProofingCount++;
        lineItemDiagnostics[item.lineItemId] = {
          stationKey: scheduledItem.stationKey,
          stepKey: scheduledItem.stepKey,
          routingReason: scheduledItem.routingReason,
          routingSource: "proofing",
          idempotencyNote: scheduledItem.idempotencyReason,
        };
        continue;
      }

      if (WORKFLOW_STATES_REQUIRING_APPROVED_PROOF.has(targetWorkflowState) && item.lineItemRequiresProofApprovalSnapshot !== false) {
        const proofGate = await resolveLineItemProofReleaseGate(db, {
          organizationId,
          lineItemId: item.lineItemId,
        });

        if (!proofGate.allowed) {
          blockedByProofCount++;
          lineItemDiagnostics[item.lineItemId] = {
            stationKey: "proofing",
            stepKey: "approved_proof_required",
            routingReason: "proof_approval_required_before_scheduling",
            idempotencyNote: `Blocked scheduling to ${route.stationKey}/${route.stepKey} until an approved proof is recorded`,
          };
          logProofSchedulingBlock({
            traceId: requestTraceId,
            orderId,
            lineItemId: item.lineItemId,
            currentWorkflowState,
            targetWorkflowState,
            requiresProofApproval: proofGate.requiresProofApproval,
            approvedProofVersionId: proofGate.approvedProofVersionId,
            routingReason: route.reason,
            reason: "missing_approved_proof",
          });
          continue;
        }
      }

      const scheduledItem = await txRunner.transaction(async (tx) => {
        step = "route_line_item_to_production";
        const routingResult = await routeToProduction({
          tx,
          organizationId,
          orderId,
          lineItemId: item.lineItemId,
          stationKey: route.stationKey,
          stepKey: route.stepKey,
          trigger: "scheduler",
          traceId: requestTraceId,
          extraEventPayload: {
            fromStatus: null,
            toStatus: item.status,
            source: "bulk_schedule",
            routingReason: route.reason,
          },
        });

        const targetLifecycleStatus = targetWorkflowState === "ready_for_production" ? "in_production" : "new";

        await tx
          .update(orderLineItems)
          .set({
            workflowState: targetWorkflowState as any,
            status: targetLifecycleStatus as any,
            updatedAt: new Date(),
          })
          .where(eq(orderLineItems.id, item.lineItemId));

        await syncOperationalOrder(tx, {
          organizationId,
          orderId,
          lineItemId: item.lineItemId,
          actorUserId: args.actorUserId ?? null,
          source: `production_schedule:${targetWorkflowState}`,
        });

        if (routingResult.outcome === "existing" && routingResult.reason) {
          console.warn(
            `[ProductionScheduling] traceId=${requestTraceId} lineItemId=${item.lineItemId} not re-routed to ${route.stationKey}/${route.stepKey}: ${routingResult.reason}`,
          );
        }

        return {
          lineItemId: item.lineItemId,
          productionJobId: routingResult.jobId,
          stationKey: routingResult.stationKey,
          stepKey: routingResult.stepKey,
          routingReason: route.reason,
          reused: routingResult.outcome === "existing",
          idempotencyReason: routingResult.reason,
        };
      });

      if (scheduledItem.reused) {
        existingCount++;
      } else {
        createdCount++;
      }

      affectedIds.push(item.lineItemId);
      scheduled.push({
        lineItemId: scheduledItem.lineItemId,
        productionJobId: scheduledItem.productionJobId,
        stationKey: scheduledItem.stationKey,
        stepKey: scheduledItem.stepKey,
        routingReason: scheduledItem.routingReason,
        reused: scheduledItem.reused,
      });

      lineItemDiagnostics[item.lineItemId] = {
        stationKey: scheduledItem.stationKey,
        stepKey: scheduledItem.stepKey,
        routingReason: scheduledItem.routingReason,
        routingSource: scheduledItem.routingReason.includes("product")
          ? "product"
          : scheduledItem.routingReason.includes("snapshot")
            ? "snapshot"
            : scheduledItem.routingReason.includes("org")
              ? "org"
              : "default",
        idempotencyNote: scheduledItem.reused
          ? scheduledItem.idempotencyReason || "Existing non-void production job reused"
          : undefined,
      };
    } catch (error: any) {
      const itemFailure = toFailedItem(item.lineItemId, requestTraceId, step, error);
      console.error("[ProductionScheduling] per-item failure", itemFailure);
      failed.push(itemFailure);
    }
  }

  let message = "";
  if (createdCount > 0 && existingCount > 0) {
    message = `Created ${createdCount} new job(s), ${existingCount} already existed`;
  } else if (createdCount > 0) {
    message = `Created ${createdCount} production job(s)`;
  } else if (existingCount > 0) {
    message = `${existingCount} item(s) already in production`;
  } else if (blockedByProofCount > 0) {
    message = `Approved proof required before scheduling ${blockedByProofCount} item(s)`;
  } else {
    message = "No jobs created (line items not routed to production)";
  }

  if (skippedCount > 0) {
    message += `. Skipped ${skippedCount} non-production item(s)`;
  }
  if (blockedByProofCount > 0 && createdCount + existingCount > 0) {
    message += `. Blocked ${blockedByProofCount} proof-required item(s) without an approved proof`;
  }
  if (failed.length > 0) {
    message += `. Failed ${failed.length} item(s)`;
  }
  if (routedToProofingCount > 0) {
    const proofingSummary = `${routedToProofingCount} item(s) routed to Proofing first`;
    message = createdCount + existingCount === routedToProofingCount
      ? `Production workflow started: ${proofingSummary}`
      : `${message}. ${proofingSummary}`;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ProductionScheduling] Completed traceId=${requestTraceId} for orderId=${orderId}: created=${createdCount}, existing=${existingCount}, skipped=${skippedCount}, failed=${failed.length}`,
    );
  }

  return {
    success: true,
    data: {
      createdJobCount: createdCount,
      existingJobCount: existingCount,
      skippedNonProductionCount: skippedCount,
      affectedLineItemIds: affectedIds,
      scheduled,
      failed,
      lineItemDiagnostics,
    },
    message,
    traceId: requestTraceId,
  };
}
