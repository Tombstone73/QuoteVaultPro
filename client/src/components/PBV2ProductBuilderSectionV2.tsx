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
import { pbv2ToPricingAddons } from "@shared/pbv2/pricingAdapter";
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

export default function PBV2ProductBuilderSectionV2({ productId }: { productId: string }) {
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
      const res = await fetch(`/api/products/${productId}/pbv2/tree`, { credentials: "include" });
      const json = (await readJsonSafe(res)) as any;
      if (!res.ok) {
        return { success: false, message: envelopeMessage(res.status, json, "Failed to load PBV2") } as TreeResponse;
      }
      return json as TreeResponse;
    },
  });

  const draft = treeQuery.data?.data?.draft ?? null;
  const active = treeQuery.data?.data?.active ?? null;

  // Initialize local tree from draft
  useEffect(() => {
    if (!draft) {
      setLocalTreeJson(null);
      setHasLocalChanges(false);
      return;
    }

    // Only initialize if we don't have local changes
    if (!hasLocalChanges) {
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
    return (
      <div className="p-8 text-center">
        <div className="text-slate-400 mb-4">No draft exists for this product.</div>
        <Button onClick={() => window.location.reload()}>Create Draft</Button>
      </div>
    );
  }

  const canPublish = validationResult.errors.length === 0 && hasLocalChanges === false;

  return (
    <>
      <PBV2ProductBuilderLayout
        editorModel={editorModel}
        selectedGroupId={selectedGroupId}
        selectedOptionId={selectedOptionId}
        hasUnsavedChanges={hasLocalChanges}
        canPublish={canPublish}
        findings={findings}
        pricingPreview={pricingPreview}
        onSelectGroup={setSelectedGroupId}
        onSelectOption={setSelectedOptionId}
        onAddGroup={handleAddGroup}
        onDeleteGroup={handleDeleteGroup}
        onAddOption={handleAddOption}
        onDeleteOption={handleDeleteOption}
        onUpdateGroup={handleUpdateGroup}
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
