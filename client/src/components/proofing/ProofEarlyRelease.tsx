import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProofingReadModel } from "@shared/proofing";
import { apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

async function readProofing(lineItemId: string): Promise<ProofingReadModel> {
  const response = await apiFetch(`/api/proofing/line-item/${lineItemId}`, { credentials: "include", cache: "no-store" });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "Proof authorization could not be confirmed");
  return body.data;
}

export function ProofEarlyReleaseNotice({ detail }: { detail?: ProofingReadModel }) {
  if (!detail?.earlyReleaseHistory?.length) return null;
  const active = detail.proofGate?.earlyRelease;
  return <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
    <p className="font-medium">{active ? "Released before customer approval" : "Previous early release retained in history"}</p>
    <p>{!detail.requiresProofApproval ? "Proof approval is no longer required. Earlier authorizations and decisions remain in history." : detail.proofGate?.approved ? "Customer approval has since been recorded." : active ? "Customer approval remains pending." : "The previous authorization does not authorize the current proof or artwork. Review the customer decision and use Return for Correction when needed."}</p>
    {detail.earlyReleaseHistory.map(release => <p key={release.id} className="mt-2 text-xs">
      Proof {release.proofVersionId} · {new Date(release.authorizedAt).toLocaleString()} · Authorized by {release.actorUserId}<br />
      {release.reason}
    </p>)}
  </div>;
}

export function ProductionProofReleaseStatus({ lineItemId }: { lineItemId?: string | null }) {
  const query = useQuery({ queryKey: ["/api/proofing/line-item", lineItemId], queryFn: async () => ({ success: true, data: await readProofing(lineItemId!) }), enabled: Boolean(lineItemId) });
  if (query.isError) return <p role="alert">Proof authorization status could not be loaded. Refresh before starting work.</p>;
  return <ProofEarlyReleaseNotice detail={query.data?.data} />;
}

export function ProofEarlyReleaseAction({ lineItemId, detail, canAuthorize, onReleased }: {
  lineItemId: string; detail?: ProofingReadModel; canAuthorize: boolean; onReleased: () => Promise<unknown>;
}) {
  const [review, setReview] = useState<{ operationId: string; expectedUpdatedAt: string; expectedOwnerJobId: string; proofVersionId: string; artworkFingerprint: string } | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!review || !reason.trim()) throw new Error("Review the release and enter a reason");
      const response = await apiFetch(`/api/proofing/line-item/${lineItemId}/early-production-release`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...review, reason: reason.trim(), confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Early release failed");
      const fresh = await readProofing(lineItemId);
      if (!fresh.requiresProofApproval || fresh.approvedProofVersionId || fresh.proofGate?.earlyRelease?.id !== body.data.authorization.id) {
        throw new Error("Release was recorded, but its current authorization could not be confirmed. Refresh before retrying.");
      }
      client.setQueryData(["/api/proofing/line-item", lineItemId], { success: true, data: fresh });
      return fresh;
    },
    onSuccess: async () => {
      setReview(null); setReason("");
      await onReleased();
      await client.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      toast({ title: "Released before customer approval", description: "The reviewed revision was released. Customer approval remains pending." });
    },
    onError: (error: Error) => toast({ title: "Early release not confirmed", description: error.message, variant: "destructive" }),
  });
  const available = detail?.requiresProofApproval && !detail.approvedProofVersionId
    && detail.earlyReleaseReview?.revision?.status === "awaiting_response" && !detail.proofGate?.earlyRelease;
  return <div className="space-y-3">
    <ProofEarlyReleaseNotice detail={detail} />
    {canAuthorize && available ? <Button variant="outline" className="w-full" onClick={() => {
      const current = detail.earlyReleaseReview!;
      if (!current.revision || !current.expectedOwnerJobId) return;
      setReason("");
      setReview({ operationId: crypto.randomUUID(), expectedUpdatedAt: current.expectedUpdatedAt, expectedOwnerJobId: current.expectedOwnerJobId,
        proofVersionId: current.revision.proofVersionId, artworkFingerprint: current.revision.artworkFingerprint });
    }} disabled={!detail.earlyReleaseReview?.expectedOwnerJobId}>Release to Production Without Approval</Button> : null}
    <Dialog open={Boolean(review)} onOpenChange={open => { if (!open && !mutation.isPending) setReview(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Release Without Customer Approval</DialogTitle>
          <DialogDescription>The customer has not approved this proof. Releasing it allows production to proceed before approval. If the customer requests changes afterward, materials and labor already used may require reprinting.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">Only the reviewed proof and artwork revision will be authorized. Required Design, Prepress, artwork checks, and credit holds still apply.</p>
        <Label htmlFor="proof-early-release-reason">Reason for early release</Label>
        <Textarea id="proof-early-release-reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={mutation.isPending} />
        <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => setReview(null)}>Cancel</Button>
          <Button disabled={mutation.isPending || !reason.trim()} onClick={() => mutation.mutate()}>{mutation.isPending ? "Confirming…" : "Confirm Early Release"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
