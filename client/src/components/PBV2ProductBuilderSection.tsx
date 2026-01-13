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
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish, validateTreeForRestore } from "@shared/pbv2/validator";
import { createPbv2BannerGrommetsTreeJson, createPbv2StarterTreeJson, stringifyPbv2TreeJson } from "@shared/pbv2/starterTree";
import { buildSymbolTable } from "@shared/pbv2/symbolTable";
import type { SymbolTable } from "@shared/pbv2/symbolTable";
import { buildVariableCatalog } from "@shared/pbv2/variableCatalog";
import { validateFormulaJson } from "@shared/pbv2/formulaValidation";
import { pbv2ToPricingAddons } from "@shared/pbv2/pricingAdapter";
import FormulaEditor from "@/components/FormulaEditor";

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

export default function PBV2ProductBuilderSection({ productId }: { productId: string }) {
  const { toast } = useToast();
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
              disabled={!draft || isBusy}
            >
              Save Draft
            </Button>

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
                          try {
                            parsed = JSON.parse(formulaText);
                          } catch {
                            toast({ title: "Invalid JSON", description: "Formula JSON must be valid JSON.", variant: "destructive" });
                            return;
                          }

                          const ctx =
                            formulaTarget === "PRICE_COMPONENT_APPLIES_WHEN"
                              ? "CONDITION"
                              : formulaTarget === "COMPUTE_EXPRESSION"
                              ? "COMPUTE"
                              : "PRICE";
                          const validated = validateFormulaJson(parsed, ctx as any, symbolTableBundle.table, { pathBase: "expr" });
                          if (!validated.ok) {
                            toast({ title: "Formula invalid", description: `${validated.errors.length} error(s)`, variant: "destructive" });
                            return;
                          }

                          const nodeId = formulaNodeId.trim();
                          const componentIdx = Number(priceComponentIndex);

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
                    </div>
                  </div>
                </div>

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
      </CardContent>
    </Card>
  );
}
