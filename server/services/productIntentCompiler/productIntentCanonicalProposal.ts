import { z } from "zod";
import { productDraftIntentSchema, type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";
import {
  normalizeCanonicalProductConfigurationChanges,
  productConfigurationChangesSchema,
  type ProductConfigurationChanges,
} from "../products/canonicalProductConfigurationOperations";
import {
  applyPbv2OptionConfigurationMutations,
  CanonicalPbv2OptionConfigurationError,
  pbv2OptionConfigurationMutationsSchema,
  validateCanonicalPbv2OptionConfigurationTree,
  type Pbv2OptionConfigurationMutation,
} from "../products/canonicalPbv2OptionConfigurationOperations";

const compatibilityOperationNameSchema = z.enum([
  "set_material",
  "set_pricing_basis",
  "set_scalar_price",
  "set_option_rate",
  "set_matrix_rate",
  "set_option_price_impact",
  "remove_option_value",
  "remove_option_group",
]);

const unsupportedDetailSchema = z.object({
  code: z.enum(["customer_specific_availability", "grommet_quantity"]),
  blocking: z.literal(false),
}).strict();

/** A pre-persistence proposal composes the same Phase 5/6 input contracts used
 * for persisted Products. It deliberately has no Product id, version, actor,
 * lifecycle action, or persistence metadata. */
export const canonicalProductIntentProposalSchema = z.object({
  kind: z.literal("canonical_product_intent_proposal"),
  productConfiguration: productConfigurationChangesSchema.optional(),
  pbv2OptionConfiguration: pbv2OptionConfigurationMutationsSchema.optional(),
  unsupportedDetails: z.array(unsupportedDetailSchema).default([]),
  compatibilityOperations: z.array(z.object({ index: z.number().int().nonnegative(), op: compatibilityOperationNameSchema }).strict()).default([]),
}).strict().refine(
  (proposal) => proposal.productConfiguration || proposal.pbv2OptionConfiguration || proposal.unsupportedDetails.length || proposal.compatibilityOperations.length,
  "At least one Product intent proposal fragment is required.",
);
export type CanonicalProductIntentProposal = z.infer<typeof canonicalProductIntentProposalSchema>;
/** Persisted pre-persistence state uses the same canonical proposal contract.
 * Unlike an incremental proposal, this value is a complete snapshot of the
 * already-migrated Product/PBV2 surface. */
export const canonicalProductIntentStateSchema = z.object({
  kind: z.literal("canonical_product_intent_proposal_state"),
  productConfiguration: productConfigurationChangesSchema,
  /** Each batch is the exact Phase 6 mutation input contract. Chunking keeps
   * historical V1 drafts with more than one command-sized option set loadable
   * without weakening the live operation's 24-mutation safety ceiling. */
  pbv2OptionConfigurationBatches: z.array(pbv2OptionConfigurationMutationsSchema).default([]),
  unsupportedDetails: z.array(unsupportedDetailSchema).default([]),
}).strict();
export type CanonicalProductIntentState = z.infer<typeof canonicalProductIntentStateSchema>;

type SemanticOperation = Record<string, unknown> & { op: string };
export type CanonicalProductIntentPlanningOptions = { categoryLabels?: readonly string[] };

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function containsWholePhrase(source: string, phrase: string): boolean {
  const sourceTokens = normalized(source).split(" ").filter(Boolean);
  const phraseTokens = normalized(phrase).split(" ").filter(Boolean);
  return phraseTokens.length > 0 && sourceTokens.some((_, index) => phraseTokens.every((token, offset) => sourceTokens[index + offset] === token));
}

function explicitProductName(request: string | undefined): string | null {
  if (!request) return null;
  const quoted = /\b(?:product|item)\s+for\s*["']([^"']+)["']/i.exec(request)
    ?? /\b(?:called|named)\s*["']([^"']+)["']/i.exec(request);
  if (quoted?.[1]) return quoted[1].trim().replace(/\s+/g, " ");
  const unquoted = /\b(?:called|named)\s+(.+?)(?=\s*[.!?](?:\s|$)|$)/i.exec(request);
  return unquoted?.[1]?.trim().replace(/\s+/g, " ") ?? null;
}

function uniquelyIdentifiesCandidate(request: string, candidate: string, labels: readonly string[]): boolean {
  const requestTokens = new Set(normalized(request).split(" ").filter(Boolean));
  return normalized(candidate).split(" ").some((token) => requestTokens.has(token)
    && labels.filter((label) => normalized(label).split(" ").includes(token)).length === 1);
}

function resolveCategory(category: string, request: string | undefined, labels: readonly string[] | undefined): string {
  const exact = (labels ?? []).find((label) => normalized(label) === normalized(category));
  if (request && !containsWholePhrase(request, category) && !(exact && uniquelyIdentifiesCandidate(request, exact, labels ?? []))) throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
  const candidates = Array.from(new Set((labels ?? []).filter((label) => containsWholePhrase(label, category))));
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

function findGroup(intent: ProductDraftIntent, label: string) {
  const matches = intent.optionGroups.filter((group) => normalized(group.label) === normalized(label) || normalized(group.key) === normalized(label));
  if (matches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
  return matches[0]!;
}

function findValue(group: ProductDraftIntent["optionGroups"][number], label: string) {
  const matches = group.values.filter((value) => normalized(value.label) === normalized(label) || normalized(value.key) === normalized(label));
  if (matches.length !== 1) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
  return matches[0]!;
}

/** Classifies semantic operations and builds canonical-operation-shaped
 * fragments. Pricing, material, and deletion remain narrow compatibility
 * operations because Phases 5/6 intentionally did not migrate them. */
export function buildCanonicalProductIntentProposal(
  current: ProductDraftIntent,
  operations: readonly SemanticOperation[],
  request?: string,
  options: CanonicalProductIntentPlanningOptions = {},
): CanonicalProductIntentProposal {
  const productConfiguration: Record<string, unknown> = {};
  const mutations: Pbv2OptionConfigurationMutation[] = [];
  const unsupportedDetails: Array<{ code: "customer_specific_availability" | "grommet_quantity"; blocking: false }> = [];
  const compatibilityOperations: Array<{ index: number; op: z.infer<typeof compatibilityOperationNameSchema> }> = [];
  const knownGroups = current.optionGroups.map((group) => ({ key: group.key, label: group.label, values: group.values.map((value) => ({ key: value.key, label: value.label })) }));
  const suppliedName = explicitProductName(request);
  const nameOperations = operations.filter((operation) => operation.op === "set_product_name");
  if (nameOperations.length > 1) throw new Error("PRODUCT_INTENT_SEMANTIC_PRODUCT_NAME_UNRESOLVED");
  if (suppliedName) productConfiguration.name = suppliedName;
  else if (nameOperations[0]) {
    const name = String(nameOperations[0].name);
    if (request && !containsWholePhrase(request, name)) throw new Error("PRODUCT_INTENT_SEMANTIC_PRODUCT_NAME_UNRESOLVED");
    productConfiguration.name = name;
  }
  const categoryOperations = operations.filter((operation) => operation.op === "set_category");
  if (categoryOperations.length > 1) throw new Error("PRODUCT_INTENT_SEMANTIC_CATEGORY_UNRESOLVED");
  if (categoryOperations[0]) productConfiguration.category = resolveCategory(String(categoryOperations[0].category), request, options.categoryLabels);

  // Establish newly requested groups before their choices/defaults regardless
  // of provider ordering. This is generic dependency planning, not vocabulary.
  operations.forEach((operation) => {
    if (operation.op !== "add_option_group") return;
    const label = String(operation.optionGroup);
    if (knownGroups.some((group) => normalized(group.label) === normalized(label))) return;
    const key = serverKey(label, knownGroups.map((group) => group.key));
    knownGroups.push({ key, label, values: [] });
    mutations.push(
      { kind: "add_group", group: { key: `${key}_group`, label } },
      { kind: "add_input", group: `${key}_group`, input: { selectionKey: key, label, type: operation.selectionMode === "multiple" ? "multiselect" : "select", required: Boolean(operation.required), choices: [] } },
    );
  });

  operations.forEach((operation) => {
    if (operation.op !== "rename_option_group") return;
    const group = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.optionGroup)) || normalized(candidate.key) === normalized(String(operation.optionGroup)));
    if (!group) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    mutations.push(
      { kind: "update_group", group: `${group.key}_group`, changes: { label: String(operation.name) } },
      { kind: "update_input", input: group.key, changes: { label: String(operation.name) } },
    );
    group.label = String(operation.name);
  });

  operations.forEach((operation) => {
    if (operation.op !== "add_option_value") return;
    const group = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.optionGroup)) || normalized(candidate.key) === normalized(String(operation.optionGroup)));
    if (!group) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    const label = String(operation.value);
    if (group.values.some((value) => normalized(value.label) === normalized(label))) return;
    const value = serverKey(label, group.values.map((candidate) => candidate.key));
    group.values.push({ key: value, label });
    mutations.push({ kind: "add_choice", input: group.key, choice: { value, label } });
  });

  operations.forEach((operation) => {
    if (operation.op !== "add_text_input") return;
    if (Boolean(operation.whenOptionGroup) !== Boolean(operation.whenValue)) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_DEPENDENCY_INVALID");
    const parent = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.optionGroup)) || normalized(candidate.key) === normalized(String(operation.optionGroup)));
    if (!parent) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
    const selectionKey = serverKey(String(operation.label), knownGroups.map((group) => group.key));
    let visibilityRules: Array<{ type: "equals"; selectionKey: string; value: string }> | undefined;
    if (operation.whenOptionGroup && operation.whenValue) {
      const prerequisite = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.whenOptionGroup)) || normalized(candidate.key) === normalized(String(operation.whenOptionGroup)));
      if (!prerequisite) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
      const value = prerequisite.values.find((candidate) => normalized(candidate.label) === normalized(String(operation.whenValue)) || normalized(candidate.key) === normalized(String(operation.whenValue)));
      if (!value) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
      visibilityRules = [{ type: "equals", selectionKey: prerequisite.key, value: value.key }];
    }
    mutations.push({ kind: "add_input", group: `${parent.key}_group`, input: { selectionKey, label: String(operation.label), type: operation.multiline ? "textarea" : "text", required: Boolean(operation.required), ...(visibilityRules ? { visibilityRules } : {}) } });
    knownGroups.push({ key: selectionKey, label: String(operation.label), values: [] });
  });

  operations.forEach((operation, index) => {
    switch (operation.op) {
      case "set_product_name": return;
      case "set_product_description": productConfiguration.description = operation.description; return;
      case "set_category": return;
      case "set_measurement_mode": productConfiguration.measurementMode = operation.mode; return;
      case "set_proof_requirement": productConfiguration.requiresProofApproval = operation.requiresProofApproval; return;
      case "add_option_group": return;
      case "rename_option_group": return;
      case "add_option_value": return;
      case "add_text_input": return;
      case "set_option_default": {
        const group = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.optionGroup)) || normalized(candidate.key) === normalized(String(operation.optionGroup)));
        if (!group) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_GROUP_UNRESOLVED");
        const choice = group.values.find((candidate) => normalized(candidate.label) === normalized(String(operation.value)) || normalized(candidate.key) === normalized(String(operation.value)));
        if (!choice) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
        mutations.push({ kind: "set_default", input: group.key, choice: choice.key });
        return;
      }
      case "set_option_group_availability": {
        const group = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.optionGroup)) || normalized(candidate.key) === normalized(String(operation.optionGroup)));
        const prerequisite = knownGroups.find((candidate) => normalized(candidate.label) === normalized(String(operation.whenOptionGroup)) || normalized(candidate.key) === normalized(String(operation.whenOptionGroup)));
        if (!group || !prerequisite || group.key === prerequisite.key) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_DEPENDENCY_INVALID");
        const choice = prerequisite.values.find((candidate) => normalized(candidate.label) === normalized(String(operation.whenValue)) || normalized(candidate.key) === normalized(String(operation.whenValue)));
        if (!choice) throw new Error("PRODUCT_INTENT_SEMANTIC_OPTION_VALUE_UNRESOLVED");
        mutations.push({ kind: "update_input", input: group.key, changes: { visibilityRules: [{ type: "equals", selectionKey: prerequisite.key, value: choice.key }] } });
        return;
      }
      case "record_unsupported_detail": {
        const code = operation.detail;
        if (code === "customer_specific_availability" || code === "grommet_quantity") unsupportedDetails.push({ code, blocking: false });
        return;
      }
      default:
        if (compatibilityOperationNameSchema.safeParse(operation.op).success) compatibilityOperations.push({ index, op: operation.op as z.infer<typeof compatibilityOperationNameSchema> });
    }
  });

  const parsedConfiguration = Object.keys(productConfiguration).length ? normalizeCanonicalProductConfigurationChanges(productConfiguration) : undefined;
  const parsedMutations = mutations.length ? pbv2OptionConfigurationMutationsSchema.parse(mutations) : undefined;
  return canonicalProductIntentProposalSchema.parse({
    kind: "canonical_product_intent_proposal",
    ...(parsedConfiguration ? { productConfiguration: parsedConfiguration } : {}),
    ...(parsedMutations ? { pbv2OptionConfiguration: parsedMutations } : {}),
    unsupportedDetails,
    compatibilityOperations,
  });
}

const unsupportedMetadataPrefix = "unsupportedDetails.";

function snapshotUnsupportedDetails(intent: ProductDraftIntent) {
  const codes = new Set<"customer_specific_availability" | "grommet_quantity">();
  if (intent.fieldMetadata[`${unsupportedMetadataPrefix}customer_specific_availability`]) codes.add("customer_specific_availability");
  if (intent.fieldMetadata[`${unsupportedMetadataPrefix}grommet_quantity`]
    || intent.unresolvedFields.some((field) => field.code === "GROMMET_QUANTITY_UNRESOLVED")) codes.add("grommet_quantity");
  return Array.from(codes).map((code) => ({ code, blocking: false as const }));
}

/** Compatibility-only V1 reader. Historical ProductDraftIntent rows did not
 * persist canonical proposal state, so migrated fields are imported once into
 * the Phase 5/6 contract. New writes persist this state and project the legacy
 * representation from it instead of maintaining two mutable truths. */
export function canonicalProductIntentStateFromV1Draft(intentValue: unknown): CanonicalProductIntentState {
  const intent = productDraftIntentSchema.parse(intentValue);
  const productConfiguration = normalizeCanonicalProductConfigurationChanges({
    name: intent.identity.name,
    description: intent.identity.description,
    category: intent.identity.category.label,
    ...(intent.measurement.mode === "fixed_size" ? {} : { measurementMode: intent.measurement.mode }),
    workflowIntent: intent.workflow.kind,
    requiresProductionJob: intent.workflow.requiresProductionJob,
    requiresProofApproval: intent.workflow.requiresProofApproval,
  });
  const parentGroups = new Map<string, { key: string; label: string }>();
  for (const group of intent.optionGroups) {
    const parentKey = group.parentGroupKey ?? group.key;
    if (!parentGroups.has(parentKey)) {
      const parent = intent.optionGroups.find((candidate) => candidate.key === parentKey);
      parentGroups.set(parentKey, { key: parentKey, label: parent?.label ?? group.label });
    }
  }
  const mutations: Pbv2OptionConfigurationMutation[] = [];
  for (const group of parentGroups.values()) mutations.push({ kind: "add_group", group: { key: `${group.key}_group`, label: group.label } });
  for (const group of intent.optionGroups) {
    const defaults = group.values.filter((value) => value.isDefault).map((value) => value.key);
    mutations.push({
      kind: "add_input",
      group: `${group.parentGroupKey ?? group.key}_group`,
      input: {
        selectionKey: group.key,
        label: group.label,
        type: group.inputType ?? (group.selectionMode === "multiple" ? "multiselect" : "select"),
        required: group.required,
        ...(group.inputType ? {} : { choices: group.values.map((value, sortOrder) => ({ value: value.key, label: value.label, sortOrder })) }),
        ...(defaults.length ? { defaultValue: group.selectionMode === "multiple" ? defaults : defaults[0]! } : {}),
        ...(group.availableWhen ? { visibilityRules: [{ type: "equals" as const, selectionKey: group.availableWhen.optionGroupKey, value: group.availableWhen.optionValueKey }] } : {}),
      },
    });
  }
  return canonicalProductIntentStateSchema.parse({
    kind: "canonical_product_intent_proposal_state",
    productConfiguration,
    pbv2OptionConfigurationBatches: Array.from({ length: Math.ceil(mutations.length / 24) }, (_, index) => mutations.slice(index * 24, (index + 1) * 24)),
    unsupportedDetails: snapshotUnsupportedDetails(intent),
  });
}

function draftTree(intent: ProductDraftIntent): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  const edges: Record<string, unknown>[] = [];
  for (const [index, group] of intent.optionGroups.entries()) {
    const groupKey = group.parentGroupKey ?? group.key;
    const parent = intent.optionGroups.find((candidate) => candidate.key === groupKey);
    const groupId = `draft_group_${groupKey}`;
    const inputId = `draft_input_${group.key}`;
    nodes[groupId] ??= { id: groupId, type: "GROUP", kind: "group", status: "ENABLED", key: `${groupKey}_group`, label: parent?.label ?? group.label, displayOrder: index };
    nodes[inputId] = {
      id: inputId, type: "INPUT", kind: "question", status: "ENABLED", key: group.key, label: group.label,
      input: { type: group.inputType ?? (group.selectionMode === "multiple" ? "multiselect" : "select"), selectionKey: group.key, valueType: group.inputType ? "TEXT" : "ENUM", required: group.required, ...(group.values.some((value) => value.isDefault) ? { defaultValue: group.selectionMode === "multiple" ? group.values.filter((value) => value.isDefault).map((value) => value.key) : group.values.find((value) => value.isDefault)!.key } : {}) },
      choices: group.values.map((value, choiceIndex) => ({ value: value.key, label: value.label, sortOrder: choiceIndex })),
      ...(group.availableWhen ? { visibility: { rules: [{ type: "equals", selectionKey: group.availableWhen.optionGroupKey, value: group.availableWhen.optionValueKey }] } } : {}),
    };
    edges.push({ id: `draft_edge_${group.key}`, fromNodeId: groupId, toNodeId: inputId, status: "DISABLED" });
  }
  return { schemaVersion: 2, status: "DRAFT", nodes, edges, rootNodeIds: intent.optionGroups.map((group) => `draft_input_${group.key}`) };
}

function groupsFromTree(intent: ProductDraftIntent, tree: Record<string, any>): ProductDraftIntent["optionGroups"] {
  const priorGroups = new Map(intent.optionGroups.map((group) => [group.key, group]));
  const inputs = Object.values(tree.nodes ?? {}).filter((node: any) => String(node?.type).toUpperCase() === "INPUT" && node?.status !== "DELETED") as any[];
  return inputs.sort((left, right) => Number(left.ui?.sortOrder ?? 0) - Number(right.ui?.sortOrder ?? 0)).map((input) => {
    const key = String(input.input?.selectionKey ?? input.key);
    const prior = priorGroups.get(key);
    const defaultValue = input.input?.defaultValue;
    const defaults = new Set(Array.isArray(defaultValue) ? defaultValue.map(String) : defaultValue == null ? [] : [String(defaultValue)]);
    const priorValues = new Map((prior?.values ?? []).map((value) => [value.key, value]));
    const visibility = Array.isArray(input.visibility?.rules) && input.visibility.rules.length === 1 && input.visibility.rules[0]?.type === "equals" ? input.visibility.rules[0] : null;
    const parentEdge = (Array.isArray(tree.edges) ? tree.edges : []).find((edge: any) => edge?.toNodeId === input.id);
    const parentNode = parentEdge ? tree.nodes?.[parentEdge.fromNodeId] : null;
    const parentGroupKey = typeof parentNode?.key === "string" && parentNode.key.endsWith("_group") ? parentNode.key.slice(0, -"_group".length) : null;
    return {
      key,
      label: String(input.label ?? key),
      required: Boolean(input.input?.required),
      selectionMode: input.input?.type === "multiselect" ? "multiple" as const : "single" as const,
      ...((input.input?.type === "text" || input.input?.type === "textarea") ? { inputType: input.input.type as "text" | "textarea" } : {}),
      ...((input.input?.type === "text" || input.input?.type === "textarea") && parentGroupKey && parentGroupKey !== key ? { parentGroupKey } : {}),
      values: (Array.isArray(input.choices) ? input.choices : []).map((choice: any) => {
        const value = String(choice.value);
        return { ...(priorValues.get(value) ?? {}), key: value, label: String(choice.label ?? value), isDefault: defaults.has(value) };
      }),
      ...(visibility ? { availableWhen: { optionGroupKey: String(visibility.selectionKey), optionValueKey: String(visibility.value) } } : {}),
    };
  });
}

/** Authoritative-state projection for consumers that still require the V1
 * ProductDraftIntent revision contract. Pricing impacts are overlaid from the
 * compatibility source; Product/PBV2 shape always comes from canonical state. */
export function projectCanonicalProductIntentStateToV1Draft(
  currentValue: unknown,
  stateValue: unknown,
): ProductDraftIntent {
  const current = productDraftIntentSchema.parse(currentValue);
  const state = canonicalProductIntentStateSchema.parse(stateValue);
  const configuration = normalizeCanonicalProductConfigurationChanges(state.productConfiguration);
  const category = configuration.category === undefined || configuration.category === null
    ? current.identity.category
    : normalized(current.identity.category.label) === normalized(configuration.category)
      ? current.identity.category
      : { state: "unresolved" as const, label: configuration.category };
  const emptyTree: Record<string, unknown> = { schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [], rootNodeIds: [] };
  const tree = state.pbv2OptionConfigurationBatches.reduce<Record<string, any>>(
    (working, batch) => applyPbv2OptionConfigurationMutations(working, batch).tree,
    emptyTree,
  );
  const findings = validateCanonicalPbv2OptionConfigurationTree(tree, false);
  if (findings.length) throw new CanonicalPbv2OptionConfigurationError("PBV2_CONFIGURATION_INVALID", "The pre-persistence PBV2 proposal state is invalid.", findings);
  const unsupportedCodes = new Set(state.unsupportedDetails.map((detail) => detail.code));
  const fieldMetadata = Object.fromEntries(Object.entries(current.fieldMetadata).filter(([path]) => !path.startsWith(unsupportedMetadataPrefix)));
  for (const code of unsupportedCodes) fieldMetadata[`${unsupportedMetadataPrefix}${code}`] = { source: "explicit_user" };
  let unresolvedFields = current.unresolvedFields.filter((field) => field.code !== "GROMMET_QUANTITY_UNRESOLVED");
  if (unsupportedCodes.has("grommet_quantity")) unresolvedFields = [...unresolvedFields, {
    path: "optionGroups.grommets.quantity",
    code: "GROMMET_QUANTITY_UNRESOLVED",
    question: "How should the requested counted grommet quantity be represented?",
  }];
  return productDraftIntentSchema.parse({
    ...current,
    identity: {
      ...current.identity,
      name: configuration.name ?? current.identity.name,
      description: configuration.description ?? current.identity.description,
      category,
    },
    measurement: configuration.measurementMode ? { mode: configuration.measurementMode } : current.measurement,
    workflow: {
      kind: configuration.workflowIntent ?? current.workflow.kind,
      requiresProductionJob: configuration.requiresProductionJob ?? current.workflow.requiresProductionJob,
      requiresProofApproval: configuration.requiresProofApproval ?? current.workflow.requiresProofApproval,
    },
    optionGroups: groupsFromTree(current, tree),
    unresolvedFields,
    fieldMetadata,
  });
}

/** Applies only the shared Phase 5/6 proposal fragments to an unpublished
 * ProductDraftIntent. The canonical PBV2 transformer owns reference/default
 * validity; this adapter merely projects the resulting pre-persistence state
 * back into the compatible revision contract. */
export function applyCanonicalProductIntentProposal(
  current: ProductDraftIntent,
  proposalValue: unknown,
  baseRevision: number,
): ProductDraftIntentPatch | null {
  if (baseRevision !== current.revision) throw new Error("PRODUCT_INTENT_SEMANTIC_OPERATION_STALE");
  const proposal = canonicalProductIntentProposalSchema.parse(proposalValue);
  const operations: ProductDraftIntentPatch["operations"] = [];
  const metadata: ProductDraftIntent["fieldMetadata"] = {};
  const resolvedPaths = new Set<string>();
  const configuration = proposal.productConfiguration
    ? normalizeCanonicalProductConfigurationChanges(proposal.productConfiguration) as ProductConfigurationChanges
    : undefined;
  if (configuration) {
    if (configuration.name !== undefined || configuration.description !== undefined || configuration.category !== undefined) {
      operations.push({ op: "set_identity", value: {
        ...current.identity,
        ...(configuration.name !== undefined ? { name: configuration.name } : {}),
        ...(configuration.description !== undefined ? { description: configuration.description } : {}),
        ...(configuration.category !== undefined ? { category: { state: "unresolved" as const, label: configuration.category ?? current.identity.category.label } } : {}),
      } });
      if (configuration.name !== undefined) metadata["identity.name"] = { source: "explicit_user" };
      if (configuration.description !== undefined) metadata["identity.description"] = { source: "explicit_user" };
      if (configuration.category !== undefined) metadata["identity.category"] = { source: "explicit_user" };
      if (configuration.name !== undefined) resolvedPaths.add("identity.name");
    }
    if (configuration.measurementMode !== undefined) {
      operations.push({ op: "set_measurement", value: { mode: configuration.measurementMode } });
      metadata["measurement.mode"] = { source: "explicit_user" };
      resolvedPaths.add("measurement.mode");
    }
    if (configuration.workflowIntent !== undefined || configuration.requiresProductionJob !== undefined || configuration.requiresProofApproval !== undefined) {
      operations.push({ op: "set_workflow", value: {
        ...current.workflow,
        ...(configuration.workflowIntent !== undefined ? { kind: configuration.workflowIntent } : {}),
        ...(configuration.requiresProductionJob !== undefined ? { requiresProductionJob: configuration.requiresProductionJob } : {}),
        ...(configuration.requiresProofApproval !== undefined ? { requiresProofApproval: configuration.requiresProofApproval } : {}),
      } });
      if (configuration.workflowIntent !== undefined) metadata["workflow.kind"] = { source: "explicit_user" };
      if (configuration.requiresProductionJob !== undefined) metadata["workflow.requiresProductionJob"] = { source: "explicit_user" };
      if (configuration.requiresProofApproval !== undefined) metadata["workflow.requiresProofApproval"] = { source: "explicit_user" };
    }
  }
  if (proposal.pbv2OptionConfiguration) {
    const applied = applyPbv2OptionConfigurationMutations(draftTree(current), proposal.pbv2OptionConfiguration);
    const nextGroups = groupsFromTree(current, applied.tree);
    operations.push({ op: "replace_option_groups", value: nextGroups });
    const before = new Map(current.optionGroups.map((group) => [group.key, group]));
    for (const group of nextGroups) {
      const prior = before.get(group.key);
      if (!prior) { metadata[`optionGroups.${group.key}`] = { source: "explicit_user" }; continue; }
      if (prior.label !== group.label) metadata[`optionGroups.${group.key}.label`] = { source: "explicit_user" };
      if (JSON.stringify(prior.availableWhen) !== JSON.stringify(group.availableWhen)) metadata[`optionGroups.${group.key}.availableWhen`] = { source: "explicit_user" };
      if (JSON.stringify(prior.values.map((value) => value.isDefault)) !== JSON.stringify(group.values.map((value) => value.isDefault))) metadata[`optionGroups.${group.key}.default`] = { source: "explicit_user" };
      for (const value of group.values) if (!prior.values.some((candidate) => candidate.key === value.key)) metadata[`optionGroups.${group.key}.${value.key}`] = { source: "explicit_user" };
    }
  }
  let unresolved = current.unresolvedFields.filter((field) => !resolvedPaths.has(field.path));
  if (proposal.unsupportedDetails.some((detail) => detail.code === "grommet_quantity")) {
    const path = "optionGroups.grommets.quantity";
    if (!unresolved.some((field) => field.path === path)) unresolved = [...unresolved, { path, code: "GROMMET_QUANTITY_UNRESOLVED", question: "How should the requested counted grommet quantity be represented?" }];
  }
  for (const detail of proposal.unsupportedDetails) metadata[`${unsupportedMetadataPrefix}${detail.code}`] = { source: "explicit_user" };
  if (JSON.stringify(unresolved) !== JSON.stringify(current.unresolvedFields)) operations.push({ op: "set_unresolved_fields", value: unresolved });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  return operations.length ? { contractVersion: 1, baseRevision, preserveUnchanged: true, operations } : null;
}

export function renderProductIntentCompilerMigrationMarkdown(): string {
  return `# ProductIntentCompiler responsibility migration

> Generated from \`server/services/productIntentCompiler/productIntentCanonicalProposal.ts\`. Item 8 is architecturally complete: the semantic layer interprets and plans; it is not capability or execution authority.

## Final request path

Both first-turn \`complete_intent\` compatibility payloads and multi-turn semantic operations now cross the same pre-persistence boundary:

\`natural language -> canonical Product/PBV2 proposal state -> resolver/canonical validation -> V1 compatibility projection -> final creation projection\`

The persisted \`canonicalProposalState\` is authoritative for migrated Product configuration and PBV2 shape. \`ProductDraftIntent\` remains the revision envelope and compatibility carrier required by the current resolver and final inactive-Product creation workflow.

## Responsibility ownership

| Owner | Final responsibility |
|---|---|
| ProductIntentCompiler / semantic planner | Natural-language interpretation, ambiguity, direct evidence, missing information, unsupported-detail preservation and proposal construction |
| Canonical Product configuration | \`products.update_configuration.v1\` input shape for name, description, category/type, measurement mode, workflow intent, proof and production-job normalization/validation |
| Canonical PBV2 option configuration | \`products.update_option_configuration.v1\` input shape for groups, inputs, choices, required/default state, text/textarea inputs, ordering and supported visibility reference validation |
| Canonical Product intent session | Tenant/actor-bound revisions, continuity, CAS fingerprints, stale-state protection and resolver presentation |
| Authority / lifecycle / execution | Capability truth, AI eligibility, GO, revalidation, idempotency, audit and final persisted execution |

## Semantic operation catalog

| Status | Operations |
|---|---|
| Retained interpretation operations | set_product_name, set_product_description, set_category, set_measurement_mode, set_proof_requirement, add/rename option group, add option value/text input, set default, set availability, record unsupported detail |
| Canonical proposal-backed | Product identity/configuration plus PBV2 groups, inputs, choices, defaults, ordering and simple visibility |
| Compatibility only | set_material, set_pricing_basis, set_scalar_price, set_option_rate/set_matrix_rate, set_option_price_impact, remove option value/group |
| Removed obsolete behavior | Migrated-field branches in the compatibility translator, grommet phrase repair, implicit Yes/No choices, grommet-placement cleanup and provider operation-order requirements |

## ProductDraftIntent classification

- **Canonical proposal-backed compatibility projection:** identity/configuration, workflow, measurement and PBV2 option groups/inputs/choices/defaults/visibility. These are regenerated from \`canonicalProposalState\` on new writes.
- **Pricing compatibility:** scalar price, basis, matrices/rates, quantity tiers and option percentage impacts.
- **Material compatibility:** material interpretation and tenant reference resolution.
- **Lifecycle compatibility:** inactive/unpublished draft state, creation transport and final Product/PBV2 projection.
- **Historical compatibility:** V1 JSONB rows without \`canonicalProposalState\` load unchanged and are imported through one explicit V1 adapter on their next write.
- **Removed as capability truth:** independently mutable migrated Product/PBV2 fields and their dormant compatibility-translator handlers.

## Unsupported and missing information

Unsupported detail is stored in canonical proposal state. Customer-specific availability remains non-blocking, while counted grommet detail remains an explicit unresolved question because the underlying model cannot encode it. Required missing information, ambiguity, unresolved tenant references and partial multi-turn drafting remain semantic/resolver responsibilities.

## Remaining Product-domain migration work

Pricing, materials, lifecycle operations, deletion, clone/batch behavior and customer-specific configuration remain outside this closeout. They are compatibility-only candidates for item 9; they were not redesigned here.
`;
}
