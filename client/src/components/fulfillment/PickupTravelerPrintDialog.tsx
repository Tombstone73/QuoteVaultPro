import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Destination = { id: string; displayName: string; location: string | null; isDefault: boolean; available: boolean };
export type PickupTravelerLine = { orderLineItemId: string; description: string; quantity: number };

export function PickupTravelerPrintDialog({ orderId, lines, open, onOpenChange }: { orderId: string; lines: PickupTravelerLine[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [destinationId, setDestinationId] = useState("");
  const [boxCount, setBoxCount] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef<string | null>(null);
  const query = useQuery<Destination[]>({ queryKey: ["/api/direct-print/traveler-destinations"], enabled: open, queryFn: async () => { const r = await fetch("/api/direct-print/traveler-destinations", { credentials: "include" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load Traveler destinations"); return j.data; } });
  const destinations = query.data ?? [];
  const selected = destinations.find((item) => item.id === destinationId);
  useEffect(() => { if (!open || destinationId) return; const target = destinations.find((item) => item.isDefault && item.available) ?? destinations.find((item) => item.available) ?? destinations[0]; if (target) setDestinationId(target.id); }, [open, destinationId, destinations]);
  useEffect(() => { if (!open) { setBoxCount("1"); requestKey.current = null; } }, [open]);

  async function print() {
    const parsedBoxes = Number(boxCount);
    if (!lines.length) { toast({ title: "No pickup quantity entered", description: "Enter at least one positive Picked up now quantity before printing.", variant: "destructive" }); return; }
    if (!selected?.available || !Number.isInteger(parsedBoxes) || parsedBoxes < 1 || parsedBoxes > 100) { toast({ title: "Select an available printer and enter 1–100 boxes.", variant: "destructive" }); return; }
    const key = requestKey.current ?? crypto.randomUUID(); requestKey.current = key; setSubmitting(true);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/direct-print/pickup-travelers`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ destinationId, boxCount: parsedBoxes, lineQuantities: lines.map(({ orderLineItemId, quantity }) => ({ orderLineItemId, quantity })), requestKey: key }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Pickup travelers could not be queued");
      requestKey.current = null;
      toast({ title: `Pickup travelers sent to ${selected.displayName}`, description: `${parsedBoxes} numbered ${parsedBoxes === 1 ? "tag was" : "tags were"} queued. Pickup quantities have not been recorded.` });
      onOpenChange(false);
    } catch (error: any) { toast({ title: "Pickup traveler printer is unavailable", description: error.message || "Retry to reuse this print request.", variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Print Pickup Travelers</DialogTitle><DialogDescription>These print-only quantities do not complete the pickup.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded border bg-muted/30 p-3"><p className="text-sm font-semibold">Pickup quantities</p><div className="mt-2 space-y-1 text-sm">{lines.map((line) => <div key={line.orderLineItemId} className="flex justify-between gap-3"><span className="min-w-0 truncate">{line.description}</span><strong>Pickup Qty {line.quantity}</strong></div>)}</div></div><div className="space-y-1.5"><Label>Printer / Destination</Label><Select value={destinationId} onValueChange={setDestinationId}><SelectTrigger><SelectValue placeholder="Select a destination" /></SelectTrigger><SelectContent>{destinations.map((item) => <SelectItem key={item.id} value={item.id} disabled={!item.available}>{item.displayName}{item.location ? ` — ${item.location}` : ""}{item.available ? "" : " (offline)"}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="pickup-traveler-box-count">Number of boxes</Label><Input id="pickup-traveler-box-count" type="number" min="1" max="100" step="1" value={boxCount} onChange={(event) => setBoxCount(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void print()} disabled={query.isLoading || submitting || !selected?.available || !lines.length}>{submitting ? "Queueing…" : `Print ${Number(boxCount) || 0} Travelers`}</Button></DialogFooter></DialogContent></Dialog>;
}
