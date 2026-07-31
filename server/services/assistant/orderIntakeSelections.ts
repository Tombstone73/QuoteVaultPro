import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { buildPbv2DefaultSelections, filterPbv2ChoicesForRuntime, sortPbv2NodeIdsByBuilderOrder } from "@shared/pbv2OrderEntryRuntime";
import { getPbv2SelectionKey, isPbv2QuestionNode } from "@shared/inboundOrderPbv2Options";
import { resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";

export type AssistantOrderOptionChoice = { value: string; label: string; isDefault: boolean };
export type AssistantOrderOptionGroup = { nodeId: string; selectionKey: string; label: string; choices: AssistantOrderOptionChoice[] };
export type AssistantOrderSelectionResult =
  | { ok: true; selections: LineItemOptionSelectionsV2; groups: AssistantOrderOptionGroup[] }
  | { ok: false; code: "ORDER_OPTION_AMBIGUOUS" | "ORDER_OPTION_CONTRADICTORY" | "ORDER_OPTION_INVALID"; summary: string; groups: AssistantOrderOptionGroup[] };

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/(\d)([a-z])/g, "$1 $2")
  .replace(/([a-z])(\d)/g, "$1 $2")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const hasPhrase = (message: string, phrase: string) => {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  return new RegExp(`(?:^|\\s)${normalizedPhrase.split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}(?=$|\\s)`).test(normalize(message));
};

const selectedValues = (selections: LineItemOptionSelectionsV2 | null | undefined) => Object.fromEntries(
  Object.entries(selections?.selected ?? {}).map(([key, entry]) => [key, entry?.value])
);

function displayLabel(node: OptionNodeV2) {
  return String(node.label || (node.input as any)?.label || getPbv2SelectionKey(node));
}

function visibleGroups(tree: OptionTreeV2, selections: LineItemOptionSelectionsV2, requiredSelectionKeys?: readonly string[]): AssistantOrderOptionGroup[] {
  const required = requiredSelectionKeys?.length ? new Set(requiredSelectionKeys) : null;
  let visibility;
  try {
    visibility = resolveRuntimeVisibility(tree, selections);
  } catch {
    return [];
  }
  const visible = new Set(visibility.visibleNodeIds);
  const defaults = selectedValues(buildPbv2DefaultSelections(tree));
  return sortPbv2NodeIdsByBuilderOrder(tree, Object.keys(tree.nodes))
    .map((nodeId) => tree.nodes[nodeId])
    .filter((node): node is OptionNodeV2 => Boolean(node) && isPbv2QuestionNode(node) && visible.has(node.id))
    .filter((node) => ["select", "radio"].includes(String(node.input?.type ?? "").toLowerCase()))
    .filter((node) => !required || required.has(getPbv2SelectionKey(node)) || required.has(node.id) || required.has(displayLabel(node)))
    .map((node) => {
      const selectionKey = getPbv2SelectionKey(node);
      return {
        nodeId: node.id,
        selectionKey,
        label: displayLabel(node),
        choices: filterPbv2ChoicesForRuntime(node.id, node.choices, visibility!.visibleChoiceIds)
          .map((choice) => ({ value: String(choice.value), label: String(choice.label || choice.value), isDefault: String(defaults[selectionKey]) === String(choice.value) })),
      };
    })
    .filter((group) => group.choices.length > 0);
}

export function orderIntakeOptionGroups(tree: OptionTreeV2, selections: LineItemOptionSelectionsV2, requiredSelectionKeys?: readonly string[]) {
  return visibleGroups(tree, selections, requiredSelectionKeys);
}

export function canonicalDefaultOrderSelections(tree: OptionTreeV2): LineItemOptionSelectionsV2 {
  return buildPbv2DefaultSelections(tree) ?? { schemaVersion: 2, selected: {} };
}

/** Resolve only exact, visible canonical choice labels/values. This never guesses a first choice. */
export function resolveAssistantOrderSelections(input: {
  tree: OptionTreeV2;
  existingSelections: LineItemOptionSelectionsV2;
  message: string;
  requiredSelectionKeys?: readonly string[];
}): AssistantOrderSelectionResult {
  const groups = visibleGroups(input.tree, input.existingSelections, input.requiredSelectionKeys);
  const message = normalize(input.message);
  const selected = { ...input.existingSelections.selected };
  const matchesByGroup = new Map<AssistantOrderOptionGroup, AssistantOrderOptionChoice[]>();

  for (const group of groups) {
    const matches = group.choices.filter((choice) => hasPhrase(message, choice.label) || hasPhrase(message, choice.value));
    if (matches.length > 1) {
      return { ok: false, code: "ORDER_OPTION_CONTRADICTORY", summary: `Choose one ${group.label} value from the listed options.`, groups };
    }
    if (matches.length === 1) matchesByGroup.set(group, matches);
  }

  const matchedGroups = Array.from(matchesByGroup.keys());
  for (const group of groups) {
    const named = hasPhrase(message, group.label) || hasPhrase(message, group.selectionKey);
    if (named && !matchesByGroup.has(group)) {
      return { ok: false, code: "ORDER_OPTION_INVALID", summary: `${group.label} must use one of the listed canonical values.`, groups };
    }
  }
  const unmatchedGroupNames = groups.filter((group) => !hasPhrase(message, group.label) && !hasPhrase(message, group.selectionKey));
  for (const group of matchedGroups) {
    const choice = matchesByGroup.get(group)![0];
    const sameChoiceElsewhere = unmatchedGroupNames.filter((other) => other.choices.some((candidate) => candidate.value === choice.value || candidate.label === choice.label));
    if (sameChoiceElsewhere.length > 0) {
      return { ok: false, code: "ORDER_OPTION_AMBIGUOUS", summary: `Please name the option group for ${choice.label}.`, groups };
    }
    selected[group.selectionKey] = { value: choice.value };
  }

  return { ok: true, selections: { schemaVersion: 2, selected }, groups };
}

export function isAssistantOrderOptionQuestion(message: string) {
  return /\b(?:what|which|show|list)\b[\s\S]{0,40}\b(?:option|options|choice|choices|selection|selections)\b/i.test(message);
}
