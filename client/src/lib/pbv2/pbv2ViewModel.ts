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
import { createEmptyOptionTreeV2 } from '@shared/optionTreeV2';

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
  selectionKey?: string; // Legacy top-level selectionKey (backward compat)
  input?: {
    type?: "boolean" | "select" | "multiselect" | "number" | "text" | "textarea" | "file" | "dimension";
    required?: boolean;
    defaultValue?: any;
    constraints?: any;
    selectionKey?: string; // Proper location per schema
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
 * Convert PBV2 tree JSON to editor model for UI rendering
 */
export function pbv2TreeToEditorModel(treeJson: unknown): EditorModel {
  // Runtime migration: handle legacy arrays or null/undefined
  let safeTreeJson = treeJson;
  
  if (Array.isArray(treeJson)) {
    console.warn('[PBV2] Legacy array tree detected, migrating to empty OptionTreeV2 object');
    safeTreeJson = createEmptyOptionTreeV2();
  } else if (!treeJson || typeof treeJson !== 'object') {
    console.warn('[PBV2] Invalid tree JSON (null/undefined/non-object), using empty OptionTreeV2');
    safeTreeJson = createEmptyOptionTreeV2();
  }

  const { tree, nodes, edges } = normalizeArrays(safeTreeJson);

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
      name: node.label || '',
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
 * Part A: Enforce tree invariants to prevent validation errors.
 * 
 * This function normalizes a tree to ensure:
 * 1. Every INPUT node has input.selectionKey (stable identifier)
 * 2. tree.rootNodeIds contains at least one ENABLED runtime node
 * 3. Edges to GROUP nodes are marked DISABLED (GROUP nodes are metadata)
 * 4. edge.condition is undefined or valid AST (not {})
 * 
 * Call this after every patch application to maintain valid tree structure.
 */
export function ensureTreeInvariants(treeJson: unknown): any {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  
  // Invariant 1: Ensure every INPUT node has input.selectionKey
  const fixedNodes = nodes.map(node => {
    if (node.type === 'INPUT' && node.input) {
      const selectionKey = node.input.selectionKey || node.selectionKey || node.key || node.id;
      return {
        ...node,
        input: {
          ...node.input,
          selectionKey,
        },
      };
    }
    return node;
  });

  // Invariant 3: Disable edges pointing to GROUP nodes (they're not runtime nodes)
  const groupIds = new Set(fixedNodes.filter(n => n.type === 'GROUP').map(n => n.id));
  const fixedEdges = edges.map(edge => {
    if (edge.toNodeId && groupIds.has(edge.toNodeId) && edge.status === 'ENABLED') {
      return { ...edge, status: 'DISABLED' };
    }
    // Invariant 4: Normalize invalid condition objects
    if (edge.condition !== undefined && edge.condition !== null) {
      const cond = edge.condition;
      // If condition is an empty object or doesn't look like a valid AST, remove it
      if (typeof cond === 'object' && Object.keys(cond).length === 0) {
        const { condition, ...rest } = edge;
        return rest;
      }
    }
    return edge;
  });

  // Invariant 2: Ensure rootNodeIds contains at least one ENABLED runtime node
  let fixedRootNodeIds = Array.isArray(tree.rootNodeIds) ? [...tree.rootNodeIds] : [];
  
  // Filter out GROUP nodes from roots (they're not runtime nodes)
  fixedRootNodeIds = fixedRootNodeIds.filter(id => !groupIds.has(id));
  
  // If no valid roots, find all top-level INPUT nodes (no incoming ENABLED edges from runtime nodes)
  if (fixedRootNodeIds.length === 0) {
    const runtimeNodes = fixedNodes.filter(n => n.type !== 'GROUP');
    const nodesWithIncomingEdges = new Set(
      fixedEdges
        .filter(e => e.status === 'ENABLED' && e.fromNodeId && !groupIds.has(e.fromNodeId))
        .map(e => e.toNodeId)
        .filter(Boolean)
    );
    
    const topLevelInputs = runtimeNodes
      .filter(n => n.type === 'INPUT' && !nodesWithIncomingEdges.has(n.id));
    
    if (topLevelInputs.length > 0) {
      fixedRootNodeIds = topLevelInputs.map(n => n.id);
    } else if (runtimeNodes.length > 0) {
      // Fallback: if there are runtime nodes but no clear top-level ones, use first INPUT
      const firstInput = runtimeNodes.find(n => n.type === 'INPUT');
      if (firstInput) {
        fixedRootNodeIds = [firstInput.id];
      }
    }
  }

  return {
    ...tree,
    nodes: fixedNodes,
    edges: fixedEdges,
    rootNodeIds: fixedRootNodeIds,
  };
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

  // Part C: GROUP nodes are not runtime nodes - don't add to rootNodeIds
  // ensureTreeInvariants will populate roots when options are added
  const patch = {
    ...tree,
    nodes: [...nodes, newNode],
    edges,
    rootNodeIds: Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [],
  };

  return {
    patch: ensureTreeInvariants(patch),
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
 * Create patch to update an option node
 */
export function createUpdateOptionPatch(
  treeJson: unknown,
  optionId: string,
  updates: {
    label?: string;
    description?: string;
    type?: string;
    required?: boolean;
    defaultValue?: any;
    choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number }>;
    constraints?: any;
  }
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== optionId) return n;

    const updated = { ...n };
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

    if (updates.required !== undefined && updated.input) {
      updated.input = { ...updated.input, required: updates.required };
    }

    if (updates.defaultValue !== undefined && updated.input) {
      updated.input = { ...updated.input, defaultValue: updates.defaultValue };
    }

    if (updates.constraints !== undefined && updated.input) {
      updated.input = { ...updated.input, constraints: updates.constraints };
    }

    if (updates.choices !== undefined) {
      updated.choices = updates.choices;
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

  return {
    patch: {
      nodes: updatedNodes,
      edges,
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
  updates: { label?: string; value?: string; description?: string; weightOz?: number }
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
      if (updates.weightOz !== undefined) {
        // Part C: Support weightOz on choices
        updated.weightOz = updates.weightOz >= 0 ? updates.weightOz : undefined;
      }
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

  return {
    patch: {
      nodes: updatedNodes,
      edges,
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

  return {
    patch: {
      nodes: updatedNodes,
      edges,
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

  return {
    patch: {
      nodes: updatedNodes,
      edges,
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

  // Part B: Create INPUT node with proper selectionKey in input field
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
      selectionKey, // Critical: selectionKey must be in input field
    },
    pricingImpact: [],
    weightImpact: [],
  };

  // Part B: Create edge with proper status and no invalid condition
  const newEdge: PBV2Edge = {
    id: newEdgeId,
    status: 'ENABLED',
    fromNodeId: groupId,
    toNodeId: newOptionId,
    priority: 0,
    // Part B: Omit condition entirely (no {} placeholder)
  };

  const patch = {
    ...tree,
    nodes: [...nodes, newNode],
    edges: [...edges, newEdge],
  };

  // Part E: Apply invariants to ensure rootNodeIds is correct
  return {
    patch: ensureTreeInvariants(patch),
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

  return {
    patch: {
      nodes: updatedNodes,
      edges: updatedEdges,
    },
  };
}

/**
 * Create patch to duplicate an option
 */
export function createDuplicateOptionPatch(
  treeJson: unknown,
  groupId: string,
  optionId: string
): { patch: any; newOptionId: string } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  const existingIds = new Set([...nodes.map(n => n.id), ...edges.map(e => e.id)]);

  const sourceNode = nodes.find(n => n.id === optionId);
  if (!sourceNode) {
    throw new Error(`Option ${optionId} not found`);
  }

  // Deep copy the node with new ID
  const newOptionId = makeId('opt_', existingIds);
  const newEdgeId = makeId('edge_', existingIds);
  const newSelectionKey = `option_${Date.now()}`;
  
  // Part D: Duplicate must have NEW selectionKey to avoid collisions
  const duplicatedNode: PBV2Node = {
    ...JSON.parse(JSON.stringify(sourceNode)),
    id: newOptionId,
    key: newSelectionKey,
    label: sourceNode.label ? `${sourceNode.label} (Copy)` : 'New Option (Copy)',
  };

  // Part D: Ensure selectionKey is in input field, not just top level
  if (duplicatedNode.type === 'INPUT' && duplicatedNode.input) {
    duplicatedNode.input = {
      ...duplicatedNode.input,
      selectionKey: newSelectionKey,
    };
  }

  // Create edge from group to new option
  const newEdge: PBV2Edge = {
    id: newEdgeId,
    status: 'ENABLED',
    fromNodeId: groupId,
    toNodeId: newOptionId,
    priority: 0,
    // Part B: No condition placeholder
  };

  const patch = {
    ...tree,
    nodes: [...nodes, duplicatedNode],
    edges: [...edges, newEdge],
  };

  // Part E: Apply invariants
  return {
    patch: ensureTreeInvariants(patch),
    newOptionId,
  };
}

/**
 * Create patch to reorder options within a group
 */
export function createReorderOptionsPatch(
  treeJson: unknown,
  groupId: string,
  fromIndex: number,
  toIndex: number
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Get edges for this group
  const groupEdges = edges.filter(e => e.fromNodeId === groupId && e.status !== 'DELETED');
  
  // Reorder the edges
  const reordered = [...groupEdges];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  // Update priorities
  const updatedEdges = edges.map(e => {
    if (e.fromNodeId !== groupId || e.status === 'DELETED') return e;
    
    const newIndex = reordered.findIndex(re => re.id === e.id);
    if (newIndex === -1) return e;
    
    return { ...e, priority: newIndex };
  });

  return {
    patch: {
      nodes,
      edges: updatedEdges,
    },
  };
}

/**
 * Create patch to move an option between groups
 */
export function createMoveOptionPatch(
  treeJson: unknown,
  fromGroupId: string,
  toGroupId: string,
  optionId: string
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  // Update the edge that connects to this option
  const updatedEdges = edges.map(e => {
    if (e.toNodeId === optionId && e.fromNodeId === fromGroupId) {
      return { 
        ...e, 
        fromNodeId: toGroupId,
        status: 'ENABLED', // ensureTreeInvariants will fix if toGroupId is GROUP
      };
    }
    return e;
  });

  const patch = {
    ...tree,
    nodes,
    edges: updatedEdges,
  };

  // Part D & E: Apply invariants to handle rootNodeIds and edge status
  return {
    patch: ensureTreeInvariants(patch),
  };
}

/**
 * Apply a patch to tree JSON (replaces nodes/edges)
 * Part E: Enforce invariants at the boundary after every patch application
 */
export function applyPatchToTree(treeJson: unknown, patch: any): any {
  const tree = asRecord(treeJson) ? { ...(treeJson as any) } : {};

  // Copy over patch properties (nodes, edges, rootNodeIds, meta, etc.)
  Object.keys(patch).forEach(key => {
    if (patch[key] !== undefined) {
      tree[key] = patch[key];
    }
  });

  // Part E: Apply invariants to ensure tree validity
  return ensureTreeInvariants(tree);
}

/**
 * Part D: Create patch to update product base weight
 */
export function createUpdateBaseWeightPatch(
  treeJson: unknown,
  baseWeightOz?: number
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);
  
  const updatedMeta = {
    ...(tree.meta || {}),
    baseWeightOz: baseWeightOz !== undefined && baseWeightOz >= 0 ? baseWeightOz : undefined,
  };

  return {
    patch: {
      nodes,
      edges,
      meta: updatedMeta,
    },
  };
}

/**
 * Part D: Create patch to add a weight impact rule to a node
 */
export function createAddWeightImpactPatch(
  treeJson: unknown,
  nodeId: string
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const existingImpacts = Array.isArray(n.weightImpact) ? n.weightImpact : [];
    const newImpact = {
      mode: 'addFlat' as const,
      oz: 0,
      label: '',
    };

    return {
      ...n,
      weightImpact: [...existingImpacts, newImpact],
    };
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges,
    },
  };
}

/**
 * Part D: Create patch to update a weight impact rule
 */
export function createUpsertWeightImpactPatch(
  treeJson: unknown,
  nodeId: string,
  index: number,
  updates: { mode?: 'addFlat' | 'addPerQty' | 'addPerSqft'; oz?: number; label?: string }
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const impacts = Array.isArray(n.weightImpact) ? [...n.weightImpact] : [];
    if (index < 0 || index >= impacts.length) return n;

    impacts[index] = {
      ...impacts[index],
      ...updates,
    };

    return {
      ...n,
      weightImpact: impacts,
    };
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges,
    },
  };
}

/**
 * Part D: Create patch to delete a weight impact rule
 */
export function createDeleteWeightImpactPatch(
  treeJson: unknown,
  nodeId: string,
  index: number
): { patch: any } {
  const { tree, nodes, edges } = normalizeArrays(treeJson);

  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;

    const impacts = Array.isArray(n.weightImpact) ? [...n.weightImpact] : [];
    impacts.splice(index, 1);

    return {
      ...n,
      weightImpact: impacts.length > 0 ? impacts : undefined,
    };
  });

  return {
    patch: {
      nodes: updatedNodes,
      edges,
    },
  };
}
