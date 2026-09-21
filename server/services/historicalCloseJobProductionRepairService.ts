import { and, eq, inArray, notInArray } from "drizzle-orm";

import {
  auditLogs,
  customers,
  fulfillmentEvents,
  orderLineItems,
  orders,
  productionJobs,
  productionRunMembers,
  productionRuns,
  products,
} from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";

import { bypassOrderProductionPrerequisites } from "../routes/orders.routes";
import { completeProductionJobWorkflow } from "../routes/productionJobs.routes";
import { listOrderProductionPrerequisitesToBypass } from "./orderProductionCompletionPolicy";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import { isProvenLegacyCloseJobOverrideEvidence } from "./fulfillment/legacyCloseJobOverrideEvidence";

const TERMINAL_JOB_STATUSES = ["done", "void", "canceled", "cancelled"] as const;
const REPAIR_AUDIT_ACTION = "ORDER_HISTORICAL_CLOSE_JOB_PRODUCTION_REPAIRED";

/** The CLI injects native node-postgres Drizzle; apply reuses that handle's transaction. */
type Runner = any;

export type HistoricalProductionRepairPreview = {
  organizationId: string;
  orderId: string;
  found: boolean;
  orderNumber: string | null;
  customerName: string | null;
  orderState: string | null;
  orderStatus: string | null;
  fulfillmentStatus: string | null;
  safe: boolean;
  alreadyRepaired: boolean;
  blockers: string[];
  originalEvidence: { eventId: string; auditId: string; actorUserId: string | null } | null;
  productionCompleteQuantity: number;
  requiredProductionQuantity: number;
  proposedAdministrativeProductionQuantity: number;
  targetLines: Array<{ lineItemId: string; description: string; quantity: number; productionCompleteQuantity: number }>;
};

function clean(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function inspect(runner: Runner, organizationId: string, orderId: string, lock = false): Promise<HistoricalProductionRepairPreview> {
  const orderQuery = runner
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      state: orders.state,
      status: orders.status,
      fulfillmentStatus: orders.fulfillmentStatus,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
    .limit(1);
  const [order] = lock ? await orderQuery.for("update") : await orderQuery;
  if (!order) {
    return {
      organizationId, orderId, found: false, orderNumber: null, customerName: null, orderState: null, orderStatus: null, fulfillmentStatus: null,
      safe: false, alreadyRepaired: false, blockers: ["ORDER_NOT_FOUND"], originalEvidence: null,
      productionCompleteQuantity: 0, requiredProductionQuantity: 0, proposedAdministrativeProductionQuantity: 0, targetLines: [],
    };
  }

  // Base existence is determined only by the organization UUID and Order UUID.
  // Customer data is display-only and must never suppress a valid base order.
  const [customer] = order.customerId
    ? await runner.select({ customerName: customers.companyName }).from(customers).where(eq(customers.id, order.customerId)).limit(1)
    : [null];

  const [events, audits, lineRows] = await Promise.all([
    runner.select({ id: fulfillmentEvents.id, actorUserId: fulfillmentEvents.actorUserId, eventType: fulfillmentEvents.eventType, payloadJson: fulfillmentEvents.payloadJson })
      .from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, organizationId), eq(fulfillmentEvents.entityType, "ORDER"), eq(fulfillmentEvents.entityId, orderId))),
    runner.select({ id: auditLogs.id, actionType: auditLogs.actionType, entityType: auditLogs.entityType })
      .from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, orderId))),
    runner.select({ id: orderLineItems.id, description: orderLineItems.description, quantity: orderLineItems.quantity })
      .from(orderLineItems).where(eq(orderLineItems.orderId, orderId)),
  ]);
  const pairedAudit = audits.find((audit: any) => audit.actionType === "ORDER_HISTORICAL_FULFILLMENT_RECONCILED" && audit.entityType === "order") ?? null;
  const evidenceEvent = events.find((event: any) => isProvenLegacyCloseJobOverrideEvidence({ event, audit: pairedAudit })) ?? null;
  const repairAudit = audits.find((audit: any) => audit.actionType === REPAIR_AUDIT_ACTION) ?? null;
  const repository = new FulfillmentDashboardRepo(runner as any);
  const projections = await repository.listLineEligibility(organizationId, { orderIds: [orderId] }, runner as any);
  const candidateProjection = projections.filter((line) => line.projection.productionRequired && line.projection.productionCompleteQuantity < line.projection.orderedQuantity);
  const lineById = new Map(lineRows.map((line: any) => [line.id, line]));
  const targetLines = candidateProjection.map((line) => ({
    lineItemId: line.id,
    description: lineById.get(line.id)?.description ?? line.id,
    quantity: line.projection.orderedQuantity,
    productionCompleteQuantity: line.projection.productionCompleteQuantity,
  }));
  const targetIds = targetLines.map((line) => line.lineItemId);
  const [activeJobs, activeRuns] = targetIds.length ? await Promise.all([
    runner.select({ id: productionJobs.id }).from(productionJobs).where(and(
      eq(productionJobs.organizationId, organizationId), inArray(productionJobs.lineItemId, targetIds), notInArray(productionJobs.status, [...TERMINAL_JOB_STATUSES]),
    )),
    runner.select({ id: productionRuns.id }).from(productionRuns)
      .innerJoin(productionRunMembers, eq(productionRunMembers.productionRunId, productionRuns.id))
      .where(and(eq(productionRunMembers.organizationId, organizationId), inArray(productionRunMembers.orderLineItemId, targetIds), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]))),
  ]) : [[], []];
  const blockers: string[] = [];
  if (clean(order.state) !== "production_complete") blockers.push("PARENT_NOT_HISTORICAL_PRODUCTION_COMPLETE");
  if (!evidenceEvent || !pairedAudit) blockers.push("UNPROVEN_LEGACY_CLOSE_JOB_OVERRIDE");
  if (!evidenceEvent?.actorUserId) blockers.push("LEGACY_ACTOR_REQUIRED");
  if (activeJobs.length) blockers.push("ACTIVE_PRODUCTION_OWNER_CONFLICT");
  if (activeRuns.length) blockers.push("ACTIVE_COMBINED_RUN_CONFLICT");
  const requiredProductionQuantity = projections.filter((line) => line.projection.productionRequired).reduce((sum, line) => sum + line.projection.orderedQuantity, 0);
  const productionCompleteQuantity = projections.filter((line) => line.projection.productionRequired).reduce((sum, line) => sum + line.projection.productionCompleteQuantity, 0);
  const proposedAdministrativeProductionQuantity = targetLines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.productionCompleteQuantity), 0);
  const alreadyRepaired = targetLines.length === 0 && Boolean(repairAudit);
  if (targetLines.length === 0 && !alreadyRepaired) blockers.push("NO_REPAIRABLE_MISSING_PRODUCTION_LINES");

  return {
    organizationId, orderId, found: true, orderNumber: order.orderNumber ?? null, customerName: customer?.customerName ?? null, orderState: order.state ?? null, orderStatus: order.status ?? null,
    fulfillmentStatus: order.fulfillmentStatus ?? null, safe: blockers.length === 0, alreadyRepaired, blockers, productionCompleteQuantity,
    requiredProductionQuantity, proposedAdministrativeProductionQuantity, targetLines,
    originalEvidence: evidenceEvent && pairedAudit ? { eventId: evidenceEvent.id, auditId: pairedAudit.id, actorUserId: evidenceEvent.actorUserId ?? null } : null,
  };
}

/** Read-only, UUID-first inspection. Public order numbers are display data only. */
export async function previewHistoricalCloseJobProductionRepair(database: Runner, input: { organizationId: string; orderId: string }) {
  return inspect(database, input.organizationId, input.orderId);
}

/**
 * Repairs only unowned, incomplete production lines after proving the original
 * Close Job Override. It deliberately leaves the terminal parent unchanged.
 */
export async function applyHistoricalCloseJobProductionRepair(database: Runner, input: { organizationId: string; orderId: string }) {
  return database.transaction(async (tx: Runner) => {
    const preview = await inspect(tx, input.organizationId, input.orderId, true);
    if (preview.alreadyRepaired) return { status: "already_repaired" as const, preview };
    if (!preview.safe || !preview.originalEvidence) {
      throw Object.assign(new Error(`Historical production repair is not safe: ${preview.blockers.join(", ")}`), { code: "HISTORICAL_PRODUCTION_REPAIR_BLOCKED", preview });
    }
    const [parent] = await tx.select({ state: orders.state, status: orders.status, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).for("update").limit(1);
    const lineDetails = await tx.select({
      id: orderLineItems.id,
      workflowState: orderLineItems.workflowState,
      status: orderLineItems.status,
      description: orderLineItems.description,
      designStatus: orderLineItems.designStatus,
      requiresDesign: orderLineItems.requiresDesign,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      requiresPrepress: orderLineItems.requiresPrepress,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      productType: orderLineItems.productType,
      productTypeId: products.productTypeId,
    })
      .from(orderLineItems).innerJoin(products, eq(products.id, orderLineItems.productId))
      .where(and(eq(orderLineItems.orderId, input.orderId), inArray(orderLineItems.id, preview.targetLines.map((line) => line.lineItemId))))
      .for("update");
    if (lineDetails.length !== preview.targetLines.length) {
      throw Object.assign(new Error("A historical production target line no longer has a canonical product route."), {
        code: "HISTORICAL_PRODUCTION_TARGET_DRIFT",
      });
    }
    const completedJobIds: string[] = [];
    for (const line of lineDetails) {
      const bypassedStages = listOrderProductionPrerequisitesToBypass(line);
      const owner = await bypassOrderProductionPrerequisites(tx, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        line,
        activePrerequisiteJob: null,
        bypassedStages,
        actorUserId: preview.originalEvidence.actorUserId!,
        actorUserName: null,
        closeJobOverride: true,
        productionBootstrap: true,
        historicalRepairEvidence: {
          eventId: preview.originalEvidence.eventId,
          auditId: preview.originalEvidence.auditId,
        },
      });
      if (owner.outcome !== "created") throw Object.assign(new Error("Production bootstrap did not create a missing owner."), { code: "PRODUCTION_BOOTSTRAP_NOT_CREATED", lineItemId: line.id });
      await completeProductionJobWorkflow(tx, {
        organizationId: input.organizationId, userId: preview.originalEvidence.actorUserId!, jobId: owner.jobId, skipProduction: "auto",
        manualOverride: { source: "close_job_override_production_bootstrap", bypassedPrerequisites: bypassedStages },
        auditUserName: null, historicalTerminalRepair: { orderId: input.orderId },
      });
      completedJobIds.push(owner.jobId);
    }
    const [after] = await tx.select({ state: orders.state, status: orders.status, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).limit(1);
    if (after?.state !== parent?.state || after?.status !== parent?.status || after?.fulfillmentStatus !== parent?.fulfillmentStatus) {
      throw Object.assign(new Error("Historical production repair changed the terminal parent."), { code: "PARENT_STATE_CHANGED" });
    }
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId, userId: preview.originalEvidence.actorUserId, actionType: REPAIR_AUDIT_ACTION, entityType: "order", entityId: input.orderId,
      entityName: preview.orderNumber, description: "Historical Close Job Override production repair completed without reopening the parent order.",
      newValues: { source: "close_job_override_production_bootstrap", historicalRepair: true, originalEvidence: preview.originalEvidence, targetLines: preview.targetLines, completedJobIds },
    } as any);
    return { status: "applied" as const, preview, completedJobIds };
  });
}
