import type { OptionTreeV2 } from "./optionTreeV2";
import {
  normalizeSelectionMap,
  resolveRuntimeVisibility,
  type ResolvedRuntimeVisibility,
} from "./optionTreeV2Runtime";
import {
  evaluateProductOptionRules,
  type ProductOptionRule,
  type ProductOptionRuleEvaluationResult,
} from "./productOptionRules";

/**
 * One ProductVersion-owned configuration resolution shared by Pricing, Draft
 * preview, and Sales.  Native node/choice visibility remains authoritative;
 * full option rules add the V1-compatible dynamic required/default/clear and
 * enablement semantics without duplicating a frontend rule engine.
 */
export type ResolvedProductOptionConfiguration = Readonly<{
  effectiveSelections: Record<string, unknown>;
  visibleNodeIds: readonly string[];
  visibleChoiceIds: readonly string[];
  hiddenSelectionWarnings: ResolvedRuntimeVisibility["hiddenSelectionWarnings"];
  visibleOptionGroups: readonly string[];
  hiddenOptionGroups: readonly string[];
  disabledOptionGroups: readonly string[];
  requiredOptionGroups: readonly string[];
  clearedOptionGroups: readonly string[];
  defaultedOptionGroups: readonly string[];
  messages: ProductOptionRuleEvaluationResult["messages"];
  errors: ProductOptionRuleEvaluationResult["errors"];
  isValidForPricing: boolean;
}>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/** Legacy aliases are read-only compatibility paths. New canonical saves use
 * tree.optionRules exclusively. */
export function readProductOptionRules(tree: unknown): readonly ProductOptionRule[] {
  const source = record(tree);
  const meta = record(source.meta);
  const candidates = [source.optionRules, source.rules, meta.optionRules];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as ProductOptionRule[];
  }
  return [];
}

function selectionKeyForNode(nodeId: string, node: unknown): string {
  const source = record(node);
  const input = record(source.input);
  return typeof input.selectionKey === "string" && input.selectionKey.trim()
    ? input.selectionKey
    : typeof source.key === "string" && source.key.trim()
      ? source.key
      : nodeId;
}

function optionGroupKeys(tree: OptionTreeV2): string[] {
  const nodes = record(tree.nodes);
  return Object.entries(nodes)
    .filter(([, raw]) => record(raw).kind !== "group")
    .map(([nodeId, raw]) => selectionKeyForNode(nodeId, raw));
}

function visibleOptionGroupKeys(tree: OptionTreeV2, nodeIds: readonly string[]): string[] {
  const nodes = record(tree.nodes);
  return nodeIds.flatMap((nodeId) => {
    const node = nodes[nodeId];
    return record(node).kind === "group" || !node ? [] : [selectionKeyForNode(nodeId, node)];
  });
}

function staticRequiredOptionGroupKeys(tree: OptionTreeV2): string[] {
  const nodes = record(tree.nodes);
  return Object.entries(nodes).flatMap(([nodeId, raw]) => {
    const node = record(raw);
    return node.kind === "group" || record(node.input).required !== true
      ? []
      : [selectionKeyForNode(nodeId, node)];
  });
}

function signature(value: unknown): string {
  return JSON.stringify(value);
}

function evaluateRules(
  tree: OptionTreeV2,
  rules: readonly ProductOptionRule[],
  visibility: ResolvedRuntimeVisibility,
): ProductOptionRuleEvaluationResult {
  return evaluateProductOptionRules({
    rules: [...rules],
    selections: visibility.effectiveSelections,
    optionGroups: optionGroupKeys(tree),
    visibleOptionGroups: visibleOptionGroupKeys(tree, visibility.visibleNodeIds),
    requiredOptionGroups: staticRequiredOptionGroupKeys(tree),
  });
}

/**
 * Resolves native visibility and full option rules together until their
 * selections and visible set settle. A bounded loop is defensive only: the
 * publish validator rejects known unstable native visibility cycles and the
 * full-rule validator rejects direct branch conflicts.
 */
export function resolveProductOptionConfiguration(
  tree: OptionTreeV2,
  selections: unknown,
): ResolvedProductOptionConfiguration {
  const rules = readProductOptionRules(tree);
  let effective = normalizeSelectionMap(selections as Record<string, unknown>);
  let last = "";
  const maxPasses = Math.max(Object.keys(record(tree.nodes)).length * 2, 8);

  for (let pass = 0; pass < maxPasses; pass++) {
    const visibility = resolveRuntimeVisibility(tree, effective);
    const ruleEvaluation = evaluateRules(tree, rules, visibility);
    const settledVisibility = resolveRuntimeVisibility(tree, ruleEvaluation.effectiveSelections);
    const settledRules = evaluateRules(tree, rules, settledVisibility);
    const hidden = new Set(settledRules.hiddenOptionGroups);
    const visibleNodeIds = settledVisibility.visibleNodeIds.filter((nodeId) => {
      const node = record(record(tree.nodes)[nodeId]);
      return node.kind === "group" || !hidden.has(selectionKeyForNode(nodeId, node));
    });
    const current = signature({
      selections: settledRules.effectiveSelections,
      visibleNodeIds,
      hidden: settledRules.hiddenOptionGroups,
      disabled: settledRules.disabledOptionGroups,
      required: settledRules.requiredOptionGroups,
    });
    if (current === last || pass === maxPasses - 1) {
      return {
        effectiveSelections: settledRules.effectiveSelections,
        visibleNodeIds,
        visibleChoiceIds: settledVisibility.visibleChoiceIds,
        hiddenSelectionWarnings: settledVisibility.hiddenSelectionWarnings,
        visibleOptionGroups: settledRules.visibleOptionGroups,
        hiddenOptionGroups: settledRules.hiddenOptionGroups,
        disabledOptionGroups: settledRules.disabledOptionGroups,
        requiredOptionGroups: settledRules.requiredOptionGroups,
        clearedOptionGroups: settledRules.clearedOptionGroups,
        defaultedOptionGroups: settledRules.defaultedOptionGroups,
        messages: settledRules.messages,
        errors: settledRules.errors,
        isValidForPricing: settledRules.isValidForPricing,
      };
    }
    last = current;
    effective = settledRules.effectiveSelections;
  }

  throw new Error("Product option configuration did not settle.");
}
