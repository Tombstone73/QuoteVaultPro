import type { OptionTreeV2 } from "./optionTreeV2";
import { productOptionRate, productOptionRateTableSchema, validateProductOptionRateCoverage, type ProductOptionRateTable } from "./productOptionRateTable";

export const COROPLAST_PRINT_MODE_KEY = "coroplast_print_mode";
export const COROPLAST_FLUTE_KEY = "coroplast_flute_direction";

export const blankCoroplastPricingSchema = productOptionRateTableSchema;
export type BlankCoroplastPricing = ProductOptionRateTable;

function thicknessInputs(tree: OptionTreeV2) {
  return Object.values(tree.nodes).filter((node) => node?.input?.selectionKey && node.choices?.length &&
    (/thickness/i.test(`${node.label} ${node.input.selectionKey}`) || node.choices.filter((choice) => /\b\d+\s*mm\b/i.test(`${choice.label} ${choice.value}`)).length > 1));
}

export function blankCoroplastThicknessInput(tree: OptionTreeV2) {
  const node = thicknessInputs(tree)[0];
  return node?.input?.selectionKey ? { selectionKey: node.input.selectionKey,
    choices: node.choices?.map((choice) => ({ value: choice.value, label: choice.label })) ?? [] } : null;
}

export function validateBlankCoroplastRateCoverage(tree: OptionTreeV2, pricing: BlankCoroplastPricing): void {
  const inputs = thicknessInputs(tree);
  if (inputs.length > 1) throw new Error("Multiple thickness inputs need review before blank pricing can be configured.");
  const thickness = inputs[0];
  if (!thickness) {
    if (pricing.optionRates) throw new Error("The requested thickness input is unavailable on this Product.");
    return;
  }
  const choices = thickness.choices?.map((choice) => choice.value) ?? [];
  if (!pricing.optionRates) {
    if (choices.length > 1) throw new Error("This Product has multiple thickness choices. Supply a separate blank selling rate for every thickness; quantity tiers are not thickness choices.");
    return;
  }
  if (pricing.optionRates.selectionKey !== thickness.input?.selectionKey ||
    choices.length !== pricing.optionRates.choices.length ||
    choices.some((choice) => !pricing.optionRates!.choices.some((rate) => rate.value === choice))) {
    throw new Error("Blank pricing must include every existing thickness choice with its exact selection key and value.");
  }
  validateProductOptionRateCoverage(tree, pricing);
}

export function readBlankCoroplastPricing(tree: unknown): BlankCoroplastPricing | null {
  const candidate = (tree as { meta?: { blankCoroplastPricing?: unknown } } | null)?.meta?.blankCoroplastPricing;
  return candidate == null ? null : blankCoroplastPricingSchema.parse(candidate);
}

export function isUnprintedCoroplast(tree: unknown, selections: Record<string, unknown> | undefined): boolean {
  if (!readBlankCoroplastPricing(tree)) return false;
  const selected = selections?.[COROPLAST_PRINT_MODE_KEY];
  const value = selected && typeof selected === "object" && "value" in selected ? (selected as { value: unknown }).value : selected;
  return value === "unprinted";
}

/** Read the immutable Order-line pricing evidence, never today's Product defaults. */
export function isUnprintedCoroplastOrderSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const value = snapshot as { treeJson?: unknown; selections?: unknown };
  return isUnprintedCoroplast(value.treeJson,
    value.selections && typeof value.selections === "object" && !Array.isArray(value.selections)
      ? value.selections as Record<string, unknown> : undefined);
}

export function blankCoroplastRate(pricing: BlankCoroplastPricing, quantity: number, selections: Record<string, unknown> = {}): number {
  return productOptionRate(pricing, quantity, selections);
}

/** Price the selected blank substrate once; other visible finishing choices remain billable. */
export function blankCoroplastOptionEvaluationTree(tree: OptionTreeV2, selections: Record<string, unknown>): OptionTreeV2 {
  if (!isUnprintedCoroplast(tree, selections)) return tree;
  const next = structuredClone(tree);
  const pricing = readBlankCoroplastPricing(next)!;
  const key = pricing.optionRates?.selectionKey ?? thicknessInputs(next)[0]?.input?.selectionKey;
  if (!key) return next;
  const node = Object.values(next.nodes).find((entry) => entry?.input?.selectionKey === key);
  if (node) {
    delete node.pricingImpact;
    node.choices?.forEach((choice) => { delete choice.priceDeltaCents; delete choice.pricingImpact; delete choice.pricingOverride; });
  }
  return next;
}

export function withBlankCoroplastPricing(tree: OptionTreeV2, pricing: BlankCoroplastPricing): OptionTreeV2 {
  const parsed = blankCoroplastPricingSchema.parse(pricing);
  const next = structuredClone(tree);
  if (Array.isArray(next.nodes)) {
    next.nodes = Object.fromEntries((next.nodes as unknown as Array<{ id: string }>).map((node) => [node.id, node])) as OptionTreeV2["nodes"];
  }
  validateBlankCoroplastRateCoverage(next, parsed);
  const inputs = Object.values(next.nodes).filter((node) => node?.input?.selectionKey === COROPLAST_PRINT_MODE_KEY);
  if (inputs.length > 1) throw new Error("The Product has conflicting Print Mode inputs.");
  const node = inputs[0];
  if (node && (node.input?.type !== "select" ||
    node.choices?.map((choice) => choice.value).sort().join(",") !== "printed,unprinted" ||
    node.choices?.some((choice) => choice.priceDeltaCents || choice.pricingImpact?.length || choice.pricingOverride?.mode && choice.pricingOverride.mode !== "none"))) {
    throw new Error("The existing Print Mode input needs review before adding blank pricing.");
  }
  const printId = node?.id ?? "coroplast-print-mode";
  if (!node && next.nodes[printId]) throw new Error("The Product already uses the Print Mode node ID.");
  next.nodes[printId] = {
    id: printId, kind: "question", type: "INPUT", status: "ENABLED", key: COROPLAST_PRINT_MODE_KEY,
    label: "Print Mode", description: "Choose printed or unprinted Coroplast.",
    input: { type: "select", valueType: "ENUM", required: true, defaultValue: "printed", selectionKey: COROPLAST_PRINT_MODE_KEY,
      constraints: { enum: { options: [{ value: "printed" }, { value: "unprinted" }] } } },
    choices: [{ value: "printed", label: "Printed" }, { value: "unprinted", label: "Unprinted / blank substrate" }],
  };
  if (!next.rootNodeIds.includes(printId)) next.rootNodeIds.push(printId);
  // Print-only controls cannot carry stale charges into a blank configuration.
  // Cutting, finishing and flute controls remain visible and billable.
  for (const entry of Object.values(next.nodes)) {
    if (!entry?.input || entry.id === printId) continue;
    if (!/^(?:rate|print(?:ed)? (?:rate|sides?|quality)|ink(?: color)?|white ink)$/i.test(entry.label.trim())) continue;
    const rules = entry.visibility?.rules ?? [];
    if (!rules.some((rule) => rule.type === "notEquals" && rule.selectionKey === COROPLAST_PRINT_MODE_KEY && rule.value === "unprinted")) {
      entry.visibility = { ...entry.visibility, rules: [...rules, { type: "notEquals", selectionKey: COROPLAST_PRINT_MODE_KEY, value: "unprinted" }] };
    }
  }
  const fluteInputs = Object.values(next.nodes).filter((entry) => entry?.input?.selectionKey === COROPLAST_FLUTE_KEY);
  if (fluteInputs.length > 1) throw new Error("The Product has conflicting Flute Direction inputs.");
  if (fluteInputs[0] && (fluteInputs[0].input?.type !== "select" || fluteInputs[0].choices?.map((choice) => choice.value).sort().join(",") !== "horizontal,vertical")) {
    throw new Error("The existing Flute Direction input needs review before adding blank pricing.");
  }
  const fluteId = fluteInputs[0]?.id ?? "coroplast-flute-direction";
  if (!fluteInputs[0] && next.nodes[fluteId]) throw new Error("The Product already uses the Flute Direction node ID.");
  if (!fluteInputs[0]) {
    const variables = next.meta?.formulaVariables;
    const sheetWidth = typeof variables?.sheet_width === "number" && variables.sheet_width > 0 ? variables.sheet_width : 48;
    const sheetHeight = typeof variables?.sheet_length === "number" && variables.sheet_length > 0 ? variables.sheet_length : 96;
    next.nodes[fluteId] = {
      id: fluteId, kind: "question", type: "INPUT", status: "ENABLED", key: COROPLAST_FLUTE_KEY,
      label: "Flute Direction", description: `On a ${sheetWidth} in wide × ${sheetHeight} in high sheet, channels run along the ${sheetHeight} in dimension. Vertical runs parallel to finished height; horizontal runs parallel to finished width.`,
      input: { type: "select", valueType: "ENUM", required: true, selectionKey: COROPLAST_FLUTE_KEY,
        constraints: { enum: { options: [{ value: "vertical" }, { value: "horizontal" }] } } },
      visibility: { rules: [{ type: "equals", selectionKey: COROPLAST_PRINT_MODE_KEY, value: "unprinted" }] },
      choices: [{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }],
    };
    next.rootNodeIds.push(fluteId);
  }
  next.meta = { ...next.meta, blankCoroplastPricing: parsed };
  return next;
}
