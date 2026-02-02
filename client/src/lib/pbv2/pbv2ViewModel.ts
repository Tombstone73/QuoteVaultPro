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

export type EditorOptionGroup = {
  id: string; // Node ID in PBV2 tree
  name: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  isMultiSelect: boolean;
  optionIds: string[]; // Child node IDs
};

export type EditorOption = {
  id: string; // Node ID in PBV2 tree
  name: string;
  description: string;
  type: 'radio' | 'checkbox' | 'dropdown' | 'numeric' | 'dimension';
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
  type?: string;
  status?: string;
  key?: string;
  input?: {
    selectionKey?: string;
    valueType?: string;
    required?: boolean;
    constraints?: any;
  };
  label?: string;
  description?: string;
  data?: any;
  priceComponents?: any[];
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
 * Convert PBV2 tree JSON to editor model for UI rendering
 */
export function pbv2TreeToEditorModel(treeJson: unknown): EditorModel {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Identify group nodes (GROUP type or nodes with children)
  const groupNodes = nodes.filter(n => 
    n.type?.toUpperCase() === 'GROUP' || 
    n.type?.toUpperCase() === 'INPUT' && edges.some(e => e.fromNodeId === n.id)
  );

  // Build groups
  const groups: EditorOptionGroup[] = groupNodes.map((node, index) => {
    const childEdges = edges.filter(e => e.fromNodeId === node.id && e.status !== 'DELETED');
    const optionIds = childEdges.map(e => e.toNodeId).filter(Boolean) as string[];

    return {
      id: node.id,
      name: node.label || node.key || node.input?.selectionKey || `Group ${index + 1}`,
      description: node.description || '',
      sortOrder: index,
      isRequired: node.input?.required || false,
      isMultiSelect: node.input?.valueType?.toUpperCase() === 'ARRAY' || false,
      optionIds,
    };
  });

  // Build options map
  const options: Record<string, EditorOption> = {};
  const optionNodeIds = new Set(groups.flatMap(g => g.optionIds));

  nodes.forEach((node, index) => {
    if (!optionNodeIds.has(node.id)) return;

    const selectionKey = node.input?.selectionKey || node.key || node.id;
    const hasPricing = Array.isArray(node.priceComponents) && node.priceComponents.length > 0;
    const hasProductionFlags = Array.isArray(node.materialEffects) && node.materialEffects.length > 0;
    const hasConditionals = edges.some(e => e.fromNodeId === node.id && e.condition);
    const hasWeight = false; // TODO: Check if PBV2 has weight fields

    let optionType: EditorOption['type'] = 'radio';
    const valueType = node.input?.valueType?.toUpperCase();
    if (valueType === 'NUMBER') optionType = 'numeric';
    else if (valueType === 'BOOLEAN') optionType = 'checkbox';
    else if (valueType === 'ENUM') optionType = 'dropdown';

    options[node.id] = {
      id: node.id,
      name: node.label || selectionKey,
      description: node.description || '',
      type: optionType,
      sortOrder: index,
      isDefault: (node.input as any)?.defaultValue !== undefined || (node.input as any)?.default !== undefined,
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

  const newNode: PBV2Node = {
    id: newGroupId,
    type: 'GROUP',
    status: 'ENABLED',
    key: selectionKey,
    label: 'New Group',
    description: '',
    input: {
      selectionKey,
      valueType: 'ENUM',
      required: false,
    },
  };

  return {
    patch: {
      nodes: [...nodes, newNode],
      edges,
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
  updates: Partial<Pick<EditorOptionGroup, 'name' | 'description' | 'isRequired' | 'isMultiSelect'>>
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== groupId) return n;

    const updated = { ...n };
    if (updates.name !== undefined) updated.label = updates.name;
    if (updates.description !== undefined) updated.description = updates.description;
    if (updates.isRequired !== undefined && updated.input) {
      updated.input = { ...updated.input, required: updates.isRequired };
    }
    if (updates.isMultiSelect !== undefined && updated.input) {
      updated.input = { ...updated.input, valueType: updates.isMultiSelect ? 'ARRAY' : 'ENUM' };
    }

    return updated;
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges,
    },
  };
}

/**
 * Create patch to delete a group (marks nodes and edges as DELETED)
 */
export function createDeleteGroupPatch(treeJson: unknown, groupId: string): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Find all child option IDs
  const childEdges = edges.filter(e => e.fromNodeId === groupId);
  const childOptionIds = new Set(childEdges.map(e => e.toNodeId));

  // Mark group node and child nodes as DELETED
  const updatedNodes = nodes.map(n => {
    if (n.id === groupId || childOptionIds.has(n.id)) {
      return { ...n, status: 'DELETED' };
    }
    return n;
  });

  // Mark edges from group as DELETED
  const updatedEdges = edges.map(e => {
    if (e.fromNodeId === groupId || childOptionIds.has(e.fromNodeId)) {
      return { ...e, status: 'DELETED' };
    }
    return e;
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges: updatedEdges,
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
  const selectionKey = `option_${Date.now()}`;

  const newNode: PBV2Node = {
    id: newOptionId,
    type: 'INPUT',
    status: 'ENABLED',
    key: selectionKey,
    label: 'New Option',
    description: '',
    input: {
      selectionKey,
      valueType: 'ENUM',
      required: false,
    },
    priceComponents: [],
    materialEffects: [],
  };

  const newEdge: PBV2Edge = {
    id: newEdgeId,
    status: 'ENABLED',
    fromNodeId: groupId,
    toNodeId: newOptionId,
    priority: 0,
  };

  return {
    patch: {
      nodes: [...nodes, newNode],
      edges: [...edges, newEdge],
    },
    newOptionId,
  };
}

/**
 * Create patch to update an option
 */
export function createUpdateOptionPatch(
  treeJson: unknown,
  optionId: string,
  updates: Partial<Pick<EditorOption, 'name' | 'description' | 'isRequired' | 'isDefault' | 'type'>>
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updated = { ...n };
    if (updates.name !== undefined) updated.label = updates.name;
    if (updates.description !== undefined) updated.description = updates.description;
    if (updated.input) {
      if (updates.isRequired !== undefined) {
        updated.input = { ...updated.input, required: updates.isRequired };
      }
      if (updates.type !== undefined) {
        let valueType = 'ENUM';
        if (updates.type === 'numeric') valueType = 'NUMBER';
        else if (updates.type === 'checkbox') valueType = 'BOOLEAN';
        updated.input = { ...updated.input, valueType };
      }
    }

    return updated;
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges,
    },
  };
}

/**
 * Create patch to delete an option (marks node and edges as DELETED)
 */
export function createDeleteOptionPatch(treeJson: unknown, optionId: string): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id === optionId) {
      return { ...n, status: 'DELETED' };
    }
    return n;
  });

  const updatedEdges = edges.map(e => {
    if (e.toNodeId === optionId || e.fromNodeId === optionId) {
      return { ...e, status: 'DELETED' };
    }
    return e;
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges: updatedEdges,
    },
  };
}

/**
 * Apply a patch to tree JSON (replaces nodes/edges)
 */
export function applyPatchToTree(treeJson: unknown, patch: { nodes?: PBV2Node[]; edges?: PBV2Edge[] }): any {
  const tree = asRecord(treeJson) ? { ...(treeJson as any) } : {};

  if (patch.nodes !== undefined) {
    tree.nodes = patch.nodes;
  }
  if (patch.edges !== undefined) {
    tree.edges = patch.edges;
  }

  return tree;
}
