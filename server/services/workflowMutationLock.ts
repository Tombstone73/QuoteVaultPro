import { and, eq, inArray } from "drizzle-orm";
import { orderLineItems, orders, lineItemProofVersions, proofVersionLineItems } from "@shared/schema";

/** Transaction-only: serialize decisions before reading mutable workflow/proof authority. */
export async function lockWorkflowLines(tx: any, organizationId: string, lineItemIds: string[]) {
  const ids = [...new Set(lineItemIds)].sort();
  if (!ids.length) return;
  const rows = await tx.select({ id: orderLineItems.id }).from(orderLineItems)
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(and(eq(orders.organizationId, organizationId), inArray(orderLineItems.id, ids)))
    .orderBy(orderLineItems.id).for("update", { of: orderLineItems });
  if (rows.length !== ids.length) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }
}

export async function lockProofWorkflowLines(tx: any, organizationId: string, proofVersionId: string) {
  const [version] = await tx.select({ lineItemId: lineItemProofVersions.lineItemId })
    .from(lineItemProofVersions).where(and(eq(lineItemProofVersions.organizationId, organizationId), eq(lineItemProofVersions.id, proofVersionId)));
  if (!version) throw Object.assign(new Error("Proof version not found"), { statusCode: 404 });
  const members = await tx.select({ lineItemId: proofVersionLineItems.lineItemId }).from(proofVersionLineItems)
    .where(and(eq(proofVersionLineItems.organizationId, organizationId), eq(proofVersionLineItems.proofVersionId, proofVersionId)));
  await lockWorkflowLines(tx, organizationId, [version.lineItemId, ...members.map((row: any) => row.lineItemId)]);
}
