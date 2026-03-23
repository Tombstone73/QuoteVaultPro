/**
 * flatStockNesting.shared.ts
 *
 * Display-enrichment helpers for flat-stock (sheet-based / roll) line items.
 * Used by the prepress queue and prepress spec-sheet endpoints.
 *
 * These are pure functions with no side effects and no database access.
 * They can be imported by any route module that needs to enrich line items
 * with square-footage, finishing, or option-row display data.
 *
 * Placement: server/routes/flatStockNesting.shared.ts
 * Exported surface: parseDimensionsFromDescription, computeTotalSqFt,
 *                   extractFinishingBullets, buildPrepressOptionRows
 */

import { resolveVisibleNodes } from "@shared/optionTreeV2Runtime";

// ---------------------------------------------------------------------------
// Dimension parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to parse W×H dimensions from a free-text description string.
 * Handles formats like "24x36", "24 x 36", "24"x36"", "24in x 36in".
 * Returns null for each dimension when parsing fails.
 */
export const parseDimensionsFromDescription = (
  description?: string | null,
): { widthIn: number | null; heightIn: number | null } => {
  if (!description) return { widthIn: null, heightIn: null };
  const match = description.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { widthIn: null, heightIn: null };
  return {
    widthIn: Number(match[1]) || null,
    heightIn: Number(match[2]) || null,
  };
};

// ---------------------------------------------------------------------------
// Square-footage calculation
// ---------------------------------------------------------------------------

/**
 * Compute total square footage for a flat-stock line item.
 *
 * Falls back to parsing dimensions from the description when explicit width/height
 * are missing or non-positive. Returns null when dimensions cannot be resolved.
 *
 * Formula: (widthIn × heightIn / 144) × quantity
 */
export const computeTotalSqFt = (params: {
  width: unknown;
  height: unknown;
  quantity: unknown;
  description?: string | null;
}): number | null => {
  const quantity = Number(params.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const width = params.width != null ? Number(params.width) : null;
  const height = params.height != null ? Number(params.height) : null;
  const parsed = parseDimensionsFromDescription(params.description);
  const widthIn = width && width > 0 ? width : parsed.widthIn;
  const heightIn = height && height > 0 ? height : parsed.heightIn;
  if (!widthIn || !heightIn) return null;

  const areaSqFtPerUnit = (widthIn * heightIn) / 144;
  return areaSqFtPerUnit * quantity;
};

// ---------------------------------------------------------------------------
// Finishing option extraction
// ---------------------------------------------------------------------------

/**
 * Extract finishing-related option labels from a line item for board display.
 *
 * Scans selectedOptions, optionSelectionsJson, and specsJson for fields whose
 * label contains finishing-related keywords (finish, laminate, grommet, hem, etc.).
 * Returns a de-duplicated array of display strings.
 */
export const extractFinishingBullets = (lineItem: any): string[] => {
  const results = new Set<string>();
  const pushIfFinishingLike = (label?: string, value?: unknown) => {
    const l = String(label || "").trim();
    if (!l) return;
    const lv = l.toLowerCase();
    if (!/(finish|laminat|grommet|hem|trim|weld|mount|sew|pocket|tape|edge)/.test(lv)) return;
    const v = typeof value === "string" ? value.trim() : value;
    if (v === undefined || v === null || v === "") {
      results.add(l);
    } else if (typeof v === "boolean") {
      if (v) results.add(l);
    } else {
      results.add(`${l}: ${String(v)}`);
    }
  };

  const selectedOptions = Array.isArray(lineItem?.selectedOptions) ? lineItem.selectedOptions : [];
  for (const opt of selectedOptions) {
    pushIfFinishingLike(opt?.optionName, opt?.value);
  }

  const optionSelections = lineItem?.optionSelectionsJson;
  if (optionSelections && typeof optionSelections === "object") {
    for (const [key, value] of Object.entries(optionSelections)) {
      pushIfFinishingLike(key, value as unknown);
    }
  }

  const specs = lineItem?.specsJson;
  if (specs && typeof specs === "object") {
    for (const [key, value] of Object.entries(specs)) {
      pushIfFinishingLike(key, value as unknown);
    }
  }

  return Array.from(results);
};

// ---------------------------------------------------------------------------
// Option-row builder (prepress board / spec-sheet)
// ---------------------------------------------------------------------------

// Private helper: unwrap { value: X } selection objects
const normalizeSelectionValue = (raw: unknown): unknown => {
  if (raw && typeof raw === "object" && "value" in (raw as any)) {
    return (raw as any).value;
  }
  return raw;
};

// Private helper: compare two option values for equality against default
const valuesEqualForDefault = (selected: unknown, def: unknown): boolean => {
  if (Array.isArray(selected) || Array.isArray(def)) {
    if (!Array.isArray(selected) || !Array.isArray(def)) return false;
    const a = selected.map((v) => String(v)).sort();
    const b = def.map((v) => String(v)).sort();
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return String(selected) === String(def);
};

/**
 * Build display rows for the prepress board and spec-sheet option summary.
 *
 * Resolves option labels and selected values from the line item's
 * optionSelectionsJson, optionally enriched by the product's PBV2 tree JSON.
 * Falls back to the legacy selectedOptions array when no tree is available.
 */
export const buildPrepressOptionRows = (
  lineItem: any,
  treeJson?: any,
): Array<{
  groupLabel?: string | null;
  optionLabel: string;
  selectedLabel: string;
  isDefault?: boolean;
}> => {
  const rows: Array<{
    groupLabel?: string | null;
    optionLabel: string;
    selectedLabel: string;
    isDefault?: boolean;
  }> = [];

  const optionSelections = lineItem?.optionSelectionsJson as any;
  const selectedRecordRaw =
    optionSelections &&
    typeof optionSelections === "object" &&
    optionSelections.selected &&
    typeof optionSelections.selected === "object"
      ? optionSelections.selected
      : optionSelections && typeof optionSelections === "object"
        ? optionSelections
        : null;

  const selectedRecord: Record<string, unknown> =
    selectedRecordRaw && typeof selectedRecordRaw === "object" ? selectedRecordRaw : {};

  const normalizedNodes: any[] = treeJson
    ? Array.isArray(treeJson?.nodes)
      ? treeJson.nodes
      : Object.values(treeJson?.nodes || {})
    : [];

  const selectionNodeByKey = new Map<string, any>();
  for (const node of normalizedNodes) {
    const selectionKey = node?.input?.selectionKey;
    if (typeof selectionKey === "string" && selectionKey.trim()) {
      selectionNodeByKey.set(selectionKey, node);
    }
  }

  let visibleNodeIds = new Set<string>();
  if (treeJson && treeJson.schemaVersion === 2) {
    try {
      const visible = resolveVisibleNodes(treeJson as any, {
        schemaVersion: 2,
        selected: Object.fromEntries(
          Object.entries(selectedRecord).map(([key, value]) => [
            key,
            { value: normalizeSelectionValue(value) },
          ]),
        ),
      } as any);
      visibleNodeIds = new Set(visible);
    } catch {
      visibleNodeIds = new Set<string>();
    }
  }

  for (const [selectionKey, rawSelection] of Object.entries(selectedRecord)) {
    const node = selectionNodeByKey.get(selectionKey);
    if (node?.id && visibleNodeIds.size > 0 && !visibleNodeIds.has(node.id)) continue;

    const selectedValue = normalizeSelectionValue(rawSelection);
    if (selectedValue == null || selectedValue === "") continue;

    const optionLabel =
      typeof node?.label === "string" && node.label.trim() ? node.label : selectionKey;

    const choiceList = Array.isArray(node?.choices)
      ? node.choices
      : Array.isArray(node?.input?.constraints?.enum?.options)
        ? node.input.constraints.enum.options
        : [];

    const toDisplayLabel = (value: unknown): string => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => {
            const choice = choiceList.find((c: any) => String(c?.value) === String(entry));
            return choice?.label || String(entry);
          })
          .join(", ");
      }
      const choice = choiceList.find((c: any) => String(c?.value) === String(value));
      return choice?.label || String(value);
    };

    const selectedLabel = toDisplayLabel(selectedValue);
    const defaultValue =
      node?.input && Object.prototype.hasOwnProperty.call(node.input, "defaultValue")
        ? node.input.defaultValue
        : undefined;

    const row: {
      groupLabel?: string | null;
      optionLabel: string;
      selectedLabel: string;
      isDefault?: boolean;
    } = {
      groupLabel: typeof node?.ui?.groupKey === "string" ? node.ui.groupKey : null,
      optionLabel,
      selectedLabel,
    };

    if (defaultValue !== undefined) {
      row.isDefault = valuesEqualForDefault(selectedValue, defaultValue);
    }

    rows.push(row);
  }

  if (rows.length === 0) {
    const selectedOptions = Array.isArray(lineItem?.selectedOptions) ? lineItem.selectedOptions : [];
    for (const opt of selectedOptions) {
      const optionLabel = String(opt?.optionName || opt?.optionId || "Option").trim();
      const selectedValue = opt?.value;
      if (!optionLabel || selectedValue == null || selectedValue === "") continue;
      rows.push({ optionLabel, selectedLabel: String(selectedValue) });
    }
  }

  return rows;
};
