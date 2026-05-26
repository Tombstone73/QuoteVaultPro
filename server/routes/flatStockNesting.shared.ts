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
 *                   extractFinishingBullets, buildPrepressOptionRows,
 *                   resolveLineItemProductionDisplayData
 */

import { resolveVisibleNodes } from "@shared/optionTreeV2Runtime";

export type ProductionDisplayOptionRow = {
  groupLabel?: string | null;
  optionLabel: string;
  selectedLabel: string;
  isDefault?: boolean;
};

export type LineItemProductionDisplayData = {
  mediaLabel: string;
  optionRows: ProductionDisplayOptionRow[];
  lineItemNotes: string | null;
  priorityLabel: string | null;
};

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

const INTERNAL_OPTION_KEYS = new Set([
  "schemaVersion",
  "version",
  "selected",
  "resolved",
  "meta",
  "metadata",
  "debug",
  "resolver",
  "runtime",
  "visibleNodeIds",
  "visibleGroupIds",
  "visibleChoiceIds",
  "pathTags",
]);

const INTERNAL_KEY_PATTERN = /(^|_)(id|ids|uuid|resolver|metadata|schema|version|debug|fingerprint|hash|import|internal)(_|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripTechnicalSuffix(value: string): string {
  return value
    .replace(/__import_.+$/i, "")
    .replace(/_import_.+$/i, "")
    .replace(/^opt_opt_/i, "")
    .replace(/^opt_/i, "")
    .replace(/^choice_/i, "choice ");
}

function humanizeDisplayToken(value: unknown, fallback = "Unknown option"): string {
  const raw = cleanString(value);
  if (!raw) return fallback;
  if (/^choice[_-]?\d+$/i.test(raw)) return fallback;
  const stripped = stripTechnicalSuffix(raw)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return fallback;
  return stripped.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isInternalDisplayKey(key: unknown): boolean {
  const raw = cleanString(key);
  if (!raw) return true;
  if (INTERNAL_OPTION_KEYS.has(raw)) return true;
  return INTERNAL_KEY_PATTERN.test(raw) && !/(finish|laminat|grommet|hem|trim|weld|mount|sew|pocket|tape|edge|contour|cut)/i.test(raw);
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = cleanString(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function extractMaterialLabelFromUnknown(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return cleanString(value) || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const label = extractMaterialLabelFromUnknown(entry);
      if (label) return label;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  const direct = pickFirstString(
    value.materialName,
    value.mediaName,
    value.materialLabel,
    value.mediaLabel,
    value.name,
    value.label,
  );
  if (direct) return direct;

  for (const key of ["material", "media", "selectedMaterial", "primaryMaterial", "resolvedMaterial", "materials"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const nested = extractMaterialLabelFromUnknown(value[key]);
      if (nested) return nested;
    }
  }

  return null;
}

export function resolveLineItemMediaLabel(args: {
  lineItem?: any;
  materialName?: string | null;
  primaryMaterialName?: string | null;
}): string {
  const lineItem = args.lineItem ?? {};
  const label = pickFirstString(
    args.materialName,
    lineItem.materialName,
    extractMaterialLabelFromUnknown(lineItem.materialUsageJson),
    extractMaterialLabelFromUnknown(lineItem.materialUsages),
    extractMaterialLabelFromUnknown(lineItem.pbv2SnapshotJson),
    extractMaterialLabelFromUnknown(lineItem.specsJson),
    args.primaryMaterialName,
    lineItem.primaryMaterialName,
  );
  return label || "Not specified";
}

/**
 * Extract finishing-related option labels from a line item for board display.
 *
 * Scans selectedOptions, optionSelectionsJson, and specsJson for fields whose
 * label contains finishing-related keywords (finish, laminate, grommet, hem, etc.).
 * Returns a de-duplicated array of display strings.
 */
export const extractFinishingBullets = (lineItem: any): string[] => {
  return buildPrepressOptionRows(lineItem)
    .filter((row) => /(finish|laminat|grommet|hem|trim|weld|mount|sew|pocket|tape|edge|contour|cut)/i.test(row.optionLabel))
    .map((row) => `${row.optionLabel}: ${row.selectedLabel}`);
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

const isEmptySelectionValue = (value: unknown): boolean =>
  value === undefined
  || value === null
  || value === ""
  || (Array.isArray(value) && value.length === 0);

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
): ProductionDisplayOptionRow[] => {
  const rows: ProductionDisplayOptionRow[] = [];

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
  const selectionNodeById = new Map<string, any>();
  for (const node of normalizedNodes) {
    const selectionKey = node?.input?.selectionKey;
    if (typeof selectionKey === "string" && selectionKey.trim()) {
      selectionNodeByKey.set(selectionKey, node);
    }
    if (typeof node?.id === "string" && node.id.trim()) {
      selectionNodeById.set(node.id, node);
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
    if (isInternalDisplayKey(selectionKey)) continue;

    const node = selectionNodeByKey.get(selectionKey) ?? selectionNodeById.get(selectionKey);
    if (node?.id && visibleNodeIds.size > 0 && !visibleNodeIds.has(node.id)) continue;

    const selectedValue = normalizeSelectionValue(rawSelection);
    if (isEmptySelectionValue(selectedValue)) continue;

    const optionLabel =
      typeof node?.label === "string" && node.label.trim() ? node.label : humanizeDisplayToken(selectionKey);

    const choiceList = Array.isArray(node?.choices)
      ? node.choices
      : Array.isArray(node?.input?.constraints?.enum?.options)
        ? node.input.constraints.enum.options
        : [];

    const toDisplayLabel = (value: unknown): string => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => {
            const choice = choiceList.find((c: any) => String(c?.value) === String(entry) || String(c?.id) === String(entry));
            return choice?.label || humanizeDisplayToken(entry, "Unknown choice");
          })
          .join(", ");
      }
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (isRecord(value)) {
        const direct = pickFirstString(value.label, value.name, value.value);
        return direct || "Unknown choice";
      }
      const choice = choiceList.find((c: any) => String(c?.value) === String(value) || String(c?.id) === String(value));
      return choice?.label || humanizeDisplayToken(value, "Unknown choice");
    };

    const selectedLabel = toDisplayLabel(selectedValue);
    const defaultValue =
      node?.input && Object.prototype.hasOwnProperty.call(node.input, "defaultValue")
        ? node.input.defaultValue
        : undefined;

    const row: ProductionDisplayOptionRow = {
      groupLabel: typeof node?.ui?.groupKey === "string" ? humanizeDisplayToken(node.ui.groupKey, "") || null : null,
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
      const optionId = cleanString(opt?.optionId);
      if (isInternalDisplayKey(optionId) && !cleanString(opt?.optionName)) continue;
      const optionLabel = cleanString(opt?.optionName) || humanizeDisplayToken(optionId);
      const selectedValue = opt?.value;
      if (!optionLabel || isEmptySelectionValue(selectedValue)) continue;
      rows.push({
        optionLabel,
        selectedLabel: typeof selectedValue === "boolean" ? (selectedValue ? "Yes" : "No") : humanizeDisplayToken(selectedValue, "Unknown choice"),
      });
    }
  }

  return rows;
};

export function resolveLineItemProductionDisplayData(args: {
  lineItem: any;
  treeJson?: any;
  materialName?: string | null;
  primaryMaterialName?: string | null;
}): LineItemProductionDisplayData {
  const lineItem = args.lineItem ?? {};
  const rawPriority = cleanString(lineItem.priority);
  const lineItemNotes = pickFirstString(
    lineItem.productionNotes,
    lineItem.lineItemNotes,
    lineItem.specsJson?.lineItemNotes?.descLong,
    lineItem.specsJson?.lineItemNotes?.text,
    lineItem.specsJson?.notes,
  );

  const optionRows = buildPrepressOptionRows(lineItem, args.treeJson);
  if (process.env.NODE_ENV !== "production") {
    for (const row of optionRows) {
      if (INTERNAL_KEY_PATTERN.test(row.optionLabel) || INTERNAL_KEY_PATTERN.test(row.selectedLabel)) {
        console.warn("[Production display resolver] unresolved technical option label", {
          lineItemId: lineItem.id ?? lineItem.lineItemId ?? null,
          optionLabel: row.optionLabel,
          selectedLabel: row.selectedLabel,
        });
      }
    }
  }

  return {
    mediaLabel: resolveLineItemMediaLabel({
      lineItem,
      materialName: args.materialName,
      primaryMaterialName: args.primaryMaterialName,
    }),
    optionRows,
    lineItemNotes,
    priorityLabel: rawPriority ? humanizeDisplayToken(rawPriority) : null,
  };
}
