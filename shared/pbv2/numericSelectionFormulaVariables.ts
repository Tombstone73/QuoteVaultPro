import { resolveRuntimeVisibility } from "../optionTreeV2Runtime";

type AnyRecord = Record<string, any>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSelectionValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "value")) return (value as { value?: unknown }).value;
  return value;
}

function toNodesRecord(treeJson: unknown): Record<string, AnyRecord> {
  const tree = asRecord(treeJson);
  const nodesRaw = tree?.nodes;
  if (Array.isArray(nodesRaw)) {
    return Object.fromEntries(
      nodesRaw
        .map(asRecord)
        .filter((node): node is AnyRecord => Boolean(node && isNonEmptyString(node.id)))
        .map((node) => [String(node.id), node])
    );
  }
  const nodes = asRecord(nodesRaw);
  return nodes ? Object.fromEntries(Object.entries(nodes).filter(([, node]) => Boolean(asRecord(node)))) as Record<string, AnyRecord> : {};
}

function getSelectionKey(node: AnyRecord): string | null {
  if (isNonEmptyString(node.input?.selectionKey)) return String(node.input.selectionKey);
  if (isNonEmptyString(node.selectionKey)) return String(node.selectionKey);
  if (isNonEmptyString(node.key)) return String(node.key);
  if (isNonEmptyString(node.id)) return String(node.id);
  return null;
}

function getInputKind(node: AnyRecord): string {
  return String(node.input?.type ?? node.input?.valueType ?? node.input?.inputKind ?? "").trim().toLowerCase();
}

function isNumericInputNode(node: AnyRecord): boolean {
  const kind = getInputKind(node);
  return kind === "number" || kind === "numeric" || kind === "dimension";
}

function toFiniteNumberOrZero(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isFormulaIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function toFormulaIdentifier(value: string): string | null {
  const collapsed = value.trim().replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
  if (!collapsed) return null;
  return /^[A-Za-z_$]/.test(collapsed) ? collapsed : `_${collapsed}`;
}

function getLabelAliases(node: AnyRecord): string[] {
  const candidates = [
    node.label,
    node.name,
    node.input?.label,
    node.input?.name,
  ];

  return Array.from(
    new Set(
      candidates
        .filter(isNonEmptyString)
        .map((value) => toFormulaIdentifier(value.toLowerCase()))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function buildNumericSelectionFormulaVariables(input: {
  treeJson: unknown;
  selections?: Record<string, unknown>;
  includeHiddenAsZero?: boolean;
}): Record<string, number> {
  const nodes = toNodesRecord(input.treeJson);
  const rawSelections = input.selections ?? {};
  let effectiveSelections: Record<string, unknown> = {};
  let visibleNodeIds: string[] = [];

  try {
    const runtimeVisibility = resolveRuntimeVisibility(input.treeJson as any, rawSelections);
    effectiveSelections = runtimeVisibility.effectiveSelections;
    visibleNodeIds = runtimeVisibility.visibleNodeIds;
  } catch {
    effectiveSelections = Object.fromEntries(
      Object.entries(rawSelections).map(([key, value]) => [key, normalizeSelectionValue(value)])
    );
    visibleNodeIds = Object.keys(nodes);
  }

  const visibleNodeIdSet = new Set(visibleNodeIds);
  const includeHiddenAsZero = input.includeHiddenAsZero ?? true;
  const out: Record<string, number> = {};

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!isNumericInputNode(node)) continue;
    const selectionKey = getSelectionKey(node);
    if (!selectionKey) continue;

    const isVisible = visibleNodeIdSet.has(nodeId);
    if (!isVisible && !includeHiddenAsZero) continue;

    const rawValue = isVisible && Object.prototype.hasOwnProperty.call(effectiveSelections, selectionKey)
      ? effectiveSelections[selectionKey]
      : node.input?.defaultValue;
    const numeric = isVisible ? toFiniteNumberOrZero(rawValue) : 0;

    if (isFormulaIdentifier(selectionKey)) {
      out[selectionKey] = numeric;
    }

    const alias = toFormulaIdentifier(selectionKey);
    if (alias && !Object.prototype.hasOwnProperty.call(out, alias)) {
      out[alias] = numeric;
    }

    for (const labelAlias of getLabelAliases(node)) {
      if (!Object.prototype.hasOwnProperty.call(out, labelAlias)) {
        out[labelAlias] = numeric;
      }
    }
  }

  return out;
}
