import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";
import { buildPbv2DefaultSelections } from "./pbv2OrderEntryRuntime";
import { normalizeSelectionMap, resolveRuntimeVisibility } from "./optionTreeV2Runtime";

export type InboundPbv2RequiredOption = {
  nodeId: string;
  selectionKey: string;
  label: string;
  inputType: string;
};

export type InboundPbv2OptionSuggestion = {
  selectionKey: string;
  nodeId: string;
  label: string;
  value: unknown;
  choiceLabel: string;
  source: "product_default" | "source_evidence" | "customer_history" | "staff_selected";
  confidence: number;
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isPbv2QuestionNode(node: unknown): node is OptionNodeV2 {
  return isRecord(node) && node.kind === "question" && isRecord(node.input);
}

export function getPbv2SelectionKey(node: OptionNodeV2): string {
  return String((node.input as any)?.selectionKey || (node as any).key || node.id);
}

function getInputType(node: OptionNodeV2): string {
  return String((node.input as any)?.type ?? "");
}

function isRenderableQuestion(node: OptionNodeV2): boolean {
  const status = String((node as any).status ?? "ENABLED").toUpperCase();
  const inputType = getInputType(node);
  return status !== "DISABLED"
    && status !== "DELETED"
    && ["select", "radio", "boolean", "checkbox", "number", "text", "textarea", "multiselect"].includes(inputType);
}

function getNodeValue(selections: LineItemOptionSelectionsV2 | null | undefined, node: OptionNodeV2): unknown {
  const selected = selections?.selected ?? {};
  const selectionKey = getPbv2SelectionKey(node);
  return selected[selectionKey]?.value
    ?? selected[(node as any).key]?.value
    ?? selected[node.id]?.value;
}

export function isPbv2RequiredValueMissing(node: OptionNodeV2, selections: LineItemOptionSelectionsV2 | null | undefined): boolean {
  const required = Boolean((node.input as any)?.required);
  if (!required) return false;
  const value = getNodeValue(selections, node);
  const inputType = getInputType(node);

  if (inputType === "boolean" || inputType === "checkbox") return value !== true;
  if (inputType === "number") return value === undefined || value === null || !Number.isFinite(Number(value));
  if (inputType === "multiselect") return !Array.isArray(value) || value.length === 0;
  return String(value ?? "").trim().length === 0;
}

export function getInboundPbv2RequiredOptions(
  tree: OptionTreeV2 | null | undefined,
  selections: LineItemOptionSelectionsV2 | null | undefined,
): InboundPbv2RequiredOption[] {
  if (!tree || !isRecord(tree.nodes)) return [];
  const safeSelections: LineItemOptionSelectionsV2 = selections?.schemaVersion === 2
    ? selections
    : { schemaVersion: 2, selected: {} };
  let visibleNodeIds: string[] = [];
  try {
    visibleNodeIds = resolveRuntimeVisibility(tree, safeSelections).visibleNodeIds;
  } catch {
    visibleNodeIds = [];
  }
  if (visibleNodeIds.length === 0) {
    visibleNodeIds = Object.values(tree.nodes)
      .filter((node): node is OptionNodeV2 => isPbv2QuestionNode(node) && isRenderableQuestion(node))
      .map((node) => node.id);
  }

  const rootOrder = new Map((tree.rootNodeIds ?? []).map((nodeId, index) => [nodeId, index]));
  return visibleNodeIds
    .map((nodeId) => tree.nodes[nodeId])
    .filter((node): node is OptionNodeV2 => isPbv2QuestionNode(node) && isRenderableQuestion(node) && Boolean((node.input as any)?.required))
    .sort((a, b) => (rootOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rootOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((node) => ({
      nodeId: node.id,
      selectionKey: getPbv2SelectionKey(node),
      label: String((node as any).label || (node.input as any)?.label || getPbv2SelectionKey(node)),
      inputType: getInputType(node),
    }));
}

export function getMissingInboundPbv2RequiredOptions(
  tree: OptionTreeV2 | null | undefined,
  selections: LineItemOptionSelectionsV2 | null | undefined,
): InboundPbv2RequiredOption[] {
  if (!tree || !isRecord(tree.nodes)) return [];
  const required = getInboundPbv2RequiredOptions(tree, selections);
  return required.filter((option) => {
    const node = tree.nodes[option.nodeId];
    return isPbv2QuestionNode(node) && isPbv2RequiredValueMissing(node, selections);
  });
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function choiceValue(choice: unknown): unknown {
  if (!isRecord(choice)) return null;
  return (choice as any).value ?? (choice as any).id ?? (choice as any).key ?? (choice as any).label ?? null;
}

function choiceLabel(choice: unknown): string {
  if (!isRecord(choice)) return "";
  return String((choice as any).label ?? (choice as any).name ?? (choice as any).value ?? (choice as any).id ?? "");
}

function hasDistinctiveTokenMatch(haystack: string, candidate: string): boolean {
  return candidate
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.includes("/") || /\d/.test(token))
    .some((token) => haystack.includes(token));
}

export function suggestInboundPbv2Options(
  tree: OptionTreeV2 | null | undefined,
  evidenceText: string,
): { selections: LineItemOptionSelectionsV2; suggestions: InboundPbv2OptionSuggestion[] } {
  const selections: LineItemOptionSelectionsV2 = { schemaVersion: 2, selected: {} };
  if (!tree || !isRecord(tree.nodes)) return { selections, suggestions: [] };

  const haystack = normalizeForMatch(evidenceText);
  if (!haystack) return { selections, suggestions: [] };

  const suggestions: InboundPbv2OptionSuggestion[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (!isPbv2QuestionNode(node) || !isRenderableQuestion(node)) continue;
    const inputType = getInputType(node);
    if (inputType !== "select" && inputType !== "radio") continue;
    const choices = Array.isArray((node as any).choices) ? (node as any).choices : [];
    const selectionKey = getPbv2SelectionKey(node);
    for (const choice of choices) {
      const label = choiceLabel(choice);
      const normalizedLabel = normalizeForMatch(label);
      const normalizedValue = normalizeForMatch(choiceValue(choice));
      if (!normalizedLabel && !normalizedValue) continue;
      const matched = (normalizedLabel && haystack.includes(normalizedLabel))
        || (normalizedValue && haystack.includes(normalizedValue))
        || (normalizedLabel && hasDistinctiveTokenMatch(haystack, normalizedLabel))
        || (normalizedValue && hasDistinctiveTokenMatch(haystack, normalizedValue));
      if (!matched) continue;
      const value = choiceValue(choice);
      selections.selected[selectionKey] = { value, note: "Suggested from inbound source evidence." };
      suggestions.push({
        selectionKey,
        nodeId: node.id,
        label: String((node as any).label || (node.input as any)?.label || selectionKey),
        value,
        choiceLabel: label,
        source: "source_evidence",
        confidence: 80,
        reason: `Matched "${label}" in source evidence.`,
      });
      break;
    }
  }

  return {
    selections: {
      ...selections,
      selected: Object.fromEntries(
        Object.entries(normalizeSelectionMap(selections)).map(([key, value]) => [key, { value }]),
      ),
    },
    suggestions,
  };
}

function getNodeLabel(node: OptionNodeV2, selectionKey: string): string {
  return String((node as any).label || (node.input as any)?.label || selectionKey);
}

function getChoiceLabelForValue(node: OptionNodeV2, value: unknown): string {
  const choices = Array.isArray((node as any).choices) ? (node as any).choices : [];
  for (const choice of choices) {
    if (String(choiceValue(choice)) === String(value)) return choiceLabel(choice);
  }
  return String(value ?? "");
}

export function hydrateInboundPbv2Selections(
  tree: OptionTreeV2 | null | undefined,
  evidenceText: string,
): { selections: LineItemOptionSelectionsV2; suggestions: InboundPbv2OptionSuggestion[] } {
  const defaultSelections = buildPbv2DefaultSelections(tree) ?? { schemaVersion: 2, selected: {} };
  const defaultSuggestions: InboundPbv2OptionSuggestion[] = [];

  if (tree && isRecord(tree.nodes)) {
    for (const node of Object.values(tree.nodes)) {
      if (!isPbv2QuestionNode(node) || !isRenderableQuestion(node)) continue;
      const selectionKey = getPbv2SelectionKey(node);
      const entry = defaultSelections.selected[selectionKey];
      if (!entry || entry.value === undefined || entry.value === null || String(entry.value).trim() === "") continue;
      entry.note = "Default";
      defaultSuggestions.push({
        selectionKey,
        nodeId: node.id,
        label: getNodeLabel(node, selectionKey),
        value: entry.value,
        choiceLabel: getChoiceLabelForValue(node, entry.value),
        source: "product_default",
        confidence: 60,
        reason: "Applied product default.",
      });
    }
  }

  const evidence = suggestInboundPbv2Options(tree, evidenceText);
  const selected = {
    ...defaultSelections.selected,
    ...Object.fromEntries(
      Object.entries(evidence.selections.selected).map(([key, entry]) => [
        key,
        { ...entry, note: "Suggested from PO" },
      ]),
    ),
  };
  const evidenceKeys = new Set(Object.keys(evidence.selections.selected));

  return {
    selections: { schemaVersion: 2, selected },
    suggestions: [
      ...defaultSuggestions.filter((suggestion) => !evidenceKeys.has(suggestion.selectionKey)),
      ...evidence.suggestions,
    ],
  };
}
