import { z } from "zod";
import type { OptionTreeV2 } from "./optionTreeV2";

const quantityTierSchema = z.object({ minQuantity: z.number().int().positive(), rateCents: z.number().int().positive() }).strict();

/** A Product rate table uses an existing option input as its axis. Quantity
 * tiers remain a separate dimension within a choice. */
export const productOptionRateTableSchema = z.object({
  unit: z.enum(["per_square_foot", "per_piece"]),
  rateCents: z.number().int().positive().optional(),
  minimumChargeCents: z.number().int().min(0),
  quantityTiers: z.array(quantityTierSchema).max(20).optional(),
  optionRates: z.object({
    selectionKey: z.string().trim().min(1),
    choices: z.array(z.object({ value: z.string().trim().min(1), rateCents: z.number().int().positive(), quantityTiers: z.array(quantityTierSchema).max(20).optional() }).strict()).min(1),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.rateCents == null) === (value.optionRates == null)) ctx.addIssue({ code: "custom", message: "Specify either one global rate or complete option rates, never both." });
  if (value.optionRates && value.quantityTiers?.length) ctx.addIssue({ code: "custom", path: ["quantityTiers"], message: "Quantity tiers for option pricing belong to each option choice." });
  const validateTiers = (tiers: typeof value.quantityTiers, path: (string | number)[]) => {
    if (tiers?.length && tiers[0].minQuantity !== 1) ctx.addIssue({ code: "custom", path, message: "The first quantity tier must start at 1." });
    tiers?.forEach((tier, index) => { if (index && tier.minQuantity <= tiers[index - 1].minQuantity) ctx.addIssue({ code: "custom", path: [...path, index], message: "Quantity tiers must increase." }); });
  };
  validateTiers(value.quantityTiers, ["quantityTiers"]);
  const seen = new Set<string>();
  value.optionRates?.choices.forEach((choice, index) => {
    if (seen.has(choice.value)) ctx.addIssue({ code: "custom", path: ["optionRates", "choices", index], message: "Duplicate option choice." });
    seen.add(choice.value);
    validateTiers(choice.quantityTiers, ["optionRates", "choices", index, "quantityTiers"]);
  });
});

export type ProductOptionRateTable = z.infer<typeof productOptionRateTableSchema>;

export function validateProductOptionRateCoverage(tree: OptionTreeV2, pricing: ProductOptionRateTable): void {
  if (!pricing.optionRates) return;
  const matches = Object.values(tree.nodes).filter((node) => node?.input?.selectionKey === pricing.optionRates?.selectionKey);
  if (matches.length !== 1 || !matches[0]?.choices?.length) throw new Error("The rate table must reference one existing Product option input with choices.");
  const values = matches[0].choices!.map((choice) => choice.value);
  if (values.length !== pricing.optionRates.choices.length || values.some((value) => !pricing.optionRates!.choices.some((choice) => choice.value === value)))
    throw new Error("The rate table must include every existing choice for its option input exactly once.");
}

export function productOptionRate(pricing: ProductOptionRateTable, quantity: number, selections: Record<string, unknown> = {}): number {
  const key = pricing.optionRates?.selectionKey;
  const raw = key ? selections[key] : undefined;
  const value = raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw;
  const choice = pricing.optionRates?.choices.find((entry) => entry.value === value);
  if (pricing.optionRates && !choice) throw new Error("Select a configured Product option before pricing this item.");
  const source = choice ?? pricing;
  return [...(source.quantityTiers ?? [])].reverse().find((tier) => quantity >= tier.minQuantity)?.rateCents ?? source.rateCents!;
}
