import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";
import { buildPbv2DefaultSelections } from "./pbv2OrderEntryRuntime";
import { normalizeSelectionMap, resolveRuntimeVisibility } from "./optionTreeV2Runtime";

export type InboundOptionOrigin = "DEFAULT" | "AI_INFERRED" | "SOURCE_EVIDENCE" | "USER_SELECTED";

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
  source: "product_default" | "source_evidence" | "deterministic_print_spec_rule" | "customer_history" | "staff_selected";
  origin: InboundOptionOrigin;
  evidence: string | null;
  conflictsWithDefault: boolean;
  defaultChoiceLabel: string | null;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function evidenceSpanForPhrase(sourceText: string, phrase: string): string | null {
  const normalizedPhrase = normalizeForMatch(phrase);
  if (!normalizedPhrase) return null;
  const tokens = normalizedPhrase.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(escapeRegExp).join("[\\s\\-_/]+");
  const match = sourceText.match(new RegExp(`\\b${pattern}\\b`, "i"));
  return match?.[0] ?? null;
}

function choiceEvidencePhrases(choice: unknown): string[] {
  const rawParts = [choiceLabel(choice), String(choiceValue(choice) ?? "")].filter(Boolean);
  return Array.from(new Set(rawParts
    .flatMap((part) => part.split(/[|,()]+/))
    .map((part) => part.trim())
    .filter(Boolean)));
}

function choiceEvidenceMatch(sourceText: string, choice: unknown): string | null {
  const haystack = normalizeForMatch(sourceText);
  if (!haystack) return null;
  for (const phrase of choiceEvidencePhrases(choice)) {
    const normalizedPhrase = normalizeForMatch(phrase);
    if (!normalizedPhrase) continue;
    const tokens = normalizedPhrase.split(/\s+/).filter(Boolean);
    const meaningful = tokens.length >= 2 || tokens.some((token) => token.includes("/") || /\d/.test(token));
    if (!meaningful) continue;
    const matched = haystack.includes(normalizedPhrase) || hasDistinctiveTokenMatch(haystack, normalizedPhrase);
    if (!matched) continue;
    return evidenceSpanForPhrase(sourceText, phrase) ?? phrase;
  }
  return null;
}

function deterministicPrintSideFromEvidence(evidenceText: string): { side: "single" | "double"; evidence: string } | null {
  const single = evidenceText.match(/\b(?:single[\s-]?sided|one[\s-]?sided|1\s*sided|1-sided|4\/0|1\/0)\b/i);
  if (single) return { side: "single", evidence: single[0] };
  const double = evidenceText.match(/\b(?:double[\s-]?sided|two[\s-]?sided|2\s*sided|2-sided|4\/1|4\/4|1\/1)\b/i);
  if (double) return { side: "double", evidence: double[0] };
  return null;
}

function isPrintedSidesNode(node: OptionNodeV2): boolean {
  const selectionKey = normalizeForMatch(getPbv2SelectionKey(node));
  const label = normalizeForMatch(getNodeLabel(node, getPbv2SelectionKey(node)));
  return /\b(sides?|print side|printed sides?)\b/.test(`${selectionKey} ${label}`);
}

function choiceMatchesPrintSide(choice: unknown, side: "single" | "double"): boolean {
  const text = normalizeForMatch(`${choiceLabel(choice)} ${String(choiceValue(choice) ?? "")}`);
  return side === "single"
    ? /\b(single|one|1\s*sided|ss|4\/0|1\/0)\b/.test(text)
    : /\b(double|two|2\s*sided|ds|4\/1|4\/4|1\/1)\b/.test(text);
}

function deterministicPrintSpecSuggestions(
  tree: OptionTreeV2 | null | undefined,
  evidenceText: string,
): { selections: LineItemOptionSelectionsV2; suggestions: InboundPbv2OptionSuggestion[] } {
  const selections: LineItemOptionSelectionsV2 = { schemaVersion: 2, selected: {} };
  const match = deterministicPrintSideFromEvidence(evidenceText);
  if (!match || !tree || !isRecord(tree.nodes)) return { selections, suggestions: [] };

  const suggestions: InboundPbv2OptionSuggestion[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (!isPbv2QuestionNode(node) || !isRenderableQuestion(node) || !isPrintedSidesNode(node)) continue;
    const inputType = getInputType(node);
    if (inputType !== "select" && inputType !== "radio") continue;
    const choice = (Array.isArray((node as any).choices) ? (node as any).choices : [])
      .find((candidate: unknown) => choiceMatchesPrintSide(candidate, match.side));
    if (!choice) continue;

    const selectionKey = getPbv2SelectionKey(node);
    const value = choiceValue(choice);
    selections.selected[selectionKey] = { value, note: "Source evidence", origin: "SOURCE_EVIDENCE", evidence: match.evidence };
    suggestions.push({
      selectionKey,
      nodeId: node.id,
      label: getNodeLabel(node, selectionKey),
      value,
      choiceLabel: choiceLabel(choice),
      source: "deterministic_print_spec_rule",
      origin: "SOURCE_EVIDENCE",
      evidence: match.evidence,
      conflictsWithDefault: false,
      defaultChoiceLabel: null,
      confidence: 100,
      reason: `Mapped "${match.evidence}" to ${match.side === "single" ? "Single Sided" : "Double Sided"}.`,
    });
  }

  return { selections, suggestions };
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
      const evidence = choiceEvidenceMatch(evidenceText, choice);
      if (!evidence) continue;
      const value = choiceValue(choice);
      selections.selected[selectionKey] = { value, note: "Source evidence", origin: "SOURCE_EVIDENCE", evidence };
      suggestions.push({
        selectionKey,
        nodeId: node.id,
        label: String((node as any).label || (node.input as any)?.label || selectionKey),
        value,
        choiceLabel: label,
        source: "source_evidence",
        origin: "SOURCE_EVIDENCE",
        evidence,
        conflictsWithDefault: false,
        defaultChoiceLabel: null,
        confidence: 80,
        reason: `Matched "${evidence}" in source evidence.`,
      });
      break;
    }
  }

  return {
    selections: {
      ...selections,
      selected: Object.fromEntries(
        Object.entries(normalizeSelectionMap(selections)).map(([key, value]) => {
          const entry = selections.selected[key];
          return [key, { value, note: entry?.note, origin: entry?.origin, evidence: entry?.evidence ?? null }];
        }),
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
      entry.origin = "DEFAULT";
      entry.evidence = null;
      defaultSuggestions.push({
        selectionKey,
        nodeId: node.id,
        label: getNodeLabel(node, selectionKey),
        value: entry.value,
        choiceLabel: getChoiceLabelForValue(node, entry.value),
        source: "product_default",
        origin: "DEFAULT",
        evidence: null,
        conflictsWithDefault: false,
        defaultChoiceLabel: null,
        confidence: 100,
        reason: "Applied product default.",
      });
    }
  }

  const evidence = suggestInboundPbv2Options(tree, evidenceText);
  const deterministic = deterministicPrintSpecSuggestions(tree, evidenceText);
  const defaultChoiceLabels = new Map(defaultSuggestions.map((suggestion) => [suggestion.selectionKey, suggestion.choiceLabel]));
  const selected = {
    ...defaultSelections.selected,
    ...Object.fromEntries(
      Object.entries(evidence.selections.selected).map(([key, entry]) => [
        key,
        { ...entry, note: "Source evidence" },
      ]),
    ),
    ...deterministic.selections.selected,
  };
  const evidenceKeys = new Set(Object.keys(evidence.selections.selected));
  const deterministicKeys = new Set(Object.keys(deterministic.selections.selected));
  const evidenceSuggestions = evidence.suggestions.map((suggestion) => ({
    ...suggestion,
    conflictsWithDefault: defaultChoiceLabels.has(suggestion.selectionKey)
      && defaultChoiceLabels.get(suggestion.selectionKey) !== suggestion.choiceLabel,
    defaultChoiceLabel: defaultChoiceLabels.get(suggestion.selectionKey) ?? null,
  }));
  const deterministicSuggestions = deterministic.suggestions.map((suggestion) => ({
    ...suggestion,
    conflictsWithDefault: defaultChoiceLabels.has(suggestion.selectionKey)
      && defaultChoiceLabels.get(suggestion.selectionKey) !== suggestion.choiceLabel,
    defaultChoiceLabel: defaultChoiceLabels.get(suggestion.selectionKey) ?? null,
  }));

  return {
    selections: { schemaVersion: 2, selected },
    suggestions: [
      ...defaultSuggestions.filter((suggestion) => !evidenceKeys.has(suggestion.selectionKey) && !deterministicKeys.has(suggestion.selectionKey)),
      ...evidenceSuggestions.filter((suggestion) => !deterministicKeys.has(suggestion.selectionKey)),
      ...deterministicSuggestions,
    ],
  };
}
