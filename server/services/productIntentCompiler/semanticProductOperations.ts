import { z } from "zod";
import { type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";

/** Provider-facing continuation language. It names business labels rather
 * than canonical paths, PBV2 nodes, revision metadata, or persistence keys. */
export const semanticProductOperationsResultSchema = z.object({
  kind: z.literal("semantic_operations"),
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_pricing_basis"), basis: z.enum(["per_piece", "per_square_foot"]) }).strict(),
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
): ProductDraftIntentPatch {
  const semantic = semanticProductOperationsResultSchema.parse(raw);
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  const nextGroups = structuredClone(current.optionGroups);
  const metadata: Record<string, { source: "explicit_user" }> = {};
  let optionGroupsChanged = false;
  let nextPricing = current.pricing;
  let pricingChanged = false;
  const changedGroups = new Set<string>();

  for (const operation of semantic.operations) {
    if (operation.op === "set_pricing_basis") {
      if (current.pricing.model !== "two_dimensional_matrix") throw new Error("PRODUCT_INTENT_SEMANTIC_PRICING_BASIS_UNSUPPORTED");
      nextPricing = { ...current.pricing, unit: operation.basis };
      pricingChanged = true;
      metadata["pricing.matrix.unit"] = { source: "explicit_user" };
      continue;
    }
    const groupMatches = nextGroups.filter((group) => normalized(group.label) === normalized(operation.optionGroup));
    if (groupMatches.length !== 1 || groupMatches[0]!.selectionMode !== "single") throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    const group = groupMatches[0]!;
    if (changedGroups.has(group.key)) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_DUPLICATE");
    const valueMatches = group.values.filter((value) => normalized(value.label) === normalized(operation.value));
    if (valueMatches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
    group.values = group.values.map((value) => ({ ...value, isDefault: value.key === valueMatches[0]!.key }));
    changedGroups.add(group.key);
    optionGroupsChanged = true;
    metadata[`optionGroups.${group.key}.default`] = { source: "explicit_user" };
  }

  const operations: ProductDraftIntentPatch["operations"] = [];
  if (optionGroupsChanged) operations.push({ op: "replace_option_groups", value: nextGroups });
  if (pricingChanged) operations.push({ op: "set_pricing", value: nextPricing });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  if (!operations.length) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_EMPTY");
  return { contractVersion: 1, baseRevision, preserveUnchanged: true, operations };
}
