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
import { apiRequest } from "@/lib/queryClient";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";

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

export default function PBV2ProductBuilderSection({ productId }: { productId: string }) {
  const { toast } = useToast();
  const [draftText, setDraftText] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const treeQuery = useQuery<TreeResponse>({
    queryKey: ["/api/products", productId, "pbv2", "tree"],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/pbv2/tree`, { credentials: "include" });
      return (await res.json()) as TreeResponse;
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
      const res = await apiRequest("POST", `/api/products/${productId}/pbv2/tree/draft`, {});
      return res as any;
    },
    onSuccess: async () => {
      setFindings([]);
      await treeQuery.refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft to save");

      let parsed: any;
      try {
        parsed = JSON.parse(draftText || "{}");
      } catch {
        throw new Error("Draft JSON is invalid");
      }

      const res = await apiRequest("PATCH", `/api/pbv2/tree-versions/${draft.id}`, { treeJson: parsed });
      return res as any;
    },
    onSuccess: async () => {
      toast({ title: "Draft saved" });
      await treeQuery.refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
      const qs = confirmWarnings ? "?confirmWarnings=true" : "";
      const res = await fetch(`/api/pbv2/tree-versions/${draft.id}/publish${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        const message = json?.message || "Publish failed";
        const err = new Error(message) as any;
        err.payload = json;
        throw err;
      }
      return json;
    },
    onSuccess: async (data: any) => {
      const nextFindings = (data?.findings ?? []) as Finding[];
      setFindings(nextFindings);

      if (data?.requiresWarningsConfirm) {
        setConfirmOpen(true);
        return;
      }

      toast({ title: "Published", description: "Draft is now ACTIVE." });
      setConfirmOpen(false);
      await treeQuery.refetch();
    },
    onError: (error: any) => {
      const payload = error?.payload;
      if (payload?.findings) setFindings(payload.findings as Finding[]);
      toast({ title: "Publish blocked", description: error.message, variant: "destructive" });
    },
  });

  const canEdit = Boolean(draft);

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

        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => createDraftMutation.mutate()}
              disabled={createDraftMutation.isPending || Boolean(draft)}
            >
              Create Draft
            </Button>
            <Button type="button" variant="secondary" onClick={validateLocal} disabled={!draft}>
              Validate
            </Button>
            <Button
              type="button"
              onClick={() => publishMutation.mutate(false)}
              disabled={!draft || publishMutation.isPending}
            >
              Publish
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => saveDraftMutation.mutate()}
              disabled={!draft || saveDraftMutation.isPending}
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
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
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
