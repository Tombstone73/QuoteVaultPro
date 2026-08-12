import { z } from "zod";
import { type ProductDraftIntent, type ProductDraftIntentPatch } from "@shared/productDraftIntent";
import {
  productConfigurationChangesSchema,
  type ProductConfigurationChanges,
} from "../products/canonicalProductConfigurationOperations";
import {
  applyPbv2OptionConfigurationMutations,
  pbv2OptionConfigurationMutationsSchema,
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

  const parsedConfiguration = Object.keys(productConfiguration).length ? productConfigurationChangesSchema.parse(productConfiguration) : undefined;
  const parsedMutations = mutations.length ? pbv2OptionConfigurationMutationsSchema.parse(mutations) : undefined;
  return canonicalProductIntentProposalSchema.parse({
    kind: "canonical_product_intent_proposal",
    ...(parsedConfiguration ? { productConfiguration: parsedConfiguration } : {}),
    ...(parsedMutations ? { pbv2OptionConfiguration: parsedMutations } : {}),
    unsupportedDetails,
    compatibilityOperations,
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
  const configuration = proposal.productConfiguration as ProductConfigurationChanges | undefined;
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
    if (configuration.requiresProofApproval !== undefined) {
      operations.push({ op: "set_workflow", value: { ...current.workflow, requiresProofApproval: configuration.requiresProofApproval } });
      metadata["workflow.requiresProofApproval"] = { source: "explicit_user" };
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
  if (JSON.stringify(unresolved) !== JSON.stringify(current.unresolvedFields)) operations.push({ op: "set_unresolved_fields", value: unresolved });
  if (Object.keys(metadata).length) operations.push({ op: "merge_field_metadata", value: metadata });
  return operations.length ? { contractVersion: 1, baseRevision, preserveUnchanged: true, operations } : null;
}

export function renderProductIntentCompilerMigrationMarkdown(): string {
  return `# ProductIntentCompiler responsibility migration

> Generated from \`server/services/productIntentCompiler/productIntentCanonicalProposal.ts\`. The semantic layer interprets and plans; it is not capability or execution authority.

## Responsibility map

| Class | Responsibility | Phase 7 disposition | Owner |
|---|---|---|---|
| A | Natural-language interpretation, terminology, ambiguity and evidence | keep in semantic layer | ProductIntentCompiler / proposal planner |
| B | Active draft, revisions, multi-turn continuity and trusted references | keep | canonical Product intent session |
| C | Missing required information and non-blocking unresolved detail | keep | resolver plus semantic proposal context |
| D | Product and option proposal construction | compose canonical structures | \`products.update_configuration.v1\` and \`products.update_option_configuration.v1\` schemas |
| E | Product field validity and service-fee invariants | move to canonical Product operation; legacy initial projection temporarily retained | canonical Product service |
| F | PBV2 references, defaults, selection keys and visibility validity | move to canonical PBV2 transformer/validator | canonical PBV2 service |
| G | Tenant, actor, stale state, persistence, lifecycle and GO | never semantic-layer owned | authority, persistence, lifecycle and execution layers |
| H | Pricing, material, deletion and legacy initial complete-intent projection | retain temporarily as compatibility | contained ProductDraftIntent adapter |
| I | Unsupported underlying-model detail | preserve explicitly without poisoning supported work | semantic unresolved context |

## Semantic operation catalog

| Status | Operations |
|---|---|
| Retained interpretation operations | set_product_name, set_product_description, set_category, set_measurement_mode, set_proof_requirement, add/rename option group, add option value/text input, set default, set availability, record unsupported detail |
| Simplified through canonical proposal fragments | Product identity/configuration plus PBV2 groups, inputs, choices, defaults and simple visibility |
| Compatibility only | set_material, pricing basis/rates/impacts/scalar price, remove option value/group, legacy set_matrix_rate |
| Removed obsolete behavior | grommet phrase repair, implicit Yes/No choices, grommet-placement cleanup, provider operation-order requirement |

## Remaining AI-specific Product logic

- Initial provider \`complete_intent\` normalization and legacy ProductDraftIntent projection.
- Pricing interpretation, matrix/rate compatibility, material resolution and delete safety.
- Natural-language name/category evidence, unresolved-question generation and multi-turn revision presentation.
- Final new-product projection remains compatible with the established ProductDraftIntent until later canonical pricing work.
`;
}
