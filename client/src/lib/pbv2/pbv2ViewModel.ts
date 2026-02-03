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
    label?: string;
    description?: string;
    type?: string;
    required?: boolean;
    defaultValue?: any;
    choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number }>;
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
  const selectionKey = `option_${Date.now()}`;

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
    },
    pricingImpact: [],
    weightImpact: [],
  };

  const newEdge: PBV2Edge = {
    id: newEdgeId,
    status: 'ENABLED',
    fromNodeId: groupId,
    toNodeId: newOptionId,
    priority: 0,
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

  if (patch.nodes !== undefined) {
    tree.nodes = patch.nodes;
  }
  if (patch.edges !== undefined) {
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

  // 2. INPUT valueType auto-repair
  for (const node of nodes) {
    if (node.status === 'DELETED') continue;
    if (node.type?.toUpperCase() !== 'INPUT') continue;

    const input = node.input ?? {};
    const inputType = input.type?.toLowerCase();
    
    // Check if valueType is missing or unknown
    let currentValueType = (input as any).valueType;
    if (!currentValueType || typeof currentValueType !== 'string') {
      // Infer valueType from input.type
      let newValueType = 'string'; // default
      
      switch (inputType) {
        case 'boolean':
          newValueType = 'boolean';
          break;
        case 'number':
          newValueType = 'number';
          break;
        case 'dimension':
          newValueType = 'dimension';
          break;
        case 'select':
        case 'multiselect':
        case 'text':
        case 'textarea':
        default:
          newValueType = 'string';
          break;
      }

      if (!node.input) node.input = {};
      (node.input as any).valueType = newValueType;
      mutated = true;
    }
  }

  // 3. Edge condition validity
  for (const edge of edges) {
    if (edge.status === 'DELETED') continue;
    
    const condition = edge.condition;
    
    // Check if condition is present but invalid (not null, undefined, or a valid object)
    if (condition !== null && condition !== undefined) {
      // Simple validation: condition should be an object with 'op' field
      const isValidCondition = 
        typeof condition === 'object' && 
        condition !== null && 
        'op' in condition &&
        typeof (condition as any).op === 'string';
      
      if (!isValidCondition) {
        // Replace with null for unconditional
        edge.condition = null;
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

    // Also check if FROM node is a GROUP (edges FROM group nodes should be disabled in runtime)
    const fromNode = edge.fromNodeId ? nodesById.get(edge.fromNodeId) : null;
    if (fromNode && fromNode.type?.toUpperCase() === 'GROUP') {
      // GROUP nodes can have ENABLED edges in authoring (they represent the group's options)
      // This is actually OK - don't disable
      // The runtime evaluator will handle this properly
    }
  }

  // 5. Root auto-repair - ensure rootNodeIds points to at least one ENABLED runtime node
  const rootNodeIds = Array.isArray((tree as any).rootNodeIds) ? (tree as any).rootNodeIds : [];
  
  // Find valid runtime nodes (ENABLED, non-GROUP, non-DELETED)
  const validRuntimeNodes = nodes.filter(n => 
    n.status === 'ENABLED' && 
    n.type?.toUpperCase() !== 'GROUP' &&
    n.type?.toUpperCase() !== 'DELETED'
  );

  // Check if current roots are valid
  const validRoots = rootNodeIds.filter((id: string) => {
    const node = nodesById.get(id);
    return node && 
           node.status === 'ENABLED' && 
           node.type?.toUpperCase() !== 'GROUP';
  });

  if (validRoots.length === 0 && validRuntimeNodes.length > 0) {
    // No valid roots, set to first available enabled runtime node
    (tree as any).rootNodeIds = [validRuntimeNodes[0].id];
    mutated = true;
  } else if (validRoots.length === 0 && validRuntimeNodes.length === 0) {
    // No valid nodes at all, clear roots
    (tree as any).rootNodeIds = [];
    mutated = true;
  } else if (validRoots.length < rootNodeIds.length) {
    // Some roots were invalid, keep only valid ones
    (tree as any).rootNodeIds = validRoots;
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
