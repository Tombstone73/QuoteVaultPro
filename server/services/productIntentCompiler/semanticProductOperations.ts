import { z } from "zod";
import { type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";

/** Provider-facing Product Builder language. It contains only business labels
 * and effects; canonical patches, PBV2 nodes, IDs, revisions, fingerprints,
 * and persistence metadata remain entirely server-owned. */
export const semanticProductOperationsResultSchema = z.object({
  kind: z.literal("semantic_operations"),
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("set_product_name"), name: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_category"), category: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_material"), material: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_measurement_mode"), mode: z.enum(["dimensions_required", "quantity_only"]) }).strict(),
    z.object({ op: z.literal("set_pricing_basis"), basis: z.enum(["per_piece", "per_square_foot"]) }).strict(),
    z.object({ op: z.literal("add_option_group"), optionGroup: z.string().trim().min(1).max(160), required: z.boolean(), selectionMode: z.enum(["single", "multiple"]) }).strict(),
    z.object({ op: z.literal("rename_option_group"), optionGroup: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("add_option_value"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_option_rate"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), priceCents: z.number().int().min(0).max(10_000_000), basis: z.enum(["per_piece", "per_square_foot"]).optional() }).strict(),
    // Retained for legacy compiler continuation compatibility. New Operator
    // function tools expose set_option_rate, not the matrix implementation term.
    z.object({ op: z.literal("set_matrix_rate"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), priceCents: z.number().int().min(0).max(10_000_000), basis: z.enum(["per_piece", "per_square_foot"]).optional() }).strict(),
    z.object({ op: z.literal("set_option_price_impact"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160), percent: z.number().finite().min(-100).max(100), replacesPercentageWhen: z.object({ optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict().optional() }).strict(),
    z.object({ op: z.literal("set_option_group_availability"), optionGroup: z.string().trim().min(1).max(160), whenOptionGroup: z.string().trim().min(1).max(160), whenValue: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("set_option_default"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("remove_option_value"), optionGroup: z.string().trim().min(1).max(160), value: z.string().trim().min(1).max(160) }).strict(),
    z.object({ op: z.literal("remove_option_group"), optionGroup: z.string().trim().min(1).max(160) }).strict(),
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

function containsWholePhrase(source: string, phrase: string): boolean {
  const sourceTokens = normalized(source).split(" ").filter(Boolean);
  const phraseTokens = normalized(phrase).split(" ").filter(Boolean);
  return phraseTokens.length > 0 && sourceTokens.some((_, index) => phraseTokens.every((token, offset) => sourceTokens[index + offset] === token));
}

function normalizeWhitespace(value: string): string { return value.trim().replace(/\s+/g, " "); }

/** A quoted name introduced with ordinary product-naming language is direct
 * user evidence. The server preserves it rather than accepting a shortened
 * model paraphrase of the same name. */
function explicitProductNameFromRequest(request: string | undefined): string | null {
  if (!request) return null;
  const singleQuoted = /\b(?:called|named)\s*'([^']+)'/i.exec(request);
  if (singleQuoted?.[1]) return normalizeWhitespace(singleQuoted[1]);
  const match = /\b(?:called|named)\s*["“]([^"”]+)["”]/i.exec(request);
  if (match?.[1]) return normalizeWhitespace(match[1]);
  const unquoted = /\b(?:called|named)\s+(.+?)(?=\s*[.!?](?:\s|$)|$)/i.exec(request);
  return unquoted?.[1] ? normalizeWhitespace(unquoted[1]) : null;
}

function requestUniquelyIdentifiesCandidate(request: string | undefined, candidate: string, labels: readonly string[]): boolean {
  if (!request) return false;
  const requestTokens = new Set(normalized(request).split(" ").filter(Boolean));
  const candidateTokens = new Set(normalized(candidate).split(" ").filter(Boolean));
  return Array.from(candidateTokens).some((token) => requestTokens.has(token)
    && labels.filter((label) => normalized(label).split(" ").includes(token)).length === 1);
}

function resolveCategoryLabel(category: string, request: string | undefined, labels: readonly string[] | undefined): string {
  const exactCandidate = (labels ?? []).find((label) => normalized(label) === normalized(category));
  if (request && !containsWholePhrase(request, category) && !(exactCandidate && requestUniquelyIdentifiesCandidate(request, exactCandidate, labels ?? []))) {
    throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
  }
  const candidates = Array.from(new Set((labels ?? []).map((label) => label.trim()).filter(Boolean))).filter((label) => containsWholePhrase(label, category));
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_AMBIGUOUS");
  if (!labels?.length) return category;
  throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
}

function serverKey(label: string, existing: readonly string[]): string {
  const base = normalized(label).replace(/ /g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80) || "option";
  const used = new Set(existing.map((key) => key.toLocaleLowerCase()));
  if (!used.has(base)) return base;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("PRODUCT_INTENT_SEMANTIC_KEY_EXHAUSTED");
}

type UnresolvedField = ProductDraftIntent["unresolvedFields"][number];

function requiredRatePath(groupKey: string, valueKey: string): string { return `pricing.optionRates.${groupKey}.${valueKey}`; }
function removeUnresolved(paths: readonly UnresolvedField[], path: string): UnresolvedField[] { return paths.filter((field) => field.path !== path); }
function addUnresolved(paths: readonly UnresolvedField[], field: UnresolvedField): UnresolvedField[] {
  return paths.some((candidate) => candidate.path === field.path) ? [...paths] : [...paths, field];
}

/** Converts business operations into a server-built canonical patch. This is
 * deliberately a small translation layer, not an interpreter of user prose. */
export function compileSemanticProductOperations(
  current: ProductDraftIntent,
  raw: unknown,
  baseRevision: number,
  request?: string,
  options: SemanticProductOperationOptions = {},
): ProductDraftIntentPatch {
  const semantic = semanticProductOperationsResultSchema.parse(raw);
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  const nextGroups = structuredClone(current.optionGroups);
  const metadata: Record<string, ProductDraftIntent["fieldMetadata"][string]> = {};
  let groupsChanged = false;
  let nextPricing = structuredClone(current.pricing);
  let pricingChanged = false;
  let nextIdentity = structuredClone(current.identity);
  let identityChanged = false;
  let categoryChanged = false;
  let nextMaterial = structuredClone(current.material);
  let materialChanged = false;
  let nextWorkflow = structuredClone(current.workflow);
  let workflowChanged = false;
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

  for (let operationIndex = 0; operationIndex < semantic.operations.length; operationIndex += 1) {
    const operation = semantic.operations[operationIndex];
    try {
    if (operation.op === "set_category") {
      // Identity is one canonical object, but a valid ordered creation batch
      // commonly establishes its name and then its category.  Reject only a
      // second category assignment in the same atomic batch, not the name.
      if (categoryChanged) throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
      nextIdentity = { ...nextIdentity, category: { state: "unresolved", label: resolveCategoryLabel(operation.category, request, options.categoryLabels) } };
      identityChanged = true;
      categoryChanged = true;
      mark("identity.category");
      continue;
    }
    if (operation.op === "set_product_name") {
      if (request && !containsWholePhrase(request, operation.name)) throw new Error("PRODUCT_INTENT_SEMANTIC_PRODUCT_NAME_UNRESOLVED");
      nextIdentity = { ...nextIdentity, name: explicitProductNameFromRequest(request) ?? operation.name };
      identityChanged = true;
      clearUnresolved("identity.name");
      mark("identity.name");
      continue;
    }
    if (operation.op === "set_material") {
      nextMaterial = { state: "unresolved", label: operation.material };
      materialChanged = true;
      mark("material");
      continue;
    }
    if (operation.op === "set_measurement_mode") {
      nextMeasurement = operation.mode === "dimensions_required" ? { mode: "dimensions_required" } : { mode: "quantity_only" };
      measurementChanged = true;
      clearUnresolved("measurement.mode");
      mark("measurement.mode");
      continue;
    }
    if (operation.op === "set_proof_requirement") {
      nextWorkflow = { ...nextWorkflow, requiresProofApproval: operation.requiresProofApproval };
      workflowChanged = true;
      mark("workflow.requiresProofApproval");
      continue;
    }
    if (operation.op === "add_option_group") {
      if (nextGroups.some((group) => normalized(group.label) === normalized(operation.optionGroup))) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_EXISTS");
      const key = serverKey(operation.optionGroup, nextGroups.map((group) => group.key));
      nextGroups.push({ key, label: operation.optionGroup, required: operation.required, selectionMode: operation.selectionMode, values: [] });
      groupsChanged = true;
      mark(`optionGroups.${key}`);
      continue;
    }
    if (operation.op === "add_option_value") {
      const group = findGroup(operation.optionGroup);
      if (group.values.some((value) => normalized(value.label) === normalized(operation.value))) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_EXISTS");
      const value = { key: serverKey(operation.value, group.values.map((item) => item.key)), label: operation.value, isDefault: false };
      group.values.push(value);
      if (nextPricing.model === "one_dimensional_matrix" && nextPricing.optionKey === group.key) {
        nextPricing = { ...nextPricing, cells: [...nextPricing.cells, { option: value.key, priceCents: 0 }] };
        pricingChanged = true;
        addRateQuestion(group, value);
      }
      groupsChanged = true;
      mark(`optionGroups.${group.key}.${value.key}`);
      continue;
    }
    if (operation.op === "rename_option_group") {
      const group = findGroup(operation.optionGroup);
      if (nextGroups.some((candidate) => candidate.key !== group.key && normalized(candidate.label) === normalized(operation.name))) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_EXISTS");
      group.label = operation.name;
      groupsChanged = true;
      mark(`optionGroups.${group.key}.label`);
      continue;
    }
    if (operation.op === "set_option_group_availability") {
      const group = findGroup(operation.optionGroup);
      const prerequisiteGroup = findGroup(operation.whenOptionGroup);
      const prerequisiteValue = findValue(prerequisiteGroup, operation.whenValue);
      if (group.key === prerequisiteGroup.key) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_DEPENDENCY_INVALID");
      group.availableWhen = { optionGroupKey: prerequisiteGroup.key, optionValueKey: prerequisiteValue.key };
      groupsChanged = true;
      mark(`optionGroups.${group.key}.availableWhen`);
      continue;
    }
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
    const group = findGroup(operation.optionGroup);
    const value = findValue(group, operation.value);
    if (operation.op === "remove_option_value") {
      if (nextPricing.model === "one_dimensional_matrix" && nextPricing.optionKey === group.key) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_REQUIRED");
      group.values = group.values.filter((candidate) => candidate.key !== value.key);
      groupsChanged = true;
      mark(`optionGroups.${group.key}.${value.key}`);
    } else {
      if (group.selectionMode !== "single") throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
      group.values = group.values.map((candidate) => ({ ...candidate, isDefault: candidate.key === value.key }));
      groupsChanged = true;
      mark(`optionGroups.${group.key}.default`);
    }
    }
    catch (error) {
      if (error instanceof SemanticProductOperationError) throw error;
      throw new SemanticProductOperationError(operationIndex, operation.op, error);
    }
  }

  const operations: ProductDraftIntentPatch["operations"] = [];
  if (identityChanged) operations.push({ op: "set_identity", value: nextIdentity });
  if (materialChanged) operations.push({ op: "set_material", value: nextMaterial });
  if (measurementChanged) operations.push({ op: "set_measurement", value: nextMeasurement });
  if (groupsChanged) operations.push({ op: "replace_option_groups", value: nextGroups });
  if (pricingChanged) operations.push({ op: "set_pricing", value: nextPricing });
  if (workflowChanged) operations.push({ op: "set_workflow", value: nextWorkflow });
  if (unresolvedChanged) operations.push({ op: "set_unresolved_fields", value: nextUnresolved });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  if (!operations.length) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_EMPTY");
  return { contractVersion: 1, baseRevision, preserveUnchanged: true, operations };
}
