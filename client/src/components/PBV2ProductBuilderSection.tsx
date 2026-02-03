import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Download, Upload, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish, validateTreeForRestore } from "@shared/pbv2/validator";
import { createPbv2BannerGrommetsTreeJson, createPbv2StarterTreeJson, stringifyPbv2TreeJson } from "@shared/pbv2/starterTree";
import { buildSymbolTable } from "@shared/pbv2/symbolTable";
import type { SymbolTable } from "@shared/pbv2/symbolTable";
import { buildVariableCatalog } from "@shared/pbv2/variableCatalog";
import { validateFormulaJson } from "@shared/pbv2/formulaValidation";
import { pbv2ToChildItemProposals, pbv2ToMaterialEffects, pbv2ToPricingAddons } from "@shared/pbv2/pricingAdapter";
import FormulaEditor from "@/components/FormulaEditor";
import LineItemRowEnterprise, { type LineItemEnterpriseRowModel } from "@/components/line-items/LineItemRowEnterprise";
import type { PBV2Outputs } from "@/lib/pbv2/pbv2Outputs";

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

type Finding = {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  path: string;
  entityId?: string;
  context?: Record<string, unknown>;
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

type Pbv2OverrideState = {
  enabled: boolean;
  treeVersionId: string | null;
  treeJsonText: string;
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

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  return value as any;
}

function normalizeTreeArrays(treeRaw: any): { tree: any; nodes: any[]; edges: any[] } {
  const t = asRecord(treeRaw) ? { ...(treeRaw as any) } : {};

  const nodesRaw = (t as any).nodes;
  let nodes: any[] = [];
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
  let edges: any[] = [];
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

function makeId(prefix: string, taken: Set<string>): string {
  const cryptoAny = (globalThis as any).crypto;
  for (let i = 0; i < 25; i++) {
    const suffix =
      typeof cryptoAny?.randomUUID === "function"
        ? cryptoAny.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const id = `${prefix}${suffix}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

export default function PBV2ProductBuilderSection({ 
  productId,
}: { 
  productId: string;
}) {
  const { toast } = useToast();
  const { isAdmin: isAdminUser } = useAuth();
  const [draftText, setDraftText] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastError, setLastError] = useState<string>("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [edgeEditorId, setEdgeEditorId] = useState<string>("");
  const [edgeEditStatus, setEdgeEditStatus] = useState<"ENABLED" | "DISABLED" | "DELETED">("ENABLED");
  const [edgeEditFrom, setEdgeEditFrom] = useState<string>("");
  const [edgeEditTo, setEdgeEditTo] = useState<string>("");
  const [edgeEditPriority, setEdgeEditPriority] = useState<string>("0");
  const [edgeEditConditionText, setEdgeEditConditionText] = useState<string>("");
  const [edgeFromNodeId, setEdgeFromNodeId] = useState<string>("");
  const [edgeToNodeId, setEdgeToNodeId] = useState<string>("");
  const [edgePriority, setEdgePriority] = useState<string>("0");
  const [edgeConditionJson, setEdgeConditionJson] = useState<string>("");

  const [formulaTarget, setFormulaTarget] = useState<
    "COMPUTE_EXPRESSION" | "PRICE_COMPONENT_QUANTITY" | "PRICE_COMPONENT_UNIT_PRICE" | "PRICE_COMPONENT_APPLIES_WHEN"
  >("COMPUTE_EXPRESSION");
  const [formulaNodeId, setFormulaNodeId] = useState<string>("");
  const [priceComponentIndex, setPriceComponentIndex] = useState<string>("0");
  const [formulaText, setFormulaText] = useState<string>("");

  const [previewWidthIn, setPreviewWidthIn] = useState<string>("");
  const [previewHeightIn, setPreviewHeightIn] = useState<string>("");
  const [previewQuantity, setPreviewQuantity] = useState<string>("");
  const [previewSqft, setPreviewSqft] = useState<string>("");
  const [previewPerimeterIn, setPreviewPerimeterIn] = useState<string>("");
  const [previewSelectionsText, setPreviewSelectionsText] = useState<string>("{}\n");
  const [previewError, setPreviewError] = useState<string>("");
  const [previewResult, setPreviewResult] = useState<{ addOnCents: number; breakdown: any[] } | null>(null);

  const [materialNodeId, setMaterialNodeId] = useState<string>("");
  const [materialEffectIndex, setMaterialEffectIndex] = useState<string>("0");
  const [materialSkuRef, setMaterialSkuRef] = useState<string>("");
  const [materialUom, setMaterialUom] = useState<string>("ea");
  const [materialQtyText, setMaterialQtyText] = useState<string>("{}\n");
  const [materialAppliesWhenText, setMaterialAppliesWhenText] = useState<string>("");

  const [previewMaterialsError, setPreviewMaterialsError] = useState<string>("");
  const [previewMaterialsResult, setPreviewMaterialsResult] = useState<{ materials: any[] } | null>(null);

  const [childNodeId, setChildNodeId] = useState<string>("");
  const [childEffectIndex, setChildEffectIndex] = useState<string>("0");
  const [childKind, setChildKind] = useState<"inlineSku" | "productRef">("inlineSku");
  const [childTitle, setChildTitle] = useState<string>("");
  const [childSkuRef, setChildSkuRef] = useState<string>("");
  const [childProductId, setChildProductId] = useState<string>("");
  const [childInvoiceVisibility, setChildInvoiceVisibility] = useState<"hidden" | "rollup" | "separateLine">("rollup");
  const [childQtyText, setChildQtyText] = useState<string>("{}\n");
  const [childUnitPriceText, setChildUnitPriceText] = useState<string>("{}\n");
  const [childAppliesWhenText, setChildAppliesWhenText] = useState<string>("");

  const [previewChildItemsError, setPreviewChildItemsError] = useState<string>("");
  const [previewChildItemsResult, setPreviewChildItemsResult] = useState<{ childItems: any[] } | null>(null);

  const [removeMaterialConfirmOpen, setRemoveMaterialConfirmOpen] = useState(false);
  const [removeMaterialTarget, setRemoveMaterialTarget] = useState<null | { nodeId: string; idx: number; summary: string }>(null);

  type InlineFinding = { severity: "ERROR" | "WARNING"; message: string };
  const [materialValidationByKey, setMaterialValidationByKey] = useState<Record<string, { findings: InlineFinding[] }>>({});
  const [materialRowExpandedByKey, setMaterialRowExpandedByKey] = useState<Record<string, boolean>>({});
  const [lastFormulaApplyFindings, setLastFormulaApplyFindings] = useState<null | { findings: InlineFinding[]; note?: string }>(null);

  const [removeChildConfirmOpen, setRemoveChildConfirmOpen] = useState(false);
  const [removeChildTarget, setRemoveChildTarget] = useState<null | { nodeId: string; idx: number; summary: string }>(null);
  const [childValidationByKey, setChildValidationByKey] = useState<Record<string, { findings: InlineFinding[] }>>({});
  const [childRowExpandedByKey, setChildRowExpandedByKey] = useState<Record<string, boolean>>({});

  // JSON Import/Export state
  const [jsonImportModalOpen, setJsonImportModalOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImportValidated, setJsonImportValidated] = useState(false);
  const [jsonImportFindings, setJsonImportFindings] = useState<Finding[]>([]);
  const [jsonImportError, setJsonImportError] = useState("");
  const [jsonImportSchemaVersion, setJsonImportSchemaVersion] = useState<string | null>(null);

  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(false);
  const [overrideTreeVersionId, setOverrideTreeVersionId] = useState<string | null>(null);
  const [overrideText, setOverrideText] = useState<string>("");
  const [overrideFindings, setOverrideFindings] = useState<Finding[]>([]);
  const [overrideLastMessage, setOverrideLastMessage] = useState<string>("");

  const treeQuery = useQuery<TreeResponse>({
    queryKey: ["/api/products", productId, "pbv2", "tree"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/pbv2/tree`, { credentials: "include" });
      const json = (await readJsonSafe(res)) as any;
      if (!res.ok) {
        return { success: false, message: envelopeMessage(res.status, json, "Failed to load PBV2") } as TreeResponse;
      }
      
      // DEV-ONLY: Log what API returned
      if (import.meta.env.DEV && json?.data?.draft?.treeJson) {
        const tree = json.data.draft.treeJson;
        const nodeCount = Object.keys(tree?.nodes || {}).length;
        const rootCount = Array.isArray(tree?.rootNodeIds) ? tree.rootNodeIds.length : 0;
        const edgeCount = Array.isArray(tree?.edges) ? tree.edges.length : 0;
        console.log('[PBV2ProductBuilderSection] API returned tree:', {
          endpoint: `/api/products/${productId}/pbv2/tree`,
          nodeCount,
          rootCount,
          edgeCount,
          schemaVersion: tree?.schemaVersion,
        });
      }
      
      return json as TreeResponse;
    },
  });

  const draft = treeQuery.data?.data?.draft ?? null;
  const active = treeQuery.data?.data?.active ?? null;

  const overrideQuery = useQuery<Pbv2OverrideState>({
    queryKey: ["/api/products", productId, "pbv2", "override"],
    enabled: Boolean(isAdminUser),
    queryFn: async () => {
      const { status, ok, json } = await apiJson<Pbv2OverrideState>("GET", `/api/products/${productId}/pbv2/override`);
      if (!ok || json?.success === false) {
        throw new Error(envelopeMessage(status, json, "Failed to load PBV2 override"));
      }
      return (json?.data ?? { enabled: false, treeVersionId: null, treeJsonText: "" }) as Pbv2OverrideState;
    },
  });

  useEffect(() => {
    if (!overrideQuery.data) return;
    setOverrideEnabled(Boolean(overrideQuery.data.enabled));
    setOverrideTreeVersionId(overrideQuery.data.treeVersionId ?? null);
    setOverrideText(String(overrideQuery.data.treeJsonText ?? ""));
    // Keep findings local to current validate/save actions.
  }, [overrideQuery.data?.enabled, overrideQuery.data?.treeVersionId, overrideQuery.data?.treeJsonText]);

  const validateOverrideMutation = useMutation({
    mutationFn: async () => {
      const { status, ok, json } = await apiJson<null>("POST", `/api/products/${productId}/pbv2/override/validate`, {
        treeJsonText: overrideText,
      });
      if (!ok) throw new Error(envelopeMessage(status, json, "Failed to validate override"));
      return json;
    },
    onSuccess: (json: any) => {
      setOverrideLastMessage(String(json?.message ?? "Validated"));
      setOverrideFindings(Array.isArray(json?.findings) ? (json.findings as Finding[]) : []);
      toast({ title: json?.success ? "Override valid" : "Override blocked", description: String(json?.message ?? "") });
    },
    onError: (error: Error) => toast({ title: "Override validation failed", description: error.message, variant: "destructive" }),
  });

  const saveOverrideMutation = useMutation({
    mutationFn: async () => {
      const { status, ok, json } = await apiJson<{ treeVersionId: string | null; enabled: boolean }>(
        "POST",
        `/api/products/${productId}/pbv2/override/save`,
        {
          treeJsonText: overrideText,
          enable: overrideEnabled,
        }
      );
      if (!ok) throw new Error(envelopeMessage(status, json, "Failed to save override"));
      return json;
    },
    onSuccess: (json: any) => {
      setOverrideLastMessage(String(json?.message ?? "Saved"));
      setOverrideFindings(Array.isArray(json?.findings) ? (json.findings as Finding[]) : []);
      toast({ title: "Override saved", description: String(json?.message ?? "") });
      overrideQuery.refetch();
    },
    onError: (error: Error) => toast({ title: "Override save failed", description: error.message, variant: "destructive" }),
  });

  const disableOverrideMutation = useMutation({
    mutationFn: async () => {
      const { status, ok, json } = await apiJson<{ enabled: boolean }>("POST", `/api/products/${productId}/pbv2/override/disable`);
      if (!ok) throw new Error(envelopeMessage(status, json, "Failed to disable override"));
      return json;
    },
    onSuccess: (json: any) => {
      setOverrideLastMessage(String(json?.message ?? "Disabled"));
      toast({ title: "Override disabled", description: String(json?.message ?? "") });
      overrideQuery.refetch();
    },
    onError: (error: Error) => toast({ title: "Disable failed", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!draft) {
      setDraftText("");
      return;
    }

    try {
      setDraftText(JSON.stringify(draft.treeJson ?? {}, null, 2));
    } catch {
      setDraftText("{}");
    }
  }, [draft?.id]);

  const counts = useMemo(() => {
    const errors = findings.filter((f) => f.severity === "ERROR").length;
    const warnings = findings.filter((f) => f.severity === "WARNING").length;
    const info = findings.filter((f) => f.severity === "INFO").length;
    return { errors, warnings, info };
  }, [findings]);

  const createDraftMutation = useMutation({
    mutationFn: async () => {
      setLastError("");
      const result = await apiJson<Pbv2TreeVersion>("POST", `/api/products/${productId}/pbv2/tree/draft`, {});
      if (!result.ok || result.json.success !== true) {
        const message = envelopeMessage(result.status, result.json, "Failed to create draft");
        const err = new Error(message) as any;
        err.status = result.status;
        err.payload = result.json;
        throw err;
      }
      return result.json;
    },
    onSuccess: async () => {
      setFindings([]);
      setLastError("");
      await treeQuery.refetch();
    },
    onError: (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);
      setLastError(error.message);
      toast({ title: "Draft create failed", description: error.message, variant: "destructive" });
    },
  });

  const createStarterDraftMutation = useMutation({
    mutationFn: async () => {
      setLastError("");
      const starter = createPbv2StarterTreeJson();

      const created = await apiJson<Pbv2TreeVersion>("POST", `/api/products/${productId}/pbv2/tree/draft`, {});
      if (!created.ok || created.json.success !== true) {
        const message = envelopeMessage(created.status, created.json, "Failed to create draft");
        const err = new Error(message) as any;
        err.status = created.status;
        err.payload = created.json;
        throw err;
      }

      const draftId = (created.json as any)?.data?.id as string | undefined;
      if (!draftId) throw new Error("Draft id missing from response");

      const patched = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${draftId}`, { treeJson: starter });
      if (!patched.ok || patched.json.success !== true) {
        const message = envelopeMessage(patched.status, patched.json, "Failed to save starter draft");
        const err = new Error(message) as any;
        err.status = patched.status;
        err.payload = patched.json;
        throw err;
      }

      return { starter, draftId };
    },
    onSuccess: async (data) => {
      setDraftText(stringifyPbv2TreeJson(data.starter));
      setFindings([]);
      setLastError("");
      toast({ title: "Starter draft saved", description: "Draft created and populated with a publish-valid starter tree." });
      await treeQuery.refetch();
    },
    onError: (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);
      setLastError(error.message);
      toast({ title: "Starter draft failed", description: error.message, variant: "destructive" });
    },
  });

  const createBannerGrommetsDraftMutation = useMutation({
    mutationFn: async () => {
      setLastError("");
      const template = createPbv2BannerGrommetsTreeJson();

      const created = await apiJson<Pbv2TreeVersion>("POST", `/api/products/${productId}/pbv2/tree/draft`, {});
      if (!created.ok || created.json.success !== true) {
        const message = envelopeMessage(created.status, created.json, "Failed to create draft");
        const err = new Error(message) as any;
        err.status = created.status;
        err.payload = created.json;
        throw err;
      }

      const draftId = (created.json as any)?.data?.id as string | undefined;
      if (!draftId) throw new Error("Draft id missing from response");

      const patched = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${draftId}`, { treeJson: template });
      if (!patched.ok || patched.json.success !== true) {
        const message = envelopeMessage(patched.status, patched.json, "Failed to save banner grommets template");
        const err = new Error(message) as any;
        err.status = patched.status;
        err.payload = patched.json;
        throw err;
      }

      return { template, draftId };
    },
    onSuccess: async (data) => {
      setDraftText(stringifyPbv2TreeJson(data.template));
      setFindings([]);
      setLastError("");
      toast({ title: "Banner grommets draft saved", description: "Draft created and populated with the banner/grommets proof template." });
      await treeQuery.refetch();
    },
    onError: (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);
      setLastError(error.message);
      toast({ title: "Template draft failed", description: error.message, variant: "destructive" });
    },
  });

  const applyTreeMutation = useMutation({
    mutationFn: async (treeJson: unknown) => {
      if (!draft) throw new Error("No draft to save");
      setLastError("");
      const result = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${draft.id}`, { treeJson });
      if (!result.ok || result.json.success !== true) {
        const message = envelopeMessage(result.status, result.json, "Failed to save draft");
        const err = new Error(message) as any;
        err.status = result.status;
        err.payload = result.json;
        throw err;
      }
      return { treeJson, envelope: result.json };
    },
    onSuccess: async ({ treeJson }) => {
      setDraftText(stringifyPbv2TreeJson(treeJson));
      setLastError("");
      await treeQuery.refetch();
    },
    onError: async (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);

      if (error?.status === 409) {
        toast({ title: "Draft locked", description: "Draft already published; refresh." });
        await treeQuery.refetch();
        return;
      }

      setLastError(error.message);
      toast({ title: "Draft save failed", description: error.message, variant: "destructive" });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft to save");
      setLastError("");

      let parsed: any;
      try {
        parsed = JSON.parse(draftText || "{}");
      } catch {
        throw new Error("Draft JSON is invalid");
      }

      const result = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${draft.id}`, { treeJson: parsed });

      if (!result.ok || result.json.success !== true) {
        const message = envelopeMessage(result.status, result.json, "Failed to save draft");
        const err = new Error(message) as any;
        err.status = result.status;
        err.payload = result.json;
        throw err;
      }

      return result.json;
    },
    onSuccess: async () => {
      toast({ title: "Draft saved" });
      setLastError("");
      await treeQuery.refetch();
    },
    onError: async (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);

      if (error?.status === 409) {
        toast({ title: "Draft locked", description: "Draft already published; refresh." });
        await treeQuery.refetch();
        return;
      }

      setLastError(error.message);
      toast({ title: "Draft save failed", description: error.message, variant: "destructive" });
    },
  });

  const validateLocal = () => {
    if (!draft) {
      toast({ title: "No draft", description: "Create a draft first.", variant: "destructive" });
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(draftText || "{}");
    } catch {
      toast({ title: "Invalid JSON", description: "Fix the draft JSON before validating.", variant: "destructive" });
      return;
    }

    const res = validateTreeForPublish(parsed, DEFAULT_VALIDATE_OPTS);
    setFindings(res.findings as any);

    if (res.errors.length > 0) {
      toast({ title: "Validation blocked", description: `${res.errors.length} error(s) found.`, variant: "destructive" });
      return;
    }

    if (res.warnings.length > 0) {
      toast({ title: "Validation warnings", description: `${res.warnings.length} warning(s) found.` });
      return;
    }

    toast({ title: "Validation OK", description: "No errors or warnings." });
  };

  const publishMutation = useMutation({
    mutationFn: async (confirmWarnings: boolean) => {
      if (!draft) throw new Error("No draft to publish");
      setLastError("");
      const qs = confirmWarnings ? "?confirmWarnings=true" : "";
      const res = await fetch(`/api/pbv2/tree-versions/${draft.id}/publish${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const json = (await readJsonSafe(res)) as any;

      if (!res.ok) {
        const message = envelopeMessage(res.status, json, "Publish failed");
        const err = new Error(message) as any;
        err.status = res.status;
        err.payload = json;
        throw err;
      }

      return json as Envelope<Pbv2TreeVersion>;
    },
    onSuccess: async (data: any) => {
      const nextFindings = (data?.findings ?? []) as Finding[];
      setFindings(nextFindings);
      setLastError("");

      if (data?.requiresWarningsConfirm) {
        setConfirmOpen(true);
        toast({ title: "Warnings found", description: "Review warnings and click Confirm Publish." });
        return;
      }

      await treeQuery.refetch();
      const activeNow = treeQuery.data?.data?.active;
      toast({
        title: "Published",
        description: activeNow?.id
          ? `Active version: ${activeNow.id}${activeNow.publishedAt ? ` (published ${new Date(activeNow.publishedAt).toLocaleString()})` : ""}`
          : "Draft is now ACTIVE.",
      });
      setConfirmOpen(false);
    },
    onError: async (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);

      if (error?.status === 409) {
        toast({ title: "Draft locked", description: "Draft already published; refresh." });
        await treeQuery.refetch();
        return;
      }

      setLastError(error.message);
      toast({ title: "Publish blocked", description: error.message, variant: "destructive" });
    },
  });

  // Download JSON handlers
  const downloadJson = (source: "draft" | "active") => {
    const version = source === "draft" ? draft : active;
    if (!version) {
      toast({
        title: "No version available",
        description: `No ${source} version exists`,
        variant: "destructive",
      });
      return;
    }

    try {
      const jsonString = stringifyPbv2TreeJson(version.treeJson);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      // Include schema version in filename if present
      const schemaVersion = (version.treeJson as any)?.schemaVersion;
      const versionSuffix = schemaVersion ? `_v${schemaVersion}` : "";
      a.download = `pbv2${versionSuffix}_${source}_${productId}.json`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "JSON Downloaded",
        description: `${source} version exported successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message || "Failed to export JSON",
        variant: "destructive",
      });
    }
  };

  // JSON Import validation
  const validateJsonImport = async () => {
    setJsonImportError("");
    setJsonImportFindings([]);
    setJsonImportValidated(false);
    setJsonImportSchemaVersion(null);

    try {
      const parsed = JSON.parse(jsonImportText);
      
      // Detect schema version
      const schemaVersion = parsed?.schemaVersion;
      setJsonImportSchemaVersion(schemaVersion || null);
      
      // Validate using existing validator
      const result = validateTreeForPublish(parsed, DEFAULT_VALIDATE_OPTS);
      
      const findings: Finding[] = [
        ...result.errors.map((f) => ({ ...f, severity: "ERROR" as const })),
        ...result.warnings.map((f) => ({ ...f, severity: "WARNING" as const })),
      ];
      
      // Add schema version warning if missing
      if (!schemaVersion) {
        findings.push({
          severity: "WARNING",
          code: "MISSING_SCHEMA_VERSION",
          message: "schemaVersion field is missing. Tree will be applied with backward-compatible defaults.",
          path: "root.schemaVersion",
        });
      }

      setJsonImportFindings(findings);
      
      const hasErrors = result.errors.length > 0;
      if (hasErrors) {
        setJsonImportError(`Validation blocked: ${result.errors.length} error(s)`);
      } else {
        setJsonImportValidated(true);
        toast({
          title: "JSON Valid",
          description: result.warnings.length > 0 
            ? `Valid with ${result.warnings.length} warning(s)` 
            : "Ready to apply",
        });
      }
    } catch (error: any) {
      setJsonImportError(error.message || "Invalid JSON");
      toast({
        title: "Invalid JSON",
        description: error.message || "Failed to parse JSON",
        variant: "destructive",
      });
    }
  };

  // Apply JSON to draft
  const applyJsonImportMutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(jsonImportText);
      
      // If no draft exists, create one first
      if (!draft) {
        const created = await apiJson<Pbv2TreeVersion>("POST", `/api/products/${productId}/pbv2/tree/draft`, {});
        if (!created.ok || created.json.success !== true) {
          throw new Error(envelopeMessage(created.status, created.json, "Failed to create draft"));
        }
      }

      // Get current draft ID (either existing or just created)
      await treeQuery.refetch();
      const currentDraft = treeQuery.data?.data?.draft;
      
      if (!currentDraft) {
        throw new Error("Failed to get draft for applying JSON");
      }

      // Apply the JSON to the draft
      const patched = await apiJson<Pbv2TreeVersion>("PATCH", `/api/pbv2/tree-versions/${currentDraft.id}`, { 
        treeJson: parsed 
      });
      
      if (!patched.ok || patched.json.success !== true) {
        throw new Error(envelopeMessage(patched.status, patched.json, "Failed to apply JSON"));
      }

      return patched.json;
    },
    onSuccess: async () => {
      toast({
        title: "JSON Applied",
        description: "Changes applied to draft successfully",
      });
      await treeQuery.refetch();
      setJsonImportModalOpen(false);
      setJsonImportText("");
      setJsonImportValidated(false);
      setJsonImportFindings([]);
    },
    onError: (error: Error) => {
      toast({
        title: "Apply failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canEdit = Boolean(draft);
  const isBusy =
    treeQuery.isFetching ||
    createDraftMutation.isPending ||
    createStarterDraftMutation.isPending ||
    createBannerGrommetsDraftMutation.isPending ||
    saveDraftMutation.isPending ||
    applyTreeMutation.isPending ||
    publishMutation.isPending;

  const parsedDraft = useMemo(() => {
    if (!draft) return { ok: false as const, error: "No draft", tree: null as any, nodes: [] as any[], edges: [] as any[] };
    try {
      const raw = JSON.parse(draftText || "{}");
      const { tree, nodes, edges } = normalizeTreeArrays(raw);
      return { ok: true as const, error: "", tree, nodes, edges };
    } catch {
      return { ok: false as const, error: "Draft JSON is invalid", tree: null as any, nodes: [] as any[], edges: [] as any[] };
    }
  }, [draft, draftText]);

  const isMissingQtyRef = (value: unknown): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value !== "object" || Array.isArray(value)) return false;
    return Object.keys(value as any).length === 0;
  };

  const validateInline = (expr: unknown, ctx: "COMPUTE" | "CONDITION" | "PRICE", pathBase: string): InlineFinding[] => {
    const validated = validateFormulaJson(expr as any, ctx as any, symbolTableBundle.table, { pathBase });
    const out: InlineFinding[] = [];
    for (const e of validated.errors ?? []) out.push({ severity: "ERROR", message: `${e.code}: ${e.message}` });
    for (const w of validated.warnings ?? []) out.push({ severity: "WARNING", message: `${w.code}: ${w.message}` });
    return out;
  };

  const computeMaterialRowFindings = (row: any): InlineFinding[] => {
    const out: InlineFinding[] = [];
    const sku = typeof row?.skuRef === "string" ? row.skuRef.trim() : "";
    const uom = typeof row?.uom === "string" ? row.uom.trim() : "";
    if (!sku) out.push({ severity: "ERROR", message: "skuRef is empty" });
    if (!uom) out.push({ severity: "ERROR", message: "uom is empty" });

    if (isMissingQtyRef(row?.qtyRef)) {
      out.push({ severity: "ERROR", message: "qtyRef is missing" });
    } else {
      out.push(...validateInline(row.qtyRef, "COMPUTE", "qtyRef"));
    }

    if (row?.appliesWhen !== undefined) {
      out.push(...validateInline(row.appliesWhen, "CONDITION", "appliesWhen"));
    }

    return out;
  };

  const computeChildItemRowFindings = (row: any): InlineFinding[] => {
    const out: InlineFinding[] = [];
    const kind = row?.kind;
    if (kind !== "inlineSku" && kind !== "productRef") out.push({ severity: "ERROR", message: "kind must be inlineSku or productRef" });
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    if (!title) out.push({ severity: "ERROR", message: "title is empty" });

    if (kind === "inlineSku") {
      const sku = typeof row?.skuRef === "string" ? row.skuRef.trim() : "";
      if (!sku) out.push({ severity: "ERROR", message: "skuRef is required for inlineSku" });
    }

    if (kind === "productRef") {
      if (row?.childProductId !== undefined) {
        const pid = typeof row?.childProductId === "string" ? row.childProductId.trim() : "";
        if (!pid) out.push({ severity: "ERROR", message: "childProductId must be non-empty when provided" });
      }
    }

    const iv = row?.invoiceVisibility;
    if (iv !== undefined && iv !== "hidden" && iv !== "rollup" && iv !== "separateLine") {
      out.push({ severity: "ERROR", message: "invoiceVisibility must be hidden|rollup|separateLine" });
    }

    if (isMissingQtyRef(row?.qtyRef)) out.push({ severity: "ERROR", message: "qtyRef is missing" });
    else out.push(...validateInline(row.qtyRef, "COMPUTE", "qtyRef"));

    if (row?.unitPriceRef !== undefined) {
      out.push(...validateInline(row.unitPriceRef, "PRICE", "unitPriceRef"));
    }

    if (row?.appliesWhen !== undefined) out.push(...validateInline(row.appliesWhen, "CONDITION", "appliesWhen"));

    return out;
  };

  const toCompactExpr = (value: unknown): string => {
    if (value === null || value === undefined) return "(missing)";
    try {
      const s = JSON.stringify(value);
      if (!s) return "(missing)";
      return s.length > 80 ? `${s.slice(0, 77)}...` : s;
    } catch {
      return "(unstringifiable)";
    }
  };

  const materialRowsForSelectedPriceNode = useMemo(() => {
    if (!parsedDraft.ok) return [] as any[];
    const nodeId = materialNodeId.trim();
    if (!nodeId) return [] as any[];
    const { nodes } = normalizeTreeArrays(parsedDraft.tree);
    const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
    if (!n) return [] as any[];
    const price = (n as any).price ?? (n as any).data;
    return Array.isArray(price?.materialEffects) ? price.materialEffects : [];
  }, [parsedDraft.ok, parsedDraft.tree, materialNodeId]);

  const childRowsForSelectedPriceNode = useMemo(() => {
    if (!parsedDraft.ok) return [] as any[];
    const nodeId = childNodeId.trim();
    if (!nodeId) return [] as any[];
    const { nodes } = normalizeTreeArrays(parsedDraft.tree);
    const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
    if (!n) return [] as any[];
    const price = (n as any).price ?? (n as any).data;
    return Array.isArray(price?.childItemEffects) ? price.childItemEffects : [];
  }, [parsedDraft.ok, parsedDraft.tree, childNodeId]);

  const disableSaveDraftBecauseNewMaterialRowEmpty = useMemo(() => {
    if (!parsedDraft.ok) return false;
    const nodeId = materialNodeId.trim();
    if (!nodeId) return false;
    const rows = materialRowsForSelectedPriceNode;
    if (rows.length === 0) return false;
    const last = rows[rows.length - 1];
    const skuEmpty = typeof last?.skuRef !== "string" || !last.skuRef.trim();
    const qtyMissing = isMissingQtyRef(last?.qtyRef);
    return skuEmpty && qtyMissing;
  }, [parsedDraft.ok, materialNodeId, materialRowsForSelectedPriceNode]);

  const emptySymbolTable = useMemo<SymbolTable>(() => {
    return {
      nodeTypesById: {},
      inputBySelectionKey: {},
      computeByNodeId: {},
      envKeys: new Set<string>(["widthIn", "heightIn", "quantity", "sqft", "perimeterIn"]),
    };
  }, []);

  const symbolTableBundle = useMemo(() => {
    if (!parsedDraft.ok) return { table: emptySymbolTable, findings: [] as any[] };
    return buildSymbolTable(parsedDraft.tree, { pathBase: "tree" });
  }, [parsedDraft.ok, parsedDraft.tree, emptySymbolTable]);

  const variableCatalog = useMemo(() => {
    if (!parsedDraft.ok) return [];
    return buildVariableCatalog(parsedDraft.tree, symbolTableBundle.table);
  }, [parsedDraft.ok, parsedDraft.tree, symbolTableBundle.table]);

  useEffect(() => {
    if (!edgeEditorId || !parsedDraft.ok) return;
    const e = parsedDraft.edges
      .map((raw) => ({
        id: String((raw as any)?.id ?? (raw as any)?.edgeId ?? ""),
        status: String((raw as any)?.status ?? "ENABLED").toUpperCase(),
        fromNodeId: typeof (raw as any)?.fromNodeId === "string" ? (raw as any).fromNodeId : "",
        toNodeId: typeof (raw as any)?.toNodeId === "string" ? (raw as any).toNodeId : "",
        priority: typeof (raw as any)?.priority === "number" && Number.isFinite((raw as any).priority) ? (raw as any).priority : 0,
        condition: (raw as any)?.condition,
      }))
      .find((x) => x.id === edgeEditorId);

    if (!e) return;

    const st = (e.status === "DISABLED" || e.status === "DELETED") ? e.status : "ENABLED";
    setEdgeEditStatus(st);
    setEdgeEditFrom(e.fromNodeId);
    setEdgeEditTo(e.toNodeId);
    setEdgeEditPriority(String(e.priority));
    setEdgeEditConditionText(e.condition ? JSON.stringify(e.condition, null, 2) : "");
  }, [edgeEditorId, parsedDraft.ok, parsedDraft.edges]);

  const nodesAll = useMemo(() => {
    const list = parsedDraft.nodes
      .map((n) => {
        const input = asRecord(n?.input) ?? asRecord(n?.data);
        return {
          id: String(n?.id ?? ""),
          type: String(n?.type ?? n?.nodeType ?? n?.kind ?? ""),
          status: String(n?.status ?? "ENABLED").toUpperCase(),
          key: typeof n?.key === "string" ? n.key : "",
          selectionKey: typeof input?.selectionKey === "string" ? input.selectionKey : "",
          raw: n,
        };
      })
      .filter((n) => n.id);
    return list;
  }, [parsedDraft.nodes]);

  const nodesForUi = useMemo(() => {
    return showDeleted ? nodesAll : nodesAll.filter((n) => n.status !== "DELETED");
  }, [nodesAll, showDeleted]);

  const computeNodes = useMemo(() => nodesForUi.filter((n) => (n.type || "").toUpperCase() === "COMPUTE"), [nodesForUi]);
  const priceNodes = useMemo(() => nodesForUi.filter((n) => (n.type || "").toUpperCase() === "PRICE"), [nodesForUi]);

  useEffect(() => {
    if (!parsedDraft.ok) {
      setFormulaText("{}");
      return;
    }

    const findNodeRaw = (id: string) => {
      const n = nodesAll.find((x) => x.id === id);
      return n?.raw as any;
    };

    if (!formulaNodeId.trim()) {
      const fallback =
        formulaTarget === "COMPUTE_EXPRESSION"
          ? computeNodes[0]?.id
          : priceNodes[0]?.id;
      if (fallback) setFormulaNodeId(fallback);
      return;
    }

    const node = findNodeRaw(formulaNodeId);
    if (!node) {
      setFormulaText("{}");
      return;
    }

    if (formulaTarget === "COMPUTE_EXPRESSION") {
      const compute = (node as any).compute ?? (node as any).data;
      const expr = compute?.expression ?? compute?.expr;
      setFormulaText(expr ? JSON.stringify(expr, null, 2) : "{}\n");
      return;
    }

    const price = (node as any).price ?? (node as any).data;
    const components = Array.isArray(price?.components) ? price.components : [];
    const idx = Number(priceComponentIndex);
    const comp = Number.isFinite(idx) ? components[idx] : undefined;
    if (!comp) {
      setFormulaText("{}\n");
      return;
    }

    if (formulaTarget === "PRICE_COMPONENT_QUANTITY") {
      setFormulaText(comp.quantityRef ? JSON.stringify(comp.quantityRef, null, 2) : "{}\n");
      return;
    }
    if (formulaTarget === "PRICE_COMPONENT_UNIT_PRICE") {
      setFormulaText(comp.unitPriceRef ? JSON.stringify(comp.unitPriceRef, null, 2) : "{}\n");
      return;
    }
    setFormulaText(comp.appliesWhen ? JSON.stringify(comp.appliesWhen, null, 2) : "{}\n");
  }, [
    parsedDraft.ok,
    nodesAll,
    computeNodes,
    priceNodes,
    formulaTarget,
    formulaNodeId,
    priceComponentIndex,
  ]);

  useEffect(() => {
    if (!parsedDraft.ok) {
      setMaterialSkuRef("");
      setMaterialUom("ea");
      setMaterialQtyText("{}\n");
      setMaterialAppliesWhenText("");
      return;
    }

    const findNodeRaw = (id: string) => {
      const n = nodesAll.find((x) => x.id === id);
      return n?.raw as any;
    };

    if (!materialNodeId.trim()) {
      const fallback = priceNodes[0]?.id;
      if (fallback) setMaterialNodeId(fallback);
      return;
    }

    const node = findNodeRaw(materialNodeId);
    if (!node) {
      setMaterialSkuRef("");
      setMaterialUom("ea");
      setMaterialQtyText("{}\n");
      setMaterialAppliesWhenText("");
      return;
    }

    const price = (node as any).price ?? (node as any).data;
    const effects = Array.isArray(price?.materialEffects) ? price.materialEffects : [];
    const idx = Number(materialEffectIndex);
    const eff = Number.isFinite(idx) ? effects[idx] : undefined;

    setMaterialSkuRef(typeof eff?.skuRef === "string" ? eff.skuRef : "");
    setMaterialUom(typeof eff?.uom === "string" ? eff.uom : "ea");
    setMaterialQtyText(eff?.qtyRef ? JSON.stringify(eff.qtyRef, null, 2) : "{}\n");
    setMaterialAppliesWhenText(eff?.appliesWhen ? JSON.stringify(eff.appliesWhen, null, 2) : "");
  }, [parsedDraft.ok, nodesAll, priceNodes, materialNodeId, materialEffectIndex]);

  useEffect(() => {
    if (!parsedDraft.ok) {
      setChildKind("inlineSku");
      setChildTitle("");
      setChildSkuRef("");
      setChildProductId("");
      setChildInvoiceVisibility("rollup");
      setChildQtyText("{}\n");
      setChildUnitPriceText("{}\n");
      setChildAppliesWhenText("");
      return;
    }

    const findNodeRaw = (id: string) => {
      const n = nodesAll.find((x) => x.id === id);
      return n?.raw as any;
    };

    if (!childNodeId.trim()) {
      const fallback = priceNodes[0]?.id;
      if (fallback) setChildNodeId(fallback);
      return;
    }

    const node = findNodeRaw(childNodeId);
    if (!node) {
      setChildKind("inlineSku");
      setChildTitle("");
      setChildSkuRef("");
      setChildProductId("");
      setChildInvoiceVisibility("rollup");
      setChildQtyText("{}\n");
      setChildUnitPriceText("{}\n");
      setChildAppliesWhenText("");
      return;
    }

    const price = (node as any).price ?? (node as any).data;
    const effects = Array.isArray(price?.childItemEffects) ? price.childItemEffects : [];
    const idx = Number(childEffectIndex);
    const eff = Number.isFinite(idx) ? effects[idx] : undefined;

    setChildKind(eff?.kind === "productRef" ? "productRef" : "inlineSku");
    setChildTitle(typeof eff?.title === "string" ? eff.title : "");
    setChildSkuRef(typeof eff?.skuRef === "string" ? eff.skuRef : "");
    setChildProductId(typeof eff?.childProductId === "string" ? eff.childProductId : "");
    setChildInvoiceVisibility(
      eff?.invoiceVisibility === "hidden" || eff?.invoiceVisibility === "separateLine" || eff?.invoiceVisibility === "rollup"
        ? eff.invoiceVisibility
        : "rollup"
    );
    setChildQtyText(eff?.qtyRef ? JSON.stringify(eff.qtyRef, null, 2) : "{}\n");
    setChildUnitPriceText(eff?.unitPriceRef ? JSON.stringify(eff.unitPriceRef, null, 2) : "{}\n");
    setChildAppliesWhenText(eff?.appliesWhen ? JSON.stringify(eff.appliesWhen, null, 2) : "");
  }, [parsedDraft.ok, nodesAll, priceNodes, childNodeId, childEffectIndex]);

  const edgesForUi = useMemo(() => {
    const list = parsedDraft.edges
      .map((e) => {
        return {
          id: String(e?.id ?? e?.edgeId ?? ""),
          status: String(e?.status ?? "ENABLED").toUpperCase(),
          fromNodeId: typeof e?.fromNodeId === "string" ? e.fromNodeId : "",
          toNodeId: typeof e?.toNodeId === "string" ? e.toNodeId : "",
          priority: typeof e?.priority === "number" && Number.isFinite(e.priority) ? e.priority : 0,
          condition: e?.condition,
          raw: e,
        };
      })
      .filter((e) => e.id);
    return showDeleted ? list : list.filter((e) => e.status !== "DELETED");
  }, [parsedDraft.edges, showDeleted]);

  const nodeIndex = useMemo(() => {
    const byId: Record<string, { status: string; type: string }> = {};
    for (const n of nodesAll) byId[n.id] = { status: n.status, type: n.type.toUpperCase() };
    return byId;
  }, [nodesAll]);

  const saveNextTree = (nextTree: any, opts?: { successToast?: { title: string; description?: string } }) => {
    if (!draft) {
      toast({ title: "No draft", description: "Create a draft first.", variant: "destructive" });
      return;
    }
    applyTreeMutation.mutate(nextTree, {
      onSuccess: () => {
        if (opts?.successToast) toast({ title: opts.successToast.title, description: opts.successToast.description });
      },
    });
  };

  const updateDraftTree = (mutate: (tree: any) => any, opts?: { successToast?: { title: string; description?: string } }) => {
    if (!draft) {
      toast({ title: "No draft", description: "Create a draft first.", variant: "destructive" });
      return;
    }
    if (!parsedDraft.ok) {
      toast({ title: "Invalid JSON", description: parsedDraft.error, variant: "destructive" });
      return;
    }
    const nextTree = mutate(parsedDraft.tree);
    saveNextTree(nextTree, opts);
  };

  const setNodeStatus = (nodeId: string, status: "ENABLED" | "DISABLED" | "DELETED") => {
    updateDraftTree(
      (t) => {
        const { tree, nodes, edges } = normalizeTreeArrays(t);
        const n = nodes.find((x: any) => String(x?.id) === nodeId);
        if (!n) throw new Error(`Node not found: ${nodeId}`);
        n.status = status;
        if (status !== "ENABLED") {
          for (const e of edges) {
            if (String(e?.fromNodeId ?? "") === nodeId || String(e?.toNodeId ?? "") === nodeId) {
              if (String(e?.status ?? "ENABLED").toUpperCase() === "ENABLED") e.status = "DISABLED";
            }
          }
        }
        return tree;
      },
      { successToast: { title: `Node ${status.toLowerCase()}`, description: nodeId } }
    );
  };

  const restoreNode = (nodeId: string) => {
    if (!parsedDraft.ok) {
      toast({ title: "Invalid JSON", description: parsedDraft.error, variant: "destructive" });
      return;
    }
    const res = validateTreeForRestore(parsedDraft.tree as any, { restoredNodeIds: [nodeId] } as any, DEFAULT_VALIDATE_OPTS);
    if (res.errors.length > 0) {
      setFindings(res.findings as any);
      toast({ title: "Restore blocked", description: `${res.errors.length} error(s)`, variant: "destructive" });
      return;
    }
    setFindings(res.findings as any);
    setNodeStatus(nodeId, "ENABLED");
  };

  const setEdgeStatus = (edgeId: string, status: "ENABLED" | "DISABLED" | "DELETED") => {
    updateDraftTree(
      (t) => {
        const { tree, edges } = normalizeTreeArrays(t);
        const e = edges.find((x: any) => String(x?.id ?? x?.edgeId) === edgeId);
        if (!e) throw new Error(`Edge not found: ${edgeId}`);
        e.status = status;
        return tree;
      },
      { successToast: { title: `Edge ${status.toLowerCase()}`, description: edgeId } }
    );
  };

  const restoreEdge = (edgeId: string) => {
    if (!parsedDraft.ok) {
      toast({ title: "Invalid JSON", description: parsedDraft.error, variant: "destructive" });
      return;
    }
    const res = validateTreeForRestore(parsedDraft.tree as any, { restoredEdgeIds: [edgeId] } as any, DEFAULT_VALIDATE_OPTS);
    if (res.errors.length > 0) {
      setFindings(res.findings as any);
      toast({ title: "Restore blocked", description: `${res.errors.length} error(s)`, variant: "destructive" });
      return;
    }
    setFindings(res.findings as any);
    setEdgeStatus(edgeId, "ENABLED");
  };

  const upsertEdge = (edgeId: string, patch: { fromNodeId: string; toNodeId: string; priority: number; status: string; condition?: any }) => {
    updateDraftTree(
      (t) => {
        const { tree, edges } = normalizeTreeArrays(t);
        const e = edges.find((x: any) => String(x?.id ?? x?.edgeId) === edgeId);
        if (!e) throw new Error(`Edge not found: ${edgeId}`);
        e.fromNodeId = patch.fromNodeId;
        e.toNodeId = patch.toNodeId;
        e.priority = patch.priority;
        e.status = patch.status;
        if (patch.condition === undefined) {
          delete e.condition;
        } else {
          e.condition = patch.condition;
        }
        return tree;
      },
      { successToast: { title: "Edge updated", description: edgeId } }
    );
  };

  return (
    <>
      <Card className="mt-6">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Product Builder v2 (PBV2)</CardTitle>
              <CardDescription>
                Versioned PBV2 draft/publish lifecycle. Developer fallback JSON editor is temporary.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* JSON Download/Upload Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!draft && !active}>
                    <Download className="h-4 w-4 mr-2" />
                    Download JSON
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={!draft}
                    onClick={() => downloadJson("draft")}
                  >
                    Export Draft
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!active}
                    onClick={() => downloadJson("active")}
                  >
                    Export Published
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setJsonImportModalOpen(true);
                  setJsonImportText("");
                  setJsonImportValidated(false);
                  setJsonImportFindings([]);
                  setJsonImportError("");
                  setJsonImportSchemaVersion(null);
                }}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload JSON
              </Button>

              {draft ? <Badge variant="secondary">Draft</Badge> : <Badge variant="outline">No Draft</Badge>}
              {active ? <Badge>Active</Badge> : <Badge variant="outline">No Active</Badge>}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
        {treeQuery.isLoading ? <div className="text-sm text-muted-foreground">Loading PBV2…</div> : null}
        {treeQuery.data && treeQuery.data.success === false ? (
          <div className="text-sm text-destructive">{treeQuery.data.message || "Failed to load PBV2"}</div>
        ) : null}
        {lastError ? <div className="text-sm text-destructive">{lastError}</div> : null}

        {/* Hide dev-only sections in production */}
        {import.meta.env.DEV && isAdminUser ? (
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">Advanced PBV2 Override (Admin-only)</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, order/quote PBV2 evaluations for this product use this override tree version instead of the normal active PBV2 version.
                </div>
                {overrideTreeVersionId ? (
                  <div className="text-xs text-muted-foreground">
                    Stored treeVersionId: <span className="font-mono">{overrideTreeVersionId}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={overrideEnabled}
                    onCheckedChange={(v) => setOverrideEnabled(Boolean(v))}
                    disabled={saveOverrideMutation.isPending || disableOverrideMutation.isPending}
                  />
                  <Label className="text-sm">Enabled</Label>
                </div>
                <Badge variant={overrideEnabled ? "secondary" : "outline"}>{overrideEnabled ? "ON" : "OFF"}</Badge>
              </div>
            </div>

            <Textarea
              value={overrideText}
              onChange={(e) => setOverrideText(e.target.value)}
              className="min-h-[200px] font-mono text-xs"
              placeholder="Paste publish-valid PBV2 tree JSON here"
              disabled={overrideQuery.isLoading || saveOverrideMutation.isPending}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => validateOverrideMutation.mutate()}
                disabled={validateOverrideMutation.isPending || saveOverrideMutation.isPending}
              >
                Validate Override
              </Button>
              <Button
                type="button"
                onClick={() => saveOverrideMutation.mutate()}
                disabled={saveOverrideMutation.isPending}
              >
                Save Override{overrideEnabled ? " & Enable" : ""}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => disableOverrideMutation.mutate()}
                disabled={disableOverrideMutation.isPending}
              >
                Disable (keep JSON)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => overrideQuery.refetch()}
                disabled={overrideQuery.isLoading || saveOverrideMutation.isPending}
              >
                Reload
              </Button>

              {overrideLastMessage ? <div className="text-xs text-muted-foreground">{overrideLastMessage}</div> : null}
            </div>

            {overrideFindings.length ? (
              <div className="rounded-md border border-border">
                <ScrollArea className="h-[180px]">
                  <div className="p-3 space-y-2">
                    {overrideFindings.map((f, idx) => (
                      <div key={`${f.code}-ov-${idx}`} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              f.severity === "ERROR" ? "destructive" : f.severity === "WARNING" ? "secondary" : "outline"
                            }
                          >
                            {f.severity}
                          </Badge>
                          <span className="font-mono text-xs">{f.code}</span>
                        </div>
                        <div className="mt-1">{f.message}</div>
                        <div className="mt-1 text-xs text-muted-foreground font-mono">{f.path}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Hide draft editor and all dev tools in production */}
        {!import.meta.env.DEV ? null : (
          <>
        <Separator />

        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => createDraftMutation.mutate()}
              disabled={isBusy || Boolean(draft)}
            >
              Create Draft
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => createStarterDraftMutation.mutate()}
              disabled={isBusy || Boolean(draft)}
            >
              Create Starter Draft
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => createBannerGrommetsDraftMutation.mutate()}
              disabled={isBusy || Boolean(draft)}
            >
              Create Banner Grommets Draft
            </Button>
            <Button type="button" variant="secondary" onClick={validateLocal} disabled={!draft}>
              Validate
            </Button>
            <Button
              type="button"
              onClick={() => publishMutation.mutate(false)}
              disabled={!draft || isBusy}
            >
              Publish
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => saveDraftMutation.mutate()}
              disabled={!draft || isBusy || disableSaveDraftBecauseNewMaterialRowEmpty}
            >
              Save Draft
            </Button>

            {disableSaveDraftBecauseNewMaterialRowEmpty ? (
              <div className="text-xs text-muted-foreground">
                Fill the newly added material row before saving.
              </div>
            ) : null}

            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>Errors: {counts.errors}</span>
              <span>Warnings: {counts.warnings}</span>
              <span>Info: {counts.info}</span>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Draft editor (DRAFT-only)</div>
                <div className="text-xs text-muted-foreground">
                  Soft delete/restore and multi-branch edges. Changes are saved to the draft immediately.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pbv2-show-deleted"
                  checked={showDeleted}
                  onCheckedChange={(v) => setShowDeleted(Boolean(v))}
                  disabled={!draft || isBusy}
                />
                <Label htmlFor="pbv2-show-deleted" className="text-sm">
                  Show deleted
                </Label>
              </div>
            </div>

            {!draft ? (
              <div className="text-sm text-muted-foreground">Create a draft to use the editor.</div>
            ) : !parsedDraft.ok ? (
              <div className="text-sm text-destructive">{parsedDraft.error}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-md border border-border">
                  <div className="p-3">
                    <div className="text-sm font-medium">Nodes</div>
                    <div className="mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[240px]">ID</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Key</TableHead>
                            <TableHead>selectionKey</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {nodesForUi.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                                No nodes found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            nodesForUi.map((n) => (
                              <TableRow key={n.id}>
                                <TableCell className="font-mono text-xs">{n.id}</TableCell>
                                <TableCell className="text-xs">{n.type || ""}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      n.status === "DELETED" ? "destructive" : n.status === "DISABLED" ? "secondary" : "outline"
                                    }
                                  >
                                    {n.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{n.key}</TableCell>
                                <TableCell className="font-mono text-xs">{n.selectionKey}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    {n.status === "ENABLED" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => setNodeStatus(n.id, "DISABLED")}
                                      >
                                        Disable
                                      </Button>
                                    ) : n.status === "DISABLED" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => restoreNode(n.id)}
                                      >
                                        Enable
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => restoreNode(n.id)}
                                      >
                                        Restore
                                      </Button>
                                    )}
                                    {n.status === "DELETED" ? null : (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="destructive"
                                        disabled={isBusy}
                                        onClick={() => setNodeStatus(n.id, "DELETED")}
                                      >
                                        Delete
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Edges</div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Edit edge</Label>
                        <Select
                          value={edgeEditorId || "__none__"}
                          onValueChange={(v) => setEdgeEditorId(v === "__none__" ? "" : v)}
                          disabled={!draft || isBusy}
                        >
                          <SelectTrigger className="h-8 w-[260px]">
                            <SelectValue placeholder="Select edge…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {edgesForUi.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[240px]">ID</TableHead>
                            <TableHead>From → To</TableHead>
                            <TableHead>Priority</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {edgesForUi.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-sm text-muted-foreground">
                                No edges found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            edgesForUi.map((e) => (
                              <TableRow key={e.id}>
                                <TableCell className="font-mono text-xs">{e.id}</TableCell>
                                <TableCell className="font-mono text-xs">
                                  {e.fromNodeId || "?"} → {e.toNodeId || "?"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{String(e.priority)}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      e.status === "DELETED" ? "destructive" : e.status === "DISABLED" ? "secondary" : "outline"
                                    }
                                  >
                                    {e.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={isBusy}
                                      onClick={() => setEdgeEditorId(e.id)}
                                    >
                                      Edit
                                    </Button>
                                    {e.status === "ENABLED" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => setEdgeStatus(e.id, "DISABLED")}
                                      >
                                        Disable
                                      </Button>
                                    ) : e.status === "DISABLED" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => restoreEdge(e.id)}
                                      >
                                        Enable
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isBusy}
                                        onClick={() => restoreEdge(e.id)}
                                      >
                                        Restore
                                      </Button>
                                    )}
                                    {e.status === "DELETED" ? null : (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="destructive"
                                        disabled={isBusy}
                                        onClick={() => setEdgeStatus(e.id, "DELETED")}
                                      >
                                        Delete
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {edgeEditorId ? (
                      <div className="rounded-md border border-border p-3 space-y-3">
                        <div className="text-sm font-medium">
                          Edit edge: <span className="font-mono text-xs">{edgeEditorId}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label>Status</Label>
                            <Select value={edgeEditStatus} onValueChange={(v) => setEdgeEditStatus(v as any)} disabled={isBusy}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ENABLED">ENABLED</SelectItem>
                                <SelectItem value="DISABLED">DISABLED</SelectItem>
                                <SelectItem value="DELETED">DELETED</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label>Priority</Label>
                            <Input type="number" value={edgeEditPriority} onChange={(ev) => setEdgeEditPriority(ev.target.value)} disabled={isBusy} />
                            <div className="text-xs text-muted-foreground">Changing priority may create ambiguous branches at the same priority.</div>
                          </div>

                          <div className="space-y-1">
                            <Label>From</Label>
                            <Select value={edgeEditFrom} onValueChange={setEdgeEditFrom} disabled={isBusy}>
                              <SelectTrigger>
                                <SelectValue placeholder="From node…" />
                              </SelectTrigger>
                              <SelectContent>
                                {nodesAll.map((n) => (
                                  <SelectItem key={n.id} value={n.id}>
                                    {n.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label>To</Label>
                            <Select value={edgeEditTo} onValueChange={setEdgeEditTo} disabled={isBusy}>
                              <SelectTrigger>
                                <SelectValue placeholder="To node…" />
                              </SelectTrigger>
                              <SelectContent>
                                {nodesAll.map((n) => (
                                  <SelectItem key={n.id} value={n.id}>
                                    {n.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="md:col-span-2 space-y-1">
                            <Label>Condition JSON (optional)</Label>
                            <FormulaEditor
                              valueText={edgeEditConditionText}
                              onChangeText={setEdgeEditConditionText}
                              context="CONDITION"
                              symbolTable={symbolTableBundle.table}
                              variableCatalog={variableCatalog}
                              disabled={isBusy}
                            />
                          </div>

                          <div className="md:col-span-2 flex items-center gap-2">
                            <Button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                const from = edgeEditFrom.trim();
                                const to = edgeEditTo.trim();
                                if (!from || !to) {
                                  toast({ title: "Missing fields", description: "Choose both From and To nodes.", variant: "destructive" });
                                  return;
                                }

                                const pr = Number(edgeEditPriority);
                                if (!Number.isFinite(pr)) {
                                  toast({ title: "Invalid priority", description: "Priority must be a number.", variant: "destructive" });
                                  return;
                                }

                                const fromInfo = nodeIndex[from];
                                const toInfo = nodeIndex[to];
                                if (!fromInfo || !toInfo) {
                                  toast({ title: "Invalid nodes", description: "From/To node ids must exist.", variant: "destructive" });
                                  return;
                                }

                                if (edgeEditStatus === "ENABLED") {
                                  if (fromInfo.type === "GROUP" || toInfo.type === "GROUP") {
                                    toast({ title: "Invalid edge", description: "ENABLED edges cannot connect to GROUP nodes.", variant: "destructive" });
                                    return;
                                  }
                                  if (fromInfo.status !== "ENABLED" || toInfo.status !== "ENABLED") {
                                    toast({ title: "Invalid edge", description: "Enable both endpoint nodes before enabling this edge.", variant: "destructive" });
                                    return;
                                  }
                                }

                                let condition: any = undefined;
                                if (edgeEditConditionText.trim()) {
                                  try {
                                    condition = JSON.parse(edgeEditConditionText);
                                  } catch {
                                    toast({ title: "Invalid JSON", description: "Condition JSON must be valid JSON.", variant: "destructive" });
                                    return;
                                  }
                                }

                                upsertEdge(edgeEditorId, { fromNodeId: from, toNodeId: to, priority: pr, status: edgeEditStatus, condition });
                              }}
                            >
                              Save Edge
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-md border border-border p-3 space-y-3">
                      <div className="text-sm font-medium">Add outgoing edge (multi-branch)</div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label>From</Label>
                          <Select value={edgeFromNodeId} onValueChange={setEdgeFromNodeId} disabled={!draft || isBusy}>
                            <SelectTrigger>
                              <SelectValue placeholder="From node…" />
                            </SelectTrigger>
                            <SelectContent>
                              {nodesForUi
                                .filter((n) => n.status !== "DELETED")
                                .map((n) => (
                                  <SelectItem key={n.id} value={n.id}>
                                    {n.id}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label>To</Label>
                          <Select value={edgeToNodeId} onValueChange={setEdgeToNodeId} disabled={!draft || isBusy}>
                            <SelectTrigger>
                              <SelectValue placeholder="To node…" />
                            </SelectTrigger>
                            <SelectContent>
                              {nodesForUi
                                .filter((n) => n.status !== "DELETED")
                                .map((n) => (
                                  <SelectItem key={n.id} value={n.id}>
                                    {n.id}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label>Priority</Label>
                          <Input type="number" value={edgePriority} onChange={(e) => setEdgePriority(e.target.value)} disabled={!draft || isBusy} />
                        </div>

                        <div className="space-y-1">
                          <Label>Condition JSON</Label>
                          <Input
                            placeholder='(optional) e.g. {"op":"EQ",...}'
                            value={edgeConditionJson}
                            onChange={(e) => setEdgeConditionJson(e.target.value)}
                            disabled={!draft || isBusy}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          disabled={!draft || isBusy}
                          onClick={() => {
                            const from = edgeFromNodeId.trim();
                            const to = edgeToNodeId.trim();
                            if (!from || !to) {
                              toast({ title: "Missing fields", description: "Choose both From and To nodes.", variant: "destructive" });
                              return;
                            }
                            const pr = Number(edgePriority);
                            if (!Number.isFinite(pr)) {
                              toast({ title: "Invalid priority", description: "Priority must be a number.", variant: "destructive" });
                              return;
                            }
                            const fromInfo = nodeIndex[from];
                            const toInfo = nodeIndex[to];
                            if (!fromInfo || !toInfo) {
                              toast({ title: "Invalid nodes", description: "From/To node ids must exist.", variant: "destructive" });
                              return;
                            }
                            if (fromInfo.type === "GROUP" || toInfo.type === "GROUP") {
                              toast({ title: "Invalid edge", description: "ENABLED edges cannot connect to GROUP nodes.", variant: "destructive" });
                              return;
                            }
                            if (fromInfo.status !== "ENABLED" || toInfo.status !== "ENABLED") {
                              toast({ title: "Invalid edge", description: "Enable both endpoint nodes before creating an ENABLED edge.", variant: "destructive" });
                              return;
                            }

                            let condition: any = undefined;
                            if (edgeConditionJson.trim()) {
                              try {
                                condition = JSON.parse(edgeConditionJson);
                              } catch {
                                toast({ title: "Invalid JSON", description: "Condition JSON must be valid JSON.", variant: "destructive" });
                                return;
                              }
                            }

                            updateDraftTree(
                              (t) => {
                                const { tree, edges } = normalizeTreeArrays(t);
                                const taken = new Set<string>(edges.map((x: any) => String(x?.id ?? x?.edgeId ?? "")).filter(Boolean));
                                const id = makeId("e_", taken);
                                const edge: any = { id, status: "ENABLED", fromNodeId: from, toNodeId: to, priority: pr };
                                if (condition !== undefined) edge.condition = condition;
                                edges.push(edge);
                                return tree;
                              },
                              { successToast: { title: "Edge added", description: `${from} → ${to}` } }
                            );

                            setEdgeConditionJson("");
                          }}
                        >
                          Add Edge
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Multiple enabled outgoing edges with the same priority can be ambiguous unless conditions are mutually exclusive.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Formula editor (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">
                      Edits node formulas directly in the draft tree. Publish validation remains authoritative.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>Target</Label>
                        <Select value={formulaTarget} onValueChange={(v) => setFormulaTarget(v as any)} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COMPUTE_EXPRESSION">COMPUTE.expression</SelectItem>
                            <SelectItem value="PRICE_COMPONENT_QUANTITY">PRICE.components[i].quantityRef</SelectItem>
                            <SelectItem value="PRICE_COMPONENT_UNIT_PRICE">PRICE.components[i].unitPriceRef</SelectItem>
                            <SelectItem value="PRICE_COMPONENT_APPLIES_WHEN">PRICE.components[i].appliesWhen</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label>Node</Label>
                        <Select
                          value={formulaNodeId || "__none__"}
                          onValueChange={(v) => setFormulaNodeId(v === "__none__" ? "" : v)}
                          disabled={!draft || isBusy}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select node…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {(formulaTarget === "COMPUTE_EXPRESSION" ? computeNodes : priceNodes).map((n) => (
                              <SelectItem key={n.id} value={n.id}>
                                {n.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label>Component index</Label>
                        <Input
                          type="number"
                          value={priceComponentIndex}
                          onChange={(e) => setPriceComponentIndex(e.target.value)}
                          disabled={!draft || isBusy || formulaTarget === "COMPUTE_EXPRESSION"}
                        />
                      </div>
                    </div>

                    <FormulaEditor
                      valueText={formulaText}
                      onChangeText={setFormulaText}
                      context={formulaTarget === "PRICE_COMPONENT_APPLIES_WHEN" ? "CONDITION" : formulaTarget === "COMPUTE_EXPRESSION" ? "COMPUTE" : "PRICE"}
                      symbolTable={symbolTableBundle.table}
                      variableCatalog={variableCatalog}
                      disabled={!draft || isBusy || !formulaNodeId}
                      label={
                        formulaTarget === "COMPUTE_EXPRESSION"
                          ? "ExpressionSpec"
                          : formulaTarget === "PRICE_COMPONENT_APPLIES_WHEN"
                          ? "ConditionRule"
                          : "ExpressionSpec"
                      }
                    />

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok || !formulaNodeId.trim()}
                        onClick={() => {
                          if (!parsedDraft.ok) return;
                          let parsed: any;
                          let parseNote: string | undefined;
                          try {
                            parsed = JSON.parse(formulaText);
                          } catch {
                            parsed = {};
                            parseNote = "Invalid JSON; applied {}";
                          }

                          const ctx: "CONDITION" | "COMPUTE" | "PRICE" =
                            formulaTarget === "PRICE_COMPONENT_APPLIES_WHEN" ? "CONDITION" : formulaTarget === "COMPUTE_EXPRESSION" ? "COMPUTE" : "PRICE";

                          const nodeId = formulaNodeId.trim();
                          const componentIdx = Number(priceComponentIndex);

                          const nextFindings = validateInline(parsed, ctx, "expr");
                          setLastFormulaApplyFindings({ findings: nextFindings, note: parseNote });

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);

                              if (formulaTarget === "COMPUTE_EXPRESSION") {
                                if (!(n as any).compute && !(n as any).data) (n as any).compute = {};
                                const targetObj = (n as any).compute ?? (n as any).data;
                                targetObj.expression = parsed;
                                return tree;
                              }

                              if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                              const price = (n as any).price ?? (n as any).data;
                              if (!Array.isArray(price.components)) price.components = [];
                              if (!Number.isFinite(componentIdx) || componentIdx < 0) throw new Error("Component index must be >= 0");
                              if (!price.components[componentIdx]) price.components[componentIdx] = {};
                              const comp = price.components[componentIdx];

                              if (formulaTarget === "PRICE_COMPONENT_QUANTITY") comp.quantityRef = parsed;
                              else if (formulaTarget === "PRICE_COMPONENT_UNIT_PRICE") comp.unitPriceRef = parsed;
                              else comp.appliesWhen = parsed;

                              return tree;
                            },
                            { successToast: { title: "Formula saved", description: `${formulaTarget} @ ${formulaNodeId}` } }
                          );
                        }}
                      >
                        Save Formula
                      </Button>

                      {lastFormulaApplyFindings ? (
                        <div className="text-xs text-muted-foreground">
                          {lastFormulaApplyFindings.findings.some((f) => f.severity === "ERROR")
                            ? "Invalid (publish will fail)"
                            : "Valid"}
                          {lastFormulaApplyFindings.note ? ` — ${lastFormulaApplyFindings.note}` : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Materials (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">
                      Edit PRICE.materialEffects entries (skuRef, uom, qtyRef, appliesWhen).
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok || !materialNodeId.trim()}
                        onClick={() => {
                          if (!parsedDraft.ok) return;
                          const nodeId = materialNodeId.trim();
                          if (!nodeId) return;

                          const defaultQtyRef = { op: "literal", value: 1 };
                          const currentCount = materialRowsForSelectedPriceNode.length;

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);

                              if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                              const price = (n as any).price ?? (n as any).data;
                              if (!Array.isArray(price.materialEffects)) price.materialEffects = [];
                              price.materialEffects.push({ skuRef: "", uom: "ea", qtyRef: defaultQtyRef });
                              return tree;
                            },
                            { successToast: { title: "Material added", description: `PRICE.materialEffects[${currentCount}] @ ${nodeId}` } }
                          );

                          setMaterialEffectIndex(String(currentCount));
                          setMaterialSkuRef("");
                          setMaterialUom("ea");
                          setMaterialQtyText(JSON.stringify(defaultQtyRef, null, 2));
                          setMaterialAppliesWhenText("");
                        }}
                      >
                        + Add material
                      </Button>
                    </div>

                    <div className="rounded-md border border-border">
                      <div className="p-2">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[60px]">#</TableHead>
                              <TableHead>Summary</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {materialNodeId.trim() && materialRowsForSelectedPriceNode.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                  No material effects yet. Click “+ Add material”.
                                </TableCell>
                              </TableRow>
                            ) : !materialNodeId.trim() ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                  Select a PRICE node to edit material effects.
                                </TableCell>
                              </TableRow>
                            ) : (
                              materialRowsForSelectedPriceNode.map((row: any, idx: number) => {
                                const sku = typeof row?.skuRef === "string" ? row.skuRef.trim() : "";
                                const uom = typeof row?.uom === "string" ? row.uom.trim() : "";
                                const qtyMissing = isMissingQtyRef(row?.qtyRef);
                                const qtyCompact = toCompactExpr(row?.qtyRef);
                                const summary = `SKU: ${sku || "(empty)"} | qty: ${qtyCompact} | uom: ${uom || "(empty)"}`;
                                const key = `${materialNodeId.trim()}|${idx}`;
                                const computedFindings = computeMaterialRowFindings(row);
                                const rowFindings = materialValidationByKey[key]?.findings ?? computedFindings;
                                const hasError = rowFindings.some((f) => f.severity === "ERROR");
                                const expanded = !!materialRowExpandedByKey[key];
                                const shown = expanded ? rowFindings : rowFindings.slice(0, 3);

                                const isSelected = Number(materialEffectIndex) === idx;

                                return (
                                  <TableRow key={idx} className={isSelected ? "bg-muted/50" : undefined}>
                                    <TableCell className="font-mono text-xs">{idx}</TableCell>
                                    <TableCell>
                                      <div className="text-xs font-mono">{summary}</div>
                                      <div className="text-xs text-muted-foreground">{hasError ? "Invalid (publish will fail)" : "Valid"}</div>

                                      {rowFindings.length > 0 ? (
                                        <div className="space-y-0.5 mt-1">
                                          {shown.map((f, i) => (
                                            <div
                                              key={i}
                                              className={
                                                f.severity === "ERROR"
                                                  ? "text-xs text-destructive"
                                                  : "text-xs text-muted-foreground"
                                              }
                                            >
                                              {f.message}
                                            </div>
                                          ))}
                                          {rowFindings.length > 3 ? (
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              className="h-7 px-2 text-xs"
                                              onClick={() =>
                                                setMaterialRowExpandedByKey((prev) => ({
                                                  ...prev,
                                                  [key]: !prev[key],
                                                }))
                                              }
                                            >
                                              {expanded ? "Show less" : "Show all"}
                                            </Button>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          disabled={!draft || isBusy}
                                          onClick={() => {
                                            setMaterialEffectIndex(String(idx));
                                          }}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          disabled={!draft || isBusy || !parsedDraft.ok}
                                          onClick={() => {
                                            if (!parsedDraft.ok) return;
                                            const nodeId = materialNodeId.trim();
                                            if (!nodeId) return;
                                            const cloned = (() => {
                                              try {
                                                return JSON.parse(JSON.stringify(row ?? {}));
                                              } catch {
                                                return { ...(row ?? {}) };
                                              }
                                            })();
                                            const currentCount = materialRowsForSelectedPriceNode.length;
                                            updateDraftTree(
                                              (t) => {
                                                const { tree, nodes } = normalizeTreeArrays(t);
                                                const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                                                if (!n) throw new Error(`Node not found: ${nodeId}`);
                                                if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                                                const price = (n as any).price ?? (n as any).data;
                                                if (!Array.isArray(price.materialEffects)) price.materialEffects = [];
                                                price.materialEffects.push(cloned);
                                                return tree;
                                              },
                                              { successToast: { title: "Material duplicated", description: `PRICE.materialEffects[${currentCount}] @ ${nodeId}` } }
                                            );
                                            setMaterialEffectIndex(String(currentCount));
                                          }}
                                        >
                                          Duplicate
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="destructive"
                                          disabled={!draft || isBusy}
                                          onClick={() => {
                                            const nodeId = materialNodeId.trim();
                                            if (!nodeId) return;
                                            setRemoveMaterialTarget({ nodeId, idx, summary });
                                            setRemoveMaterialConfirmOpen(true);
                                          }}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>PRICE node</Label>
                        <Select value={materialNodeId || "__none__"} onValueChange={(v) => setMaterialNodeId(v === "__none__" ? "" : v)} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select PRICE node…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {priceNodes.map((n) => (
                              <SelectItem key={n.id} value={n.id}>
                                {n.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label>Effect index</Label>
                        <Input type="number" value={materialEffectIndex} onChange={(e) => setMaterialEffectIndex(e.target.value)} disabled={!draft || isBusy} />
                      </div>

                      <div className="space-y-1">
                        <Label>skuRef</Label>
                        <Input value={materialSkuRef} onChange={(e) => setMaterialSkuRef(e.target.value)} placeholder="e.g. GROMMET_STD" disabled={!draft || isBusy} />
                        {!materialSkuRef.trim() ? <div className="text-xs text-muted-foreground">Warning: skuRef is empty</div> : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>uom</Label>
                        <Select value={materialUom} onValueChange={setMaterialUom} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ea">Each</SelectItem>
                            <SelectItem value="sheet">Sheet</SelectItem>
                            <SelectItem value="sqft">SqFt</SelectItem>
                            <SelectItem value="linear_ft">Linear Ft</SelectItem>
                            <SelectItem value="ml">mL</SelectItem>
                          </SelectContent>
                        </Select>
                        {!materialUom.trim() ? <div className="text-xs text-muted-foreground">Warning: uom is empty</div> : null}
                      </div>

                      <div className="md:col-span-2" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormulaEditor
                        valueText={materialQtyText}
                        onChangeText={setMaterialQtyText}
                        context="COMPUTE"
                        symbolTable={symbolTableBundle.table}
                        variableCatalog={variableCatalog}
                        disabled={!draft || isBusy || !materialNodeId}
                        label="qtyRef (ExpressionSpec)"
                      />

                      {(() => {
                        let parsed: any = null;
                        try {
                          parsed = JSON.parse(materialQtyText || "null");
                        } catch {
                          return <div className="text-xs text-muted-foreground">Warning: qtyRef JSON is invalid</div>;
                        }
                        return isMissingQtyRef(parsed) ? <div className="text-xs text-muted-foreground">Warning: qtyRef is missing</div> : null;
                      })()}

                      <FormulaEditor
                        valueText={materialAppliesWhenText || ""}
                        onChangeText={setMaterialAppliesWhenText}
                        context="CONDITION"
                        symbolTable={symbolTableBundle.table}
                        variableCatalog={variableCatalog}
                        disabled={!draft || isBusy || !materialNodeId}
                        label="appliesWhen (optional ConditionRule)"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok || !materialNodeId.trim()}
                        onClick={() => {
                          if (!parsedDraft.ok) return;

                          const nodeId = materialNodeId.trim();
                          const idx = Number(materialEffectIndex);
                          if (!Number.isFinite(idx) || idx < 0) {
                            toast({ title: "Invalid index", description: "Effect index must be >= 0", variant: "destructive" });
                            return;
                          }

                          const sku = materialSkuRef;

                          let qtyParsed: any;
                          let qtyParseFailed = false;
                          try {
                            qtyParsed = JSON.parse(materialQtyText);
                          } catch {
                            qtyParsed = {};
                            qtyParseFailed = true;
                          }

                          let appliesWhenParsed: any = undefined;
                          let appliesWhenParseFailed = false;
                          if (materialAppliesWhenText.trim()) {
                            try {
                              appliesWhenParsed = JSON.parse(materialAppliesWhenText);
                            } catch {
                              appliesWhenParsed = {};
                              appliesWhenParseFailed = true;
                            }
                          }

                          const key = `${nodeId}|${idx}`;
                          const nextRow = {
                            skuRef: sku,
                            uom: materialUom,
                            qtyRef: qtyParsed,
                            ...(appliesWhenParsed !== undefined ? { appliesWhen: appliesWhenParsed } : {}),
                          };

                          const nextFindings: InlineFinding[] = [];
                          if (qtyParseFailed) nextFindings.push({ severity: "ERROR", message: "qtyRef JSON is invalid (applied {})" });
                          if (appliesWhenParseFailed) nextFindings.push({ severity: "ERROR", message: "appliesWhen JSON is invalid (applied {})" });
                          nextFindings.push(...computeMaterialRowFindings(nextRow));
                          setMaterialValidationByKey((prev) => ({ ...prev, [key]: { findings: nextFindings } }));

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);

                              if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                              const price = (n as any).price ?? (n as any).data;
                              if (!Array.isArray(price.materialEffects)) price.materialEffects = [];
                              if (!price.materialEffects[idx]) price.materialEffects[idx] = {};
                              const eff = price.materialEffects[idx];

                              eff.skuRef = sku;
                              eff.uom = materialUom;
                              eff.qtyRef = qtyParsed;
                              if (appliesWhenParsed !== undefined) eff.appliesWhen = appliesWhenParsed;
                              else delete eff.appliesWhen;

                              return tree;
                            },
                            { successToast: { title: "Material effect saved", description: `PRICE.materialEffects[${idx}] @ ${nodeId}` } }
                          );
                        }}
                      >
                        Save Material Effect
                      </Button>
                    </div>
                  </div>
                </div>

                <Dialog
                  open={removeMaterialConfirmOpen}
                  onOpenChange={(open) => {
                    setRemoveMaterialConfirmOpen(open);
                    if (!open) setRemoveMaterialTarget(null);
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remove material effect?</DialogTitle>
                      <DialogDescription>
                        This cannot be recovered unless you undo before saving.
                      </DialogDescription>
                    </DialogHeader>
                    {removeMaterialTarget ? (
                      <div className="text-xs font-mono text-muted-foreground">{removeMaterialTarget.summary}</div>
                    ) : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRemoveMaterialConfirmOpen(false);
                          setRemoveMaterialTarget(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!draft || isBusy || !parsedDraft.ok || !removeMaterialTarget}
                        onClick={() => {
                          if (!parsedDraft.ok) return;
                          const target = removeMaterialTarget;
                          if (!target) return;
                          const nodeId = target.nodeId;
                          const idx = target.idx;

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);
                              const price = (n as any).price ?? (n as any).data;
                              if (!price || !Array.isArray(price.materialEffects)) return tree;
                              if (idx < 0 || idx >= price.materialEffects.length) return tree;
                              price.materialEffects.splice(idx, 1);
                              return tree;
                            },
                            { successToast: { title: "Material removed", description: `PRICE.materialEffects[${idx}] @ ${nodeId}` } }
                          );

                          setRemoveMaterialConfirmOpen(false);
                          setRemoveMaterialTarget(null);

                          const curIdx = Number(materialEffectIndex);
                          if (Number.isFinite(curIdx)) {
                            if (curIdx === idx) setMaterialEffectIndex("0");
                            else if (curIdx > idx) setMaterialEffectIndex(String(curIdx - 1));
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Child items (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">
                      Edit PRICE.childItemEffects entries (kind, title, sku/product, qtyRef, unitPriceRef, invoiceVisibility, appliesWhen).
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok || !childNodeId.trim()}
                        onClick={() => {
                          if (!parsedDraft.ok) return;
                          const nodeId = childNodeId.trim();
                          if (!nodeId) return;

                          const defaultQtyRef = { op: "literal", value: 1 };
                          const currentCount = childRowsForSelectedPriceNode.length;

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);
                              if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                              const price = (n as any).price ?? (n as any).data;
                              if (!Array.isArray(price.childItemEffects)) price.childItemEffects = [];
                              price.childItemEffects.push({
                                kind: "inlineSku",
                                title: "",
                                skuRef: "",
                                qtyRef: defaultQtyRef,
                                invoiceVisibility: "rollup",
                              });
                              return tree;
                            },
                            { successToast: { title: "Child item added", description: `PRICE.childItemEffects[${currentCount}] @ ${nodeId}` } }
                          );

                          setChildEffectIndex(String(currentCount));
                          setChildKind("inlineSku");
                          setChildTitle("");
                          setChildSkuRef("");
                          setChildProductId("");
                          setChildInvoiceVisibility("rollup");
                          setChildQtyText(JSON.stringify(defaultQtyRef, null, 2));
                          setChildUnitPriceText("{}\n");
                          setChildAppliesWhenText("");
                        }}
                      >
                        + Add child item
                      </Button>
                    </div>

                    <div className="rounded-md border border-border">
                      <div className="p-2">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[60px]">#</TableHead>
                              <TableHead>Summary</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {childNodeId.trim() && childRowsForSelectedPriceNode.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                  No child items yet. Click “+ Add child item”.
                                </TableCell>
                              </TableRow>
                            ) : !childNodeId.trim() ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                  Select a PRICE node to edit child items.
                                </TableCell>
                              </TableRow>
                            ) : (
                              childRowsForSelectedPriceNode.map((row: any, idx: number) => {
                                const kind = row?.kind === "productRef" ? "productRef" : "inlineSku";
                                const title = typeof row?.title === "string" ? row.title.trim() : "";
                                const ref =
                                  kind === "inlineSku"
                                    ? `sku=${typeof row?.skuRef === "string" ? row.skuRef.trim() : ""}`
                                    : `product=${typeof row?.childProductId === "string" ? row.childProductId.trim() : ""}`;
                                const qtyCompact = toCompactExpr(row?.qtyRef);
                                const summary = `title: ${title || "(empty)"} | kind: ${kind} | ${ref || ""} | qty: ${qtyCompact}`;

                                const key = `${childNodeId.trim()}|${idx}`;
                                const computedFindings = computeChildItemRowFindings(row);
                                const rowFindings = childValidationByKey[key]?.findings ?? computedFindings;
                                const hasError = rowFindings.some((f) => f.severity === "ERROR");
                                const expanded = !!childRowExpandedByKey[key];
                                const shown = expanded ? rowFindings : rowFindings.slice(0, 3);
                                const isSelected = Number(childEffectIndex) === idx;

                                return (
                                  <TableRow key={idx} className={isSelected ? "bg-muted/50" : undefined}>
                                    <TableCell className="font-mono text-xs">{idx}</TableCell>
                                    <TableCell>
                                      <div className="text-xs font-mono">{summary}</div>
                                      <div className="text-xs text-muted-foreground">{hasError ? "Invalid (publish will fail)" : "Valid"}</div>

                                      {rowFindings.length > 0 ? (
                                        <div className="space-y-0.5 mt-1">
                                          {shown.map((f, i) => (
                                            <div key={i} className={f.severity === "ERROR" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                                              {f.message}
                                            </div>
                                          ))}
                                          {rowFindings.length > 3 ? (
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              className="h-7 px-2 text-xs"
                                              onClick={() =>
                                                setChildRowExpandedByKey((prev) => ({
                                                  ...prev,
                                                  [key]: !prev[key],
                                                }))
                                              }
                                            >
                                              {expanded ? "Show less" : "Show all"}
                                            </Button>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex justify-end gap-2">
                                        <Button type="button" size="sm" variant="outline" disabled={!draft || isBusy} onClick={() => setChildEffectIndex(String(idx))}>
                                          Edit
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          disabled={!draft || isBusy || !parsedDraft.ok}
                                          onClick={() => {
                                            if (!parsedDraft.ok) return;
                                            const nodeId = childNodeId.trim();
                                            if (!nodeId) return;
                                            const cloned = (() => {
                                              try {
                                                return JSON.parse(JSON.stringify(row ?? {}));
                                              } catch {
                                                return { ...(row ?? {}) };
                                              }
                                            })();
                                            const currentCount = childRowsForSelectedPriceNode.length;
                                            updateDraftTree(
                                              (t) => {
                                                const { tree, nodes } = normalizeTreeArrays(t);
                                                const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                                                if (!n) throw new Error(`Node not found: ${nodeId}`);
                                                if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                                                const price = (n as any).price ?? (n as any).data;
                                                if (!Array.isArray(price.childItemEffects)) price.childItemEffects = [];
                                                price.childItemEffects.push(cloned);
                                                return tree;
                                              },
                                              { successToast: { title: "Child item duplicated", description: `PRICE.childItemEffects[${currentCount}] @ ${nodeId}` } }
                                            );
                                            setChildEffectIndex(String(currentCount));
                                          }}
                                        >
                                          Duplicate
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="destructive"
                                          disabled={!draft || isBusy}
                                          onClick={() => {
                                            const nodeId = childNodeId.trim();
                                            if (!nodeId) return;
                                            setRemoveChildTarget({ nodeId, idx, summary });
                                            setRemoveChildConfirmOpen(true);
                                          }}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>PRICE node</Label>
                        <Select value={childNodeId} onValueChange={setChildNodeId} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select PRICE node…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {priceNodes.map((n) => (
                              <SelectItem key={n.id} value={n.id}>
                                {n.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label>Effect index</Label>
                        <Input type="number" value={childEffectIndex} onChange={(e) => setChildEffectIndex(e.target.value)} disabled={!draft || isBusy} />
                      </div>

                      <div className="space-y-1">
                        <Label>kind</Label>
                        <Select value={childKind} onValueChange={(v) => setChildKind(v as any)} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inlineSku">inlineSku</SelectItem>
                            <SelectItem value="productRef">productRef</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>title</Label>
                        <Input value={childTitle} onChange={(e) => setChildTitle(e.target.value)} placeholder="e.g. Aluminum extrusion frame" disabled={!draft || isBusy} />
                        {!childTitle.trim() ? <div className="text-xs text-muted-foreground">Warning: title is empty</div> : null}
                      </div>

                      <div className="space-y-1">
                        <Label>invoiceVisibility</Label>
                        <Select value={childInvoiceVisibility} onValueChange={(v) => setChildInvoiceVisibility(v as any)} disabled={!draft || isBusy}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rollup">rollup</SelectItem>
                            <SelectItem value="separateLine">separateLine</SelectItem>
                            <SelectItem value="hidden">hidden</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {childKind === "inlineSku" ? (
                      <div className="space-y-1">
                        <Label>skuRef</Label>
                        <Input value={childSkuRef} onChange={(e) => setChildSkuRef(e.target.value)} placeholder="e.g. AL_EXTRUSION_STD" disabled={!draft || isBusy} />
                        {!childSkuRef.trim() ? <div className="text-xs text-muted-foreground">Warning: skuRef is empty</div> : null}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label>childProductId (optional placeholder)</Label>
                        <Input value={childProductId} onChange={(e) => setChildProductId(e.target.value)} placeholder="e.g. prod_..." disabled={!draft || isBusy} />
                      </div>
                    )}

                    <div className="space-y-3">
                      <FormulaEditor
                        valueText={childQtyText}
                        onChangeText={setChildQtyText}
                        context="COMPUTE"
                        symbolTable={symbolTableBundle.table}
                        variableCatalog={variableCatalog}
                        disabled={!draft || isBusy || !childNodeId}
                        label="qtyRef (ExpressionSpec)"
                      />

                      <FormulaEditor
                        valueText={childUnitPriceText}
                        onChangeText={setChildUnitPriceText}
                        context="PRICE"
                        symbolTable={symbolTableBundle.table}
                        variableCatalog={variableCatalog}
                        disabled={!draft || isBusy || !childNodeId}
                        label="unitPriceRef (optional ExpressionSpec cents)"
                      />

                      <FormulaEditor
                        valueText={childAppliesWhenText || ""}
                        onChangeText={setChildAppliesWhenText}
                        context="CONDITION"
                        symbolTable={symbolTableBundle.table}
                        variableCatalog={variableCatalog}
                        disabled={!draft || isBusy || !childNodeId}
                        label="appliesWhen (optional ConditionRule)"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok || !childNodeId.trim()}
                        onClick={() => {
                          if (!parsedDraft.ok) return;

                          const nodeId = childNodeId.trim();
                          const idx = Number(childEffectIndex);
                          if (!Number.isFinite(idx) || idx < 0) {
                            toast({ title: "Invalid index", description: "Effect index must be >= 0", variant: "destructive" });
                            return;
                          }

                          let qtyParsed: any;
                          let qtyParseFailed = false;
                          try {
                            qtyParsed = JSON.parse(childQtyText);
                          } catch {
                            qtyParsed = {};
                            qtyParseFailed = true;
                          }

                          let unitPriceParsed: any = undefined;
                          let unitPriceParseFailed = false;
                          if (childUnitPriceText.trim()) {
                            try {
                              unitPriceParsed = JSON.parse(childUnitPriceText);
                            } catch {
                              unitPriceParsed = {};
                              unitPriceParseFailed = true;
                            }
                          }

                          let appliesWhenParsed: any = undefined;
                          let appliesWhenParseFailed = false;
                          if (childAppliesWhenText.trim()) {
                            try {
                              appliesWhenParsed = JSON.parse(childAppliesWhenText);
                            } catch {
                              appliesWhenParsed = {};
                              appliesWhenParseFailed = true;
                            }
                          }

                          const key = `${nodeId}|${idx}`;
                          const nextRow: any = {
                            kind: childKind,
                            title: childTitle,
                            invoiceVisibility: childInvoiceVisibility,
                            qtyRef: qtyParsed,
                          };
                          if (childKind === "inlineSku") nextRow.skuRef = childSkuRef;
                          else if (childProductId.trim()) nextRow.childProductId = childProductId;
                          if (unitPriceParsed !== undefined) nextRow.unitPriceRef = unitPriceParsed;
                          if (appliesWhenParsed !== undefined) nextRow.appliesWhen = appliesWhenParsed;

                          const nextFindings: InlineFinding[] = [];
                          if (qtyParseFailed) nextFindings.push({ severity: "ERROR", message: "qtyRef JSON is invalid (applied {})" });
                          if (unitPriceParseFailed) nextFindings.push({ severity: "ERROR", message: "unitPriceRef JSON is invalid (applied {})" });
                          if (appliesWhenParseFailed) nextFindings.push({ severity: "ERROR", message: "appliesWhen JSON is invalid (applied {})" });
                          nextFindings.push(...computeChildItemRowFindings(nextRow));
                          setChildValidationByKey((prev) => ({ ...prev, [key]: { findings: nextFindings } }));

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);
                              if (!(n as any).price && !(n as any).data) (n as any).price = { components: [] };
                              const price = (n as any).price ?? (n as any).data;
                              if (!Array.isArray(price.childItemEffects)) price.childItemEffects = [];
                              if (!price.childItemEffects[idx]) price.childItemEffects[idx] = {};
                              const eff = price.childItemEffects[idx];

                              eff.kind = childKind;
                              eff.title = childTitle;
                              eff.invoiceVisibility = childInvoiceVisibility;
                              eff.qtyRef = qtyParsed;

                              if (childKind === "inlineSku") {
                                eff.skuRef = childSkuRef;
                                delete eff.childProductId;
                              } else {
                                delete eff.skuRef;
                                if (childProductId.trim()) eff.childProductId = childProductId;
                                else delete eff.childProductId;
                              }

                              if (unitPriceParsed !== undefined) eff.unitPriceRef = unitPriceParsed;
                              else delete eff.unitPriceRef;

                              if (appliesWhenParsed !== undefined) eff.appliesWhen = appliesWhenParsed;
                              else delete eff.appliesWhen;

                              return tree;
                            },
                            { successToast: { title: "Child item saved", description: `PRICE.childItemEffects[${idx}] @ ${nodeId}` } }
                          );
                        }}
                      >
                        Save Child Item
                      </Button>
                    </div>
                  </div>
                </div>

                <Dialog
                  open={removeChildConfirmOpen}
                  onOpenChange={(open) => {
                    setRemoveChildConfirmOpen(open);
                    if (!open) setRemoveChildTarget(null);
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remove child item effect?</DialogTitle>
                      <DialogDescription>
                        This cannot be recovered unless you undo before saving.
                      </DialogDescription>
                    </DialogHeader>
                    {removeChildTarget ? <div className="text-xs font-mono text-muted-foreground">{removeChildTarget.summary}</div> : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRemoveChildConfirmOpen(false);
                          setRemoveChildTarget(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!draft || isBusy || !parsedDraft.ok || !removeChildTarget}
                        onClick={() => {
                          if (!parsedDraft.ok) return;
                          const target = removeChildTarget;
                          if (!target) return;
                          const nodeId = target.nodeId;
                          const idx = target.idx;

                          updateDraftTree(
                            (t) => {
                              const { tree, nodes } = normalizeTreeArrays(t);
                              const n = nodes.find((x: any) => String(x?.id ?? "") === nodeId);
                              if (!n) throw new Error(`Node not found: ${nodeId}`);
                              const price = (n as any).price ?? (n as any).data;
                              if (!price || !Array.isArray(price.childItemEffects)) return tree;
                              if (idx < 0 || idx >= price.childItemEffects.length) return tree;
                              price.childItemEffects.splice(idx, 1);
                              return tree;
                            },
                            { successToast: { title: "Child item removed", description: `PRICE.childItemEffects[${idx}] @ ${nodeId}` } }
                          );

                          setRemoveChildConfirmOpen(false);
                          setRemoveChildTarget(null);

                          const curIdx = Number(childEffectIndex);
                          if (Number.isFinite(curIdx)) {
                            if (curIdx === idx) setChildEffectIndex("0");
                            else if (curIdx > idx) setChildEffectIndex(String(curIdx - 1));
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Preview pricing (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">
                      Enter env + explicitSelections, run pricing adapter, view add-on cents + breakdown.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                      <div className="space-y-1">
                        <Label>widthIn</Label>
                        <Input value={previewWidthIn} onChange={(e) => setPreviewWidthIn(e.target.value)} placeholder="(number)" disabled={!draft || isBusy} />
                      </div>
                      <div className="space-y-1">
                        <Label>heightIn</Label>
                        <Input value={previewHeightIn} onChange={(e) => setPreviewHeightIn(e.target.value)} placeholder="(number)" disabled={!draft || isBusy} />
                      </div>
                      <div className="space-y-1">
                        <Label>quantity</Label>
                        <Input value={previewQuantity} onChange={(e) => setPreviewQuantity(e.target.value)} placeholder="(number)" disabled={!draft || isBusy} />
                      </div>
                      <div className="space-y-1">
                        <Label>sqft</Label>
                        <Input value={previewSqft} onChange={(e) => setPreviewSqft(e.target.value)} placeholder="(number)" disabled={!draft || isBusy} />
                      </div>
                      <div className="space-y-1">
                        <Label>perimeterIn</Label>
                        <Input value={previewPerimeterIn} onChange={(e) => setPreviewPerimeterIn(e.target.value)} placeholder="(number)" disabled={!draft || isBusy} />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label>explicitSelections (JSON)</Label>
                      <Textarea
                        value={previewSelectionsText}
                        onChange={(e) => setPreviewSelectionsText(e.target.value)}
                        className="min-h-[120px] font-mono text-xs"
                        disabled={!draft || isBusy}
                      />
                      <div className="text-xs text-muted-foreground">
                        Known selection keys: {Object.keys(symbolTableBundle.table.inputBySelectionKey).sort().join(", ") || "(none)"}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok}
                        onClick={() => {
                          setPreviewError("");
                          setPreviewResult(null);
                          if (!parsedDraft.ok) return;

                          let selections: Record<string, unknown> = {};
                          try {
                            const parsed = JSON.parse(previewSelectionsText || "{}");
                            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                              throw new Error("explicitSelections must be a JSON object");
                            }
                            selections = parsed as Record<string, unknown>;
                          } catch (e: any) {
                            setPreviewError(e?.message || "Invalid selections JSON");
                            return;
                          }

                          const numOrUndef = (s: string) => {
                            const t = s.trim();
                            if (!t) return undefined;
                            const n = Number(t);
                            if (!Number.isFinite(n)) throw new Error(`Invalid number: '${s}'`);
                            return n;
                          };

                          let env: any;
                          try {
                            env = {
                              widthIn: numOrUndef(previewWidthIn),
                              heightIn: numOrUndef(previewHeightIn),
                              quantity: numOrUndef(previewQuantity),
                              sqft: numOrUndef(previewSqft),
                              perimeterIn: numOrUndef(previewPerimeterIn),
                            };
                          } catch (e: any) {
                            setPreviewError(e?.message || "Invalid env value");
                            return;
                          }

                          try {
                            const r = pbv2ToPricingAddons(parsedDraft.tree, selections, env);
                            setPreviewResult(r as any);
                          } catch (e: any) {
                            setPreviewError(e?.message || "Preview failed");
                          }
                        }}
                      >
                        Run Preview
                      </Button>
                      {previewError ? <div className="text-xs text-destructive">{previewError}</div> : null}
                      {previewResult ? (
                        <div className="text-xs text-muted-foreground">
                          addOnCents: <span className="font-mono">{previewResult.addOnCents}</span>
                        </div>
                      ) : null}
                    </div>

                    {previewResult ? (
                      <div className="rounded-md border border-border">
                        <div className="p-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>nodeId</TableHead>
                                <TableHead>component</TableHead>
                                <TableHead>kind</TableHead>
                                <TableHead className="text-right">amountCents</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {previewResult.breakdown.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                                    No breakdown lines.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                previewResult.breakdown.map((b: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell className="font-mono text-xs">{String(b.nodeId ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs">{String(b.componentIndex ?? "")}</TableCell>
                                    <TableCell className="text-xs">{String(b.kind ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs text-right">{String(b.amountCents ?? 0)}</TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Preview materials (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">Uses env + explicitSelections above to run material effects adapter.</div>

                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok}
                        onClick={() => {
                          setPreviewMaterialsError("");
                          setPreviewMaterialsResult(null);
                          if (!parsedDraft.ok) return;

                          let selections: Record<string, unknown> = {};
                          try {
                            const parsed = JSON.parse(previewSelectionsText || "{}");
                            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                              throw new Error("explicitSelections must be a JSON object");
                            }
                            selections = parsed as Record<string, unknown>;
                          } catch (e: any) {
                            setPreviewMaterialsError(e?.message || "Invalid selections JSON");
                            return;
                          }

                          const numOrUndef = (s: string) => {
                            const t = s.trim();
                            if (!t) return undefined;
                            const n = Number(t);
                            if (!Number.isFinite(n)) throw new Error(`Invalid number: '${s}'`);
                            return n;
                          };

                          let env: any;
                          try {
                            env = {
                              widthIn: numOrUndef(previewWidthIn),
                              heightIn: numOrUndef(previewHeightIn),
                              quantity: numOrUndef(previewQuantity),
                              sqft: numOrUndef(previewSqft),
                              perimeterIn: numOrUndef(previewPerimeterIn),
                            };
                          } catch (e: any) {
                            setPreviewMaterialsError(e?.message || "Invalid env value");
                            return;
                          }

                          try {
                            const r = pbv2ToMaterialEffects(parsedDraft.tree, selections, env);
                            setPreviewMaterialsResult(r as any);
                          } catch (e: any) {
                            setPreviewMaterialsError(e?.message || "Preview failed");
                          }
                        }}
                      >
                        Run Materials Preview
                      </Button>
                      {previewMaterialsError ? <div className="text-xs text-destructive">{previewMaterialsError}</div> : null}
                      {previewMaterialsResult ? (
                        <div className="text-xs text-muted-foreground">
                          effects: <span className="font-mono">{previewMaterialsResult.materials.length}</span>
                        </div>
                      ) : null}
                    </div>

                    {previewMaterialsResult ? (
                      <div className="rounded-md border border-border">
                        <div className="p-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>skuRef</TableHead>
                                <TableHead>uom</TableHead>
                                <TableHead className="text-right">qty</TableHead>
                                <TableHead>sourceNodeId</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {previewMaterialsResult.materials.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                                    No material effects.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                previewMaterialsResult.materials.map((m: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell className="font-mono text-xs">{String(m.skuRef ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs">{String(m.uom ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs text-right">{String(m.qty ?? 0)}</TableCell>
                                    <TableCell className="font-mono text-xs">{String(m.sourceNodeId ?? "")}</TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium">Preview child items (DRAFT-only)</div>
                    <div className="text-xs text-muted-foreground">Uses env + explicitSelections above to run child item proposals adapter.</div>

                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!draft || isBusy || !parsedDraft.ok}
                        onClick={() => {
                          setPreviewChildItemsError("");
                          setPreviewChildItemsResult(null);
                          if (!parsedDraft.ok) return;

                          let selections: Record<string, unknown> = {};
                          try {
                            const parsed = JSON.parse(previewSelectionsText || "{}");
                            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                              throw new Error("explicitSelections must be a JSON object");
                            }
                            selections = parsed as Record<string, unknown>;
                          } catch (e: any) {
                            setPreviewChildItemsError(e?.message || "Invalid selections JSON");
                            return;
                          }

                          const numOrUndef = (s: string) => {
                            const t = s.trim();
                            if (!t) return undefined;
                            const n = Number(t);
                            if (!Number.isFinite(n)) throw new Error(`Invalid number: '${s}'`);
                            return n;
                          };

                          let env: any;
                          try {
                            env = {
                              widthIn: numOrUndef(previewWidthIn),
                              heightIn: numOrUndef(previewHeightIn),
                              quantity: numOrUndef(previewQuantity),
                              sqft: numOrUndef(previewSqft),
                              perimeterIn: numOrUndef(previewPerimeterIn),
                            };
                          } catch (e: any) {
                            setPreviewChildItemsError(e?.message || "Invalid env value");
                            return;
                          }

                          try {
                            const r = pbv2ToChildItemProposals(parsedDraft.tree, selections, env);
                            setPreviewChildItemsResult(r as any);
                          } catch (e: any) {
                            setPreviewChildItemsError(e?.message || "Preview failed");
                          }
                        }}
                      >
                        Run Child Items Preview
                      </Button>
                      {previewChildItemsError ? <div className="text-xs text-destructive">{previewChildItemsError}</div> : null}
                      {previewChildItemsResult ? (
                        <div className="text-xs text-muted-foreground">
                          items: <span className="font-mono">{previewChildItemsResult.childItems.length}</span>
                        </div>
                      ) : null}
                    </div>

                    {previewChildItemsResult ? (
                      <div className="rounded-md border border-border">
                        <div className="p-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>title</TableHead>
                                <TableHead>kind</TableHead>
                                <TableHead>sku/product</TableHead>
                                <TableHead className="text-right">qty</TableHead>
                                <TableHead className="text-right">amountCents</TableHead>
                                <TableHead>invoiceVisibility</TableHead>
                                <TableHead>sourceNodeId</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {previewChildItemsResult.childItems.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="text-xs text-muted-foreground">
                                    No child item proposals.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                previewChildItemsResult.childItems.map((ci: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell className="text-xs">{String(ci.title ?? "")}</TableCell>
                                    <TableCell className="text-xs">{String(ci.kind ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs">
                                      {ci.kind === "inlineSku"
                                        ? String(ci.skuRef ?? "")
                                        : String(ci.childProductId ?? "")}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-right">{String(ci.qty ?? 0)}</TableCell>
                                    <TableCell className="font-mono text-xs text-right">
                                      {ci.amountCents === undefined ? "" : String(ci.amountCents)}
                                    </TableCell>
                                    <TableCell className="text-xs">{String(ci.invoiceVisibility ?? "")}</TableCell>
                                    <TableCell className="font-mono text-xs">{String(ci.sourceNodeId ?? "")}</TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {previewResult || previewMaterialsResult || previewChildItemsResult ? (
                  <div className="rounded-md border border-border">
                    <div className="p-3 space-y-3">
                      <div className="text-sm font-medium">PBV2 Outputs (Global line item preview)</div>
                      <div className="text-xs text-muted-foreground">
                        Uses the shared line item UI; outputs are passed in and not recomputed here.
                      </div>

                      {(() => {
                        const model: LineItemEnterpriseRowModel = {
                          id: "pbv2-outputs-preview",
                          title: "PBV2 Outputs",
                          subtitle: "Preview-only (no persistence)",
                          optionsSummary: null,
                          optionsSummaryText: null,
                          flags: [],
                          notes: null,
                          alertText: null,
                          statusLabel: null,
                          statusTone: "neutral",
                          qty: null,
                          unitPrice: null,
                          isOverride: null,
                          total: null,
                        };

                        const outputs: PBV2Outputs = {
                          pricingAddons: previewResult ?? undefined,
                          materialEffects: previewMaterialsResult ?? undefined,
                          childItemProposals: previewChildItemsResult ?? undefined,
                        };

                        return (
                          <LineItemRowEnterprise item={model} variant="tray" pbv2Outputs={outputs} />
                        );
                      })()}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">Draft treeJson (Developer fallback)</div>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                className="min-h-[220px] font-mono text-xs"
                placeholder={draft ? "{" : "Create a draft to edit JSON"}
                readOnly={!canEdit}
              />
              <div className="text-xs text-muted-foreground">
                This JSON editor is a temporary fallback until the visual PBV2 editor exists.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Findings</div>
              <div className="rounded-md border border-border">
                <ScrollArea className="h-[220px]">
                  <div className="p-3 space-y-2">
                    {findings.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No findings yet. Click Validate or Publish.</div>
                    ) : (
                      findings.map((f, idx) => (
                        <div key={`${f.code}-${idx}`} className="text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant={f.severity === "ERROR" ? "destructive" : f.severity === "WARNING" ? "secondary" : "outline"}>
                              {f.severity}
                            </Badge>
                            <span className="font-mono text-xs">{f.code}</span>
                          </div>
                          <div className="mt-1">{f.message}</div>
                          <div className="mt-1 text-xs text-muted-foreground font-mono">{f.path}</div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Publish with warnings?</DialogTitle>
                <DialogDescription>
                  Validation returned warnings. Publishing is allowed only with explicit confirmation.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <div className="text-sm font-medium">Top warnings</div>
                <div className="rounded-md border border-border">
                  <ScrollArea className="h-[200px]">
                    <div className="p-3 space-y-2">
                      {findings
                        .filter((f) => f.severity === "WARNING")
                        .slice(0, 10)
                        .map((f, idx) => (
                          <div key={`${f.code}-w-${idx}`} className="text-sm">
                            <div className="font-mono text-xs">{f.code}</div>
                            <div className="mt-1">{f.message}</div>
                            <div className="mt-1 text-xs text-muted-foreground font-mono">{f.path}</div>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={publishMutation.isPending}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => publishMutation.mutate(true)} disabled={publishMutation.isPending}>
                  Confirm Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {active ? (
            <div className="text-xs text-muted-foreground">
              Active version: <span className="font-mono">{active.id}</span>
              {active.publishedAt ? ` • published ${new Date(active.publishedAt).toLocaleString()}` : null}
            </div>
          ) : null}
        </div>
          </>
        )}
      </CardContent>
    </Card>

      {/* JSON Import Modal */}
      <Dialog open={jsonImportModalOpen} onOpenChange={setJsonImportModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload PBV2 JSON</DialogTitle>
            <DialogDescription>
              Paste a PBV2 product JSON export below. This will be validated before you can apply it to the Draft.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Warning Banner */}
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <strong>Safe Draft Workflow:</strong> This JSON will be applied to the Draft only. The Published version will not be affected until you explicitly publish the Draft.
                </div>
              </div>
            </div>

            {/* Context Clarity Block */}
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <Info className="h-3 w-3 shrink-0" />
                <span className="font-medium">Import Context</span>
              </div>
              <div className="pl-5 space-y-0.5">
                <div>
                  <span className="font-medium">Applying to:</span> Draft
                </div>
                <div>
                  <span className="font-medium">Draft status:</span>{" "}
                  {draft ? "Existing" : "Will be created"}
                </div>
                <div>
                  <span className="font-medium">Validation rules:</span> Publish-safe
                </div>
                {jsonImportSchemaVersion && (
                  <div>
                    <span className="font-medium">Detected schema:</span> v{jsonImportSchemaVersion}
                  </div>
                )}
              </div>
            </div>

            {/* JSON Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">JSON Input</label>
              <textarea
                className="w-full h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder='Paste PBV2 JSON here (e.g., { "nodes": [...], "edges": [...], "rootNodeIds": [...] })'
                value={jsonImportText}
                onChange={(e) => {
                  setJsonImportText(e.target.value);
                  setJsonImportValidated(false);
                  setJsonImportFindings([]);
                  setJsonImportError("");
                  setJsonImportSchemaVersion(null);
                }}
              />
            </div>

            {/* Validate Button */}
            <Button
              onClick={validateJsonImport}
              disabled={!jsonImportText.trim() || jsonImportValidated}
            >
              {jsonImportValidated ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Validated
                </>
              ) : (
                "Validate JSON"
              )}
            </Button>

            {/* Validation Error */}
            {jsonImportError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>Validation Error:</strong>
                    <pre className="mt-1 text-xs whitespace-pre-wrap font-mono">{jsonImportError}</pre>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Findings */}
            {jsonImportValidated && jsonImportFindings.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Validation Findings:</div>
                <div className="space-y-1">
                  {jsonImportFindings.map((finding, idx) => {
                    const Icon =
                      finding.severity === "ERROR"
                        ? AlertTriangle
                        : finding.severity === "WARNING"
                        ? AlertTriangle
                        : Info;
                    const textColor =
                      finding.severity === "ERROR"
                        ? "text-red-600 dark:text-red-400"
                        : finding.severity === "WARNING"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-blue-600 dark:text-blue-400";
                    return (
                      <div key={idx} className={`flex items-start gap-2 text-sm ${textColor}`}>
                        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{finding.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Success Message */}
            {jsonImportValidated && jsonImportFindings.length === 0 && !jsonImportError && (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>Valid JSON!</strong> This JSON passed all validation checks. You can apply it to the Draft.
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setJsonImportModalOpen(false);
                setJsonImportText("");
                setJsonImportValidated(false);
                setJsonImportFindings([]);
                setJsonImportError("");
                setJsonImportSchemaVersion(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                applyJsonImportMutation.mutate();
              }}
              disabled={
                !jsonImportValidated ||
                !!jsonImportError ||
                jsonImportFindings.some((f) => f.severity === "ERROR") ||
                applyJsonImportMutation.isPending
              }
            >
              {applyJsonImportMutation.isPending ? "Applying..." : "Apply to Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
