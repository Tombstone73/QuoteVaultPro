import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  portalDashboardKeys,
  portalOrderKeys,
  portalProofFileUrl,
  portalProofKeys,
  usePortalProof,
  usePortalProofAction,
  type PortalProofAction,
  type PortalProofDto,
} from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function proofVariant(proof: PortalProofDto): "default" | "secondary" | "destructive" | "outline" {
  if (proof.status === "approved") return "default";
  if (proof.status === "unavailable") return "destructive";
  if (proof.customerActionRequired) return "outline";
  return "secondary";
}

export default function PortalProofDetailPage() {
  const { id } = useParams<{ id: string }>();
  const proofId = id || "";
  const queryClient = useQueryClient();
  const proofQuery = usePortalProof(proofId);
  const action = usePortalProofAction(proofId);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const proof = proofQuery.data;

  async function submit(actionName: PortalProofAction) {
    setMessage(null);
    const result = await action.mutateAsync({ action: actionName, note: note.trim() || null });
    setMessage(result.message);
    setNote("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: portalProofKeys.all }),
      queryClient.invalidateQueries({ queryKey: portalProofKeys.detail(proofId) }),
      queryClient.invalidateQueries({ queryKey: portalDashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: portalOrderKeys.all }),
      queryClient.invalidateQueries({ queryKey: portalOrderKeys.detail(result.proof.orderSummary.id) }),
    ]);
  }

  if (proofQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!proof) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Button asChild variant="ghost">
          <Link to="/portal/proofs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to proofs
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Proof not found</p>
            <p className="mt-1 text-sm text-muted-foreground">This proof is unavailable or you do not have access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" className="mb-2 px-0">
          <Link to="/portal/proofs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to proofs
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">Proof v{proof.versionNumber}</h1>
          <Badge variant={proofVariant(proof)}>{proof.displayStatus}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Order #{proof.orderSummary.orderNumber} / {proof.lineItemSummary.name}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Proof Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {proof.proofFileAvailable ? (
              <div className="rounded-md border bg-muted/30 p-4">
                <p className="text-sm font-medium">
                  {proof.previewAvailable ? "Proof file is ready to view." : "Proof file is available for download."}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Open the proof file to review the artwork before responding.</p>
                <Button asChild className="mt-4" variant="outline">
                  <a href={portalProofFileUrl(proof.id)} target="_blank" rel="noreferrer">
                    <Download className="mr-2 h-4 w-4" />
                    Open Proof File
                  </a>
                </Button>
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Proof file is not available.
              </p>
            )}

            {proof.proofNotes ? (
              <div>
                <p className="text-sm font-medium">Proof Notes</p>
                <p className="mt-2 whitespace-pre-wrap rounded-md border p-3 text-sm text-muted-foreground">{proof.proofNotes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Respond</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? <p className="rounded-md bg-muted p-3 text-sm">{message}</p> : null}
            {action.error ? <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{(action.error as Error).message}</p> : null}
            {proof.customerActionRequired ? (
              <>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional note for a decline or revision request"
                  className="min-h-24"
                />
                <div className="grid gap-2">
                  <Button disabled={action.isPending || !proof.previewAvailable} onClick={() => submit("approve")}>
                    Approve Proof
                  </Button>
                  <Button disabled={action.isPending} variant="outline" onClick={() => submit("request_revision")}>
                    Request Revision
                  </Button>
                  <Button disabled={action.isPending} variant="secondary" onClick={() => submit("reject")}>
                    Decline Proof
                  </Button>
                </div>
                {!proof.previewAvailable ? (
                  <p className="text-xs text-muted-foreground">Approval is unavailable until the proof preview is ready.</p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">This proof has already been reviewed.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proof History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(proof.history ?? []).length ? (
            proof.history?.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
                <span>Version {item.versionNumber}</span>
                <span className="text-muted-foreground">{item.displayStatus}</span>
                <span className="text-muted-foreground">{formatDate(item.respondedAt || item.createdAt)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No prior proof history is available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
