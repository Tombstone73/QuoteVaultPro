import { createHash } from "node:crypto";
import { and, eq, desc, or, sql } from "drizzle-orm";

import { orderLineItems, orders, lineItemProofVersions, lineItemArtwork, lineItemProofEarlyReleases } from "@shared/schema";
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
  currentRevision?: { proofVersionId: string; proofFileId: string; status: string; createdAt: string; artworkFingerprint: string } | null;
  earlyRelease?: { id: string; proofVersionId: string; reason: string; actorUserId: string; authorizedAt: string; artworkFingerprint: string } | null;
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
  const currentRevision = requiresProofApproval && !bypassed ? await resolveCurrentProofRevision(tx, args) : null;
  let approved = Boolean(row.approvedProofVersionId) && (!currentRevision || (currentRevision.proofVersionId === row.approvedProofVersionId && currentRevision.status === "approved"));
  const authorizations = currentRevision && ["awaiting_response", "approved"].includes(currentRevision.status) ? await tx.select().from(lineItemProofEarlyReleases).where(and(
    eq(lineItemProofEarlyReleases.organizationId, args.organizationId), eq(lineItemProofEarlyReleases.orderId, row.orderId),
    eq(lineItemProofEarlyReleases.lineItemId, args.lineItemId), eq(lineItemProofEarlyReleases.proofVersionId, currentRevision.proofVersionId),
    eq(lineItemProofEarlyReleases.proofFileId, currentRevision.proofFileId),
  )).orderBy(desc(lineItemProofEarlyReleases.authorizedAt)) : [];
  // An approval of an early-released proof never expands its reviewed artwork scope.
  if (approved && authorizations.length && authorizations[0].artworkFingerprint !== currentRevision?.artworkFingerprint) approved = false;
  const authorization = currentRevision?.status === "awaiting_response" ? authorizations.find((entry: any) => entry.artworkFingerprint === currentRevision.artworkFingerprint) : null;
  const earlyRelease = authorization ? { id: authorization.id, proofVersionId: authorization.proofVersionId,
    reason: authorization.reason, actorUserId: authorization.actorUserId, authorizedAt: new Date(authorization.authorizedAt).toISOString(), artworkFingerprint: authorization.artworkFingerprint } : null;
  const allowed = bypassed || !requiresProofApproval || approved || Boolean(earlyRelease);

  return {
    lineItemId: row.lineItemId,
    orderId: row.orderId,
    policyOverride,
    requiresProofApproval,
    approvedProofVersionId: row.approvedProofVersionId ?? null,
    approved,
    currentRevision,
    earlyRelease,
    bypassed,
    allowed,
    blockedReason: allowed ? null : "Cannot release to production until proof approved",
    bypassReason: row.bypassReason ?? null,
    bypassedAt: row.bypassedAt ? new Date(row.bypassedAt as any).toISOString() : null,
    bypassedByUserId: row.bypassedByUserId ?? null,
  };
}


/** Identity includes the exact proof artifact and current canonical artwork relationships. */
export async function resolveCurrentProofRevision(tx: any, args: { organizationId: string; lineItemId: string }) {
  const [version] = await tx.select().from(lineItemProofVersions).where(and(
    eq(lineItemProofVersions.organizationId, args.organizationId),
    or(eq(lineItemProofVersions.lineItemId, args.lineItemId), sql`exists (select 1 from proof_version_line_items m where m.organization_id = ${args.organizationId} and m.proof_version_id = ${lineItemProofVersions.id} and m.line_item_id = ${args.lineItemId})`),
  )).orderBy(desc(lineItemProofVersions.createdAt), desc(lineItemProofVersions.versionNumber), desc(lineItemProofVersions.id)).limit(1);
  if (!version) return null;
  const artwork = await tx.select({ id: lineItemArtwork.id, fileRecordId: lineItemArtwork.fileRecordId,
    role: lineItemArtwork.role, side: lineItemArtwork.side, allocationQuantity: lineItemArtwork.allocationQuantity, allocationGroupId: lineItemArtwork.allocationGroupId }).from(lineItemArtwork)
    .where(and(eq(lineItemArtwork.organizationId, args.organizationId), eq(lineItemArtwork.lineItemId, args.lineItemId), eq(lineItemArtwork.status, "current"))).orderBy(lineItemArtwork.id);
  const [productionInput] = await tx.select({ productId: orderLineItems.productId, quantity: orderLineItems.quantity,
    width: orderLineItems.width, height: orderLineItems.height, selectedOptions: orderLineItems.selectedOptions,
    optionSelectionsJson: orderLineItems.optionSelectionsJson }).from(orderLineItems).where(eq(orderLineItems.id, args.lineItemId));
  const artworkFingerprint = createHash("sha256").update(JSON.stringify({ proofVersionId: version.id, proofFileId: version.proofFileId, artwork, productionInput })).digest("hex");
  return { proofVersionId: version.id, proofFileId: version.proofFileId, status: version.status, createdAt: new Date(version.createdAt).toISOString(), artworkFingerprint };
}
