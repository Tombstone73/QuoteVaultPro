/** Frozen PBV2 commercial terms for hourly services. */
export type HourlyServiceCommercialTerms = { quantity: number; rateCents: number; unit: "hour" };

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveHourlyServiceCommercialTerms(record: Record<string, any> | null | undefined): HourlyServiceCommercialTerms | null {
  const snapshot = record?.pbv2SnapshotJson;
  const meta = snapshot?.treeJson?.meta;
  const billingUnit = meta?.billingUnit;
  if (billingUnit?.kind !== "hour" || typeof billingUnit.selectionKey !== "string") return null;
  const selections = snapshot?.selections ?? snapshot?.pbv2PricingSnapshot?.effectiveSelections ?? record?.optionSelectionsJson?.selected;
  const selected = selections?.[billingUnit.selectionKey];
  const hours = positive(selected && typeof selected === "object" && "value" in selected ? selected.value : selected);
  const rate = Number((meta.pricingFormulaVariables ?? meta.formulaVariables ?? {}).hourly_rate);
  if (hours === null || !Number.isFinite(rate) || rate < 0) return null;
  return { quantity: hours, rateCents: Math.round(rate * 100), unit: "hour" };
}
