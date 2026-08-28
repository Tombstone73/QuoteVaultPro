/**
 * PBV2 View Model Adapter
 * 
 * Converts PBV2 tree JSON (nodes/edges) to/from the Figma UI editor model.
 * This layer maintains the PBV2 tree as the source of truth while providing
 * a simpler interface for the UI components.
 * 
 * CRITICAL RULES:
 * - All edits return patches to apply to treeJson, not direct mutations
 * - Preserve node/edge IDs and ordering
 * - Avoid orphan states (no option without group container)
 * - Keep all edits local until "Save Draft" is called
 */

import type { ChoiceMaterialOverride, ChoicePricingOverride, OptionNodeV2, PricingImpact, VisibilityRule } from '@shared/optionTreeV2';
import { synchronizeChoiceInventoryConsumptionMaterial } from '@shared/pbv2/materialAuthority';
import { normalizeLegacyPricingImpact } from './pricing/pricingImpact';

/**
 * CANONICAL PBV2 GRAPH RULES (enforced by normalizeTreeJson):
 * 
 * A) GROUP nodes are structural only:
 *    - They may have structural containment edges (GROUP -> OPTION/INPUT).
 *    - GROUP nodes may NEVER be runtime roots.
 *    - GROUP nodes may NEVER participate in ENABLED runtime edges.
 * 
 * B) Edges:
 *    - Structural containment edges:
 *      - Must be status DISABLED.
 *      - Must NOT have conditionRule AST.
 *      - If present, their condition/conditionRule fields are removed on normalize.
 *    - Runtime edges:
 *      - status ENABLED
 *      - Must have a valid condition AST object if schema requires it.
 *      - Must NOT connect FROM or TO GROUP nodes.
 * 
 * C) rootNodeIds:
 *    - Must include at least one ENABLED runtime node.
 *    - Must NOT include GROUP nodes.
 *    - Derived from runtime graph roots: ENABLED nodes with no incoming ENABLED edges.
 *    - Structural edges do not affect runtime roots.
 */

/**
 * TRUE condition AST - always evaluates to true.
 * Used as default for ENABLED edges that don't have a condition.
 * Follows PBV2 ConditionRule schema from shared/pbv2/expressionSpec.ts
 */
export const TRUE_CONDITION = { op: "EXISTS", value: { op: "literal", value: true } } as const;

/**
 * Check if a value is a valid condition AST object.
 * Minimal validation - just checks if it has the expected shape.
 */
function isValidConditionAst(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as any;
  // Must have an op field that's a string
  if (typeof obj.op !== 'string') return false;
  // Valid condition ops: AND, OR, NOT, EXISTS, EQ, NEQ, GT, GTE, LT, LTE, IN
  const validOps = ['AND', 'OR', 'NOT', 'EXISTS', 'EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN'];
  return validOps.includes(obj.op.toUpperCase());
}

/**
 * Ensure rootNodeIds is populated with RUNTIME roots only (ENABLED non-GROUP nodes with no incoming ENABLED edges).
 * This function enforces canonical rule C: rootNodeIds must be runtime roots, never GROUP.
 * 
 * @param treeJson - PBV2 tree object
 * @returns Updated tree with rootNodeIds set (immutable)
 */
export function ensureRootNodeIds(treeJson: any): any {
  if (!treeJson || typeof treeJson !== 'object') return treeJson;
  
  const nodesRaw = treeJson.nodes || {};
  const nodes = Array.isArray(nodesRaw) ? nodesRaw : Object.values(nodesRaw);
  const nodeIds = nodes.map((n: any) => n?.id).filter(Boolean);
  
  // If no nodes, return as-is
  if (nodeIds.length === 0) return treeJson;
  
  // Build runtime graph: ENABLED edges only
  const edges = Array.isArray(treeJson.edges) ? treeJson.edges : [];
  const runtimeEdges = edges.filter((e: any) => 
    e && (e.status || 'ENABLED').toUpperCase() === 'ENABLED'
  );
  
  // Nodes pointed to by ENABLED edges
  const runtimeToIds = new Set(
    runtimeEdges.map((e: any) => e?.toNodeId).filter(Boolean)
  );
  
  // Runtime roots: ENABLED non-GROUP nodes with no incoming ENABLED edges
  const runtimeRoots = nodes
    .filter((n: any) => {
      if (!n || !n.id) return false;
      const status = (n.status || 'ENABLED').toUpperCase();
      if (status !== 'ENABLED') return false;
      const type = (n.type || '').toUpperCase();
      if (type === 'GROUP') return false; // NEVER include GROUP in roots
      return !runtimeToIds.has(n.id);
    })
    .map((n: any) => n.id);
  
  // If no runtime roots found, fall back to any ENABLED non-GROUP node
  let finalRoots = runtimeRoots;
  if (finalRoots.length === 0) {
    finalRoots = nodes
      .filter((n: any) => {
        if (!n || !n.id) return false;
        const status = (n.status || 'ENABLED').toUpperCase();
        if (status !== 'ENABLED') return false;
        const type = (n.type || '').toUpperCase();
        return type !== 'GROUP';
      })
      .map((n: any) => n.id);
  }
  
  // Return updated tree with rootNodeIds set (immutable)
  return {
    ...treeJson,
    rootNodeIds: finalRoots,
  };
}

/**
 * Normalize PBV2 tree JSON to enforce canonical graph rules.
 * This function repairs tree data loaded from server/storage/mutations.
 * 
 * CANONICAL RULES ENFORCED:
 * A) GROUP nodes are structural only - no runtime participation
 * B) Structural edges (GROUP-involved) must be DISABLED, no conditionRule
 * C) Runtime edges must be ENABLED and may have conditionRule
 * D) rootNodeIds must be runtime roots only (ENABLED non-GROUP nodes)
 * 
 * WHEN TO CALL:
 * - After loading tree from server GET /pbv2/tree
 * - After local initialization
 * - After any mutation patch is applied
 * - Before validation/save
 * 
 * @param treeJson - Raw tree JSON (may have old/incorrect structure)
 * @returns Normalized tree with canonical rules enforced
 */
export function normalizeTreeJson(treeJson: any): any {
  if (!treeJson || typeof treeJson !== 'object') return treeJson;

  const nodesRaw = treeJson.nodes || {};
  const nodes = Array.isArray(nodesRaw) ? nodesRaw : Object.values(nodesRaw);
  const edgesRaw = treeJson.edges || [];
  const edges = Array.isArray(edgesRaw) ? edgesRaw : [];

  // Build node type map
  const nodeTypeById = new Map<string, string>();
  nodes.forEach((n: any) => {
    if (n && n.id) {
      nodeTypeById.set(n.id, (n.type || '').toUpperCase());
    }
  });

  // Build set of all valid node IDs for dangling reference cleanup
  const validNodeIds = new Set<string>();
  nodes.forEach((n: any) => {
    if (n && n.id) validNodeIds.add(n.id);
  });

  // Remove dangling edges (edges referencing nodes that no longer exist)
  const liveEdges = edges.filter((edge: any) => {
    if (!edge) return false;
    const fromOk = !edge.fromNodeId || validNodeIds.has(edge.fromNodeId);
    const toOk = !edge.toNodeId || validNodeIds.has(edge.toNodeId);
    return fromOk && toOk;
  });

  // Normalize edges according to rules A/B
  let normalizedEdges = liveEdges.map((edge: any) => {
    if (!edge || !edge.id) return edge;

    const fromType = edge.fromNodeId ? nodeTypeById.get(edge.fromNodeId) : null;
    const toType = edge.toNodeId ? nodeTypeById.get(edge.toNodeId) : null;
    const status = (edge.status || 'ENABLED').toUpperCase();

    // Rule A: GROUP nodes are structural only
    // If edge connects FROM or TO a GROUP, force it to be structural (DISABLED, no condition)
    if (fromType === 'GROUP' || toType === 'GROUP') {
      const normalized = { ...edge };
      normalized.status = 'DISABLED';
      // Validator requires ALL edges to have valid condition AST (even DISABLED)
      // Set to TRUE_CONDITION to satisfy validator
      if (!isValidConditionAst(edge.condition)) {
        normalized.condition = TRUE_CONDITION;
      }
      return normalized;
    }

    // Rule B: For DISABLED edges, ensure valid condition (validator checks all edges)
    if (status === 'DISABLED' || status === 'DELETED') {
      const normalized = { ...edge };
      // Validator requires condition AST even for DISABLED edges
      if (!isValidConditionAst(edge.condition)) {
        normalized.condition = TRUE_CONDITION;
      }
      return normalized;
    }

    // Rule B: Runtime edges (ENABLED) must have valid condition
    if (status === 'ENABLED') {
      const normalized = { ...edge };
      // If condition is missing or invalid, set to TRUE_CONDITION
      if (!isValidConditionAst(edge.condition)) {
        normalized.condition = TRUE_CONDITION;
      }
      return normalized;
    }

    // Unknown status - ensure valid condition
    const normalized = { ...edge };
    if (!isValidConditionAst(edge.condition)) {
      normalized.condition = TRUE_CONDITION;
    }
    return normalized;
  });

  // Normalize nodes: ensure OPTION nodes have required fields
  let normalizedNodes = nodes.map((node: any) => {
    if (!node || !node.id) return node;

    const type = (node.type || '').toUpperCase();
    if (type === 'OPTION' || (node.kind || '').toUpperCase() === 'QUESTION') {
      // Ensure input.selectionKey exists
      const normalized = { ...node };
      normalized.input = normalized.input || {};
      if (!normalized.input.selectionKey || typeof normalized.input.selectionKey !== 'string') {
        normalized.input.selectionKey = `opt_${node.id}`;
      }
      return normalized;
    }

    return node;
  });

  // Auto-repair GROUP displayOrder: groups lacking displayOrder get sequential values appended
  // after the max existing value. Without this, sortPbv2NodeIdsByBuilderOrder falls back to
  // a JSONB-iteration-order-dependent value that is non-deterministic after DB round-trips.
  {
    const groupsWithOrder = normalizedNodes.filter(
      (n: any) => n && (n.type || '').toUpperCase() === 'GROUP' && typeof n.displayOrder === 'number'
    );
    const groupsWithoutOrder = normalizedNodes.filter(
      (n: any) => n && (n.type || '').toUpperCase() === 'GROUP' && typeof n.displayOrder !== 'number'
    );
    if (groupsWithoutOrder.length > 0) {
      const maxExisting = groupsWithOrder.reduce(
        (max: number, n: any) => Math.max(max, n.displayOrder as number),
        -1
      );
      let next = maxExisting + 1;
      const orderUpdates = new Map<string, number>(
        groupsWithoutOrder.map((n: any) => [n.id, next++])
      );
      normalizedNodes = normalizedNodes.map((n: any) => {
        if (!n?.id || (n.type || '').toUpperCase() !== 'GROUP') return n;
        const newOrder = orderUpdates.get(n.id);
        if (newOrder === undefined) return n;
        return { ...n, displayOrder: newOrder, ui: { ...(n.ui || {}), sortOrder: newOrder } };
      });
    }
  }

  // Some imported/published runtime trees have valid INPUT roots but no
  // structural GROUP layer. The runtime can price those, but the Product
  // Builder sidebar and preview need a TEMP draft group to expose the options.
  const liveGroups = normalizedNodes.filter((n: any) => {
    const status = (n?.status || 'ENABLED').toUpperCase();
    return status !== 'DELETED' && (n?.type || '').toUpperCase() === 'GROUP';
  });
  const liveInputNodes = normalizedNodes.filter((n: any) => {
    const status = (n?.status || 'ENABLED').toUpperCase();
    const type = (n?.type || '').toUpperCase();
    const kind = (n?.kind || '').toUpperCase();
    return status !== 'DELETED' && (type === 'INPUT' || kind === 'QUESTION');
  });
  if (liveGroups.length === 0 && liveInputNodes.length > 0) {
    const existingIds = new Set<string>([
      ...normalizedNodes.map((n: any) => String(n?.id || '')).filter(Boolean),
      ...normalizedEdges.map((e: any) => String(e?.id || '')).filter(Boolean),
    ]);
    let groupId = 'group_options';
    let suffix = 1;
    while (existingIds.has(groupId)) groupId = `group_options_${suffix++}`;

    normalizedNodes = [
      {
        id: groupId,
        kind: 'group',
        type: 'GROUP',
        status: 'ENABLED',
        key: groupId,
        label: 'Options',
        displayOrder: 0,
        ui: { sortOrder: 0 },
      },
      ...normalizedNodes,
    ];

    normalizedEdges = [
      ...normalizedEdges,
      ...liveInputNodes.map((node: any, index: number) => ({
        id: existingIds.has(`edge_${groupId}_${node.id}`) ? `edge_${groupId}_${node.id}_${index}` : `edge_${groupId}_${node.id}`,
        status: 'DISABLED',
        fromNodeId: groupId,
        toNodeId: node.id,
        priority: index,
        condition: TRUE_CONDITION,
      })),
    ];
  }

  // Reconstruct tree with normalized data
  let normalizedTree: any;
  if (Array.isArray(nodesRaw)) {
    normalizedTree = {
      ...treeJson,
      nodes: normalizedNodes,
      edges: normalizedEdges,
    };
  } else {
    // Convert back to Record format
    const nodesRecord: Record<string, any> = {};
    normalizedNodes.forEach((n: any) => {
      if (n && n.id) nodesRecord[n.id] = n;
    });
    normalizedTree = {
      ...treeJson,
      nodes: nodesRecord,
      edges: normalizedEdges,
    };
  }

  // Clean dangling rootNodeIds before recomputing
  if (Array.isArray(normalizedTree.rootNodeIds)) {
    normalizedTree = {
      ...normalizedTree,
      rootNodeIds: normalizedTree.rootNodeIds.filter((id: string) => validNodeIds.has(id)),
    };
  }

  // Force status to DRAFT: the builder always operates on a draft. When the
  // initialization effect loads from an ACTIVE tree (no draft exists after
  // auto_on_save), the treeJson content carries status:'ACTIVE'. If that leaks
  // into the saved payload, validateTreeForPublish fails with
  // PBV2_E_TREE_STATUS_INVALID and blocks both auto-activation and manual
  // publish — silently leaving the old active tree in place.
  normalizedTree = { ...normalizedTree, status: 'DRAFT' };

  // Rule C: Recompute rootNodeIds using runtime-only logic
  return ensureRootNodeIds(normalizedTree);
}

export type EditorOptionGroup = {
  id: string; // Node ID in PBV2 tree
  name: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  isMultiSelect: boolean;
  optionIds: string[]; // Child node IDs
  visibilityRules?: VisibilityRule[];
};

export type EditorOption = {
  id: string; // Node ID in PBV2 tree
  name: string;
  description: string;
  type: 'radio' | 'checkbox' | 'dropdown' | 'numeric' | 'dimension' | 'text' | 'textarea';
  enabled: boolean;
  sortOrder: number;
  isDefault: boolean;
  isRequired: boolean;
  selectionKey: string;
  // Derived indicators
  hasPricing: boolean;
  hasProductionFlags: boolean;
  hasConditionals: boolean;
  hasWeight: boolean; // Only if weight data exists in PBV2
};

export type EditorModel = {
  productMeta: {
    name: string;
    category: string;
    sku: string;
    status: 'draft' | 'active' | 'archived';
    fulfillment: 'pickup-only' | 'shippable-estimate' | 'shippable-manual-quote';
    basePrice: number;
  };
  groups: EditorOptionGroup[];
  options: Record<string, EditorOption>; // Keyed by option node ID
  tags: {
    // Group-level indicators
    groupPricing: Set<string>; // Group IDs with pricing
    groupProduction: Set<string>; // Group IDs with production flags
    groupConditionals: Set<string>; // Group IDs with conditionals
  };
};

type PBV2Node = {
  id: string;
  kind?: "question" | "group" | "computed";
  type?: string;
  status?: string;
  key?: string;
  input?: {
    type?: "boolean" | "select" | "multiselect" | "number" | "text" | "textarea" | "file" | "dimension";
    required?: boolean;
    defaultValue?: any;
    constraints?: any;
  };
  label?: string;
  description?: string;
  choices?: Array<{
    value: string;
    label: string;
    description?: string;
    sortOrder?: number;
    weightOz?: number;
    priceDeltaCents?: number;
    pricingOverride?: ChoicePricingOverride;
    materialOverride?: ChoiceMaterialOverride;
    workflowTags?: string[];
    inventoryConsumption?: Array<{ materialId: string; quantityBasis: "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed"; multiplier: number; wastePercent?: number; fixedQty?: number }>;
  }>;
  data?: any;
  priceComponents?: any[];
  pricingImpact?: any[];
  weightImpact?: any[];
  materialEffects?: any[];
  [key: string]: any;
};

type PBV2Edge = {
  id: string;
  status?: string;
  fromNodeId?: string;
  toNodeId?: string;
  priority?: number;
  condition?: any;
  [key: string]: any;
};

type PBV2TreeJson = {
  status?: string;
  rootNodeIds?: string[];
  nodes?: PBV2Node[];
  edges?: PBV2Edge[];
  [key: string]: any;
};

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  return value as any;
}

function normalizeArrays(treeRaw: any): { tree: any; nodes: PBV2Node[]; edges: PBV2Edge[] } {
  const t = asRecord(treeRaw) ? { ...(treeRaw as any) } : {};

  const nodesRaw = (t as any).nodes;
  let nodes: PBV2Node[] = [];
  if (Array.isArray(nodesRaw)) {
    nodes = nodesRaw.slice();
  } else {
    const m = asRecord(nodesRaw);
    if (m) {
      nodes = Object.entries(m).map(([k, v]) => {
        const rec = asRecord(v) ?? {};
        return { id: rec.id ?? k, ...rec };
      });
    }
  }

  const edgesRaw = (t as any).edges;
  let edges: PBV2Edge[] = [];
  if (Array.isArray(edgesRaw)) {
    edges = edgesRaw.slice();
  } else {
    const m = asRecord(edgesRaw);
    if (m) {
      edges = Object.entries(m).map(([k, v]) => {
        const rec = asRecord(v) ?? {};
        return { id: rec.id ?? rec.edgeId ?? k, ...rec };
      });
    }
  }

  t.nodes = nodes;
  t.edges = edges;
  return { tree: t, nodes, edges };
}

/**
 * Convert nodes/edges arrays back to Record format for OptionTreeV2 schema compliance
 */
function arraysToRecords(nodes: PBV2Node[], edges: PBV2Edge[]): { nodes: Record<string, PBV2Node>; edges: PBV2Edge[] } {
  const nodesRecord: Record<string, PBV2Node> = {};
  for (const node of nodes) {
    nodesRecord[node.id] = node;
  }
  return { nodes: nodesRecord, edges };
}

/**
 * Convert PBV2 tree JSON to editor model for UI rendering
 */
export function pbv2TreeToEditorModel(treeJson: unknown): EditorModel {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Identify group nodes: ALL nodes with type=GROUP (structural layer)
  // Do NOT filter by rootNodeIds or edges - groups are structural metadata
  const groupNodes = nodes
    .filter(n => n.type?.toUpperCase() === 'GROUP')
    .sort((a, b) => {
      const aOrder = typeof (a as any).displayOrder === 'number' ? (a as any).displayOrder : Infinity;
      const bOrder = typeof (b as any).displayOrder === 'number' ? (b as any).displayOrder : Infinity;
      return aOrder - bOrder;
    });

  // Build groups
  const groups: EditorOptionGroup[] = groupNodes.map((node, index) => {
    const childEdges = edges.filter(e => e.fromNodeId === node.id && e.status !== 'DELETED');
    const optionIds = childEdges.map(e => e.toNodeId).filter(Boolean) as string[];

    return {
      id: node.id,
      name: node.label || node.key || node.id,
      description: node.description || '',
      sortOrder: index,
      isRequired: node.input?.required || false,
      isMultiSelect: node.input?.type === 'multiselect',
      optionIds,
      visibilityRules: Array.isArray((node as any).visibility?.rules) ? (node as any).visibility.rules : undefined,
    };
  });

  // Build options map
  const options: Record<string, EditorOption> = {};
  const optionNodeIds = new Set(groups.flatMap(g => g.optionIds));

  nodes.forEach((node, index) => {
    if (!optionNodeIds.has(node.id)) return;

    const selectionKey = node.key || node.id;
    const hasNodePricing = Array.isArray(node.pricingImpact) && node.pricingImpact.length > 0;
    const hasChoicePricing = Array.isArray(node.choices)
      && node.choices.some((choice: any) => Array.isArray(choice?.pricingImpact) && choice.pricingImpact.length > 0);
    const hasPricing = hasNodePricing || hasChoicePricing;
    const hasProductionFlags = Array.isArray(node.materialEffects) && node.materialEffects.length > 0;
    const hasConditionals = edges.some(e => e.fromNodeId === node.id && e.condition);
    const hasWeight = Array.isArray(node.weightImpact) && node.weightImpact.length > 0;

    let optionType: EditorOption['type'] = 'radio';
    const inputType = node.input?.type;
    if (inputType === 'number') optionType = 'numeric';
    else if (inputType === 'boolean') optionType = 'checkbox';
    else if (inputType === 'select') optionType = 'dropdown';
    else if (inputType === 'dimension') optionType = 'dimension';
    else if (inputType === 'text') optionType = 'text';
    else if (inputType === 'textarea') optionType = 'textarea';

    options[node.id] = {
      id: node.id,
      name: node.label || selectionKey,
      description: node.description || '',
      type: optionType,
      enabled: String(node.status || 'ENABLED').toUpperCase() !== 'DISABLED',
      sortOrder: index,
      isDefault: node.input?.defaultValue !== undefined,
      isRequired: node.input?.required || false,
      selectionKey,
      hasPricing,
      hasProductionFlags,
      hasConditionals,
      hasWeight,
    };
  });

  // Build tags
  const tags = {
    groupPricing: new Set<string>(),
    groupProduction: new Set<string>(),
    groupConditionals: new Set<string>(),
  };

  groups.forEach(group => {
    const hasGroupPricing = group.optionIds.some(id => options[id]?.hasPricing);
    const hasGroupProduction = group.optionIds.some(id => options[id]?.hasProductionFlags);
    const hasGroupConditionals = group.optionIds.some(id => options[id]?.hasConditionals);

    if (hasGroupPricing) tags.groupPricing.add(group.id);
    if (hasGroupProduction) tags.groupProduction.add(group.id);
    if (hasGroupConditionals) tags.groupConditionals.add(group.id);
  });

  return {
    productMeta: {
      name: (tree as any).productName || 'Untitled Product',
      category: (tree as any).category || 'General',
      sku: (tree as any).sku || '',
      status: (tree as any).status?.toLowerCase() || 'draft',
      fulfillment: (tree as any).fulfillment || 'pickup-only',
      basePrice: (tree as any).basePrice || 0,
    },
    groups,
    options,
    tags,
  };
}

/**
 * Generate a new unique ID for nodes/edges
 */
function makeId(prefix: string, existingIds: Set<string>): string {
  const cryptoAny = (globalThis as any).crypto;
  for (let i = 0; i < 25; i++) {
    const suffix =
      typeof cryptoAny?.randomUUID === "function"
        ? cryptoAny.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const id = `${prefix}${suffix}`;
    if (!existingIds.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

/**
 * Create patch to add a new option group
 */
export function createAddGroupPatch(treeJson: unknown): { patch: any; newGroupId: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  const existingIds = new Set([...nodes.map(n => n.id), ...edges.map(e => e.id)]);

  const newGroupId = makeId('group_', existingIds);
  const selectionKey = `group_${Date.now()}`;

  const groupNodes = nodes.filter(n => (n.type || '').toUpperCase() === 'GROUP');
  const maxDisplayOrder = groupNodes.reduce((max, n) => {
    const d = typeof (n as any).displayOrder === 'number' ? (n as any).displayOrder : -1;
    return Math.max(max, d);
  }, -1);
  const newDisplayOrder = maxDisplayOrder + 1;

  const newNode: PBV2Node = {
    id: newGroupId,
    kind: 'group',
    type: 'GROUP',
    status: 'ENABLED',
    key: selectionKey,
    label: 'New Group',
    description: '',
    input: {
      type: 'select',
      required: false,
    },
    displayOrder: newDisplayOrder,
    ui: { sortOrder: newDisplayOrder },
  } as any;

  // Do NOT add GROUP to rootNodeIds - groups are structural only
  // normalizeTreeJson will compute runtime roots correctly

  const patchedTree = {
    ...tree,
    nodes: [...nodes, newNode],
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
    newGroupId,
  };
}

/**
 * Create patch to update a group
 */
export function createUpdateGroupPatch(
  treeJson: unknown,
  groupId: string,
  updates: Partial<Pick<EditorOptionGroup, 'name' | 'description' | 'isRequired' | 'isMultiSelect' | 'visibilityRules'>>
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== groupId) return n;

    const updated = { ...n };
    if (updates.name !== undefined) updated.label = updates.name;
    if (updates.description !== undefined) updated.description = updates.description;
    if (updates.isRequired !== undefined) {
      updated.input = {
        type: updated.input?.type ?? 'select',
        ...(updated.input ?? {}),
        required: updates.isRequired,
      };
    }
    if (updates.isMultiSelect !== undefined) {
      updated.input = {
        ...(updated.input ?? {}),
        required: updated.input?.required ?? false,
        type: updates.isMultiSelect ? 'multiselect' : 'select',
      };
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'visibilityRules')) {
      const nextRules = updates.visibilityRules;
      const existingVisibility = typeof updated.visibility === 'object' && updated.visibility ? updated.visibility : {};
      if (!nextRules || nextRules.length === 0) {
        if (existingVisibility && Object.prototype.hasOwnProperty.call(existingVisibility, 'rules')) {
          const { rules: _rules, ...restVisibility } = existingVisibility as any;
          updated.visibility = Object.keys(restVisibility).length > 0 ? restVisibility : undefined;
        } else {
          updated.visibility = Object.keys(existingVisibility).length > 0 ? existingVisibility : undefined;
        }
      } else {
        updated.visibility = {
          ...existingVisibility,
          rules: nextRules,
        };
      }
    }

    return updated;
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Hard delete nodes from tree with cascade logic.
 * Physically removes nodes + all related edges + root references.
 * No more status:"DELETED" zombies.
 * 
 * CASCADE RULES:
 * - Deleting a GROUP: delete group + all child OPTIONs + all child CHOICEs
 * - Deleting an OPTION: delete option + all child CHOICEs (via edges)
 * - Deleting a CHOICE: delete only that choice (handled separately in node.choices array)
 * 
 * @param treeJson - Current tree
 * @param nodeIdsToDelete - IDs of nodes to delete (non-cascaded set)
 * @returns Patch with nodes/edges physically removed
 */
export function createHardDeletePatch(
  treeJson: unknown,
  nodeIdsToDelete: string[]
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Step 1: Collect all node IDs to delete (with cascade)
  const toDelete = new Set<string>(nodeIdsToDelete);
  const nodesById = new Map(nodes.map(n => [n.id, n]));

  // Build edge lookup: parent -> children
  const childrenMap = new Map<string, Set<string>>();
  edges.forEach(edge => {
    if (!edge.fromNodeId || !edge.toNodeId) return;
    if (!childrenMap.has(edge.fromNodeId)) {
      childrenMap.set(edge.fromNodeId, new Set());
    }
    childrenMap.get(edge.fromNodeId)!.add(edge.toNodeId);
  });

  // Cascade: for each node to delete, collect descendants
  const collectDescendants = (nodeId: string) => {
    const node = nodesById.get(nodeId);
    if (!node) return;

    const nodeType = (node.type || '').toUpperCase();
    
    // If deleting a GROUP, cascade to all child nodes (OPTIONs/INPUTs)
    if (nodeType === 'GROUP') {
      const children = childrenMap.get(nodeId) || new Set();
      children.forEach(childId => {
        if (!toDelete.has(childId)) {
          toDelete.add(childId);
          collectDescendants(childId); // Recursively cascade
        }
      });
    }
    // If deleting an OPTION/INPUT, cascade to all children
    else if (nodeType === 'OPTION' || nodeType === 'INPUT') {
      const children = childrenMap.get(nodeId) || new Set();
      children.forEach(childId => {
        if (!toDelete.has(childId)) {
          toDelete.add(childId);
          collectDescendants(childId);
        }
      });
    }
  };

  // Apply cascade for all initial delete targets
  nodeIdsToDelete.forEach(id => collectDescendants(id));

  // Step 2: Remove nodes (hard delete)
  const remainingNodes = nodes.filter(n => !toDelete.has(n.id));

  // Step 3: Remove edges where FROM or TO is deleted
  const remainingEdges = edges.filter(e => 
    !toDelete.has(e.fromNodeId || '') && !toDelete.has(e.toNodeId || '')
  );

  // Step 4: Remove deleted IDs from rootNodeIds
  const oldRoots = Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [];
  const cleanedRoots = oldRoots.filter((id: string) => !toDelete.has(id));

  // Step 5: Build updated tree
  const updatedTree = {
    ...tree,
    nodes: remainingNodes,
    edges: remainingEdges,
    rootNodeIds: cleanedRoots,
  };

  // Step 6: Normalize (repairs roots if needed, enforces canonical rules)
  const normalizedTree = normalizeTreeJson(updatedTree);

  // Step 7: Convert to Record format for patch
  const finalNodes = Array.isArray(normalizedTree.nodes) 
    ? normalizedTree.nodes 
    : Object.values(normalizedTree.nodes || {});
  const finalEdges = Array.isArray(normalizedTree.edges) 
    ? normalizedTree.edges 
    : [];

  const { nodes: nodesRecord, edges: edgesArray } = arraysToRecords(finalNodes, finalEdges);

  return {
    patch: {
      nodes: Object.values(nodesRecord),
      edges: edgesArray,
    },
  };
}

/**
 * Create patch to delete a group (hard delete: physically removes nodes)
 */
export function createDeleteGroupPatch(treeJson: unknown, groupId: string): { patch: any } {
  // Hard delete: physically remove group + all child options/choices + all edges
  return createHardDeletePatch(treeJson, [groupId]);
}

/**
 * Create patch to reorder option groups.
 * Moves the group at fromIndex to toIndex within the group sublist.
 * Non-group nodes are preserved in their original relative order.
 * Group IDs, choice IDs, rule references, and matrix dimensions are unchanged.
 */
export function createReorderGroupsPatch(treeJson: unknown, fromIndex: number, toIndex: number): { patch: any } {
  const { nodes, edges } = normalizeArrays(treeJson);

  const groupNodes = nodes.filter(n => n.type?.toUpperCase() === 'GROUP');
  const nonGroupNodes = nodes.filter(n => n.type?.toUpperCase() !== 'GROUP');

  if (
    fromIndex < 0 || fromIndex >= groupNodes.length ||
    toIndex < 0 || toIndex >= groupNodes.length ||
    fromIndex === toIndex
  ) {
    return { patch: { nodes, edges } };
  }

  const reordered = [...groupNodes];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  // Stamp displayOrder and ui.sortOrder on each group node so the Product Builder
  // ordering persists through JSONB round-trips and the runtime visibility resolver
  // (which reads ui.sortOrder) renders groups in the correct sequence.
  const reorderedWithOrder = reordered.map((n, i) => ({
    ...n,
    displayOrder: i,
    ui: { ...(n.ui || {}), sortOrder: i },
  }));

  return { patch: { nodes: [...reorderedWithOrder, ...nonGroupNodes], edges } };
}

/**
 * Create patch to update an option node
 */
export function createUpdateOptionPatch(
  treeJson: unknown,
  optionId: string,
  updates: {
    name?: string; // UI field
    label?: string;
    description?: string;
    type?: string;
    required?: boolean;
    isRequired?: boolean; // UI field
    enabled?: boolean; // UI field
    defaultValue?: any;
    isDefault?: boolean; // UI field
    choices?: Array<{
      value: string;
      label: string;
      description?: string;
      sortOrder?: number;
      priceDeltaCents?: number;
      pricingOverride?: ChoicePricingOverride;
      materialOverride?: ChoiceMaterialOverride;
      workflowTags?: string[];
      inventoryConsumption?: Array<{ materialId: string; quantityBasis: "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed"; multiplier: number; wastePercent?: number; fixedQty?: number }>;
    }>;
  }
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updated = { ...n };
    // Map UI field 'name' to tree field 'label'
    if (updates.name !== undefined) updated.label = updates.name;
    if (updates.label !== undefined) updated.label = updates.label;
    if (updates.description !== undefined) updated.description = updates.description;

    if (updates.enabled !== undefined) {
      updated.status = updates.enabled ? 'ENABLED' : 'DISABLED';
    }
    
    if (updates.type !== undefined && updated.input) {
      const typeMap: Record<string, "boolean" | "select" | "multiselect" | "number" | "text" | "textarea" | "file" | "dimension"> = {
        'radio': 'select',
        'checkbox': 'boolean',
        'dropdown': 'select',
        'numeric': 'number',
        'dimension': 'dimension',
        'text': 'text',
        'textarea': 'textarea',
      };
      updated.input = { ...updated.input, type: typeMap[updates.type] || 'select' };
    }

    // Map UI field 'isRequired' to tree field 'required'
    const requiredValue = updates.isRequired !== undefined ? updates.isRequired : updates.required;
    if (requiredValue !== undefined && updated.input) {
      updated.input = { ...updated.input, required: requiredValue };
    }

    // Map UI field 'isDefault' to setting defaultValue
    if (updates.isDefault !== undefined && updated.input) {
      if (updates.isDefault) {
        // Set a default value if not already present
        updated.input = { ...updated.input, defaultValue: updated.input.defaultValue ?? true };
      } else {
        // Clear default value
        updated.input = { ...updated.input, defaultValue: undefined };
      }
    }

    if (updates.defaultValue !== undefined && updated.input) {
      updated.input = { ...updated.input, defaultValue: updates.defaultValue };
    }

    if (updates.choices !== undefined) {
      updated.choices = updates.choices;
    }

    return updated;
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to add a choice to a select-like option
 */
export function createAddChoicePatch(
  treeJson: unknown,
  optionId: string
): { patch: any; newChoiceValue: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  
  const optionNode = nodes.find(n => n.id === optionId);
  const existingChoices = optionNode?.choices || [];
  
  // Generate unique value
  let counter = existingChoices.length + 1;
  let newValue = `choice_${counter}`;
  while (existingChoices.some((c: any) => c.value === newValue)) {
    counter++;
    newValue = `choice_${counter}`;
  }

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;
    
    const newChoice = {
      value: newValue,
      label: '',
      sortOrder: existingChoices.length,
    };

    return {
      ...n,
      choices: [...existingChoices, newChoice],
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
    newChoiceValue: newValue,
  };
}

function cascadeRenameInMatchRecord(
  match: Record<string, unknown>,
  optionId: string,
  oldValue: string,
  newValue: string
): Record<string, unknown> {
  if (match[optionId] !== oldValue) return match;
  return { ...match, [optionId]: newValue };
}

function cascadeRenameInConditions(
  conditions: unknown,
  optionId: string,
  oldValue: string,
  newValue: string
): unknown {
  if (!conditions || typeof conditions !== "object") return conditions;
  if (Array.isArray(conditions)) {
    return conditions.map((c: any) => cascadeRenameInConditions(c, optionId, oldValue, newValue));
  }
  const cond = conditions as Record<string, any>;
  const updated: Record<string, any> = { ...cond };
  if (typeof cond.optionGroup === "string" && cond.optionGroup === optionId && cond.value === oldValue) {
    updated.value = newValue;
  }
  if (cond.all) updated.all = cascadeRenameInConditions(cond.all, optionId, oldValue, newValue);
  if (cond.any) updated.any = cascadeRenameInConditions(cond.any, optionId, oldValue, newValue);
  if (cond.none) updated.none = cascadeRenameInConditions(cond.none, optionId, oldValue, newValue);
  return updated;
}

function cascadeChoiceRenameInTree(
  tree: Record<string, any>,
  optionId: string,
  oldValue: string,
  newValue: string
): { pricingMatrix?: any; rules?: any; optionRules?: any } {
  const changes: { pricingMatrix?: any; rules?: any; optionRules?: any } = {};

  const matrix = tree.pricingMatrix;
  if (matrix && typeof matrix === "object" && !Array.isArray(matrix) && Array.isArray(matrix.rows)) {
    const updatedRows = matrix.rows.map((row: any) => {
      const updatedRow = { ...row };
      if (row.when) updatedRow.when = cascadeRenameInMatchRecord(row.when, optionId, oldValue, newValue);
      if (row.match) updatedRow.match = cascadeRenameInMatchRecord(row.match, optionId, oldValue, newValue);
      if (row.combination) updatedRow.combination = cascadeRenameInMatchRecord(row.combination, optionId, oldValue, newValue);
      return updatedRow;
    });
    changes.pricingMatrix = { ...matrix, rows: updatedRows };
  }

  const rules = Array.isArray(tree.rules) ? tree.rules : null;
  if (rules) {
    changes.rules = rules.map((rule: any) =>
      rule.when ? { ...rule, when: cascadeRenameInConditions(rule.when, optionId, oldValue, newValue) } : rule
    );
  }

  const optionRules = Array.isArray(tree.optionRules) ? tree.optionRules : null;
  if (optionRules) {
    changes.optionRules = optionRules.map((rule: any) =>
      rule.when ? { ...rule, when: cascadeRenameInConditions(rule.when, optionId, oldValue, newValue) } : rule
    );
  }

  return changes;
}

/**
 * Create patch to update a choice
 */
export function createUpdateChoicePatch(
  treeJson: unknown,
  optionId: string,
  choiceValue: string,
  updates: {
    label?: string;
    value?: string;
    description?: string;
    priceDeltaCents?: number;
    pricingImpact?: PricingImpact[];
    pricingOverride?: ChoicePricingOverride;
    materialOverride?: ChoiceMaterialOverride;
    inventoryConsumption?: Array<{ materialId: string; quantityBasis: "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed"; multiplier: number; wastePercent?: number; fixedQty?: number }>;
    workflowTags?: string[];
  }
): { patch: any; validationError?: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  
  const optionNode = nodes.find(n => n.id === optionId);
  const existingChoices = optionNode?.choices || [];

  // DEV guard: log if node/choice not found (compatible with Vite and Jest)
  if (process.env.NODE_ENV === 'development') {
    if (!optionNode) {
      console.error('[createUpdateChoicePatch] Option node not found', { optionId, availableNodes: nodes.map(n => n.id) });
    } else {
      const choiceExists = existingChoices.some((c: any) => c.value === choiceValue);
      if (!choiceExists) {
        console.error('[createUpdateChoicePatch] Choice not found in node', { 
          optionId, 
          choiceValue, 
          availableChoices: existingChoices.map((c: any) => c.value),
          updates 
        });
      }
    }
  }

  // Check for duplicate value if updating value
  if (updates.value !== undefined && updates.value !== choiceValue) {
    const isDuplicate = existingChoices.some((c: any) => c.value === updates.value && c.value !== choiceValue);
    if (isDuplicate) {
      return {
        patch: { nodes, edges },
        validationError: 'Choice value must be unique',
      };
    }
  }

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updatedChoices = (n.choices || []).map((c: any) => {
      if (c.value !== choiceValue) return c;
      
      const updated = { ...c };
      if (Object.prototype.hasOwnProperty.call(updates, 'label')) updated.label = updates.label;
      if (Object.prototype.hasOwnProperty.call(updates, 'value')) updated.value = updates.value;
      if (Object.prototype.hasOwnProperty.call(updates, 'description')) updated.description = updates.description;
      if (Object.prototype.hasOwnProperty.call(updates, 'priceDeltaCents')) {
        if (updates.priceDeltaCents === undefined) delete updated.priceDeltaCents;
        else updated.priceDeltaCents = updates.priceDeltaCents;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'pricingImpact')) {
        if (updates.pricingImpact === undefined) delete updated.pricingImpact;
        else updated.pricingImpact = updates.pricingImpact;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'pricingOverride')) {
        if (updates.pricingOverride === undefined) delete updated.pricingOverride;
        else updated.pricingOverride = updates.pricingOverride;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'materialOverride')) {
        if (updates.materialOverride === undefined) delete updated.materialOverride;
        else updated.materialOverride = updates.materialOverride;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'inventoryConsumption')) {
        if (updates.inventoryConsumption === undefined) delete updated.inventoryConsumption;
        else updated.inventoryConsumption = updates.inventoryConsumption;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'workflowTags')) {
        if (!updates.workflowTags || updates.workflowTags.length === 0) delete updated.workflowTags;
        else updated.workflowTags = updates.workflowTags;
      }
      return synchronizeChoiceInventoryConsumptionMaterial(updated);
    });

    // Update defaultValue if it referenced the old choice value
    let updatedInput = n.input;
    if (updates.value !== undefined && updates.value !== choiceValue && n.input?.defaultValue === choiceValue) {
      updatedInput = { ...n.input, defaultValue: updates.value };
    }

    return {
      ...n,
      choices: updatedChoices,
      input: updatedInput,
    };
  });

  const cascadeChanges =
    updates.value !== undefined && updates.value !== choiceValue
      ? cascadeChoiceRenameInTree(tree, optionId, choiceValue, updates.value)
      : {};

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
    ...cascadeChanges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
      ...cascadeChanges,
    },
  };
}

/**
 * Create patch to delete a choice
 */
export function createDeleteChoicePatch(
  treeJson: unknown,
  optionId: string,
  choiceValue: string
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updatedChoices = (n.choices || []).filter((c: any) => c.value !== choiceValue);
    
    // Clear defaultValue if it referenced the deleted choice
    let updatedInput = n.input;
    if (n.input?.defaultValue === choiceValue) {
      updatedInput = { ...n.input, defaultValue: undefined };
    }

    return {
      ...n,
      choices: updatedChoices,
      input: updatedInput,
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to reorder choices
 */
export function createReorderChoicePatch(
  treeJson: unknown,
  optionId: string,
  fromIndex: number,
  toIndex: number
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const choices = [...(n.choices || [])];
    const [moved] = choices.splice(fromIndex, 1);
    choices.splice(toIndex, 0, moved);

    // Update sortOrder
    const reordered = choices.map((c: any, idx: number) => ({
      ...c,
      sortOrder: idx,
    }));

    return {
      ...n,
      choices: reordered,
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to add a new option to a group
 */
export function createAddOptionPatch(treeJson: unknown, groupId: string): { patch: any; newOptionId: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  const existingIds = new Set([...nodes.map(n => n.id), ...edges.map(e => e.id)]);

  const newOptionId = makeId('opt_', existingIds);
  const newEdgeId = makeId('edge_', existingIds);
  const selectionKey = `opt_${newOptionId}`;

  const newNode: PBV2Node = {
    id: newOptionId,
    kind: 'question',
    type: 'INPUT',
    status: 'ENABLED',
    key: selectionKey,
    label: 'New Option',
    description: '',
    input: {
      type: 'select',
      required: false,
      selectionKey: selectionKey, // REQUIRED: Set selectionKey to avoid validation error
    } as any,
    pricingImpact: [],
    weightImpact: [],
  };
  
  // Set valueType separately to avoid TypeScript error
  (newNode.input as any).valueType = 'TEXT';

  // Create structural edge from GROUP to new option
  // Mark as DISABLED to indicate this is a containment edge, not a runtime conditional edge
  // Validator requires ALL edges to have valid condition AST (even DISABLED)
  const newEdge: PBV2Edge = {
    id: newEdgeId,
    fromNodeId: groupId,
    toNodeId: newOptionId,
    status: 'DISABLED', // Structural edge - not a runtime conditional
    condition: TRUE_CONDITION, // Validator requires valid condition AST for all edges
    priority: nodes.filter(n => n.id === groupId).length > 0 ? edges.filter(e => e.fromNodeId === groupId).length : 0,
  };

  const patchedTree = {
    ...tree,
    nodes: [...nodes, newNode],
    edges: [...edges, newEdge],
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
    newOptionId,
  };
}

/**
 * Create patch to delete an option (hard delete: physically removes nodes)
 */
export function createDeleteOptionPatch(treeJson: unknown, optionId: string): { patch: any } {
  // Hard delete: physically remove option + all child nodes + all edges
  return createHardDeletePatch(treeJson, [optionId]);
}

/**
 * Apply a patch to tree JSON (replaces nodes/edges and optional top-level fields)
 */
export function applyPatchToTree(treeJson: unknown, patch: { nodes?: PBV2Node[]; edges?: PBV2Edge[]; pricingMatrix?: any; rules?: any; optionRules?: any }): any {
  const tree = asRecord(treeJson) ? { ...(treeJson as any) } : {};

  if (patch.nodes !== undefined && patch.edges !== undefined) {
    // Convert arrays to Record format for OptionTreeV2 schema
    const { nodes, edges } = arraysToRecords(patch.nodes, patch.edges);
    tree.nodes = nodes;
    tree.edges = edges;
  } else if (patch.nodes !== undefined) {
    // Only nodes provided
    const { nodes } = arraysToRecords(patch.nodes, []);
    tree.nodes = nodes;
  } else if (patch.edges !== undefined) {
    tree.edges = patch.edges;
  }

  if (patch.pricingMatrix !== undefined) tree.pricingMatrix = patch.pricingMatrix;
  if (patch.rules !== undefined) tree.rules = patch.rules;
  if (patch.optionRules !== undefined) tree.optionRules = patch.optionRules;

  return tree;
}

/**
 * Helper to slugify a string for use as selectionKey or other identifiers
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50) || 'key';
}

/**
 * Enforce tree invariants to prevent common authoring errors.
 * This function auto-repairs common issues:
 * 
 * 1. INPUT nodes without selectionKey - sets from internalId/label/id
 * 2. INPUT nodes without valueType - infers from input.type
 * 3. Invalid edge conditions - replaces with null (unconditional)
 * 4. ENABLED edges to GROUP nodes - rewires to first child or disables
 * 5. Invalid rootNodeIds - repairs to first valid ENABLED runtime node
 */
export function ensureTreeInvariants(treeJson: unknown): any {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Map nodes and edges by ID for quick lookup
  const nodesById = new Map(nodes.map(n => [n.id, n]));
  const edgesById = new Map(edges.map(e => [e.id, e]));

  // Track changes
  let mutated = false;

  // 1. INPUT selectionKey auto-repair
  for (const node of nodes) {
    if (node.status === 'DELETED') continue;
    if (node.type?.toUpperCase() !== 'INPUT') continue;

    const input = node.input ?? {};
    
    // Check if selectionKey is missing or empty
    if (!node.key || !node.key.trim()) {
      // Generate selectionKey from internalId, label, or id (in that order)
      const internalId = (node as any).internalId;
      const label = node.label;
      const fallback = node.id;

      let newKey = '';
      if (internalId && typeof internalId === 'string' && internalId.trim()) {
        newKey = slugify(internalId);
      } else if (label && typeof label === 'string' && label.trim()) {
        newKey = slugify(label);
      } else {
        newKey = slugify(fallback);
      }

      node.key = newKey;
      mutated = true;
    }
  }

  // 2. INPUT valueType auto-repair (use UPPERCASE tokens as expected by validator)
  for (const node of nodes) {
    if (node.status === 'DELETED') continue;
    if (node.type?.toUpperCase() !== 'INPUT') continue;

    const input = node.input ?? {};
    const inputType = input.type?.toLowerCase();
    
    // Check if valueType is missing or not in valid set
    let currentValueType = (input as any).valueType;
    const validValueTypes = ['NUMBER', 'BOOLEAN', 'TEXT', 'JSON', 'NULL'];
    const isValid = currentValueType && typeof currentValueType === 'string' && 
                    validValueTypes.includes(currentValueType.toUpperCase());
    
    if (!isValid) {
      // Infer valueType from input.type (use UPPERCASE tokens)
      let newValueType = 'TEXT'; // default
      
      switch (inputType) {
        case 'boolean':
          newValueType = 'BOOLEAN';
          break;
        case 'number':
        case 'dimension':
          newValueType = 'NUMBER';
          break;
        case 'select':
        case 'multiselect':
        case 'text':
        case 'textarea':
        default:
          newValueType = 'TEXT';
          break;
      }

      if (!node.input) node.input = {};
      (node.input as any).valueType = newValueType;
      mutated = true;
    }
  }

  // 3. Edge condition validity (must be undefined, null, or valid AST with 'op')
  for (const edge of edges) {
    if (edge.status === 'DELETED') continue;
    
    const condition = edge.condition;
    
    // Check if condition is present but invalid
    if (condition !== null && condition !== undefined) {
      // Condition must be an object with a valid 'op' field
      const isValidCondition = 
        typeof condition === 'object' && 
        condition !== null && 
        'op' in condition &&
        typeof (condition as any).op === 'string' &&
        (condition as any).op.length > 0;
      
      // Empty objects {} or invalid structures should become undefined
      const isEmptyObject = typeof condition === 'object' && 
                           Object.keys(condition).length === 0;
      
      if (!isValidCondition || isEmptyObject) {
        // Replace with undefined for unconditional edges
        edge.condition = undefined;
        mutated = true;
      }
    }
  }

  // 4. ENABLED edges cannot connect to GROUP nodes - rewire or disable
  for (const edge of edges) {
    if (edge.status !== 'ENABLED') continue;
    if (!edge.toNodeId) continue;

    const targetNode = nodesById.get(edge.toNodeId);
    if (!targetNode) continue;

    // Check if target is a GROUP node
    if (targetNode.type?.toUpperCase() === 'GROUP') {
      // Find child edges from this GROUP node
      const childEdges = edges.filter(e => 
        e.fromNodeId === targetNode.id && 
        e.status !== 'DELETED' &&
        e.toNodeId
      );

      if (childEdges.length > 0) {
        // Rewire to first child option node
        const firstChild = nodesById.get(childEdges[0].toNodeId!);
        if (firstChild && firstChild.type?.toUpperCase() !== 'GROUP') {
          edge.toNodeId = firstChild.id;
          mutated = true;
        } else {
          // No valid child, disable the edge
          edge.status = 'DISABLED';
          mutated = true;
        }
      } else {
        // No children, disable the edge
        edge.status = 'DISABLED';
        mutated = true;
      }
    }
  }

  // 5. Root auto-repair - ensure rootNodeIds includes all top-level GROUP nodes
  const rootNodeIds = Array.isArray((tree as any).rootNodeIds) ? (tree as any).rootNodeIds : [];
  
  // Find nodes with incoming edges (any status)
  const nodesWithIncoming = new Set<string>();
  for (const edge of edges) {
    if (edge.status !== 'DELETED' && edge.toNodeId) {
      nodesWithIncoming.add(edge.toNodeId);
    }
  }
  
  // Find all ENABLED GROUP nodes (top-level organizational containers)
  const groupNodes = nodes.filter(n => 
    n.status === 'ENABLED' && 
    n.type?.toUpperCase() === 'GROUP'
  );
  
  // Find valid runtime nodes (ENABLED, non-GROUP, non-DELETED)
  const validRuntimeNodes = nodes.filter(n => 
    n.status === 'ENABLED' && 
    n.type?.toUpperCase() !== 'GROUP' &&
    n.type?.toUpperCase() !== 'DELETED'
  );
  
  // Orphaned nodes are valid runtime nodes without incoming edges
  const orphanedNodes = validRuntimeNodes.filter(n => !nodesWithIncoming.has(n.id));
  
  // Top-level groups are GROUPs without incoming edges
  const topLevelGroups = groupNodes.filter(n => !nodesWithIncoming.has(n.id));

  // Check if current roots are valid (can be GROUPs or runtime nodes)
  const validRoots = rootNodeIds.filter((id: string) => {
    const node = nodesById.get(id);
    return node && node.status === 'ENABLED';
  });
  
  // Build new root set: top-level GROUPs + orphaned runtime nodes
  // Priority: If we have GROUPs, use them; otherwise use orphaned nodes
  let newRootSet: Set<string>;
  if (topLevelGroups.length > 0) {
    // Use top-level GROUPs as roots (preferred for builder UI)
    newRootSet = new Set([...topLevelGroups.map(n => n.id), ...orphanedNodes.map(n => n.id)]);
  } else {
    // No GROUPs, use existing valid roots + orphaned runtime nodes
    newRootSet = new Set([...validRoots, ...orphanedNodes.map(n => n.id)]);
  }
  const newRoots = Array.from(newRootSet);

  // Always populate rootNodeIds when empty (critical for visibility)
  if (rootNodeIds.length === 0) {
    if (groupNodes.length > 0) {
      // Use all enabled GROUP nodes as roots
      (tree as any).rootNodeIds = groupNodes.map(n => n.id);
      mutated = true;
    } else if (validRuntimeNodes.length > 0) {
      // No GROUPs, use first enabled runtime node
      (tree as any).rootNodeIds = [validRuntimeNodes[0].id];
      mutated = true;
    }
  } else if (newRoots.length > 0 && JSON.stringify(newRoots.sort()) !== JSON.stringify([...rootNodeIds].sort())) {
    // Roots changed, update
    (tree as any).rootNodeIds = newRoots;
    mutated = true;
  } else if (newRoots.length === 0 && validRuntimeNodes.length === 0 && groupNodes.length === 0) {
    // No valid nodes at all, clear roots
    (tree as any).rootNodeIds = [];
    mutated = true;
  }

  // Return potentially mutated tree
  return tree;
}

/**
 * Create patch to update node-level pricing impact rules
 */
export function createUpdateNodePricingPatch(
  treeJson: unknown,
  nodeId: string,
  pricingImpact: any[]
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    return {
      ...n,
      pricingImpact: pricingImpact.map(rule => normalizeLegacyPricingImpact(rule, 'addFlat', {
        settleBlankFormula: false,
      })),
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to add a pricing rule to a node
 */
export function createAddPricingRulePatch(
  treeJson: unknown,
  nodeId: string,
  rule: any
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const existingRules = n.pricingImpact || [];
    const newRule = normalizeLegacyPricingImpact(rule, 'addFlat');

    return {
      ...n,
      pricingImpact: [...existingRules, newRule],
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to delete a pricing rule from a node
 */
export function createDeletePricingRulePatch(
  treeJson: unknown,
  nodeId: string,
  ruleIndex: number
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const existingRules = n.pricingImpact || [];
    const updatedRules = existingRules.filter((_, idx) => idx !== ruleIndex);

    return {
      ...n,
      pricingImpact: updatedRules,
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to update a choice's price delta
 */
export function createUpdateChoicePriceDeltaPatch(
  treeJson: unknown,
  optionId: string,
  choiceValue: string,
  priceDeltaCents: number | undefined
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updatedChoices = (n.choices || []).map((c: any) => {
      if (c.value !== choiceValue) return c;
      
      const updated = { ...c };
      if (priceDeltaCents === undefined) {
        delete updated.priceDeltaCents;
      } else {
        updated.priceDeltaCents = priceDeltaCents;
      }
      return updated;
    });

    return {
      ...n,
      choices: updatedChoices,
    };
  });

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges,
  };

  const repairedTree = ensureTreeInvariants(patchedTree);

  return {
    patch: {
      nodes: repairedTree.nodes,
      edges: repairedTree.edges,
    },
  };
}

/**
 * Create patch to update base pricing (perSqftCents, perPieceCents, minimumChargeCents).
 */
export function createUpdatePricingV2BasePatch(
  treeJson: unknown,
  base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }
): { patch: any } {
  const { tree } = normalizeArrays(treeJson);
  
  const currentPricing = tree.meta?.pricingV2 || {};
  const updatedPricing = {
    ...currentPricing,
    base: {
      ...(currentPricing.base || {}),
      ...base,
    },
  };

  const repairedTree = ensureTreeInvariants({
    ...tree,
    meta: {
      ...tree.meta,
      pricingV2: updatedPricing,
    },
  });

  return {
    patch: {
      meta: repairedTree.meta,
    },
  };
}

/**
 * Create patch to update unit system (imperial/metric).
 */
export function createUpdatePricingV2UnitSystemPatch(
  treeJson: unknown,
  unitSystem: 'imperial' | 'metric'
): { patch: any } {
  const { tree } = normalizeArrays(treeJson);
  
  const currentPricing = tree.meta?.pricingV2 || {};
  const updatedPricing = {
    ...currentPricing,
    unitSystem,
  };

  const repairedTree = ensureTreeInvariants({
    ...tree,
    meta: {
      ...tree.meta,
      pricingV2: updatedPricing,
    },
  });

  return {
    patch: {
      meta: repairedTree.meta,
    },
  };
}

/**
 * Create patch to add a pricing tier (qty or sqft).
 */
export function createAddPricingV2TierPatch(
  treeJson: unknown,
  kind: 'qty' | 'sqft'
): { patch: any } {
  const { tree } = normalizeArrays(treeJson);
  
  const currentPricing = tree.meta?.pricingV2 || {};
  const tiersKey = kind === 'qty' ? 'qtyTiers' : 'sqftTiers';
  const currentTiers = currentPricing[tiersKey] || [];

  const newTier = kind === 'qty'
    ? { minQty: 1, perSqftCents: undefined, perPieceCents: undefined, minimumChargeCents: undefined }
    : { minSqft: 0, perSqftCents: undefined, perPieceCents: undefined, minimumChargeCents: undefined };

  const updatedTiers = [...currentTiers, newTier];

  const updatedPricing = {
    ...currentPricing,
    [tiersKey]: updatedTiers,
  };

  const repairedTree = ensureTreeInvariants({
    ...tree,
    meta: {
      ...tree.meta,
      pricingV2: updatedPricing,
    },
  });

  return {
    patch: {
      meta: repairedTree.meta,
    },
  };
}

/**
 * Create patch to update a pricing tier.
 */
export function createUpdatePricingV2TierPatch(
  treeJson: unknown,
  kind: 'qty' | 'sqft',
  index: number,
  tier: any
): { patch: any } {
  const { tree } = normalizeArrays(treeJson);
  
  const currentPricing = tree.meta?.pricingV2 || {};
  const tiersKey = kind === 'qty' ? 'qtyTiers' : 'sqftTiers';
  const currentTiers = currentPricing[tiersKey] || [];

  if (index < 0 || index >= currentTiers.length) {
    // Invalid index, no-op
    return { patch: {} };
  }

  const updatedTiers = [...currentTiers];
  updatedTiers[index] = tier;

  // Auto-sort tiers by min ascending
  updatedTiers.sort((a, b) => {
    const minA = kind === 'qty' ? (a.minQty || 0) : (a.minSqft || 0);
    const minB = kind === 'qty' ? (b.minQty || 0) : (b.minSqft || 0);
    return minA - minB;
  });

  const updatedPricing = {
    ...currentPricing,
    [tiersKey]: updatedTiers,
  };

  const repairedTree = ensureTreeInvariants({
    ...tree,
    meta: {
      ...tree.meta,
      pricingV2: updatedPricing,
    },
  });

  return {
    patch: {
      meta: repairedTree.meta,
    },
  };
}

/**
 * Create patch to delete a pricing tier.
 */
export function createDeletePricingV2TierPatch(
  treeJson: unknown,
  kind: 'qty' | 'sqft',
  index: number
): { patch: any } {
  const { tree } = normalizeArrays(treeJson);
  
  const currentPricing = tree.meta?.pricingV2 || {};
  const tiersKey = kind === 'qty' ? 'qtyTiers' : 'sqftTiers';
  const currentTiers = currentPricing[tiersKey] || [];

  if (index < 0 || index >= currentTiers.length) {
    // Invalid index, no-op
    return { patch: {} };
  }

  const updatedTiers = currentTiers.filter((_: any, i: number) => i !== index);

  const updatedPricing = {
    ...currentPricing,
    [tiersKey]: updatedTiers,
  };

  const repairedTree = ensureTreeInvariants({
    ...tree,
    meta: {
      ...tree.meta,
      pricingV2: updatedPricing,
    },
  });

  return {
    patch: {
      meta: repairedTree.meta,
    },
  };
}
