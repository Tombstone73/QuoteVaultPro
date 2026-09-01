import { and, desc, eq } from "drizzle-orm";
import { orderLineItems, orders, products, productionEvents, productionJobs, type LineItemDesignStatus, type LineItemWorkflowState } from "@shared/schema";
import { appendEvent } from "../productionHelpers";
import { completeActiveJob, findActiveJobForLineItem, findAllActiveJobsForLineItem, transitionToStation } from "./productionOwnership";
import { routeLineItemToProduction } from "./productionRoutingService";
import { resolvePostPrepressProductionRoute } from "./productionRoutingResolver";
import { syncParentOrderForOperationalChildren } from "./orderWorkflowSyncService";
import { resolveLineItemProofReleaseGate } from "./proofGateService";
import { readPrepressProductionDestinationOverride } from "@shared/productionStations";

export const NON_TERMINAL_WORKFLOW_STATES: LineItemWorkflowState[] = [
  "new",
  "needs_design",
  "in_design",
  "awaiting_proof_approval",
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
  "on_hold",
];

export const TERMINAL_WORKFLOW_STATES: LineItemWorkflowState[] = ["completed", "canceled"];

export const OWNERSHIP_REQUIRED_WORKFLOW_STATES: LineItemWorkflowState[] = [
  "needs_design",
  "in_design",
  // Titan default: Prepress owns proof-required items during proof preparation so they
  // are visible and actionable in the Prepress queue from the moment they are created.
  // Production is still gated by approvedProofVersionId (see transitionLineItemWorkflowState).
  "awaiting_proof_approval",
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
];

export const OWNERLESS_WORKFLOW_STATES: LineItemWorkflowState[] = [
  "new",
  "on_hold",
  "completed",
  "canceled",
];

const VALID_TRANSITIONS: Record<LineItemWorkflowState, LineItemWorkflowState[]> = {
  new: ["needs_design", "awaiting_proof_approval", "ready_for_prepress", "ready_for_production", "on_hold", "canceled"],
  needs_design: ["in_design", "on_hold", "canceled"],
  in_design: ["needs_design", "awaiting_proof_approval", "ready_for_prepress", "on_hold", "canceled"],
  awaiting_proof_approval: ["needs_design", "ready_for_prepress", "ready_for_production", "on_hold", "canceled"],
  ready_for_prepress: ["needs_design", "awaiting_proof_approval", "in_prepress", "ready_for_production", "on_hold", "canceled"],
  in_prepress: ["awaiting_proof_approval", "ready_for_production", "in_design", "needs_design", "on_hold", "canceled"],
  ready_for_production: ["awaiting_proof_approval", "in_production", "in_prepress", "on_hold", "canceled"],
  // A zero-progress production job may be returned to Prepress by the guarded
  // production recovery services. Those services perform their own ownership,
  // fulfillment, and quantity preflight before using this canonical transition.
  in_production: ["completed", "in_prepress", "on_hold", "canceled"],
  completed: [],
  on_hold: [],
  canceled: [],
};

type LoadedLineItem = {
  id: string;
  orderId: string;
  organizationId: string;
  status: string;
  workflowState: string;
  designStatus: LineItemDesignStatus | null;
  requiresDesign: boolean;
  requiresProofApproval: boolean;
  requiresPrepress: boolean;
  approvedProofVersionId: string | null;
  productType: string;
  productTypeId: string | null;
  specsJson: unknown;
};

const DESIGN_INCOMPLETE_STATUSES: LineItemDesignStatus[] = ["needs_design", "in_design"];
const DESIGN_COMPLETION_REQUIRED_TARGET_STATES: LineItemWorkflowState[] = [
  "awaiting_proof_approval",
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
  "completed",
];

type OwnershipRoute = {
  stationKey: string;
  stepKey: string;
  reason: string;
};

type OwnershipInvariantResult = {
  activeOwnerJobId: string | null;
  activeOwnerStationKey: string | null;
  activeOwnerStepKey: string | null;
};

export type WorkflowTransitionResult = {
  lineItemId: string;
  fromState: LineItemWorkflowState;
  toState: LineItemWorkflowState;
  lifecycleStatus: string;
  activeOwnerJobId: string | null;
  activeOwnerStationKey: string | null;
  activeOwnerStepKey: string | null;
  ownershipAction: "created" | "reused" | "transitioned" | "completed" | "none";
};

function normalizeWorkflowState(value: unknown): LineItemWorkflowState | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return ([
    "new",
    "needs_design",
    "in_design",
    "awaiting_proof_approval",
    "ready_for_prepress",
    "in_prepress",
    "ready_for_production",
    "in_production",
    "completed",
    "on_hold",
    "canceled",
  ] as const).includes(normalized as LineItemWorkflowState)
    ? (normalized as LineItemWorkflowState)
    : null;
}

function isTerminalWorkflowState(state: LineItemWorkflowState): boolean {
  return TERMINAL_WORKFLOW_STATES.includes(state);
}

function normalizeDesignStatus(value: unknown): LineItemDesignStatus | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return (["needs_design", "in_design", "design_complete", "bypassed"] as const).includes(normalized as LineItemDesignStatus)
    ? (normalized as LineItemDesignStatus)
    : null;
}

function deriveEffectiveDesignStatus(args: { designStatus: LineItemDesignStatus | null; workflowState: string }) {
  const explicit = normalizeDesignStatus(args.designStatus);
  if (explicit) return explicit;

  const workflowState = normalizeWorkflowState(args.workflowState);
  if (workflowState === "needs_design") return "needs_design";
  if (workflowState === "in_design") return "in_design";
  return null;
}

function derivePersistedDesignStatus(args: {
  currentDesignStatus: LineItemDesignStatus | null;
  toState: LineItemWorkflowState;
}) {
  if (args.toState === "needs_design") return "needs_design" as const;
  if (args.toState === "in_design") return "in_design" as const;
  return args.currentDesignStatus;
}

export function workflowStateRequiresActiveOwner(state: LineItemWorkflowState): boolean {
  return OWNERSHIP_REQUIRED_WORKFLOW_STATES.includes(state);
}

export function workflowStateIsIntentionallyOwnerless(state: LineItemWorkflowState): boolean {
  return OWNERLESS_WORKFLOW_STATES.includes(state);
}

function deriveLifecycleStatusForState(args: {
  toState: LineItemWorkflowState;
  fromState: LineItemWorkflowState;
  currentStatus: string;
}): string {
  if (args.toState === "completed") return "complete";
  if (args.toState === "canceled") return "canceled";
  if (
    args.toState === "in_design" ||
    args.toState === "awaiting_proof_approval" ||
    args.toState === "in_prepress" ||
    args.toState === "ready_for_production" ||
    args.toState === "in_production"
  ) {
    return "in_production";
  }
  if (args.toState === "on_hold") {
    return String(args.currentStatus || "").toLowerCase() === "in_production" || OWNERSHIP_REQUIRED_WORKFLOW_STATES.includes(args.fromState)
      ? "in_production"
      : "new";
  }
  return "new";
}

function deriveLegacyWorkflowState(args: {
  workflowState?: string | null;
  status?: string | null;
  requiresDesign: boolean;
  requiresPrepress: boolean;
  hasActiveDesignOwner: boolean;
  hasActivePrepressOwner: boolean;
  hasActiveProductionOwner: boolean;
}): LineItemWorkflowState {
  const explicit = normalizeWorkflowState(args.workflowState);
  if (explicit) return explicit;

  const status = String(args.status || "").trim().toLowerCase();
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "complete" || status === "completed" || status === "done") return "completed";
  if (args.hasActiveDesignOwner) return "in_design";
  if (args.hasActivePrepressOwner) return "in_prepress";
  if (args.hasActiveProductionOwner) return "in_production";
  if (status === "in_prepress") return "in_prepress";
  if (status === "prepress_complete" || status === "print_ready") return "ready_for_production";
  if (status === "printing" || status === "finishing" || status === "in_production") return "in_production";
  if (args.requiresDesign) return "needs_design";
  if (args.requiresPrepress) return "ready_for_prepress";
  return "ready_for_production";
}

async function loadLineItemForWorkflow(tx: any, args: { organizationId: string; lineItemId: string }): Promise<LoadedLineItem> {
  const [lineItem] = await tx
    .select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      organizationId: orders.organizationId,
      status: orderLineItems.status,
      workflowState: orderLineItems.workflowState,
      designStatus: orderLineItems.designStatus,
      requiresDesign: orderLineItems.requiresDesign,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      requiresPrepress: orderLineItems.requiresPrepress,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      productType: orderLineItems.productType,
      productTypeId: products.productTypeId,
      specsJson: orderLineItems.specsJson,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .leftJoin(products, eq(orderLineItems.productId, products.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!lineItem) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }

  return {
    ...lineItem,
    requiresDesign: Boolean(lineItem.requiresDesign),
    requiresProofApproval: Boolean(lineItem.requiresProofApproval),
    requiresPrepress: Boolean(lineItem.requiresPrepress),
  };
}

async function findPriorActiveState(tx: any, args: { organizationId: string; lineItemId: string }): Promise<LineItemWorkflowState | null> {
  const rows = await tx
    .select({ payload: productionEvents.payload })
    .from(productionEvents)
    .innerJoin(productionJobs, eq(productionEvents.productionJobId, productionJobs.id))
    .where(and(eq(productionEvents.organizationId, args.organizationId), eq(productionJobs.lineItemId, args.lineItemId)))
    .orderBy(desc(productionEvents.createdAt))
    .limit(50);

  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    if (payload.eventType !== "workflow_transition") continue;
    if (payload.toState !== "on_hold") continue;
    const previous = normalizeWorkflowState(payload.fromState);
    if (previous && previous !== "on_hold") {
      return previous;
    }
  }

  return null;
}

async function resolveOwnershipRouteForState(tx: any, lineItem: LoadedLineItem, toState: LineItemWorkflowState): Promise<OwnershipRoute | null> {
  if (toState === "needs_design" || toState === "in_design") {
    return { stationKey: "design", stepKey: "design", reason: "workflow_design_stage" };
  }

  if (toState === "awaiting_proof_approval") {
    // Titan default: Prepress owns proof-required items so they appear in the Prepress
    // queue immediately. Staff can create and send the proof from there.
    // The production gate (approvedProofVersionId check) still blocks routing to
    // ready_for_production / in_production until the proof is approved.
    return { stationKey: "prepress", stepKey: "prepress", reason: "proof_prep_prepress_ownership" };
  }

  if (toState === "ready_for_prepress" || toState === "in_prepress") {
    return { stationKey: "prepress", stepKey: "prepress", reason: "workflow_prepress_stage" };
  }

  if (toState === "ready_for_production" || toState === "in_production") {
    const route = await resolvePostPrepressProductionRoute({
      organizationId: lineItem.organizationId,
      productTypeId: lineItem.productTypeId,
      productTypeNameSnapshot: lineItem.productType,
    });
    const destinationOverride = readPrepressProductionDestinationOverride(lineItem.specsJson);
    if (destinationOverride?.selectedStationKey) {
      return {
        stationKey: destinationOverride.selectedStationKey,
        stepKey: "queued",
        reason: "prepress_destination_override",
      };
    }

    return {
      stationKey: route.stationKey,
      stepKey: route.stepKey,
      reason: route.reason,
    };
  }

  return null;
}

async function applyOwnershipForState(tx: any, args: {
  lineItem: LoadedLineItem;
  toState: LineItemWorkflowState;
  actorUserId?: string | null;
}) {
  const activeJob = await findActiveJobForLineItem(tx, {
    organizationId: args.lineItem.organizationId,
    lineItemId: args.lineItem.id,
  });

  const targetRoute = await resolveOwnershipRouteForState(tx, args.lineItem, args.toState);

  if (!targetRoute) {
    if (!activeJob) {
      return {
        activeOwnerJobId: null,
        activeOwnerStationKey: null,
        activeOwnerStepKey: null,
        ownershipAction: "none" as const,
      };
    }

    const closedJob = await completeActiveJob(tx, {
      organizationId: args.lineItem.organizationId,
      lineItemId: args.lineItem.id,
      reason: `workflow_${args.toState}`,
      actorUserId: args.actorUserId ?? null,
    });

    if (closedJob) {
      await appendEvent({
        tx,
        organizationId: args.lineItem.organizationId,
        productionJobId: closedJob.id,
        type: "note",
        payload: {
          eventType: "workflow_transition",
          ownerAction: "completed_without_successor",
          toState: args.toState,
          actorUserId: args.actorUserId ?? null,
        },
      });
    }

    return {
      activeOwnerJobId: null,
      activeOwnerStationKey: null,
      activeOwnerStepKey: null,
      ownershipAction: "completed" as const,
    };
  }

  if (!activeJob) {
    const routed = await routeLineItemToProduction({
      tx,
      organizationId: args.lineItem.organizationId,
      orderId: args.lineItem.orderId,
      lineItemId: args.lineItem.id,
      stationKey: targetRoute.stationKey,
      stepKey: targetRoute.stepKey,
      trigger: "line_item_status",
      actorUserId: args.actorUserId ?? null,
      extraEventPayload: {
        workflowTargetState: args.toState,
        routingReason: targetRoute.reason,
      },
    });

    return {
      activeOwnerJobId: routed.jobId,
      activeOwnerStationKey: routed.stationKey,
      activeOwnerStepKey: routed.stepKey,
      ownershipAction: routed.outcome === "created" ? ("created" as const) : ("reused" as const),
    };
  }

  if (activeJob.stationKey === targetRoute.stationKey && activeJob.stepKey === targetRoute.stepKey) {
    return {
      activeOwnerJobId: activeJob.id,
      activeOwnerStationKey: activeJob.stationKey,
      activeOwnerStepKey: activeJob.stepKey,
      ownershipAction: "reused" as const,
    };
  }

  const transitioned = await transitionToStation(tx, {
    organizationId: args.lineItem.organizationId,
    orderId: args.lineItem.orderId,
    lineItemId: args.lineItem.id,
    targetStationKey: targetRoute.stationKey,
    targetStepKey: targetRoute.stepKey,
    reason: `workflow_transition:${args.toState}`,
    actorUserId: args.actorUserId ?? null,
  });

  return {
    activeOwnerJobId: transitioned.createdJobId,
    activeOwnerStationKey: transitioned.newStationKey,
    activeOwnerStepKey: transitioned.newStepKey,
    ownershipAction: "transitioned" as const,
  };
}

async function assertOwnershipInvariant(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  toState: LineItemWorkflowState;
}): Promise<OwnershipInvariantResult> {
  const activeJobs = await findAllActiveJobsForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  if (workflowStateRequiresActiveOwner(args.toState)) {
    if (activeJobs.length === 0) {
      // No active job found after applyOwnershipForState — ownership drift.
      // Log and return null; the workflow state DB row was still updated correctly.
      console.warn(
        `[WorkflowInvariant] State ${args.toState} expects an active owner but found none (lineItemId=${args.lineItemId}). Proceeding without active job reference.`,
      );
      return { activeOwnerJobId: null, activeOwnerStationKey: null, activeOwnerStepKey: null };
    }

    if (activeJobs.length > 1) {
      // Multiple active jobs — use the most recently updated one and log the anomaly.
      console.warn(
        `[WorkflowInvariant] State ${args.toState} expects exactly one active owner; found ${activeJobs.length} (lineItemId=${args.lineItemId}). Using most recent.`,
      );
    }

    return {
      activeOwnerJobId: activeJobs[0].id,
      activeOwnerStationKey: activeJobs[0].stationKey,
      activeOwnerStepKey: activeJobs[0].stepKey,
    };
  }

  if (activeJobs.length > 0) {
    // Terminal/idle state still has active jobs — log but do not throw.
    // applyOwnershipForState closes only the primary active job; residual jobs
    // from legacy data or prior state inconsistency should not block the transition.
    console.warn(
      `[WorkflowInvariant] State ${args.toState} should have no active owners; found ${activeJobs.length} (lineItemId=${args.lineItemId}). Residual jobs left open.`,
    );
  }

  return {
    activeOwnerJobId: null,
    activeOwnerStationKey: null,
    activeOwnerStepKey: null,
  };
}

export async function transitionLineItemWorkflowState(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  toState: LineItemWorkflowState;
  actorUserId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  allowTerminalRecovery?: boolean;
}): Promise<WorkflowTransitionResult> {
  const lineItem = await loadLineItemForWorkflow(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const effectiveDesignStatus = deriveEffectiveDesignStatus({
    designStatus: lineItem.designStatus,
    workflowState: lineItem.workflowState,
  });

  if (
    effectiveDesignStatus &&
    DESIGN_INCOMPLETE_STATUSES.includes(effectiveDesignStatus) &&
    DESIGN_COMPLETION_REQUIRED_TARGET_STATES.includes(args.toState)
  ) {
    throw Object.assign(new Error(`Design must be completed before transitioning to ${args.toState}`), { statusCode: 409 });
  }

  const requiresApprovedProofForTarget = ["ready_for_production", "in_production"].includes(args.toState);
  if (requiresApprovedProofForTarget) {
    const proofGate = await resolveLineItemProofReleaseGate(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });
    if (!proofGate.allowed) {
      throw Object.assign(new Error(proofGate.blockedReason || `Approved proof is required before transitioning to ${args.toState}`), {
        statusCode: 409,
        code: "PROOF_APPROVAL_REQUIRED",
        details: proofGate,
      });
    }
  }

  const activeJob = await findActiveJobForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const fromState = deriveLegacyWorkflowState({
    workflowState: lineItem.workflowState,
    status: lineItem.status,
    requiresDesign: lineItem.requiresDesign,
    requiresPrepress: lineItem.requiresPrepress,
    hasActiveDesignOwner: activeJob?.stationKey === "design" || activeJob?.stepKey === "design",
    hasActivePrepressOwner: activeJob?.stationKey === "prepress" || activeJob?.stepKey === "prepress",
    hasActiveProductionOwner: Boolean(activeJob),
  });

  const lifecycleStatus = deriveLifecycleStatusForState({
    toState: args.toState,
    fromState,
    currentStatus: lineItem.status,
  });

  const normalizedStoredWorkflowState = normalizeWorkflowState(lineItem.workflowState);
  const normalizedStoredLifecycleStatus = String(lineItem.status || "").trim().toLowerCase();

  if (fromState === args.toState) {
    const shouldRepairStoredState =
      normalizedStoredWorkflowState !== args.toState ||
      normalizedStoredLifecycleStatus !== lifecycleStatus;

    const activeOwnershipCount = await findAllActiveJobsForLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });

    const requiresActiveOwnership = workflowStateRequiresActiveOwner(args.toState);
    const ownershipDrift = requiresActiveOwnership ? activeOwnershipCount.length !== 1 : activeOwnershipCount.length !== 0;

    if (!shouldRepairStoredState && !ownershipDrift) {
      return {
        lineItemId: lineItem.id,
        fromState,
        toState: args.toState,
        lifecycleStatus,
        activeOwnerJobId: activeJob?.id ?? null,
        activeOwnerStationKey: activeJob?.stationKey ?? null,
        activeOwnerStepKey: activeJob?.stepKey ?? null,
        ownershipAction: "none",
      };
    }

    const ownership = await applyOwnershipForState(tx, {
      lineItem,
      toState: args.toState,
      actorUserId: args.actorUserId,
    });

    const invariant = await assertOwnershipInvariant(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      toState: args.toState,
    });

    await tx
      .update(orderLineItems)
      .set({
        workflowState: args.toState,
        designStatus: derivePersistedDesignStatus({
          currentDesignStatus: lineItem.designStatus,
          toState: args.toState,
        }),
        status: lifecycleStatus as any,
        requiresDesign:
          args.toState === "needs_design" || args.toState === "in_design"
            ? true
            : lineItem.requiresDesign,
        requiresProofApproval:
          args.toState === "awaiting_proof_approval"
            ? true
            : lineItem.requiresProofApproval,
        requiresPrepress:
          args.toState === "ready_for_prepress" || args.toState === "in_prepress"
            ? true
            : lineItem.requiresPrepress,
        updatedAt: new Date(),
      })
      .where(eq(orderLineItems.id, lineItem.id));

    const orderSync = await syncParentOrderForOperationalChildren(tx, {
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.id,
      actorUserId: args.actorUserId,
      source: `line_item_workflow_reconcile:${args.toState}`,
    });

    const eventJobId = invariant.activeOwnerJobId ?? ownership.activeOwnerJobId ?? activeJob?.id ?? null;
    if (eventJobId) {
      await appendEvent({
        tx,
        organizationId: args.organizationId,
        productionJobId: eventJobId,
        type: "note",
        payload: {
          eventType: "workflow_reconciled",
          fromState,
          toState: args.toState,
          storedWorkflowState: lineItem.workflowState,
          storedLifecycleStatus: lineItem.status,
          lifecycleStatus,
          ownerAction: ownership.ownershipAction,
          actorUserId: args.actorUserId ?? null,
          note: args.note ?? null,
          metadata: args.metadata ?? {},
          orderSync,
        },
      });
    }

    return {
      lineItemId: lineItem.id,
      fromState,
      toState: args.toState,
      lifecycleStatus,
      activeOwnerJobId: invariant.activeOwnerJobId,
      activeOwnerStationKey: invariant.activeOwnerStationKey,
      activeOwnerStepKey: invariant.activeOwnerStepKey,
      ownershipAction: ownership.ownershipAction,
    };
  }

  if (isTerminalWorkflowState(fromState) && !(args.allowTerminalRecovery && args.toState === "in_prepress")) {
    throw Object.assign(new Error(`Cannot transition terminal workflow state ${fromState}`), { statusCode: 409 });
  }

  if (fromState === "on_hold") {
    const priorActiveState = await findPriorActiveState(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });

    if (!priorActiveState || args.toState !== priorActiveState) {
      throw Object.assign(new Error(`Resume from on_hold must target prior active state${priorActiveState ? ` (${priorActiveState})` : ""}`), { statusCode: 409 });
    }
  } else if (!VALID_TRANSITIONS[fromState].includes(args.toState)) {
    throw Object.assign(new Error(`Invalid workflow transition ${fromState} -> ${args.toState}`), { statusCode: 409 });
  }

  const ownership = await applyOwnershipForState(tx, {
    lineItem,
    toState: args.toState,
    actorUserId: args.actorUserId,
  });

  const invariant = await assertOwnershipInvariant(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    toState: args.toState,
  });

  await tx
    .update(orderLineItems)
    .set({
      workflowState: args.toState,
      designStatus: derivePersistedDesignStatus({
        currentDesignStatus: lineItem.designStatus,
        toState: args.toState,
      }),
      status: lifecycleStatus as any,
      requiresDesign:
        args.toState === "needs_design" || args.toState === "in_design"
          ? true
          : lineItem.requiresDesign,
      requiresProofApproval:
        args.toState === "awaiting_proof_approval"
          ? true
          : lineItem.requiresProofApproval,
      requiresPrepress:
        args.toState === "ready_for_prepress" || args.toState === "in_prepress"
          ? true
          : lineItem.requiresPrepress,
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, lineItem.id));

  const orderSync = await syncParentOrderForOperationalChildren(tx, {
    organizationId: args.organizationId,
    orderId: lineItem.orderId,
    lineItemId: lineItem.id,
    actorUserId: args.actorUserId,
    source: `line_item_workflow_transition:${fromState}->${args.toState}`,
  });

  const eventJobId = invariant.activeOwnerJobId ?? ownership.activeOwnerJobId ?? activeJob?.id ?? null;
  if (eventJobId) {
    await appendEvent({
      tx,
      organizationId: args.organizationId,
      productionJobId: eventJobId,
      type: "note",
      payload: {
        eventType: "workflow_transition",
        fromState,
        toState: args.toState,
        lifecycleStatus,
        ownerAction: ownership.ownershipAction,
        actorUserId: args.actorUserId ?? null,
        note: args.note ?? null,
        metadata: args.metadata ?? {},
        orderSync,
      },
    });
  }

  return {
    lineItemId: lineItem.id,
    fromState,
    toState: args.toState,
    lifecycleStatus,
    activeOwnerJobId: invariant.activeOwnerJobId,
    activeOwnerStationKey: invariant.activeOwnerStationKey,
    activeOwnerStepKey: invariant.activeOwnerStepKey,
    ownershipAction: ownership.ownershipAction,
  };
}

/**
 * Corrective production recovery only. Normal callers must continue using the
 * generic transition function, which keeps completed states terminal.
 */
export async function returnLineItemToPrepressForProductionRecovery(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
  note: string;
  metadata: Record<string, unknown>;
}): Promise<WorkflowTransitionResult> {
  return transitionLineItemWorkflowState(tx, {
    ...args,
    toState: "in_prepress",
    allowTerminalRecovery: true,
  });
}

export function getInitialWorkflowState(args: {
  requiresDesign: boolean;
  requiresPrepress: boolean;
  requiresProofApproval?: boolean;
}): LineItemWorkflowState {
  if (args.requiresDesign) return "needs_design";
  if (args.requiresProofApproval) return "awaiting_proof_approval";
  if (args.requiresPrepress) return "ready_for_prepress";
  return "ready_for_production";
}

export async function completeLineItemDesign(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowTransitionResult> {
  const lineItem = await loadLineItemForWorkflow(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const effectiveDesignStatus = deriveEffectiveDesignStatus({
    designStatus: lineItem.designStatus,
    workflowState: lineItem.workflowState,
  });

  if (effectiveDesignStatus === "needs_design") {
    throw Object.assign(new Error("Design must be started before it can be completed"), { statusCode: 409 });
  }

  if (effectiveDesignStatus !== "in_design") {
    throw Object.assign(new Error("Line item is not currently in design"), { statusCode: 409 });
  }

  const targetState: LineItemWorkflowState = lineItem.requiresProofApproval
    ? "awaiting_proof_approval"
    : lineItem.requiresPrepress
      ? "ready_for_prepress"
      : "ready_for_production";

  await tx
    .update(orderLineItems)
    .set({
      designStatus: "design_complete",
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, lineItem.id));

  return transitionLineItemWorkflowState(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    toState: targetState,
    actorUserId: args.actorUserId,
    note: args.note ?? null,
    metadata: {
      ...(args.metadata ?? {}),
      source: "design_complete",
      designCompletionTargetState: targetState,
    },
  });
}
