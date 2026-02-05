/**
 * PBV2 Product Builder Section - Refactored with new 3-column UI
 * 
 * This component is the container that:
 * - Fetches draft/active tree data
 * - Manages selection state and local edits
 * - Handles save/publish/validate mutations
 * - Feeds the presentational PBV2ProductBuilderLayout
 * 
 * CRITICAL: All edits operate on draft only. Publish is the only TEMP -> PERMANENT transition.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { stringifyPbv2TreeJson } from "@shared/pbv2/starterTree";
import { buildSymbolTable } from "@shared/pbv2/symbolTable";
import { pbv2ToPricingAddons, pbv2ToWeightTotal } from "@shared/pbv2/pricingAdapter";
import type { Finding } from "@shared/pbv2/findings";
import type { ValidationResult } from "@shared/pbv2/validator/types";

/**
 * Edit-time validation - checks structure without publish-only rules.
 * Does NOT enforce:
 * - Tree status must be DRAFT (allows any status during editing)
 * - Other publish-gate checks
 */
function validateForEdit(tree: any): ValidationResult {
  if (!tree || typeof tree !== 'object') {
    return {
      ok: false,
      findings: [{ severity: 'ERROR', code: 'INVALID_TREE', message: 'Tree is not an object', path: 'tree' }] as any,
      errors: [{ severity: 'ERROR', code: 'INVALID_TREE', message: 'Tree is not an object', path: 'tree' }] as any,
      warnings: [],
      info: [],
    };
  }

  // Use publish validator but filter out publish-only errors
  const publishResult = validateTreeForPublish(tree, DEFAULT_VALIDATE_OPTS);
  
  // Filter out publish-only validation errors
  const publishOnlyCodes = [
    'PBV2_E_TREE_STATUS_INVALID', // Don't enforce DRAFT status during editing
  ];
  
  const filteredFindings = publishResult.findings.filter(
    (f: any) => !publishOnlyCodes.includes(f.code)
  );
  const filteredErrors = filteredFindings.filter((f: any) => f.severity === 'ERROR');
  const filteredWarnings = filteredFindings.filter((f: any) => f.severity === 'WARNING');
  const filteredInfo = filteredFindings.filter((f: any) => f.severity === 'INFO');
  
  return {
    ok: filteredErrors.length === 0,
    findings: filteredFindings,
    errors: filteredErrors,
    warnings: filteredWarnings,
    info: filteredInfo,
  };
}

/**
 * SINGLE POINT OF TREE UPDATE - ensures all mutations go through normalization.
 * This function enforces the invariant that localTreeJson is always normalized.
 * 
 * @param nextTree - Raw tree after mutation
 * @param reason - Description of why update is happening (for dev logging)
 * @param setLocalTreeJson - State setter
 * @param setHasLocalChanges - State setter
 */
function applyTreeUpdate(
  nextTree: any,
  reason: string,
  setLocalTreeJson: (tree: any) => void,
  setHasLocalChanges: (val: boolean) => void
) {
  // Always normalize before setting state
  const normalizedTree = normalizeTreeJson(nextTree);
  
  // DEV-ONLY: Instrument edge normalization for debugging
  if (import.meta.env.DEV) {
    const edges = Array.isArray(normalizedTree?.edges) ? normalizedTree.edges : [];
    console.log(`[applyTreeUpdate] ${reason}:`, {
      edgeCount: edges.length,
      rootCount: Array.isArray(normalizedTree?.rootNodeIds) ? normalizedTree.rootNodeIds.length : 0,
    });
    
    // Log all ENABLED edges to track condition normalization
    edges.forEach((edge: any) => {
      if (edge && (edge.status || 'ENABLED').toUpperCase() === 'ENABLED') {
        console.log(`  Edge ${edge.id}:`, {
          status: edge.status,
          hasCondition: !!edge.condition,
          conditionType: typeof edge.condition,
          conditionOp: edge.condition?.op,
          from: edge.fromNodeId,
          to: edge.toNodeId,
        });
      }
    });
  }
  
  setLocalTreeJson(normalizedTree);
  setHasLocalChanges(true);
}
import { PBV2ProductBuilderLayout } from "@/components/pbv2/builder-v2/PBV2ProductBuilderLayout";
import { ConfirmationModal } from "@/components/pbv2/builder-v2/ConfirmationModal";
import {
  pbv2TreeToEditorModel,
  createAddGroupPatch,
  createUpdateGroupPatch,
  createDeleteGroupPatch,
  createAddOptionPatch,
  createUpdateOptionPatch,
  createDeleteOptionPatch,
  createAddChoicePatch,
  createUpdateChoicePatch,
  createDeleteChoicePatch,
  createReorderChoicePatch,
  createUpdateNodePricingPatch,
  createAddPricingRulePatch,
  createDeletePricingRulePatch,
  createUpdatePricingV2BasePatch,
  createUpdatePricingV2UnitSystemPatch,
  createAddPricingV2TierPatch,
  createUpdatePricingV2TierPatch,
  createDeletePricingV2TierPatch,
  applyPatchToTree,
  ensureRootNodeIds,
  normalizeTreeJson,
} from "@/lib/pbv2/pbv2ViewModel";
import type { EditorOptionGroup } from "@/lib/pbv2/pbv2ViewModel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Pbv2TreeVersion = {
  id: string;
  organizationId: string;
  productId: string;
  status: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
  schemaVersion: number;
  treeJson: unknown;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TreeResponse = {
  success: boolean;
  data?: { draft: Pbv2TreeVersion | null; active: Pbv2TreeVersion | null };
  message?: string;
};

type Envelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  findings?: Finding[];
  requiresWarningsConfirm?: boolean;
};

async function readJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function apiJson<T>(method: string, url: string, body?: unknown): Promise<{ status: number; ok: boolean; json: Envelope<T> }>{
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await readJsonSafe(res)) as Envelope<T>;
  return { status: res.status, ok: res.ok, json };
}

function envelopeMessage(status: number, json: any, fallback: string) {
  if (json?.message && typeof json.message === "string") return json.message;
  if (json?.error && typeof json.error === "string") return json.error;
  if (json?.raw && typeof json.raw === "string") return json.raw;
  return `${fallback} (${status})`;
}

export default function PBV2ProductBuilderSectionV2({ 
  productId,
  onPbv2StateChange 
}: { 
  productId?: string | null;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
}) {
  const { toast } = useToast();
  const { isAdmin: isAdminUser } = useAuth();

  // Core state
  const [localTreeJson, setLocalTreeJson] = useState<unknown>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);

  // Modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteGroupConfirmOpen, setDeleteGroupConfirmOpen] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ id: string; name: string } | null>(null);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");

  // Fetch draft/active tree (skip for new products without productId)
  const treeQuery = useQuery<TreeResponse>({
    queryKey: ["/api/products", productId, "pbv2", "tree"],
    enabled: !!productId,
    queryFn: async () => {
      if (!productId) {
        return { success: false, message: "No productId" } as TreeResponse;
      }
      if (import.meta.env.DEV) {
        console.log('[PBV2ProductBuilderSectionV2] Fetching tree from GET /api/products/:id/pbv2/tree');
      }
      const res = await fetch(`/api/products/${productId}/pbv2/tree`, { credentials: "include" });
      const json = (await readJsonSafe(res)) as any;
      if (!res.ok) {
        return { success: false, message: envelopeMessage(res.status, json, "Failed to load PBV2") } as TreeResponse;
      }
      if (import.meta.env.DEV) {
        const draft = json?.data?.draft;
        const nodeCount = draft?.treeJson ? Object.keys((draft.treeJson as any)?.nodes || {}).length : 0;
        console.log('[PBV2ProductBuilderSectionV2] Fetched tree response:', {
          hasDraft: !!draft,
          draftId: draft?.id || null,
          nodeCount,
          schemaVersion: (draft?.treeJson as any)?.schemaVersion,
        });
      }
      return json as TreeResponse;
    },
  });

  const draft = treeQuery.data?.data?.draft ?? null;
  const active = treeQuery.data?.data?.active ?? null;

  // Initialize local tree from draft OR create empty tree for new products
  useEffect(() => {
    // New product mode: Initialize with seed tree containing runtime entry node
    if (!productId) {
      if (import.meta.env.DEV) {
        console.log('[PBV2_INIT] start (mode: local-only, new product)');
      }
      
      // CRITICAL: Seed tree must have at least one ENABLED runtime node for rootNodeIds
      // We create a base computed node as the entry point for the evaluator
      const baseNodeId = 'node_base_entry';
      const seedTree = {
        schemaVersion: 2,
        status: 'DRAFT',
        nodes: {
          [baseNodeId]: {
            id: baseNodeId,
            kind: 'computed',
            type: 'COMPUTE',
            status: 'ENABLED',
            key: 'base',
            label: 'Base Entry',
            description: 'Base entry node',
            compute: {
              expression: { op: 'literal', value: 0 },
              outputs: { value: { type: 'number' } },
            },
          },
        },
        edges: [],
        rootNodeIds: [baseNodeId], // Runtime node as root
        productName: 'New Product',
        category: 'General',
        sku: '',
        basePrice: 0,
        fulfillment: 'pickup-only',
      };
      
      const normalizedSeed = normalizeTreeJson(seedTree);
      if (import.meta.env.DEV) {
        const nc = Object.keys((normalizedSeed as any)?.nodes || {}).length;
        const rc = Array.isArray((normalizedSeed as any)?.rootNodeIds) ? (normalizedSeed as any).rootNodeIds.length : 0;
        console.log('[PBV2_INIT] seedTree created:', { nodeCount: nc, rootCount: rc, rootNodeIds: (normalizedSeed as any)?.rootNodeIds });
        console.log('[PBV2_INIT] READY (new product)');
      }
      
      setLocalTreeJson(normalizedSeed);
      setHasLocalChanges(false);
      return;
    }

    // Existing product mode: Load from server draft or seed new tree
    if (!draft) {
      if (import.meta.env.DEV) {
        console.log('[PBV2_INIT] start (mode: server, no draft exists)');
      }
      
      // No draft exists yet - create seed tree with runtime node
      const baseNodeId = 'node_base_entry';
      const seedTree = {
        schemaVersion: 2,
        status: 'DRAFT',
        nodes: {
          [baseNodeId]: {
            id: baseNodeId,
            kind: 'computed',
            type: 'COMPUTE',
            status: 'ENABLED',
            key: 'base',
            label: 'Base Entry',
            description: 'Base entry node',
            compute: {
              expression: { op: 'literal', value: 0 },
              outputs: { value: { type: 'number' } },
            },
          },
        },
        edges: [],
        rootNodeIds: [baseNodeId],
        productName: 'New Product',
        category: 'General',
        sku: '',
        basePrice: 0,
        fulfillment: 'pickup-only',
      };
      
      const normalizedSeed = normalizeTreeJson(seedTree);
      if (import.meta.env.DEV) {
        const nc = Object.keys((normalizedSeed as any)?.nodes || {}).length;
        const rc = Array.isArray((normalizedSeed as any)?.rootNodeIds) ? (normalizedSeed as any).rootNodeIds.length : 0;
        console.log('[PBV2_INIT] seedTree created:', { nodeCount: nc, rootCount: rc, rootNodeIds: (normalizedSeed as any)?.rootNodeIds });
        console.log('[PBV2_INIT] READY (no draft, seeded)');
      }
      
      setLocalTreeJson(normalizedSeed);
      setHasLocalChanges(false);
      return;
    }

    // Only initialize if we don't have local changes
    if (!hasLocalChanges) {
      if (import.meta.env.DEV) {
        console.log('[PBV2_INIT] start (mode: server, gotDraft: yes)');
        const nodeCount = draft.treeJson ? Object.keys((draft.treeJson as any)?.nodes || {}).length : 0;
        const groupCount = draft.treeJson ? Object.values((draft.treeJson as any)?.nodes || {}).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length : 0;
        const rootCount = Array.isArray((draft.treeJson as any)?.rootNodeIds) ? (draft.treeJson as any).rootNodeIds.length : 0;
        console.log('[PBV2ProductBuilderSectionV2] Initializing from draft (HYDRATION):', {
          draftId: draft.id,
          nodeCount,
          groupCount,
          rootCount,
          schemaVersion: (draft.treeJson as any)?.schemaVersion,
          rootNodeIds: (draft.treeJson as any)?.rootNodeIds,
          hasRootNodeIds: rootCount > 0,
        });
        if (nodeCount > 0 && rootCount === 0) {
          console.error('[PBV2ProductBuilderSectionV2] ⚠️ HYDRATION ISSUE: Tree has nodes but rootNodeIds is empty!');
        }
      }
      // Normalize + repair rootNodeIds on hydration (enforce canonical rules)
      const normalizedDraft = normalizeTreeJson(draft.treeJson);
      if (import.meta.env.DEV) {
        const nc = Object.keys((normalizedDraft as any)?.nodes || {}).length;
        const rc = Array.isArray((normalizedDraft as any)?.rootNodeIds) ? (normalizedDraft as any).rootNodeIds.length : 0;
        console.log(`[PBV2ProductBuilderSectionV2] Normalized & hydrated: nodes=${nc}, roots=${rc}`);
        console.log('[PBV2_INIT] READY (draft loaded)');
      }
      setLocalTreeJson(normalizedDraft);
    }
  }, [productId, draft?.id, draft?.treeJson, hasLocalChanges]);

  // Build editor model from local tree
  const editorModel = useMemo(() => {
    if (!localTreeJson) {
      return {
        productMeta: {
          name: 'Untitled Product',
          category: 'General',
          sku: '',
          status: 'draft' as const,
          fulfillment: 'pickup-only' as const,
          basePrice: 0,
        },
        groups: [],
        options: {},
        tags: {
          groupPricing: new Set<string>(),
          groupProduction: new Set<string>(),
          groupConditionals: new Set<string>(),
        },
      };
    }

    const model = pbv2TreeToEditorModel(localTreeJson);
    
    if (import.meta.env.DEV) {
      const treeNodes = (localTreeJson as any)?.nodes || {};
      const groupNodesInTree = Object.entries(treeNodes)
        .filter(([_, n]: [string, any]) => n.type?.toUpperCase() === 'GROUP')
        .map(([id, n]: [string, any]) => ({ id, label: n.label || n.key || id }));
      
      console.log('[PBV2_DEBUG_EDITOR_MODEL]', {
        treeNodeCount: Object.keys(treeNodes).length,
        groupNodesInTree,
        groupNodesInTreeCount: groupNodesInTree.length,
        editorModelGroupsCount: model.groups.length,
        editorModelGroups: model.groups.map(g => ({ id: g.id, name: g.name })),
        mismatch: groupNodesInTree.length !== model.groups.length,
      });
    }
    
    return model;
  }, [localTreeJson]);

  // Validate current tree (edit-time validation, not publish-time)
  // Only run validation once tree is initialized
  const validationResult = useMemo(() => {
    if (!localTreeJson) return { ok: true, errors: [], warnings: [], findings: [] };
    try {
      return validateForEdit(localTreeJson as any);
    } catch (err) {
      return { ok: false, errors: [{ severity: 'ERROR', message: String(err), code: 'VALIDATION_ERROR', path: 'tree' }], warnings: [], findings: [] };
    }
  }, [localTreeJson]);

  useEffect(() => {
    setFindings(validationResult.findings as any);
  }, [validationResult.findings]);

  // Notify parent of PBV2 state changes
  useEffect(() => {
    if (onPbv2StateChange) {
      // CRITICAL: Normalize + ensure rootNodeIds before sending to parent
      const normalizedTree = localTreeJson ? normalizeTreeJson(localTreeJson) : null;
      const nodeCount = normalizedTree ? Object.keys((normalizedTree as any)?.nodes || {}).length : 0;
      const rootCount = Array.isArray((normalizedTree as any)?.rootNodeIds) ? (normalizedTree as any).rootNodeIds.length : 0;
      
      if (import.meta.env.DEV) {
        const groupCount = normalizedTree ? Object.values((normalizedTree as any)?.nodes || {}).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length : 0;
        console.log('[PBV2ProductBuilderSectionV2] Calling onPbv2StateChange:', {
          nodeCount,
          groupCount,
          rootCount,
          hasChanges: hasLocalChanges,
          draftId: draft?.id ?? null,
          hasTreeJson: !!normalizedTree,
          rootNodeIds: (normalizedTree as any)?.rootNodeIds,
        });
      }
      onPbv2StateChange({
        treeJson: normalizedTree,
        hasChanges: hasLocalChanges,
        draftId: draft?.id ?? null,
      });
    }
  }, [localTreeJson, hasLocalChanges, draft?.id, onPbv2StateChange]);

  // Compute pricing preview
  const pricingPreview = useMemo(() => {
    if (!localTreeJson) return null;

    try {
      const symbolTable = buildSymbolTable(localTreeJson as any, { pathBase: "tree" });
      
      // Simplified preview environment
      const previewEnv = {
        widthIn: 24,
        heightIn: 36,
        quantity: 500,
        sqft: (24 * 36) / 144,
        perimeterIn: 2 * (24 + 36),
      };

      const selections = {}; // Empty selections for now

      const addOns = pbv2ToPricingAddons(localTreeJson as any, symbolTable.table, previewEnv, selections);
      
      return {
        addOnCents: addOns.addOnCents,
        breakdown: addOns.breakdown.map(item => ({
          label: item.kind || `Node ${item.nodeId}`,
          cents: item.amountCents,
        })),
      };
    } catch (err) {
      console.error('Pricing preview error:', err);
      return null;
    }
  }, [localTreeJson]);

  // Compute weight preview
  const weightPreview = useMemo(() => {
    if (!localTreeJson) return null;

    try {
      const result = pbv2ToWeightTotal({
        tree: localTreeJson as any,
        selections: { schemaVersion: 2, selected: {} },
        widthIn: 24,
        heightIn: 36,
        quantity: 500,
      });

      // Hide if no weight data
      if (result.totalOz === 0 && result.breakdown.length === 0) {
        return null;
      }

      return result;
    } catch (err) {
      console.error('Weight preview error:', err);
      return null;
    }
  }, [localTreeJson]);

  // Handlers
  const handleAddGroup = () => {
    if (!localTreeJson) return;
    
    const oldTreeRef = localTreeJson;
    const { patch, newGroupId } = createAddGroupPatch(localTreeJson);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    
    if (import.meta.env.DEV) {
      const groupCount = Object.values((updatedTree as any)?.nodes || {}).filter((n: any) => n.type?.toUpperCase() === 'GROUP').length;
      console.log('[PBV2_ADD_GROUP] groupId:', newGroupId, 'totalGroups:', groupCount);
      
      // CRITICAL DEBUG: Prove group was actually added
      const oldNodes = (oldTreeRef as any)?.nodes || {};
      const newNodes = (updatedTree as any)?.nodes || {};
      const oldNodeCount = Object.keys(oldNodes).length;
      const newNodeCount = Object.keys(newNodes).length;
      const groupNodesInNew = Object.entries(newNodes)
        .filter(([_, n]: [string, any]) => n.type?.toUpperCase() === 'GROUP')
        .map(([id, n]: [string, any]) => ({ id, label: n.label || n.key || id, type: n.type }));
      
      console.log('[PBV2_DEBUG_AFTER_ADD_GROUP]', {
        oldTreeRef_equals_newTreeRef: oldTreeRef === updatedTree,
        oldNodeCount,
        newNodeCount,
        nodeCountIncreased: newNodeCount > oldNodeCount,
        groupNodesInNew,
        newGroupIdExists: !!newNodes[newGroupId],
        newGroupNode: newNodes[newGroupId],
      });
    }
    
    applyTreeUpdate(updatedTree, 'handleAddGroup', setLocalTreeJson, setHasLocalChanges);
    setSelectedGroupId(newGroupId);
    toast({ title: "Group added" });
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateGroupPatch(localTreeJson, groupId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateGroup', setLocalTreeJson, setHasLocalChanges);
  };

  const handleDeleteGroup = (groupId: string) => {
    const group = editorModel.groups.find(g => g.id === groupId);
    setDeleteGroupTarget({ id: groupId, name: group?.name || 'this group' });
    setDeleteGroupConfirmOpen(true);
  };

  const handleConfirmDeleteGroup = () => {
    if (!deleteGroupTarget || !localTreeJson) return;
    const { patch } = createDeleteGroupPatch(localTreeJson, deleteGroupTarget.id);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleConfirmDeleteGroup', setLocalTreeJson, setHasLocalChanges);
    if (selectedGroupId === deleteGroupTarget.id) {
      setSelectedGroupId(null);
    }
    toast({ title: "Group deleted" });
    setDeleteGroupConfirmOpen(false);
    setDeleteGroupTarget(null);
  };

  const handleAddOption = (groupId: string) => {
    if (!localTreeJson) return;
    const { patch, newOptionId } = createAddOptionPatch(localTreeJson, groupId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddOption', setLocalTreeJson, setHasLocalChanges);
    toast({ title: "Option added" });
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteOptionPatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeleteOption', setLocalTreeJson, setHasLocalChanges);
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    toast({ title: "Option deleted" });
  };

  const handleUpdateOption = (optionId: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateOptionPatch(localTreeJson, optionId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateOption', setLocalTreeJson, setHasLocalChanges);
  };

  const handleAddChoice = (optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createAddChoicePatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddChoice', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdateChoice = (optionId: string, choiceValue: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateChoicePatch(localTreeJson, optionId, choiceValue, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateChoice', setLocalTreeJson, setHasLocalChanges);
  };

  const handleDeleteChoice = (optionId: string, choiceValue: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteChoicePatch(localTreeJson, optionId, choiceValue);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeleteChoice', setLocalTreeJson, setHasLocalChanges);
  };

  const handleReorderChoice = (optionId: string, fromIndex: number, toIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createReorderChoicePatch(localTreeJson, optionId, fromIndex, toIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleReorderChoice', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdateNodePricing = (
    optionId: string,
    pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>
  ) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateNodePricingPatch(localTreeJson, optionId, pricingImpact);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateNodePricing', setLocalTreeJson, setHasLocalChanges);
  };

  const handleAddPricingRule = (
    optionId: string,
    rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }
  ) => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingRulePatch(localTreeJson, optionId, rule);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddPricingRule', setLocalTreeJson, setHasLocalChanges);
  };

  const handleDeletePricingRule = (optionId: string, ruleIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingRulePatch(localTreeJson, optionId, ruleIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeletePricingRule', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdatePricingV2Base = (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2BasePatch(localTreeJson, base);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2Base', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdatePricingV2UnitSystem = (unitSystem: 'imperial' | 'metric') => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2UnitSystemPatch(localTreeJson, unitSystem);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2UnitSystem', setLocalTreeJson, setHasLocalChanges);
  };

  const handleAddPricingV2Tier = (kind: 'qty' | 'sqft') => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingV2TierPatch(localTreeJson, kind);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddPricingV2Tier', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdatePricingV2Tier = (kind: 'qty' | 'sqft', index: number, tier: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2TierPatch(localTreeJson, kind, index, tier);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2Tier', setLocalTreeJson, setHasLocalChanges);
  };

  const handleDeletePricingV2Tier = (kind: 'qty' | 'sqft', index: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingV2TierPatch(localTreeJson, kind, index);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeletePricingV2Tier', setLocalTreeJson, setHasLocalChanges);
  };

  const handleUpdateProduct = (updates: any) => {
    if (!localTreeJson) return;
    const tree = JSON.parse(JSON.stringify(localTreeJson));
    if (updates.name !== undefined) tree.productName = updates.name;
    if (updates.category !== undefined) tree.category = updates.category;
    if (updates.sku !== undefined) tree.sku = updates.sku;
    if (updates.fulfillment !== undefined) tree.fulfillment = updates.fulfillment;
    if (updates.basePrice !== undefined) tree.basePrice = updates.basePrice;
    applyTreeUpdate(tree, 'handleUpdateProduct', setLocalTreeJson, setHasLocalChanges);
  };

  const handleSave = async () => {
    if (!localTreeJson) {
      toast({ title: "No tree data to save", variant: "destructive" });
      return;
    }

    // Local-only mode: No productId yet (new product not saved)
    if (!productId) {
      toast({ 
        title: "Saved locally", 
        description: "Options will be persisted when you save the product.",
      });
      return;
    }

    // Normalize + ensure rootNodeIds before PUT (client has authority over this field)
    const normalizedTree = normalizeTreeJson(localTreeJson);
    const nodes = (normalizedTree as any)?.nodes || {};
    const edges = Array.isArray((normalizedTree as any)?.edges) ? (normalizedTree as any).edges : [];
    const nodeCount = Object.keys(nodes).length;
    const edgeCount = edges.length;
    const rootCount = Array.isArray((normalizedTree as any)?.rootNodeIds) ? (normalizedTree as any).rootNodeIds.length : 0;

    // DEV-ONLY: Log PUT details before sending
    if (import.meta.env.DEV) {
      console.log('[PBV2 PUT] nodeCount', nodeCount, 'edgeCount', edgeCount, 'rootCount', rootCount);
      console.log('[PBV2 PUT] computedRootNodeIds', (normalizedTree as any)?.rootNodeIds);
      console.log('[PBV2 PUT] sendingRootNodeIds', (normalizedTree as any)?.rootNodeIds);
      console.log('[PBV2 PUT] body', { treeJson: normalizedTree });
    }

    try {
      const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: normalizedTree });

      if (!result.ok || result.json.success !== true) {
        throw new Error(envelopeMessage(result.status, result.json, "Failed to save draft"));
      }

      toast({ title: "Draft saved" });
      setHasLocalChanges(false);
      await treeQuery.refetch();

      // HARD FAIL CHECK: Verify draft exists after refetch
      const refetchedData = treeQuery.data;
      if (!refetchedData?.data?.draft) {
        toast({ 
          title: "PBV2 draft did not persist", 
          description: "No DB row after save", 
          variant: "destructive" 
        });
        setHasLocalChanges(true); // Keep unsaved state
      }
    } catch (error: any) {
      toast({ title: "Draft save failed", description: error.message, variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    if (!draft) {
      toast({ title: "No draft to publish", variant: "destructive" });
      return;
    }

    // Run STRICT publish validation (not edit validation)
    const publishValidation = validateTreeForPublish(localTreeJson as any, DEFAULT_VALIDATE_OPTS);

    // Check for errors
    if (publishValidation.errors.length > 0) {
      toast({ 
        title: "Cannot publish", 
        description: `${publishValidation.errors.length} error(s) must be fixed first.`,
        variant: "destructive" 
      });
      return;
    }

    // If warnings exist, show confirmation
    if (publishValidation.warnings.length > 0) {
      setConfirmOpen(true);
      return;
    }

    // No warnings, publish directly
    await performPublish(false);
  };

  const performPublish = async (confirmWarnings: boolean) => {
    if (!draft) return;

    try {
      const qs = confirmWarnings ? "?confirmWarnings=true" : "";
      const res = await fetch(`/api/pbv2/tree-versions/${draft.id}/publish${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const json = (await readJsonSafe(res)) as any;

      if (!res.ok) {
        throw new Error(envelopeMessage(res.status, json, "Publish failed"));
      }

      toast({ title: "Published successfully" });
      setHasLocalChanges(false);
      setConfirmOpen(false);
      await treeQuery.refetch();
    } catch (error: any) {
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    }
  };

  const handleExportJson = () => {
    if (!localTreeJson) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(stringifyPbv2TreeJson(localTreeJson));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `pbv2-tree-${productId}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    toast({ title: "JSON exported" });
  };

  const handleImportJson = () => {
    setJsonImportOpen(true);
    setJsonImportText("");
  };

  const handleConfirmImportJson = () => {
    try {
      const parsed = JSON.parse(jsonImportText);
      setLocalTreeJson(parsed);
      setHasLocalChanges(true);
      setJsonImportOpen(false);
      toast({ title: "JSON imported - remember to save" });
    } catch (err) {
      toast({ title: "Invalid JSON", description: String(err), variant: "destructive" });
    }
  };

  // Loading state for existing products only
  if (productId && treeQuery.isLoading) {
    return <div className="p-8 text-center text-slate-400">Loading PBV2 tree...</div>;
  }

  // Render UI once localTreeJson is initialized (seed tree or draft)
  // Never get stuck in "Initializing" - the useEffect above seeds the tree

  const canPublish = validationResult.errors.length === 0 && hasLocalChanges === false;

  return (
    <>
      <PBV2ProductBuilderLayout
        editorModel={editorModel}
        treeJson={localTreeJson}
        selectedGroupId={selectedGroupId}
        selectedOptionId={selectedOptionId}
        hasUnsavedChanges={hasLocalChanges}
        canPublish={canPublish}
        findings={findings}
        pricingPreview={pricingPreview}
        weightPreview={weightPreview}
        onSelectGroup={setSelectedGroupId}
        onSelectOption={setSelectedOptionId}
        onAddGroup={handleAddGroup}
        onDeleteGroup={handleDeleteGroup}
        onAddOption={handleAddOption}
        onDeleteOption={handleDeleteOption}
        onUpdateGroup={handleUpdateGroup}
        onUpdateOption={handleUpdateOption}
        onAddChoice={handleAddChoice}
        onUpdateChoice={handleUpdateChoice}
        onDeleteChoice={handleDeleteChoice}
        onReorderChoice={handleReorderChoice}
        onUpdateNodePricing={handleUpdateNodePricing}
        onAddPricingRule={handleAddPricingRule}
        onDeletePricingRule={handleDeletePricingRule}
        onUpdatePricingV2Base={handleUpdatePricingV2Base}
        onUpdatePricingV2UnitSystem={handleUpdatePricingV2UnitSystem}
        onAddPricingV2Tier={handleAddPricingV2Tier}
        onUpdatePricingV2Tier={handleUpdatePricingV2Tier}
        onDeletePricingV2Tier={handleDeletePricingV2Tier}
        onUpdateProduct={handleUpdateProduct}
        onSave={handleSave}
        onPublish={handlePublish}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
      />

      <ConfirmationModal
        open={deleteGroupConfirmOpen}
        onOpenChange={setDeleteGroupConfirmOpen}
        title="Delete Group"
        description={`Are you sure you want to delete "${deleteGroupTarget?.name}"? This will also delete all options in this group.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDeleteGroup}
        variant="danger"
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#1e293b] border-[#334155] text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Publish with Warnings?</DialogTitle>
            <DialogDescription className="text-slate-300">
              {validationResult.warnings.length} warning(s) found. Publishing will make this tree ACTIVE.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {validationResult.warnings.map((w, i) => (
              <div key={i} className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                {w.message}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => performPublish(true)} className="bg-blue-600 hover:bg-blue-700">
              Confirm Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={jsonImportOpen} onOpenChange={setJsonImportOpen}>
        <DialogContent className="bg-[#1e293b] border-[#334155] text-slate-200 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Import JSON</DialogTitle>
            <DialogDescription className="text-slate-300">
              Paste PBV2 tree JSON. This will replace the current draft (you can revert if not saved).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={jsonImportText}
            onChange={(e) => setJsonImportText(e.target.value)}
            className="font-mono text-sm h-96 bg-[#0f172a] border-[#334155] text-slate-100"
            placeholder="{&#10;  &quot;status&quot;: &quot;DRAFT&quot;,&#10;  &quot;rootNodeIds&quot;: [...],&#10;  ...&#10;}"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setJsonImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImportJson} className="bg-blue-600 hover:bg-blue-700">
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
