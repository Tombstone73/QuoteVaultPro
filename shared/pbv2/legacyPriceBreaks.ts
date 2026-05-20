export type LegacyPriceBreaksConfig = {
  enabled: boolean;
  type: "quantity" | "sheets" | "sqft";
  tiers: Array<{
    minValue: number;
    maxValue?: number;
    discountType: "percentage" | "fixed" | "multiplier";
    discountValue: number;
  }>;
};

export const DISABLED_LEGACY_PRICE_BREAKS: LegacyPriceBreaksConfig = {
  enabled: false,
  type: "quantity",
  tiers: [],
};

function cloneDisabledLegacyPriceBreaks(): LegacyPriceBreaksConfig {
  return {
    enabled: false,
    type: "quantity",
    tiers: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isPbv2TreeLike(value: unknown): boolean {
  const tree = asRecord(parseMaybeJson(value));
  if (!tree) return false;

  if (tree.schemaVersion === 2) return true;

  const meta = asRecord(tree.meta);
  if (asRecord(meta?.pricingV2)) return true;

  const nodes = asRecord(tree.nodes);
  const rootNodeIds = tree.rootNodeIds;
  return Boolean(nodes && Array.isArray(rootNodeIds));
}

export function isPbv2ProductPayloadLike(payload: unknown): boolean {
  const product = asRecord(payload);
  if (!product) return false;

  if (typeof product.pbv2ActiveTreeVersionId === "string" && product.pbv2ActiveTreeVersionId.trim().length > 0) {
    return true;
  }

  if (isPbv2TreeLike(product.optionTreeJson)) {
    return true;
  }

  const pbv2 = asRecord(product.pbv2);
  if (pbv2) {
    return Boolean(pbv2.hasActiveTree || pbv2.hasDraft || pbv2.activeTree || pbv2.draftTree);
  }

  return false;
}

export function sanitizeLegacyPriceBreaksForPbv2<T extends Record<string, unknown>>(
  payload: T,
  existingProduct?: unknown,
): T {
  const shouldClear = isPbv2ProductPayloadLike(payload) || isPbv2ProductPayloadLike(existingProduct);
  if (!shouldClear) return payload;

  return {
    ...payload,
    priceBreaks: cloneDisabledLegacyPriceBreaks(),
  };
}
