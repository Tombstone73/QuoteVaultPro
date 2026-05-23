import type { ProductOptionPricingMatrix, ProductOptionPricingMatrixRow } from "../productOptionPricingMatrix";
import type { ProductOptionRule } from "../productOptionRules";

export type OptionGroupTemplateValidationError = {
  code: string;
  message: string;
  path?: string;
  ref?: string;
};

export type OptionGroupTemplateTree = {
  schemaVersion?: number;
  templateKind?: "pbv2_option_group_template" | string;
  rootGroupId: string;
  rootNodeIds?: string[];
  nodes: Record<string, any>;
  edges: any[];
  rules?: ProductOptionRule[];
  optionRules?: ProductOptionRule[];
  pricingMatrix?: ProductOptionPricingMatrix;
  meta?: Record<string, unknown>;
};

type TemplateResult<T> =
  | ({ ok: true } & T)
  | { ok: false; errors: OptionGroupTemplateValidationError[] };

const TRUE_CONDITION = { op: "EXISTS", value: { op: "literal", value: true } };
const NODE_ID_FIELDS = new Set(["nodeId", "groupId", "optionId", "sourceNodeId", "fromNodeId", "toNodeId", "rootGroupId"]);
const SELECTION_KEY_FIELDS = new Set(["selectionKey", "optionGroup", "targetOptionGroup"]);

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toNodeRecord(nodes: unknown): Record<string, any> {
  if (Array.isArray(nodes)) {
    return nodes.reduce<Record<string, any>>((acc, node) => {
      if (node?.id) acc[String(node.id)] = node;
      return acc;
    }, {});
  }
  return isRecord(nodes) ? { ...nodes } : {};
}

function toEdgeArray(edges: unknown): any[] {
  return Array.isArray(edges) ? edges.filter(Boolean) : [];
}

function nodeType(node: any): string {
  return String(node?.type ?? node?.kind ?? "").toUpperCase();
}

function isGroupNode(node: any): boolean {
  return nodeType(node) === "GROUP";
}

function getSelectionKey(node: any): string | null {
  const key = node?.input?.selectionKey ?? node?.selectionKey;
  return typeof key === "string" && key.trim() ? key : null;
}

function getRules(tree: any): ProductOptionRule[] {
  return Array.isArray(tree?.rules) ? tree.rules : Array.isArray(tree?.optionRules) ? tree.optionRules : [];
}

function getPricingMatrix(tree: any): ProductOptionPricingMatrix | undefined {
  const candidate = tree?.pricingMatrix ?? tree?.meta?.pricingMatrix;
  if (!isRecord(candidate)) return undefined;
  const dimensions = Array.isArray(candidate.dimensions)
    ? candidate.dimensions.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const rows = Array.isArray(candidate.rows) ? candidate.rows.filter(isRecord) as ProductOptionPricingMatrixRow[] : [];
  if (dimensions.length === 0 && rows.length === 0) return undefined;
  return { id: typeof candidate.id === "string" ? candidate.id : undefined, dimensions, rows };
}

function normalizeTemplateTree(tree: any): OptionGroupTemplateTree {
  const nodes = toNodeRecord(tree?.nodes);
  const rootGroupId =
    typeof tree?.rootGroupId === "string"
      ? tree.rootGroupId
      : Object.values(nodes).find(isGroupNode)?.id ?? "";

  return {
    ...deepClone(tree ?? {}),
    rootGroupId,
    rootNodeIds: Array.isArray(tree?.rootNodeIds) ? [...tree.rootNodeIds] : rootGroupId ? [rootGroupId] : [],
    nodes,
    edges: toEdgeArray(tree?.edges),
    rules: getRules(tree),
    pricingMatrix: getPricingMatrix(tree),
  };
}

function selectionKeysForNodes(nodes: Record<string, any>): Set<string> {
  const keys = new Set<string>();
  for (const node of Object.values(nodes)) {
    const key = getSelectionKey(node);
    if (key) keys.add(key);
  }
  return keys;
}

function collectNodeOutputRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNodeOutputRefs(entry, refs));
    return refs;
  }
  if (!isRecord(value)) return refs;

  if (isRecord(value.nodeOutputRef) && typeof value.nodeOutputRef.nodeId === "string") {
    refs.add(value.nodeOutputRef.nodeId);
  }
  if (typeof value.nodeId === "string") refs.add(value.nodeId);

  for (const child of Object.values(value)) collectNodeOutputRefs(child, refs);
  return refs;
}

function collectSelectionRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSelectionRefs(entry, refs));
    return refs;
  }
  if (!isRecord(value)) return refs;

  const selectionRef = value.selectionRef ?? value.effectiveRef;
  if (isRecord(selectionRef) && typeof selectionRef.selectionKey === "string") {
    refs.add(selectionRef.selectionKey);
  }

  for (const [key, child] of Object.entries(value)) {
    if (SELECTION_KEY_FIELDS.has(key) && typeof child === "string") refs.add(child);
    collectSelectionRefs(child, refs);
  }
  return refs;
}

function collectRuleRefs(rule: ProductOptionRule): Set<string> {
  const refs = new Set<string>();
  const conditions = Array.isArray(rule?.when?.all) ? rule.when.all : Array.isArray(rule?.when?.any) ? rule.when.any : [];
  for (const condition of conditions) {
    if (typeof condition?.optionGroup === "string") refs.add(condition.optionGroup);
  }
  for (const action of [...(rule?.then ?? []), ...(rule?.else ?? [])]) {
    if (typeof action?.targetOptionGroup === "string") refs.add(action.targetOptionGroup);
  }
  return refs;
}

function rowMatch(row: ProductOptionPricingMatrixRow): Record<string, unknown> {
  return row.when ?? row.match ?? row.combination ?? {};
}

function collectMatrixRefs(matrix: ProductOptionPricingMatrix): Set<string> {
  const refs = new Set<string>(matrix.dimensions ?? []);
  for (const row of matrix.rows ?? []) {
    for (const key of Object.keys(rowMatch(row))) refs.add(key);
  }
  return refs;
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  return Array.from(a).some((value) => b.has(value));
}

function pushError(
  errors: OptionGroupTemplateValidationError[],
  code: string,
  message: string,
  path?: string,
  ref?: string,
) {
  errors.push({ code, message, path, ref });
}

export function validateOptionGroupTemplateTree(templateTree: unknown): TemplateResult<{ templateTree: OptionGroupTemplateTree }> {
  const template = normalizeTemplateTree(templateTree);
  const errors: OptionGroupTemplateValidationError[] = [];
  const nodeIds = new Set(Object.keys(template.nodes));
  const root = template.nodes[template.rootGroupId];

  if (!template.rootGroupId || !root) {
    pushError(errors, "MISSING_ROOT_GROUP", "Template tree must contain a root group node.", "rootGroupId");
  } else if (!isGroupNode(root)) {
    pushError(errors, "ROOT_NOT_GROUP", "Template root must be a GROUP node.", `nodes.${template.rootGroupId}`);
  }

  const rootGroups = Object.values(template.nodes).filter(isGroupNode);
  if (rootGroups.length !== 1) {
    pushError(errors, "INVALID_ROOT_GROUP_COUNT", "Template tree must contain exactly one GROUP root.", "nodes");
  }

  for (const edge of template.edges) {
    if (!edge?.id) pushError(errors, "MISSING_EDGE_ID", "Template edge is missing an id.", "edges");
    if (edge?.fromNodeId && !nodeIds.has(edge.fromNodeId)) {
      pushError(errors, "ORPHANED_EDGE", `Edge ${edge.id ?? "(unknown)"} references missing fromNodeId ${edge.fromNodeId}.`, "edges", edge.fromNodeId);
    }
    if (edge?.toNodeId && !nodeIds.has(edge.toNodeId)) {
      pushError(errors, "ORPHANED_EDGE", `Edge ${edge.id ?? "(unknown)"} references missing toNodeId ${edge.toNodeId}.`, "edges", edge.toNodeId);
    }
  }

  const selectionKeys = selectionKeysForNodes(template.nodes);
  for (const [id, node] of Object.entries(template.nodes)) {
    for (const ref of Array.from(collectNodeOutputRefs(node))) {
      if (!nodeIds.has(ref)) {
        pushError(errors, "EXTERNAL_NODE_OUTPUT_REF", `Node ${id} references node ${ref}, which is outside the template subtree.`, `nodes.${id}`, ref);
      }
    }
    for (const ref of Array.from(collectSelectionRefs(node))) {
      if (!selectionKeys.has(ref)) {
        pushError(errors, "EXTERNAL_SELECTION_REFERENCE", `Node ${id} references selection ${ref}, which is outside the template subtree.`, `nodes.${id}`, ref);
      }
    }
  }

  for (const rule of template.rules ?? []) {
    for (const ref of Array.from(collectRuleRefs(rule))) {
      if (!selectionKeys.has(ref)) {
        pushError(errors, "EXTERNAL_RULE_REFERENCE", `Rule ${rule.id ?? "(unknown)"} references selection ${ref}, which is outside the template subtree.`, "rules", ref);
      }
    }
  }

  if (template.pricingMatrix) {
    for (const ref of Array.from(collectMatrixRefs(template.pricingMatrix))) {
      if (!selectionKeys.has(ref)) {
        pushError(errors, "EXTERNAL_MATRIX_REFERENCE", `Pricing matrix references selection ${ref}, which is outside the template subtree.`, "pricingMatrix", ref);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, templateTree: template };
}

export function extractOptionGroupTemplateTree(treeJson: unknown, groupId: string): TemplateResult<{ templateTree: OptionGroupTemplateTree }> {
  const sourceTree = deepClone(treeJson ?? {});
  const sourceNodes = toNodeRecord((sourceTree as any).nodes);
  const sourceEdges = toEdgeArray((sourceTree as any).edges);
  const group = sourceNodes[groupId];
  const errors: OptionGroupTemplateValidationError[] = [];

  if (!group) {
    return { ok: false, errors: [{ code: "GROUP_NOT_FOUND", message: `Option group ${groupId} was not found.`, path: "groupId", ref: groupId }] };
  }
  if (!isGroupNode(group)) {
    return { ok: false, errors: [{ code: "GROUP_NOT_GROUP_NODE", message: `Node ${groupId} is not a PBV2 GROUP node.`, path: `nodes.${groupId}`, ref: groupId }] };
  }

  const included = new Set<string>([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of sourceEdges) {
      const fromIncluded = included.has(edge?.fromNodeId);
      const toIncluded = included.has(edge?.toNodeId);
      if (fromIncluded && edge?.toNodeId && sourceNodes[edge.toNodeId] && !included.has(edge.toNodeId)) {
        included.add(edge.toNodeId);
        changed = true;
      }
      if (fromIncluded || toIncluded) {
        const refs = collectNodeOutputRefs(edge);
        refs.forEach((ref) => {
          if (sourceNodes[ref] && !included.has(ref)) {
            included.add(ref);
            changed = true;
          }
        });
      }
    }
    for (const nodeId of Array.from(included)) {
      for (const ref of Array.from(collectNodeOutputRefs(sourceNodes[nodeId]))) {
        if (sourceNodes[ref] && !included.has(ref)) {
          included.add(ref);
          changed = true;
        }
      }
    }
  }

  const nodes = Array.from(included).reduce<Record<string, any>>((acc, id) => {
    acc[id] = deepClone(sourceNodes[id]);
    return acc;
  }, {});
  const edges = sourceEdges
    .filter((edge) => included.has(edge?.fromNodeId) && included.has(edge?.toNodeId))
    .map((edge) => deepClone(edge));

  const nodeIds = new Set(Object.keys(nodes));
  for (const edge of sourceEdges) {
    const touchesIncluded = included.has(edge?.fromNodeId) || included.has(edge?.toNodeId);
    const fullyIncluded = included.has(edge?.fromNodeId) && included.has(edge?.toNodeId);
    if (touchesIncluded && !fullyIncluded && (edge?.status ?? "ENABLED").toUpperCase() === "ENABLED") {
      pushError(errors, "EXTERNAL_EDGE_REFERENCE", `Runtime edge ${edge.id ?? "(unknown)"} crosses outside the selected group subtree.`, "edges", edge?.toNodeId ?? edge?.fromNodeId);
    }
  }

  const selectionKeys = selectionKeysForNodes(nodes);
  const rules: ProductOptionRule[] = [];
  for (const rule of getRules(sourceTree)) {
    const refs = collectRuleRefs(rule);
    if (!hasIntersection(refs, selectionKeys)) continue;
    for (const ref of Array.from(refs)) {
      if (!selectionKeys.has(ref)) {
        pushError(errors, "EXTERNAL_RULE_REFERENCE", `Rule ${rule.id ?? "(unknown)"} also references external selection ${ref}.`, "rules", ref);
      }
    }
    rules.push(deepClone(rule));
  }

  const sourceMatrix = getPricingMatrix(sourceTree);
  let pricingMatrix: ProductOptionPricingMatrix | undefined;
  if (sourceMatrix) {
    const refs = collectMatrixRefs(sourceMatrix);
    if (hasIntersection(refs, selectionKeys)) {
      for (const ref of Array.from(refs)) {
        if (!selectionKeys.has(ref)) {
          pushError(errors, "EXTERNAL_MATRIX_REFERENCE", `Pricing matrix also references external selection ${ref}.`, "pricingMatrix", ref);
        }
      }
      pricingMatrix = deepClone(sourceMatrix);
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    for (const ref of Array.from(collectNodeOutputRefs(node))) {
      if (!nodeIds.has(ref)) {
        pushError(errors, "EXTERNAL_NODE_OUTPUT_REF", `Node ${id} references external node ${ref}.`, `nodes.${id}`, ref);
      }
    }
    for (const ref of Array.from(collectSelectionRefs(node))) {
      if (!selectionKeys.has(ref)) {
        pushError(errors, "EXTERNAL_SELECTION_REFERENCE", `Node ${id} references external selection ${ref}.`, `nodes.${id}`, ref);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const templateTree: OptionGroupTemplateTree = {
    schemaVersion: 2,
    templateKind: "pbv2_option_group_template",
    rootGroupId: groupId,
    rootNodeIds: [groupId],
    nodes,
    edges,
    rules,
    ...(pricingMatrix ? { pricingMatrix } : {}),
    meta: {
      extractedFromTreeSchemaVersion: (sourceTree as any)?.schemaVersion,
    },
  };

  return validateOptionGroupTemplateTree(templateTree);
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "import";
}

function makeImportId(options?: { importInstanceId?: string }): string {
  if (options?.importInstanceId?.trim()) return safeIdPart(options.importInstanceId.trim());
  const random = Math.random().toString(36).slice(2, 9);
  return safeIdPart(`import_${Date.now().toString(36)}_${random}`);
}

function uniqueValue(base: string, used: Set<string>): string {
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${i++}`;
  }
  used.add(candidate);
  return candidate;
}

function rewriteDeep(value: unknown, maps: { nodeIds: Map<string, string>; selectionKeys: Map<string, string> }): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewriteDeep(entry, maps));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (NODE_ID_FIELDS.has(key) && typeof child === "string" && maps.nodeIds.has(child)) {
      out[key] = maps.nodeIds.get(child);
      continue;
    }
    if (SELECTION_KEY_FIELDS.has(key) && typeof child === "string" && maps.selectionKeys.has(child)) {
      out[key] = maps.selectionKeys.get(child);
      continue;
    }
    if (key === "dimensions" && Array.isArray(child)) {
      out[key] = child.map((entry) => typeof entry === "string" ? maps.selectionKeys.get(entry) ?? entry : rewriteDeep(entry, maps));
      continue;
    }
    if ((key === "when" || key === "match" || key === "combination") && isRecord(child)) {
      out[key] = Object.entries(child).reduce<Record<string, unknown>>((acc, [matchKey, matchValue]) => {
        acc[maps.selectionKeys.get(matchKey) ?? matchKey] = rewriteDeep(matchValue, maps);
        return acc;
      }, {});
      continue;
    }
    out[key] = rewriteDeep(child, maps);
  }
  return out;
}

function mergePricingMatrix(
  currentMatrix: ProductOptionPricingMatrix | undefined,
  clonedMatrix: ProductOptionPricingMatrix | undefined,
): TemplateResult<{ pricingMatrix?: ProductOptionPricingMatrix; pricingMatrixFragments?: ProductOptionPricingMatrix[] }> {
  if (!clonedMatrix) return { ok: true, pricingMatrix: currentMatrix };
  if (!currentMatrix || ((currentMatrix.dimensions?.length ?? 0) === 0 && (currentMatrix.rows?.length ?? 0) === 0)) {
    return { ok: true, pricingMatrix: clonedMatrix };
  }

  const currentDims = currentMatrix.dimensions ?? [];
  const clonedDims = clonedMatrix.dimensions ?? [];
  const sameDims = currentDims.length === clonedDims.length && currentDims.every((dim, index) => dim === clonedDims[index]);
  if (!sameDims) {
    return { ok: true, pricingMatrix: currentMatrix, pricingMatrixFragments: [clonedMatrix] };
  }

  return {
    ok: true,
    pricingMatrix: {
      ...currentMatrix,
      rows: [...(currentMatrix.rows ?? []), ...(clonedMatrix.rows ?? [])],
    },
  };
}

export function cloneTemplateIntoTree(
  currentTree: unknown,
  templateTree: unknown,
  options?: { importInstanceId?: string; sourceTemplateId?: string },
): TemplateResult<{
  tree: any;
  importedGroupId: string;
  idMap: Record<string, string>;
  selectionKeyMap: Record<string, string>;
}> {
  const validation = validateOptionGroupTemplateTree(templateTree);
  if (!validation.ok) return validation;

  const current = deepClone(currentTree ?? {});
  const currentNodes = toNodeRecord((current as any).nodes);
  const currentEdges = toEdgeArray((current as any).edges);
  const template = validation.templateTree;
  const importId = makeImportId(options);
  const usedNodeIds = new Set(Object.keys(currentNodes));
  const usedEdgeIds = new Set(currentEdges.map((edge) => edge?.id).filter(Boolean));
  const usedRuleIds = new Set(getRules(current).map((rule) => rule?.id).filter(Boolean));
  const usedSelectionKeys = selectionKeysForNodes(currentNodes);
  const usedMatrixRowIds = new Set((getPricingMatrix(current)?.rows ?? []).map((row) => row?.id).filter(Boolean) as string[]);

  const nodeIdMap = new Map<string, string>();
  for (const oldId of Object.keys(template.nodes)) {
    nodeIdMap.set(oldId, uniqueValue(`tpl_${importId}_${safeIdPart(oldId)}`, usedNodeIds));
  }

  const selectionKeyMap = new Map<string, string>();
  for (const node of Object.values(template.nodes)) {
    const key = getSelectionKey(node);
    if (key) selectionKeyMap.set(key, uniqueValue(`${key}__${importId}`, usedSelectionKeys));
  }

  const maps = { nodeIds: nodeIdMap, selectionKeys: selectionKeyMap };
  const clonedNodes: Record<string, any> = {};
  for (const [oldId, node] of Object.entries(template.nodes)) {
    const rewritten = rewriteDeep(node, maps) as any;
    const newId = nodeIdMap.get(oldId)!;
    rewritten.id = newId;
    if (rewritten.input?.selectionKey && selectionKeyMap.has(node.input?.selectionKey)) {
      rewritten.input = { ...rewritten.input, selectionKey: selectionKeyMap.get(node.input.selectionKey) };
    }
    if (selectionKeyMap.has(node?.key)) rewritten.key = selectionKeyMap.get(node.key);
    rewritten.meta = {
      ...(isRecord(rewritten.meta) ? rewritten.meta : {}),
      templateSource: {
        sourceTemplateId: options?.sourceTemplateId,
        importInstanceId: importId,
      },
    };
    clonedNodes[newId] = rewritten;
  }

  const clonedEdges = template.edges.map((edge) => {
    const rewritten = rewriteDeep(edge, maps) as any;
    rewritten.id = uniqueValue(`edge_${importId}_${safeIdPart(String(edge.id ?? "edge"))}`, usedEdgeIds);
    rewritten.condition = rewritten.condition ?? TRUE_CONDITION;
    return rewritten;
  });

  const clonedRules = (template.rules ?? []).map((rule) => {
    const rewritten = rewriteDeep(rule, maps) as ProductOptionRule;
    rewritten.id = uniqueValue(`rule_${importId}_${safeIdPart(String(rule.id ?? "rule"))}`, usedRuleIds);
    return rewritten;
  });

  const clonedPricingMatrix = template.pricingMatrix
    ? rewriteDeep(template.pricingMatrix, maps) as ProductOptionPricingMatrix
    : undefined;
  if (clonedPricingMatrix) {
    clonedPricingMatrix.id = clonedPricingMatrix.id
      ? uniqueValue(`matrix_${importId}_${safeIdPart(clonedPricingMatrix.id)}`, new Set<string>())
      : `matrix_${importId}`;
    clonedPricingMatrix.rows = (clonedPricingMatrix.rows ?? []).map((row) => ({
      ...row,
      id: uniqueValue(`matrix_row_${importId}_${safeIdPart(String(row.id ?? "row"))}`, usedMatrixRowIds),
    }));
  }

  const currentMatrix = getPricingMatrix(current);
  const matrixMerge = mergePricingMatrix(currentMatrix, clonedPricingMatrix);
  if (!matrixMerge.ok) return matrixMerge;

  const mergedTree: any = {
    ...current,
    schemaVersion: (current as any)?.schemaVersion ?? 2,
    status: (current as any)?.status ?? "DRAFT",
    nodes: { ...currentNodes, ...clonedNodes },
    edges: [...currentEdges, ...clonedEdges],
    rules: [...getRules(current), ...clonedRules],
  };

  const incomingRuntimeNodeIds = new Set(
    mergedTree.edges
      .filter((edge: any) => String(edge?.status ?? "ENABLED").toUpperCase() === "ENABLED")
      .map((edge: any) => edge?.toNodeId)
      .filter(Boolean),
  );
  mergedTree.rootNodeIds = Object.values(mergedTree.nodes)
    .filter((node: any) => node?.id && !isGroupNode(node) && String(node?.status ?? "ENABLED").toUpperCase() === "ENABLED")
    .map((node: any) => node.id)
    .filter((id: string) => !incomingRuntimeNodeIds.has(id));

  if (matrixMerge.pricingMatrix) {
    mergedTree.pricingMatrix = matrixMerge.pricingMatrix;
    if (isRecord(mergedTree.meta)) {
      mergedTree.meta = { ...mergedTree.meta, pricingMatrix: matrixMerge.pricingMatrix };
    }
  }
  if (matrixMerge.pricingMatrixFragments?.length) {
    const existingFragments = Array.isArray(mergedTree.meta?.templatePricingMatrixFragments)
      ? mergedTree.meta.templatePricingMatrixFragments
      : [];
    mergedTree.meta = {
      ...(isRecord(mergedTree.meta) ? mergedTree.meta : {}),
      templatePricingMatrixFragments: [...existingFragments, ...matrixMerge.pricingMatrixFragments],
    };
  }

  return {
    ok: true,
    tree: mergedTree,
    importedGroupId: nodeIdMap.get(template.rootGroupId)!,
    idMap: Object.fromEntries(nodeIdMap),
    selectionKeyMap: Object.fromEntries(selectionKeyMap),
  };
}
