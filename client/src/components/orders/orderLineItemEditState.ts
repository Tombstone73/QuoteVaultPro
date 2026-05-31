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

export type OrderLineItemPreviewGateInput = {
  requestId: number;
  latestRequestId: number;
  requestFingerprint: string;
  currentFingerprint: string;
  isDirtyByUser: boolean;
  requestedBecauseOfUserChange: boolean;
  hasPendingManualOverride: boolean;
};

export type OrderLineItemPreviewGateResult = {
  apply: boolean;
  reasonIgnored: string | null;
};

export type LineItemPatchKind = "attachment" | "hydration" | "product_add" | "pricing" | "generic";

type ProductLike = Parameters<typeof buildInitialOrderLineItemDraftFromProduct>[0];

const PRICE_DISPLAY_FIELDS = [
  "linePrice",
  "formulaLinePrice",
  "priceBreakdown",
  "pbv2SnapshotJson",
  "pricedAt",
  "materialUsages",
  "unitPrice",
  "totalPrice",
  "baseCalculatedUnitPriceCents",
  "baseCalculatedTotalCents",
  "effectiveUnitPriceCents",
  "effectiveTotalCents",
  "priceOverride",
  "priceOverrideMode",
  "priceOverrideValueCents",
  "priceOverrideValuePercent",
  "overridePriceCents",
  "overrideAt",
  "overrideByUserId",
  "overrideReason",
  "hasPriceOverride",
] as const;

const ATTACHMENT_PATCH_FIELDS = new Set([
  "attachments",
  "files",
  "assets",
  "fileCount",
  "attachmentCount",
  "thumbUrl",
  "thumbnailUrl",
  "previewUrl",
  "previewThumbnailUrl",
  "attachmentsSummary",
  "updatedAt",
]);

function getLineItemMergeKey(item: Record<string, any>): string {
  return String(item?.tempId ?? item?.id ?? "");
}

function getRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function dollarsToCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n === null ? null : Math.round(n * 100);
}

function rawCents(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n === null ? null : Math.round(n);
}

function hasOwnDefined(record: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined && record[key] !== null && record[key] !== "";
}

function getNestedPricingCents(lineItem: Record<string, any>, path: string[]): number | null {
  let current: unknown = lineItem;
  for (const part of path) {
    current = getRecord(current)[part];
  }
  return rawCents(current);
}

function getBackendStoredTotalCents(lineItem: Record<string, any>): number | null {
  return (
    dollarsToCents(lineItem.totalPrice) ??
    dollarsToCents(lineItem.linePrice) ??
    dollarsToCents(getRecord(lineItem.priceBreakdown).total) ??
    (() => {
      const unit = dollarsToCents(lineItem.unitPrice);
      const qty = toFiniteNumber(lineItem.quantity);
      return unit !== null && qty !== null && qty > 0 ? Math.round(unit * qty) : null;
    })()
  );
}

function hasExplicitZeroPrice(lineItem: Record<string, any>): boolean {
  if (lineItem.explicitZeroPrice === true) return true;
  if (hasOwnDefined(lineItem, "effectiveTotalCents") && rawCents(lineItem.effectiveTotalCents) === 0) return true;
  if (hasOwnDefined(lineItem, "baseCalculatedTotalCents") && rawCents(lineItem.baseCalculatedTotalCents) === 0) return true;
  if (getNestedPricingCents(lineItem, ["pbv2SnapshotJson", "pricing", "effectiveTotalCents"]) === 0) return true;
  if (getNestedPricingCents(lineItem, ["pbv2SnapshotJson", "pricing", "totalCents"]) === 0) return true;
  if (hasOwnDefined(getRecord(lineItem.priceBreakdown), "total") && dollarsToCents(getRecord(lineItem.priceBreakdown).total) === 0) return true;
  return false;
}

export function resolveLineItemDisplayPriceCents(
  lineItem: unknown,
  previousDisplayPriceCents?: number | null,
): number {
  const record = getRecord(lineItem);
  const overrideRecord = getRecord(record.priceOverride);
  const hasOverride = record.hasPriceOverride !== false && (
    record.hasPriceOverride === true ||
    hasOwnDefined(record, "overridePriceCents") ||
    hasOwnDefined(record, "priceOverrideMode") ||
    hasOwnDefined(overrideRecord, "mode") ||
    hasOwnDefined(overrideRecord, "priceOverrideMode")
  );

  if (hasOverride) {
    const overrideTotal =
      rawCents(record.effectiveTotalCents) ??
      rawCents(overrideRecord.effectiveTotalCents) ??
      rawCents(record.overridePriceCents);
    if (overrideTotal !== null) return overrideTotal;
  }

  const currentCalculated =
    rawCents(record.currentCalculatedTotalCents) ??
    rawCents(record.calculatedTotalCents);
  if (currentCalculated !== null) return currentCalculated;

  const persistedSnapshot =
    rawCents(record.effectiveTotalCents) ??
    rawCents(overrideRecord.effectiveTotalCents) ??
    getNestedPricingCents(record, ["pbv2SnapshotJson", "pricing", "effectiveTotalCents"]) ??
    getNestedPricingCents(record, ["pbv2SnapshotJson", "pricing", "totalCents"]);
  if (persistedSnapshot !== null) return persistedSnapshot;

  const stored = getBackendStoredTotalCents(record);
  if (stored !== null && (stored !== 0 || hasExplicitZeroPrice(record) || previousDisplayPriceCents == null)) {
    return stored;
  }

  if (previousDisplayPriceCents !== null && previousDisplayPriceCents !== undefined && Number.isFinite(previousDisplayPriceCents)) {
    return previousDisplayPriceCents;
  }

  return hasExplicitZeroPrice(record) ? 0 : 0;
}

function patchLooksAttachmentOnly(patch: Record<string, any>): boolean {
  const keys = Object.keys(patch).filter((key) => key !== "id" && key !== "tempId");
  return keys.length > 0 && keys.every((key) => ATTACHMENT_PATCH_FIELDS.has(key));
}

function restorePricingFields<T extends Record<string, any>>(target: T, existing: T): T {
  const next = { ...target };
  for (const field of PRICE_DISPLAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(existing, field)) {
      (next as any)[field] = existing[field];
    } else if (Object.prototype.hasOwnProperty.call(next, field)) {
      delete (next as any)[field];
    }
  }
  return next;
}

export function mergeLineItemPatchSafely<T extends Record<string, any>>(
  existing: T | undefined,
  patch: Partial<T>,
  options: { patchKind?: LineItemPatchKind } = {},
): T {
  if (!existing) return patch as T;

  const patchRecord = patch as Record<string, any>;
  const existingPrice = resolveLineItemDisplayPriceCents(existing);
  const patchOwnPrice = resolveLineItemDisplayPriceCents(patchRecord);
  const merged = { ...existing, ...patch } as T;
  const kind = options.patchKind ?? "generic";

  if (kind === "pricing") return merged;

  if (kind === "attachment" || patchLooksAttachmentOnly(patchRecord)) {
    return restorePricingFields(merged, existing);
  }

  const patchHasExplicitZero = hasExplicitZeroPrice(patchRecord);
  const patchHasMeaningfulPrice = patchOwnPrice > 0 || patchHasExplicitZero;
  const wouldEraseKnownPrice = existingPrice > 0 && (!patchHasMeaningfulPrice || (patchOwnPrice === 0 && !patchHasExplicitZero));
  if (wouldEraseKnownPrice) {
    return restorePricingFields(merged, existing);
  }

  return merged;
}

export function reconcileLineItemListSafely<T extends Record<string, any>>(
  existingItems: T[],
  incomingItems: T[],
  options: { patchKind?: LineItemPatchKind; preserveLocalDrafts?: boolean } = {},
): T[] {
  const preserveLocalDrafts = options.preserveLocalDrafts ?? true;
  const usedExistingIndexes = new Set<number>();

  const merged = incomingItems.map((incoming) => {
    const incomingKey = getLineItemMergeKey(incoming);
    const existingIndex = existingItems.findIndex((existing, index) => {
      if (usedExistingIndexes.has(index)) return false;
      return (
        (incoming.id && existing.id === incoming.id) ||
        (incoming.tempId && existing.tempId === incoming.tempId) ||
        (incomingKey && getLineItemMergeKey(existing) === incomingKey)
      );
    });
    if (existingIndex < 0) return incoming;
    usedExistingIndexes.add(existingIndex);
    return mergeLineItemPatchSafely(existingItems[existingIndex], incoming, options);
  });

  if (!preserveLocalDrafts) return merged;

  for (let index = 0; index < existingItems.length; index += 1) {
    if (usedExistingIndexes.has(index)) continue;
    const existing = existingItems[index];
    if (!existing.id || existing.status === "draft") {
      merged.push(existing);
    }
  }

  return merged;
}

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

export function shouldApplyOrderLineItemPreviewResult(
  input: OrderLineItemPreviewGateInput,
): OrderLineItemPreviewGateResult {
  if (input.requestId !== input.latestRequestId) {
    return { apply: false, reasonIgnored: "stale_request_id" };
  }
  if (input.requestFingerprint !== input.currentFingerprint) {
    return { apply: false, reasonIgnored: "stale_fingerprint" };
  }
  if (!input.isDirtyByUser) {
    return { apply: false, reasonIgnored: "not_dirty_by_user" };
  }
  if (!input.requestedBecauseOfUserChange) {
    return { apply: false, reasonIgnored: "not_user_requested" };
  }
  if (input.hasPendingManualOverride) {
    return { apply: false, reasonIgnored: "manual_override_active" };
  }
  return { apply: true, reasonIgnored: null };
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
