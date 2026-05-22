import type { OptionSelection } from "@/features/quotes/editor/types";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import {
  buildInitialOrderLineItemDraftFromProduct,
  type InitialOrderLineItemDraftDebug,
} from "@shared/orderLineItemInitialization";

export type OrderLineItemSavedSnapshot = {
  productId: string;
  productVariantId: string | null;
  pbv2TreeVersionId: string;
  width: number;
  height: number;
  quantity: number;
  notes: string;
  productionNotes: string;
  requiresDesign: boolean;
  requiresPrepress: boolean;
  optionSelections: Record<string, OptionSelection>;
  optionSelectionsV2: LineItemOptionSelectionsV2["selected"];
  totalPrice: number;
};

export type OrderLineItemDraftSnapshot = {
  productId: string;
  productVariantId: string | null;
  pbv2TreeVersionId: string;
  width: number;
  height: number;
  quantity: number;
  notes: string;
  productionNotes: string;
  requiresDesign: boolean;
  requiresPrepress: boolean;
  optionSelections: Record<string, OptionSelection>;
  optionSelectionsV2: LineItemOptionSelectionsV2["selected"];
  isPbv2Mode: boolean;
  designBriefDraftJson: string;
  savedDesignBriefJson: string;
};

export type ProductReplacementDraft = {
  productId: string;
  productVariantId: string | null;
  width: string;
  height: string;
  quantity: number;
  requiresDesign?: boolean;
  requiresPrepress?: boolean;
  requiresProofApproval: boolean;
  optionSelections: Record<string, OptionSelection>;
  optionSelectionsV2: LineItemOptionSelectionsV2;
  pbv2SnapshotJson: null;
  computedTotal: null;
  computedTotalQty: null;
  debug: InitialOrderLineItemDraftDebug;
};

type ProductLike = Parameters<typeof buildInitialOrderLineItemDraftFromProduct>[0];

export function stableLineItemEditStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableLineItemEditStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableLineItemEditStringify(record[key])}`)
    .join(",")}}`;
}

export function normalizeVariantId(value: unknown): string | null {
  if (value === undefined || value === null || value === "" || value === "_none") return null;
  return String(value);
}

export function hasOrderLineItemDraftChanges(
  saved: OrderLineItemSavedSnapshot | undefined,
  draft: OrderLineItemDraftSnapshot,
): boolean {
  if (!saved) return true;

  const currentOptions = JSON.stringify(draft.optionSelections || {});
  const savedOptions = JSON.stringify(saved.optionSelections || {});
  const currentOptionsV2 = stableLineItemEditStringify(draft.optionSelectionsV2 || {});
  const savedOptionsV2 = stableLineItemEditStringify(saved.optionSelectionsV2 || {});

  return (
    draft.productId !== saved.productId ||
    normalizeVariantId(draft.productVariantId) !== normalizeVariantId(saved.productVariantId) ||
    draft.pbv2TreeVersionId !== saved.pbv2TreeVersionId ||
    Math.abs(draft.width - saved.width) > 0.01 ||
    Math.abs(draft.height - saved.height) > 0.01 ||
    draft.quantity !== saved.quantity ||
    draft.notes !== (saved.notes || "") ||
    draft.productionNotes !== (saved.productionNotes || "") ||
    draft.requiresDesign !== saved.requiresDesign ||
    draft.requiresPrepress !== saved.requiresPrepress ||
    (draft.isPbv2Mode ? currentOptionsV2 !== savedOptionsV2 : currentOptions !== savedOptions) ||
    draft.designBriefDraftJson !== draft.savedDesignBriefJson
  );
}

export function buildProductReplacementDraft({
  product,
  activeTree,
  orderId,
  currentQuantity,
}: {
  product: ProductLike;
  activeTree: OptionTreeV2 | null | undefined;
  orderId: string;
  currentQuantity: number;
}): ProductReplacementDraft {
  const initialDraft = buildInitialOrderLineItemDraftFromProduct(product, activeTree, orderId);
  const quantity = Number.isFinite(currentQuantity) && currentQuantity > 0 ? currentQuantity : initialDraft.quantity;

  return {
    productId: product.id,
    productVariantId: null,
    width: String(initialDraft.width),
    height: String(initialDraft.height),
    quantity,
    requiresDesign: initialDraft.requiresDesign,
    requiresPrepress: initialDraft.requiresPrepress,
    requiresProofApproval: initialDraft.requiresProofApproval,
    optionSelections: {},
    optionSelectionsV2: initialDraft.optionSelectionsJson ?? { schemaVersion: 2, selected: {} },
    pbv2SnapshotJson: null,
    computedTotal: null,
    computedTotalQty: null,
    debug: initialDraft.debug,
  };
}

export function buildSavedSnapshotAfterLineItemSave({
  savedLineItem,
  fallback,
}: {
  savedLineItem: any;
  fallback: OrderLineItemSavedSnapshot;
}): OrderLineItemSavedSnapshot {
  return {
    ...fallback,
    productId: String(savedLineItem?.productId ?? fallback.productId),
    productVariantId: normalizeVariantId(savedLineItem?.productVariantId ?? fallback.productVariantId),
    pbv2TreeVersionId: String(
      savedLineItem?.pbv2TreeVersionId ??
        savedLineItem?.pbv2ActiveTreeVersionId ??
        savedLineItem?.pbv2SnapshotJson?.treeVersionId ??
        fallback.pbv2TreeVersionId ??
        "",
    ),
    totalPrice: Number.isFinite(Number(savedLineItem?.totalPrice))
      ? Number(savedLineItem.totalPrice)
      : fallback.totalPrice,
  };
}
