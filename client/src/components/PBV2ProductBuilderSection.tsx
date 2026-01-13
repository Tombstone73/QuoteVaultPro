import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { createPbv2StarterTreeJson, stringifyPbv2TreeJson } from "@shared/pbv2/starterTree";

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

export default function PBV2ProductBuilderSection({ productId }: { productId: string }) {
  const { toast } = useToast();
  const [draftText, setDraftText] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastError, setLastError] = useState<string>("");

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
    saveDraftMutation.isPending ||
    publishMutation.isPending;

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
              disabled={isBusy}
            >
              Create Starter Draft
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
