import { z } from "zod";
import type { OptionTreeV2 } from "./optionTreeV2";

export const COROPLAST_PRINT_MODE_KEY = "coroplast_print_mode";
export const COROPLAST_FLUTE_KEY = "coroplast_flute_direction";

const tierSchema = z.object({ minQuantity: z.number().int().positive(), rateCents: z.number().int().positive() }).strict();
export const blankCoroplastPricingSchema = z.object({
  unit: z.enum(["per_square_foot", "per_piece"]),
  rateCents: z.number().int().positive(),
  minimumChargeCents: z.number().int().min(0),
  quantityTiers: z.array(tierSchema).max(20).optional(),
}).strict().superRefine((value, ctx) => {
  const tiers = value.quantityTiers ?? [];
  if (tiers.length && tiers[0].minQuantity !== 1) ctx.addIssue({ code: "custom", path: ["quantityTiers", 0], message: "The first quantity tier must start at 1." });
  tiers.forEach((tier, index) => {
    if (index && tier.minQuantity <= tiers[index - 1].minQuantity) ctx.addIssue({ code: "custom", path: ["quantityTiers", index], message: "Quantity tiers must increase." });
  });
});
export type BlankCoroplastPricing = z.infer<typeof blankCoroplastPricingSchema>;

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

export function blankCoroplastRate(pricing: BlankCoroplastPricing, quantity: number): number {
  return [...(pricing.quantityTiers ?? [])].reverse().find((tier) => quantity >= tier.minQuantity)?.rateCents ?? pricing.rateCents;
}

export function withBlankCoroplastPricing(tree: OptionTreeV2, pricing: BlankCoroplastPricing): OptionTreeV2 {
  const parsed = blankCoroplastPricingSchema.parse(pricing);
  const next = structuredClone(tree);
  if (Array.isArray(next.nodes)) {
    next.nodes = Object.fromEntries((next.nodes as unknown as Array<{ id: string }>).map((node) => [node.id, node])) as OptionTreeV2["nodes"];
  }
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
