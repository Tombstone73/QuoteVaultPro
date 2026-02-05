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

import type { OptionNodeV2 } from '@shared/optionTreeV2';

/**
 * Ensure rootNodeIds is populated with root nodes (nodes not pointed to by edges).
 * Prioritizes GROUP nodes if present.
 * This is critical for tree rehydration - without rootNodeIds, the UI appears empty.
 * 
 * @param treeJson - PBV2 tree object
 * @returns Updated tree with rootNodeIds set (immutable)
 */
export function ensureRootNodeIds(treeJson: any): any {
  if (!treeJson || typeof treeJson !== 'object') return treeJson;
  
  const nodes = treeJson.nodes || {};
  const nodeIds = Object.keys(nodes);
  
  // If no nodes, return as-is
  if (nodeIds.length === 0) return treeJson;
  
  // If rootNodeIds already populated, return as-is
  if (Array.isArray(treeJson.rootNodeIds) && treeJson.rootNodeIds.length > 0) {
    return treeJson;
  }
  
  // Compute roots from edges: nodes not pointed to by any edge
  const edges = treeJson.edges || [];
  const toIds = new Set(edges.map((e: any) => e?.toNodeId).filter(Boolean));
  const roots = nodeIds.filter(id => !toIds.has(id));
  
  // Prioritize GROUP nodes if present
  const groupRoots = roots.filter(id => {
    const node = nodes[id];
    if (!node) return false;
    const isGroup = (node.type || '').toUpperCase() === 'GROUP';
    const isEnabled = (node.status || 'ENABLED').toUpperCase() === 'ENABLED';
    return isGroup && isEnabled;
  });
  
  // Use groups if found, otherwise all roots
  const finalRoots = groupRoots.length > 0 ? groupRoots : roots;
  
  // Return updated tree with rootNodeIds set (immutable)
  return {
    ...treeJson,
    rootNodeIds: finalRoots,
  };
}

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
  choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number; weightOz?: number }>;
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
      name: node.label || node.key || node.id,
      description: node.description || '',
      sortOrder: index,
      isRequired: node.input?.required || false,
      isMultiSelect: node.input?.type === 'multiselect',
      optionIds,
    };
  });

  // Build options map
  const options: Record<string, EditorOption> = {};
  const optionNodeIds = new Set(groups.flatMap(g => g.optionIds));

  nodes.forEach((node, index) => {
    if (!optionNodeIds.has(node.id)) return;

    const selectionKey = node.key || node.id;
    const hasPricing = Array.isArray(node.pricingImpact) && node.pricingImpact.length > 0;
    const hasProductionFlags = Array.isArray(node.materialEffects) && node.materialEffects.length > 0;
    const hasConditionals = edges.some(e => e.fromNodeId === node.id && e.condition);
    const hasWeight = Array.isArray(node.weightImpact) && node.weightImpact.length > 0;

    let optionType: EditorOption['type'] = 'radio';
    const inputType = node.input?.type;
    if (inputType === 'number') optionType = 'numeric';
    else if (inputType === 'boolean') optionType = 'checkbox';
    else if (inputType === 'select') optionType = 'dropdown';
    else if (inputType === 'dimension') optionType = 'dimension';

    options[node.id] = {
      id: node.id,
      name: node.label || selectionKey,
      description: node.description || '',
      type: optionType,
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
  };

  // Add new group to rootNodeIds so it appears in the UI
  const existingRoots = Array.isArray((tree as any).rootNodeIds) ? (tree as any).rootNodeIds : [];
  const updatedRoots = [...existingRoots];
  if (!updatedRoots.includes(newGroupId)) {
    updatedRoots.push(newGroupId);
  }

  const patchedTree = {
    ...tree,
    nodes: [...nodes, newNode],
    edges,
    rootNodeIds: updatedRoots,
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
      updated.input = { ...updated.input, type: updates.isMultiSelect ? 'multiselect' : 'select' };
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

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges: updatedEdges,
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
    defaultValue?: any;
    isDefault?: boolean; // UI field
    choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number }>;
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
    
    if (updates.type !== undefined && updated.input) {
      const typeMap: Record<string, "boolean" | "select" | "multiselect" | "number" | "text" | "textarea" | "file" | "dimension"> = {
        'radio': 'select',
        'checkbox': 'boolean',
        'dropdown': 'select',
        'numeric': 'number',
        'dimension': 'dimension'
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

/**
 * Create patch to update a choice
 */
export function createUpdateChoicePatch(
  treeJson: unknown,
  optionId: string,
  choiceValue: string,
  updates: { label?: string; value?: string; description?: string; priceDeltaCents?: number }
): { patch: any; validationError?: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  
  const optionNode = nodes.find(n => n.id === optionId);
  const existingChoices = optionNode?.choices || [];

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
      if (updates.label !== undefined) updated.label = updates.label;
      if (updates.value !== undefined) updated.value = updates.value;
      if (updates.description !== undefined) updated.description = updates.description;
      if (updates.priceDeltaCents !== undefined) updated.priceDeltaCents = updates.priceDeltaCents;
      return updated;
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
  const newEdge: PBV2Edge = {
    id: newEdgeId,
    fromNodeId: groupId,
    toNodeId: newOptionId,
    status: 'DISABLED', // Structural edge - not a runtime conditional
    condition: undefined,
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

  const patchedTree = {
    ...tree,
    nodes: updatedNodes,
    edges: updatedEdges,
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
 * Apply a patch to tree JSON (replaces nodes/edges)
 */
export function applyPatchToTree(treeJson: unknown, patch: { nodes?: PBV2Node[]; edges?: PBV2Edge[] }): any {
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
  pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    return {
      ...n,
      pricingImpact: pricingImpact.map(rule => ({
        mode: rule.mode,
        amountCents: rule.cents,
        label: rule.label,
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
  rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const existingRules = n.pricingImpact || [];
    const newRule = {
      mode: rule.mode,
      amountCents: rule.cents,
      label: rule.label,
    };

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
