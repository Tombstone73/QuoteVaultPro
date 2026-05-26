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
const OPAQUE_TOKEN_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,}|choice[_-]?\d+|opt(?:_opt)?_[0-9a-f_:-]{8,})$/i;

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
  if (OPAQUE_TOKEN_PATTERN.test(raw)) return fallback;
  const stripped = stripTechnicalSuffix(raw)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return fallback;
  return stripped.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isOpaqueDisplayToken(value: unknown): boolean {
  const raw = cleanString(value);
  const normalized = normalizeLookupToken(raw);
  return !raw || OPAQUE_TOKEN_PATTERN.test(raw) || /^[0-9a-f]{32}$/i.test(normalized) || /^choice\d+$/i.test(normalized) || INTERNAL_KEY_PATTERN.test(raw);
}

function normalizeLookupToken(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookupTokenVariants(value: unknown): string[] {
  const raw = cleanString(value);
  if (!raw) return [];
  const variants = new Set<string>();
  const add = (entry: unknown) => {
    const stringValue = cleanString(entry);
    if (!stringValue) return;
    variants.add(stringValue);
    variants.add(stringValue.toLowerCase());
    const normalized = normalizeLookupToken(stringValue);
    if (normalized) variants.add(normalized);
    for (const prefix of ["optopt", "opt", "option"]) {
      if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
        variants.add(normalized.slice(prefix.length));
      }
    }
  };

  add(raw);
  add(stripTechnicalSuffix(raw));
  return Array.from(variants).filter(Boolean);
}

function indexLookupAlias<T>(map: Map<string, T>, alias: unknown, value: T) {
  for (const variant of lookupTokenVariants(alias)) {
    if (!map.has(variant)) map.set(variant, value);
  }
}

function lookupByAlias<T>(map: Map<string, T>, alias: unknown): T | undefined {
  for (const variant of lookupTokenVariants(alias)) {
    const hit = map.get(variant);
    if (hit) return hit;
  }
  return undefined;
}

function getDisplayLabelFromRecord(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const label = cleanString(value[key]);
    if (label && !isOpaqueDisplayToken(label)) return label;
  }
  return null;
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
  const rowKeys = new Set<string>();
  const snapshot = isRecord(lineItem?.pbv2SnapshotJson) ? lineItem.pbv2SnapshotJson : null;
  const effectiveTreeJson = treeJson ?? snapshot?.treeJson;

  const pushRow = (dedupeKey: string, row: ProductionDisplayOptionRow) => {
    const optionLabel = cleanString(row.optionLabel);
    const selectedLabel = cleanString(row.selectedLabel);
    if (!optionLabel || !selectedLabel) return;
    const key = dedupeKey || `${optionLabel}:${selectedLabel}`;
    if (rowKeys.has(key)) return;
    rowKeys.add(key);
    rows.push({ ...row, optionLabel, selectedLabel });
  };

  const optionSelections = lineItem?.optionSelectionsJson as any;
  const selectedRecordRaw =
    optionSelections &&
    typeof optionSelections === "object" &&
    optionSelections.selected &&
    typeof optionSelections.selected === "object"
      ? optionSelections.selected
      : optionSelections && typeof optionSelections === "object"
        ? optionSelections
        : snapshot && isRecord(snapshot.selections)
          ? snapshot.selections
          : null;

  const selectedRecord: Record<string, unknown> =
    selectedRecordRaw && typeof selectedRecordRaw === "object" ? selectedRecordRaw : {};

  const normalizedNodes: any[] = [];
  const seenNodeObjects = new Set<any>();
  for (const candidateTree of [snapshot?.treeJson, treeJson, effectiveTreeJson]) {
    if (!candidateTree) continue;
    const candidateNodes = Array.isArray(candidateTree?.nodes)
      ? candidateTree.nodes
      : Object.values(candidateTree?.nodes || {});
    for (const node of candidateNodes) {
      if (!node || seenNodeObjects.has(node)) continue;
      seenNodeObjects.add(node);
      normalizedNodes.push(node);
    }
  }

  const selectionNodeByKey = new Map<string, any>();
  const selectionNodeById = new Map<string, any>();
  for (const node of normalizedNodes) {
    for (const alias of [
      node?.input?.selectionKey,
      node?.selectionKey,
      node?.id,
      node?.key,
      node?.internalId,
      node?.optionId,
      node?.sourceOptionId,
      node?.importedOptionId,
    ]) {
      indexLookupAlias(selectionNodeByKey, alias, node);
    }
    indexLookupAlias(selectionNodeById, node?.id, node);
  }

  const selectedOptionById = new Map<string, any>();
  const snapshotSelectedOptions = Array.isArray(snapshot?.selectedOptions) ? snapshot.selectedOptions : [];
  const persistedSelectedOptions = Array.isArray(lineItem?.selectedOptions) ? lineItem.selectedOptions : [];
  for (const opt of [...snapshotSelectedOptions, ...persistedSelectedOptions]) {
    for (const alias of [opt?.optionId, opt?.id, opt?.key, opt?.selectionKey]) {
      indexLookupAlias(selectedOptionById, alias, opt);
    }
  }

  let visibleNodeIds = new Set<string>();
  if (effectiveTreeJson && effectiveTreeJson.schemaVersion === 2) {
    try {
      const visible = resolveVisibleNodes(effectiveTreeJson as any, {
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

  const runtimeResolvedChoices = isRecord(snapshot?.runtimeSelectionContext?.resolvedChoices)
    ? snapshot.runtimeSelectionContext.resolvedChoices
    : null;
  if (runtimeResolvedChoices) {
    for (const [selectionKey, resolved] of Object.entries(runtimeResolvedChoices)) {
      const optionLabel = getDisplayLabelFromRecord(resolved, ["optionLabel", "label", "name"]);
      const selectedLabel = getDisplayLabelFromRecord(resolved, ["choiceLabel", "selectedLabel", "valueLabel", "label", "name"]);
      if (!optionLabel || !selectedLabel) continue;
      pushRow(selectionKey, {
        groupLabel: null,
        optionLabel,
        selectedLabel,
      });
    }
  }

  const getChoiceList = (node: any): any[] => {
    if (Array.isArray(node?.choices)) return node.choices;
    if (Array.isArray(node?.input?.choices)) return node.input.choices;
    if (Array.isArray(node?.input?.options)) return node.input.options;
    if (Array.isArray(node?.input?.constraints?.enum?.options)) return node.input.constraints.enum.options;
    if (Array.isArray(node?.options)) return node.options;
    return [];
  };

  const choiceMatches = (choice: any, value: unknown): boolean => {
    const selectedVariants = new Set(lookupTokenVariants(value));
    return [choice?.value, choice?.id, choice?.key, choice?.choiceId, choice?.valueId, choice?.importedChoiceId]
      .some((candidate) => lookupTokenVariants(candidate).some((variant) => selectedVariants.has(variant)));
  };

  const choiceDisplayLabel = (choice: any): string | null =>
    getDisplayLabelFromRecord(choice, ["label", "name", "displayLabel", "title", "value"]);

  for (const [selectionKey, rawSelection] of Object.entries(selectedRecord)) {
    if (isInternalDisplayKey(selectionKey)) continue;
    if (rowKeys.has(selectionKey)) continue;

    const node = lookupByAlias(selectionNodeByKey, selectionKey) ?? lookupByAlias(selectionNodeById, selectionKey);
    if (node?.id && visibleNodeIds.size > 0 && !visibleNodeIds.has(node.id)) continue;

    const selectedValue = normalizeSelectionValue(rawSelection);
    if (isEmptySelectionValue(selectedValue)) continue;

    const selectedOptionSnapshot = lookupByAlias(selectedOptionById, selectionKey) ?? (node?.id ? lookupByAlias(selectedOptionById, node.id) : undefined);
    const optionLabel =
      getDisplayLabelFromRecord(selectedOptionSnapshot, ["optionName", "optionLabel", "label", "name"])
      || getDisplayLabelFromRecord(node, ["label", "name", "displayLabel", "title"])
      || humanizeDisplayToken(selectionKey);

    const choiceList = getChoiceList(node);

    const toDisplayLabel = (value: unknown): string => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => {
            const choice = choiceList.find((c: any) => choiceMatches(c, entry));
            return choiceDisplayLabel(choice) || humanizeDisplayToken(entry, "Yes");
          })
          .join(", ");
      }
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (isRecord(value)) {
        const direct = getDisplayLabelFromRecord(value, ["choiceLabel", "selectedLabel", "valueLabel", "label", "name", "value"]);
        return direct || "Yes";
      }
      const choice = choiceList.find((c: any) => choiceMatches(c, value));
      const fromChoice = choiceDisplayLabel(choice);
      if (fromChoice) return fromChoice;

      const inputType = cleanString(node?.input?.type ?? node?.input?.valueType ?? node?.input?.inputKind).toLowerCase();
      if (["boolean", "bool", "checkbox", "toggle", "addon", "add_on"].includes(inputType)) {
        return "Yes";
      }

      return humanizeDisplayToken(value, "Selected");
    };

    const selectedLabel = toDisplayLabel(selectedValue);
    if (
      process.env.NODE_ENV !== "production" &&
      (isOpaqueDisplayToken(selectionKey) || isOpaqueDisplayToken(selectedValue)) &&
      (optionLabel === "Unknown option" || selectedLabel === "Yes")
    ) {
      console.warn("[Production display resolver] resolved opaque PBV2 option token", {
        lineItemId: lineItem?.id ?? lineItem?.lineItemId ?? null,
        selectionKey,
        selectedValue,
        optionLabel,
        selectedLabel,
      });
    }
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

    pushRow(selectionKey, row);
  }

  if (rows.length === 0) {
    const selectedOptions = [...snapshotSelectedOptions, ...persistedSelectedOptions];
    for (const opt of selectedOptions) {
      const optionId = cleanString(opt?.optionId);
      if (isInternalDisplayKey(optionId) && !cleanString(opt?.optionName)) continue;
      const node = lookupByAlias(selectionNodeByKey, optionId) ?? lookupByAlias(selectionNodeById, optionId);
      const choiceList = getChoiceList(node);
      const choice = choiceList.find((candidate: any) => choiceMatches(candidate, opt?.value));
      const choiceLabel = choiceDisplayLabel(choice);
      const inputType = cleanString(node?.input?.type ?? node?.input?.valueType ?? node?.input?.inputKind).toLowerCase();
      const optionLabel = getDisplayLabelFromRecord(opt, ["optionName", "optionLabel", "label", "name"]) || humanizeDisplayToken(optionId);
      const selectedValue = opt?.value;
      if (!optionLabel || isEmptySelectionValue(selectedValue)) continue;
      if (process.env.NODE_ENV !== "production" && (isOpaqueDisplayToken(optionId) || isOpaqueDisplayToken(selectedValue))) {
        console.warn("[Production display resolver] resolved opaque PBV2 selectedOptions token", {
          lineItemId: lineItem?.id ?? lineItem?.lineItemId ?? null,
          optionId,
          selectedValue,
          optionLabel,
        });
      }
      pushRow(optionId, {
        optionLabel,
        selectedLabel: typeof selectedValue === "boolean"
          ? (selectedValue ? "Yes" : "No")
          : choiceLabel
            ? choiceLabel
          : isOpaqueDisplayToken(selectedValue) && ["boolean", "bool", "checkbox", "toggle", "addon", "add_on"].includes(inputType)
            ? "Yes"
            : humanizeDisplayToken(selectedValue, "Selected"),
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
