import type { AssistantOperatorTrustedContext } from "./operatorRuntime";

const pricingReadArgumentKeys = new Set(["productId", "query", "quantity", "widthIn", "heightIn", "width", "height", "unit", "optionSelections"]);

/**
 * DeepSeek sometimes expresses a current-product square-foot lookup using its
 * natural business shape (`squareFeet` and a selection array), while the
 * provider-neutral read tool accepts dimensions and an option map. Project
 * only those known aliases, bind an omitted identity from the current trusted
 * Product Editor context, and discard unknown provider keys before the strict
 * server schema validates the final request. This never changes tenancy,
 * authorization, product selection supplied by the model, or pricing math.
 */
export function normalizeTrustedPricingReadArguments(argumentsValue: Record<string, unknown>, context: AssistantOperatorTrustedContext): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(argumentsValue).filter(([key]) => pricingReadArgumentKeys.has(key)));
  if (typeof normalized.productId !== "string" && typeof normalized.query !== "string") {
    const trustedProductId = context.context.entityType === "product" && typeof context.context.entityId === "string"
      ? context.context.entityId
      : (() => {
        const productIds = Array.from(new Set((context.task?.entityReferences ?? []).filter((reference) => reference.type === "product" && typeof reference.id === "string").map((reference) => reference.id)));
        return productIds.length === 1 ? productIds[0] : null;
      })();
    if (trustedProductId) normalized.productId = trustedProductId;
  }
  const squareFeet = argumentsValue.squareFeet;
  if (typeof squareFeet === "number" && Number.isFinite(squareFeet) && squareFeet > 0
    && normalized.width === undefined && normalized.height === undefined && normalized.widthIn === undefined && normalized.heightIn === undefined) {
    normalized.width = squareFeet;
    normalized.height = 1;
    normalized.unit = "ft";
  }
  if (normalized.optionSelections === undefined && Array.isArray(argumentsValue.selections)) {
    const selections = Object.fromEntries(argumentsValue.selections.flatMap((selection) => {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) return [];
      const record = selection as Record<string, unknown>;
      return typeof record.optionGroup === "string" && typeof record.value === "string" ? [[record.optionGroup, record.value] as const] : [];
    }));
    if (Object.keys(selections).length) normalized.optionSelections = selections;
  }
  return normalized;
}
