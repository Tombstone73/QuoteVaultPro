import { and, eq } from "drizzle-orm";
import { isTerminalProductionStatus } from "@shared/operationalState";
import { auditLogs, orderLineItems, orders, productionJobs, products } from "@shared/schema";
import { db } from "../db";
import { completeProductionJobWorkflow, updateProductionJobStatusWorkflow } from "../routes/productionJobs.routes";
import { listProductionExecutionConflicts } from "./productionBypassConflictService";
import { requiresCanonicalProductionCompletion } from "./orderProductionCompletionPolicy";

export type ProductionBypassResolution = "production_completed" | "production_not_required";

/** Administrative resolution of one bypassed physical line's impossible active owner. */
export async function reconcileProductionBypassConflict(input: {
  organizationId: string; orderId: string; lineItemId: string; jobId: string;
  actorUserId: string; actorName?: string | null; resolution: ProductionBypassResolution;
  reason: string; note?: string | null; ipAddress?: string | null; userAgent?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders)
      .where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).limit(1);
    if (!order) throw Object.assign(new Error("Order not found."), { statusCode: 404 });
    const [line] = await tx.select().from(orderLineItems)
      .where(and(eq(orderLineItems.id, input.lineItemId), eq(orderLineItems.orderId, input.orderId)))
      .for("update").limit(1);
    if (!line) throw Object.assign(new Error("Order line not found."), { statusCode: 404 });
    if (line.lineItemRole === "parent" || !line.productionBypassed) {
      throw Object.assign(new Error("This line is no longer a bypassed physical production line."), { statusCode: 409, code: "PRODUCTION_CONFLICT_RESOLVED" });
    }
    const [product] = await tx.select({ requiresProductionJob: products.requiresProductionJob, workflowIntent: products.workflowIntent })
      .from(products).where(and(eq(products.id, line.productId), eq(products.organizationId, input.organizationId))).limit(1);
    if (!product || !requiresCanonicalProductionCompletion({
      productionBypassed: false, lineItemRole: line.lineItemRole,
      requiresProductionJob: product.requiresProductionJob, workflowIntent: product.workflowIntent,
    })) throw Object.assign(new Error("This line has no canonical physical production obligation to reconcile."), { statusCode: 409 });
    const [job] = await tx.select().from(productionJobs)
      .where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.orderId, input.orderId), eq(productionJobs.lineItemId, input.lineItemId), eq(productionJobs.id, input.jobId)))
      .for("update").limit(1);
    if (!job || isTerminalProductionStatus(job.status) || String(job.stationKey).toLowerCase() === "fulfillment") {
      throw Object.assign(new Error("The production owner has already been resolved or is not eligible."), { statusCode: 409, code: "PRODUCTION_CONFLICT_RESOLVED" });
    }
    if (job.completedAt) throw Object.assign(new Error("The active job has prior completion evidence; review it before reconciliation."), { statusCode: 409, code: "PRODUCTION_HISTORY_CONFLICT" });
    if (input.resolution === "production_completed" && !job.startedAt) {
      throw Object.assign(new Error("This job has no production start evidence. Verify the work before choosing completed production."), { statusCode: 409, code: "PRODUCTION_START_EVIDENCE_REQUIRED" });
    }
    const conflicts = await listProductionExecutionConflicts(tx, input.organizationId, input.orderId, [line.id]);
    if (conflicts.some((conflict) => conflict.runId) || conflicts.filter((conflict) => conflict.jobId).length !== 1 || conflicts[0]?.jobId !== job.id) {
      throw Object.assign(new Error("This line has multiple production owners or an active Combined Run; resolve those through their canonical workflows."), { statusCode: 409, code: "PRODUCTION_CONFLICT_MULTIPLE_OWNERS" });
    }

    const previousState = {
      orderId: order.id, orderNumber: order.orderNumber, lineItemId: line.id, jobId: job.id,
      productionBypassed: line.productionBypassed, productionBypassReason: line.productionBypassReason,
      productionBypassedAt: line.productionBypassedAt, workflowState: line.workflowState,
      lineStatus: line.status, jobStatus: job.status, stationKey: job.stationKey,
      jobStartedAt: job.startedAt, jobCompletedAt: job.completedAt, runningTimer: conflicts[0].runningTimer,
    };
    let resolvedJob: typeof job;
    if (input.resolution === "production_completed") {
      // Real production cannot remain marked as bypassed. Restore its canonical
      // production obligation before invoking the existing completion workflow.
      await tx.update(orderLineItems).set({
        productionBypassed: false, productionBypassReason: null,
        productionBypassedAt: null, productionBypassedByUserId: null,
        workflowState: "in_production", updatedAt: new Date(),
      }).where(and(eq(orderLineItems.id, line.id), eq(orderLineItems.orderId, order.id)));
      resolvedJob = await completeProductionJobWorkflow(tx, {
        organizationId: input.organizationId, userId: input.actorUserId, jobId: job.id,
        skipProduction: false, auditUserName: input.actorName,
        ipAddress: input.ipAddress, userAgent: input.userAgent,
      });
    } else {
      // Canonical cancellation now closes an open timer in the same transaction.
      resolvedJob = await updateProductionJobStatusWorkflow(tx, {
        organizationId: input.organizationId, userId: input.actorUserId, jobId: job.id,
        status: "canceled", reason: input.reason, auditUserName: input.actorName,
        ipAddress: input.ipAddress, userAgent: input.userAgent,
      });
    }
    const [afterLine] = await tx.select({ productionBypassed: orderLineItems.productionBypassed, workflowState: orderLineItems.workflowState, status: orderLineItems.status })
      .from(orderLineItems).where(eq(orderLineItems.id, line.id)).limit(1);
    const [audit] = await tx.insert(auditLogs).values({
      organizationId: input.organizationId, userId: input.actorUserId, userName: input.actorName || null,
      actionType: "PRODUCTION_BYPASS_CONFLICT_RECONCILED", entityType: "order_line_item", entityId: line.id,
      entityName: line.description || line.id, description: `Production state reconciliation: ${input.resolution}. ${input.reason}`,
      oldValues: previousState,
      newValues: {
        resolution: input.resolution, reason: input.reason, note: input.note || null,
        orderId: order.id, lineItemId: line.id, jobId: job.id,
        productionBypassed: afterLine?.productionBypassed, workflowState: afterLine?.workflowState,
        lineStatus: afterLine?.status, jobStatus: resolvedJob.status,
        jobCompletedAt: resolvedJob.completedAt, reconciledAt: new Date().toISOString(),
      },
      ipAddress: input.ipAddress || null, userAgent: input.userAgent || null,
    } as any).returning({ id: auditLogs.id });
    return { orderId: order.id, lineItemId: line.id, jobId: job.id, resolution: input.resolution, auditId: audit.id, jobStatus: resolvedJob.status };
  });
}
