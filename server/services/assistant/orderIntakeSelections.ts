import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { buildPbv2DefaultSelections, filterPbv2ChoicesForRuntime, sortPbv2NodeIdsByBuilderOrder } from "@shared/pbv2OrderEntryRuntime";
import { getPbv2SelectionKey, isPbv2QuestionNode } from "@shared/inboundOrderPbv2Options";
import { resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";

export type AssistantOrderOptionChoice = { value: string; label: string; isDefault: boolean };
export type AssistantOrderOptionGroup = { nodeId: string; selectionKey: string; label: string; choices: AssistantOrderOptionChoice[] };
/** The assistant records why a visible customer choice may be sent to PBV2. */
export type AssistantOrderSelectionSource = "explicit" | "default_accepted";
export type AssistantOrderSelectionResult =
  | { ok: true; selections: LineItemOptionSelectionsV2; groups: AssistantOrderOptionGroup[]; resolvedSelectionKeys: string[] }
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
  const singularize = (value: string) => value.replace(/\b([a-rt-z0-9]+)s\b/g, "$1");
  const normalizedPhrase = singularize(normalize(phrase));
  if (!normalizedPhrase) return false;
  const normalizedMessage = singularize(normalize(message));
  return new RegExp(`(?:^|\\s)${normalizedPhrase.split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}(?=$|\\s)`).test(normalizedMessage);
};

const booleanChoice = (choice: AssistantOrderOptionChoice) => {
  const value = normalize(choice.value);
  const label = normalize(choice.label);
  return value === "no" || label === "no" ? "no" : value === "yes" || label === "yes" ? "yes" : null;
};

function groupPhrases(group: AssistantOrderOptionGroup) {
  const base = [group.label, group.selectionKey]
    .map(normalize)
    .filter(Boolean)
    .flatMap((value) => [value, value.replace(/\b(?:cutting|option|options)\b/g, "").replace(/\s+/g, " ").trim()])
    .flatMap((value) => [value, value.replace(/\b([a-rt-z0-9]+)s\b/g, "$1")]);
  return Array.from(new Set(base.filter(Boolean)));
}

function matchesCanonicalChoice(message: string, group: AssistantOrderOptionGroup, choice: AssistantOrderOptionChoice) {
  const boolean = booleanChoice(choice);
  const directPhrases = [choice.label, choice.value];
  if (!boolean && directPhrases.some((phrase) => hasPhrase(message, phrase))) return true;
  if (!boolean) {
    const aliases = directPhrases.flatMap((phrase) => {
      const normalized = normalize(phrase);
      return [
        normalized.replace(/\bsingle\b/g, "one").replace(/\bsided\b/g, "side"),
        normalized.replace(/\bsided\b/g, "side"),
      ];
    });
    return aliases.some((alias) => alias && hasPhrase(message, alias));
  }
  return groupPhrases(group).some((groupPhrase) => boolean === "no"
    ? hasPhrase(message, `no ${groupPhrase}`) || hasPhrase(message, `${groupPhrase} no`) || hasPhrase(message, `without ${groupPhrase}`) || hasPhrase(message, `${groupPhrase} off`)
    : hasPhrase(message, `yes ${groupPhrase}`) || hasPhrase(message, `${groupPhrase} yes`) || hasPhrase(message, `with ${groupPhrase}`) || hasPhrase(message, `${groupPhrase} on`));
}

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

/**
 * PBV2 defaults are useful to evaluate visibility and pricing, but a visible
 * customer choice must have an explicit origin before assistant order intake
 * may use it. Hidden/system nodes are deliberately absent from these groups.
 */
export function unresolvedAssistantOrderOptionGroups(input: {
  tree: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  selectionSources?: Readonly<Record<string, AssistantOrderSelectionSource>>;
}) {
  return orderIntakeOptionGroups(input.tree, input.selections)
    .filter((group) => input.selectionSources?.[group.selectionKey] !== "explicit" && input.selectionSources?.[group.selectionKey] !== "default_accepted");
}

/** Accept only the currently visible choices that actually have a configured default. */
export function acceptAssistantOrderDefaults(input: {
  tree: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  selectionSources?: Readonly<Record<string, AssistantOrderSelectionSource>>;
}) {
  const selected = { ...input.selections.selected };
  const selectionSources: Record<string, AssistantOrderSelectionSource> = { ...(input.selectionSources ?? {}) };
  const acceptedSelectionKeys: string[] = [];
  for (const group of unresolvedAssistantOrderOptionGroups(input)) {
    const defaultChoice = group.choices.find((choice) => choice.isDefault);
    if (!defaultChoice) continue;
    selected[group.selectionKey] = { value: defaultChoice.value };
    selectionSources[group.selectionKey] = "default_accepted";
    acceptedSelectionKeys.push(group.selectionKey);
  }
  return { selections: { schemaVersion: 2 as const, selected }, selectionSources, acceptedSelectionKeys };
}

/** A deliberate instruction is required; a bare mention of a default is never acceptance. */
export function acceptsAssistantOrderDefaults(message: string) {
  const value = normalize(message);
  return /\b(?:use|keep)\s+(?:all\s+)?(?:the\s+)?(?:remaining\s+)?defaults?\b/.test(value)
    || /\buse\s+(?:the\s+)?defaults?(?:\s+selections?)?\s+(?:for\s+)?(?:all\s+)?(?:remaining\s+)?options?\b/.test(value)
    || /\bdefaults?\s+(?:for\s+)?(?:the\s+)?(?:rest|everything\s+else)\b/.test(value)
    || /\bdefault\s+options?\s+(?:are\s+)?fine\b/.test(value);
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
  const namedGroups = new Set(groups.filter((group) => hasPhrase(message, group.label) || hasPhrase(message, group.selectionKey)));

  for (const group of groups) {
    const matches = group.choices.filter((choice) => matchesCanonicalChoice(message, group, choice));
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
  // A named group owns a shared value such as "No". Do not let that value
  // silently select every other visible yes/no group in the same reply.
  const choicesOwnedByNamedGroups = new Set(
    Array.from(namedGroups).flatMap((group) => matchesByGroup.get(group)?.map((choice) => `${choice.value}\u0000${choice.label}`) ?? []),
  );
  for (const group of groups) {
    if (namedGroups.has(group)) continue;
    const match = matchesByGroup.get(group)?.[0];
    if (match && choicesOwnedByNamedGroups.has(`${match.value}\u0000${match.label}`)) matchesByGroup.delete(group);
  }
  const unmatchedGroupNames = groups.filter((group) => !hasPhrase(message, group.label) && !hasPhrase(message, group.selectionKey));
  for (const group of Array.from(matchesByGroup.keys())) {
    const choice = matchesByGroup.get(group)![0];
    const sameChoiceElsewhere = unmatchedGroupNames.filter((other) => other !== group && other.choices.some((candidate) => candidate.value === choice.value || candidate.label === choice.label));
    if (!namedGroups.has(group) && sameChoiceElsewhere.length > 0) {
      return { ok: false, code: "ORDER_OPTION_AMBIGUOUS", summary: `Please name the option group for ${choice.label}.`, groups };
    }
    selected[group.selectionKey] = { value: choice.value };
  }

  return { ok: true, selections: { schemaVersion: 2, selected }, groups, resolvedSelectionKeys: Array.from(matchesByGroup.keys()).map((group) => group.selectionKey) };
}

export function isAssistantOrderOptionQuestion(message: string) {
  return /\b(?:what|which|show|list)\b[\s\S]{0,40}\b(?:option|options|choice|choices|selection|selections)\b/i.test(message);
}
