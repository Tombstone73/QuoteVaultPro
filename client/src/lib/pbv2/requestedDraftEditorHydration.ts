import { normalizeProductPricingRotationConfig } from "@shared/pbv2/productPricingRotation";

type RequestedDraftProductIntake = {
  sheet?: {
    widthIn?: unknown;
    heightIn?: unknown;
    materialForm?: unknown;
    allowRotation?: unknown;
  };
  draftRouting?: { stationName?: unknown };
} | null | undefined;

function positiveFinite(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

/**
 * The full editor has product-level defaults as well as PBV2 tree state. When
 * an ownership-scoped DRAFT ID was explicitly requested, its sheet semantics
 * must be the editor's read model instead of the product's active/default
 * pricing configuration.
 */
export function resolveRequestedDraftEditorContext(input: {
  requestedDraftTreeVersionId?: string | null;
  productIntake?: RequestedDraftProductIntake;
  pricingProfileConfig?: unknown;
}) {
  if (!input.requestedDraftTreeVersionId?.trim()) return null;
  const sheet = input.productIntake?.sheet;
  const widthIn = positiveFinite(sheet?.widthIn);
  const heightIn = positiveFinite(sheet?.heightIn);
  if (widthIn === null || heightIn === null || typeof sheet?.allowRotation !== "boolean") return null;

  const route = typeof input.productIntake?.draftRouting?.stationName === "string"
    ? input.productIntake.draftRouting.stationName.trim() || null
    : null;

  return {
    route,
    pricingProfileKey: "flat_goods" as const,
    pricingProfileConfig: normalizeProductPricingRotationConfig({
      ...(input.pricingProfileConfig && typeof input.pricingProfileConfig === "object" && !Array.isArray(input.pricingProfileConfig)
        ? input.pricingProfileConfig as Record<string, unknown>
        : {}),
      sheetWidth: widthIn,
      sheetHeight: heightIn,
      materialType: sheet?.materialForm === "roll" ? "roll" : "sheet",
      allowRotation: sheet.allowRotation,
    }, sheet.allowRotation),
  };
}
