import { z } from "zod";
import { applyProductDraftIntentPatch, type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";
import { applyCanonicalProductIntentProposal, buildCanonicalProductIntentProposal } from "./productIntentCanonicalProposal";

/** Provider-facing Product Builder language. It contains only business labels
 * and effects; canonical patches, PBV2 nodes, IDs, revisions, fingerprints,
 * and persistence metadata remain entirely server-owned. */
export const semanticProductOperationsResultSchema = z.object({
  kind: z.literal("semantic_operations"),
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("set_product_name"), name: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_product_description"), description: z.string().trim().min(1).max(10_000) }).strict(),
    z.object({ op: z.literal("set_category"), category: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_material"), material: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("clear_material") }).strict(),
    z.object({ op: z.literal("set_measurement_mode"), mode: z.enum(["dimensions_required", "quantity_only"]) }).strict(),
    z.object({ op: z.literal("set_pricing_basis"), basis: z.enum(["per_piece", "per_square_foot"]) }).strict(),
    z.object({ op: z.literal("add_option_group"), optionGroup: z.string().trim().min(1).max(160), required: z.boolean(), selectionMode: z.enum(["single", "multiple"]) }).strict(),
    z.object({ op: z.literal("rename_option_group"), optionGroup: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("add_option_value"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("add_text_input"), optionGroup: z.string().trim().min(1).max(160), label: z.string().trim().min(1).max(160), multiline: z.boolean(), required: z.boolean(), whenOptionGroup: z.string().trim().min(1).max(160).optional(), whenValue: z.string().trim().min(1).max(160).optional() }).strict(),
    z.object({ op: z.literal("set_option_rate"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), priceCents: z.number().int().min(0).max(10_000_000), basis: z.enum(["per_piece", "per_square_foot"]).optional() }).strict(),
    z.object({ op: z.literal("set_option_quantity_tiers"), optionGroup: z.string().trim().min(1).max(160), basis: z.enum(["per_piece", "per_square_foot"]), rows: z.array(z.object({ value: z.string().trim().min(1).max(160), tiers: z.array(z.object({ minimumQuantity: z.number().int().positive(), priceCents: z.number().int().min(0).max(10_000_000) }).strict()).min(1) }).strict()).min(1) }).strict(),
    // Retained for legacy compiler continuation compatibility. New Operator
    // function tools expose set_option_rate, not the matrix implementation term.
    z.object({ op: z.literal("set_matrix_rate"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), priceCents: z.number().int().min(0).max(10_000_000), basis: z.enum(["per_piece", "per_square_foot"]).optional() }).strict(),
    z.object({ op: z.literal("set_option_price_impact"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), percent: z.number().finite().min(-100).max(100), replacesPercentageWhen: z.object({ optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict().optional() }).strict(),
    z.object({ op: z.literal("set_option_group_availability"), optionGroup: z.string().trim().min(1).max(160), whenOptionGroup: z.string().trim().min(1).max(160), whenValue: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("remove_option_value"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("remove_option_group"), optionGroup: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_scalar_price"), priceCents: z.number().int().min(0).max(10_000_000), basis: z.enum(["per_piece", "per_square_foot"]) }).strict(),
    // Preserve valid product details when a related detail cannot be represented
    // by the current Product Builder draft model.
    z.object({ op: z.literal("record_unsupported_detail"), detail: z.enum(["customer_specific_availability", "grommet_quantity"]) }).strict(),
    z.object({ op: z.literal("set_proof_requirement"), requiresProofApproval: z.boolean() }).strict(),
  ])).min(1).max(24),
}).strict();
export type SemanticProductOperationsResult = z.infer<typeof semanticProductOperationsResultSchema>;
export type SemanticProductOperationOptions = { categoryLabels?: readonly string[] };

/** Safe, structured failure metadata for server diagnostics. It deliberately
 * identifies only the attempted operation shape, never its business values. */
export class SemanticProductOperationError extends Error {
  constructor(readonly operationIndex: number, readonly operationType: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : "PRODUCT_INTENT_SEMANTIC_OPERATION_REJECTED");
    this.name = "SemanticProductOperationError";
  }
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

type UnresolvedField = ProductDraftIntent["unresolvedFields"][number];

function requiredRatePath(groupKey: string, valueKey: string): string { return `pricing.optionRates.${groupKey}.${valueKey}`; }
function removeUnresolved(paths: readonly UnresolvedField[], path: string): UnresolvedField[] { return paths.filter((field) => field.path !== path); }
function addUnresolved(paths: readonly UnresolvedField[], field: UnresolvedField): UnresolvedField[] {
  return paths.some((candidate) => candidate.path === field.path) ? [...paths] : [...paths, field];
}

/** Converts business operations into a server-built canonical patch. This is
 * deliberately a small translation layer, not an interpreter of user prose. */
function compileCompatibilitySemanticProductOperations(
  current: ProductDraftIntent,
  raw: unknown,
  baseRevision: number,
): ProductDraftIntentPatch {
  const semantic = semanticProductOperationsResultSchema.parse(raw);
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  const orderedOperations = [...semantic.operations];
  const nextGroups = structuredClone(current.optionGroups);
  const metadata: Record<string, ProductDraftIntent["fieldMetadata"][string]> = {};
  let groupsChanged = false;
  let nextPricing = structuredClone(current.pricing);
  let pricingChanged = false;
  let nextMeasurement = structuredClone(current.measurement);
  let measurementChanged = false;
  let nextUnresolved = structuredClone(current.unresolvedFields);
  let unresolvedChanged = false;

  const findGroup = (label: string) => {
    const matches = nextGroups.filter((group) => normalized(group.label) === normalized(label));
    if (matches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    return matches[0]!;
  };
  const findValue = (group: ProductDraftIntent["optionGroups"][number], label: string) => {
    const matches = group.values.filter((value) => normalized(value.label) === normalized(label));
    if (matches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
    return matches[0]!;
  };
  const mark = (path: string) => { metadata[path] = { source: "explicit_user" }; };
  const addRateQuestion = (group: ProductDraftIntent["optionGroups"][number], value: ProductDraftIntent["optionGroups"][number]["values"][number]) => {
    const path = requiredRatePath(group.key, value.key);
    const updated = addUnresolved(nextUnresolved, { path, code: "OPTION_RATE_UNRESOLVED", question: `What is the price for ${value.label} in ${group.label}?` });
    if (updated.length !== nextUnresolved.length) {
      nextUnresolved = updated;
      unresolvedChanged = true;
    }
  };
  const clearRateQuestion = (groupKey: string, valueKey: string) => {
    const updated = removeUnresolved(nextUnresolved, requiredRatePath(groupKey, valueKey));
    if (updated.length !== nextUnresolved.length) {
      nextUnresolved = updated;
      unresolvedChanged = true;
    }
  };
  const clearUnresolved = (path: string) => {
    const updated = removeUnresolved(nextUnresolved, path);
    if (updated.length !== nextUnresolved.length) {
      nextUnresolved = updated;
      unresolvedChanged = true;
    }
  };
  const inferMeasurementFromPricingBasis = (basis: string | undefined) => {
    if (basis !== "per_square_foot") return;
    if (nextMeasurement.mode !== "dimensions_required") {
      nextMeasurement = { mode: "dimensions_required" };
      measurementChanged = true;
      clearUnresolved("measurement.mode");
    }
    // Square-foot pricing is authoritative business evidence for the
    // structural measurement rule; it is not a model-created default.
    metadata["measurement.mode"] = { source: "explicit_user" };
  };

  for (let operationIndex = 0; operationIndex < orderedOperations.length; operationIndex += 1) {
    const operation = orderedOperations[operationIndex]!;
    try {
    if (operation.op === "set_option_price_impact") {
      const group = findGroup(operation.optionGroup);
      const value = findValue(group, operation.value);
      if (operation.replacesPercentageWhen) {
        const prerequisiteGroup = findGroup(operation.replacesPercentageWhen.optionGroup);
        const prerequisiteValue = findValue(prerequisiteGroup, operation.replacesPercentageWhen.value);
        value.priceImpact = undefined;
        value.totalPercentOfBaseWhenEnabled = { percent: operation.percent, prerequisite: { optionGroupKey: prerequisiteGroup.key, optionValueKey: prerequisiteValue.key } };
      } else {
        value.priceImpact = { kind: "percentage_of_base", percent: operation.percent };
        value.totalPercentOfBaseWhenEnabled = undefined;
      }
      groupsChanged = true;
      mark(`optionGroups.${group.key}.${value.key}.priceImpact`);
      continue;
    }
    if (operation.op === "set_pricing_basis") {
      if (nextPricing.model !== "one_dimensional_matrix" && nextPricing.model !== "two_dimensional_matrix" && nextPricing.model !== "unresolved") throw new Error("PRODUCT_INTENT_SEMANTIC_PRICING_BASIS_UNSUPPORTED");
      nextPricing = { ...nextPricing, unit: operation.basis };
      pricingChanged = true;
      clearUnresolved("pricing.unit");
      mark("pricing.unit");
      inferMeasurementFromPricingBasis(operation.basis);
      continue;
    }
    if (operation.op === "set_scalar_price") {
      if (nextPricing.model !== "unresolved" && nextPricing.model !== "scalar") throw new Error("PRODUCT_INTENT_SEMANTIC_SCALAR_PRICE_UNSUPPORTED");
      nextPricing = { model: "scalar", unit: operation.basis, priceCents: operation.priceCents };
      pricingChanged = true;
      clearUnresolved("pricing.unit");
      mark("pricing.scalar");
      inferMeasurementFromPricingBasis(operation.basis);
      continue;
    }
    if (operation.op === "set_option_rate" || operation.op === "set_matrix_rate") {
      const group = findGroup(operation.optionGroup);
      const value = findValue(group, operation.value);
      const basis = operation.basis;
      if (nextPricing.model === "unresolved") {
        nextPricing = {
          model: "one_dimensional_matrix",
          unit: basis ?? nextPricing.unit ?? "unresolved",
          optionKey: group.key,
          cells: group.values.map((candidate) => ({ option: candidate.key, priceCents: candidate.key === value.key ? operation.priceCents : 0 })),
        };
        for (const candidate of group.values) if (candidate.key !== value.key) addRateQuestion(group, candidate);
      } else if (nextPricing.model === "one_dimensional_matrix") {
        if (group.key !== nextPricing.optionKey) throw new Error("PRODUCT_INTENT_SEMANTIC_MATRIX_AXIS_UNRESOLVED");
        nextPricing = { ...nextPricing, ...(basis ? { unit: basis } : {}), cells: nextPricing.cells.map((cell) => cell.option === value.key ? { ...cell, priceCents: operation.priceCents } : cell) };
      } else if (nextPricing.model === "two_dimensional_matrix") {
        const axis = group.key === nextPricing.rowOptionKey ? "row" : group.key === nextPricing.columnOptionKey ? "column" : null;
        if (!axis) throw new Error("PRODUCT_INTENT_SEMANTIC_MATRIX_AXIS_UNRESOLVED");
        nextPricing = { ...nextPricing, ...(basis ? { unit: basis } : {}), cells: nextPricing.cells.map((cell) => cell[axis] === value.key ? { ...cell, priceCents: operation.priceCents } : cell) };
      } else throw new Error("PRODUCT_INTENT_SEMANTIC_MATRIX_RATE_UNSUPPORTED");
      clearRateQuestion(group.key, value.key);
      pricingChanged = true;
      mark("pricing.matrix");
      inferMeasurementFromPricingBasis(basis ?? (nextPricing.model === "one_dimensional_matrix" || nextPricing.model === "two_dimensional_matrix" ? nextPricing.unit : undefined));
      continue;
    }
    if (operation.op === "remove_option_group") {
      const group = findGroup(operation.optionGroup);
      const pricingUsesGroup = (nextPricing.model === "one_dimensional_matrix" && nextPricing.optionKey === group.key)
        || (nextPricing.model === "two_dimensional_matrix" && (nextPricing.rowOptionKey === group.key || nextPricing.columnOptionKey === group.key));
      const hasDependentReference = nextGroups.some((candidate) => candidate.key !== group.key && (candidate.availableWhen?.optionGroupKey === group.key || candidate.values.some((value) => value.totalPercentOfBaseWhenEnabled?.prerequisite.optionGroupKey === group.key)));
      if (pricingUsesGroup || hasDependentReference) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_REQUIRED");
      nextGroups.splice(nextGroups.indexOf(group), 1);
      groupsChanged = true;
      mark(`optionGroups.${group.key}`);
      continue;
    }
    if (operation.op === "remove_option_value") {
      const group = findGroup(operation.optionGroup);
      const value = findValue(group, operation.value);
      if (nextPricing.model === "one_dimensional_matrix" && nextPricing.optionKey === group.key) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_REQUIRED");
      group.values = group.values.filter((candidate) => candidate.key !== value.key);
      groupsChanged = true;
      mark(`optionGroups.${group.key}.${value.key}`);
      continue;
    }
    throw new Error("PRODUCT_INTENT_SEMANTIC_COMPATIBILITY_OPERATION_UNREACHABLE");
    }
    catch (error) {
      if (error instanceof SemanticProductOperationError) throw error;
      throw new SemanticProductOperationError(operationIndex, operation.op, error);
    }
  }

  const operations: ProductDraftIntentPatch["operations"] = [];
  if (measurementChanged) operations.push({ op: "set_measurement", value: nextMeasurement });
  if (groupsChanged) operations.push({ op: "replace_option_groups", value: nextGroups });
  if (pricingChanged) operations.push({ op: "set_pricing", value: nextPricing });
  if (unresolvedChanged) operations.push({ op: "set_unresolved_fields", value: nextUnresolved });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  if (!operations.length) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_EMPTY");
  return { contractVersion: 1, baseRevision, preserveUnchanged: true, operations };
}

/** Continuations plan through shared Product, PBV2, pricing, and material
 * proposal contracts. Only destructive option removal remains compatible. */
export function compileSemanticProductOperations(
  current: ProductDraftIntent,
  raw: unknown,
  baseRevision: number,
  request?: string,
  options: SemanticProductOperationOptions = {},
): ProductDraftIntentPatch {
  const semantic = semanticProductOperationsResultSchema.parse(raw);
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  let proposal;
  try {
    proposal = buildCanonicalProductIntentProposal(current, semantic.operations, request, options);
  } catch (error) {
    // A single-operation batch can be attributed exactly without guessing.
    // Multi-operation dependency attribution remains with the canonical
    // batch diagnostics rather than assigning the wrong operation.
    if (semantic.operations.length === 1) throw new SemanticProductOperationError(0, semantic.operations[0]!.op, error);
    throw error;
  }
  const canonicalPatch = applyCanonicalProductIntentProposal(current, proposal, baseRevision);
  const compatibilityIndexes = new Set(proposal.compatibilityOperations.map((operation) => operation.index));
  const compatibilityOperations = semantic.operations.filter((_, index) => compatibilityIndexes.has(index));
  if (!compatibilityOperations.length) {
    if (!canonicalPatch) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_EMPTY");
    return canonicalPatch;
  }
  const working = canonicalPatch
    ? applyProductDraftIntentPatch(current, canonicalPatch, { parentRevision: current.revision })
    : current;
  const compatibilityPatch = compileCompatibilitySemanticProductOperations(
    working,
    { kind: "semantic_operations", operations: compatibilityOperations },
    working.revision,
  );
  const final = applyProductDraftIntentPatch(working, compatibilityPatch, { parentRevision: current.revision });
  const operations: ProductDraftIntentPatch["operations"] = [];
  const changed = <T>(before: T, after: T) => JSON.stringify(before) !== JSON.stringify(after);
  if (changed(current.identity, final.identity)) operations.push({ op: "set_identity", value: final.identity });
  if (changed(current.measurement, final.measurement)) operations.push({ op: "set_measurement", value: final.measurement });
  if (changed(current.pricing, final.pricing)) operations.push({ op: "set_pricing", value: final.pricing });
  if (changed(current.material, final.material)) operations.push({ op: "set_material", value: final.material });
  if (changed(current.optionGroups, final.optionGroups)) operations.push({ op: "replace_option_groups", value: final.optionGroups });
  if (changed(current.workflow, final.workflow)) operations.push({ op: "set_workflow", value: final.workflow });
  if (changed(current.unresolvedFields, final.unresolvedFields)) operations.push({ op: "set_unresolved_fields", value: final.unresolvedFields });
  const metadata = Object.fromEntries(Object.entries(final.fieldMetadata).filter(([path, value]) => JSON.stringify(current.fieldMetadata[path]) !== JSON.stringify(value)));
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  return {
    contractVersion: 1,
    baseRevision,
    preserveUnchanged: true,
    operations,
  };
}
