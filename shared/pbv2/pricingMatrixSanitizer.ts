import type { ProductOptionPricingMatrix, ProductOptionPricingMatrixRow } from "../productOptionPricingMatrix";

export type Pbv2PricingMatrixSanitizerChange = {
  code:
    | "PBV2_MATRIX_DIMENSION_REMOVED"
    | "PBV2_MATRIX_ROW_MATCH_REMOVED"
    | "PBV2_MATRIX_ROW_REMOVED"
    | "PBV2_MATRIX_REMOVED";
  message: string;
  path: string;
  context?: Record<string, unknown>;
};

export type Pbv2PricingMatrixSanitizerResult<T = any> = {
  tree: T;
  changed: boolean;
  changes: Pbv2PricingMatrixSanitizerChange[];
};

export type Pbv2PricingMatrixSanitizerOptions = {
  /**
   * Draft editing needs to preserve selected pricing dimensions before rows are
   * generated. Publish/repair paths keep the default strict behavior.
   */
  allowIncompleteMatrix?: boolean;
};

type OptionContext = {
  knownSelectionKeys: Set<string>;
  choiceValuesBySelectionKey: Record<string, Set<string>>;
  booleanSelectionKeys: Set<string>;
};

function cloneJson<T>(value: T): T {
  const sc = (globalThis as any).structuredClone as ((v: any) => any) | undefined;
  if (typeof sc === "function") return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`).join(",")}}`;
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "ENABLED";
}

function normalizeNodeType(node: Record<string, any>): string {
  const raw = String(node.type ?? node.nodeType ?? node.kind ?? "").toUpperCase();
  if (raw === "QUESTION") return "INPUT";
  if (raw === "COMPUTED") return "COMPUTE";
  return raw;
}

function extractNodes(tree: Record<string, any>): Record<string, any>[] {
  const raw = tree.nodes;
  if (Array.isArray(raw)) return raw.filter((node) => asRecord(node)) as Record<string, any>[];
  const nodes = asRecord(raw);
  if (!nodes) return [];
  const out: Record<string, any>[] = [];
  for (const [id, node] of Object.entries(nodes)) {
      const rec = asRecord(node);
      if (!rec) continue;
      out.push({ ...rec, id: isNonEmptyString(rec.id) ? rec.id : id });
  }
  return out;
}

function getInputOptionContext(tree: Record<string, any>): OptionContext {
  const knownSelectionKeys = new Set<string>();
  const choiceValuesBySelectionKey: Record<string, Set<string>> = {};
  const booleanSelectionKeys = new Set<string>();

  for (const node of extractNodes(tree)) {
    if (normalizeStatus(node.status) === "DELETED") continue;
    if (normalizeNodeType(node) !== "INPUT") continue;

    const input = asRecord(node.input) ?? asRecord(node.data);
    const selectionKey = isNonEmptyString(input?.selectionKey) ? String(input.selectionKey) : "";
    if (!selectionKey) continue;

    knownSelectionKeys.add(selectionKey);

    const inputType = String(input?.type ?? input?.valueType ?? "").toLowerCase();
    if (inputType === "boolean" || inputType === "bool") booleanSelectionKeys.add(selectionKey);

    if (!Array.isArray(node.choices)) continue;
    const values = new Set<string>();
    for (const choiceRaw of node.choices) {
      const choice = asRecord(choiceRaw);
      if (!choice || !Object.prototype.hasOwnProperty.call(choice, "value")) continue;
      values.add(stableStringify(choice.value));
    }
    if (values.size > 0) choiceValuesBySelectionKey[selectionKey] = values;
  }

  return { knownSelectionKeys, choiceValuesBySelectionKey, booleanSelectionKeys };
}

function optionValueIsKnown(optionGroup: string, value: unknown, context: OptionContext): boolean {
  const choices = context.choiceValuesBySelectionKey[optionGroup];
  if (choices && choices.size > 0) return choices.has(stableStringify(value));
  if (context.booleanSelectionKeys.has(optionGroup)) return typeof value === "boolean";
  return true;
}

function getMatrixRowMatch(row: Record<string, any>): { key: "when" | "match" | "combination"; value: Record<string, any> } | null {
  for (const key of ["when", "match", "combination"] as const) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const match = asRecord(row[key]);
      return match ? { key, value: match } : null;
    }
  }
  return null;
}

function sanitizeMatrix(
  rawMatrix: unknown,
  path: string,
  context: OptionContext,
  options: Pbv2PricingMatrixSanitizerOptions = {},
): { matrix: ProductOptionPricingMatrix | null; changes: Pbv2PricingMatrixSanitizerChange[] } {
  const changes: Pbv2PricingMatrixSanitizerChange[] = [];
  const matrix = asRecord(rawMatrix);
  if (!matrix) {
    changes.push({
      code: "PBV2_MATRIX_REMOVED",
      message: "Removed pricing matrix because it is not a valid object.",
      path,
    });
    return { matrix: null, changes };
  }

  const originalDimensions = Array.isArray(matrix.dimensions)
    ? matrix.dimensions.filter(isNonEmptyString).map(String)
    : [];
  const dimensions = originalDimensions.filter((dimension) => context.knownSelectionKeys.has(dimension));

  for (const dimension of originalDimensions) {
    if (!context.knownSelectionKeys.has(dimension)) {
      changes.push({
        code: "PBV2_MATRIX_DIMENSION_REMOVED",
        message: `Removed pricing matrix dimension '${dimension}' because the option no longer exists.`,
        path: `${path}.dimensions`,
        context: { dimension },
      });
    }
  }

  const dimensionSet = new Set(dimensions);
  const rowsRaw = Array.isArray(matrix.rows) ? matrix.rows : [];
  const rows: ProductOptionPricingMatrixRow[] = [];

  rowsRaw.forEach((rowRaw, rowIndex) => {
    const row = asRecord(rowRaw);
    const rowPath = `${path}.rows[${rowIndex}]`;
    if (!row) {
      changes.push({
        code: "PBV2_MATRIX_ROW_REMOVED",
        message: `Removed pricing matrix row ${rowIndex + 1} because it is not an object.`,
        path: rowPath,
      });
      return;
    }

    const matchEntry = getMatrixRowMatch(row);
    if (!matchEntry) {
      changes.push({
        code: "PBV2_MATRIX_ROW_REMOVED",
        message: `Removed pricing matrix row ${rowIndex + 1} because it has no valid match object.`,
        path: rowPath,
        context: { rowId: row.id ?? null },
      });
      return;
    }

    const nextMatch: Record<string, unknown> = {};
    let removedMatchKey = false;
    let hasDeletedChoiceReference = false;

    for (const [key, value] of Object.entries(matchEntry.value)) {
      if (!dimensionSet.has(key)) {
        removedMatchKey = true;
        changes.push({
          code: "PBV2_MATRIX_ROW_MATCH_REMOVED",
          message: `Removed pricing matrix row reference '${key}' because it is not a valid dimension.`,
          path: `${rowPath}.${matchEntry.key}.${key}`,
          context: { rowId: row.id ?? null, dimension: key },
        });
        continue;
      }

      if (!optionValueIsKnown(key, value, context)) {
        hasDeletedChoiceReference = true;
        changes.push({
          code: "PBV2_MATRIX_ROW_REMOVED",
          message: `Removed pricing matrix row ${rowIndex + 1} because '${String(value)}' is not a valid choice for '${key}'.`,
          path: `${rowPath}.${matchEntry.key}.${key}`,
          context: { rowId: row.id ?? null, dimension: key, value },
        });
        break;
      }

      nextMatch[key] = value;
    }

    if (hasDeletedChoiceReference) return;

    const hasAllDimensions = dimensions.length > 0 && dimensions.every((dimension) => Object.prototype.hasOwnProperty.call(nextMatch, dimension));
    if (!hasAllDimensions) {
      changes.push({
        code: "PBV2_MATRIX_ROW_REMOVED",
        message: `Removed pricing matrix row ${rowIndex + 1} because it no longer has a complete valid option combination.`,
        path: rowPath,
        context: { rowId: row.id ?? null, removedMatchKey },
      });
      return;
    }

    rows.push({
      ...row,
      [matchEntry.key]: nextMatch,
    } as ProductOptionPricingMatrixRow);
  });

  if (dimensions.length === 0 || (!options.allowIncompleteMatrix && rows.length === 0)) {
    changes.push({
      code: "PBV2_MATRIX_REMOVED",
      message: "Removed pricing matrix because no valid dimensions or rows remain.",
      path,
      context: { dimensions: dimensions.length, rows: rows.length },
    });
    return { matrix: null, changes };
  }

  return {
    matrix: {
      ...matrix,
      dimensions,
      rows,
    } as ProductOptionPricingMatrix,
    changes,
  };
}

export function sanitizePbv2PricingMatrix<T = any>(
  treeJson: T,
  options: Pbv2PricingMatrixSanitizerOptions = {},
): Pbv2PricingMatrixSanitizerResult<T> {
  const treeRecord = asRecord(treeJson);
  if (!treeRecord) return { tree: treeJson, changed: false, changes: [] };

  const tree = cloneJson(treeJson) as Record<string, any>;
  const context = getInputOptionContext(tree);
  const changes: Pbv2PricingMatrixSanitizerChange[] = [];

  if (Object.prototype.hasOwnProperty.call(tree, "pricingMatrix")) {
    const result = sanitizeMatrix(tree.pricingMatrix, "tree.pricingMatrix", context, options);
    changes.push(...result.changes);
    if (result.matrix) tree.pricingMatrix = result.matrix;
    else delete tree.pricingMatrix;
  }

  const meta = asRecord(tree.meta);
  if (meta && Object.prototype.hasOwnProperty.call(meta, "pricingMatrix")) {
    const result = sanitizeMatrix(meta.pricingMatrix, "tree.meta.pricingMatrix", context, options);
    changes.push(...result.changes);
    if (result.matrix) meta.pricingMatrix = result.matrix;
    else delete meta.pricingMatrix;
    tree.meta = meta;
  }

  return {
    tree: tree as T,
    changed: changes.length > 0,
    changes,
  };
}
