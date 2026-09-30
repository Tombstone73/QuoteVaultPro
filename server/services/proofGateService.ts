import { and, eq } from "drizzle-orm";

import { orderLineItems, orders } from "@shared/schema";
import { lockWorkflowLines } from "./workflowMutationLock";
import { isPhysicalProductionDestination } from "./orderCreditHoldService";

export type OrderProofApprovalPolicyOverride = "inherit_default" | "force_required" | "bypass";

export type ProofReleaseGate = {
  lineItemId: string;
  orderId: string;
  policyOverride: OrderProofApprovalPolicyOverride;
  requiresProofApproval: boolean;
  approvedProofVersionId: string | null;
  approved: boolean;
  bypassed: boolean;
  allowed: boolean;
  blockedReason: string | null;
  bypassReason: string | null;
  bypassedAt: string | null;
  bypassedByUserId: string | null;
};

function normalizePolicyOverride(value: unknown): OrderProofApprovalPolicyOverride {
  const normalized = String(value ?? "inherit_default").trim().toLowerCase();
  if (normalized === "force_required" || normalized === "bypass") return normalized;
  return "inherit_default";
}

/** Direct routing must honor the same current authority as workflow transitions. Transaction only. */
export async function assertPhysicalProductionProofGate(tx: any, args: {
  organizationId: string; lineItemId: string; stationKey?: string | null; stepKey?: string | null;
}) {
  if (!isPhysicalProductionDestination(args)) return;
  await lockWorkflowLines(tx, args.organizationId, [args.lineItemId]);
  const [line] = await tx.select({ designStatus: orderLineItems.designStatus, workflowState: orderLineItems.workflowState })
    .from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(and(eq(orders.organizationId, args.organizationId), eq(orderLineItems.id, args.lineItemId)));
  if (!line) throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  // Match workflow precedence: completion updates designStatus before moving workflowState.
  const designStatus = String(line.designStatus ?? "").trim().toLowerCase();
  const effectiveDesignStatus = ["needs_design", "in_design", "design_complete", "bypassed"].includes(designStatus)
    ? designStatus : String(line.workflowState ?? "").trim().toLowerCase();
  if (["needs_design", "in_design"].includes(effectiveDesignStatus)) {
    throw Object.assign(new Error("Design must be completed before routing to production"), { statusCode: 409, code: "DESIGN_COMPLETION_REQUIRED" });
  }
  const gate = await resolveLineItemProofReleaseGate(tx, args);
  if (!gate.allowed) throw Object.assign(new Error(gate.blockedReason!), { statusCode: 409, code: "PROOF_APPROVAL_REQUIRED", details: gate });
}

export async function resolveLineItemProofReleaseGate(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<ProofReleaseGate> {
  const [row] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      policyOverride: orders.proofApprovalPolicyOverride,
      bypassReason: orders.proofApprovalOverrideReason,
      bypassedAt: orders.proofApprovalOverrideAt,
      bypassedByUserId: orders.proofApprovalOverrideByUserId,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }

  const policyOverride = normalizePolicyOverride(row.policyOverride);
  const bypassed = policyOverride === "bypass";
  const requiresProofApproval = policyOverride === "force_required" || Boolean(row.requiresProofApproval);
  const approved = Boolean(row.approvedProofVersionId);
  const allowed = bypassed || !requiresProofApproval || approved;

  return {
    lineItemId: row.lineItemId,
    orderId: row.orderId,
    policyOverride,
    requiresProofApproval,
    approvedProofVersionId: row.approvedProofVersionId ?? null,
    approved,
    bypassed,
    allowed,
    blockedReason: allowed ? null : "Cannot release to production until proof approved",
    bypassReason: row.bypassReason ?? null,
    bypassedAt: row.bypassedAt ? new Date(row.bypassedAt as any).toISOString() : null,
    bypassedByUserId: row.bypassedByUserId ?? null,
  };
}

