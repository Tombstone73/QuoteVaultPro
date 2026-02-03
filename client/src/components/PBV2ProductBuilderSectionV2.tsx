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
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish, validateTreeForDraft } from "@shared/pbv2/validator";
import { stringifyPbv2TreeJson } from "@shared/pbv2/starterTree";
import { buildSymbolTable } from "@shared/pbv2/symbolTable";
import { pbv2ToPricingAddons, pbv2ToWeightTotal } from "@shared/pbv2/pricingAdapter";
import { createEmptyOptionTreeV2 } from "@shared/optionTreeV2";
import type { Finding } from "@shared/pbv2/findings";
import { PBV2ProductBuilderLayout } from "@/components/pbv2/builder-v2/PBV2ProductBuilderLayout";
import { ConfirmationModal } from "@/components/pbv2/builder-v2/ConfirmationModal";
import {
  pbv2TreeToEditorModel,
  createAddGroupPatch,
  createUpdateGroupPatch,
  createDeleteGroupPatch,
  createAddOptionPatch,
  createDuplicateOptionPatch,
  createUpdateOptionPatch,
  createDeleteOptionPatch,
  createReorderOptionsPatch,
  createMoveOptionPatch,
  createAddChoicePatch,
  createUpdateChoicePatch,
  createDeleteChoicePatch,
  createReorderChoicePatch,
  createUpdateBaseWeightPatch,
  createAddWeightImpactPatch,
  createUpsertWeightImpactPatch,
  createDeleteWeightImpactPatch,
  applyPatchToTree,
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
  draftTreeJson,
  onDraftChange,
}: { 
  productId?: string;
  draftTreeJson?: unknown;
  onDraftChange?: (tree: unknown) => void;
}) {
  const { toast } = useToast();
  const { isAdmin: isAdminUser } = useAuth();

  // Core state
  const [localTreeJson, setLocalTreeJson] = useState<unknown>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [publishAttempted, setPublishAttempted] = useState(false); // Part D: Track publish attempts

  // Modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteGroupConfirmOpen, setDeleteGroupConfirmOpen] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ id: string; name: string } | null>(null);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");

  // Draft mode: Use provided draft tree instead of fetching from server
  const isDraftMode = !productId;

  // Fetch draft/active tree (only if we have a productId)
  const treeQuery = useQuery<TreeResponse>({
    queryKey: ["/api/products", productId, "pbv2", "tree"],
    enabled: !isDraftMode && !!productId,
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/pbv2/tree`, { credentials: "include" });
      const json = (await readJsonSafe(res)) as any;
      if (!res.ok) {
        return { success: false, message: envelopeMessage(res.status, json, "Failed to load PBV2") } as TreeResponse;
      }
      return json as TreeResponse;
    },
  });

  const draft = isDraftMode ? null : (treeQuery.data?.data?.draft ?? null);
  const active = isDraftMode ? null : (treeQuery.data?.data?.active ?? null);

  // Initialize local tree from draft or provided draftTreeJson
  useEffect(() => {
    if (isDraftMode) {
      // Draft mode: use provided draftTreeJson
      if (!draftTreeJson) {
        const emptyTree = createEmptyOptionTreeV2();
        setLocalTreeJson(emptyTree);
        return;
      }

      // Runtime migration: handle legacy arrays
      let safeTreeJson = draftTreeJson;
      if (Array.isArray(draftTreeJson)) {
        console.warn('[PBV2 Draft Mode] Legacy array tree, migrating to empty OptionTreeV2');
        safeTreeJson = createEmptyOptionTreeV2();
      } else if (!draftTreeJson || typeof draftTreeJson !== 'object') {
        console.warn('[PBV2 Draft Mode] Invalid tree JSON, using empty OptionTreeV2');
        safeTreeJson = createEmptyOptionTreeV2();
      }

      setLocalTreeJson(safeTreeJson);
      return;
    }

    // Server mode: use fetched draft
    if (!draft) {
      setLocalTreeJson(null);
      setHasLocalChanges(false);
      return;
    }

    // Only initialize if we don't have local changes
    if (!hasLocalChanges) {
      // Runtime migration: handle legacy arrays in database
      let safeTreeJson = draft.treeJson;
      
      if (Array.isArray(draft.treeJson)) {
        console.warn(`[PBV2] Product ${draft.productId}: Legacy array tree in DB, migrating to empty OptionTreeV2`);
        safeTreeJson = createEmptyOptionTreeV2();
        // Mark as dirty so user can save the migrated version
        setHasLocalChanges(true);
      } else if (!draft.treeJson || typeof draft.treeJson !== 'object') {
        console.warn(`[PBV2] Product ${draft.productId}: Invalid tree JSON in DB, using empty OptionTreeV2`);
        safeTreeJson = createEmptyOptionTreeV2();
        setHasLocalChanges(true);
      }
      
      setLocalTreeJson(safeTreeJson);
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

  // Validate current tree (use draft validation - less strict during editing)
  const validationResult = useMemo(() => {
    if (!localTreeJson) return { errors: [], warnings: [], findings: [] };
    try {
      return validateTreeForDraft(localTreeJson as any, DEFAULT_VALIDATE_OPTS);
    } catch (err) {
      return { errors: [{ severity: 'ERROR', message: String(err), code: 'VALIDATION_ERROR', path: 'tree' }], warnings: [], findings: [] };
    }
  }, [localTreeJson]);

  useEffect(() => {
    setFindings(validationResult.findings as any);
  }, [validationResult.findings]);

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
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
    toast({ title: "Group added" });
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<EditorOptionGroup>) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateGroupPatch(localTreeJson, groupId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
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
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
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
    setSelectedOptionId(newOptionId);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
    toast({ title: "Option added" });
  };

  const handleDuplicateOption = (groupId: string, optionId: string) => {
    if (!localTreeJson) return;
    const { patch, newOptionId } = createDuplicateOptionPatch(localTreeJson, groupId, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    setSelectedOptionId(newOptionId);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
    toast({ title: "Option duplicated" });
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteOptionPatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
    
    // Smart fallback selection
    if (selectedOptionId === optionId) {
      const group = editorModel.groups.find(g => g.id === groupId);
      if (group && group.optionIds.length > 1) {
        const currentIndex = group.optionIds.indexOf(optionId);
        const nextIndex = currentIndex < group.optionIds.length - 1 ? currentIndex + 1 : currentIndex - 1;
        if (nextIndex >= 0 && group.optionIds[nextIndex] !== optionId) {
          setSelectedOptionId(group.optionIds[nextIndex]);
        } else {
          setSelectedOptionId(null);
        }
      } else {
        setSelectedOptionId(null);
      }
    }
    toast({ title: "Option deleted" });
  };

  const handleReorderOption = (groupId: string, fromIndex: number, toIndex: number) => {
    if (!localTreeJson || fromIndex === toIndex) return;
    const { patch } = createReorderOptionsPatch(localTreeJson, groupId, fromIndex, toIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleMoveOption = (fromGroupId: string, toGroupId: string, optionId: string) => {
    if (!localTreeJson || fromGroupId === toGroupId) return;
    const { patch } = createMoveOptionPatch(localTreeJson, fromGroupId, toGroupId, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
    toast({ title: "Option moved" });
  };

  const handleUpdateOption = (optionId: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateOptionPatch(localTreeJson, optionId, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleAddChoice = (optionId: string) => {
    if (!localTreeJson) return;
    const { patch } = createAddChoicePatch(localTreeJson, optionId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleUpdateChoice = (optionId: string, choiceValue: string, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateChoicePatch(localTreeJson, optionId, choiceValue, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleDeleteChoice = (optionId: string, choiceValue: string) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteChoicePatch(localTreeJson, optionId, choiceValue);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleReorderChoice = (optionId: string, fromIndex: number, toIndex: number) => {
    if (!localTreeJson) return;
    const { patch } = createReorderChoicePatch(localTreeJson, optionId, fromIndex, toIndex);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  // Part A: Base weight update handler
  const handleUpdateBaseWeight = (baseWeightOz?: number) => {
    if (!localTreeJson) return;
    const { patch } = createUpdateBaseWeightPatch(localTreeJson, baseWeightOz);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  // Part B: Weight impact handlers
  const handleAddWeightImpact = (nodeId: string) => {
    if (!localTreeJson) return;
    const { patch } = createAddWeightImpactPatch(localTreeJson, nodeId);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleUpdateWeightImpact = (nodeId: string, index: number, updates: any) => {
    if (!localTreeJson) return;
    const { patch } = createUpsertWeightImpactPatch(localTreeJson, nodeId, index, updates);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
  };

  const handleDeleteWeightImpact = (nodeId: string, index: number) => {
    if (!localTreeJson) return;
    const { patch } = createDeleteWeightImpactPatch(localTreeJson, nodeId, index);
    const updatedTree = applyPatchToTree(localTreeJson, patch);
    setLocalTreeJson(updatedTree);
    setHasLocalChanges(true);
    if (isDraftMode && onDraftChange) onDraftChange(updatedTree);
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
    if (isDraftMode) {
      toast({ title: "Draft mode", description: "Save the product first, then options will auto-save.", variant: "default" });
      return;
    }

    if (!draft || !localTreeJson) {
      toast({ title: "No draft to save", variant: "destructive" });
      return;
    }

    try {
      const result = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${draft.id}`, { treeJson: localTreeJson });

      if (!result.ok || result.json.success !== true) {
        throw new Error(envelopeMessage(result.status, result.json, "Failed to save draft"));
      }

      toast({ title: "Draft saved" });
      setHasLocalChanges(false);
      await treeQuery.refetch();
    } catch (error: any) {
      toast({ title: "Draft save failed", description: error.message, variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    // Part D: Mark that user attempted to publish
    setPublishAttempted(true);

    if (isDraftMode) {
      toast({ title: "Draft mode", description: "Save the product first to enable publish.", variant: "default" });
      return;
    }

    if (!draft) {
      toast({ title: "No draft to publish", variant: "destructive" });
      return;
    }

    // Part E: Run FULL publish validation (strict) when publish button is clicked
    const fullValidation = validateTreeForPublish(localTreeJson as any, DEFAULT_VALIDATE_OPTS);
    
    if (fullValidation.errors.length > 0) {
      toast({ 
        title: "Cannot publish", 
        description: `${fullValidation.errors.length} error(s) must be fixed first.`,
        variant: "destructive" 
      });
      return;
    }

    // If warnings exist, show confirmation
    if (fullValidation.warnings.length > 0) {
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

  if (!isDraftMode && treeQuery.isLoading) {
    return <div className="p-8 text-center text-slate-400">Loading PBV2 tree...</div>;
  }

  // In server mode, draft should exist (but don't gate on it - render empty if missing)
  // In draft mode, we always render using local state

  const canPublish = isDraftMode ? false : (validationResult.errors.length === 0 && hasLocalChanges === false);

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
        publishAttempted={publishAttempted}
        pricingPreview={pricingPreview}
        weightPreview={weightPreview}
        onSelectGroup={setSelectedGroupId}
        onSelectOption={setSelectedOptionId}
        onAddGroup={handleAddGroup}
        onDeleteGroup={handleDeleteGroup}
        onAddOption={handleAddOption}
        onDuplicateOption={handleDuplicateOption}
        onDeleteOption={handleDeleteOption}
        onReorderOption={handleReorderOption}
        onMoveOption={handleMoveOption}
        onUpdateGroup={handleUpdateGroup}
        onUpdateOption={handleUpdateOption}
        onAddChoice={handleAddChoice}
        onUpdateChoice={handleUpdateChoice}
        onDeleteChoice={handleDeleteChoice}
        onReorderChoice={handleReorderChoice}
        onUpdateProduct={handleUpdateProduct}
        onUpdateBaseWeight={handleUpdateBaseWeight}
        onAddWeightImpact={handleAddWeightImpact}
        onUpdateWeightImpact={handleUpdateWeightImpact}
        onDeleteWeightImpact={handleDeleteWeightImpact}
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
