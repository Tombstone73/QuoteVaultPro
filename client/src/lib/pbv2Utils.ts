/**
 * Utility functions for detecting and working with PBV2 (Product Builder V2) products
 */

import type { Product } from "@shared/schema";
import { isCanonicalEmptyOptionTreeV2, type OptionNodeV2, type OptionTreeV2 } from "@shared/optionTreeV2";

export type Pbv2TreeSummary = {
  exists: boolean;
  groupCount: number;
  questionCount: number;
  choiceCount: number;
  renderableControlCount: number;
};

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

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeNodeKind(node: Record<string, any>): OptionNodeV2["kind"] | undefined {
  if (node.kind === "question" || node.kind === "group" || node.kind === "computed") {
    return node.kind;
  }

  const type = typeof node.type === "string" ? node.type.toUpperCase() : "";
  if (type === "INPUT" || type === "OPTION") return "question";
  if (type === "GROUP") return "group";
  if (type === "COMPUTE" || type === "COMPUTED") return "computed";
  return undefined;
}

export function isRenderablePbv2InputType(inputType: string): boolean {
  return RENDERABLE_INPUT_TYPES.has(String(inputType || "").toLowerCase());
}

export function isPbv2QuestionNode(node: unknown): node is OptionNodeV2 {
  return Boolean(node && typeof node === "object" && normalizeNodeKind(node as Record<string, any>) === "question");
}

export function normalizePbv2Tree(tree: unknown): OptionTreeV2 | null {
  const raw = parseMaybeJson(tree);
  if (!raw || typeof raw !== "object") return null;

  const treeRecord = raw as Record<string, any>;
  const rawNodes = treeRecord.nodes;
  const normalizedNodes: Record<string, OptionNodeV2> = {};

  const nodeEntries = Array.isArray(rawNodes)
    ? rawNodes
        .filter((node): node is Record<string, any> => Boolean(node && typeof node === "object" && typeof (node as any).id === "string"))
        .map((node) => [String(node.id), node] as const)
    : Object.entries(rawNodes && typeof rawNodes === "object" ? rawNodes : {});

  for (const [fallbackId, rawNode] of nodeEntries) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const nodeRecord = rawNode as Record<string, any>;
    const id = typeof nodeRecord.id === "string" && nodeRecord.id.trim() ? nodeRecord.id : String(fallbackId);
    const kind = normalizeNodeKind(nodeRecord);
    let input = nodeRecord.input && typeof nodeRecord.input === "object" ? { ...nodeRecord.input } : undefined;

    // Older published PBV2 trees sometimes persisted node.key/id without copying
    // input.selectionKey; preserve those products by backfilling the runtime key here.
    if (kind === "question" && input && (!input.selectionKey || typeof input.selectionKey !== "string")) {
      input = { ...input, selectionKey: nodeRecord.key || id };
    }

    normalizedNodes[id] = {
      ...(nodeRecord as any),
      id,
      ...(kind ? { kind } : {}),
      ...(input ? { input } : {}),
    } as OptionNodeV2;
  }

  const rootNodeIds = Array.isArray(treeRecord.rootNodeIds) && treeRecord.rootNodeIds.length > 0
    ? treeRecord.rootNodeIds.filter((nodeId: unknown): nodeId is string => typeof nodeId === "string" && nodeId.trim().length > 0)
    : Object.keys(normalizedNodes);

  if (Object.keys(normalizedNodes).length === 0) {
    if (!isCanonicalEmptyOptionTreeV2(treeRecord)) return null;
    return { ...(treeRecord as any), schemaVersion: 2, rootNodeIds: [], nodes: {}, edges: [] } as OptionTreeV2;
  }

  return {
    ...(treeRecord as any),
    schemaVersion: 2,
    rootNodeIds,
    nodes: normalizedNodes,
    edges: Array.isArray(treeRecord.edges) ? treeRecord.edges : [],
  } as OptionTreeV2;
}

function getNodeValues(tree: unknown): OptionNodeV2[] {
  return Object.values(normalizePbv2Tree(tree)?.nodes ?? {});
}

function isEnabledNode(node: any): boolean {
  const status = typeof node?.status === "string" ? node.status.toUpperCase() : "ENABLED";
  return status !== "DISABLED" && status !== "DELETED";
}

export function summarizePbv2Tree(tree: unknown): Pbv2TreeSummary {
  const nodes = getNodeValues(tree);
  let groupCount = 0;
  let questionCount = 0;
  let choiceCount = 0;
  let renderableControlCount = 0;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const kind = normalizeNodeKind(node as Record<string, any>);
    if (kind === "group") groupCount += 1;
    if (kind === "question" && node.input) {
      questionCount += 1;
      if (isEnabledNode(node) && isRenderablePbv2InputType(String(node.input.type))) {
        renderableControlCount += 1;
      }
    }
    if (Array.isArray(node.choices)) choiceCount += node.choices.length;
  }

  return {
    exists: Boolean(normalizePbv2Tree(tree)),
    groupCount,
    questionCount,
    choiceCount,
    renderableControlCount,
  };
}

/**
 * Determine if a product uses PBV2 (optionTreeJson with schemaVersion 2,
 * OR pbv2ActiveTreeVersionId is set which means it was published via the PBV2 editor).
 */
export function isPbv2Product(product: Product | null | undefined): boolean {
  if (!product) return false;
  
  // Check direct optionTreeJson field
  const optionTreeJson = parseMaybeJson((product as any)?.optionTreeJson);
  if (optionTreeJson && typeof optionTreeJson === "object" && (optionTreeJson as any)?.schemaVersion === 2) {
    return true;
  }

  if (summarizePbv2Tree(optionTreeJson).renderableControlCount > 0) {
    return true;
  }

 // Fallback: pbv2ActiveTreeVersionId means the product was published via PBV2 editor
  if ((product as any)?.pbv2ActiveTreeVersionId) return true;

  // The catalog exposes this only as a safety signal.  It must make Order
  // Entry visibly block: a DRAFT is never substituted into live pricing.
  return !!(product as any)?.pbv2DraftTreeVersionId;
}

/**
 * Extract PBV2 option tree from product
 */
export function getPbv2Tree(product: Product | null | undefined): OptionTreeV2 | null {
  // Normalize any optionTreeJson payload that contains a renderable PBV2 tree.
  // Order entry must render configuration controls from tree data even when the
  // product's PBV2 pricing/published flags are incomplete or temporarily stale.
  // Products with partial PBV2 tree data may now enter the PBV2 renderer sooner;
  // pricing errors remain separate and are surfaced by calculation, not by hiding controls.
  return normalizePbv2Tree((product as any)?.optionTreeJson);
}
