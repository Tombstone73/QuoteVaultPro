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
  productId: string;
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

  // Fetch draft/active tree
  const treeQuery = useQuery<TreeResponse>({
    queryKey: ["/api/products", productId, "pbv2", "tree"],
    queryFn: async () => {
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

  // Initialize local tree from draft
  useEffect(() => {
    if (!draft) {
      if (import.meta.env.DEV) {
        console.log('[PBV2ProductBuilderSectionV2] No draft from API - setting localTreeJson to null (empty state)');
      }
      setLocalTreeJson(null);
      setHasLocalChanges(false);
      return;
    }

    // Only initialize if we don't have local changes
    if (!hasLocalChanges) {
      if (import.meta.env.DEV) {
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
      setLocalTreeJson(draft.treeJson);
    }
  }, [draft?.id, draft?.treeJson]);

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

  // Validate current tree
  const validationResult = useMemo(() => {
    if (!localTreeJson) return { errors: [], warnings: [], findings: [] };
    try {
      return validateTreeForPublish(localTreeJson as any, DEFAULT_VALIDATE_OPTS);
    } catch (err) {
      return { errors: [{ severity: 'ERROR', message: String(err), code: 'VALIDATION_ERROR', path: 'tree' }], warnings: [], findings: [] };
    }
  }, [localTreeJson]);

  useEffect(() => {
    setFindings(validationResult.findings as any);
  }, [validationResult.findings]);

  // Notify parent of PBV2 state changes
  useEffect(() => {
    if (onPbv2StateChange) {
      // CRITICAL: Ensure rootNodeIds is set before sending to parent
      const ensuredTree = localTreeJson ? ensureRootNodeIds(localTreeJson) : null;
      const nodeCount = ensuredTree ? Object.keys((ensuredTree as any)?.nodes || {}).length : 0;
      const rootCount = Array.isArray((ensuredTree as any)?.rootNodeIds) ? (ensuredTree as any).rootNodeIds.length : 0;
      
      if (import.meta.env.DEV) {
        const groupCount = ensuredTree ? Object.values((ensuredTree as any)?.nodes || {}).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length : 0;
        console.log('[PBV2ProductBuilderSectionV2] Calling onPbv2StateChange:', {
          nodeCount,
          groupCount,
          rootCount,
          hasChanges: hasLocalChanges,
          draftId: draft?.id ?? null,
          hasTreeJson: !!ensuredTree,
          rootNodeIds: (ensuredTree as any)?.rootNodeIds,
        });
      }
      onPbv2StateChange({
        treeJson: ensuredTree,
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
    const { patch, newGroupId } = createAddGroupPatch(localTreeJson);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    setSelectedGroupId(newGroupId);
    toast({ title: "Group added" });
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateGroupPatch(localTreeJson, groupId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
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
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
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
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    toast({ title: "Option added" });
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteOptionPatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    toast({ title: "Option deleted" });
  };

  const handleUpdateOption = (optionId: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateOptionPatch(localTreeJson, optionId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleAddChoice = (optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createAddChoicePatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdateChoice = (optionId: string, choiceValue: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateChoicePatch(localTreeJson, optionId, choiceValue, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleDeleteChoice = (optionId: string, choiceValue: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteChoicePatch(localTreeJson, optionId, choiceValue);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleReorderChoice = (optionId: string, fromIndex: number, toIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createReorderChoicePatch(localTreeJson, optionId, fromIndex, toIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdateNodePricing = (
    optionId: string,
    pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>
  ) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateNodePricingPatch(localTreeJson, optionId, pricingImpact);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleAddPricingRule = (
    optionId: string,
    rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }
  ) => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingRulePatch(localTreeJson, optionId, rule);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleDeletePricingRule = (optionId: string, ruleIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingRulePatch(localTreeJson, optionId, ruleIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdatePricingV2Base = (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2BasePatch(localTreeJson, base);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdatePricingV2UnitSystem = (unitSystem: 'imperial' | 'metric') => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2UnitSystemPatch(localTreeJson, unitSystem);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleAddPricingV2Tier = (kind: 'qty' | 'sqft') => {
    if (!localTreeJson) return;
    const { patch } = createAddPricingV2TierPatch(localTreeJson, kind);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdatePricingV2Tier = (kind: 'qty' | 'sqft', index: number, tier: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdatePricingV2TierPatch(localTreeJson, kind, index, tier);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleDeletePricingV2Tier = (kind: 'qty' | 'sqft', index: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeletePricingV2TierPatch(localTreeJson, kind, index);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
  };

  const handleUpdateProduct = (updates: any) => {
    if (!localTreeJson) return;
    const tree = JSON.parse(JSON.stringify(localTreeJson));
    if (updates.name !== undefined) tree.productName = updates.name;
    if (updates.category !== undefined) tree.category = updates.category;
    if (updates.sku !== undefined) tree.sku = updates.sku;
    if (updates.fulfillment !== undefined) tree.fulfillment = updates.fulfillment;
    if (updates.basePrice !== undefined) tree.basePrice = updates.basePrice;
    setLocalTreeJson(tree);
    setHasLocalChanges(true);
  };

  const handleSave = async () => {
    if (!localTreeJson) {
      toast({ title: "No tree data to save", variant: "destructive" });
      return;
    }

    try {
      const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: localTreeJson });

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

    // Check for errors
    if (validationResult.errors.length > 0) {
      toast({ 
        title: "Cannot publish", 
        description: `${validationResult.errors.length} error(s) must be fixed first.`,
        variant: "destructive" 
      });
      return;
    }

    // If warnings exist, show confirmation
    if (validationResult.warnings.length > 0) {
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

  if (treeQuery.isLoading) {
    return <div className="p-8 text-center text-slate-400">Loading PBV2 tree...</div>;
  }

  if (!draft) {
    const handleCreateDraft = async () => {
      try {
        // Create minimal valid empty draft
        const minimalTreeJson = {
          schemaVersion: 2,
          status: "DRAFT",
          rootNodeIds: [],
          nodes: {},
          edges: [],
          productName: "",
          category: "",
          sku: "",
          fulfillment: "fulfillment",
          basePrice: 0,
        };

        const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: minimalTreeJson });

        if (!result.ok || result.json.success !== true) {
          throw new Error(envelopeMessage(result.status, result.json, "Failed to create draft"));
        }

        toast({ title: "Draft created" });
        await treeQuery.refetch();
      } catch (error: any) {
        toast({ title: "Draft creation failed", description: error.message, variant: "destructive" });
      }
    };

    return (
      <div className="p-8 text-center">
        <div className="text-slate-400 mb-4">No draft exists for this product.</div>
        <Button onClick={handleCreateDraft}>Create Draft</Button>
      </div>
    );
  }

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
