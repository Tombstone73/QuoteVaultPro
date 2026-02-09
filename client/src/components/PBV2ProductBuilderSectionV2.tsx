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

import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  setHasLocalChanges: (val: boolean) => void,
  setIsLocalDirty: (val: boolean) => void
) {
  // Always normalize before setting state
  const normalizedTree = normalizeTreeJson(nextTree);
  
  // DEV: Critical diagnostic logging including edge conditions
  if (import.meta.env.DEV) {
    const nodes = normalizedTree?.nodes || {};
    const nodeValues = Array.isArray(nodes) ? nodes : Object.values(nodes);
    const groupNodes = nodeValues.filter((n: any) => n?.type?.toUpperCase() === 'GROUP');
    const edges = Array.isArray(normalizedTree?.edges) ? normalizedTree.edges : [];
    
    // Check edge conditions for validation debugging
    const invalidEdges = edges.filter((e: any) => {
      if (!e.condition) return true;
      if (typeof e.condition !== 'object') return true;
      if (typeof e.condition.op !== 'string') return true;
      return false;
    });
    
    // RUNTIME ASSERTION: All ENABLED edges must have valid condition after normalization
    const enabledEdgesWithInvalidCondition = edges.filter((e: any) => {
      const status = (e.status || 'ENABLED').toUpperCase();
      if (status !== 'ENABLED') return false;
      if (!e.condition || typeof e.condition !== 'object') return true;
      if (typeof e.condition.op !== 'string') return true;
      return false;
    });
    
    if (enabledEdgesWithInvalidCondition.length > 0) {
      console.error('[PBV2_EDGE_CONDITION_ERROR] ENABLED edges with invalid condition after normalization:', {
        reason,
        invalidCount: enabledEdgesWithInvalidCondition.length,
        edges: enabledEdgesWithInvalidCondition,
      });
    }
    
    console.log(`[PBV2_APPLY_TREE_UPDATE] ${reason}:`, {
      nodeCount: nodeValues.length,
      groupCount: groupNodes.length,
      edgeCount: edges.length,
      invalidEdgeCount: invalidEdges.length,
      invalidEdgeIds: invalidEdges.map((e: any) => e.id),
      rootCount: Array.isArray(normalizedTree?.rootNodeIds) ? normalizedTree.rootNodeIds.length : 0,
    });
    
    if (invalidEdges.length > 0) {
      console.error('[PBV2_INVALID_EDGES_DETECTED]', invalidEdges.map((e: any) => ({
        id: e.id,
        status: e.status,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        conditionType: typeof e.condition,
        conditionOp: e.condition?.op,
        condition: e.condition,
      })));
    }
  }
  
  setLocalTreeJson(normalizedTree);
  setHasLocalChanges(true);
  setIsLocalDirty(true); // Lock against server overwrites
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
  onPbv2StateChange,
  onPbv2PricingDataChange,
  onTreeProviderReady,
  onClearDirtyReady,
}: {
  productId?: string | null;
  onPbv2StateChange?: (state: { treeJson: unknown; hasChanges: boolean; draftId: string | null }) => void;
  onPbv2PricingDataChange?: (data: {
    pricingPreview: { addOnCents: number; breakdown: Array<{ label: string; cents: number }> } | null;
    weightPreview: { totalOz: number; breakdown: Array<{ label: string; oz: number }> } | null;
    findings: any[];
  }) => void;
  onTreeProviderReady?: (provider: { getCurrentTree: () => unknown | null }) => void;
  onClearDirtyReady?: (clearDirty: () => void) => void;
}) {
  const { toast } = useToast();
  const { isAdmin: isAdminUser } = useAuth();
  const queryClient = useQueryClient();

  // Core state
  const [localTreeJson, setLocalTreeJson] = useState<unknown>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  
  // Ref mirror for localTreeJson to avoid stale closure in getCurrentPBV2Tree
  const localTreeJsonRef = useRef<unknown>(null);
  
  // Dirty lock: Prevent server sync from overwriting local edits
  const [isLocalDirty, setIsLocalDirty] = useState(false);
  const lastLoadedProductIdRef = useRef<string | null | undefined>(null);
  
  // Hydration guard: Prevent stale async responses from overwriting newer state
  const hydrateRequestIdRef = useRef<number>(0);
  
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

  // Expose method to get current tree for external persistence (product creation)
  // CRITICAL: Reads from ref, not state, to avoid stale closure
  const getCurrentPBV2Tree = () => {
    if (!localTreeJsonRef.current) return null;
    return normalizeTreeJson(localTreeJsonRef.current);
  };

  // Keep ref in sync with state
  useEffect(() => {
    localTreeJsonRef.current = localTreeJson;
  }, [localTreeJson]);

  // Register tree provider IMMEDIATELY (synchronous) to prevent race condition
  // This ensures the provider is available when parent calls getCurrentTree during save
  const providerRegistered = useRef(false);
  if (!providerRegistered.current && onTreeProviderReady) {
    onTreeProviderReady({ getCurrentTree: getCurrentPBV2Tree });
    providerRegistered.current = true;
    if (import.meta.env.DEV) {
      console.log('[PBV2] Tree provider registered (sync)');
    }
  }

  // Register clearDirty callback IMMEDIATELY (synchronous)
  // This ensures parent can clear dirty state after successful save
  const clearDirtyRegistered = useRef(false);
  if (!clearDirtyRegistered.current && onClearDirtyReady) {
    onClearDirtyReady(() => {
      setHasLocalChanges(false);
      setIsLocalDirty(false);
      if (import.meta.env.DEV) {
        console.log('[PBV2_CLEAR_DIRTY] hasLocalChanges=false, isLocalDirty=false');
      }
    });
    clearDirtyRegistered.current = true;
    if (import.meta.env.DEV) {
      console.log('[PBV2] clearDirty callback registered (sync)');
    }
  }

  // Diagnostic logging on key state changes
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[PBV2_INIT_STATE]', {
        productId,
        hasDraft: !!draft,
        hasLocal: !!localTreeJson,
        isLocalDirty,
        lastLoadedProductId: lastLoadedProductIdRef.current,
      });
    }
  }, [productId, draft, localTreeJson, isLocalDirty]);

  // Initialize local tree from draft OR create empty tree for new products
  useEffect(() => {
    // DIRTY LOCK: Only block sync if localTreeJson is already populated AND productId hasn't changed
    // CRITICAL: Allow hydration when localTreeJson is null, even if isLocalDirty is true
    if (isLocalDirty && localTreeJson && lastLoadedProductIdRef.current === productId) {
      if (import.meta.env.DEV) {
        console.log('[PBV2_SYNC_BLOCKED]', {
          reason: 'Local edits in progress, blocking server sync',
          productId,
          isLocalDirty,
          hasLocalTree: !!localTreeJson,
        });
      }
      return;
    }
    
    // Product changed - reset dirty flag and allow hydration
    if (lastLoadedProductIdRef.current !== productId && productId) {
      if (import.meta.env.DEV) {
        console.log('[PBV2_PRODUCT_CHANGED]', {
          oldProductId: lastLoadedProductIdRef.current,
          newProductId: productId,
        });
      }
      lastLoadedProductIdRef.current = productId ?? null;
      setIsLocalDirty(false);
    }
    
    // New product mode: Initialize with seed tree containing runtime entry node
    if (!productId) {
      
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
        console.log('[PBV2_SEED] New product initialized:', { mode: 'new', nodeCount: nc });
      }
      
      setLocalTreeJson(normalizedSeed);
      setHasLocalChanges(false);
      return;
    }

    // Existing product mode: Load from server draft or seed new tree
    if (!draft) {
      
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
        console.log('[PBV2_SEED] Existing product initialized:', { mode: 'no-draft', productId, nodeCount: nc });
      }
      
      setLocalTreeJson(normalizedSeed);
      setHasLocalChanges(false);
      return;
    }

    // Draft exists - hydrate from server
    const normalizedDraft = normalizeTreeJson(draft.treeJson);
    if (import.meta.env.DEV) {
      const nc = Object.keys((normalizedDraft as any)?.nodes || {}).length;
      const gc = Object.values((normalizedDraft as any)?.nodes || {}).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length;
      console.log('[PBV2_HYDRATE] Draft loaded:', { productId, draftId: draft.id, nodes: nc, groups: gc });
    }
    
    setLocalTreeJson(normalizedDraft);
    // CRITICAL: Clear dirty flag after hydration - user hasn't made changes yet
    setHasLocalChanges(false);
    
    if (import.meta.env.DEV) {
      console.log('[PBV2_HYDRATE] Dirty flag cleared after draft load');
    }
  }, [productId, draft?.id, draft?.treeJson, isLocalDirty]);

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

    return pbv2TreeToEditorModel(localTreeJson);
  }, [localTreeJson]);

  // SELECTION INVARIANT GUARD: Clear stale selection after any tree mutation
  // This prevents crashes when hard-deleted nodes leave behind stale selectedGroupId/selectedOptionId.
  // Runs after editorModel recomputes (which depends on localTreeJson).
  useEffect(() => {
    const groupIds = new Set(editorModel.groups.map(g => g.id));
    const optionIds = new Set(Object.keys(editorModel.options));

    if (selectedGroupId && !groupIds.has(selectedGroupId)) {
      if (import.meta.env.DEV) {
        console.warn('[PBV2_SELECTION_GUARD] Clearing stale selectedGroupId:', selectedGroupId);
      }
      setSelectedGroupId(null);
      // Also clear option since its parent group is gone
      if (selectedOptionId) setSelectedOptionId(null);
      return;
    }

    if (selectedOptionId && !optionIds.has(selectedOptionId)) {
      if (import.meta.env.DEV) {
        console.warn('[PBV2_SELECTION_GUARD] Clearing stale selectedOptionId:', selectedOptionId);
      }
      setSelectedOptionId(null);
      return;
    }

    // Validate option belongs to selected group (edge integrity)
    if (selectedGroupId && selectedOptionId) {
      const group = editorModel.groups.find(g => g.id === selectedGroupId);
      if (group && !group.optionIds.includes(selectedOptionId)) {
        if (import.meta.env.DEV) {
          console.warn('[PBV2_SELECTION_GUARD] Option not in selected group, clearing:', selectedOptionId);
        }
        setSelectedOptionId(null);
      }
    }
  }, [editorModel, selectedGroupId, selectedOptionId]);

  // Validate current tree (edit-time validation, not publish-time)
  // Only run validation once tree is initialized
  const validationResult = useMemo(() => {
    if (!localTreeJson) return { ok: true, errors: [], warnings: [], findings: [] };
    
    // CRITICAL: Validate NORMALIZED tree to ensure edges have valid conditions
    const normalizedTree = normalizeTreeJson(localTreeJson);
    
    try {
      return validateForEdit(normalizedTree as any);
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

  // Notify parent of pricing/validation data changes for page-level pricing panel
  useEffect(() => {
    if (onPbv2PricingDataChange) {
      onPbv2PricingDataChange({
        pricingPreview,
        weightPreview,
        findings
      });
    }
  }, [pricingPreview, weightPreview, findings, onPbv2PricingDataChange]);

  // Handlers
  const handleAddGroup = () => {
    console.error('[PBV2_ADD_GROUP_HANDLER] called', { hasTree: !!localTreeJson, time: Date.now() });
    
    if (!localTreeJson) {
      console.error('[PBV2_ADD_GROUP_ERROR] No tree available');
      toast({ title: "Add Group failed", description: "No tree available. See console.", variant: "destructive" });
      return;
    }
    
    try {
      const oldTreeRef = localTreeJson;
      
      // Count groups before
      const oldNodes = (oldTreeRef as any)?.nodes || {};
      const beforeGroups = Object.values(oldNodes).filter((n: any) => n.type?.toUpperCase() === 'GROUP').length;
      
      console.error('[PBV2_ADD_GROUP_BEFORE]', { beforeGroups, totalNodes: Object.keys(oldNodes).length });
      
      const { patch, newGroupId } = createAddGroupPatch(localTreeJson);
      const updatedTree = applyPatchToTree(localTreeJson, patch);
      
      // Count groups after patch
      const newNodes = (updatedTree as any)?.nodes || {};
      const afterGroups = Object.values(newNodes).filter((n: any) => n.type?.toUpperCase() === 'GROUP').length;
      
      console.error('[PBV2_ADD_GROUP_AFTER_PATCH]', {
        afterGroups,
        totalNodes: Object.keys(newNodes).length,
        groupAdded: afterGroups > beforeGroups,
        newGroupId,
        newGroupExists: !!newNodes[newGroupId],
        newGroupNode: newNodes[newGroupId]
      });
      
      if (afterGroups <= beforeGroups) {
        console.error('[PBV2_ADD_GROUP_ERROR] Group count did not increase', { beforeGroups, afterGroups });
        toast({ title: "Add Group failed", description: `Groups: ${beforeGroups} → ${afterGroups}. See console.`, variant: "destructive" });
        return;
      }
      
      applyTreeUpdate(updatedTree, 'handleAddGroup', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
      setSelectedGroupId(newGroupId);
      toast({ title: "Group added" });
      
    } catch (err) {
      console.error('[PBV2_ADD_GROUP_ERROR]', err);
      toast({ title: "Add Group failed", description: "Exception thrown. See console.", variant: "destructive" });
    }
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateGroupPatch(localTreeJson, groupId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateGroup', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
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
    applyTreeUpdate(updatedTree, 'handleConfirmDeleteGroup', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
    
    // Clear selection if deleted group was selected
    if (selectedGroupId === deleteGroupTarget.id) {
      setSelectedGroupId(null);
    }
    // Check if selected option was in deleted group (cascade cleanup)
    if (selectedOptionId) {
      const deletedGroup = editorModel.groups.find(g => g.id === deleteGroupTarget.id);
      if (deletedGroup?.optionIds.includes(selectedOptionId)) {
        setSelectedOptionId(null);
      }
    }
    
    toast({ title: "Group deleted" });
    setDeleteGroupConfirmOpen(false);
    setDeleteGroupTarget(null);
  };

  const handleAddOption = (groupId: string) => {
    if (!localTreeJson) return;
    const { patch, newOptionId } = createAddOptionPatch(localTreeJson, groupId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    
    // DEV: Diagnostic logging for edge condition after patch
    if (import.meta.env.DEV) {
      const edges = Array.isArray((updatedTree as any)?.edges) ? (updatedTree as any).edges : [];
      const newEdges = edges.filter((e: any) => e.toNodeId === newOptionId);
      newEdges.forEach((e: any) => {
        console.log('[PBV2_EDGE_CONDITION_AFTER_ADD_OPTION]', {
          edgeId: e.id,
          status: e.status,
          conditionType: typeof e.condition,
          conditionOp: e.condition?.op,
          condition: e.condition,
        });
      });
    }
    
    applyTreeUpdate(updatedTree, 'handleAddOption', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
    toast({ title: "Option added" });
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteOptionPatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeleteOption', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
    
    // Clear selection if deleted option was selected
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    
    toast({ title: "Option deleted" });
  };

  const handleUpdateOption = (optionId: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateOptionPatch(localTreeJson, optionId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateOption', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleAddChoice = (optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createAddChoicePatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddChoice', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdateChoice = (optionId: string, choiceValue: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateChoicePatch(localTreeJson, optionId, choiceValue, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateChoice', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleDeleteChoice = (optionId: string, choiceValue: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteChoicePatch(localTreeJson, optionId, choiceValue);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeleteChoice', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleReorderChoice = (optionId: string, fromIndex: number, toIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createReorderChoicePatch(localTreeJson, optionId, fromIndex, toIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleReorderChoice', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdateNodePricing = (
    optionId: string,
    pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>
  ) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateNodePricingPatch(localTreeJson, optionId, pricingImpact);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdateNodePricing', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleAddPricingRule = (
    optionId: string,
    rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }
  ) => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingRulePatch(localTreeJson, optionId, rule);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddPricingRule', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleDeletePricingRule = (optionId: string, ruleIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingRulePatch(localTreeJson, optionId, ruleIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeletePricingRule', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdatePricingV2Base = (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2BasePatch(localTreeJson, base);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2Base', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdatePricingV2UnitSystem = (unitSystem: 'imperial' | 'metric') => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2UnitSystemPatch(localTreeJson, unitSystem);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2UnitSystem', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleAddPricingV2Tier = (kind: 'qty' | 'sqft') => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingV2TierPatch(localTreeJson, kind);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleAddPricingV2Tier', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdatePricingV2Tier = (kind: 'qty' | 'sqft', index: number, tier: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2TierPatch(localTreeJson, kind, index, tier);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleUpdatePricingV2Tier', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleDeletePricingV2Tier = (kind: 'qty' | 'sqft', index: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingV2TierPatch(localTreeJson, kind, index);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    applyTreeUpdate(updatedTree, 'handleDeletePricingV2Tier', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
  };

  const handleUpdateProduct = (updates: any) => {
    if (!localTreeJson) return;
    const tree = JSON.parse(JSON.stringify(localTreeJson));
    if (updates.name !== undefined) tree.productName = updates.name;
    if (updates.category !== undefined) tree.category = updates.category;
    if (updates.sku !== undefined) tree.sku = updates.sku;
    if (updates.fulfillment !== undefined) tree.fulfillment = updates.fulfillment;
    if (updates.basePrice !== undefined) tree.basePrice = updates.basePrice;
    applyTreeUpdate(tree, 'handleUpdateProduct', setLocalTreeJson, setHasLocalChanges, setIsLocalDirty);
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

      if (import.meta.env.DEV) {
        console.log('[PBV2_DRAFT_PUT] success:', { productId, nodeCount, edgeCount, rootCount });
      }
      
      toast({ title: "Draft saved" });
      setHasLocalChanges(false);
      setIsLocalDirty(false); // Clear dirty flag on successful save
      
      // Update query cache with saved tree to prevent stale refetch
      queryClient.setQueryData(
        ["/api/products", productId, "pbv2", "tree"],
        (old: any) => {
          if (!old?.data?.draft) return old;
          return {
            ...old,
            data: {
              ...old.data,
              draft: {
                ...old.data.draft,
                treeJson: normalizedTree,
              }
            }
          };
        }
      );
      
      await treeQuery.refetch();

      // HARD FAIL CHECK: Verify draft exists after refetch
      const refetchedData = treeQuery.data;
      if (!refetchedData?.data?.draft) {
        if (import.meta.env.DEV) {
          console.error('[PBV2_DRAFT_PUT] failed: draft row not found after save');
        }
        toast({ 
          title: "PBV2 draft did not persist", 
          description: "No DB row after save", 
          variant: "destructive" 
        });
        setHasLocalChanges(true); // Keep unsaved state
      }
    } catch (error: any) {
      if (import.meta.env.DEV) {
        console.error('[PBV2_DRAFT_PUT] failed:', error.message);
      }
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
