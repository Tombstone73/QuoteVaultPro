import { and, eq } from "drizzle-orm";

import { orderLineItems, orders } from "@shared/schema";

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

