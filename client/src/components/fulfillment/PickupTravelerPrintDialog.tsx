import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import { pickupTravelerBoxSchema, type PickupTravelerHistoryEntry } from "@shared/pickupTravelerProgress";

type Destination = { id: string; displayName: string; location: string | null; isDefault: boolean; available: boolean };
export type PickupTravelerLine = { orderLineItemId: string; description: string; quantity: number };
type Props = { orderId: string; lines: PickupTravelerLine[]; open: boolean; onOpenChange: (open: boolean) => void;
  reprint?: PickupTravelerHistoryEntry | null; onQueued?: (jobId: string) => void };

export function PickupTravelerPrintDialog({ orderId, lines, open, onOpenChange, reprint, onQueued }: Props) {
  const { toast } = useToast();
  const [destinationId, setDestinationId] = useState("");
  const [currentBox, setCurrentBox] = useState("");
  const [totalBoxes, setTotalBoxes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef<string | null>(null);
  const query = useQuery<Destination[]>({ queryKey: ["/api/direct-print/traveler-destinations"], enabled: open,
    queryFn: async () => { const r = await apiFetch("/api/direct-print/traveler-destinations"); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load Traveler destinations"); return j.data; } });
  const destinations = query.data ?? [];
  const selected = destinations.find(item => item.id === destinationId);
  useEffect(() => { if (!open || destinationId) return; const target = destinations.find(item => item.isDefault && item.available) ?? destinations.find(item => item.available); if (target) setDestinationId(target.id); }, [open, destinationId, destinations]);
  useEffect(() => { if (!open) { setCurrentBox(""); setTotalBoxes(""); requestKey.current = null; } }, [open]);
  const lineKey = JSON.stringify(lines);
  useEffect(() => { requestKey.current = null; }, [currentBox, totalBoxes, destinationId, reprint?.id, lineKey]);
  const visibleLines = reprint?.lines ?? lines;

  async function print() {
    const box = pickupTravelerBoxSchema.safeParse({ currentBox, totalBoxes });
    if (!reprint && !box.success) { toast({ title: "Invalid box numbers", description: "Leave both blank, or enter positive whole numbers with current box no greater than total boxes.", variant: "destructive" }); return; }
    if (!reprint && !lines.length) { toast({ title: "No pickup quantity entered", variant: "destructive" }); return; }
    if (!selected?.available) return;
    const key = requestKey.current ?? crypto.randomUUID(); requestKey.current = key; setSubmitting(true);
    try {
      const body = reprint ? { destinationId, reprintJobId: reprint.id, requestKey: key } : {
        destinationId, currentBox, totalBoxes, lineQuantities: lines.map(({ orderLineItemId, quantity }) => ({ orderLineItemId, quantity })), requestKey: key,
      };
      const r = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/direct-print/pickup-travelers`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
      });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Pickup Traveler could not be queued");
      requestKey.current = null;
      if (!reprint) onQueued?.(j.data.id);
      toast({ title: reprint ? "Traveler reprint queued" : "Pickup Traveler queued", description: `Sent to ${selected.displayName}.` });
      onOpenChange(false);
    } catch (error: any) { toast({ title: "Pickup Traveler could not be queued", description: error.message || "Retry to reuse this print request.", variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!submitting) onOpenChange(value); }}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>{reprint ? "Reprint Pickup Traveler" : "Print Pickup Traveler"}</DialogTitle>
      <DialogDescription>{reprint ? "Print the saved quantities and package label. Current reversal status is included." : "Prepare paperwork for the entered pickup quantities."}</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="rounded border bg-muted/30 p-3"><p className="text-sm font-semibold">Pickup quantities</p><div className="mt-2 space-y-1 text-sm">{visibleLines.map(line => <div key={line.orderLineItemId} className="flex justify-between gap-3"><span>{line.description}</span><strong>{line.quantity}</strong></div>)}</div></div>
      <div className="space-y-1.5"><Label>Printer / Destination</Label><Select value={destinationId} onValueChange={setDestinationId}><SelectTrigger><SelectValue placeholder="Select a destination" /></SelectTrigger><SelectContent>{destinations.map(item => <SelectItem key={item.id} value={item.id} disabled={!item.available}>{item.displayName}{item.location ? ` — ${item.location}` : ""}{item.available ? "" : " (offline)"}</SelectItem>)}</SelectContent></Select></div>
      {query.isError && <div role="alert">Could not load printers. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
      {reprint ? <p className="text-sm">{reprint.box ? `Box ${reprint.box.current} of ${reprint.box.total}` : reprint.legacyBoxCount ? `Saved batch: ${reprint.legacyBoxCount} boxes` : "No box label"}</p> : <div className="flex items-end gap-2">
        <div><Label htmlFor="pickup-current-box">Box (optional)</Label><Input id="pickup-current-box" inputMode="numeric" value={currentBox} onChange={e => setCurrentBox(e.target.value)} /></div>
        <span className="pb-2">of</span><div><Label htmlFor="pickup-total-boxes">Total boxes (optional)</Label><Input id="pickup-total-boxes" inputMode="numeric" value={totalBoxes} onChange={e => setTotalBoxes(e.target.value)} /></div>
      </div>}
    </div><DialogFooter><Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button onClick={() => void print()} disabled={query.isLoading || submitting || !selected?.available || (!reprint && !lines.length)}>{submitting ? "Queueing…" : reprint ? "Reprint Traveler" : "Print Traveler"}</Button>
    </DialogFooter></DialogContent></Dialog>;
}
