import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";
import { resolveRuntimeVisibility } from "./optionTreeV2Runtime";

const RENDERABLE_INPUT_TYPES = new Set([
  "boolean",
  "checkbox",
  "select",
  "radio",
  "multiselect",
  "number",
  "text",
  "textarea",
]);

function normalizeNodeKind(node: Record<string, any>): OptionNodeV2["kind"] | undefined {
  if (node.kind === "question" || node.kind === "group" || node.kind === "computed") return node.kind;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
  if (type === "input" || type === "option") return "question";
  if (type === "group") return "group";
  if (type === "compute" || type === "computed") return "computed";
  return undefined;
}

function getSelectionKeyForRuntime(nodeRecord: Record<string, any>, nodeId: string): string {
  // Selection key precedence is input.selectionKey → node.key → nodeId.
  // This helper handles the latter two cases after normalizePbv2Tree has
  // already determined that input.selectionKey is missing.
  if (typeof nodeRecord.key === "string" && nodeRecord.key.trim()) {
    return nodeRecord.key;
  }
  return nodeId;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizePbv2Tree(tree: unknown): OptionTreeV2 | null {
  const raw = parseMaybeJson(tree);
  if (!raw || typeof raw !== "object") return null;

  const treeRecord = raw as Record<string, any>;
  const nodeEntries = Array.isArray(treeRecord.nodes)
    ? treeRecord.nodes
        .filter((node): node is Record<string, any> => Boolean(node && typeof node === "object" && typeof (node as any).id === "string"))
        .map((node) => [String(node.id), node] as const)
    : Object.entries(treeRecord.nodes && typeof treeRecord.nodes === "object" ? treeRecord.nodes : {});
  const nodes: Record<string, OptionNodeV2> = {};

  for (const [fallbackId, rawNode] of nodeEntries) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const nodeRecord = rawNode as Record<string, any>;
    const id = typeof nodeRecord.id === "string" && nodeRecord.id.trim() ? nodeRecord.id : String(fallbackId);
    const kind = normalizeNodeKind(nodeRecord);
    let input = nodeRecord.input && typeof nodeRecord.input === "object" ? { ...nodeRecord.input } : undefined;
    if (kind === "question" && input && (!input.selectionKey || typeof input.selectionKey !== "string")) {
      input = { ...input, selectionKey: getSelectionKeyForRuntime(nodeRecord, id) };
    }
    const node = { ...(nodeRecord as any), id } as OptionNodeV2;
    if (kind) node.kind = kind;
    if (input) node.input = input as OptionNodeV2["input"];
    nodes[id] = node;
  }

  if (Object.keys(nodes).length === 0) return null;

  return {
    ...(treeRecord as any),
    schemaVersion: 2,
    rootNodeIds: Array.isArray(treeRecord.rootNodeIds) && treeRecord.rootNodeIds.length > 0
      ? treeRecord.rootNodeIds.filter((nodeId: unknown): nodeId is string => typeof nodeId === "string" && nodeId.trim().length > 0)
      : Object.keys(nodes),
    nodes,
    edges: Array.isArray(treeRecord.edges) ? treeRecord.edges : [],
  } as OptionTreeV2;
}

function isRenderableQuestionNode(node: OptionNodeV2): boolean {
  const kind = normalizeNodeKind(node as Record<string, any>);
  if (kind !== "question" || !node.input) return false;
  const status = (typeof node.status === "string" ? node.status : "ENABLED").toUpperCase();
  return status !== "DISABLED"
    && status !== "DELETED"
    && RENDERABLE_INPUT_TYPES.has(String(node.input.type ?? "").toLowerCase());
}

function isEmptySelectionValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

export function getRenderablePbv2QuestionNodeIds(tree: OptionTreeV2 | null | undefined): string[] {
  const normalized = normalizePbv2Tree(tree);
  if (!normalized) return [];
  return Object.values(normalized.nodes).filter(isRenderableQuestionNode).map((node) => node.id);
}

export function hasRenderablePbv2Tree(tree: OptionTreeV2 | null | undefined): boolean {
  return getRenderablePbv2QuestionNodeIds(tree).length > 0;
}

export function buildPbv2DefaultsHydrationKey({
  lineItemId,
  productId,
  activeTreeVersionId,
}: {
  lineItemId?: string | null;
  productId?: string | null;
  activeTreeVersionId?: string | null;
}): string | null {
  if (!lineItemId || !productId) return null;
  return [lineItemId, productId, activeTreeVersionId || "unversioned"].join("|");
}

export function hasPbv2Selections(selections: LineItemOptionSelectionsV2 | null | undefined): boolean {
  return Object.values(selections?.selected ?? {}).some((entry) => !isEmptySelectionValue(entry?.value));
}

export function shouldHydratePbv2Defaults({
  hydrationKey,
  hydratedKeys,
  selections,
  tree,
}: {
  hydrationKey: string | null;
  hydratedKeys: ReadonlySet<string>;
  selections: LineItemOptionSelectionsV2 | null | undefined;
  tree: OptionTreeV2 | null | undefined;
}): boolean {
  if (!hydrationKey) return false;
  if (!hasRenderablePbv2Tree(tree)) return false;
  if (hydratedKeys.has(hydrationKey)) return false;
  return !hasPbv2Selections(selections);
}

export function buildPbv2DefaultSelections(tree: OptionTreeV2 | null | undefined): LineItemOptionSelectionsV2 | null {
  const normalized = normalizePbv2Tree(tree);
  if (!normalized || !hasRenderablePbv2Tree(normalized)) return null;

  const resolved = resolveRuntimeVisibility(normalized, { schemaVersion: 2, selected: {} });
  const effectiveSelections = resolved.effectiveSelections;
  if (!effectiveSelections || typeof effectiveSelections !== "object") return { schemaVersion: 2, selected: {} };
  const nextSelected: LineItemOptionSelectionsV2["selected"] = {};

  for (const [key, value] of Object.entries(effectiveSelections)) {
    if (isEmptySelectionValue(value)) continue;
    nextSelected[key] = { value };
  }

  return { schemaVersion: 2, selected: nextSelected };
}
