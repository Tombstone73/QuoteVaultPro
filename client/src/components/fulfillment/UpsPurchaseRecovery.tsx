import { useRef, useState } from "react";
import { apiCall, toFulfillmentError } from "@/hooks/useFulfillment";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function UpsPurchaseRecovery({ shipmentId, purchaseId, canRecover, savedResponseAvailable, onChanged }: {
  shipmentId: string; purchaseId: string; canRecover: boolean; savedResponseAvailable: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const recover = async () => {
    if (inFlight.current || !confirmed || !canRecover) return;
    inFlight.current = true; setBusy(true); setMessage("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      await apiCall(`/api/fulfillment/shipments/${shipmentId}/ups-labels/${purchaseId}/recover`, { method: "POST", signal: controller.signal });
      const history = await apiCall<Array<{ id: string; status: string; labels: unknown[] }>>(`/api/fulfillment/shipments/${shipmentId}/ups-labels`, { signal: controller.signal });
      const saved = history.find(row => row.id === purchaseId);
      if (!saved || !["PURCHASED", "MAPPING_REQUIRED"].includes(saved.status) || !saved.labels.length) throw new Error("Recovery readback is not confirmed. Refresh UPS history before another action.");
      await onChanged(); setOpen(false); setConfirmed(false);
    } catch (error) {
      setMessage(controller.signal.aborted ? "Recovery timed out; its result is uncertain. Refresh UPS history. Do not purchase another label." : toFulfillmentError(error).message);
      await onChanged().catch(() => undefined);
    } finally { window.clearTimeout(timeout); inFlight.current = false; setBusy(false); }
  };
  return <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
    <p role="alert">UPS may already have purchased this label. Local recording is unresolved. Do not buy another label.</p>
    <p className="break-all text-xs">Attempt: {purchaseId}</p>
    {!savedResponseAvailable && <p>There is no saved carrier response to recover. Ask an administrator to verify this attempt in the UPS account or with UPS support before any replacement.</p>}
    {!canRecover && <p>An owner or administrator must review this attempt.</p>}
    {canRecover && savedResponseAvailable && <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setConfirmed(false); setMessage(""); }}>Review saved UPS response</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent><DialogHeader>
      <DialogTitle>Recover recorded UPS purchase</DialogTitle><DialogDescription>Recover local label records from the already saved carrier response. This does not buy, void, or print a label and does not mark the shipment shipped.</DialogDescription>
    </DialogHeader><p className="break-all text-sm">Attempt {purchaseId}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I am recovering this existing attempt, not requesting a new label purchase.</label>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="button" disabled={busy || !confirmed} onClick={() => void recover()}>{busy ? "Recovering…" : "Recover saved response"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
