import { resolveSavedLineItemOptions } from "./lineItemOptionSelections";

const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const comparable = (value: unknown): string => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Formats a customer reference for display without changing the saved reference. */
export function formatCustomerPoReference(value: string | null | undefined): string | null {
  let reference = text(value);
  if (!reference) return null;
  while (/^PO(?:\s*#\s*|\s+)(?=\S)/i.test(reference)) {
    reference = reference.replace(/^PO(?:\s*#\s*|\s+)/i, "").trim();
  }
  return reference ? `PO ${reference}` : null;
}

export type QuotePriceComparison = {
  status: "matches" | "different" | "unavailable";
  source: "customer_or_po_supplied" | "manual";
  customerTotalCents: number;
  systemTotalCents: number | null;
  differenceCents: number | null;
};

/** All amounts are complete line totals, never per-piece prices. */
export function compareCustomerQuoteLinePrice(customerTotalCents: number, systemTotalCents: number | null | undefined, overrideReason?: string | null): QuotePriceComparison {
  const validSystem = typeof systemTotalCents === "number" && Number.isSafeInteger(systemTotalCents) && systemTotalCents >= 0;
  return {
    status: !validSystem ? "unavailable" : customerTotalCents === systemTotalCents ? "matches" : "different",
    source: /\b(?:customer|po|purchase order)\b/i.test(overrideReason ?? "") ? "customer_or_po_supplied" : "manual",
    customerTotalCents,
    systemTotalCents: validSystem ? systemTotalCents! : null,
    differenceCents: validSystem ? customerTotalCents - systemTotalCents! : null,
  };
}

export function quotePriceComparisonReviewText(comparison: QuotePriceComparison, quantity: number): string {
  const money = (value: number) => `$${(value / 100).toFixed(2)}`;
  const source = comparison.source === "customer_or_po_supplied" ? "Customer/PO supplied" : "Manual";
  const system = comparison.systemTotalCents === null ? "system comparison unavailable" : `system ${money(comparison.systemTotalCents)} line total`;
  const difference = comparison.status === "different"
    ? `; difference ${money(Math.abs(comparison.differenceCents ?? 0))} ${comparison.differenceCents! > 0 ? "above" : "below"} system price`
    : comparison.status === "matches" ? "; matches system price" : "";
  return `${source} price ${money(comparison.customerTotalCents)} line total for ${quantity} ${quantity === 1 ? "piece" : "pieces"}; ${system}${difference}; override retained.`;
}

export type QuoteOptionDisplay = { label: string; choice: string; available: boolean };

/** Compare the saved, display-ordered Quote lines with the reviewed line totals. */
export function savedQuoteLineTotalsMatch(
  reviewed: readonly { productId: string; quantity: number; lineSubtotalCents: number }[],
  saved: readonly { productId: string; quantity: number; linePrice: string | number }[],
): boolean {
  return reviewed.length === saved.length && reviewed.every((line, index) => {
    const actual = saved[index];
    return actual?.productId === line.productId && Number(actual.quantity) === line.quantity
      && Number.isFinite(Number(actual.linePrice)) && Math.round(Number(actual.linePrice) * 100) === line.lineSubtotalCents;
  });
}

/** Resolve display values from the priced Product tree or saved option metadata.
 * Raw option keys and choice IDs stay in the intake for canonical execution. */
export function presentQuoteOptionSelections(selections: Record<string, unknown>, pricingSnapshot: unknown): QuoteOptionDisplay[] {
  const snapshot = record(pricingSnapshot);
  const tree = record(snapshot?.treeJson);
  const savedOptions = Array.isArray(snapshot?.selectedOptions) ? snapshot.selectedOptions : [];
  const resolved = resolveSavedLineItemOptions({
    optionSelectionsJson: { selected: selections },
    selectedOptions: savedOptions,
    pbv2SnapshotJson: snapshot,
  }, tree as any, { includeDefaults: false });
  const nodes = tree ? (Array.isArray(tree.nodes) ? tree.nodes : Object.values(record(tree.nodes) ?? {})) : [];
  const result: QuoteOptionDisplay[] = [];
  const used = new Set<string>();
  for (const option of resolved) {
    const node = nodes.find((candidate: any) => [candidate?.id, candidate?.key, candidate?.input?.selectionKey, candidate?.selectionKey].includes(option.optionKey)
      || [candidate?.id, candidate?.key, candidate?.input?.selectionKey, candidate?.selectionKey].includes(option.optionId));
    const aliases = [option.optionKey, option.optionId, node?.id, node?.key, node?.input?.selectionKey, node?.selectionKey]
      .map(comparable).filter(Boolean);
    const nodeIdentity = comparable(node?.id);
    const matchingKeys = Object.keys(selections).filter((key) => {
      const normalizedKey = comparable(key);
      return aliases.includes(normalizedKey) || (nodeIdentity.length >= 16 && normalizedKey.endsWith(nodeIdentity));
    });
    if (!matchingKeys.length) continue;
    matchingKeys.forEach((key) => used.add(key));
    const label = text(option.optionLabel);
    const hasAuthoritativeLabel = Boolean(node && label && label === text(node.label))
      || savedOptions.some((saved: any) => [saved?.optionId, saved?.selectionKey, saved?.key].includes(option.optionKey)
        && text(saved?.optionName) === label);
    const hasChoices = Array.isArray(node?.choices) && node.choices.length > 0;
    const savedChoiceLabel = savedOptions.some((saved: any) => [saved?.optionId, saved?.selectionKey, saved?.key].some((key) => aliases.includes(comparable(key)))
      && (text(saved?.selectedLabel) === text(option.selectedLabel) || text(saved?.displayValue) === text(option.selectedLabel)));
    const technicalChoice = typeof option.savedValue === "string" && /^choice[_-]?\d+$/i.test(option.savedValue);
    const knownChoice = hasChoices ? option.selectedOptionId !== null || savedChoiceLabel : (Boolean(node) && !technicalChoice) || savedChoiceLabel;
    result.push({
      label: hasAuthoritativeLabel ? label : "Option unavailable",
      choice: hasAuthoritativeLabel && knownChoice && text(option.selectedLabel)
        ? typeof option.savedValue === "boolean" ? option.savedValue ? "Yes" : "No" : option.selectedLabel
        : "Saved choice unavailable",
      available: hasAuthoritativeLabel && knownChoice && Boolean(text(option.selectedLabel)),
    });
  }
  for (const key of Object.keys(selections)) {
    if (!used.has(key)) result.push({ label: "Option unavailable", choice: "Saved choice unavailable", available: false });
  }
  return result;
}
