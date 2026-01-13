import type { ChildItemProposal } from "@shared/pbv2/pricingAdapter";
import type { InsertOrderLineItemComponent } from "@shared/schema";
import { assignEffectIndexFallback } from "@shared/pbv2/pbv2EffectIndex";

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

export { assignEffectIndexFallback };
