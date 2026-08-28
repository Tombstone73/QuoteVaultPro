import { isCanonicalEmptyOptionTreeV2, type LineItemOptionSelectionsV2, type OptionNodeV2, type OptionTreeV2 } from "./optionTreeV2";
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

  if (Object.keys(nodes).length === 0) {
    if (!isCanonicalEmptyOptionTreeV2(treeRecord)) return null;
    return {
      ...(treeRecord as any),
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      edges: [],
    } as OptionTreeV2;
  }

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

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getTreeNodeOrder(node: any, fallback: number): number {
  const explicit = firstFiniteNumber(
    node?.ui?.sortOrder,
    node?.displayOrder,
    node?.sortOrder,
    node?.order,
    node?.orderIndex,
    node?.index,
  );
  return explicit ?? 1_000_000 + fallback;
}

function getChoiceOrder(choice: any, fallback: number): number {
  const explicit = firstFiniteNumber(
    choice?.sortOrder,
    choice?.displayOrder,
    choice?.order,
    choice?.orderIndex,
    choice?.index,
  );
  return explicit ?? 1_000_000 + fallback;
}

export function sortPbv2Choices<T extends { value?: string; label?: string }>(choices: T[] | null | undefined): T[] {
  return (choices ?? [])
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => {
      const ao = getChoiceOrder(a.choice, a.index);
      const bo = getChoiceOrder(b.choice, b.index);
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((entry) => entry.choice);
}

export function filterPbv2ChoicesForRuntime<T extends { value?: string; label?: string }>(
  nodeId: string,
  choices: T[] | null | undefined,
  visibleChoiceIds?: Iterable<string> | null,
): T[] {
  const sortedChoices = sortPbv2Choices(choices);
  if (!visibleChoiceIds) return sortedChoices;

  const visibleChoiceIdSet = visibleChoiceIds instanceof Set ? visibleChoiceIds : new Set(visibleChoiceIds);
  return sortedChoices.filter((choice) => visibleChoiceIdSet.has(`${nodeId}:${String(choice.value ?? "")}`));
}

export function sortPbv2NodeIdsByBuilderOrder(tree: OptionTreeV2 | null | undefined, nodeIds: string[]): string[] {
  const normalized = normalizePbv2Tree(tree);
  if (!normalized) return nodeIds.slice();

  const fallbackNodeOrder = new Map<string, number>();
  normalized.rootNodeIds.forEach((nodeId, index) => {
    fallbackNodeOrder.set(nodeId, index);
  });

  const parentGroupOrder = new Map<string, number>();
  for (const nodeId of normalized.rootNodeIds) {
    const node = normalized.nodes[nodeId];
    if (node?.kind === "group") {
      parentGroupOrder.set(nodeId, getTreeNodeOrder(node, fallbackNodeOrder.get(nodeId) ?? parentGroupOrder.size));
    }
  }

  for (const edge of Array.isArray((normalized as any).edges) ? (normalized as any).edges : []) {
    if (!edge?.fromNodeId || !edge?.toNodeId) continue;
    const fromNode = normalized.nodes[edge.fromNodeId];
    if (!fromNode || fromNode.kind !== "group") continue;
    const childFallback = fallbackNodeOrder.size;
    if (!fallbackNodeOrder.has(edge.toNodeId)) {
      fallbackNodeOrder.set(edge.toNodeId, childFallback);
    }
    if (!parentGroupOrder.has(edge.fromNodeId)) {
      parentGroupOrder.set(edge.fromNodeId, getTreeNodeOrder(fromNode, parentGroupOrder.size));
    }
  }

  for (const node of Object.values(normalized.nodes)) {
    if (!node || node.kind !== "group") continue;
    if (!parentGroupOrder.has(node.id)) {
      parentGroupOrder.set(node.id, getTreeNodeOrder(node, parentGroupOrder.size));
    }
    const children = Array.isArray(node.edges?.children) ? node.edges!.children! : [];
    children.forEach((edge, index) => {
      if (!edge?.toNodeId || fallbackNodeOrder.has(edge.toNodeId)) return;
      fallbackNodeOrder.set(edge.toNodeId, index);
    });
  }

  const nodeToParentGroupOrder = new Map<string, number>();
  for (const edge of Array.isArray((normalized as any).edges) ? (normalized as any).edges : []) {
    if (!edge?.fromNodeId || !edge?.toNodeId) continue;
    const fromNode = normalized.nodes[edge.fromNodeId];
    if (!fromNode || fromNode.kind !== "group") continue;
    const groupOrder = parentGroupOrder.get(edge.fromNodeId) ?? getTreeNodeOrder(fromNode, 0);
    const existing = nodeToParentGroupOrder.get(edge.toNodeId);
    if (existing === undefined || groupOrder < existing) {
      nodeToParentGroupOrder.set(edge.toNodeId, groupOrder);
    }
  }
  for (const node of Object.values(normalized.nodes)) {
    if (!node || node.kind !== "group") continue;
    const groupOrder = parentGroupOrder.get(node.id) ?? getTreeNodeOrder(node, 0);
    for (const edge of Array.isArray(node.edges?.children) ? node.edges!.children! : []) {
      if (!edge?.toNodeId) continue;
      const existing = nodeToParentGroupOrder.get(edge.toNodeId);
      if (existing === undefined || groupOrder < existing) {
        nodeToParentGroupOrder.set(edge.toNodeId, groupOrder);
      }
    }
  }

  return nodeIds
    .map((nodeId, index) => ({ nodeId, index }))
    .sort((a, b) => {
      const nodeA = normalized.nodes[a.nodeId];
      const nodeB = normalized.nodes[b.nodeId];
      const ga = nodeToParentGroupOrder.get(a.nodeId) ?? (nodeA?.kind === "group" ? parentGroupOrder.get(a.nodeId) : undefined) ?? 0;
      const gb = nodeToParentGroupOrder.get(b.nodeId) ?? (nodeB?.kind === "group" ? parentGroupOrder.get(b.nodeId) : undefined) ?? 0;
      if (ga !== gb) return ga - gb;

      const ao = getTreeNodeOrder(nodeA, fallbackNodeOrder.get(a.nodeId) ?? a.index);
      const bo = getTreeNodeOrder(nodeB, fallbackNodeOrder.get(b.nodeId) ?? b.index);
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((entry) => entry.nodeId);
}

export function getRenderablePbv2QuestionNodeIds(tree: OptionTreeV2 | null | undefined): string[] {
  const normalized = normalizePbv2Tree(tree);
  if (!normalized) return [];
  const ids = Object.values(normalized.nodes).filter(isRenderableQuestionNode).map((node) => node.id);
  return sortPbv2NodeIdsByBuilderOrder(normalized, ids);
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
