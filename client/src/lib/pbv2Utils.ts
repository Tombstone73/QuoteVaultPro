/**
 * Utility functions for detecting and working with PBV2 (Product Builder V2) products
 */

import type { Product } from "@shared/schema";
import type { OptionTreeV2 } from "@shared/optionTreeV2";

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

function getNodeValues(tree: unknown): any[] {
  const raw = parseMaybeJson(tree);
  if (!raw || typeof raw !== "object") return [];
  const nodes = (raw as any).nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean);
  if (nodes && typeof nodes === "object") return Object.values(nodes).filter(Boolean);
  return [];
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
    if (node.kind === "group") groupCount += 1;
    if (node.kind === "question" && node.input) {
      questionCount += 1;
      if (isEnabledNode(node) && RENDERABLE_INPUT_TYPES.has(String(node.input.type))) {
        renderableControlCount += 1;
      }
    }
    if (Array.isArray(node.choices)) choiceCount += node.choices.length;
  }

  return {
    exists: Boolean(parseMaybeJson(tree) && typeof parseMaybeJson(tree) === "object"),
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

  // Fallback: pbv2ActiveTreeVersionId means the product was published via PBV2 editor
  return !!(product as any)?.pbv2ActiveTreeVersionId;
}

/**
 * Extract PBV2 option tree from product
 */
export function getPbv2Tree(product: Product | null | undefined): OptionTreeV2 | null {
  if (!isPbv2Product(product)) return null;

  const optionTreeJson = parseMaybeJson((product as any)?.optionTreeJson);
  if (!optionTreeJson || typeof optionTreeJson !== "object") return null;

  const summary = summarizePbv2Tree(optionTreeJson);
  if (summary.renderableControlCount === 0) return null;

  return optionTreeJson as OptionTreeV2;
}
