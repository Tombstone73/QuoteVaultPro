import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ReturnUpstreamError, returnUpstream, type ReturnUpstreamDestination, type ReturnUpstreamTarget } from "@/lib/returnUpstream";

export function ReturnUpstreamDialog({ target, destination, onClose }: {
  target: ReturnUpstreamTarget | null;
  destination: ReturnUpstreamDestination | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refresh = async (orderId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] }),
      queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] }),
      queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: () => returnUpstream(target!, destination!, reason),
    retry: false,
    onSuccess: async () => {
      const orderId = target!.orderId;
      const completedDestination = destination;
      setReason("");
      setError(null);
      setNeedsReview(false);
      onClose();
      toast({ title: `Returned to ${completedDestination === "proofing" ? "Proofing" : "Design"}` });
      await refresh(orderId);
    },
    onError: async (failure) => {
      if (failure instanceof ReturnUpstreamError && failure.status === 409) {
        await refresh(target!.orderId);
        setError(failure.code === "UPSTREAM_STALE_STATE"
          ? "This work changed since you opened it. The latest state has been refreshed. Review it before trying again."
          : failure.message);
        if (failure.code === "UPSTREAM_STALE_STATE") setNeedsReview(true);
      } else {
        setError(failure.message || "Return upstream failed.");
      }
    },
  });
  const label = destination === "design" ? "Design" : "Proofing";
  return <Dialog open={Boolean(target && destination)} onOpenChange={(open) => { if (!open && !mutation.isPending) { setReason(""); setError(null); setNeedsReview(false); onClose(); } }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Return to {label}?</DialogTitle>
        <DialogDescription>{destination === "design"
          ? "Return this line to Design. Prior Proof and workflow history will be preserved."
          : "Move this line back to Proofing while preserving its workflow history."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="return-upstream-reason">Reason</Label>
        <Textarea id="return-upstream-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} required />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { setReason(""); setError(null); setNeedsReview(false); onClose(); }} disabled={mutation.isPending}>Cancel</Button>
        <Button type="button" disabled={!reason.trim() || mutation.isPending || needsReview} onClick={() => { setError(null); mutation.mutate(); }}>
          Return to {label}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
