import { z } from "zod";
import { type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";

/** Provider-facing continuation language. It names business labels rather
 * than canonical paths, PBV2 nodes, revision metadata, or persistence keys. */
export const semanticProductOperationsResultSchema = z.object({
  kind: z.literal("semantic_operations"),
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_category"), category: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_pricing_basis"), basis: z.enum(["per_piece", "per_square_foot"]) }).strict(),
    z.object({ op: z.literal("set_matrix_rate"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), priceCents: z.number().int().min(0).max(10_000_000) }).strict(),
    z.object({ op: z.literal("remove_option_value"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
  ])).min(1).max(12),
}).strict();
export type SemanticProductOperationsResult = z.infer<typeof semanticProductOperationsResultSchema>;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Converts a small semantic delta into the pre-existing canonical patch.
 * It is deliberately pure and strict: ambiguity is a safe compiler rejection,
 * not an opportunity to guess at product state. */
export function compileSemanticProductOperations(
  current: ProductDraftIntent,
  raw: unknown,
  baseRevision: number,
  request?: string,
): ProductDraftIntentPatch {
  const semantic = semanticProductOperationsResultSchema.parse(raw);
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  const nextGroups = structuredClone(current.optionGroups);
  const metadata: Record<string, { source: "explicit_user" }> = {};
  let optionGroupsChanged = false;
  let nextPricing = current.pricing;
  let pricingChanged = false;
  let categoryLabel: string | null = null;
  const changedGroups = new Set<string>();

  for (const operation of semantic.operations) {
    if (operation.op === "set_category") {
      if (categoryLabel || (request && !normalized(request).includes(normalized(operation.category)))) {
        throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
      }
      categoryLabel = operation.category;
      metadata["identity.category"] = { source: "explicit_user" };
      continue;
    }
    if (operation.op === "set_pricing_basis") {
      if (current.pricing.model !== "two_dimensional_matrix") throw new Error("PRODUCT_INTENT_SEMANTIC_PRICING_BASIS_UNSUPPORTED");
      nextPricing = { ...current.pricing, unit: operation.basis };
      pricingChanged = true;
      metadata["pricing.matrix.unit"] = { source: "explicit_user" };
      continue;
    }
    if (operation.op === "set_matrix_rate") {
      if (current.pricing.model !== "two_dimensional_matrix") throw new Error("PRODUCT_INTENT_SEMANTIC_MATRIX_RATE_UNSUPPORTED");
      const group = nextGroups.filter((candidate) => normalized(candidate.label) === normalized(operation.optionGroup));
      if (group.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
      const match = group[0]!.values.filter((value) => normalized(value.label) === normalized(operation.value));
      if (match.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
      const axis = group[0]!.key === current.pricing.rowOptionKey ? "row" : group[0]!.key === current.pricing.columnOptionKey ? "column" : null;
      if (!axis) throw new Error("PRODUCT_INTENT_SEMANTIC_MATRIX_AXIS_UNRESOLVED");
      nextPricing = { ...current.pricing, cells: current.pricing.cells.map((cell) => cell[axis] === match[0]!.key ? { ...cell, priceCents: operation.priceCents } : cell) };
      pricingChanged = true;
      metadata["pricing.matrix"] = { source: "explicit_user" };
      continue;
    }
    const groupMatches = nextGroups.filter((group) => normalized(group.label) === normalized(operation.optionGroup));
    if (groupMatches.length !== 1 || groupMatches[0]!.selectionMode !== "single") throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    const group = groupMatches[0]!;
    if (changedGroups.has(group.key)) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_DUPLICATE");
    const valueMatches = group.values.filter((value) => normalized(value.label) === normalized(operation.value));
    if (valueMatches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
    if (operation.op === "remove_option_value") {
      if (group.values.length <= 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_REQUIRED");
      group.values = group.values.filter((value) => value.key !== valueMatches[0]!.key);
      if (group.values.every((value) => !value.isDefault) && group.required) throw new Error("PRODUCT_INTENT_SEMANTIC_DEFAULT_REQUIRED");
    } else {
      group.values = group.values.map((value) => ({ ...value, isDefault: value.key === valueMatches[0]!.key }));
    }
    changedGroups.add(group.key);
    optionGroupsChanged = true;
    metadata[`optionGroups.${group.key}.default`] = { source: "explicit_user" };
  }

  const operations: ProductDraftIntentPatch["operations"] = [];
  if (categoryLabel) operations.push({ op: "set_identity", value: { ...current.identity, category: { state: "unresolved", label: categoryLabel } } });
  if (optionGroupsChanged) operations.push({ op: "replace_option_groups", value: nextGroups });
  if (pricingChanged) operations.push({ op: "set_pricing", value: nextPricing });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  if (!operations.length) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_EMPTY");
  return { contractVersion: 1, baseRevision, preserveUnchanged: true, operations };
}
