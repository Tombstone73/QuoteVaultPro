import {
  buildPrepressOptionRows,
  resolveLineItemMaterialDisplayLabel,
} from "../routes/flatStockNesting.shared";

/** Resolve only the configuration persisted with this order line. */
export function resolveTravelerLineConfiguration(
  lineItem: any,
  materialNameById: Map<string, string>,
): {
  material: string | null;
  selectedOptions: Array<{ optionLabel: string; selectedLabel: string }>;
} {
  const selectedOptions = buildPrepressOptionRows(lineItem).map(({ optionLabel, selectedLabel }) => ({ optionLabel, selectedLabel }));
  // The catalog primary material is a fallback. A saved material/media choice
  // takes precedence on the traveler, even when the catalog default differs.
  const selectsMaterial = selectedOptions.some(({ optionLabel }) =>
    /\b(material|media|substrate|stock|weight|fabric|vinyl)\b/i.test(optionLabel),
  );
  const material = selectsMaterial ? null : resolveLineItemMaterialDisplayLabel({
    lineItem,
    materialName: lineItem.materialId ? materialNameById.get(lineItem.materialId) ?? null : null,
    materialById: materialNameById,
    productPrimaryMaterialId: lineItem.productPrimaryMaterialId ?? null,
    primaryMaterialName: lineItem.productPrimaryMaterialId ? materialNameById.get(lineItem.productPrimaryMaterialId) ?? null : null,
  });
  return { material, selectedOptions };
}
