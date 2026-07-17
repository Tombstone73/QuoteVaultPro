export type PersistedLineItemSelectionEntry = Record<string, unknown> & { value: unknown };

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
  if (selections) {
    return asRecord(selections.selected) ?? selections;
  }
  if (Object.prototype.hasOwnProperty.call(record, "schemaVersion")) return null;
  return record;
}

function selectedOptionKey(option: any): string | null {
  const key = option?.selectionKey ?? option?.optionId ?? option?.key ?? option?.id;
  return key === undefined || key === null || String(key).trim() === "" ? null : String(key);
}

/**
 * Resolves saved order-line selections in canonical priority order.
 *
 * Current line-item selections win. Pricing snapshots and evaluated option
 * arrays only fill missing keys; they never replace a current saved value.
 * Product defaults deliberately do not participate in this resolver.
 */
export function resolvePersistedLineItemSelectionEntries(lineItem: any): Record<string, PersistedLineItemSelectionEntry> {
  const specs = asRecord(lineItem?.specsJson) ?? {};
  const snapshot = asRecord(lineItem?.pbv2SnapshotJson) ?? {};
  const selected: Record<string, PersistedLineItemSelectionEntry> = {};

  for (const map of [
    selectionMapFromContainer(lineItem?.optionSelectionsJson),
    selectionMapFromContainer(snapshot.selections),
  ]) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (key === "schemaVersion" || selected[key] !== undefined) continue;
      selected[key] = normalizeEntry(value);
    }
  }

  for (const candidate of [lineItem?.selectedOptions, specs.selectedOptions, snapshot.selectedOptions]) {
    if (!Array.isArray(candidate)) continue;
    for (const option of candidate) {
      const key = selectedOptionKey(option);
      if (!key || option?.value === undefined || selected[key] !== undefined) continue;
      selected[key] = {
        value: option.value,
        ...(typeof option.selectedLabel === "string"
          ? { label: option.selectedLabel }
          : typeof option.label === "string"
            ? { label: option.label }
            : {}),
      };
    }
  }

  return selected;
}

