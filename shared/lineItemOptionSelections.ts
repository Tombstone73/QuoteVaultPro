import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";

export type PersistedLineItemSelectionEntry = Record<string, unknown> & { value: unknown };

export type ResolvedSavedLineItemOption = {
  optionKey: string;
  optionId: string;
  optionLabel: string;
  savedValue: unknown;
  selectedOptionId: string | null;
  dropdownValue: unknown;
  selectedLabel: string;
  isDefault: boolean;
  source: "saved" | "product_default";
};

type SelectionCandidate = {
  key: string;
  entry: PersistedLineItemSelectionEntry;
  optionLabel?: string;
  choiceLabel?: string;
};

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function normalizeEntry(value: unknown): PersistedLineItemSelectionEntry {
  const record = asRecord(value);
  return record && Object.prototype.hasOwnProperty.call(record, "value")
    ? record as PersistedLineItemSelectionEntry
    : { value };
}

function selectionMapFromContainer(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const selected = asRecord(record.selected);
  if (selected) return selected;
  const selections = asRecord(record.selections);
  if (selections) return asRecord(selections.selected) ?? selections;
  if (Object.prototype.hasOwnProperty.call(record, "schemaVersion")) return null;
  return record;
}

function selectedOptionKey(option: any): string | null {
  const key = option?.selectionKey ?? option?.optionId ?? option?.key ?? option?.id;
  return key === undefined || key === null || String(key).trim() === "" ? null : String(key);
}

function comparable(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanize(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function treeNodes(tree: unknown): OptionNodeV2[] {
  const record = asRecord(tree);
  const nodes = record?.nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean) as OptionNodeV2[];
  return Object.values(asRecord(nodes) ?? {}).filter(Boolean) as OptionNodeV2[];
}

function nodeAliases(node: any): string[] {
  return [node?.input?.selectionKey, node?.selectionKey, node?.key, node?.optionId, node?.id]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function selectionKey(node: any): string {
  return String(node?.input?.selectionKey ?? node?.key ?? node?.id);
}

function findNodeForCandidate(nodes: OptionNodeV2[], candidate: SelectionCandidate): OptionNodeV2 | null {
  const direct = nodes.find((node) => nodeAliases(node).includes(candidate.key));
  if (direct) return direct;
  const normalizedKey = comparable(candidate.key);
  const normalized = nodes.find((node) => nodeAliases(node).some((alias) => comparable(alias) === normalizedKey));
  if (normalized) return normalized;
  if (!candidate.optionLabel) return null;
  const normalizedLabel = comparable(candidate.optionLabel);
  return nodes.find((node) => comparable(node.label) === normalizedLabel) ?? null;
}

function choiceAliases(choice: any): unknown[] {
  return [
    choice?.value,
    choice?.id,
    choice?.choiceId,
    choice?.key,
    choice?.slug,
    choice?.internalValue,
    choice?.label,
    choice?.name,
    choice?.displayLabel,
  ];
}

function unwrapSavedChoiceValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.choiceValue ?? record.selectedValue ?? record.choiceId ?? record.id ?? record.key ?? record.slug ?? record.value ?? value;
}

function findChoiceForSavedValue(node: OptionNodeV2, value: unknown, choiceLabel?: string): any | null {
  const choices = Array.isArray(node.choices) ? node.choices : [];
  const unwrapped = unwrapSavedChoiceValue(value);
  const exact = choices.find((choice: any) => choiceAliases(choice)
    .some((alias) => alias !== undefined && String(alias) === String(unwrapped)));
  if (exact) return exact;
  const desired = comparable(choiceLabel ?? unwrapped);
  return choices.find((choice: any) => choiceAliases(choice).some((alias) => comparable(alias) === desired)) ?? null;
}

function normalizeValueForNode(node: OptionNodeV2, candidate: SelectionCandidate): unknown {
  if (Array.isArray(candidate.entry.value)) {
    return candidate.entry.value.map((value) => normalizeValueForNode(node, {
      ...candidate,
      entry: { ...candidate.entry, value },
    }));
  }

  const matched = findChoiceForSavedValue(node, candidate.entry.value, candidate.choiceLabel);
  return matched?.value ?? unwrapSavedChoiceValue(candidate.entry.value);
}

function choiceLabelForNodeValue(node: OptionNodeV2 | null, value: unknown): string | undefined {
  if (!node || !Array.isArray(node.choices)) return undefined;
  const wanted = comparable(value);
  const choice = node.choices.find((candidate: any) => choiceAliases(candidate)
    .some((alias) => comparable(alias) === wanted));
  const label = (choice as any)?.label ?? (choice as any)?.name;
  return typeof label === "string" && label.trim() ? label : undefined;
}

function collectSelectionCandidates(lineItem: any): SelectionCandidate[] {
  const specs = asRecord(lineItem?.specsJson) ?? {};
  const snapshot = asRecord(lineItem?.pbv2SnapshotJson) ?? {};
  const pricingSnapshot = asRecord(snapshot.pbv2PricingSnapshot) ?? {};
  const runtimeContext = asRecord(snapshot.runtimeSelectionContext) ?? {};
  const candidates: SelectionCandidate[] = [];

  const appendMap = (container: unknown) => {
    const map = selectionMapFromContainer(container);
    if (!map) return;
    for (const [key, value] of Object.entries(map)) {
      if (key === "schemaVersion") continue;
      candidates.push({ key, entry: normalizeEntry(value) });
    }
  };

  // Explicit persisted selections are primary. Server-evaluated pricing
  // selections follow and fill individual options that are absent or whose
  // historic key can no longer be mapped directly to the active tree.
  appendMap(lineItem?.optionSelectionsJson);
  appendMap(snapshot.selections);
  appendMap(pricingSnapshot.rawSelections);
  appendMap(pricingSnapshot.effectiveSelections);
  appendMap(pricingSnapshot.selectedOptionValues);

  for (const candidate of [lineItem?.selectedOptions, specs.selectedOptions, snapshot.selectedOptions]) {
    if (!Array.isArray(candidate)) continue;
    for (const option of candidate) {
      const key = selectedOptionKey(option);
      if (!key || option?.value === undefined) continue;
      const selectedLabel = typeof option.selectedLabel === "string"
        ? option.selectedLabel
        : typeof option.displayValue === "string"
          ? option.displayValue
          : undefined;
      candidates.push({
        key,
        entry: {
          ...normalizeEntry(option.value),
          ...(selectedLabel ? { label: selectedLabel } : {}),
        },
        optionLabel: typeof option.optionName === "string"
          ? option.optionName
          : typeof option.label === "string"
            ? option.label
            : undefined,
        choiceLabel: selectedLabel,
      });
    }
  }

  const resolvedChoices = asRecord(runtimeContext.resolvedChoices) ?? {};
  for (const [key, resolved] of Object.entries(resolvedChoices)) {
    const record = asRecord(resolved);
    if (!record || record.choiceValue === undefined) continue;
    candidates.push({
      key,
      entry: normalizeEntry(record.choiceValue),
      optionLabel: typeof record.optionLabel === "string" ? record.optionLabel : undefined,
      choiceLabel: typeof record.choiceLabel === "string" ? record.choiceLabel : undefined,
    });
  }

  return candidates;
}

/**
 * Resolves saved order-line selections without consulting product defaults.
 * Higher-priority sources fill first; later persisted/evaluated sources only
 * fill missing keys.
 */
export function resolvePersistedLineItemSelectionEntries(lineItem: any): Record<string, PersistedLineItemSelectionEntry> {
  const selected: Record<string, PersistedLineItemSelectionEntry> = {};
  for (const candidate of collectSelectionCandidates(lineItem)) {
    if (selected[candidate.key] !== undefined) continue;
    selected[candidate.key] = candidate.entry;
  }
  return selected;
}

/**
 * Resolves every saved option into the exact value expected by the PBV2
 * control and the human-readable label used by summaries and production.
 */
export function resolveSavedLineItemOptions(
  lineItem: any,
  tree: OptionTreeV2 | null | undefined,
  options: { includeDefaults?: boolean } = {},
): ResolvedSavedLineItemOption[] {
  if (!tree) {
    const candidates = collectSelectionCandidates(lineItem);
    const seen = new Set<string>();
    return candidates.flatMap((candidate) => {
      if (seen.has(candidate.key)) return [];
      seen.add(candidate.key);
      const enrichment = candidates.find((other) => (
        other.key === candidate.key && (other.optionLabel || other.choiceLabel || typeof other.entry.label === "string")
      ));
      const dropdownValue = unwrapSavedChoiceValue(candidate.entry.value);
      return [{
        optionKey: candidate.key,
        optionId: candidate.key,
        optionLabel: enrichment?.optionLabel ?? candidate.optionLabel ?? humanize(candidate.key),
        savedValue: candidate.entry.value,
        selectedOptionId: null,
        dropdownValue,
        selectedLabel: enrichment?.choiceLabel
          ?? (typeof enrichment?.entry.label === "string" ? enrichment.entry.label : undefined)
          ?? (typeof candidate.entry.label === "string" ? candidate.entry.label : humanize(dropdownValue)),
        isDefault: false,
        source: "saved" as const,
      }];
    });
  }

  const targetNodes = treeNodes(tree).filter((node) => (
    node.input && node.kind !== "group" && node.kind !== "computed"
  ));
  const sourceNodes = treeNodes(asRecord(lineItem?.pbv2SnapshotJson)?.treeJson);
  const candidates = collectSelectionCandidates(lineItem);
  const usedCandidates = new Set<number>();
  const resolved: ResolvedSavedLineItemOption[] = [];

  for (const targetNode of targetNodes) {
    const targetAliases = new Set(nodeAliases(targetNode));
    const targetLabel = comparable(targetNode.label);
    let matchedIndex = candidates.findIndex((candidate, index) => {
      if (usedCandidates.has(index)) return false;
      return targetAliases.has(candidate.key);
    });

    if (matchedIndex < 0) {
      matchedIndex = candidates.findIndex((candidate, index) => {
        if (usedCandidates.has(index)) return false;
        const sourceNode = findNodeForCandidate(sourceNodes, candidate);
        if (sourceNode) {
          const sharedStableAlias = nodeAliases(sourceNode).some((alias) => targetAliases.has(alias));
          if (sharedStableAlias || comparable(sourceNode.label) === targetLabel) return true;
        }
        return candidate.optionLabel ? comparable(candidate.optionLabel) === targetLabel : false;
      });
    }

    const optionKey = selectionKey(targetNode);
    const defaultValue = (targetNode.input as any)?.defaultValue;
    const candidate = matchedIndex >= 0 ? candidates[matchedIndex] : null;
    if (!candidate && (!options.includeDefaults || defaultValue === undefined || defaultValue === null || defaultValue === "")) {
      continue;
    }
    if (matchedIndex >= 0) usedCandidates.add(matchedIndex);

    const sourceNode = candidate ? findNodeForCandidate(sourceNodes, candidate) : null;
    const sourceChoiceLabel = candidate
      ? candidate.choiceLabel ?? choiceLabelForNodeValue(sourceNode, candidate.entry.value)
      : undefined;
    const savedValue = candidate?.entry.value ?? defaultValue;
    const normalizedCandidate: SelectionCandidate = candidate
      ? { ...candidate, choiceLabel: sourceChoiceLabel }
      : { key: optionKey, entry: { value: defaultValue } };
    const dropdownValue = normalizeValueForNode(targetNode, normalizedCandidate);
    const matchedChoice = Array.isArray(dropdownValue)
      ? null
      : findChoiceForSavedValue(targetNode, dropdownValue, sourceChoiceLabel);
    const selectedLabel = Array.isArray(dropdownValue)
      ? dropdownValue.map((value) => {
          const choice = findChoiceForSavedValue(targetNode, value);
          return String(choice?.label ?? choice?.name ?? choice?.displayLabel ?? humanize(value));
        }).join(", ")
      : String(
          matchedChoice?.label
          ?? matchedChoice?.name
          ?? matchedChoice?.displayLabel
          ?? sourceChoiceLabel
          ?? (candidate && typeof candidate.entry.label === "string" ? candidate.entry.label : "")
          ?? humanize(dropdownValue),
        ) || humanize(dropdownValue);
    const normalizedDefault = defaultValue === undefined
      ? undefined
      : normalizeValueForNode(targetNode, { key: optionKey, entry: { value: defaultValue } });

    resolved.push({
      optionKey,
      optionId: String(targetNode.id ?? optionKey),
      optionLabel: String(targetNode.label ?? humanize(optionKey)),
      savedValue,
      selectedOptionId: matchedChoice
        ? String(matchedChoice.id ?? matchedChoice.choiceId ?? matchedChoice.key ?? matchedChoice.value)
        : null,
      dropdownValue,
      selectedLabel,
      isDefault: normalizedDefault !== undefined && comparable(normalizedDefault) === comparable(dropdownValue),
      source: candidate ? "saved" : "product_default",
    });
  }

  return resolved;
}

export function buildLineItemOptionSummaryChips(
  lineItem: any,
  tree: OptionTreeV2 | null | undefined,
  maxChips = 3,
): { chips: string[]; overflowCount: number; options: ResolvedSavedLineItemOption[] } {
  const options = resolveSavedLineItemOptions(lineItem, tree, { includeDefaults: false });
  const labels = options
    .map((option) => {
      const label = option.selectedLabel.trim();
      if (!label) return "";
      return /^(yes|no|true|false)$/i.test(label)
        ? `${option.optionLabel}: ${label}`
        : label;
    })
    .filter(Boolean);
  return {
    chips: labels.slice(0, maxChips),
    overflowCount: Math.max(0, labels.length - maxChips),
    options,
  };
}

/**
 * Resolves a saved order line against the tree currently rendering controls.
 * Stable keys/IDs win, while normalized labels are only a compatibility path
 * for historic tree versions. Defaults are applied per option, never as an
 * all-or-nothing replacement for the saved map.
 */
export function resolveSavedLineItemOptionSelections(
  lineItem: any,
  tree: OptionTreeV2 | null | undefined,
  options: { includeDefaults?: boolean } = {},
): LineItemOptionSelectionsV2 {
  if (!tree) {
    return {
      schemaVersion: 2,
      selected: resolvePersistedLineItemSelectionEntries(lineItem) as LineItemOptionSelectionsV2["selected"],
    };
  }

  const selected: LineItemOptionSelectionsV2["selected"] = {};
  for (const option of resolveSavedLineItemOptions(lineItem, tree, options)) {
    selected[option.optionKey] = {
      value: option.dropdownValue,
      label: option.selectedLabel,
      optionId: option.optionId,
      selectedOptionId: option.selectedOptionId,
      origin: option.source,
    } as any;
  }

  return { schemaVersion: 2, selected };
}
