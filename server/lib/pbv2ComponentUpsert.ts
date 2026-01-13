import type { ChildItemProposal } from "@shared/pbv2/pricingAdapter";
import type { InsertOrderLineItemComponent } from "@shared/schema";

export type BuildOrderLineItemComponentUpsertArgs = {
  organizationId: string;
  orderId: string;
  orderLineItemId: string;
  treeVersionId: string;
  proposal: ChildItemProposal & { effectIndex: number };
  now?: Date;
  createdByUserId?: string | null;
};

export function buildOrderLineItemComponentUpsertValues(
  args: BuildOrderLineItemComponentUpsertArgs,
): InsertOrderLineItemComponent {
  const { organizationId, orderId, orderLineItemId, treeVersionId, proposal } = args;
  const now = args.now ?? new Date();

  const qty = Number(proposal.qty);
  if (!Number.isFinite(qty)) {
    throw new Error("PBV2 component qty must be a finite number");
  }
  if (qty < 0) {
    throw new Error("PBV2 component qty must be >= 0");
  }

  const effectIndex = Number(proposal.effectIndex);
  if (!Number.isFinite(effectIndex)) {
    throw new Error("PBV2 component effectIndex must be present and finite");
  }

  const unitPriceCents =
    typeof proposal.unitPriceCents === "number" && Number.isFinite(proposal.unitPriceCents)
      ? proposal.unitPriceCents
      : undefined;

  const amountCents =
    typeof proposal.amountCents === "number" && Number.isFinite(proposal.amountCents)
      ? proposal.amountCents
      : undefined;

  const base: InsertOrderLineItemComponent = {
    organizationId,
    orderId,
    orderLineItemId,
    status: "ACCEPTED",
    source: "PBV2",
    kind: proposal.kind,
    title: proposal.title,
    skuRef: proposal.kind === "inlineSku" ? (proposal.skuRef ?? null) : null,
    childProductId: proposal.kind === "productRef" ? (proposal.childProductId ?? null) : null,
    qty: qty.toFixed(2),
    invoiceVisibility: proposal.invoiceVisibility,
    pbv2TreeVersionId: treeVersionId,
    pbv2SourceNodeId: proposal.sourceNodeId,
    pbv2EffectIndex: Math.trunc(effectIndex),
    createdByUserId: args.createdByUserId ?? null,
    updatedAt: now,
  };

  if (unitPriceCents !== undefined) (base as any).unitPriceCents = unitPriceCents;
  if (amountCents !== undefined) (base as any).amountCents = amountCents;

  return base;
}

export function assignEffectIndexFallback(childItems: ChildItemProposal[]): (ChildItemProposal & { effectIndex: number })[] {
  const items = childItems.map((ci, originalIndex) => ({ ci, originalIndex }));

  // Determine which sourceNodeId groups need fallback.
  const needsFallbackBySourceNodeId: Record<string, boolean> = {};
  for (const { ci } of items) {
    const key = String(ci.sourceNodeId || "");
    if (!key) continue;
    const hasIndex = typeof ci.effectIndex === "number" && Number.isFinite(ci.effectIndex);
    if (!hasIndex) needsFallbackBySourceNodeId[key] = true;
  }

  // Stable ordering independent of object/map iteration order.
  const sorted = [...items].sort((a, b) => {
    const aKey = String(a.ci.sourceNodeId || "");
    const bKey = String(b.ci.sourceNodeId || "");
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return a.originalIndex - b.originalIndex;
  });

  const nextIndexBySourceNodeId: Record<string, number> = {};
  const assignedByOriginalIndex = new Map<number, number>();

  for (const { ci, originalIndex } of sorted) {
    const key = String(ci.sourceNodeId || "");
    if (!key) continue;

    if (!needsFallbackBySourceNodeId[key]) {
      const existing = typeof ci.effectIndex === "number" && Number.isFinite(ci.effectIndex) ? Math.trunc(ci.effectIndex) : 0;
      assignedByOriginalIndex.set(originalIndex, existing);
      continue;
    }

    const next = nextIndexBySourceNodeId[key] ?? 0;
    assignedByOriginalIndex.set(originalIndex, next);
    nextIndexBySourceNodeId[key] = next + 1;
  }

  return items.map(({ ci, originalIndex }) => ({
    ...ci,
    effectIndex: assignedByOriginalIndex.get(originalIndex) ?? 0,
  }));
}
